"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, ArrowRight, LayoutGrid, RotateCcw } from "lucide-react";
import type { components } from "@/lib/generated/api";
import { pt } from "@/lib/ledger/public-i18n";
import { publicApiAssetUrl, publicRequest } from "@/lib/public-api";

type Product = components["schemas"]["PublicDirectoryProductDto"];
type ProductPage = components["schemas"]["PublicProductsPageDto"];
const PAGE_SIZE = 12;

function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/đ/g, "d")
    .toLocaleLowerCase("vi");
}

function ProductPhoto({ product }: { product: Product }) {
  return (
    <div className="relative aspect-[4/3] overflow-hidden bg-brand-weak">
      {product.imageUrl ? (
        <Image
          unoptimized
          fill
          sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 25vw"
          src={publicApiAssetUrl(product.imageUrl)}
          alt={`Ảnh ${product.productName}`}
          className="object-cover"
        />
      ) : (
        <div className="flex size-full items-center justify-center text-brand/45">
          <LayoutGrid aria-hidden className="size-9" />
        </div>
      )}
    </div>
  );
}

function ProductCard({ product }: { product: Product }) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-card transition-shadow hover:shadow-md">
      <ProductPhoto product={product} />
      <div className="flex min-h-36 flex-col gap-2 p-3">
        <div className="flex items-start justify-between gap-2">
          <h2 className="line-clamp-2 text-[15px] font-semibold">{product.productName}</h2>
          <span className={`shrink-0 text-[11px] font-semibold ${product.saleStatus === "SELLING" ? "text-emerald-700" : "text-ink-2"}`}>
            {product.saleStatus === "SELLING" ? pt("Đang bán") : pt("Chưa bán")}
          </span>
        </div>
        {product.variety && <p className="truncate text-[13px] text-ink-2">{product.variety}</p>}
        <div className="mt-auto flex items-end justify-between gap-2 text-[12px] text-ink-2">
          <span className="truncate">{product.category ?? product.province ?? pt("Nông sản")}</span>
          <span className="shrink-0">{product.traceCount} {pt("lô truy xuất")}</span>
        </div>
        {product.price && (
          <p className="text-[13px] font-semibold text-brand">
            {Number(product.price).toLocaleString("vi-VN")} ₫{product.defaultUnit ? ` / ${product.defaultUnit}` : ""}
          </p>
        )}
      </div>
    </article>
  );
}

function Pages({ current, count, onChange }: { current: number; count: number; onChange: (page: number) => void }) {
  if (count < 2) return null;
  return (
    <nav aria-label={pt("Phân trang sản phẩm")} className="flex flex-wrap items-center justify-center gap-2 py-6">
      <button
        type="button"
        aria-label={pt("Trang trước")}
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
        className="inline-flex h-10 items-center gap-1 rounded-md border border-line bg-card px-3 text-sm disabled:cursor-not-allowed disabled:opacity-45"
      >
        <ArrowLeft aria-hidden className="size-4" /> {pt("Trước")}
      </button>
      {Array.from({ length: count }, (_, index) => index + 1).map((page) => (
        <button
          type="button"
          key={page}
          aria-label={pt("Trang {page}", { page })}
          aria-current={current === page ? "page" : undefined}
          onClick={() => onChange(page)}
          className={`size-10 rounded-md border text-sm font-medium ${current === page ? "border-brand bg-brand text-white" : "border-line bg-card hover:bg-brand-weak"}`}
        >
          {page}
        </button>
      ))}
      <button
        type="button"
        aria-label={pt("Trang sau")}
        disabled={current === count}
        onClick={() => onChange(current + 1)}
        className="inline-flex h-10 items-center gap-1 rounded-md border border-line bg-card px-3 text-sm disabled:cursor-not-allowed disabled:opacity-45"
      >
        {pt("Sau")} <ArrowRight aria-hidden className="size-4" />
      </button>
    </nav>
  );
}

