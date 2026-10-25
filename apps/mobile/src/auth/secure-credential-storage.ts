import * as SecureStore from "expo-secure-store";
import { Platform } from "react-native";
import { createCredentialStorage } from "./credential-storage";

const key = "agritrace.consumer.refresh.v1";
const logoutIntentKey = "agritrace.consumer.logout-intent.v1";
const options: SecureStore.SecureStoreOptions = {
  keychainService: "dev.agritrace.consumer.refresh.v1",
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
  requireAuthentication: false,
};
/** No localStorage/AsyncStorage fallback, including the browser preview. */
export const secureCredentialStorage = createCredentialStorage({
  logoutIntent: {
    // No biometrics, network or token read. One tiny synchronous write ensures
    // a native UI crash cannot race ahead of saving the user's logout intent.
    mark: () => SecureStore.setItem(logoutIntentKey, "1", options),
    read: () => {
      const value = SecureStore.getItem(logoutIntentKey, options);
      if (value !== null && value !== "1")
        throw new Error("Dấu đăng xuất trong kho bảo mật không hợp lệ.");
      return value === "1";
    },
    clear: () => SecureStore.deleteItemAsync(logoutIntentKey, options),
  },
  available: async () =>
    Platform.OS !== "web" && (await SecureStore.isAvailableAsync()),
  get: () => SecureStore.getItemAsync(key, options),
  set: (value) => SecureStore.setItemAsync(key, value, options),
  remove: () => SecureStore.deleteItemAsync(key, options),
});
