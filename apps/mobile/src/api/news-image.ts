import type { components } from "./generated/api";
import {
  createPublicReader,
  DirectoryApiError,
  UUID_PATTERN,
} from "./directory";

export type NewsImage = components["schemas"]["PublicNewsImageDto"];
const alphabet =
  "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
export function isNewsImage(value: unknown): value is NewsImage {
  if (!value || typeof value !== "object") return false;
  const image = value as Record<string, unknown>;
  if (
    !Number.isInteger(image.width) ||
    !Number.isInteger(image.height) ||
    (image.width as number) < 1 ||
    (image.width as number) > 2048 ||
    (image.height as number) < 1 ||
    (image.height as number) > 2048 ||
    (image.width as number) * (image.height as number) > 4_000_000 ||
    typeof image.dataBase64 !== "string" ||
    image.dataBase64.length < 16 ||
    image.dataBase64.length > 524288 ||
    image.dataBase64.length % 4 !== 0 ||
    !/^[A-Za-z0-9+/]*={0,2}$/.test(image.dataBase64)
  )
    return false;
  const data = image.dataBase64;
  // Decode only the header, without relying on Buffer/Node in Hermes.
  const header: number[] = [];
  for (let offset = 0; offset < Math.min(data.length, 32); offset += 4) {
    const a = alphabet.indexOf(data[offset]),
      b = alphabet.indexOf(data[offset + 1]);
    const c = alphabet.indexOf(data[offset + 2]),
      d = alphabet.indexOf(data[offset + 3]);
    header.push((a << 2) | (b >> 4));
    if (c >= 0) header.push(((b & 15) << 4) | (c >> 2));
    if (d >= 0) header.push(((c & 3) << 6) | d);
  }
  if (image.mimeType === "image/png")
    return [137, 80, 78, 71, 13, 10, 26, 10].every(
      (byte, i) => header[i] === byte,
    );
  if (image.mimeType === "image/jpeg")
    return header[0] === 255 && header[1] === 216 && header[2] === 255;
  if (image.mimeType === "image/webp")
    return (
      String.fromCharCode(...header.slice(0, 4)) === "RIFF" &&
      String.fromCharCode(...header.slice(8, 12)) === "WEBP"
    );
  return false;
}
export function newsImageSource(image: NewsImage): string {
  if (!isNewsImage(image)) throw new DirectoryApiError("Ảnh bìa chưa hợp lệ.");
  return `data:${image.mimeType};base64,${image.dataBase64}`;
}
/** The app never fetches the coverUrl/CDN. Only our API may download it. */
export function createNewsImageClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  timeout = 10000,
) {
  const read = createPublicReader(baseUrl, fetcher, timeout, "ảnh bìa");
  return {
    cover(id: string, signal?: AbortSignal) {
      if (!UUID_PATTERN.test(id))
        throw new DirectoryApiError("Định danh bài viết chưa hợp lệ.");
      return read(
        `news/${encodeURIComponent(id)}/cover`,
        {},
        isNewsImage,
        signal,
      );
    },
  };
}
