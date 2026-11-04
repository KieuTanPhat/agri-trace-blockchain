import { router } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../../../auth/session';
import { Card, Empty, Header, ListItem, Loadable, Screen, Section } from '../../../components/staff/ui';
import { dateTime } from '../../../lib/format';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/staff';
import type { Tone } from '../../../theme/staff';

type Task = { transferId: string; action: string; status: string; origin: string; destination: string; role: string; createdAt: string };
const ACTION: Record<string, { label: string; t: Tone; web?: boolean }> = {
  CONSENT: { label: 'Ký xác nhận', t: 'orange' },
  PICKUP: { label: 'Ký lấy hàng', t: 'blue' },
  DELIVERY: { label: 'Ký giao nhận', t: 'green' },
  ACTUAL_RECEIPT: { label: 'Ghi lượng thực nhận', t: 'purple' },
  SIGN_RETURN: { label: 'Ký trả hàng · làm trên Web', t: 'gray', web: true },
  RECONCILE_REMAINDER: { label: 'Đối soát phần còn lại · làm trên Web', t: 'gray', web: true },
};
const ROLE: Record<string, string> = { SENDER: 'Bên giao', CARRIER: 'Bên chở', RECEIVER: 'Bên nhận' };

/** Signing work waiting for this employee, the same queue as the Web page. */
export default function Tasks() {
  const { call } = useSession();
  const list = useLoad(() => call<{ transfers: Task[] }>('/distribution/tasks'), [], { key: 'tasks', staleTimeMs: 15_000 });
  useReloadOnFocus(list.reload);
  const all = list.data?.transfers ?? [];
  const mine = all.filter((t) => !ACTION[t.action]?.web);
  const web = all.filter((t) => ACTION[t.action]?.web);
  const row = (t: Task, i: number) => {
    const a = ACTION[t.action] ?? { label: t.action, t: 'gray' as const };
    return (
      <ListItem
        key={`${t.transferId}:${t.action}`}
        first={i === 0}
        icon="truck"
        t={a.t}
        title={`${t.origin} → ${t.destination}`}
        subtitle={`${ROLE[t.role] ?? t.role} · ${dateTime(t.createdAt)}`}
        badge={{ label: a.label, t: a.t }}
        onPress={() => router.push(`/staff/transfer/${t.transferId}`)}
      />
    );
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Việc ký" subtitle="Mở chuyến để kiểm tra và ký bằng khóa trên máy" />
      <Screen refreshing={list.loading} onRefresh={() => void list.reload()} bottomInset={96}>
        <Loadable {...list} reload={() => void list.reload()}>
          {() =>
            all.length === 0 ? (
              <Card>
                <Empty title="Không có việc ký" body="Yêu cầu xác nhận chuyến sẽ hiện ở đây." icon="tasks" />
              </Card>
            ) : (
              <>
                {mine.length > 0 && <Section title={`Cần bạn ký (${mine.length})`}>{mine.map(row)}</Section>}
                {web.length > 0 && <Section title="Làm trên AgriTrace Web">{web.map(row)}</Section>}
              </>
            )
          }
        </Loadable>
      </Screen>
    </View>
  );
}
