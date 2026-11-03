"use client";
import { useMemo } from "react";
import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { categoriesOf, enterpriseHref, enterprisesOf, usePublicNews, usePublicProducts } from "@/lib/ledger/public-directory";
import { customerHref } from "@/lib/site-origins";
import { SITE_CONTACT } from "@/lib/site-contact";
import { pt } from "@/lib/ledger/public-i18n";
import { Button } from "@/components/ledger/ui/button";
import { Container, CtaBand, PhotoCard, PhotoHero, Reveal, SectionHeading } from "./blocks";
import { PHOTOS, PLATFORM_FEATURES, SOLUTIONS, TRACE_STEPS } from "./content";
import { TraceSearch } from "./trace-search";
import { CategoryTile, PRODUCT_GRID, ProductCard } from "./catalog";
import { FeaturedNews } from "./news";

function Hero() {
  return (
    <PhotoHero
      tall
      image={PHOTOS.heroRiceTerraces}
      eyebrow={pt("Truy xuất nguồn gốc nông sản trên blockchain")}
      title={pt("Hành trình nông sản, minh bạch từ vườn tới tay bạn.")}
      description={pt("Từ trồng trọt, thu hoạch đến chế biến và giao hàng. Quét mã để xem nguồn gốc, nhật ký và giấy tờ của từng lô.")}
    >
      <TraceSearch className="mt-2 max-w-xl" onDark />
      <p className="text-[14px] text-white/80">
        {["Không cần đăng nhập", "Đọc mã ngay trên thiết bị", "Cảnh báo thu hồi hiển thị riêng"].map((x) => pt(x)).join(" · ")}
      </p>
    </PhotoHero>
  );
}

function SeeAll({ href, label }: { href: string; label: string }) {
  return (
    <Link href={customerHref(href)} className="inline-flex shrink-0 items-center gap-1 text-[15px] font-semibold text-brand hover:underline">
      {pt(label)}
      <ArrowRight className="size-4" aria-hidden />
    </Link>
  );
}

function RowHeading({ title, description, href, label }: { title: string; description?: string; href: string; label: string }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-4">
      <div className="flex flex-col gap-1">
        <h2 className="text-[26px] leading-tight font-semibold tracking-tight sm:text-[30px]">{pt(title)}</h2>
        {description && <p className="text-[15px] text-ink-2">{pt(description)}</p>}
      </div>
      <SeeAll href={href} label={label} />
    </div>
  );
}

/** Danh mục và sản phẩm lấy trực tiếp từ danh bạ công khai; ẩn khi chưa có dữ liệu. */
function Catalog() {
  const products = usePublicProducts();
  const all = useMemo(() => products.data ?? [], [products.data]);
  const categories = useMemo(() => categoriesOf(all).slice(0, 6), [all]);
  const enterprises = useMemo(() => enterprisesOf(all).slice(0, 12), [all]);
  const top = useMemo(() => [...all].sort((a, b) => b.traceCount - a.traceCount).slice(0, 12), [all]);
  const latest = useMemo(() => [...all].sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 6), [all]);
  if (!all.length) return null;
  return (
    <>
      {categories.length > 0 && (
        <section className="pt-16">
          <Container className="flex flex-col gap-7">
            <RowHeading title="Danh mục nổi bật" description="Nhóm nông sản có nhiều lô truy xuất nhất." href="/products" label="Tất cả danh mục" />
            <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
              {categories.map((c, i) => (
                <Reveal as="li" key={c.name} delay={i * 50}>
                  <CategoryTile category={c} />
                </Reveal>
              ))}
            </ul>
          </Container>
        </section>
      )}
      <section className="pt-16">
        <Container className="flex flex-col gap-7">
          <RowHeading title="Truy xuất nhiều nhất" description="Sản phẩm có nhiều lô mang mã QR công khai." href="/products" label="Xem tất cả sản phẩm" />
          <ul className={PRODUCT_GRID}>
            {top.map((p, i) => (
              <Reveal as="li" key={p.id} delay={(i % 6) * 50}>
                <ProductCard product={p} />
              </Reveal>
            ))}
          </ul>
        </Container>
      </section>
      {enterprises.length > 0 && (
        <section className="pt-16">
          <Container className="flex flex-col gap-7">
            <RowHeading title="Theo doanh nghiệp" description="Xem sản phẩm của từng doanh nghiệp đang công bố trên AgriTrace." href="/products" label="Xem tất cả sản phẩm" />
            <ul className="flex flex-wrap gap-2">
              {enterprises.map((e) => (
                <li key={e.id}>
                  <Link href={customerHref(enterpriseHref(e.id))} className="inline-flex items-center gap-2 rounded-full border border-line bg-card px-4 py-2 text-[14px] font-medium transition-colors hover:border-brand hover:text-brand">
                    {e.name}
                    <span className="text-[12px] text-ink-2">{e.count}</span>
                  </Link>
                </li>
              ))}
            </ul>
          </Container>
        </section>
      )}
      {all.length > 12 && (
        <section className="pt-16">
          <Container className="flex flex-col gap-7">
            <RowHeading title="Mới cập nhật" description="Sản phẩm vừa được doanh nghiệp công bố." href="/products" label="Xem thêm" />
            <ul className={PRODUCT_GRID}>
              {latest.map((p, i) => (
                <Reveal as="li" key={p.id} delay={i * 50}>
                  <ProductCard product={p} />
                </Reveal>
              ))}
            </ul>
          </Container>
        </section>
      )}
    </>
  );
}

