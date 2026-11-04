import { router } from 'expo-router';
import type { Schemas } from '../api/client';
import { CYCLE_STATE } from '../lib/labels';
import { ListItem } from './staff/ui';

/** One cycle row; employees only ever receive the cycles they are assigned. */
export function CycleCard({ cycle, first }: { cycle: Schemas['CycleListDto']; first?: boolean }) {
  const state = CYCLE_STATE[cycle.currentState] ?? { label: cycle.currentState, t: 'blue' as const };
  return (
    <ListItem
      first={first}
      icon="leaf"
      t="green"
      title={cycle.product.productName}
      subtitle={[cycle.cycleCode, cycle.farm.name, cycle.plot?.name].filter(Boolean).join(' · ')}
      badge={state}
      onPress={() => router.push(`/staff/cycle/${cycle.id}`)}
    />
  );
}
