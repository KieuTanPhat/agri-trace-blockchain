import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color } from '../../theme/staff';
import { Icon, type IconName } from './Icon';
import { T } from './ui';

type TabSpec = { route: string; label: string; icon: IconName };

/** Flat bar with equal slots; scanning is a home shortcut, not a tab. */
export function TabBar({ state, navigateToTab, tabs }: BottomTabBarProps & { tabs: TabSpec[] }) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  return (
    <View
      style={{
        flexDirection: 'row',
        backgroundColor: color.surface,
        paddingBottom: Math.max(insets.bottom, 8),
        paddingTop: 8,
        paddingHorizontal: 8,
        borderTopWidth: 1,
        borderTopColor: color.line,
      }}
    >
      {tabs.map((tab) => {
        const on = current === tab.route;
        return (
          <Pressable
            key={tab.route}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            accessibilityLabel={tab.label}
            onPress={() => {
              const target = state.routes.find((r) => r.name === tab.route);
              if (target && !on) navigateToTab(target.key);
            }}
            style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 58 }}
          >
            <View style={{ minWidth: 54, height: 30, paddingHorizontal: 14, borderRadius: 15, alignItems: 'center', justifyContent: 'center', backgroundColor: on ? color.greenTint : 'transparent' }}>
              <Icon name={tab.icon} size={21} color={on ? color.greenDeep : color.faint} strokeWidth={on ? 2.3 : 1.9} />
            </View>
            <T size={11} weight={on ? 'bold' : 'medium'} c={on ? color.greenDeep : color.muted} numberOfLines={1}>
              {tab.label}
            </T>
          </Pressable>
        );
      })}
    </View>
  );
}
