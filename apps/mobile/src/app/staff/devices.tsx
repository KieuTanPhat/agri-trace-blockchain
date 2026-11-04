import { View } from 'react-native';
import { useSession } from '../../auth/session';
import { Card, Empty, Header, ListItem, Loadable, Screen, Section } from '../../components/staff/ui';
import { dateTime } from '../../lib/format';
import { useLoad, useReloadOnFocus } from '../../lib/useApi';
import { color } from '../../theme/staff';

type Device = {
  id: string;
  name: string;
  type: 'FIELD_SENSOR' | 'GPS_TRACKER';
  status: 'ACTIVE' | 'INACTIVE';
  simulated: boolean;
  online: boolean;
  lastSeenAt: string | null;
  plot: { name: string; farm: { name: string } } | null;
  vehicle: { registration: string } | null;
  runningCycles: { cycleCode: string }[];
  activeTransfer: { origin: string; destination: string } | null;
};

/** Read-only status of field sensors and vehicle GPS; managing them stays on the Web. */
export default function Devices() {
  const { call } = useSession();
  const list = useLoad(() => call<{ items: Device[] }>('/iot/v2/devices'), [], { key: 'devices', staleTimeMs: 30_000 });
  useReloadOnFocus(list.reloadIfStale);
  const group = (type: Device['type']) => (list.data?.items ?? []).filter((d) => d.type === type);
  const row = (d: Device, i: number) => {
    const where =
      d.type === 'FIELD_SENSOR'
        ? [d.plot?.farm.name, d.plot?.name, d.runningCycles.map((c) => c.cycleCode).join(', ')].filter(Boolean).join(' · ')
        : [d.vehicle?.registration, d.activeTransfer ? `${d.activeTransfer.origin} → ${d.activeTransfer.destination}` : 'Không có chuyến đang chạy'].filter(Boolean).join(' · ');
    return (
      <ListItem
        key={d.id}
        first={i === 0}
        icon={d.type === 'FIELD_SENSOR' ? 'signal' : 'location'}
        t={d.status !== 'ACTIVE' ? 'gray' : d.online ? 'green' : 'orange'}
        title={`${d.name}${d.simulated ? ' · mô phỏng' : ''}`}
        subtitle={`${where || 'Chưa gắn'}\n${d.lastSeenAt ? `Tín hiệu ${dateTime(d.lastSeenAt)}` : 'Chưa nhận tín hiệu'}`}
        badge={d.status !== 'ACTIVE' ? { label: 'Ngừng', t: 'gray' } : d.online ? { label: 'Đang kết nối', t: 'green' } : { label: 'Mất kết nối', t: 'orange' }}
      />
    );
  };
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <Header title="Thiết bị IoT" subtitle="Chỉ xem; quản lý thiết bị trên AgriTrace Web" back />
      <Screen refreshing={list.loading} onRefresh={() => void list.reload()}>
        <Loadable {...list} reload={() => void list.reload()}>
          {(data) =>
            data!.items.length === 0 ? (
              <Card>
                <Empty title="Chưa có thiết bị trong phạm vi của bạn" icon="device" />
              </Card>
            ) : (
              <>
                {group('FIELD_SENSOR').length > 0 && <Section title="Cảm biến vùng trồng">{group('FIELD_SENSOR').map(row)}</Section>}
                {group('GPS_TRACKER').length > 0 && <Section title="GPS trên xe">{group('GPS_TRACKER').map(row)}</Section>}
              </>
            )
          }
        </Loadable>
      </Screen>
    </View>
  );
}
