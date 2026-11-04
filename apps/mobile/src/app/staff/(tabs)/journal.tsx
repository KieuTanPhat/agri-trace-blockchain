import { useState } from 'react';
import { View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { CycleCard } from '../../../components/CycleCard';
import { Card, Empty, Header, Loadable, Screen, SegmentTabs } from '../../../components/staff/ui';
import { useLoad, useReloadOnFocus } from '../../../lib/useApi';
import { color } from '../../../theme/staff';

const RUNNING = ['CREATED', 'PLANTED', 'GROWING'];

/** Cycles assigned to this employee; care and harvest are recorded from the detail. */
export default function Journal() {
  const { call } = useSession<Schemas['AuthUserDto']>();
  const [tab, setTab] = useState<'running' | 'ended'>('running');
  const cycles = useLoad(() => call<Schemas['CycleListDto'][]>('/production-cycles'), [], { key: 'cycles', staleTimeMs: 20_000 });
  useReloadOnFocus(cycles.reloadIfStale);
  const shown = (cycles.data ?? []).filter((c) => RUNNING.includes(c.currentState) === (tab === 'running'));
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Mùa vụ" subtitle="Nhật ký chăm sóc và thu hoạch" />
      <Screen refreshing={cycles.loading} onRefresh={() => void cycles.reload()} bottomInset={96}>
        <SegmentTabs value={tab} onChange={setTab} items={[{ key: 'running', label: 'Đang làm' }, { key: 'ended', label: 'Đã kết thúc' }]} />
        <Loadable {...cycles} reload={() => void cycles.reload()}>
          {() =>
            shown.length === 0 ? (
              <Card>
                <Empty title={tab === 'running' ? 'Chưa có vụ đang làm' : 'Chưa có vụ đã kết thúc'} body="Bạn chỉ thấy các vụ chủ doanh nghiệp giao cho bạn." icon="leaf" />
              </Card>
            ) : (
              <View>
                {shown.map((c, i) => <CycleCard key={c.id} cycle={c} first={i === 0} />)}
              </View>
            )
          }
        </Loadable>
      </Screen>
    </View>
  );
}
