import { Tabs } from 'expo-router/tabs';
import { TabBar } from '../../../components/TabBar';

export default function StaffTabs() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (
        <TabBar
          {...props}
          scanHref="/staff/scan"
          scanLabel="Quét mã lô"
          tabs={[
            { route: 'index', label: 'Trang chủ', icon: 'home' },
            { route: 'journal', label: 'Nhật ký', icon: 'journal' },
            { route: 'transfers', label: 'Chuyến hàng', icon: 'truck' },
            { route: 'more', label: 'Thêm', icon: 'more' },
          ]}
        />
      )}
    >
      {/* SDK 58 renders only declared screens. */}
      <Tabs.Screen name="index" />
      <Tabs.Screen name="journal" />
      <Tabs.Screen name="transfers" />
      <Tabs.Screen name="more" />
    </Tabs>
  );
}
