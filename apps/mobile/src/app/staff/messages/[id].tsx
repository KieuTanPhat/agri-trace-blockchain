import { useLocalSearchParams } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, View } from 'react-native';
import { newIdempotencyKey } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { BottomBar, Button, Card, Field, Header, Loadable, Notice, Screen, T } from '../../../components/staff/ui';
import { dateTime } from '../../../lib/format';
import { useCommand } from '../../../lib/use-command';
import { useLoad } from '../../../lib/useApi';
import { color, space } from '../../../theme/staff';

type Thread = { id: string; subject: string; messages: { id: string; authorName: string | null; body: string; createdAt: string; mine: boolean }[] };

/** One conversation: marks it read on open and sends replies. */
export default function MessageThread() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call } = useSession();
  const thread = useLoad(async () => (await call<{ record: Thread }>(`/enterprise-messages/${encodeURIComponent(id)}`)).record, [id]);
  const { send, busy, message } = useCommand();
  const [body, setBody] = useState('');
  const marked = useRef(false);
  useEffect(() => {
    // Reading is harmless to repeat and not worth queueing; a failure leaves it unread.
    if (!thread.data || marked.current) return;
    marked.current = true;
    void call(`/enterprise-messages/${encodeURIComponent(id)}/read`, { body: {}, idempotencyKey: newIdempotencyKey() }).catch(() => undefined);
  }, [thread.data, call, id]);
  const reply = async () => {
    const text = body.trim();
    const ok = await send(() => {
      if (!text) throw new Error('Nhập nội dung trả lời.');
      return { path: `/enterprise-messages/${id}/replies`, label: 'Trả lời thông báo', detail: thread.data?.subject ?? '', body: { body: text } };
    }, 'Đã gửi trả lời.');
    if (ok) {
      setBody('');
      void thread.reload();
    }
  };
  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title={thread.data?.subject ?? 'Thông báo'} back />
      <Screen refreshing={thread.loading} onRefresh={() => void thread.reload()}>
        <Loadable {...thread} reload={() => void thread.reload()}>
          {(t) => (
            <>
              {t!.messages.map((m) => (
                <View key={m.id} style={{ alignItems: m.mine ? 'flex-end' : 'flex-start' }}>
                  <Card style={{ maxWidth: '88%', padding: space.md, gap: 4, backgroundColor: m.mine ? color.greenTint : color.surface, borderColor: m.mine ? color.greenTint : color.line }}>
                    <T size={12.5} weight="bold" c={color.muted}>
                      {m.mine ? 'Bạn' : m.authorName ?? 'Thành viên'} · {dateTime(m.createdAt)}
                    </T>
                    <T size={14.5}>{m.body}</T>
                  </Card>
                </View>
              ))}
              {message && message.kind !== 'success' && <Notice kind={message.kind} title={message.text} />}
            </>
          )}
        </Loadable>
      </Screen>
      <BottomBar>
        <View style={{ flex: 1 }}>
          <Field label="Trả lời" value={body} onChangeText={setBody} placeholder="Nhập nội dung" multiline />
        </View>
        <Button label="Gửi" loading={busy} disabled={!body.trim()} onPress={() => void reply()} style={{ alignSelf: 'flex-end' }} />
      </BottomBar>
    </KeyboardAvoidingView>
  );
}
