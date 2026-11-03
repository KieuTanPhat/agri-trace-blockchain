"use client";
import { useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { CalendarDays, ChevronRight, Newspaper } from "lucide-react";
import { customerHref } from "@/lib/site-origins";
import { morePublicNews, useNewsCover, usePublicNews, usePublicNewsArticle, type PublicNews } from "@/lib/ledger/public-directory";
import { fmtDate } from "@/lib/ledger/format";
import { pt } from "@/lib/ledger/public-i18n";
import { cn } from "@/lib/ledger/utils";
import { ErrorState, LoadingRows } from "@/components/ledger/kit/page";
import { Button } from "@/components/ledger/ui/button";
import { Container, PageIntro, Reveal, SectionHeading } from "./blocks";

const href = (n: Pick<PublicNews, "id">) => customerHref(`/news/${n.id}`);

function Cover({ article, sizes, className }: { article: PublicNews; sizes: string; className?: string }) {
  const cover = useNewsCover(article);
  return (
    <div className={cn("relative overflow-hidden bg-brand-weak", className)}>
      {cover.data ? (
        <Image src={cover.data} alt="" fill unoptimized sizes={sizes} className="object-cover transition-transform duration-300 group-hover:scale-105" />
      ) : (
        <Newspaper className="absolute top-1/2 left-1/2 size-9 -translate-x-1/2 -translate-y-1/2 text-brand/40" aria-hidden />
      )}
    </div>
  );
}

function PublishedAt({ at }: { at: string | null }) {
  if (!at) return null;
  return (
    <span className="inline-flex items-center gap-1 text-[12px] text-ink-2">
      <CalendarDays className="size-3.5" aria-hidden />
      {fmtDate(at)}
    </span>
  );
}

function NewsCard({ article }: { article: PublicNews }) {
  return (
    <Link href={href(article)} className="group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-card transition-shadow hover:shadow-lg">
      <Cover article={article} sizes="(max-width: 640px) 100vw, 400px" className="aspect-[16/9]" />
      <div className="flex flex-1 flex-col gap-2 p-5">
        <PublishedAt at={article.publishedAt} />
        <h3 className="line-clamp-2 text-[17px] font-semibold group-hover:text-brand">{article.title}</h3>
        <p className="line-clamp-3 text-[14px] leading-relaxed text-ink-2">{article.summary}</p>
      </div>
    </Link>
  );
}

/** Bài nổi bật: một bài lớn bên trái và danh sách bài kế tiếp bên phải. */
export function FeaturedNews({ items }: { items: PublicNews[] }) {
  const [lead, ...rest] = items;
  if (!lead) return null;
  return (
    <Reveal className="grid gap-6 rounded-3xl border border-line bg-card p-5 sm:p-7 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)]">
      <Link href={href(lead)} className="group flex flex-col gap-4">
        <Cover article={lead} sizes="(max-width: 1024px) 100vw, 640px" className="aspect-[16/9] rounded-2xl" />
        <div className="flex flex-col gap-2">
          <PublishedAt at={lead.publishedAt} />
          <h3 className="text-[22px] leading-snug font-semibold group-hover:text-brand">{lead.title}</h3>
          <p className="line-clamp-3 text-[15px] leading-relaxed text-ink-2">{lead.summary}</p>
        </div>
      </Link>
      {rest.length > 0 && (
        <ul className="flex flex-col divide-y divide-line">
          {rest.slice(0, 4).map((n) => (
            <li key={n.id} className="py-3 first:pt-0 last:pb-0">
              <Link href={href(n)} className="group grid grid-cols-[140px_minmax(0,1fr)] gap-4">
                <Cover article={n} sizes="140px" className="aspect-[4/3] rounded-xl" />
                <div className="flex min-w-0 flex-col gap-1">
                  <h4 className="line-clamp-2 text-[15px] font-semibold group-hover:text-brand">{n.title}</h4>
                  <p className="line-clamp-2 text-[13px] leading-relaxed text-ink-2">{n.summary}</p>
                  <PublishedAt at={n.publishedAt} />
                </div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Reveal>
  );
}

export function NewsPage() {
  const first = usePublicNews(12);
  const [extra, setExtra] = useState<{ items: PublicNews[]; cursor: string | null; loading: boolean }>({ items: [], cursor: null, loading: false });
  const items = [...(first.data?.items ?? []), ...extra.items];
  const cursor = extra.items.length ? extra.cursor : first.data?.hasMore ? first.data.nextCursor : null;
  const loadMore = async () => {
    if (!cursor) return;
    setExtra((s) => ({ ...s, loading: true }));
    try {
      const page = await morePublicNews(cursor);
      setExtra((s) => ({ items: [...s.items, ...page.items], cursor: page.hasMore ? page.nextCursor : null, loading: false }));
    } catch {
      setExtra((s) => ({ ...s, loading: false }));
    }
  };
  return (
    <>
      <PageIntro eyebrow={pt("Bảng tin")} title={pt("Tin tức và kiến thức nông sản")} description={pt("Mùa vụ, hướng dẫn chọn và bảo quản nông sản, cập nhật từ AgriTrace.")} />
      <Container className="flex flex-col gap-10 py-12">
        {first.isLoading ? (
          <LoadingRows rows={6} />
        ) : first.isError ? (
          <ErrorState error={first.error} onRetry={() => void first.refetch()} />
        ) : items.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-line bg-card p-10 text-center text-[15px] text-ink-2">{pt("Chưa có bài viết nào được đăng.")}</div>
        ) : (
          <>
            <FeaturedNews items={items.slice(0, 5)} />
            {items.length > 5 && (
              <section className="flex flex-col gap-6">
                <h2 className="text-[24px] font-semibold">{pt("Bài viết khác")}</h2>
                <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
                  {items.slice(5).map((n) => (
                    <li key={n.id}>
                      <NewsCard article={n} />
                    </li>
                  ))}
                </ul>
              </section>
            )}
            {cursor && (
              <div className="flex justify-center">
                <Button variant="outline" size="lg" onClick={() => void loadMore()} disabled={extra.loading}>
                  {extra.loading ? pt("Đang tải…") : pt("Xem thêm bài viết")}
                </Button>
              </div>
            )}
          </>
        )}
      </Container>
    </>
  );
}

export function NewsDetail({ id }: { id: string }) {
  const article = usePublicNewsArticle(id);
  const others = usePublicNews(6);
  const a = article.data;
  if (article.isLoading)
    return (
      <Container className="py-12">
        <LoadingRows rows={8} />
      </Container>
    );
  if (article.isError || !a)
    return (
      <Container className="py-12">
        <ErrorState error={article.error ?? new Error(pt("Không tìm thấy bài viết"))} onRetry={() => void article.refetch()} />
      </Container>
    );
  const related = (others.data?.items ?? []).filter((n) => n.id !== a.id).slice(0, 3);
  return (
    <>
      <div className="border-b border-line bg-card">
        <Container>
          <nav aria-label={pt("Đường dẫn")} className="flex flex-wrap items-center gap-1 py-3 text-[13px] text-ink-2">
            <Link href={customerHref("/")} className="hover:text-brand">
              {pt("Trang chủ")}
            </Link>
            <ChevronRight className="size-3.5" aria-hidden />
            <Link href={customerHref("/news")} className="hover:text-brand">
              {pt("Bảng tin")}
            </Link>
          </nav>
        </Container>
      </div>
      <article className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-10 sm:px-7">
        <header className="flex flex-col gap-3">
          <PublishedAt at={a.publishedAt} />
          <h1 className="text-3xl leading-tight font-semibold tracking-tight sm:text-4xl">{a.title}</h1>
          <p className="text-[18px] leading-relaxed text-ink-2">{a.summary}</p>
        </header>
        {(a.hasCover || a.coverUrl) && <Cover article={a} sizes="(max-width: 768px) 100vw, 768px" className="aspect-[16/9] rounded-2xl" />}
        <div className="flex flex-col gap-4 text-[16px] leading-[1.8]">
          {a.body
            .split(/\n{2,}/)
            .map((para) => para.trim())
            .filter(Boolean)
            .map((para, i) => (
              <p key={i} className="whitespace-pre-line">
                {para}
              </p>
            ))}
        </div>
      </article>
      {related.length > 0 && (
        <section className="bg-card py-14">
          <Container className="flex flex-col gap-6">
            <SectionHeading align="left" title={pt("Bài viết khác")} />
            <ul className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
              {related.map((n) => (
                <li key={n.id}>
                  <NewsCard article={n} />
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}
    </>
  );
}
