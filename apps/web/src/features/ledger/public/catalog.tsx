"use client";
import { useMemo, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ChevronRight, Leaf, MapPin, QrCode, ScanLine, Search, Store } from "lucide-react";
import { publicApiUrl } from "@/lib/api-client";
import { customerHref } from "@/lib/site-origins";
import { categoriesOf, categoryHref, productImage, usePublicProduct, usePublicProducts, type Category, type PublicProduct } from "@/lib/ledger/public-directory";
import { LOT_STATE_LABEL, LOT_STATE_TONE } from "@/lib/ledger/ops-labels";
import { fmtDate, fmtNumber } from "@/lib/ledger/format";
import { pt } from "@/lib/ledger/public-i18n";
import { cn } from "@/lib/ledger/utils";
import { ErrorState, Field, Fields, LoadingRows } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { Container, PhotoHero, Reveal, SectionHeading } from "./blocks";
import { PHOTOS } from "./content";

const ORG_TYPE: Record<string, string> = { FARM: "Nông trại", PROCESSOR: "Nhà chế biến", DISTRIBUTOR: "Nhà phân phối", RETAILER: "Nhà bán lẻ", TRANSPORTER: "Vận chuyển", AUDITOR: "Kiểm định" };

/** Ảnh sản phẩm đã công bố; chưa có ảnh thì hiện biểu tượng lá trên nền xanh nhạt. */
function ProductPhoto({ product, sizes, className }: { product: Pick<PublicProduct, "imageUrl" | "productName">; sizes: string; className?: string }) {
  const src = productImage(product);
  return (
    <div className={cn("relative overflow-hidden bg-brand-weak", className)}>
      {src ? (
        <Image src={src} alt={product.productName} fill unoptimized sizes={sizes} className="object-contain p-3 transition-transform duration-300 group-hover:scale-105" />
      ) : (
        <Leaf className="absolute top-1/2 left-1/2 size-10 -translate-x-1/2 -translate-y-1/2 text-brand/40" aria-hidden />
      )}
    </div>
  );
}

export function ProductCard({ product, compact }: { product: PublicProduct; compact?: boolean }) {
  return (
    <Link href={customerHref(`/products/${product.id}`)} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-card transition-shadow hover:shadow-lg">
      <ProductPhoto product={product} sizes="(max-width: 640px) 50vw, 240px" className="aspect-square border-b border-line" />
      <div className="flex flex-1 flex-col gap-1.5 p-4">
        <h3 className={cn("line-clamp-2 font-semibold group-hover:text-brand", compact ? "text-[14px]" : "text-[15px]")}>{product.productName}</h3>
        <p className="line-clamp-1 text-[13px] text-ink-2">{[product.variety, product.province].filter(Boolean).join(" · ") || product.category || pt("Nông sản có truy xuất")}</p>
        <div className="mt-auto flex flex-wrap items-center gap-x-3 gap-y-1 pt-2 text-[12px]">
          <span className={cn("font-semibold", product.saleStatus === "SELLING" ? "text-brand" : "text-ink-2")}>{product.saleStatus === "SELLING" ? pt("Đang bán") : pt("Chưa bán")}</span>
          <span className="inline-flex items-center gap-1 text-ink-2">
            <QrCode className="size-3.5" aria-hidden />
            {pt("{p0} lô truy xuất", { p0: fmtNumber(product.traceCount) })}
          </span>
        </div>
      </div>
    </Link>
  );
}

