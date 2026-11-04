import { router } from 'expo-router';
import { useState } from 'react';
import { FlatList, View } from 'react-native';
import { useSession } from '../../../auth/session';
import { Button, Card, Empty, GreenHeader, IconTile, Loading, Notice, Pill, SegmentTabs, T } from '../../../components/ui';
import { dateTime } from '../../../lib/format';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

type Task = { transferId: string; action: string; status: string; origin: string; destination: string; role: string; createdAt: string };
const TASK_ACTION: Record<string, string> = {
  CONSENT: 'Đồng thuận bàn giao',
  PICKUP: 'Ký lấy hàng',
  DELIVERY: 'Ký giao nhận hàng',
  ACTUAL_RECEIPT: 'Ghi lượng thực nhận',
  SIGN_RETURN: 'Ký trả hàng (trên Web)',
  RECONCILE_REMAINDER: 'Đối soát hàng còn lại (trên Web)',
};
const ROLE: Record<string, string> = { SENDER: 'Bên gửi', CARRIER: 'Vận chuyển', RECEIVER: 'Bên nhận' };

/** Handovers waiting for this enterprise, the same queue as the Web page. */
export default function Inbound() {
  const { call } = useSession();
  const [tab, setTab] = useState<'receive' | 'all'>('receive');
  const list = useLoad(() => call<{ transfers: Task[] }>('/distribution/tasks'));
  useReloadOnFocus(list.reload);
  const all = list.data?.transfers ?? [];
  const receiving = all.filter((t) => t.role === 'RECEIVER' || (t.role === 'CARRIER' && t.action === 'PICKUP'));
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Hàng chờ nhận" />
      <View style={{ marginTop: 12 }}>
        <SegmentTabs value={tab} onChange={setTab} items={[
          { key: 'receive', label: `Chờ mình nhận (${receiving.length})` },
          { key: 'all', label: `Mọi việc ký (${all.length})` },
        ]} />
      </View>
      {list.loading && !list.data ? (
        <Loading />
      ) : list.error ? (
        <View style={{ padding: 16 }}>
          <Notice kind="error" title={list.error} action={<Button label="Thử tải lại" onPress={() => void list.reload()} />} />
        </View>
      ) : (
        <FlatList
          data={tab === 'receive' ? receiving : all}
          keyExtractor={(t) => `${t.transferId}:${t.action}`}
          onRefresh={() => void list.reload()}
          refreshing={list.loading}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 72 }}
          ListEmptyComponent={<Empty title="Không có hàng chờ nhận" icon="box" />}
          renderItem={({ item }) => (
            <Card style={{ padding: 14, gap: 8 }}>
              <View style={{ flexDirection: 'row', gap: 12, alignItems: 'center' }}>
                <IconTile name="box" t="orange" size={44} glyph={24} />
                <View style={{ flex: 1 }}>
                  <T size={16} weight="heavy">{TASK_ACTION[item.action] ?? item.action}</T>
                  <T size={13} c={color.muted}>{ROLE[item.role] ?? item.role} · {dateTime(item.createdAt)}</T>
                </View>
              </View>
              <T size={14} c={color.inkSoft}>{item.origin} → {item.destination}</T>
              <Pill label={item.status === 'IN_TRANSIT' ? 'Đang vận chuyển' : item.status === 'READY' ? 'Sẵn sàng lấy hàng' : 'Chờ xử lý'} t="orange" />
              <Button label="Mở chuyến hàng" kind="outline" onPress={() => router.push(`/staff/transfer/${item.transferId}`)} />
            </Card>
          )}
        />
      )}
    </View>
  );
}
