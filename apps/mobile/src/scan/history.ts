import { TOKEN_PATTERN } from "./parse-token";

export const HISTORY_KEY = "agritrace:consumer-trace-history:v1";
export type HistoryEntry = {
  token: string;
  productName: string;
  viewedAt: string;
};
export type HistoryStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<unknown>;
  removeItem(key: string): Promise<unknown>;
};

function valid(value: unknown): value is HistoryEntry {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<HistoryEntry>;
  return (
    typeof entry.token === "string" &&
    TOKEN_PATTERN.test(entry.token) &&
    typeof entry.productName === "string" &&
    entry.productName.length <= 255 &&
    typeof entry.viewedAt === "string" &&
    Number.isFinite(Date.parse(entry.viewedAt))
  );
}

export function createHistoryStore(storage: HistoryStorage) {
  let pending: Promise<unknown> = Promise.resolve();
  const serial = <T>(operation: () => Promise<T>): Promise<T> => {
    const next = pending.then(operation, operation);
    pending = next.catch(() => undefined);
    return next;
  };
  async function load(): Promise<HistoryEntry[]> {
    const raw = await storage.getItem(HISTORY_KEY);
    if (raw === null) return [];
    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      throw new Error(
        "Lịch sử trên thiết bị bị lỗi. Bạn có thể xóa lịch sử để tạo lại.",
      );
    }
    if (
      !decoded ||
      typeof decoded !== "object" ||
      !("version" in decoded) ||
      decoded.version !== 1 ||
      !("items" in decoded) ||
      !Array.isArray(decoded.items) ||
      !decoded.items.every(valid)
    )
      throw new Error(
        "Lịch sử trên thiết bị chưa hợp lệ. Bạn có thể xóa lịch sử để tạo lại.",
      );
    return decoded.items
      .slice(0, 50)
      .map(({ token, productName, viewedAt }) => ({
        token,
        productName,
        viewedAt,
      }));
  }
  return {
    list: () => serial(load),
    add: (input: HistoryEntry) =>
      serial(async () => {
        if (!valid(input))
          throw new Error("Không thể lưu mục lịch sử không hợp lệ.");
        const items = await load();
        const entry = {
          token: input.token,
          productName: input.productName,
          viewedAt: input.viewedAt,
        };
        await storage.setItem(
          HISTORY_KEY,
          JSON.stringify({
            version: 1,
            items: [
              entry,
              ...items.filter((item) => item.token !== entry.token),
            ].slice(0, 50),
          }),
        );
      }),
    clear: () =>
      serial(async () => {
        await storage.removeItem(HISTORY_KEY);
      }),
  };
}
