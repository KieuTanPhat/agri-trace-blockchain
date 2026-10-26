import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * One codebase, two store apps. EXPO_PUBLIC_APP_VARIANT picks the build:
 * `consumer` is ACheck, `staff` is the AgriTrace field app. Unset only in a
 * local dev server, where the root screen offers a chooser.
 */
const variant = process.env.EXPO_PUBLIC_APP_VARIANT;

const VARIANTS = {
  consumer: { name: 'ACheck', slug: 'acheck', id: 'vn.agritrace.consumer' },
  staff: {
    name: 'AgriTrace Nhân viên',
    slug: 'agritrace-staff',
    id: 'vn.agritrace.staff',
  },
} as const;

export default ({ config }: ConfigContext): ExpoConfig => {
  const app = VARIANTS[variant === 'staff' ? 'staff' : 'consumer'];
  return {
    ...config,
    name: app.name,
    slug: app.slug,
    scheme: app.slug,
    version: '0.1.0',
    orientation: 'portrait',
    icon: './assets/brand/appDaiDien.png',
    userInterfaceStyle: 'light',
    ios: { bundleIdentifier: app.id, supportsTablet: false },
    android: {
      package: app.id,
      // Credentials live in SecureStore; never restore them from a backup.
      allowBackup: false,
      adaptiveIcon: {
        backgroundColor: '#ffffff',
        foregroundImage: './assets/brand/appDaiDien.png',
      },
    },
    web: { favicon: './assets/brand/appDaiDien.png', bundler: 'metro', output:'single' },
    plugins: [
      'expo-router',
      'expo-secure-store',
      'expo-font',
      'expo-image',
      [
        'expo-camera',
        {
          cameraPermission:
            'Camera chỉ dùng để quét mã QR trên tem nông sản. Bạn vẫn nhập mã tay được nếu từ chối.',
          recordAudioAndroid: false,
        },
      ],
    ],
    experiments: { typedRoutes: false },
    extra: { variant: variant ?? null },
  };
};
