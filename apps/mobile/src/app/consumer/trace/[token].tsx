import {DirectoryPhoto} from '../../../components/DirectoryCards';
import {TraceJourney} from '../../../components/TraceJourney';
import { router, useLocalSearchParams } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, Share, View } from 'react-native';
import { api, type Schemas } from '../../../api/client';
import { Icon } from '../../../components/Icon';
import { Button, Card, Empty, GreenHeader, IconButton, Loading, Notice, Pill, Row, SegmentTabs, T } from '../../../components/ui';
import { date, dateTime, qty } from '../../../lib/format';
import { LOT_STATE } from '../../../lib/labels';
import { rememberView } from '../../../lib/local';
import { useLoad } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

type Lot = Schemas['PublicLotDto'];

/**
 * Public trace of one lot. Warnings (recall, expiry, missing sensor data,
 * declared withdrawal periods) sit apart from ordinary data; there is no
 * "verified" badge. Re-opening a history entry always fetches fresh data.
 */
export default function Trace() {
  const { token } = useLocalSearchParams<{ token: string }>();
  const [tab, setTab] = useState<'journey' | 'lot' | 'certs'>('journey');
  const { data: lot, error, loading, reload } = useLoad(() => api<Lot>(`/public/trace/${encodeURIComponent(token ?? '')}`), [token]);
  useEffect(() => {
    if (lot && token) void rememberView(token, lot.productName,lot.imageUrl);
  }, [lot, token]);

  if (loading && !lot)
    return (
      <View style={{ flex: 1 }}>
        <GreenHeader title="Nguồn gốc sản phẩm" back />
        <Loading label="Đang tra cứu lô hàng…" />
      </View>
    );
  if (!lot)
    return (
      <View style={{ flex: 1 }}>
        <GreenHeader title="Nguồn gốc sản phẩm" back />
        <View style={{ padding: 16, gap: 14 }}>
          <Notice kind="error" title={error ?? 'Mã truy xuất không hợp lệ'} body="Kiểm tra lại mã trên tem. Nếu sản phẩm có dấu hiệu bất thường, hãy liên hệ nơi bán." />
          <Button label="Thử lại" kind="outline" onPress={() => void reload()} />
          <Button label="Quét mã khác" onPress={() => router.replace('/consumer/scan')} />
        </View>
      </View>
    );

  const state = LOT_STATE[lot.currentState] ?? { label: lot.currentState, t: 'blue' as const };
  const producer = lot.journey?.find(group => group.company?.id === lot.farmOrg.organizationId)?.company;
  const producerName = producer?.name ?? lot.farmOrg.name;
  const alerts = [
    ...(lot.currentState === 'RECALLED' ? ['Lô hàng đã bị thu hồi. Ngừng sử dụng và liên hệ nơi bán.'] : []),
    ...(lot.isExpired ? [`Lô hàng đã hết hạn${lot.expiryDate ? ` từ ${date(lot.expiryDate)}` : ''}.`] : []),
    ...lot.warnings,
    ...(lot.productionWarnings ?? []),
  ];

  return (
    <ScrollView style={{ flex: 1, backgroundColor: color.bg }} contentContainerStyle={{ paddingBottom: 40 }}>
      <GreenHeader
        title="Nguồn gốc sản phẩm"
        back
        extraBottom={40}
        right={<IconButton name="share" label="Chia sẻ" tint="#fff" onPress={() => void Share.share({ message: `${lot.productName} — mã truy xuất ${lot.traceToken}` })} />}
      />
      <Card style={{ marginTop: -36, marginHorizontal: 16, padding: 16, gap: 10 }}>
        <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
          <Pill label={lot.originType==='TRANSFORMATION'&&lot.currentState==='HARVESTED'?'Đã chế biến':state.label} t={state.t} />
          {lot.originType === 'TRANSFORMATION' && <Pill label="Lô chế biến" t="orange" />}
        </View>
        <View style={{height:200,borderRadius:12,overflow:'hidden',backgroundColor:'#fff'}}><DirectoryPhoto url={lot.imageUrl} label={lot.productName}/></View>
        <T size={26} weight="heavy">
          {lot.productName}
        </T>
        {lot.lotName ? <T c={color.muted}>{lot.lotName}</T> : null}
        <Pressable accessibilityRole="button" accessibilityLabel="Xem doanh nghiệp sản xuất" onPress={() => router.push(`/consumer/enterprise/${lot.farmOrg.organizationId}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
          <View style={{width:42,height:42,borderRadius:9,overflow:'hidden'}}><DirectoryPhoto url={producer?.logoUrl} label={producerName}/></View>
          <View style={{ flex: 1 }}>
            <T size={15} weight="heavy">
              {producerName}
            </T>
            <T size={13.5} c={color.muted}>
              Đơn vị sản xuất
            </T>
          </View>
          <Icon name="chevron" color={color.faint} />
        </Pressable>
      </Card>

      <SegmentTabs
        value={tab}
        onChange={setTab}
        items={[
          { key: 'journey', label: 'Hành trình' },
          { key: 'lot', label: 'Thông tin lô' },
          { key: 'certs', label: 'Chứng chỉ' },
        ]}
      />

      <View style={{ padding: 16, gap: 14 }}>
        {alerts.map((text) => (
          <Notice key={text} kind={lot.currentState === 'RECALLED' || lot.isExpired ? 'error' : 'warn'} title={text} />
        ))}

        {tab === 'journey' && (
          <>
            <Card style={{ padding: 14, flexDirection: 'row' }}>
              {[
                { v: qty(lot.initialQuantity, lot.unit), l: 'Khối lượng lô', c: color.green },
                { v: date(lot.harvestTime).slice(0, 5), l: 'Thu hoạch', c: color.blue },
                { v: `${lot.journey?.length??0} nơi`, l: 'Trong hành trình', c: color.orangeDeep },
              ].map((s, i) => (
                <View key={s.l} style={{ flex: 1, alignItems: 'center', borderLeftWidth: i ? 1 : 0, borderLeftColor: color.line }}>
                  <T size={18} weight="heavy" c={s.c}>
                    {s.v}
                  </T>
                  <T size={13} weight="bold" c={color.muted}>
                    {s.l}
                  </T>
                </View>
              ))}
            </Card>
            <TraceJourney groups={lot.journey??[]}/>
            {lot.shipment && (
              <Card style={{ padding: 16, gap: 4 }}>
                <T size={17} weight="heavy">
                  Vận chuyển
                </T>
                <Row label="TỪ" value={lot.shipment.origin} />
                <Row label="ĐẾN" value={lot.shipment.destination} />
                <Row label="NHẬN HÀNG" value={dateTime(lot.shipment.pickupTime)} />
              </Card>
            )}
          </>
        )}

        {tab === 'lot' && (
          <Card style={{ paddingHorizontal: 16, paddingVertical: 4 }}>
            <Row label="MÃ LÔ" value={lot.lotCode} mono />
            <Row label="THU HOẠCH" value={dateTime(lot.harvestTime)} />
            <Row label="KHỐI LƯỢNG BAN ĐẦU" value={qty(lot.initialQuantity, lot.unit)} />
            <Row label="HẠN SỬ DỤNG" value={date(lot.expiryDate)} />
            {lot.productionCycle && <Row label="MÙA VỤ" value={lot.productionCycle.cycleCode} mono />}
          </Card>
        )}

        {tab === 'certs' &&
          (lot.certificates.length === 0 ? (
            <Empty title="Chưa có chứng chỉ công khai" body="Doanh nghiệp chưa công khai chứng chỉ nào cho lô này." icon="check" />
          ) : (
            lot.certificates.map((c) => (
              <Card key={c.documentHash} style={{ padding: 16, flexDirection: 'row', gap: 12 }}>
                <Icon name="check" size={28} color={color.green} />
                <View style={{ flex: 1, gap: 2 }}>
                  <T size={16} weight="heavy">
                    {c.type}
                  </T>
                  <T size={14} c={color.muted}>
                    {c.issuer}
                  </T>
                  <T size={14} c={color.muted}>
                    Hiệu lực đến {date(c.expiryDate)}
                  </T>
                </View>
              </Card>
            ))
          ))}

        <T size={13} c={color.muted}>
          Dữ liệu do doanh nghiệp ghi trên AgriTrace, cho biết nguồn gốc và hành trình lô hàng — không phải kết luận về chất lượng.
        </T>
      </View>
    </ScrollView>
  );
}
