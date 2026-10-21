import { Tabs } from "expo-router/js-tabs";
import { useReducedMotionPreference } from "../../src/theme/use-reduced-motion";
import { BottomNavigation } from "../../src/components/bottom-navigation";
import { consumerTabs } from "../../src/theme/layout";
import { colors } from "../../src/theme/tokens";
import { tabAnimation } from "../../src/theme/tab-actions";

export default function TabLayout() {
  const reduceMotion = useReducedMotionPreference();
  return (
    <Tabs
      backBehavior="history"
      tabBar={(props) => <BottomNavigation {...props} />}
      screenOptions={{
        headerShown: false,
        animation: tabAnimation(reduceMotion),
        sceneStyle: { backgroundColor: colors.background },
      }}
    >
      {consumerTabs.map(({ name, title }) => (
        <Tabs.Screen key={name} name={name} options={{ title }} />
      ))}
    </Tabs>
  );
}
