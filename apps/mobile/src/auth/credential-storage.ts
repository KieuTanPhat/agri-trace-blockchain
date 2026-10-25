import { isRefreshCredential, type CredentialStorage } from "./native-session";

export interface SecureStorageDriver {
  logoutIntent?: {
    mark(): void;
    read(): boolean;
    clear(): Promise<void>;
  };
  available(): Promise<boolean>;
  get(): Promise<string | null>;
  set(value: string): Promise<void>;
  remove(): Promise<void>;
}
/** Injectable native boundary; the driver must NOT use unencrypted fallback. */
export function createCredentialStorage(
  driver: SecureStorageDriver,
): CredentialStorage {
  async function ready() {
    if (!(await driver.available()))
      throw new Error("Kho bảo mật chưa sẵn sàng trên thiết bị.");
  }
  return {
    markLogoutIntent: driver.logoutIntent
      ? () => driver.logoutIntent!.mark()
      : undefined,
    async read() {
      await ready();
      const raw = await driver.get();
      if (raw === null) {
        // No refresh credential can be restored, so an orphan intent is safe
        // to clear before a new, explicit login.
        await driver.logoutIntent?.clear();
        return null;
      }
      if (raw.length > 1800)
        throw new Error("Không đọc được phiên trong kho bảo mật.");
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        throw new Error("Phiên trong kho bảo mật không hợp lệ.");
      }
      if (!isRefreshCredential(parsed))
        throw new Error("Phiên trong kho bảo mật không hợp lệ.");
      return driver.logoutIntent?.read()
        ? { ...parsed, state: "logoutPending" as const }
        : parsed;
    },
    async write(record) {
      await ready();
      if (!isRefreshCredential(record))
        throw new Error("Không thể lưu phiên không hợp lệ.");
      await driver.set(JSON.stringify(record));
    },
    async clear() {
      await ready();
      await driver.remove();
      // Remove the credential first: a crash must never leave it restorable
      // after the intent has disappeared.
      await driver.logoutIntent?.clear();
    },
  };
}
