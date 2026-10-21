import type { components } from "./generated/api";
import {
  createPublicReader,
  DirectoryApiError,
  UUID_PATTERN,
  type Page,
} from "./directory";
export type NewsItem = components["schemas"]["PublicNewsDto"];
export type NewsDetail = components["schemas"]["PublicNewsDetailDto"];
export type Announcement = components["schemas"]["PublicAnnouncementDto"];
const object = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown, max: number): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= max;
const date = (value: unknown): value is string =>
  text(value, 35) && Number.isFinite(Date.parse(value));
const id = (value: unknown): value is string =>
  typeof value === "string" && UUID_PATTERN.test(value);
function cover(value: unknown): boolean {
  if (value === null) return true;
  if (!text(value, 2048)) return false;
  try {
    const url = new URL(value);
    return (
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.port &&
      !url.hash
    );
  } catch {
    return false;
  }
}
export function isNews(value: unknown): value is NewsItem {
  return (
    object(value) &&
    id(value.id) &&
    text(value.title, 255) &&
    text(value.summary, 1000) &&
    date(value.publishedAt) &&
    cover(value.coverUrl)
  );
}
export function isArticle(value: unknown): value is NewsDetail {
  return (
    object(value) && isNews(value) && "body" in value && text(value.body, 50000)
  );
}
export function isAnnouncement(value: unknown): value is Announcement {
  return (
    object(value) &&
    id(value.id) &&
    text(value.title, 255) &&
    text(value.body, 5000) &&
    typeof value.severity === "string" &&
    ["INFO", "WARNING", "CRITICAL"].includes(value.severity) &&
    date(value.startsAt) &&
    (value.endsAt === null ||
      (date(value.endsAt) &&
        Date.parse(value.endsAt) > Date.parse(value.startsAt)))
  );
}
export function isContentPage<T extends { id: string }>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is Page<T> {
  if (
    !object(value) ||
    !Array.isArray(value.items) ||
    value.items.length > 50 ||
    !value.items.every(guard) ||
    typeof value.hasMore !== "boolean"
  )
    return false;
  if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
    return false;
  return value.hasMore
    ? value.items.length > 0 &&
        typeof value.nextCursor === "string" &&
        /^[A-Za-z0-9_-]{1,256}$/.test(value.nextCursor)
    : value.nextCursor === null;
}
export function createContentClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  timeout = 12000,
) {
  const read = createPublicReader(
    baseUrl,
    fetcher,
    timeout,
    "bảng tin/thông báo",
  );
  return {
    news: (
      query: { q?: string; cursor?: string; limit?: number } = {},
      signal?: AbortSignal,
    ) =>
      read(
        "news",
        query,
        (value): value is Page<NewsItem> => isContentPage(value, isNews),
        signal,
      ),
    announcements: (
      query: { cursor?: string; limit?: number } = {},
      signal?: AbortSignal,
    ) =>
      read(
        "announcements",
        query,
        (value): value is Page<Announcement> =>
          isContentPage(value, isAnnouncement),
        signal,
      ),
    article: (value: string, signal?: AbortSignal) => {
      if (!id(value))
        throw new DirectoryApiError("Định danh bài viết chưa hợp lệ.");
      return read(
        `news/${encodeURIComponent(value)}`,
        {},
        (body): body is NewsDetail =>
          isArticle(body) && body.id.toLowerCase() === value.toLowerCase(),
        signal,
      );
    },
  };
}
