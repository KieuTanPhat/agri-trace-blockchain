import { router } from 'expo-router';
import { useState } from 'react';
import { View } from 'react-native';
import { useSession } from '../../../auth/session';
import { Card, Empty, Header, ListItem, Loadable, Screen, SegmentTabs } from '../../../components/staff/ui';
import { dateTime } from '../../../lib/format';
import { transferStatus, type Transfer } from '../../../lib/transfers';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/staff';

const OPEN = ['PROPOSED', 'READY', 'IN_TRANSIT'];

/** Transfers in the employee's scope (a driver sees only the trips it drives). */
export default function Transfers() {
  const { call } = useSession();
  const [tab, setTab] = useState<'open' | 'done'>('open');
  const list = useLoad(() => call<{ items: Transfer[] }>('/distribution/transfers'), [], { key: 'transfers', staleTimeMs: 15_000 });
  useReloadOnFocus(list.reloadIfStale);
  const shown = (list.data?.items ?? []).filter((t) => OPEN.includes(t.status) === (tab === 'open'));
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Vận chuyển" />
      <Screen refreshing={list.loading} onRefresh={() => void list.reload()} bottomInset={96}>
        <SegmentTabs value={tab} onChange={setTab} items={[{ key: 'open', label: 'Đang xử lý' }, { key: 'done', label: 'Đã xong / hủy' }]} />
        <Loadable {...list} reload={() => void list.reload()}>
          {() =>
            shown.length === 0 ? (
              <Card>
                <Empty title="Không có chuyến hàng" icon="truck" />
              </Card>
            ) : (
              <Card style={{ overflow: 'hidden' }}>
                {shown.map((t, i) => {
                  const s = transferStatus(t.status);
                  const goods = t.lines.map((l) => l.productName).filter(Boolean).join(', ');
                  return (
                    <ListItem
                      key={t.id}
                      first={i === 0}
                      icon="truck"
                      t={s.t}
                      title={`${t.origin} → ${t.destination}`}
                      subtitle={`${goods || `${t.lines.length} dòng hàng`} · ${dateTime(t.createdAt)}`}
                      badge={s}
                      onPress={() => router.push(`/staff/transfer/${t.id}`)}
                    />
                  );
                })}
              </Card>
            )
          }
        </Loadable>
      </Screen>
    </View>
  );
}
