import { router } from 'expo-router';
import { useRef, useState } from 'react';
import { View } from 'react-native';
import { useSession } from '../../../auth/session';
import { PhotoStrip } from '../../../components/PhotoStrip';
import { Button, Card, Empty, Field, Header, ListItem, Loadable, Notice, Pill, Screen, SegmentTabs, T } from '../../../components/staff/ui';
import { dateTime, qty } from '../../../lib/format';
import { uploadPhotos, type Photo } from '../../../lib/staffApi';
import { useAccess } from '../../../lib/access';
import { lotStop, QUARANTINE_CAUSE, SLIP_STATUS, type QuarantineCase, type SiteSlip, type StockLot } from '../../../lib/stock';
import { quantityError, useCommand } from '../../../lib/use-command';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color, space } from '../../../theme/staff';

type Tab = 'lots' | 'slips' | 'cases';

/** Stock held at the employee's sites, its site-transfer slips and quarantine cases. */
export default function Stock() {
  const { call } = useSession();
  const { can } = useAccess();
  const tabs = [
    { key: 'lots' as const, label: 'Lô đang giữ' },
    ...(can('inventory.manage') ? [{ key: 'slips' as const, label: 'Chuyển kho' }] : []),
    ...(can('quarantine.manage') || can('quantity.adjust') ? [{ key: 'cases' as const, label: 'Cách ly' }] : []),
  ];
  const [chosen, setTab] = useState<Tab>('lots');
  const tab = tabs.some((t) => t.key === chosen) ? chosen : 'lots';
  const report = useLoad(() => call<{ lots: StockLot[] }>('/distribution/reports'), [], { key: 'stock-report', staleTimeMs: 15_000 });
  const slips = useLoad(() => (tab === 'slips' ? call<{ items: SiteSlip[] }>('/distribution/site-transfers') : Promise.resolve(null)), [tab]);
  const cases = useLoad(() => (tab === 'cases' ? call<{ items: QuarantineCase[] }>('/distribution/quarantine-cases') : Promise.resolve(null)), [tab]);
  useReloadOnFocus(report.reloadIfStale);
  const reloadAll = () => {
    void report.reload();
    if (tab === 'slips') void slips.reload();
    if (tab === 'cases') void cases.reload();
  };
  const lots = (report.data?.lots ?? []).filter((l) => Number(l.held) > 0);

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Tồn kho" subtitle="Theo lô và cơ sở bạn được giao" />
      <Screen refreshing={report.loading} onRefresh={reloadAll} bottomInset={96}>
        {tabs.length > 1 && <SegmentTabs value={tab} onChange={setTab} items={tabs} />}
        {tab === 'lots' && (
          <Loadable {...report} reload={() => void report.reload()}>
            {() =>
              lots.length === 0 ? (
                <Card>
                  <Empty title="Không có lô nào đang giữ" icon="warehouse" />
                </Card>
              ) : (
                <Card style={{ overflow: 'hidden' }}>
                  {lots.map((l, i) => {
                    const stop = lotStop(l);
                    return (
                      <ListItem
                        key={l.lotId}
                        first={i === 0}
                        icon="box"
                        t={stop ? 'red' : 'green'}
                        title={l.productName}
                        subtitle={`${l.lotCode} · ${l.siteHoldings.map((s) => s.siteName).join(', ') || 'Chưa phân bổ cơ sở'}`}
                        value={qty(Number(l.available), l.unit)}
                        badge={stop ?? (Number(l.quarantined) > 0 ? { label: `Cách ly ${qty(Number(l.quarantined), l.unit)}`, t: 'orange' } : undefined)}
                        onPress={() => router.push(`/staff/lot/${l.lotId}`)}
                      />
                    );
                  })}
                </Card>
              )
            }
          </Loadable>
        )}
        {tab === 'slips' && (
          <Loadable {...slips} reload={() => void slips.reload()}>
            {(data) => {
              const open = data!.items.filter((s) => ['PENDING', 'IN_TRANSIT', 'DISCREPANCY'].includes(s.status));
              return open.length === 0 ? (
                <Card>
                  <Empty title="Không có phiếu chuyển kho đang mở" icon="boxes" />
                </Card>
              ) : (
                <>{open.map((s) => <SlipCard key={s.id} slip={s} onDone={reloadAll} />)}</>
              );
            }}
          </Loadable>
        )}
        {tab === 'cases' && (
          <Loadable {...cases} reload={() => void cases.reload()}>
            {(data) => {
              const open = data!.items.filter((c) => c.status === 'ACTIVE');
              return open.length === 0 ? (
                <Card>
                  <Empty title="Không có hàng đang cách ly" icon="incident" />
                </Card>
              ) : (
                <>{open.map((c) => <CaseCard key={c.id} item={c} lot={report.data?.lots.find((l) => l.lotId === c.lotId)} onDone={reloadAll} />)}</>
              );
            }}
          </Loadable>
        )}
      </Screen>
    </View>
  );
}

