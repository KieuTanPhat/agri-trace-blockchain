import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { LotIncident } from '../../../components/LotIncident';
import { Button, Card, Header, IconTile, Loading, Notice, Pill, Row, T } from '../../../components/staff/ui';
import { date, dateTime, qty } from '../../../lib/format';
import { LOT_STATE } from '../../../lib/labels';
import { useAccess } from '../../../lib/access';
import { useLoad } from '../../../lib/useApi';
import { color } from '../../../theme/staff';

type Lot = Schemas['InternalLotDto'];

/** Internal lot view, by id or by a scanned token (`id=scan&token=…`). */
export default function StaffLot() {
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const { call } = useSession();
  const { can } = useAccess();
  const { data: lot, error, loading } = useLoad(
    () => call<Lot>(token ? `/lots/by-trace-token/${encodeURIComponent(token)}` : `/lots/${id}`),
    [id, token],
  );
  if (!lot)
    return (
      <View style={{ flex: 1 }}>
        <Header title="Lô hàng" back />
        {loading ? (
          <Loading label="Đang tìm lô…" />
        ) : (
          <View style={{ padding: 16, gap: 12 }}>
            <Notice kind="error" title={error ?? 'Không tìm thấy lô hàng'} body="Lô không tồn tại hoặc không thuộc phạm vi của bạn." />
            <Button label="Quét QR khác" onPress={() => router.replace('/staff/scan')} />
          </View>
        )}
      </View>
    );
  const state = LOT_STATE[lot.currentState] ?? { label: lot.currentState, t: 'blue' as const };
  const ratio = lot.initialQuantity > 0 ? lot.availableQuantity / lot.initialQuantity : 0;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <Header title="Lô hàng" back />
      <Card style={{ marginTop: 16, marginHorizontal: 16, padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <IconTile name="box" t="green" size={48} glyph={24} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={18} weight="bold">
              {lot.productName}
            </T>
            <T size={13} c={color.muted} style={{ fontFamily: 'monospace' }}>
              {lot.lotCode}
            </T>
          </View>
        </View>
        <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
          <Pill label={state.label} t={state.t} />
          {lot.custodian && <Pill label={lot.custodian.organizationId === lot.farmOrg.organizationId ? 'Đơn vị sản xuất đang giữ' : 'Đang được bên khác giữ'} t="green" />}
        </View>
        <View style={{ gap: 6 }}>
          <View style={{ flexDirection: 'row', justifyContent: 'space-between' }}>
            <T size={14} c={color.muted}>
              Còn lại
            </T>
            <T size={14} weight="heavy">
              {qty(lot.availableQuantity, lot.unit)} / {qty(lot.initialQuantity, lot.unit)}
            </T>
          </View>
          <View style={{ height: 10, borderRadius: 5, backgroundColor: color.line, overflow: 'hidden' }}>
            <View style={{ width: `${Math.round(ratio * 100)}%`, height: '100%', backgroundColor: color.green }} />
          </View>
        </View>
      </Card>
      <View style={{ padding: 16, gap: 12 }}>
        {lot.warnings.map((w) => (
          <Notice key={w} kind="warn" title={w} />
        ))}
        <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
          <Row first icon="basket" label="Thu hoạch" value={dateTime(lot.harvestTime)} />
          <Row icon="clock" label="Hạn sử dụng" value={date(lot.expiryDate)} />
          {lot.productionCycle && <Row icon="leaf" label="Mùa vụ" value={lot.productionCycle.cycleCode} mono />}
          <Row icon="building" label="Đơn vị sản xuất" value={lot.farmOrg.name} />
        </Card>
        <LotIncident lotId={lot.lotId} lotCode={lot.lotCode} />
        {lot.productionCycle && can('production.read') && <Button label="Xem mùa vụ" kind="outline" onPress={() => router.push(`/staff/cycle/${lot.productionCycle!.cycleId}`)} />}
      </View>
    </ScrollView>
  );
}
