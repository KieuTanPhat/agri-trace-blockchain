import { Tabs } from 'expo-router/tabs';
import { TabBar } from '../../../components/TabBar';

export default function ConsumerTabs() {
  return (
    <Tabs
      screenOptions={{ headerShown: false }}
      tabBar={(props) => (
        <TabBar
          {...props}
          scanHref="/consumer/scan"
          scanLabel="Quét mã QR"
          tabs={[
            { route: 'index', label: 'Trang chủ', icon: 'home' },
            { route: 'enterprises', label: 'Doanh nghiệp', icon: 'building' },
            { route: 'products', label: 'Sản phẩm', icon: 'box' },
            { route: 'account', label: 'Tài khoản', icon: 'user' },
          ]}
        />
      )}
    >
      {/* SDK 58 renders only declared screens. */}
      <Tabs.Screen name="index" />
      <Tabs.Screen name="enterprises" />
      <Tabs.Screen name="products" />
      <Tabs.Screen name="account" />
    </Tabs>
  );
}
