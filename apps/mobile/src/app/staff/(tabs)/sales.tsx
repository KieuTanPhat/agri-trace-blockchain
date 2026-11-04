import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '../../../auth/session';
import { Button, Card, Chips, Empty, Field, Header, Loadable, Notice, Pill, Screen, T } from '../../../components/staff/ui';
import { qty } from '../../../lib/format';
import { lotStop, type StockLot } from '../../../lib/stock';
import { quantityError, useCommand } from '../../../lib/use-command';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color, space } from '../../../theme/staff';

/** Retail desk: lots on hand and a sale that deducts stock by lot and site. */
export default function Sales() {
  const { call } = useSession();
  const list = useLoad(() => call<{ lots: StockLot[] }>('/distribution/reports'), [], { key: 'stock-report', staleTimeMs: 15_000 });
  useReloadOnFocus(list.reloadIfStale);
  const lots = (list.data?.lots ?? []).filter((l) => Number(l.held) > 0);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Bán hàng" subtitle="Ghi bán trừ tồn theo lô" />
      <Screen refreshing={list.loading} onRefresh={() => void list.reload()} bottomInset={96}>
        <Loadable {...list} reload={() => void list.reload()}>
          {() =>
            lots.length === 0 ? (
              <Card>
                <Empty title="Chưa có lô nào để bán" icon="store" />
              </Card>
            ) : (
              <>{lots.map((l) => <SaleCard key={l.lotId} lot={l} onDone={() => void list.reload()} />)}</>
            )
          }
        </Loadable>
      </Screen>
    </View>
  );
}

function SaleCard({ lot, onDone }: { lot: StockLot; onDone: () => void }) {
  const { send, busy, message } = useCommand();
  const sites = lot.siteHoldings.filter((s) => Number(s.available) > 0);
  const [open, setOpen] = useState(false);
  const [site, setSite] = useState(sites[0]?.siteId ?? '');
  const [amount, setAmount] = useState('');
  const stop = lotStop(lot);
  const available = sites.find((s) => s.siteId === site)?.available ?? lot.available;
  const sell = async () => {
    const ok = await send(() => {
      const bad = quantityError(amount, available);
      if (bad) throw new Error(bad);
      return {
        path: '/distribution/quantities',
        label: 'Ghi bán',
        detail: `${lot.lotCode} · ${amount} ${lot.unit}`,
        body: { lotId: lot.lotId, unit: lot.unit, version: lot.version, kind: 'SALE', quantity: amount, reason: 'Bán cho người tiêu dùng', ...(site ? { siteId: site } : {}) },
      };
    }, `Đã ghi bán ${amount} ${lot.unit} lô ${lot.lotCode}.`);
    if (ok) {
      setOpen(false);
      setAmount('');
      onDone();
    }
  };
  return (
    <Card style={{ padding: space.lg, gap: space.sm }}>
      <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: space.sm }}>
        <View style={{ flex: 1 }}>
          <T size={15} weight="bold" numberOfLines={1}>
            {lot.productName}
          </T>
          <T size={13} c={color.muted}>
            {lot.lotCode}
          </T>
        </View>
        <Pill label={stop?.label ?? 'Đang bán'} t={stop?.t ?? 'green'} />
      </View>
      <T size={14} weight="bold" c={color.greenDeep}>
        Khả dụng {qty(Number(lot.available), lot.unit)}
      </T>
      {message && <Notice kind={message.kind} title={message.text} />}
      {open ? (
        <View style={{ gap: space.sm }}>
          {sites.length > 1 && <Chips value={site} onChange={setSite} items={sites.map((s) => ({ key: s.siteId, label: `${s.siteName} · ${s.available}` }))} />}
          <Field label={`Số lượng bán (${lot.unit})`} required keyboardType="decimal-pad" value={amount} onChangeText={setAmount} hint={`Tối đa ${available}`} />
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Button label="Hủy" kind="outline" style={{ flex: 1 }} disabled={busy} onPress={() => setOpen(false)} />
            <Button label="Ghi bán" style={{ flex: 1 }} loading={busy} onPress={() => void sell()} />
          </View>
        </View>
      ) : (
        !stop && sites.length > 0 && <Button label="Ghi bán" kind="outline" icon="store" onPress={() => setOpen(true)} />
      )}
    </Card>
  );
}
