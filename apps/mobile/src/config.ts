export function apiBaseUrl(
  value: string | undefined,
  development: boolean,
): string {
  if (!value)
    throw new Error(
      "Chưa cấu hình địa chỉ API. Xem hướng dẫn trong apps/mobile/README.md.",
    );
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Địa chỉ API chưa hợp lệ.");
  }
  if (
    url.username ||
    url.password ||
    url.search ||
    url.hash ||
    !/^\/api\/?$/.test(url.pathname) ||
    (url.protocol !== "https:" && !(development && url.protocol === "http:"))
  )
    throw new Error(
      "API cần HTTPS và đường dẫn kết thúc bằng /api. HTTP chỉ dành cho bản phát triển.",
    );
  return url.toString().replace(/\/$/, "");
}

export const traceOrigin =
  process.env.EXPO_PUBLIC_TRACE_ORIGIN ?? "https://agritrace.dev";
