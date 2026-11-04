import { router } from 'expo-router';
import { View } from 'react-native';
import { useSession } from '../../../auth/session';
import { Card, Empty, Header, ListItem, Loadable, Screen } from '../../../components/staff/ui';
import { dateTime } from '../../../lib/format';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/staff';

type MessageList = {
  items: { id: string; subject: string; lastMessageAt: string; preview: string; lastAuthorName: string | null; unread: boolean }[];
  counts: { unread: number };
};

/** Internal messages from the enterprise owner and colleagues. */
export default function Messages() {
  const { call } = useSession();
  const list = useLoad(() => call<MessageList>('/enterprise-messages'), [], { key: 'messages', staleTimeMs: 15_000 });
  useReloadOnFocus(list.reload);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Thông báo nội bộ" subtitle={list.data ? `${list.data.counts.unread} chưa đọc` : undefined} back />
      <Screen refreshing={list.loading} onRefresh={() => void list.reload()}>
        <Loadable {...list} reload={() => void list.reload()}>
          {(data) =>
            data!.items.length === 0 ? (
              <Card>
                <Empty title="Chưa có thông báo" icon="message" />
              </Card>
            ) : (
              <Card style={{ overflow: 'hidden' }}>
                {data!.items.map((m, i) => (
                  <ListItem
                    key={m.id}
                    first={i === 0}
                    icon="message"
                    t={m.unread ? 'blue' : 'gray'}
                    title={m.subject}
                    subtitle={`${m.lastAuthorName ? `${m.lastAuthorName}: ` : ''}${m.preview}\n${dateTime(m.lastMessageAt)}`}
                    badge={m.unread ? { label: 'Chưa đọc', t: 'blue' } : undefined}
                    onPress={() => router.push(`/staff/messages/${m.id}`)}
                  />
                ))}
              </Card>
            )
          }
        </Loadable>
      </Screen>
    </View>
  );
}
