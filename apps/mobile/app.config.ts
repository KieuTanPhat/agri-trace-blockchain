/// <reference types="node" />
import type { ConfigContext, ExpoConfig } from 'expo/config';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

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
  const phoneAuthEnabled = variant !== 'staff' && process.env.EXPO_PUBLIC_CONSUMER_PHONE_AUTH_ENABLED === 'true';
  const googleServicesFile = process.env.GOOGLE_SERVICES_JSON ?? './google-services.json';
  if (phoneAuthEnabled) {
    const firebase = JSON.parse(readFileSync(resolve(__dirname, googleServicesFile), 'utf8')) as { client?: { client_info?: { android_client_info?: { package_name?: string } } }[] };
    if (!firebase.client?.some(c => c.client_info?.android_client_info?.package_name === app.id))
      throw new Error(`Firebase Android package must match ${app.id}. Register that app and download a matching google-services.json before enabling SMS.`);
  }
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
      ...(phoneAuthEnabled ? { googleServicesFile } : {}),
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
      'expo-dev-client',
      'expo-secure-store',
      'expo-font',
      'expo-image',
      ...(phoneAuthEnabled ? ['@react-native-firebase/app', '@react-native-firebase/auth'] : []),
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
    extra: {
      ...config.extra,
      variant: variant ?? null,
      phoneAuthEnabled,
      ...(variant === 'staff' ? {
        eas: { projectId: 'cb18c0d1-d159-4eba-aa45-fd30279bc31a' },
      } : {}),
    },
  };
};
