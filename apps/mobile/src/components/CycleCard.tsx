import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { Schemas } from '../api/client';
import { DirectoryPhoto } from './DirectoryCards';
import { CYCLE_STATE } from '../lib/labels';
import { Icon } from './staff/Icon';
import { Pill, T } from './staff/ui';
import { color, radius, shadow, space } from '../theme/staff';

/** One cycle row; employees only ever receive the cycles they are assigned. */
export function CycleCard({ cycle, first }: { cycle: Schemas['CycleListDto']; first?: boolean }) {
  const state = CYCLE_STATE[cycle.currentState] ?? { label: cycle.currentState, t: 'blue' as const };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Mở mùa vụ ${cycle.product.productName}, ${state.label}`}
      onPress={() => router.push(`/staff/cycle/${cycle.id}`)}
      style={({ pressed }) => [
        shadow.card,
        {
          flexDirection: 'row',
          alignItems: 'center',
          gap: space.md,
          padding: space.md,
          borderRadius: radius.xl,
          borderWidth: 1,
          borderColor: color.line,
          backgroundColor: color.surface,
          opacity: pressed ? 0.78 : 1,
          marginTop: first ? 0 : space.sm,
        },
      ]}
    >
      <View style={{ width: 68, height: 68, borderRadius: 16, overflow: 'hidden', backgroundColor: color.greenTint }}>
        <DirectoryPhoto url={`/public/products/${cycle.product.id}/image`} label={cycle.product.productName} fit="cover" />
      </View>
      <View style={{ flex: 1, gap: 5 }}>
        <T size={14.5} weight="bold" numberOfLines={1}>
          {cycle.product.productName}
        </T>
        <T size={12} c={color.inkSoft} numberOfLines={1}>
          {cycle.farm.name}{cycle.plot?.name ? ` · ${cycle.plot.name}` : ''}
        </T>
        <T size={11.5} c={color.muted} numberOfLines={1}>
          {cycle.cycleCode}
        </T>
      </View>
      <View style={{ alignItems: 'flex-end', gap: 7 }}>
        <Pill label={state.label} t={state.t} />
        <Icon name="chevron" size={17} color={color.faint} />
      </View>
    </Pressable>
  );
}