/** Ô danh mục có ảnh đại diện, dùng ở trang chủ và trang sản phẩm. */
export function CategoryTile({ category, active }: { category: Category; active?: boolean }) {
  return (
    <Link
      href={customerHref(categoryHref(category.name))}
      aria-current={active ? "page" : undefined}
      className={cn("group flex flex-col items-center gap-3 rounded-2xl border bg-card p-4 text-center transition-shadow hover:shadow-md", active ? "border-brand ring-2 ring-brand/20" : "border-line")}
    >
      <div className="relative size-20 overflow-hidden rounded-full bg-brand-weak">
        {category.image ? <Image src={category.image} alt="" fill unoptimized sizes="80px" className="object-contain p-2 transition-transform group-hover:scale-110" /> : <Leaf className="absolute top-1/2 left-1/2 size-8 -translate-x-1/2 -translate-y-1/2 text-brand/50" aria-hidden />}
      </div>
      <div>
        <p className="line-clamp-2 text-[14px] font-semibold group-hover:text-brand">{category.name}</p>
        <p className="text-[12px] text-ink-2">{pt("{p0} sản phẩm", { p0: category.count })}</p>
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

function sortProducts(items: PublicProduct[], sort: Sort) {
  return [...items].sort((a, b) =>
    sort === "newest" ? Date.parse(b.createdAt) - Date.parse(a.createdAt) : sort === "name" ? a.productName.localeCompare(b.productName, "vi") : b.traceCount - a.traceCount || a.productName.localeCompare(b.productName, "vi"),
  );
}

const fold = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/Đ/g, "D").toLowerCase();

export function ProductsPage() {
  const params = useSearchParams();
  const router = useRouter();
  const path = usePathname();
  const category = params.get("category") ?? "";
  const [query, setQuery] = useState(params.get("q") ?? "");
  const [province, setProvince] = useState("");
  const [selling, setSelling] = useState(false);
  const [sort, setSort] = useState<Sort>("traces");
  const products = usePublicProducts();
  const all = useMemo(() => products.data ?? [], [products.data]);
  const categories = useMemo(() => categoriesOf(all), [all]);
  const provinces = useMemo(() => [...new Set(all.map((p) => p.province).filter((p): p is string => !!p))].sort((a, b) => a.localeCompare(b, "vi")), [all]);
  const shown = useMemo(() => {
    const q = fold(query.trim());
    return sortProducts(
      all.filter((p) => (!category || p.category === category) && (!province || p.province === province) && (!selling || p.saleStatus === "SELLING") && (!q || fold(`${p.productName} ${p.variety ?? ""} ${p.category ?? ""}`).includes(q))),
      sort,
    );
  }, [all, category, province, selling, query, sort]);
  const pick = (name: string) => router.replace(name ? `${path}?category=${encodeURIComponent(name)}` : path, { scroll: false });

  return (
    <>
      <PhotoHero image={PHOTOS.teaHills} eyebrow={pt("Sản phẩm")} title={category || pt("Nông sản có truy xuất nguồn gốc")} description={pt("Sản phẩm do doanh nghiệp công bố trên AgriTrace. Mở từng sản phẩm để xem doanh nghiệp, vùng trồng và các lô có mã truy xuất.")} />
      <Container className="grid grid-cols-[minmax(0,1fr)] gap-8 py-10 lg:grid-cols-[260px_minmax(0,1fr)]">
        <aside className="flex min-w-0 flex-col gap-6 lg:sticky lg:top-24 lg:self-start">
          <div className="flex flex-col gap-2">
            <h2 className="text-[13px] font-semibold tracking-wide text-ink-2 uppercase">{pt("Danh mục")}</h2>
            <ul className="flex gap-2 overflow-x-auto pb-1 lg:flex-col lg:gap-0.5 lg:overflow-visible">
              {[{ name: "", count: all.length }, ...categories].map((c) => (
                <li key={c.name || "all"} className="shrink-0">
                  <button
                    type="button"
                    onClick={() => pick(c.name)}
                    aria-pressed={category === c.name}
                    className={cn("flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-[14px] whitespace-nowrap transition-colors lg:whitespace-normal", category === c.name ? "bg-brand text-white" : "bg-card text-ink hover:bg-brand-weak lg:bg-transparent")}
                  >
                    <span>{c.name || pt("Tất cả sản phẩm")}</span>
                    <span className={cn("text-[12px]", category === c.name ? "text-white/80" : "text-ink-2")}>{c.count}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
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
              <Input value={query} onChange={(e) => setQuery(e.target.value)} placeholder={pt("Tìm sản phẩm, giống, nhóm hàng")} aria-label={pt("Tìm sản phẩm")} className="h-10 bg-card pl-9" />
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
              <p className="text-[14px] text-ink-2">{pt("{p0} sản phẩm", { p0: shown.length })}</p>
              {shown.length ? (
                <ul className="grid grid-cols-2 gap-4 md:grid-cols-3 xl:grid-cols-4">
                  {shown.map((p) => (
                    <li key={p.id}>
                      <ProductCard product={p} />
                    </li>
                  ))}
                </ul>
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

export function ProductDetail({ id }: { id: string }) {
  const detail = usePublicProduct(id);
  const products = usePublicProducts();
  const p = detail.data;
  const related = useMemo(() => (p?.category ? sortProducts((products.data ?? []).filter((x) => x.category === p.category && x.id !== p.id), "traces").slice(0, 4) : []), [p, products.data]);
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

      <Container className="grid gap-10 py-10 lg:grid-cols-[minmax(0,5fr)_minmax(0,6fr)]">
        <ProductPhoto product={p} sizes="(max-width: 1024px) 100vw, 520px" className="aspect-square rounded-3xl border border-line bg-card" />
        <div className="flex min-w-0 flex-col gap-5">
          <div className="flex flex-wrap gap-2">
            {p.category && <Badge tone="brand">{p.category}</Badge>}
            <Badge tone={p.saleStatus === "SELLING" ? "ok" : "neutral"}>{p.saleStatus === "SELLING" ? pt("Đang bán") : pt("Chưa bán")}</Badge>
          </div>
          <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">{p.productName}</h1>
          {p.description && <p className="text-[16px] leading-relaxed whitespace-pre-line text-ink-2">{p.description}</p>}
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            {[
              [QrCode, "Lô truy xuất", fmtNumber(p.traceCount)],
              [ScanLine, "Lượt quét", fmtNumber(p.scanCount)],
              [Store, "Doanh nghiệp", fmtNumber(p.enterprises.items.length)],
            ].map(([Icon, label, value]) => {
              const I = Icon as typeof QrCode;
              return (
                <div key={label as string} className="flex flex-col gap-1 rounded-2xl border border-line bg-card p-4">
                  <dt className="inline-flex items-center gap-1.5 text-[13px] text-ink-2">
                    <I className="size-4 text-brand" aria-hidden />
                    {pt(label as string)}
                  </dt>
                  <dd className="text-[22px] font-semibold">{value as string}</dd>
                </div>
              );
            })}
          </dl>
          {info.length > 0 && (
            <div className="rounded-2xl border border-line bg-card p-5">
              <Fields cols={2}>
                {info.map(([k, v]) => (
                  <Field key={k} label={pt(k)}>
                    {v}
                  </Field>
                ))}
              </Fields>
            </div>
          )}
          <div className="flex flex-wrap gap-3">
            {p.lots.items[0] && (
              <Button asChild size="lg">
                <Link href={customerHref(`/trace/${encodeURIComponent(p.lots.items[0].traceToken)}`)}>
                  <QrCode />
                  {pt("Xem lô mới nhất")}
                </Link>
              </Button>
            )}
            <Button asChild size="lg" variant="outline">
              <Link href={customerHref("/scan")}>
                <ScanLine />
                {pt("Quét mã trên bao bì")}
              </Link>
            </Button>
          </div>
        </div>
      </Container>

      {notes.length > 0 && (
        <section className="bg-card py-12">
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

      <Container className="grid gap-10 py-12 lg:grid-cols-2">
        <section className="flex flex-col gap-4">
          <h2 className="text-[22px] font-semibold">{pt("Doanh nghiệp liên quan")}</h2>
          {p.enterprises.items.length ? (
            <ul className="flex flex-col gap-3">
              {p.enterprises.items.map((e) => (
                <li key={e.id} className="flex items-center gap-4 rounded-2xl border border-line bg-card p-4">
                  <div className="relative size-14 shrink-0 overflow-hidden rounded-xl border border-line bg-brand-weak">
                    {e.logoUrl ? <Image src={publicApiUrl(e.logoUrl)} alt="" fill unoptimized sizes="56px" className="object-contain p-1" /> : <Store className="absolute top-1/2 left-1/2 size-6 -translate-x-1/2 -translate-y-1/2 text-brand/60" aria-hidden />}
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
          <h2 className="text-[22px] font-semibold">{pt("Lô có mã truy xuất")}</h2>
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
        <section className="pb-16">
          <Container className="flex flex-col gap-6">
            <SectionHeading align="left" eyebrow={pt("Cùng danh mục")} title={p.category ?? ""} />
            <ul className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {related.map((r, i) => (
                <Reveal as="li" key={r.id} delay={i * 70}>
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