/** Dispatch a pending slip; receive one in transit with the counted quantity. */
function SlipCard({ slip, onDone }: { slip: SiteSlip; onDone: () => void }) {
  const { send, busy, message } = useCommand();
  const [receiving, setReceiving] = useState(false);
  const [received, setReceived] = useState(slip.quantity);
  const [note, setNote] = useState('');
  const status = SLIP_STATUS[slip.status];
  const detail = `${slip.code} · ${slip.lotCode}`;
  const dispatch = async () => {
    if (await send(() => ({ path: `/distribution/site-transfers/${slip.id}/dispatch`, label: 'Xuất phiếu chuyển kho', detail, body: { version: slip.version } }), 'Đã xuất hàng.')) onDone();
  };
  const receive = async () => {
    if (await send(() => {
      const invalid = /^\d{1,11}(\.\d{1,3})?$/.test(received) && Number(received) <= Number(slip.quantity) ? null : `Thực nhận từ 0 đến ${slip.quantity}.`;
      if (invalid) throw new Error(invalid);
      return { path: `/distribution/site-transfers/${slip.id}/receive`, label: 'Nhận phiếu chuyển kho', detail, body: { version: slip.version, receivedQuantity: received, ...(note.trim() ? { note: note.trim() } : {}) } };
    }, 'Đã xác nhận nhận hàng.')) onDone();
  };
  return (
    <Card style={{ padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <T size={15} weight="bold" style={{ flex: 1 }}>
          {slip.productName}
        </T>
        <Pill label={status.label} t={status.t} />
      </View>
      <T size={13} c={color.muted}>
        {slip.code} · {slip.lotCode} · {dateTime(slip.createdAt)}
      </T>
      <T size={14}>
        {slip.fromSiteName} → {slip.toSiteName} · {qty(Number(slip.quantity), slip.unit)}
      </T>
      {message && <Notice kind={message.kind} title={message.text} />}
      {slip.status === 'PENDING' && <Button label="Xuất hàng" icon="truck" loading={busy} onPress={() => void dispatch()} />}
      {slip.status === 'IN_TRANSIT' &&
        (receiving ? (
          <View style={{ gap: space.sm }}>
            <Field label={`Thực nhận (${slip.unit})`} required keyboardType="decimal-pad" value={received} onChangeText={setReceived} hint="Phần thiếu được trả về hoặc ghi hư hỏng trên Web." />
            <Field label="Ghi chú" value={note} onChangeText={setNote} />
            <Button label="Xác nhận nhận hàng" loading={busy} onPress={() => void receive()} />
            <Button label="Hủy" kind="outline" disabled={busy} onPress={() => setReceiving(false)} />
          </View>
        ) : (
          <Button label="Nhận hàng" icon="check" onPress={() => setReceiving(true)} />
        ))}
    </Card>
  );
}

/** Release quarantined stock back to available, or write it off as damaged. */
function CaseCard({ item, lot, onDone }: { item: QuarantineCase; lot?: StockLot; onDone: () => void }) {
  const { call } = useSession();
  const { can } = useAccess();
  const { send, busy, message, setMessage } = useCommand();
  const [mode, setMode] = useState<'RELEASE' | 'DISPOSE' | null>(null);
  const [amount, setAmount] = useState(item.openQuantity);
  const [reason, setReason] = useState('');
  const [photos, setPhotos] = useState<Photo[]>([]);
  const uploaded = useRef(new Map<string, string>());
  const submit = async () => {
    if (!lot) return setMessage({ kind: 'error', text: 'Chưa tải được phiên bản lô. Kéo để tải lại.' });
    const ok = await send(async () => {
      const bad = quantityError(amount, item.openQuantity) ?? (reason.trim().length < (mode === 'RELEASE' ? 10 : 3) ? `Lý do tối thiểu ${mode === 'RELEASE' ? 10 : 3} ký tự.` : null) ?? (mode === 'DISPOSE' && !photos.length ? 'Chụp ít nhất một ảnh hàng hư hỏng.' : null);
      if (bad) throw new Error(bad);
      const base = { lotId: item.lotId, siteId: item.siteId, unit: item.unit, version: lot.version, quantity: amount, reason: reason.trim(), quarantineCaseId: item.id };
      if (mode === 'RELEASE') return { path: '/distribution/quarantine', label: 'Giải tỏa cách ly', detail: item.code, body: { ...base, action: 'RELEASE' } };
      const ids = await uploadPhotos(call, { entityType: 'LOT', entityId: item.lotId, kind: 'DAMAGE_IMAGE', siteId: item.siteId, description: 'Ảnh hàng cách ly hư hỏng' }, photos, uploaded.current);
      return { path: '/distribution/quantities', label: 'Ghi hư hỏng hàng cách ly', detail: item.code, body: { ...base, kind: 'DAMAGE', fromQuarantine: true, photos: ids } };
    }, mode === 'RELEASE' ? 'Đã giải tỏa cách ly.' : 'Đã ghi hư hỏng.');
    if (ok) onDone();
  };
  return (
    <Card style={{ padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <T size={15} weight="bold" style={{ flex: 1 }}>
          {item.productName}
        </T>
        <Pill label={QUARANTINE_CAUSE[item.cause] ?? item.cause} t="orange" />
      </View>
      <T size={13} c={color.muted}>
        {item.code} · {item.lotCode} · {item.siteName}
      </T>
      <T size={14}>
        Còn cách ly {qty(Number(item.openQuantity), item.unit)} / {qty(Number(item.quantity), item.unit)} · {item.reason}
      </T>
      {message && <Notice kind={message.kind} title={message.text} />}
      {!mode ? (
        <View style={{ flexDirection: 'row', gap: space.sm }}>
          {can('quarantine.manage') && <Button label="Giải tỏa" kind="outline" style={{ flex: 1 }} onPress={() => { setMode('RELEASE'); setReason(''); }} />}
          {can('quantity.adjust') && <Button label="Ghi hư hỏng" kind="danger" style={{ flex: 1 }} onPress={() => { setMode('DISPOSE'); setReason(''); }} />}
        </View>
      ) : (
        <View style={{ gap: space.sm }}>
          <Field label={`Số lượng (${item.unit})`} required keyboardType="decimal-pad" value={amount} onChangeText={setAmount} hint={`Tối đa ${item.openQuantity}`} />
          <Field label="Lý do" required value={reason} onChangeText={setReason} />
          {mode === 'DISPOSE' && <PhotoStrip label="Ảnh hàng hư hỏng" required photos={photos} onChange={setPhotos} />}
          <Button label={mode === 'RELEASE' ? 'Giải tỏa' : 'Ghi hư hỏng'} kind={mode === 'RELEASE' ? 'primary' : 'danger'} loading={busy} onPress={() => void submit()} />
          <Button label="Hủy" kind="outline" disabled={busy} onPress={() => setMode(null)} />
        </View>
      )}
    </Card>
  );
}
