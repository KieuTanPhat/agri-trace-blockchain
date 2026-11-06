"use client";
import { useEffect, useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Apple, Building2, Carrot, ChevronRight, Coffee, CookingPot, Fish, Info, LayoutGrid, Leaf, MapPin, Milk, QrCode, ScanLine, Search, Sprout, Store, Wheat, type LucideIcon } from "lucide-react";
import { publicApiUrl } from "@/lib/api-client";
import { customerHref } from "@/lib/site-origins";
import { categoriesOf, categoryHref, enterpriseHref, enterprisesOf, productImage, usePublicProduct, usePublicProducts, type PublicProduct } from "@/lib/ledger/public-directory";
import { LOT_STATE_LABEL, LOT_STATE_TONE } from "@/lib/ledger/ops-labels";
import { fmtDate, fmtNumber } from "@/lib/ledger/format";
import { pt } from "@/lib/ledger/public-i18n";
import { cn } from "@/lib/ledger/utils";
import { ErrorState, LoadingRows } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { TraceQrImage, useTraceQr } from "@/components/ledger/workspace/trace-qr";
import { Container, Reveal, SectionHeading } from "./blocks";

export const ORG_TYPE: Record<string, string> = { FARM: "Nông trại", PROCESSOR: "Nhà chế biến", DISTRIBUTOR: "Nhà phân phối", RETAILER: "Nhà bán lẻ", TRANSPORTER: "Vận chuyển", AUDITOR: "Kiểm định" };

/** Lưới thẻ sản phẩm nhỏ, dùng chung cho trang chủ, danh sách và sản phẩm liên quan. */
export const PRODUCT_GRID = "grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 lg:gap-6";

/** Logo nhỏ của doanh nghiệp; chưa công bố logo thì hiện chữ cái đầu. */
export function EnterpriseLogo({ name, logo, className }: { name: string; logo: string | null; className?: string }) {
  const initial = name.replace(/^(Công ty|HTX|Hợp tác xã)\s+(Cổ phần|TNHH)?\s*/i, "").charAt(0).toUpperCase();
  return (
    <span className={cn("relative inline-flex shrink-0 items-center justify-center overflow-hidden rounded-md border border-line bg-white text-[11px] font-semibold text-brand", className)}>
      {logo ? <Image src={logo} alt="" fill unoptimized sizes="32px" className="object-contain p-0.5" /> : initial}
    </span>
  );
}

/** Ảnh sản phẩm đã công bố; chưa có ảnh thì hiện biểu tượng lá trên nền xanh nhạt. */
function ProductPhoto({ product, sizes, className, fit = "contain" }: { product: Pick<PublicProduct, "imageUrl" | "productName">; sizes: string; className?: string; fit?: "contain" | "cover" }) {
  const src = productImage(product);
  return (
    <div className={cn("relative overflow-hidden bg-brand-weak", className)}>
      {src ? (
        <Image src={src} alt={product.productName} fill unoptimized sizes={sizes} className={cn("transition-transform duration-300 group-hover:scale-105", fit === "cover" ? "object-cover" : "object-contain p-2")} />
      ) : (
        <Leaf className="absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-brand/40" aria-hidden />
      )}
    </div>
  );
}

export function ProductCard({ product }: { product: PublicProduct }) {
  return (
    <Link href={customerHref(`/products/${product.id}`)} className="group flex h-full flex-col overflow-hidden rounded-xl border border-line bg-card transition-shadow hover:shadow-md">
      <ProductPhoto product={product} sizes="(max-width: 640px) 50vw, 200px" fit="cover" className="aspect-square" />
      <div className="flex flex-1 flex-col gap-1 p-3">
        <h3 className="line-clamp-2 text-[14px] leading-snug font-semibold group-hover:text-brand">{product.productName}</h3>
        <p className="line-clamp-1 text-[12px] text-ink-2">{product.enterprise?.name ?? product.province ?? product.category ?? pt("Nông sản có truy xuất")}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-2 gap-y-0.5 pt-1.5 text-[11.5px]">
          <span className={cn("font-semibold", product.saleStatus === "SELLING" ? "text-brand" : "text-ink-2")}>{product.saleStatus === "SELLING" ? pt("Đang bán") : pt("Chưa bán")}</span>
          <span className="inline-flex items-center gap-1 text-ink-2">
            <QrCode className="size-3" aria-hidden />
            {pt("{p0} lô", { p0: fmtNumber(product.traceCount) })}
          </span>
        </div>
      </div>
    </Link>
  );
}

