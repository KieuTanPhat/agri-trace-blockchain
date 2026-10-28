import { FlatList, View } from 'react-native';
import type { Schemas } from '../../../api/client';
import { useSession } from '../../../auth/session';
import { CycleCard } from '../../../components/CycleCard';
import { Empty, GreenHeader, Loading, Notice, T } from '../../../components/ui';
import { useLoad } from '../../../lib/useApi';
import { color } from '../../../theme/tokens';

/** All cycles the API lets this account see; write buttons live on the detail. */
export default function Journal() {
  const { user, call } = useSession<Schemas['AuthUserDto']>();
  const cycles = useLoad(() => call<Schemas['CycleListDto'][]>('/production-cycles'));
  return (
    <View style={{ flex: 1, backgroundColor: color.bg }}>
      <GreenHeader title="Nhật ký mùa vụ" />
      {cycles.loading && !cycles.data ? (
        <Loading />
      ) : cycles.error ? (
        <View style={{ padding: 16 }}>
          <Notice kind="error" title={cycles.error} />
        </View>
      ) : (
        <FlatList
          data={cycles.data ?? []}
          keyExtractor={(c) => c.id}
          onRefresh={() => void cycles.reload()}
          refreshing={cycles.loading}
          contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: 72 }}
          ListHeaderComponent={
            <T size={14} c={color.muted} style={{ marginBottom: 4 }}>
              Chọn một vụ để ghi nhật ký chăm sóc hoặc thu hoạch.
            </T>
          }
          ListEmptyComponent={<Empty title="Chưa có mùa vụ" body="Bạn chỉ thấy vụ được giao hoặc thuộc phạm vi quyền của mình." icon="leaf" />}
          renderItem={({ item }) => <CycleCard cycle={item} mine={!!user && (item.staffUserIds ?? []).includes(user.id)} />}
        />
      )}
    </View>
  );
}
