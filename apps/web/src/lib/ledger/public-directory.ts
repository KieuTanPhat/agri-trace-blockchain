/**
 * Danh bạ công khai cho agritrace.dev: sản phẩm, doanh nghiệp và bảng tin đã
 * được doanh nghiệp/nền tảng công bố. Không cần đăng nhập.
 */
import { useQuery } from "@tanstack/react-query";
import type { components } from "@/lib/generated/api";
import { publicApiUrl, request } from "@/lib/api-client";

type S = components["schemas"];
export type PublicProduct = S["PublicDirectoryProductDto"];
export type PublicProductDetail = S["PublicProductDetailDto"];
export type PublicNews = S["PublicNewsDto"];
export type PublicNewsDetail = S["PublicNewsDetailDto"];
type Page<T> = { items: T[]; hasMore: boolean; nextCursor: string | null };

const get = <T>(path: string) => request<T>(path, undefined, false);

/** Danh bạ sản phẩm nhỏ (vài trăm mục): đọc hết các trang để lọc danh mục tại chỗ. */
async function allProducts(): Promise<PublicProduct[]> {
  const items: PublicProduct[] = [];
  const seen = new Set<string>();
  let cursor: string | null = null;
  for (let i = 0; i < 20; i++) {
    const page: Page<PublicProduct> = await get(`/public/products?limit=50${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""}`);
    for (const p of page.items)
      if (!seen.has(p.id)) {
        seen.add(p.id);
        items.push(p);
      }
    if (!page.hasMore || !page.nextCursor) break;
    cursor = page.nextCursor;
  }
  return items;
}

export const usePublicProducts = () => useQuery({ queryKey: ["public", "products"], queryFn: allProducts, staleTime: 60_000 });

export const usePublicProduct = (id: string) =>
  useQuery({ queryKey: ["public", "product", id], queryFn: () => get<PublicProductDetail>(`/public/products/${encodeURIComponent(id)}?limit=12`), enabled: !!id });

export const usePublicNews = (limit = 12) =>
  useQuery({ queryKey: ["public", "news", limit], queryFn: () => get<Page<PublicNews>>(`/public/news?limit=${limit}`), staleTime: 60_000 });

export async function morePublicNews(cursor: string, limit = 12) {
  return get<Page<PublicNews>>(`/public/news?limit=${limit}&cursor=${encodeURIComponent(cursor)}`);
}

export const usePublicNewsArticle = (id: string) =>
  useQuery({ queryKey: ["public", "news-article", id], queryFn: () => get<PublicNewsDetail>(`/public/news/${encodeURIComponent(id)}`), enabled: !!id });

/** Ảnh bìa bài viết được API trả dạng base64 (ảnh tải lên hoặc ảnh lấy từ liên kết). */
export const useNewsCover = (article: Pick<PublicNews, "id" | "hasCover" | "coverUrl">) =>
  useQuery({
    queryKey: ["public", "news-cover", article.id, article.coverUrl ?? ""],
    queryFn: async () => {
      const v = await get<S["PublicNewsImageDto"]>(`/public/news/${encodeURIComponent(article.id)}/cover`);
      return `data:${v.mimeType};base64,${v.dataBase64}`;
    },
    enabled: article.hasCover || !!article.coverUrl,
    staleTime: Infinity,
    retry: false,
  });

export const productImage = (p: Pick<PublicProduct, "imageUrl">) => (p.imageUrl ? publicApiUrl(p.imageUrl) : null);

type Category = { name: string; count: number; traces: number };

/** Danh mục lấy từ nhóm sản phẩm doanh nghiệp đã công bố, xếp theo số lô truy xuất. */
export function categoriesOf(products: PublicProduct[]): Category[] {
  const map = new Map<string, Category>();
  for (const p of products) {
    if (!p.category) continue;
    const c = map.get(p.category) ?? { name: p.category, count: 0, traces: 0 };
    c.count++;
    c.traces += p.traceCount;
    map.set(p.category, c);
  }
  return [...map.values()].sort((a, b) => b.traces - a.traces || b.count - a.count || a.name.localeCompare(b.name, "vi"));
}

export type Enterprise = { id: string; name: string; logo: string | null; count: number };

/** Doanh nghiệp đứng tên sản phẩm, xếp theo số sản phẩm. */
export function enterprisesOf(products: PublicProduct[]): Enterprise[] {
  const map = new Map<string, Enterprise>();
  for (const p of products) {
    if (!p.enterprise) continue;
    const e = map.get(p.enterprise.id) ?? { id: p.enterprise.id, name: p.enterprise.name, logo: p.enterprise.logoUrl ? publicApiUrl(p.enterprise.logoUrl) : null, count: 0 };
    e.count++;
    map.set(e.id, e);
  }
  return [...map.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "vi"));
}

export const categoryHref = (name: string) => `/products?category=${encodeURIComponent(name)}`;
export const enterpriseHref = (id: string) => `/products?enterprise=${encodeURIComponent(id)}`;
