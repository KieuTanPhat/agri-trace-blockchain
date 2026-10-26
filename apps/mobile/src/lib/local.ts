import AsyncStorage from '@react-native-async-storage/async-storage';

/**
 * The only data kept on the device besides the refresh token: scan history
 * (token, product name, public image URL, time; 50 entries, user-clearable) and the weather
 * province. API responses are never cached here.
 */
export type HistoryItem = { token: string; productName: string; imageUrl?:string; viewedAt: string };
const HISTORY = 'acheck.history.v1';
const PROVINCE = 'acheck.weatherProvince.v1';

export async function readHistory(): Promise<HistoryItem[]> {
  try {
    const parsed = JSON.parse((await AsyncStorage.getItem(HISTORY)) ?? '[]');
    return Array.isArray(parsed) ? parsed.slice(0, 50) : [];
  } catch {
    return [];
  }
}

export async function rememberView(token: string, productName: string,imageUrl?:string) {
  const items = (await readHistory()).filter((item) => item.token !== token);
  items.unshift({ token, productName, ...(imageUrl?{imageUrl}:{}), viewedAt: new Date().toISOString() });
  await AsyncStorage.setItem(HISTORY, JSON.stringify(items.slice(0, 50))).catch(() => undefined);
}

export const clearHistory = () => AsyncStorage.removeItem(HISTORY).catch(() => undefined);

export const readProvince = async () => (await AsyncStorage.getItem(PROVINCE).catch(() => null)) ?? '66';
export const saveProvince = (code: string) => AsyncStorage.setItem(PROVINCE, code).catch(() => undefined);
