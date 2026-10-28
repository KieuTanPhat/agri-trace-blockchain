import Constants from 'expo-constants';
import { Image } from 'expo-image';
import { Redirect, router } from 'expo-router';
import { Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Icon } from '../components/Icon';
import { T } from '../components/ui';
import { color, shadow } from '../theme/tokens';

/**
 * A store build has one variant and goes straight to it. The chooser exists
 * only on a local dev server started without EXPO_PUBLIC_APP_VARIANT.
 */
export default function Root() {
  const variant = Constants.expoConfig?.extra?.variant as string | null | undefined;
  if (variant === 'consumer') return <Redirect href="/consumer" />;
  if (variant === 'staff') return <Redirect href="/staff" />;
  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: '#fff', padding: 24, gap: 18, justifyContent: 'center' }}>
      <Image source={require('../../assets/brand/logo-agritrace.webp')} style={{ width: 190, height: 107, alignSelf: 'center' }} contentFit="contain" accessibilityLabel="AgriTrace" />
      <T size={24} weight="heavy" style={{ textAlign: 'center' }}>
        Chọn ứng dụng để xem
      </T>
      <T c={color.muted} style={{ textAlign: 'center' }}>
        Chỉ hiện trên máy chạy thử. Bản cài đặt mở thẳng ứng dụng tương ứng.
      </T>
      {(
        [
          { href: '/consumer', title: 'ACheck', body: 'Người tiêu dùng: quét QR, xem nguồn gốc', icon: 'scan', bg: color.green },
          { href: '/staff', title: 'AgriTrace Nhân viên', body: 'Hiện trường: mùa vụ, thu hoạch, bàn giao', icon: 'leaf', bg: color.orange },
        ] as const
      ).map((app) => (
        <Pressable
          key={app.href}
          accessibilityRole="button"
          onPress={() => router.replace(app.href)}
          style={({ pressed }) => [
            { flexDirection: 'row', alignItems: 'center', gap: 14, padding: 18, borderRadius: 18, backgroundColor: '#fff', borderWidth: 1, borderColor: color.line, opacity: pressed ? 0.85 : 1 },
            shadow.card,
          ]}
        >
          <View style={{ width: 56, height: 56, borderRadius: 16, backgroundColor: app.bg, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name={app.icon} size={30} color="#fff" />
          </View>
          <View style={{ flex: 1 }}>
            <T size={18} weight="heavy">
              {app.title}
            </T>
            <T c={color.muted}>{app.body}</T>
          </View>
          <Icon name="chevron" color={color.faint} />
        </Pressable>
      ))}
    </SafeAreaView>
  );
}
