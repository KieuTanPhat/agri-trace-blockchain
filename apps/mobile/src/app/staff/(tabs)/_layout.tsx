import { Tabs } from 'expo-router/tabs';
import { TabBar } from '../../../components/staff/TabBar';
import { staffTabs, useAccess } from '../../../lib/access';

/** The bar shows Home, the employee's first two assigned features and More;
 * every screen stays declared so the others open from Home or More. */
export default function StaffTabs() {
  const { features } = useAccess();
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} tabs={staffTabs(features)} />}
    >
      {/* SDK 58 renders only declared screens. */}
      <Tabs.Screen name="index" />
      <Tabs.Screen name="journal" />
      <Tabs.Screen name="tasks" />
      <Tabs.Screen name="stock" />
      <Tabs.Screen name="sales" />
      <Tabs.Screen name="transfers" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
