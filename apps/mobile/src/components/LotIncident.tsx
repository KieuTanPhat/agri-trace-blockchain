import { useRef, useState } from 'react';
import { View } from 'react-native';
import { errorText, type Schemas } from '../api/client';
import { useSession } from '../auth/session';
import { useAccess } from '../lib/access';
import { sendCommand, uploadPhotos, type Photo } from '../lib/staffApi';
import { quantityError } from '../lib/use-command';
import { useLoad } from '../lib/useApi';
import { PhotoStrip } from './PhotoStrip';
import { Button, Card, Chips, Field, Notice, T } from './staff/ui';

type Holding = { lotId: string; version: number; unit: string; available: string; siteHoldings: { siteId: string; siteName: string; available: string }[] };
const CAUSES = [
  { value: 'SUSPECTED_DAMAGE', label: 'Nghi hư hỏng' },
  { value: 'QUALITY_FAILED', label: 'Không đạt chất lượng' },
  { value: 'AWAITING_INSPECTION', label: 'Chờ kiểm định' },
  { value: 'OTHER', label: 'Khác' },
];

/**
 * Damage and quarantine at the holder's site. Damage needs at least one
 * photo; its hashes are recorded with the trace event. Only the holder
 * organization sees this card.
 */
export function LotIncident({ lotId, lotCode }: { lotId: string; lotCode: string }) {
  const { call, user } = useSession<Schemas['AuthUserDto']>();
  const { can } = useAccess();
  const report = useLoad(() => call<{ lots: Holding[] }>(`/distribution/reports?q=${encodeURIComponent(lotCode)}`), [lotCode]);
  const lot = report.data?.lots.find((l) => l.lotId === lotId);
  const [mode, setMode] = useState<'DAMAGE' | 'HOLD' | null>(null);
  const [site, setSite] = useState('');
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [cause, setCause] = useState('SUSPECTED_DAMAGE');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'warn'; text: string } | null>(null);
  const uploaded = useRef(new Map<string, string>());
  const canDamage = can('quantity.adjust');
  const canHold = can('quarantine.manage');
  if (!lot || Number(lot.available) <= 0 || (!canDamage && !canHold)) return null;
  const sites = lot.siteHoldings.filter((s) => Number(s.available) > 0);

  function open(next: 'DAMAGE' | 'HOLD') {
    setMode(next);
    setSite(sites[0]?.siteId ?? '');
    setAmount('');
    setReason('');
    setPhotos([]);
    setMessage(null);
  }

  async function submit() {
    if (!user || !lot || !mode || busy) return;
    const bad = quantityError(amount, sites.find((s) => s.siteId === site)?.available ?? lot.available);
    if (bad) return setMessage({ kind: 'error', text: bad });
    if (mode === 'HOLD' && !site) return setMessage({ kind: 'error', text: 'Cách ly cần chọn cơ sở đang giữ hàng.' });
    if (reason.trim().length < 10) return setMessage({ kind: 'error', text: 'Mô tả tối thiểu 10 ký tự.' });
    if (mode === 'DAMAGE' && !photos.length) return setMessage({ kind: 'error', text: 'Chụp ít nhất một ảnh hàng hư hỏng.' });
    setBusy(true);
    setMessage(null);
    try {
      const ids = await uploadPhotos(call, { entityType: 'LOT', entityId: lot.lotId, kind: 'DAMAGE_IMAGE', siteId: site || undefined, description: mode === 'DAMAGE' ? 'Ảnh hàng hư hỏng' : 'Ảnh hàng cách ly' }, photos, uploaded.current);
      const common = { lotId: lot.lotId, unit: lot.unit, version: lot.version, quantity: amount, reason: reason.trim(), ...(ids.length ? { photos: ids } : {}) };
      const outcome = mode === 'DAMAGE'
        ? await sendCommand(call, user, { path: '/distribution/quantities', label: 'Báo hư hỏng', detail: `${lotCode} · ${amount} ${lot.unit}`, body: { ...common, kind: 'DAMAGE', ...(site ? { siteId: site } : {}) } })
        : await sendCommand(call, user, { path: '/distribution/quarantine', label: 'Cách ly hàng', detail: `${lotCode} · ${amount} ${lot.unit}`, body: { ...common, siteId: site, action: 'HOLD', cause } });
      if (outcome.sent) {
        setMessage({ kind: 'success', text: mode === 'DAMAGE' ? 'Đã ghi hư hỏng.' : 'Đã cách ly hàng.' });
        setMode(null);
        void report.reload();
      } else setMessage({ kind: outcome.state === 'failed' ? 'error' : 'warn', text: outcome.error });
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card style={{ padding: 16, gap: 10 }}>
      <T size={16} weight="bold">Sự cố tại cơ sở</T>
      {message && <Notice kind={message.kind} title={message.text} />}
      {!mode ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {canDamage && <View style={{ flex: 1 }}><Button label="Báo hư hỏng" kind="outline" icon="camera" onPress={() => open('DAMAGE')} /></View>}
          {canHold && sites.length > 0 && <View style={{ flex: 1 }}><Button label="Cách ly" kind="outline" onPress={() => open('HOLD')} /></View>}
        </View>
      ) : (
        <View style={{ gap: 10 }}>
          <T weight="bold">{mode === 'DAMAGE' ? 'Báo hư hỏng (ghi giảm tồn)' : 'Cách ly (giữ lại, chưa bán)'}</T>
          {sites.length > 1 && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chips value={site} onChange={setSite} items={sites.map((s) => ({ key: s.siteId, label: `${s.siteName} · ${s.available}` }))} />
            </View>
          )}
          {mode === 'HOLD' && (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              <Chips value={cause} onChange={setCause} items={CAUSES.map((c) => ({ key: c.value, label: c.label }))} />
            </View>
          )}
          <Field label={`Số lượng (${lot.unit})`} required keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
          <Field label="Mô tả" required value={reason} onChangeText={setReason} placeholder="Ví dụ: 3 thùng dập nát khi dỡ hàng" />
          {(mode === 'DAMAGE' || canDamage) && (
            <PhotoStrip label={mode === 'DAMAGE' ? 'Ảnh hàng hư hỏng' : 'Ảnh hàng cách ly (không bắt buộc)'} required={mode === 'DAMAGE'} photos={photos} onChange={setPhotos} />
          )}
          <Button label={mode === 'DAMAGE' ? 'Ghi hư hỏng' : 'Cách ly'} loading={busy} disabled={busy} onPress={() => void submit()} />
          <Button label="Hủy" kind="outline" disabled={busy} onPress={() => setMode(null)} />
        </View>
      )}
    </Card>
  );
}
