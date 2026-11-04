import { Tabs } from 'expo-router/tabs';
import { TabBar } from '../../../components/TabBar';
import { staffTabs, useAccess } from '../../../lib/access';

/** Tabs follow the enterprise capabilities; every screen stays declared so
 * the ones not in the bar remain reachable from More. */
export default function StaffTabs() {
  const { access } = useAccess();
  const tabs = staffTabs(access?.capabilities ?? [], access?.permissions ?? []);
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => <TabBar {...props} scanHref="/staff/scan" scanLabel="Quét mã lô" tabs={tabs} />}
    >
      {/* SDK 58 renders only declared screens. */}
      <Tabs.Screen name="index" />
      <Tabs.Screen name="journal" />
      <Tabs.Screen name="inbound" />
      <Tabs.Screen name="sales" />
      <Tabs.Screen name="transfers" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
