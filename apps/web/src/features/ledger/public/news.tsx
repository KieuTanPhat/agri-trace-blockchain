"use client";

import Image from "next/image";
import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { FileText } from "lucide-react";
import type { components } from "@/lib/generated/api";
import { publicRequest } from "@/lib/public-api";
import { customerHref } from "@/lib/site-origins";
import { pt } from "@/lib/ledger/public-i18n";

type NewsItem = components["schemas"]["PublicNewsDto"];
type NewsPage = components["schemas"]["PublicNewsPageDto"];
type NewsArticleData = components["schemas"]["PublicNewsDetailDto"];
type NewsImageDto = components["schemas"]["PublicNewsImageDto"];

function dateLabel(value: string) {
  return new Intl.DateTimeFormat("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric", timeZone: "Asia/Ho_Chi_Minh" }).format(new Date(value));
}

function NewsCover({ news, className = "" }: { news: Pick<NewsItem, "id" | "hasCover" | "coverUrl">; className?: string }) {
  const [src, setSrc] = useState<string | null>(news.coverUrl);
  useEffect(() => {
    let active = true;
    setSrc(news.coverUrl);
    if (!news.coverUrl && news.hasCover) {
      void publicRequest<NewsImageDto>(`/public/news/${encodeURIComponent(news.id)}/cover`)
        .then((image) => { if (active) setSrc(`data:${image.mimeType};base64,${image.dataBase64}`); })
        .catch(() => { if (active) setSrc(null); });
    }
    return () => { active = false; };
  }, [news.id, news.coverUrl, news.hasCover]);

  return (
    <div className={`relative overflow-hidden rounded-xl bg-brand-weak ${className}`}>
      {src ? (
        <Image unoptimized fill sizes="(max-width: 768px) 100vw, 50vw" src={src} alt="" className="object-cover" />
      ) : (
        <div className="flex size-full items-center justify-center text-brand/50"><FileText aria-hidden className="size-9" /></div>
      )}
    </div>
  );
}

function NewsCard({ news, compact = false }: { news: NewsItem; compact?: boolean }) {
  return (
    <Link href={customerHref(`/news/${news.id}`)} className={`group min-w-0 ${compact ? "grid grid-cols-[112px_minmax(0,1fr)] gap-3 py-3 first:pt-0 last:pb-0 sm:grid-cols-[140px_minmax(0,1fr)]" : "flex flex-col gap-3"}`}>
      <NewsCover news={news} className={compact ? "aspect-[4/3]" : "aspect-[16/9]"} />
      <div className="min-w-0">
        <p className="mb-1 text-xs text-ink-2">{dateLabel(news.publishedAt)}</p>
        <h3 className="line-clamp-2 text-[15px] font-semibold leading-snug group-hover:text-brand">{news.title}</h3>
        <p className="mt-1 line-clamp-2 text-[13px] leading-relaxed text-ink-2">{news.summary}</p>
      </div>
    </Link>
  );
}

export function FeaturedNews() {
  const [items, setItems] = useState<NewsItem[]>([]);
  useEffect(() => {
    let active = true;
    void publicRequest<NewsPage>("/public/news?limit=5")
      .then((page) => { if (active) setItems(page.items); })
      .catch(() => { if (active) setItems([]); });
    return () => { active = false; };
  }, []);

  if (!items.length) return null;
  const [lead, ...related] = items;
  return (
    <section className="py-16 sm:py-20">
      <div className="mx-auto max-w-[1280px] px-4 sm:px-7">
        <div className="mb-5 flex items-end justify-between gap-4">
          <h2 className="text-2xl font-semibold sm:text-[28px]">{pt("Bài viết nổi bật")}</h2>
          <Link href={customerHref("/news")} className="shrink-0 text-sm font-semibold text-brand hover:underline">{pt("Xem bảng tin")} →</Link>
        </div>
        <div className="grid gap-5 rounded-3xl border border-line bg-card p-4 sm:p-6 lg:grid-cols-[1.15fr_1fr]">
          <div className="border-b border-line pb-5 lg:border-r lg:border-b-0 lg:pr-6 lg:pb-0">
            <NewsCard news={lead} />
          </div>
          <div className="flex flex-col divide-y divide-line">
            {related.map((news) => <NewsCard key={news.id} news={news} compact />)}
          </div>
        </div>
      </div>
    </section>
  );
}

