import type { ExpoConfig } from "expo/config";

const config: ExpoConfig = {
  name: "ACheck",
  slug: "agritrace-mobile",
  version: "0.1.0",
  scheme: "agritrace",
  orientation: "portrait",
  userInterfaceStyle: "light",
  icon: "./assets/brand/appDaiDien.png",
  ios: { bundleIdentifier: "dev.agritrace.consumer", supportsTablet: true },
  android: {
    package: "dev.agritrace.consumer",
    googleServicesFile: "./google-services.json",
    blockedPermissions: [
      "android.permission.RECORD_AUDIO",
      "android.permission.READ_MEDIA_IMAGES",
      "android.permission.READ_MEDIA_VIDEO",
      "android.permission.ACCESS_FINE_LOCATION",
      "android.permission.ACCESS_COARSE_LOCATION",
    ],
  },
  plugins: [
    "expo-router",
    "@react-native-firebase/app",
    "@react-native-firebase/auth",
    ["expo-secure-store", { configureAndroidBackup: true }],
    [
      "expo-camera",
      {
        cameraPermission:
          "ACheck dùng camera để quét mã QR truy xuất. Hình ảnh không được lưu hoặc tải lên.",
        microphonePermission: false,
        recordAudioAndroid: false,
      },
    ],
  ],
  extra: {
    eas: {
      projectId: "042c1546-e76b-476d-9274-ea70cf376e8e",
    },
  },
  web: { output: "single", favicon: "./assets/brand/appDaiDien.png" },
};

export default config;