function News() {
  const news = usePublicNews(5);
  const items = news.data?.items ?? [];
  if (!items.length) return null;
  return (
    <section className="pt-16 pb-4">
      <Container className="flex flex-col gap-7">
        <RowHeading title="Bài viết nổi bật" href="/news" label="Xem bảng tin" />
        <FeaturedNews items={items} />
      </Container>
    </section>
  );
}

function Audiences() {
  return (
    <section className="py-20">
      <Container className="flex flex-col gap-12">
        <SectionHeading
          eyebrow={pt("Giải pháp")}
          title={pt("Một nền tảng cho mọi mắt xích trong chuỗi")}
          description={pt("Mỗi bên ghi nhận phần việc của mình, dữ liệu nối thành hành trình đầy đủ của lô hàng.")}
        />
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          {SOLUTIONS.map((s, i) => (
            <PhotoCard key={s.slug} image={s.image} title={pt(s.title)} href={customerHref(`/solutions#${s.slug}`)} delay={(i % 3) * 90}>
              {pt(s.summary)}
            </PhotoCard>
          ))}
        </div>
      </Container>
    </section>
  );
}

function Process() {
  return (
    <section className="bg-card py-20">
      <Container className="flex flex-col gap-14">
        <SectionHeading
          eyebrow={pt("Quy trình")}
          title={pt("Bốn bước tạo nên một mã truy xuất")}
          description={pt("Vụ trồng → Thu hoạch → Lô hàng → Giao nhận. Mỗi bước ghi rõ thời gian, người làm và được lưu lại, không sửa được.")}
        />
        <ol className="grid gap-10 md:grid-cols-4 md:gap-6">
          {TRACE_STEPS.map((s, i) => (
            <Reveal as="li" key={s.title} delay={i * 110} className="relative flex flex-col gap-3 border-t-2 border-brand/25 pt-6">
              <span className="text-[44px] leading-none font-semibold text-brand/90">{String(i + 1).padStart(2, "0")}</span>
              <h3 className="text-[18px] font-semibold">{pt(s.title)}</h3>
              <p className="text-[15px] leading-relaxed text-ink-2">{pt(s.copy)}</p>
            </Reveal>
          ))}
        </ol>
      </Container>
    </section>
  );
}

