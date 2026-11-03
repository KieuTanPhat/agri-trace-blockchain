import { useState } from 'react';
import { FlatList, Pressable, View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { errorText } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { Button, Card, Empty, Field, GreenHeader, Loading, Notice, Pill, T } from '../../../components/ui';
import { qty } from '../../../lib/format';
import { sendCommand } from '../../../lib/staffApi';
import { useAccess } from '../../../lib/access';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

type Lot = {
  lotId: string; version: number; lotCode: string; productName: string; unit: string; held: string; available: string;
  blocked: boolean; expiryDate: string | null; notices: { kind: string }[];
  siteHoldings: { siteId: string; siteName: string; available: string }[];
};
const DEC = /^\d{1,11}(\.\d{1,3})?$/;
const today = () => new Date().toISOString().slice(0, 10);
const stopped = (l: Lot) => l.blocked || l.notices.some((n) => n.kind === 'RECALL') || (!!l.expiryDate && l.expiryDate.slice(0, 10) < today());

/** Retail desk: lots on hand and a sale that deducts stock by lot. */
export default function Sales() {
  const { call, user } = useSession<Schemas['AuthUserDto']>();
  const { can } = useAccess();
  const list = useLoad(() => call<{ lots: Lot[] }>('/distribution/reports'));
  useReloadOnFocus(list.reload);
  const [open, setOpen] = useState<string | null>(null);
  const [site, setSite] = useState('');
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ kind: 'success' | 'error' | 'warn'; text: string } | null>(null);
  const lots = (list.data?.lots ?? []).filter((l) => Number(l.held) > 0);

  async function sell(lot: Lot) {
    if (!user || busy) return;
    if (!DEC.test(amount) || Number(amount) <= 0) return setMessage({ kind: 'error', text: 'Nhập số lượng lớn hơn 0, tối đa 3 chữ số thập phân.' });
    setBusy(true);
    setMessage(null);
    try {
      const outcome = await sendCommand(call, user, {
        path: '/distribution/quantities',
        label: 'Ghi bán',
        detail: `${lot.lotCode} · ${amount} ${lot.unit}`,
        body: { lotId: lot.lotId, unit: lot.unit, version: lot.version, kind: 'SALE', quantity: amount, reason: 'Bán cho người tiêu dùng', ...(site ? { siteId: site } : {}) },
      });
      if (outcome.sent) {
        setMessage({ kind: 'success', text: `Đã ghi bán ${amount} ${lot.unit} lô ${lot.lotCode}.` });
        setOpen(null);
        setAmount('');
        void list.reload();
      } else setMessage({ kind: outcome.state === 'failed' ? 'error' : 'warn', text: outcome.error });
    } catch (error) {
      setMessage({ kind: 'error', text: errorText(error) });
    } finally {
      setBusy(false);
    }
  }

  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Bán hàng" />
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error ? (
        <View style={{ padding: 16 }}>
          <Notice kind="error" title={list.error} action={<Button label="Thử tải lại" onPress={() => void list.reload()} />} />
        </View>
      ) : (
        <FlatList
          data={lots}
          keyExtractor={(l) => l.lotId}
          onRefresh={() => void list.reload()}
          refreshing={list.loading}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 72 }}
          ListHeaderComponent={message ? <Notice kind={message.kind} title={message.text} /> : !can('quantity.adjust') ? <Notice kind="info" title="Bạn chỉ xem được tồn" body="Ghi bán cần quyền điều chỉnh khối lượng." /> : undefined}
          ListEmptyComponent={<Empty title="Chưa có lô nào để bán" icon="store" />}
          renderItem={({ item }) => {
            const blocked = stopped(item);
            const sites = item.siteHoldings.filter((s) => Number(s.available) > 0);
            return (
              <Card style={{ padding: 14, gap: 8 }}>
                <T size={16} weight="heavy" numberOfLines={1}>{item.productName}</T>
                <T size={13} c={color.muted} style={{ fontFamily: 'monospace' }}>{item.lotCode}</T>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                  <T size={15} weight="heavy" c={color.green}>Khả dụng {qty(Number(item.available), item.unit)}</T>
                  <Pill label={blocked ? (item.notices.some((n) => n.kind === 'RECALL') ? 'Thu hồi' : item.blocked ? 'Bị chặn' : 'Hết hạn') : 'Đang bán'} t={blocked ? 'red' : 'green'} />
                </View>
                {open === item.lotId ? (
                  <View style={{ gap: 10 }}>
                    {sites.length > 1 && (
                      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                        {sites.map((s) => (
                          <Pressable key={s.siteId} accessibilityRole="radio" accessibilityState={{ checked: site === s.siteId }} onPress={() => setSite(s.siteId)}
                            style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: site === s.siteId ? color.green : color.line }}>
                            <T size={13.5}>{s.siteName} · {s.available}</T>
                          </Pressable>
                        ))}
                      </View>
                    )}
                    <Field label={`Số lượng bán (${item.unit})`} required keyboardType="decimal-pad" value={amount} onChangeText={setAmount} />
                    <Button label="Ghi bán" loading={busy} disabled={busy} onPress={() => void sell(item)} />
                    <Button label="Hủy" kind="outline" onPress={() => setOpen(null)} />
                  </View>
                ) : (
                  can('quantity.adjust') && !blocked && Number(item.available) > 0 && (
                    <Button label="Ghi bán" kind="outline" onPress={() => { setOpen(item.lotId); setSite(sites[0]?.siteId ?? ''); setAmount(''); setMessage(null); }} />
                  )
                )}
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}