export function ProductDirectory() {
  const [products, setProducts] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState("");
  const [province, setProvince] = useState("");
  const [sellingOnly, setSellingOnly] = useState(false);
  const [sort, setSort] = useState("traces");
  const [page, setPage] = useState(1);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const all: Product[] = [];
      const seen = new Set<string>();
      const seenCursors = new Set<string>();
      let cursor: string | null = null;
      while (true) {
        const params = new URLSearchParams({ limit: "50" });
        if (cursor) params.set("cursor", cursor);
        const result = await publicRequest<ProductPage>(`/public/products?${params}`);
        for (const product of result.items) {
          if (!seen.has(product.id)) {
            all.push(product);
            seen.add(product.id);
          }
        }
        if (!result.hasMore || !result.nextCursor || seenCursors.has(result.nextCursor)) break;
        seenCursors.add(result.nextCursor);
        cursor = result.nextCursor;
      }
      setProducts(all);
    } catch (cause) {
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : pt("Không tải được danh sách sản phẩm."));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => setPage(1), [query, category, province, sellingOnly, sort]);

  const categories = useMemo(() => [...new Set(products.map((item) => item.category).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "vi")), [products]);
  const provinces = useMemo(() => [...new Set(products.map((item) => item.province).filter((value): value is string => !!value))].sort((a, b) => a.localeCompare(b, "vi")), [products]);
  const filtered = useMemo(() => {
    const needle = normalize(query.trim());
    const rows = products.filter((product) =>
      (!needle || normalize(`${product.productName} ${product.variety ?? ""}`).includes(needle)) &&
      (!category || product.category === category) &&
      (!province || product.province === province) &&
      (!sellingOnly || product.saleStatus === "SELLING"),
    );
    return rows.sort((a, b) => {
      if (sort === "name") return a.productName.localeCompare(b.productName, "vi");
      if (sort === "newest") return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      if (sort === "price-asc") return (a.price == null ? Infinity : Number(a.price)) - (b.price == null ? Infinity : Number(b.price));
      if (sort === "price-desc") return (b.price == null ? -Infinity : Number(b.price)) - (a.price == null ? -Infinity : Number(a.price));
      return b.traceCount - a.traceCount || a.productName.localeCompare(b.productName, "vi");
    });
  }, [products, query, category, province, sellingOnly, sort]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const visible = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);
  const firstItem = filtered.length ? (page - 1) * PAGE_SIZE + 1 : 0;
  const lastItem = Math.min(page * PAGE_SIZE, filtered.length);

  return (
    <main className="pub-site min-h-[70vh] bg-canvas py-8 sm:py-10">
      <div className="mx-auto grid max-w-[1280px] gap-7 px-4 sm:px-7 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="flex flex-col gap-7">
          <div>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-2">{pt("Danh mục")}</h2>
            <label className="sr-only" htmlFor="product-category">{pt("Danh mục sản phẩm")}</label>
            <select id="product-category" value={category} onChange={(event) => setCategory(event.target.value)} className="h-11 w-full rounded-md border border-line bg-card px-3 text-sm">
              <option value="">{pt("Tất cả danh mục")}</option>
              {categories.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <div>
            <h2 className="mb-3 text-xs font-bold uppercase tracking-wide text-ink-2">{pt("Tỉnh / thành")}</h2>
            <label className="sr-only" htmlFor="product-province">{pt("Tỉnh / thành")}</label>
            <select id="product-province" value={province} onChange={(event) => setProvince(event.target.value)} className="h-11 w-full rounded-md border border-line bg-card px-3 text-sm">
              <option value="">{pt("Tất cả")}</option>
              {provinces.map((value) => <option key={value} value={value}>{value}</option>)}
            </select>
          </div>
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={sellingOnly} onChange={(event) => setSellingOnly(event.target.checked)} className="size-4 accent-brand" />
            {pt("Đang bán")}
          </label>
          {(category || province || sellingOnly || query) && (
            <button type="button" onClick={() => { setCategory(""); setProvince(""); setSellingOnly(false); setQuery(""); }} className="inline-flex items-center gap-2 self-start text-sm font-medium text-brand hover:underline">
              <RotateCcw aria-hidden className="size-4" /> {pt("Xóa bộ lọc")}
            </button>
          )}
        </aside>

        <section aria-labelledby="products-heading" className="min-w-0">
          <div className="mb-6 flex flex-col gap-3">
            <h1 id="products-heading" className="text-2xl font-semibold sm:text-3xl">{pt("Sản phẩm nông sản")}</h1>
            <div className="flex flex-col gap-3 sm:flex-row">
              <label className="sr-only" htmlFor="product-search">{pt("Tìm sản phẩm")}</label>
              <input id="product-search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder={pt("Tìm sản phẩm, giống")} className="h-11 min-w-0 flex-1 rounded-md border border-line bg-card px-4 text-sm outline-none focus:border-brand focus:ring-2 focus:ring-brand/15" />
              <label className="sr-only" htmlFor="product-sort">{pt("Sắp xếp sản phẩm")}</label>
              <select id="product-sort" value={sort} onChange={(event) => setSort(event.target.value)} className="h-11 rounded-md border border-line bg-card px-3 text-sm">
                <option value="traces">{pt("Nhiều lô truy xuất")}</option>
                <option value="newest">{pt("Mới nhất")}</option>
                <option value="name">{pt("Tên A–Z")}</option>
                <option value="price-asc">{pt("Giá thấp đến cao")}</option>
                <option value="price-desc">{pt("Giá cao đến thấp")}</option>
              </select>
            </div>
            {!loading && !error && <p className="text-sm text-ink-2">{pt("Hiển thị {from}–{to} trong {count} sản phẩm", { from: firstItem, to: lastItem, count: filtered.length })}</p>}
          </div>

          {loading ? (
            <p role="status" className="rounded-xl border border-line bg-card p-8 text-center text-ink-2">{pt("Đang tải sản phẩm…")}</p>
          ) : error ? (
            <div role="alert" className="rounded-xl border border-red-200 bg-card p-6 text-center">
              <p className="text-sm text-red-700">{error}</p>
              <button type="button" onClick={() => void load()} className="mt-3 rounded-md border border-line px-4 py-2 text-sm font-medium">{pt("Thử lại")}</button>
            </div>
          ) : visible.length ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:gap-5 xl:grid-cols-3 2xl:grid-cols-4">
                {visible.map((product) => <ProductCard key={product.id} product={product} />)}
              </div>
              <Pages current={page} count={pageCount} onChange={setPage} />
            </>
          ) : (
            <p className="rounded-xl border border-line bg-card p-8 text-center text-ink-2">{pt("Không tìm thấy sản phẩm phù hợp. Hãy xóa bớt bộ lọc.")}</p>
          )}
        </section>
      </div>
    </main>
  );
}
