import { router } from 'expo-router';
import type { BottomTabBarProps } from 'expo-router/tabs';
import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { color } from '../theme/tokens';
import { Icon, type IconName } from './Icon';
import { T } from './ui';

export type TabSpec = { route: string; label: string; icon: IconName };

/**
 * Five-slot bar with the raised green scan button in the middle, as in the
 * reference apps. `scanHref` opens a stack screen, not a tab.
 */
export function TabBar({
  state,
  navigateToTab,
  tabs,
  scanHref,
  scanLabel,
}: BottomTabBarProps & { tabs: TabSpec[]; scanHref: string; scanLabel: string }) {
  const insets = useSafeAreaInsets();
  const current = state.routes[state.index]?.name;
  const item = (tab: TabSpec) => {
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
        style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 3, minHeight: 56 }}
      >
        <Icon name={tab.icon} size={26} color={on ? color.green : '#7a8494'} />
        <T size={12} weight="bold" c={on ? color.green : '#6b7686'} numberOfLines={1}>
          {tab.label}
        </T>
      </Pressable>
    );
  };
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        backgroundColor: '#fff',
        paddingBottom: Math.max(insets.bottom, 10),
        paddingTop: 6,
        shadowColor: '#101828',
        shadowOpacity: 0.08,
        shadowRadius: 16,
        shadowOffset: { width: 0, height: -4 },
        elevation: 12,
      }}
    >
      {tabs.slice(0, 2).map(item)}
      <View style={{ flex: 1, alignItems: 'center' }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={scanLabel}
          onPress={() => router.push(scanHref as never)}
          style={({ pressed }) => ({
            width: 66,
            height: 66,
            marginTop: -34,
            borderRadius: 33,
            backgroundColor: color.green,
            borderWidth: 5,
            borderColor: '#fff',
            alignItems: 'center',
            justifyContent: 'center',
            transform: [{ scale: pressed ? 0.95 : 1 }],
            shadowColor: color.green,
            shadowOpacity: 0.35,
            shadowRadius: 12,
            shadowOffset: { width: 0, height: 8 },
            elevation: 8,
          })}
        >
          <Icon name="scan" size={30} color="#fff" />
        </Pressable>
      </View>
      {tabs.slice(2).map(item)}
    </View>
  );
}
