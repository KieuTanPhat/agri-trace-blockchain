import { router } from 'expo-router';
import { Pressable, View } from 'react-native';
import type { Schemas } from '../api/client';
import { CYCLE_STATE } from '../lib/labels';
import { color } from '../theme/tokens';
import { Icon } from './Icon';
import { Card, IconTile, Pill, T } from './ui';

export function CycleCard({ cycle, mine }: { cycle: Schemas['CycleListDto']; mine?: boolean }) {
  const state = CYCLE_STATE[cycle.currentState] ?? { label: cycle.currentState, t: 'blue' as const };
  return (
    <Pressable accessibilityRole="button" onPress={() => router.push(`/staff/cycle/${cycle.id}`)}>
      <Card style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12 }}>
        <IconTile name="leaf" t="green" size={56} glyph={30} />
        <View style={{ flex: 1, gap: 3 }}>
          <T size={16} weight="heavy" numberOfLines={1}>
            {cycle.product.productName}
          </T>
          <T size={13.5} c={color.muted} numberOfLines={1}>
            {[cycle.farm.name, cycle.plot?.name].filter(Boolean).join(' · ')}
          </T>
          <View style={{ flexDirection: 'row', gap: 6, flexWrap: 'wrap' }}>
            <Pill label={state.label} t={state.t} />
            {mine && <Pill label="Bạn được giao" t="orange" />}
          </View>
        </View>
        <Icon name="chevron" color={color.faint} />
      </Card>
    </Pressable>
  );
}
