import { useLocalSearchParams } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { Button, Card, Field, Header, Loadable, Notice, Pill, Row, Screen, Section, T } from '../../../components/staff/ui';
import { useAccess } from '../../../lib/access';
import { dateTime } from '../../../lib/format';
import { CASE_STATUS, CASES_CACHE } from '../../../lib/staff-labels';
import { useCommand } from '../../../lib/use-command';
import { useLoad } from '../../../lib/useApi';
import { color, space } from '../../../theme/staff';

type Case = Schemas['EnterpriseCaseDto'];

/** Read a case, acknowledge it and send the enterprise's response. */
export default function CaseDetail() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { call } = useSession();
  const { can } = useAccess();
  const list = useLoad(() => call<Case[]>('/enterprise-cases'), [], CASES_CACHE);
  const item = list.data?.find((c) => c.id === id) ?? null;
  const { send, busy, message } = useCommand();
  const [note, setNote] = useState('');
  const act = async (action: 'acknowledge' | 'respond') => {
    if (!item) return;
    const ok = await send(() => {
      if (action === 'respond' && note.trim().length < 10) throw new Error('Nội dung phản hồi tối thiểu 10 ký tự.');
      return {
        path: `/enterprise-cases/${item.id}/${action}`,
        label: action === 'acknowledge' ? 'Tiếp nhận sự cố' : 'Phản hồi sự cố',
        detail: `#${item.caseNumber}`,
        body: { version: item.version, ...(note.trim() ? { note: note.trim() } : {}) },
      };
    }, action === 'acknowledge' ? 'Đã tiếp nhận sự cố.' : 'Đã gửi phản hồi.');
    if (ok) {
      setNote('');
      void list.reload();
    }
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title={item ? `Sự cố #${item.caseNumber}` : 'Sự cố'} back />
      <Screen refreshing={list.loading} onRefresh={() => void list.reload()}>
        <Loadable data={item} loading={list.loading} error={list.data && !item ? 'Không tìm thấy sự cố trong phạm vi của bạn' : list.error} reload={() => void list.reload()}>
          {(c) => {
            const s = CASE_STATUS[c!.status] ?? { label: c!.status, t: 'gray' as const };
            return (
              <>
                <Card style={{ padding: space.lg, gap: space.sm }}>
                  <View style={{ flexDirection: 'row', gap: space.sm }}>
                    <Pill label={s.label} t={s.t} />
                    {c!.overdue && <Pill label="Quá hạn" t="red" />}
                  </View>
                  <T size={17} weight="bold">
                    {c!.title}
                  </T>
                  <T size={14} c={color.inkSoft}>
                    {c!.description}
                  </T>
                  <Row first icon="alert" label="Mức độ" value={c!.severity} />
                  <Row icon="info" label="Loại" value={c!.category} />
                  {c!.lot?.lotCode ? <Row icon="box" label="Lô liên quan" value={c!.lot.lotCode} mono /> : null}
                  {c!.responseDueAt ? <Row icon="clock" label="Hạn phản hồi" value={dateTime(c!.responseDueAt)} /> : null}
                </Card>
                {message && <Notice kind={message.kind} title={message.text} />}
                {can('cases.respond') && c!.allowedActions.length > 0 && (
                  <Card style={{ padding: space.lg, gap: space.sm }}>
                    {c!.allowedActions.includes('RESPOND') && (
                      <Field label="Nội dung phản hồi" value={note} onChangeText={setNote} multiline placeholder="Nguyên nhân, biện pháp đã làm…" style={{ minHeight: 88, textAlignVertical: 'top' }} />
                    )}
                    <View style={{ flexDirection: 'row', gap: space.sm }}>
                      {c!.allowedActions.includes('ACKNOWLEDGE') && <Button label="Tiếp nhận" kind="outline" style={{ flex: 1 }} loading={busy} onPress={() => void act('acknowledge')} />}
                      {c!.allowedActions.includes('RESPOND') && <Button label="Gửi phản hồi" style={{ flex: 1 }} loading={busy} onPress={() => void act('respond')} />}
                    </View>
                  </Card>
                )}
                {c!.events.length > 0 && (
                  <Section title="Diễn biến">
                    {c!.events.map((e, i) => (
                      <View key={e.id} style={{ padding: space.md, borderTopWidth: i ? 1 : 0, borderTopColor: color.line, gap: 2 }}>
                        <T size={14} weight="bold">
                          {e.action}
                        </T>
                        {e.note ? (
                          <T size={13.5} c={color.inkSoft}>
                            {e.note}
                          </T>
                        ) : null}
                        <T size={12.5} c={color.muted}>
                          {dateTime(e.createdAt)}
                        </T>
                      </View>
                    ))}
                  </Section>
                )}
              </>
            );
          }}
        </Loadable>
      </Screen>
    </View>
  );
}
