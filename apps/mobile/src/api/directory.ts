import type { components } from "./generated/api";
import { TOKEN_PATTERN } from "../scan/parse-token";

export type DirectoryProduct =
  components["schemas"]["PublicDirectoryProductDto"];
export type DirectoryEnterprise =
  components["schemas"]["PublicDirectoryEnterpriseDto"];
export type ProductDetail = components["schemas"]["PublicProductDetailDto"];
export type EnterpriseDetail =
  components["schemas"]["PublicEnterpriseDetailDto"];
export type DirectoryCertificate =
  components["schemas"]["PublicDirectoryCertificateDto"];
export type TraceLink = components["schemas"]["PublicTraceLinkDto"];
export type EnterpriseType = DirectoryEnterprise["type"];
export type Page<T> = {
  items: T[];
  nextCursor: string | null;
  hasMore: boolean;
};
export type DirectoryQuery = {
  q?: string;
  cursor?: string;
  limit?: number;
  type?: EnterpriseType;
};
export const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const ENTERPRISE_LABELS: Record<EnterpriseType, string> = {
  FARM: "Nông trại",
  TRANSPORTER: "Vận chuyển",
  RETAILER: "Bán lẻ",
  AUDITOR: "Kiểm định",
  DISTRIBUTOR: "Phân phối",
  PROCESSOR: "Chế biến",
};

export class DirectoryApiError extends Error {
  constructor(
    message: string,
    readonly status?: number,
    readonly requestId?: string,
  ) {
    super(message);
  }
}
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const text = (value: unknown): value is string => typeof value === "string";
const nullableText = (value: unknown) => value === null || text(value);
const identified = (
  value: unknown,
): value is Record<string, unknown> & { id: string } =>
  record(value) && text(value.id) && UUID_PATTERN.test(value.id);
export function isDirectoryProduct(value: unknown): value is DirectoryProduct {
  return (
    identified(value) &&
    text(value.productName) &&
    nullableText(value.variety) &&
    nullableText(value.defaultUnit) &&
    nullableText(value.description)
  );
}
export function isDirectoryEnterprise(
  value: unknown,
): value is DirectoryEnterprise {
  return (
    identified(value) &&
    text(value.name) &&
    text(value.type) &&
    Object.hasOwn(ENTERPRISE_LABELS, value.type)
  );
}
function isTraceLink(value: unknown): value is TraceLink {
  return (
    identified(value) &&
    text(value.lotCode) &&
    text(value.traceToken) &&
    TOKEN_PATTERN.test(value.traceToken)
  );
}
function isCertificate(value: unknown): value is DirectoryCertificate {
  return (
    identified(value) &&
    text(value.type) &&
    text(value.issuer) &&
    text(value.documentHash) &&
    text(value.issueDate) &&
    Number.isFinite(Date.parse(value.issueDate)) &&
    (value.expiryDate === null ||
      (text(value.expiryDate) && Number.isFinite(Date.parse(value.expiryDate))))
  );
}
export function isDirectoryPage<T extends { id: string }>(
  value: unknown,
  guard: (item: unknown) => item is T,
): value is Page<T> {
  if (
    !record(value) ||
    !Array.isArray(value.items) ||
    value.items.length > 50 ||
    !value.items.every(guard) ||
    typeof value.hasMore !== "boolean"
  )
    return false;
  if (new Set(value.items.map((item) => item.id)).size !== value.items.length)
    return false;
  return value.hasMore
    ? text(value.nextCursor) &&
        UUID_PATTERN.test(value.nextCursor) &&
        value.items.at(-1)?.id === value.nextCursor
    : value.nextCursor === null;
}
export function isProductDetail(value: unknown): value is ProductDetail {
  if (!record(value)) return false;
  const { enterprises, lots } = value;
  return (
    isDirectoryProduct(value) &&
    isDirectoryPage(enterprises, isDirectoryEnterprise) &&
    isDirectoryPage(lots, isTraceLink)
  );
}
export function isEnterpriseDetail(value: unknown): value is EnterpriseDetail {
  if (!record(value)) return false;
  const { products, certificates } = value;
  return (
    isDirectoryEnterprise(value) &&
    isDirectoryPage(products, isDirectoryProduct) &&
    isDirectoryPage(certificates, isCertificate)
  );
}
export function mergeDirectoryItems<T extends { id: string }>(
  previous: T[],
  incoming: T[],
): T[] {
  const items = new Map(previous.map((item) => [item.id, item]));
  for (const item of incoming) items.set(item.id, item);
  return [...items.values()];
}
function queryString(query: Record<string, string | number | undefined>) {
  return Object.entries(query)
    .filter(([, value]) => value !== undefined && value !== "")
    .map(
      ([key, value]) =>
        `${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`,
    )
    .join("&");
}
function validId(id: string) {
  if (!UUID_PATTERN.test(id))
    throw new DirectoryApiError(
      "Định danh chưa hợp lệ. Vui lòng quay lại danh sách.",
    );
  return encodeURIComponent(id);
}

