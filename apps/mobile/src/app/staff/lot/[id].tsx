import { router, useLocalSearchParams } from 'expo-router';
import { ScrollView, View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { Button, Card, GreenHeader, IconTile, Loading, Notice, Pill, Row, T } from '../../../components/ui';
import { date, dateTime, qty } from '../../../lib/format';
import { LOT_STATE } from '../../../lib/labels';
import { useLoad } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

type Lot = Schemas['InternalLotDto'];

/** Internal lot view, by id or by a scanned token (`id=scan&token=…`). */
export default function StaffLot() {
  const { id, token } = useLocalSearchParams<{ id: string; token?: string }>();
  const { call } = useSession();
  const { data: lot, error, loading } = useLoad(
    () => call<Lot>(token ? `/lots/by-trace-token/${encodeURIComponent(token)}` : `/lots/${id}`),
    [id, token],
  );
  if (!lot)
    return (
      <View style={{ flex: 1 }}>
        <GreenHeader title="Lô hàng" back />
        {loading ? (
          <Loading label="Đang tìm lô…" />
        ) : (
          <View style={{ padding: 16, gap: 12 }}>
            <Notice kind="error" title={error ?? 'Không tìm thấy lô hàng'} body="Lô không tồn tại hoặc không thuộc phạm vi của bạn." />
            <Button label="Quét mã khác" onPress={() => router.replace('/staff/scan')} />
          </View>
        )}
      </View>
    );
  const state = LOT_STATE[lot.currentState] ?? { label: lot.currentState, t: 'blue' as const };
  const ratio = lot.initialQuantity > 0 ? lot.availableQuantity / lot.initialQuantity : 0;
  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <GreenHeader title="Lô hàng" back extraBottom={34} />
      <Card style={{ marginTop: -30, marginHorizontal: 16, padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
          <IconTile name="box" t="orange" size={56} />
          <View style={{ flex: 1, gap: 2 }}>
            <T size={20} weight="heavy">
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
          <Row label="THU HOẠCH" value={dateTime(lot.harvestTime)} />
          <Row label="HẠN SỬ DỤNG" value={date(lot.expiryDate)} />
          {lot.productionCycle && <Row label="MÙA VỤ" value={lot.productionCycle.cycleCode} mono />}
          <Row label="ĐƠN VỊ SẢN XUẤT" value={lot.farmOrg.name} />
        </Card>
        {lot.productionCycle && <Button label="Xem mùa vụ" kind="outline" onPress={() => router.push(`/staff/cycle/${lot.productionCycle!.cycleId}`)} />}
      </View>
    </ScrollView>
  );
}