export function NewsListing() {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const load = useCallback(async (nextCursor?: string | null, append = false) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ limit: "12" });
      if (nextCursor) params.set("cursor", nextCursor);
      const page = await publicRequest<NewsPage>(`/public/news?${params}`);
      setItems((current) => append ? [...current, ...page.items] : page.items);
      setCursor(page.nextCursor);
      setHasMore(page.hasMore);
    } catch (cause) {
      setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "Không tải được bảng tin.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  return (
    <main className="pub-site min-h-[70vh] bg-canvas py-10 sm:py-14">
      <div className="mx-auto max-w-[1180px] px-4 sm:px-7">
        <div className="mb-8">
          <h1 className="text-3xl font-semibold">{pt("Bảng tin nông nghiệp")}</h1>
          <p className="mt-2 max-w-2xl text-ink-2">{pt("Tin tức và hướng dẫn về truy xuất, sản xuất, bảo quản và chuỗi cung ứng nông sản.")}</p>
        </div>
        {error && <p role="alert" className="mb-5 rounded-xl border border-red-200 bg-card p-4 text-sm text-red-700">{error}</p>}
        {items.length ? (
          <div className="grid gap-x-5 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
            {items.map((news) => <NewsCard key={news.id} news={news} />)}
          </div>
        ) : !loading && !error ? (
          <p className="rounded-xl border border-line bg-card p-8 text-center text-ink-2">{pt("Chưa có bài viết được đăng.")}</p>
        ) : null}
        <div className="mt-8 flex justify-center">
          {loading ? <p role="status" className="text-sm text-ink-2">{pt("Đang tải…")}</p> : hasMore ? (
            <button type="button" onClick={() => void load(cursor, true)} className="rounded-md border border-line bg-card px-5 py-2.5 text-sm font-semibold hover:bg-brand-weak">{pt("Tải thêm bài viết")}</button>
          ) : null}
        </div>
      </div>
    </main>
  );
}

function LinkedBody({ value }: { value: string }) {
  return <div className="whitespace-pre-line text-[16px] leading-8 text-ink-2">{value.split(/(https?:\/\/[^\s]+)/g).map((part, index) => /^https?:\/\//.test(part) ? <a key={index} href={part} target="_blank" rel="noreferrer" className="break-all text-brand underline">{part}</a> : part)}</div>;
}

export function NewsArticle({ id }: { id: string }) {
  const [article, setArticle] = useState<NewsArticleData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError("");
    setArticle(null);
    void publicRequest<NewsArticleData>(`/public/news/${encodeURIComponent(id)}`)
      .then((data) => { if (active) setArticle(data); })
      .catch((cause) => { if (active) setError(cause && typeof cause === "object" && "message" in cause ? String(cause.message) : "Không tải được bài viết."); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [id]);

  return (
    <main className="pub-site min-h-[70vh] bg-canvas py-10 sm:py-14">
      <article className="mx-auto max-w-[860px] px-4 sm:px-7">
        <Link href={customerHref("/news")} className="text-sm font-semibold text-brand hover:underline">← {pt("Quay lại bảng tin")}</Link>
        {loading ? <p role="status" className="py-12 text-center text-ink-2">{pt("Đang tải bài viết…")}</p> : error || !article ? (
          <p role="alert" className="mt-6 rounded-xl border border-line bg-card p-6 text-sm text-ink-2">{error || pt("Không tìm thấy bài viết.")}</p>
        ) : (
          <>
            <p className="mt-7 text-sm text-ink-2">{dateLabel(article.publishedAt)}</p>
            <h1 className="mt-2 text-3xl font-semibold leading-tight sm:text-4xl">{article.title}</h1>
            <p className="mt-4 text-lg leading-relaxed text-ink-2">{article.summary}</p>
            <NewsCover news={article} className="mt-7 aspect-[16/9]" />
            <div className="mt-8"><LinkedBody value={article.body} /></div>
          </>
        )}
      </article>
    </main>
  );
}