export function createPublicReader(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 12000,
  label = "danh mục",
) {
  async function get<T>(
    path: string,
    query: Record<string, string | number | undefined>,
    guard: (value: unknown) => value is T,
    signal?: AbortSignal,
  ): Promise<T> {
    const controller = new AbortController();
    const cancel = () => controller.abort();
    signal?.addEventListener("abort", cancel, { once: true });
    if (signal?.aborted) cancel();
    const timer = setTimeout(cancel, timeoutMs);
    try {
      const suffix = queryString(query);
      const response = await fetcher(
        `${baseUrl}/public/${path}${suffix ? `?${suffix}` : ""}`,
        {
          method: "GET",
          headers: { Accept: "application/json" },
          cache: "no-store",
          credentials: "omit",
          redirect: "error",
          signal: controller.signal,
        },
      );
      if (response.redirected)
        throw new DirectoryApiError(
          "Máy chủ trả về chuyển hướng không được hỗ trợ.",
        );
      const body: unknown = await response.json().catch(() => null);
      const requestId =
        record(body) && text(body.requestId) ? body.requestId : undefined;
      if (!response.ok)
        throw new DirectoryApiError(
          response.status === 404
            ? "Thông tin không tồn tại hoặc không còn được công khai."
            : response.status === 429
              ? "Bạn thao tác quá nhanh. Vui lòng đợi một lát rồi thử lại."
              : `Chưa lấy được ${label}. Vui lòng thử lại sau.`,
          response.status,
          requestId,
        );
      if (!record(body) || body.success !== true || !guard(body.data))
        throw new DirectoryApiError(
          `Dữ liệu ${label} chưa hợp lệ. Vui lòng thử lại sau.`,
          undefined,
          requestId,
        );
      return body.data;
    } catch (error) {
      if (error instanceof DirectoryApiError || signal?.aborted) throw error;
      throw new DirectoryApiError(
        "Không kết nối được máy chủ hoặc yêu cầu đã hết thời gian. Kiểm tra mạng rồi thử lại.",
      );
    } finally {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    }
  }
  return get;
}
export function createDirectoryClient(
  baseUrl: string,
  fetcher: typeof fetch = fetch,
  timeoutMs = 12000,
) {
  const get = createPublicReader(baseUrl, fetcher, timeoutMs);
  return {
    products: (
      query: Omit<DirectoryQuery, "type"> = {},
      signal?: AbortSignal,
    ) =>
      get(
        "products",
        query,
        (value): value is Page<DirectoryProduct> =>
          isDirectoryPage(value, isDirectoryProduct),
        signal,
      ),
    enterprises: (query: DirectoryQuery = {}, signal?: AbortSignal) =>
      get(
        "enterprises",
        query,
        (value): value is Page<DirectoryEnterprise> =>
          isDirectoryPage(value, isDirectoryEnterprise),
        signal,
      ),
    product: (
      id: string,
      query: {
        limit?: number;
        enterpriseCursor?: string;
        lotCursor?: string;
      } = {},
      signal?: AbortSignal,
    ) =>
      get(
        `products/${validId(id)}`,
        query,
        (value): value is ProductDetail =>
          isProductDetail(value) && value.id.toLowerCase() === id.toLowerCase(),
        signal,
      ),
    enterprise: (
      id: string,
      query: {
        limit?: number;
        productCursor?: string;
        certificateCursor?: string;
      } = {},
      signal?: AbortSignal,
    ) =>
      get(
        `enterprises/${validId(id)}`,
        query,
        (value): value is EnterpriseDetail =>
          isEnterpriseDetail(value) &&
          value.id.toLowerCase() === id.toLowerCase(),
        signal,
      ),
  };
}
