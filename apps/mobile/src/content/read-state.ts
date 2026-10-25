import { UUID_PATTERN } from "../api/directory";
import type { HistoryStorage } from "../scan/history";
export const ANNOUNCEMENT_READ_KEY = "agritrace:public-announcement-read:v1";
export function createAnnouncementReadStore(storage: HistoryStorage) {
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>) => {
    const next = pending.then(operation, operation);
    pending = next.catch(() => undefined);
    return next;
  };
  async function load(): Promise<string[]> {
    const raw = await storage.getItem(ANNOUNCEMENT_READ_KEY);
    if (raw === null) return [];
    if (raw.length > 25000)
      throw new Error(
        "Trạng thái đã đọc vượt giới hạn. Có thể đặt lại trên thiết bị.",
      );
    let value: unknown;
    try {
      value = JSON.parse(raw);
    } catch {
      throw new Error(
        "Trạng thái đã đọc bị lỗi. Có thể đặt lại trên thiết bị.",
      );
    }
    if (
      !value ||
      typeof value !== "object" ||
      !("version" in value) ||
      value.version !== 1 ||
      !("ids" in value) ||
      !Array.isArray(value.ids) ||
      value.ids.length > 500 ||
      !value.ids.every((id) => typeof id === "string" && UUID_PATTERN.test(id))
    )
      throw new Error(
        "Trạng thái đã đọc chưa hợp lệ. Có thể đặt lại trên thiết bị.",
      );
    return [...new Set(value.ids as string[])];
  }
  return {
    load: () => serial(load),
    mark: (id: string) =>
      serial(async () => {
        if (!UUID_PATTERN.test(id))
          throw new Error("Mã thông báo chưa hợp lệ.");
        const ids = [id, ...(await load()).filter((item) => item !== id)].slice(
          0,
          500,
        );
        await storage.setItem(
          ANNOUNCEMENT_READ_KEY,
          JSON.stringify({ version: 1, ids }),
        );
        return ids;
      }),
    clear: () =>
      serial(async () => {
        await storage.removeItem(ANNOUNCEMENT_READ_KEY);
        return [];
      }),
  };
}