const SORTS = [
  { value: "traces", label: "Nhiều lô truy xuất" },
  { value: "newest", label: "Mới nhất" },
  { value: "name", label: "Tên A–Z" },
] as const;
type Sort = (typeof SORTS)[number]["value"];
const PRODUCTS_PER_PAGE = 12;

function sortProducts(items: PublicProduct[], sort: Sort) {
  return [...items].sort((a, b) =>
    sort === "newest" ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : sort === "name" ? a.productName.localeCompare(b.productName, "vi") : b.traceCount - a.traceCount || a.productName.localeCompare(b.productName, "vi"),
  );
}

function ProductPagination({
  current,
  count,
  onChange,
}: {
  current: number;
  count: number;
  onChange: (page: number) => void;
}) {
  if (count < 2) return null;
  return (
    <nav
      aria-label={pt("Phân trang sản phẩm")}
      className="flex flex-wrap items-center justify-center gap-2 py-6"
    >
      <button
        type="button"
        aria-label={pt("Trang trước")}
        disabled={current === 1}
        onClick={() => onChange(current - 1)}
        className="inline-flex h-10 items-center gap-1 rounded-md border border-line bg-card px-3 text-sm disabled:cursor-not-allowed disabled:opacity-45"
      >
        <ChevronRight aria-hidden className="size-4 rotate-180" /> {pt("Trước")}
      </button>
      {Array.from({ length: count }, (_, index) => index + 1).map((page) => (
        <button
          type="button"
          key={page}
          aria-label={pt("Trang {page}", { page })}
          aria-current={current === page ? "page" : undefined}
          onClick={() => onChange(page)}
          className={cn(
            "size-10 rounded-md border text-sm font-medium",
            current === page
              ? "border-brand bg-brand text-white"
              : "border-line bg-card hover:bg-brand-weak",
          )}
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
        {pt("Sau")} <ChevronRight aria-hidden className="size-4" />
      </button>
    </nav>
  );
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

/** Biểu tượng theo từ khóa trong tên danh mục (doanh nghiệp tự đặt tên); không khớp thì là chiếc lá. */
const CATEGORY_ICONS: [RegExp, LucideIcon][] = [
  [/trai cay|qua/, Apple],
  [/che bien|dong goi|say|mut|nuoc/, CookingPot],
  [/ngu coc|gao|dau|hat/, Wheat],
  [/gia vi|thao moc/, Sprout],
  [/rau|cu/, Carrot],
  [/ca phe|che|tra/, Coffee],
  [/thuy san|ca |tom|hai san/, Fish],
  [/sua|trung/, Milk],
];
function CategoryIcon({ name }: { name: string }) {
  const key = fold(name);
  const Icon = CATEGORY_ICONS.find(([re]) => re.test(key))?.[1] ?? Leaf;
  return <Icon className="size-4 shrink-0" aria-hidden />;
}

/** Một nhóm lọc ở cột trái: cuộn ngang trên điện thoại, danh sách dọc trên máy tính. */
function FilterList({ title, items, active, onPick, allLabel, allIcon, total }: { title: string; items: { key: string; label: string; count: number; icon?: React.ReactNode }[]; active: string; onPick: (key: string) => void; allLabel: string; allIcon: React.ReactNode; total: number }) {
  return (
    <div className="flex min-w-0 flex-col gap-2">
      <h2 className="text-[13px] font-semibold tracking-wide text-ink-2 uppercase">{title}</h2>
      <ul className="flex gap-2 overflow-x-auto pb-1 lg:max-h-[340px] lg:flex-col lg:gap-0.5 lg:overflow-y-auto">
        {[{ key: "", label: allLabel, count: total, icon: allIcon }, ...items].map((c) => (
          <li key={c.key || "all"} className="shrink-0">
            <button
              type="button"
              onClick={() => onPick(c.key)}
              aria-pressed={active === c.key}
              className={cn("flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[14px] whitespace-nowrap transition-colors lg:whitespace-normal", active === c.key ? "bg-brand text-white" : "bg-card text-ink hover:bg-brand-weak lg:bg-transparent")}
            >
              <span className="flex min-w-0 items-center gap-2">
                {c.icon && <span className={cn("inline-flex", active === c.key ? "text-white" : "text-brand")}>{c.icon}</span>}
                <span>{c.label}</span>
              </span>
              <span className={cn("text-[12px]", active === c.key ? "text-white/80" : "text-ink-2")}>{c.count}</span>
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function ProductsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const category = params.get("category") ?? "";
  const enterprise = params.get("enterprise") ?? "";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [province, setProvince] = useState("");
  const [selling, setSelling] = useState(false);
  const [sort, setSort] = useState<Sort>("traces");
  const [page, setPage] = useState(1);
  const products = usePublicProducts();
  const all = useMemo(() => products.data ?? [], [products.data]);
  const categories = useMemo(() => categoriesOf(all), [all]);
  const enterprises = useMemo(() => enterprisesOf(all), [all]);
  const provinces = useMemo(() => [...new Set(all.map((p) => p.province).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, "vi")), [all]);
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return sortProducts(
      all.filter(
        (p) =>
          (!category || p.category === category) &&
          (!enterprise || p.enterprise?.id === enterprise) &&
          (!province || p.province === province) &&
          (!selling || p.saleStatus === "SELLING") &&
          (!q || fold(`${p.productName} ${p.variety ?? ""} ${p.category ?? ""} ${p.enterprise?.name ?? ""}`).includes(q)),
      ),
      sort,
    );
  }, [all, category, enterprise, province, selling, query, sort]);
  useEffect(() => setPage(1), [category, enterprise, province, selling, query, sort]);
  const pageCount = Math.max(1, Math.ceil(shown.length / PRODUCTS_PER_PAGE));
  const currentPage = Math.min(page, pageCount);
  const visibleProducts = shown.slice((currentPage - 1) * PRODUCTS_PER_PAGE, currentPage * PRODUCTS_PER_PAGE);
  const firstItem = shown.length ? (currentPage - 1) * PRODUCTS_PER_PAGE + 1 : 0;
  const lastItem = Math.min(currentPage * PRODUCTS_PER_PAGE, shown.length);
  const pick = (key: "category" | "enterprise", value: string) => {
    const next = new URLSearchParams(params.toString());
    if (value) next.set(key, value);
    else next.delete(key);
    const qs = next.toString();
    router.replace(qs ? `${path}?${qs}` : path, { scroll: false });
  };
  const enterpriseName = enterprises.find((e) => e.id === enterprise)?.name;

  return (
    <>
      <h1 className="sr-only">{[category, enterpriseName].filter(Boolean).join(" · ") || pt("Nông sản có truy xuất nguồn gốc")}</h1>
      <Container className="grid grid-cols-[minmax(0,1fr)] gap-8 py-8 lg:grid-cols-[250px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <FilterList title={pt("Danh mục")} allLabel={pt("Tất cả danh mục")} allIcon={<LayoutGrid className="size-4 shrink-0" aria-hidden />} total={all.length} active={category} onPick={(v) => pick("category", v)} items={categories.map((c) => ({ key: c.name, label: c.name, count: c.count, icon: <CategoryIcon name={c.name} /> }))} />
          <FilterList title={pt("Doanh nghiệp")} allLabel={pt("Tất cả doanh nghiệp")} allIcon={<Building2 className="size-4 shrink-0" aria-hidden />} total={all.length} active={enterprise} onPick={(v) => pick("enterprise", v)} items={enterprises.map((e) => ({ key: e.id, label: e.name, count: e.count, icon: <EnterpriseLogo name={e.name} logo={e.logo} className="size-6" /> }))} />
          <div className="hidden flex-col gap-2 lg:flex">
            <label htmlFor="pub-province" className="text-[13px] font-semibold tracking-wide text-ink-2 uppercase">
              {pt("Tỉnh / thành")}
            </label>
            <select id="pub-province" value={province} onChange={(e) => setProvince(e.target.value)} className="h-10 rounded-md border border-input bg-card px-3 text-[14px]">
              <option value="">{pt("Tất cả")}</option>
              {provinces.map((p) => (
                <option key={p}>{p}</option>
              ))}
            </select>
          </div>
        </aside>

        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-ink-2" aria-hidden />
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={pt("Tìm sản phẩm, giống, doanh nghiệp")} aria-label={pt("Tìm sản phẩm")} className="h-10 bg-card pl-9" />
            </div>
            <label className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-card px-3 text-[14px]">
              <input type="checkbox" checked={selling} onChange={(e) => setSelling(e.target.checked)} className="accent-(--brand)" />
              {pt("Đang bán")}
            </label>
            <select value={sort} onChange={(e) => setSort(e.target.value as Sort)} aria-label={pt("Sắp xếp")} className="h-10 rounded-md border border-input bg-card px-3 text-[14px]">
              {SORTS.map((s) => (
                <option key={s.value} value={s.value}>
                  {pt(s.label)}
                </option>
              ))}
            </select>
          </div>
          {products.isLoading ? (
            <LoadingRows rows={6} />
          ) : products.isError ? (
            <ErrorState error={products.error} onRetry={() => void products.refetch()} />
          ) : (
            <>
              <p className="text-[14px] text-ink-2">
                {pt("Hiển thị {from}–{to} trong {count} sản phẩm", {
                  from: firstItem,
                  to: lastItem,
                  count: shown.length,
                })}
              </p>
              {shown.length ? (
                <>
                  <ul
                    id="product-results"
                    className="grid grid-cols-2 gap-4 sm:grid-cols-3 xl:grid-cols-4 xl:gap-5"
                  >
                    {visibleProducts.map((p) => (
                      <li key={p.id}>
                        <ProductCard product={p} />
                      </li>
                    ))}
                  </ul>
                  <ProductPagination
                    current={currentPage}
                    count={pageCount}
                    onChange={setPage}
                  />
                </>
              ) : (
                <div className="rounded-2xl border border-dashed border-line bg-card p-10 text-center text-[15px] text-ink-2">{pt("Không có sản phẩm phù hợp bộ lọc.")}</div>
              )}
            </>
          )}
        </div>
      </Container>
    </>
  );
}

/** Mã QR dẫn tới lô mới nhất của sản phẩm. */
function LatestLotQr({ token }: { token: string }) {
  const qr = useTraceQr(token);
  if (!qr.ready) return null;
  return (
    <div className="flex items-center justify-center rounded-xl border border-line bg-card p-4">
      <TraceQrImage qr={qr} className="aspect-square w-full max-w-[184px] p-2" />
    </div>
  );
}

export function ProductDetail({ id }: { id: string }) {
  const detail = usePublicProduct(id);
  const products = usePublicProducts();
  const p = detail.data;
  const related = useMemo(() => (p?.category ? sortProducts((products.data ?? []).filter((x) => x.category === p.category && x.id !== p.id), "traces").slice(0, 10) : []), [p, products.data]);
  if (detail.isLoading)
    return (
      <Container className="py-12">
        <LoadingRows rows={8} />
      </Container>
    );
  if (detail.isError || !p)
    return (
      <Container className="py-12">
        <ErrorState error={detail.error ?? new Error(pt("Không tìm thấy sản phẩm"))} onRetry={() => void detail.refetch()} />
      </Container>
    );
  const latest = p.lots.items[0];
  const info = [
    ["Nhóm sản phẩm", p.category],
    ["Giống", p.variety],
    ["Đơn vị", p.defaultUnit],
    ["Mã GTIN", p.gtin],
    ["Tỉnh / thành", p.province],
  ].filter((r): r is [string, string] => !!r[1]);
  const notes = [
    ["Thành phần", p.ingredients],
    ["Bảo quản", p.storageConditions],
    ["Hướng dẫn sử dụng", p.usageInstructions],
  ].filter((r): r is [string, string] => !!r[1]);

  return (
    <>
      <div className="border-b border-line bg-card">
        <Container>
          <nav aria-label={pt("Đường dẫn")} className="flex flex-wrap items-center gap-1 py-3 text-[13px] text-ink-2">
            <Link href={customerHref("/")} className="hover:text-brand">
              {pt("Trang chủ")}
            </Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <Link href={customerHref("/products")} className="hover:text-brand">
              {pt("Sản phẩm")}
            </Link>
            {p.category && (
              <>
                <ChevronRight className="size-3.5" aria-hidden />
                <Link href={customerHref(categoryHref(p.category))} className="hover:text-brand">
                  {p.category}
                </Link>
              </>
            )}
            <ChevronRight className="size-3.5" aria-hidden />
            <span className="text-ink">{p.productName}</span>
          </nav>
        </Container>
      </div>

      <Container className="py-8">
        <div className="grid gap-8 rounded-3xl border border-line bg-card p-5 shadow-sm sm:p-7 md:grid-cols-[minmax(0,4fr)_minmax(0,8fr)]">
        <div className="flex flex-col gap-4">
          <ProductPhoto product={p} sizes="(max-width: 768px) 60vw, 360px" className="mx-auto aspect-square w-3/5 rounded-2xl border border-line bg-white shadow-sm md:w-full" />
          {p.enterprise && (
            <Link href={customerHref(enterpriseHref(p.enterprise.id))} className="group flex items-center gap-4 rounded-2xl border border-line bg-card p-4 transition-shadow hover:shadow-md">
              <EnterpriseLogo name={p.enterprise.name} logo={p.enterprise.logoUrl ? publicApiUrl(p.enterprise.logoUrl) : null} className="size-16 rounded-full p-1.5 text-[22px] shadow-sm" />
              <span className="flex min-w-0 flex-col gap-0.5">
                <span className="text-[12px] text-ink-2">{pt("Doanh nghiệp đứng tên")}</span>
                <span className="font-semibold group-hover:text-brand">{p.enterprise.name}</span>
                <span className="text-[13px] text-brand">{pt("Xem sản phẩm của doanh nghiệp")}</span>
              </span>
            </Link>
          )}
        </div>
        <div className="flex min-w-0 flex-col gap-4">
          <div className="flex flex-wrap gap-2">
            {p.category && <Badge tone="brand">{p.category}</Badge>}
            <Badge tone={p.saleStatus === "SELLING" ? "ok" : "neutral"}>{p.saleStatus === "SELLING" ? pt("Đang bán") : pt("Chưa bán")}</Badge>
          </div>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight">{p.productName}</h1>
          {p.description && <p className="text-[15px] leading-relaxed text-ink-2">{p.description}</p>}
          <dl className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {[
              [QrCode, "Lô có mã QR", fmtNumber(p.traceCount)],
              [ScanLine, "Lượt quét", fmtNumber(p.scanCount)],
              [Store, "Doanh nghiệp", fmtNumber(p.enterprises.items.length)],
            ].map(([Icon, label, value]) => {
              const I = Icon as typeof QrCode;
              return (
                <div key={label as string} className="flex items-center gap-3 rounded-xl border border-line bg-card p-3">
                  <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-lg bg-brand-weak text-brand">
                    <I className="size-5" aria-hidden />
                  </span>
                  <div className="flex flex-col">
                    <dt className="text-[12px] text-ink-2">{pt(label as string)}</dt>
                    <dd className="text-[20px] leading-tight font-semibold">{value as string}</dd>
                  </div>
                </div>
              );
            })}
          </dl>
          <div className="grid gap-4 lg:grid-cols-2">
            {info.length > 0 && (
              <section className="rounded-xl border border-line bg-card">
                <h2 className="flex items-center gap-2 border-b border-line px-4 py-3 text-[14px] font-semibold">
                  <Info className="size-4 text-brand" aria-hidden />
                  {pt("Thông tin sản phẩm")}
                </h2>
                <dl className="divide-y divide-line px-4 text-[13.5px]">
                  {info.map(([k, v]) => (
                    <div key={k} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 py-2">
                      <dt className="text-ink-2">{pt(k)}</dt>
                      <dd className="font-medium">{v}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}
            {latest && <LatestLotQr token={latest.traceToken} />}
          </div>
          <div className="flex flex-wrap gap-3">
            {latest && (
              <Button asChild>
                <Link href={customerHref(`/trace/${encodeURIComponent(latest.traceToken)}`)}>
                  <QrCode />
                  {pt("Xem lô mới nhất")}
                </Link>
              </Button>
            )}
            <Button asChild variant="outline">
              <Link href={customerHref("/scan")}>
                <ScanLine />
                {pt("Quét mã trên bao bì")}
              </Link>
            </Button>
          </div>
        </div>
        </div>
      </Container>

      {notes.length > 0 && (
        <section className="bg-card py-10">
          <Container className="grid gap-6 md:grid-cols-3">
            {notes.map(([k, v]) => (
              <div key={k} className="flex flex-col gap-2 border-l-2 border-brand pl-4">
                <h2 className="font-semibold">{pt(k)}</h2>
                <p className="text-[15px] leading-relaxed whitespace-pre-line text-ink-2">{v}</p>
              </div>
            ))}
          </Container>
        </section>
      )}

      <Container className="grid gap-10 py-10 lg:grid-cols-2">
        <section className="flex flex-col gap-4">
          <h2 className="text-[22px] font-semibold">{pt("Doanh nghiệp liên quan")}</h2>
          {p.enterprises.items.length ? (
            <ul className="flex flex-col gap-3">
              {p.enterprises.items.map((e) => (
                <li key={e.id} className="flex items-center gap-4 rounded-2xl border border-line bg-card p-4">
                  <div className="relative size-12 shrink-0 overflow-hidden rounded-xl border border-line bg-brand-weak">
                    {e.logoUrl ? <Image src={publicApiUrl(e.logoUrl)} alt="" fill unoptimized sizes="48px" className="object-contain p-1" /> : <Store className="absolute top-1/2 left-1/2 size-5 -translate-x-1/2 -translate-y-1/2 text-brand/60" aria-hidden />}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate font-semibold">{e.name}</p>
                    <p className="flex flex-wrap items-center gap-x-2 text-[13px] text-ink-2">
                      <span>{pt(ORG_TYPE[e.type] ?? e.type)}</span>
                      {e.province && (
                        <span className="inline-flex items-center gap-1">
                          <MapPin className="size-3.5" aria-hidden />
                          {e.province}
                        </span>
                      )}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-ink-2">{pt("Doanh nghiệp chưa công bố hồ sơ.")}</p>
          )}
        </section>
        <section className="flex flex-col gap-4">
          <h2 className="text-[22px] font-semibold">{pt("Lô có mã QR")}</h2>
          {p.lots.items.length ? (
            <ul className="flex flex-col divide-y divide-line overflow-hidden rounded-2xl border border-line bg-card">
              {p.lots.items.map((l) => (
                <li key={l.id}>
                  <Link href={customerHref(`/trace/${encodeURIComponent(l.traceToken)}`)} className="flex items-center gap-3 px-4 py-3 hover:bg-brand-weak">
                    <QrCode className="size-5 shrink-0 text-brand" aria-hidden />
                    <div className="min-w-0 flex-1">
                      <p className="truncate font-medium">{l.lotName ?? l.lotCode}</p>
                      <p className="text-[12px] text-ink-2">
                        <span className="font-mono">{l.lotCode}</span> · {fmtDate(l.createdAt)}
                      </p>
                    </div>
                    <Badge tone={LOT_STATE_TONE[l.state] ?? "neutral"}>{LOT_STATE_LABEL[l.state] ?? l.state}</Badge>
                  </Link>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[15px] text-ink-2">{pt("Chưa có lô công khai.")}</p>
          )}
        </section>
      </Container>

      {related.length > 0 && (
        <section className="pb-14">
          <Container className="flex flex-col gap-5">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <SectionHeading align="left" eyebrow={pt("Cùng danh mục")} title={p.category ?? ""} />
              {p.category && (
                <Link href={customerHref(categoryHref(p.category))} className="text-[15px] font-semibold text-brand hover:underline">
                  {pt("Xem tất cả")}
                </Link>
              )}
            </div>
            <ul className={PRODUCT_GRID}>
              {related.map((r, i) => (
                <Reveal as="li" key={r.id} delay={(i % 6) * 50}>
                  <ProductCard product={r} />
                </Reveal>
              ))}
            </ul>
          </Container>
        </section>
      )}
    </>
  );
}
