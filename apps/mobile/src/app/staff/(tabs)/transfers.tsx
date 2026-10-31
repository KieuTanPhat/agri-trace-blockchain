import { router } from 'expo-router';
import { FlatList, View } from 'react-native';
import { useSession } from '../../../auth/session';
import { Button, Card, Empty, GreenHeader, IconTile, Loading, Notice, Pill, T } from '../../../components/ui';
import { dateTime } from '../../../lib/format';
import { transferStatus, type Transfer } from '../../../lib/transfers';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

/**
 * Transfers in the caller's scope. Signing a handover needs the device's own
 * Ed25519 key registered with the organization; until that step exists on
 * mobile, signatures are made on the Web.
 */
export default function Transfers() {
  const { call } = useSession();
  const list = useLoad(() => call<{ items: Transfer[] }>('/distribution/transfers'));
  useReloadOnFocus(list.reload);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Chuyến hàng" />
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error ? (
        <View style={{ padding: 16 }}>
          <Notice kind="error" title={list.error} action={<Button label="Thử tải lại" onPress={() => void list.reload()} />} />
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
            const s = transferStatus(item.status);
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
                    {item.lines.length} dòng hàng
                  </T>
                </View>
                <Pill label={s.label} t={s.t} />
                <T size={14} c={color.inkSoft}>
                  {item.senderName ?? '—'} → {item.receiverName ?? '—'}
                  {item.carrierName ? ` · Vận chuyển: ${item.carrierName}` : ''}
                </T>
                <T size={14} c={color.muted}>{item.origin} → {item.destination}</T>
                <Button label="Xem chuyến hàng" kind="outline" onPress={() => router.push(`/staff/transfer/${item.id}`)} />
              </Card>
            );
          }}
        />
      )}
    </View>
  );
}