function Features() {
  return (
    <section className="py-20">
      <Container className="grid items-center gap-12 lg:grid-cols-2">
        <Reveal className="relative aspect-[4/3] overflow-hidden rounded-3xl">
          <Image src={PHOTOS.teaHills} alt="" fill placeholder="blur" sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" />
        </Reveal>
        <div className="flex flex-col gap-8">
          <SectionHeading
            align="left"
            eyebrow={pt("Vì sao chọn AgriTrace")}
            title={pt("Minh bạch có kiểm chứng, không chỉ là một con tem")}
            description={pt("Mỗi ghi nhận được lưu trên blockchain nên không thể sửa lén. Người mua thấy rõ điều gì đã xác nhận, điều gì đang chờ và cảnh báo nào cần chú ý.")}
          />
          <dl className="grid gap-6 sm:grid-cols-2">
            {PLATFORM_FEATURES.map((f, i) => (
              <Reveal key={f.title} delay={i * 80} className="border-l-2 border-brand pl-4">
                <dt className="font-semibold">{pt(f.title)}</dt>
                <dd className="mt-1 text-[15px] leading-relaxed text-ink-2">{pt(f.copy)}</dd>
              </Reveal>
            ))}
          </dl>
        </div>
      </Container>
    </section>
  );
}

function ConsumerGuide() {
  const steps = [
    { title: "Quét mã QR", copy: "Dùng camera điện thoại hoặc ảnh chụp tem trên bao bì." },
    { title: "Xem hành trình", copy: "Nguồn gốc, thu hoạch, chế biến và giao nhận của đúng lô bạn cầm." },
    { title: "Phản ánh", copy: "Gửi phản ánh nếu thông tin chưa đúng hoặc nghi hàng giả." },
  ];
  return (
    <section className="bg-brand-weak/70 py-20">
      <Container className="grid items-center gap-12 lg:grid-cols-[1.1fr_1fr]">
        <div className="flex flex-col items-start gap-8">
          <SectionHeading align="left" eyebrow={pt("Người tiêu dùng")} title={pt("Tra cứu nguồn gốc trong vài giây")} />
          <ol className="flex flex-col gap-5">
            {steps.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 90} className="flex gap-4">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-[15px] font-semibold text-white">{i + 1}</span>
                <div>
                  <h3 className="font-semibold">{pt(s.title)}</h3>
                  <p className="text-[15px] leading-relaxed text-ink-2">{pt(s.copy)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
          <Button asChild size="lg" className="bg-(--pub-accent) text-white hover:bg-(--pub-accent-hover)">
            <Link href={customerHref("/scan")}>{pt("Quét mã truy xuất")}</Link>
          </Button>
        </div>
        <Reveal className="relative aspect-[4/3] overflow-hidden rounded-3xl lg:aspect-[4/5]">
          <Image src={PHOTOS.roleConsumer} alt="" fill placeholder="blur" sizes="(max-width: 1024px) 100vw, 45vw" className="object-cover" />
        </Reveal>
      </Container>
    </section>
  );
}

function Contact() {
  return (
    <section className="pt-16">
      <Container>
        <Reveal className="flex flex-col gap-4 rounded-2xl border border-line bg-card p-7 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-[19px] font-semibold">{pt("Kết nối với AgriTrace")}</h2>
            <p className="text-[15px] text-ink-2">{pt("Tư vấn triển khai truy xuất cho doanh nghiệp và chuỗi cung ứng.")}</p>
          </div>
          <div className="flex flex-wrap gap-3 text-[15px]">
            <a href={SITE_CONTACT.emailUrl} className="rounded-md border border-line px-4 py-2 font-medium text-brand hover:bg-brand-weak">
              {SITE_CONTACT.email}
            </a>
            <a href={SITE_CONTACT.zaloUrl} className="rounded-md border border-line px-4 py-2 font-medium text-brand hover:bg-brand-weak">
              Zalo {SITE_CONTACT.zaloPhone}
            </a>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}

export default function Home() {
  return (
    <>
      <Hero />
      <Catalog />
      <News />
      <Audiences />
      <Process />
      <Features />
      <ConsumerGuide />
      <Contact />
      <CtaBand />
    </>
  );
}
