import { router } from 'expo-router';
import { View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { Card, Empty, Header, ListItem, Loadable, Screen } from '../../../components/staff/ui';
import { dateTime } from '../../../lib/format';
import { CASE_STATUS, CASES_CACHE } from '../../../lib/staff-labels';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/staff';

type Case = Schemas['EnterpriseCaseDto'];

/** Cases the platform assigned to this enterprise that this employee may see. */
export default function Cases() {
  const { call } = useSession();
  const list = useLoad(() => call<Case[]>('/enterprise-cases'), [], CASES_CACHE);
  useReloadOnFocus(list.reloadIfStale);
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Sự cố được giao" back />
      <Screen refreshing={list.loading} onRefresh={() => void list.reload()}>
        <Loadable
          {...list}
          reload={() => void list.reload()}
          empty={
            <Card>
              <Empty title="Không có sự cố" icon="incident" />
            </Card>
          }
        >
          {(data) => (
            <Card style={{ overflow: 'hidden' }}>
              {data!.map((c, i) => {
                const s = CASE_STATUS[c.status] ?? { label: c.status, t: 'gray' as const };
                return (
                  <ListItem
                    key={c.id}
                    first={i === 0}
                    icon="incident"
                    t={c.overdue ? 'red' : s.t}
                    title={`#${c.caseNumber} ${c.title}`}
                    subtitle={`${c.lot?.lotCode ? `${c.lot.lotCode} · ` : ''}${c.responseDueAt ? `Hạn phản hồi ${dateTime(c.responseDueAt)}` : dateTime(c.createdAt)}`}
                    badge={c.overdue ? { label: 'Quá hạn', t: 'red' } : s}
                    onPress={() => router.push(`/staff/cases/${c.id}`)}
                  />
                );
              })}
            </Card>
          )}
        </Loadable>
      </Screen>
    </View>
  );
}
