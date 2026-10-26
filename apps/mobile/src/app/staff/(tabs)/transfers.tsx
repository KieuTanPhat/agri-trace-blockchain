import { FlatList, View } from 'react-native';
import { useSession } from '../../../auth/session';
import { Card, Empty, GreenHeader, IconTile, Loading, Notice, Pill, T } from '../../../components/ui';
import { dateTime, qty } from '../../../lib/format';
import { useLoad } from '../../../lib/useApi';
import { color, type Tone } from '../../../theme/tokens';

type Transfer = {
  id: string;
  status: string;
  origin: string;
  destination: string;
  createdAt: string;
  senderName?: string;
  carrierName?: string;
  receiverName?: string;
  lines: { id: string; quantity: string; unit: string; productName?: string; lotCode?: string }[];
};

const STATUS: Record<string, { label: string; t: Tone }> = {
  PROPOSED: { label: 'Chờ ký gửi', t: 'orange' },
  ACCEPTED: { label: 'Đã nhận ký', t: 'blue' },
  IN_TRANSIT: { label: 'Đang vận chuyển', t: 'blue' },
  RECEIVED: { label: 'Đã nhận hàng', t: 'green' },
  RETURNED: { label: 'Đã trả lại', t: 'purple' },
  CANCELLED: { label: 'Đã hủy', t: 'red' },
};

/**
 * Transfers in the caller's scope. Signing a handover needs the device's own
 * Ed25519 key registered with the organization; until that step exists on
 * mobile, signatures are made on the Web.
 */
export default function Transfers() {
  const { call } = useSession();
  const list = useLoad(() => call<{ items: Transfer[] }>('/distribution/transfers'));
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Chuyến hàng" />
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error ? (
        <View style={{ padding: 16 }}>
          <Notice kind="error" title={list.error} />
        </View>
      ) : (
        <FlatList
          data={list.data?.items ?? []}
          keyExtractor={(t) => t.id}
          onRefresh={() => void list.reload()}
          refreshing={list.loading}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 72 }}
          ListHeaderComponent={<Notice kind="info" title="Ký bàn giao trên Web" body="Ứng dụng chưa có khóa ký trên máy. Bạn xem được chuyến hàng; ký gửi và ký nhận làm trên AgriTrace Web." />}
          ListEmptyComponent={<Empty title="Chưa có chuyến hàng" icon="truck" />}
          renderItem={({ item }) => {
            const s = STATUS[item.status] ?? { label: item.status, t: 'blue' as const };
            const total = item.lines.reduce((sum, l) => sum + Number(l.quantity), 0);
            return (
              <Card style={{ padding: 14, gap: 10 }}>
                <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                  <IconTile name="truck" t="blue" size={48} glyph={26} />
                  <View style={{ flex: 1 }}>
                    <T size={16} weight="heavy" numberOfLines={1}>
                      {item.lines.map((l) => l.productName).filter(Boolean).join(', ') || 'Chuyến hàng'}
                    </T>
                    <T size={13.5} c={color.muted}>
                      {dateTime(item.createdAt)}
                    </T>
                  </View>
                  <T size={16} weight="heavy" c={color.green}>
                    {qty(total, item.lines[0]?.unit)}
                  </T>
                </View>
                <Pill label={s.label} t={s.t} />
                <T size={14} c={color.inkSoft}>
                  {item.senderName ?? '—'} → {item.receiverName ?? '—'}
                  {item.carrierName ? ` · Vận chuyển: ${item.carrierName}` : ''}
                </T>
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}
