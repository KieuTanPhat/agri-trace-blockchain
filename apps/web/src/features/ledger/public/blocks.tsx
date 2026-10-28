"use client";
import { useEffect, useRef, useState } from "react";
import Image, { type StaticImageData } from "next/image";
import Link from "next/link";
import { customerHref } from "@/lib/site-origins";
import { pt } from "@/lib/ledger/public-i18n";
import { cn } from "@/lib/ledger/utils";
import { Button } from "@/components/ledger/ui/button";
import { PHOTOS } from "./content";

/** Khung nội dung công khai, rộng tối đa giống header/footer. */
export function Container({ children, className }: { children: React.ReactNode; className?: string }) {
  return <div className={cn("mx-auto w-full max-w-[1280px] px-4 sm:px-7", className)}>{children}</div>;
}

/** Hiện dần khi phần tử cuộn vào khung nhìn (CSS `.pub-reveal`, tôn trọng reduced motion). */
export function Reveal({ children, className, delay = 0, as: Tag = "div" }: { children: React.ReactNode; className?: string; delay?: number; as?: "div" | "li" | "section" | "article" }) {
  const ref = useRef<HTMLElement | null>(null);
  const [visible, setVisible] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof IntersectionObserver === "undefined") {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "0px 0px -8% 0px", threshold: 0.12 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);
  return (
    <Tag
      ref={(node: HTMLElement | null) => {
        ref.current = node;
      }}
      data-visible={visible}
      style={{ "--pub-delay": `${delay}ms` } as React.CSSProperties}
      className={cn("pub-reveal", className)}
    >
      {children}
    </Tag>
  );
}

/** Băng tiêu đề có ảnh nền xanh và lớp phủ tối để chữ dễ đọc. */
export function PhotoHero({ image, title, description, eyebrow, children, tall }: { image: StaticImageData; title: string; description?: string; eyebrow?: string; children?: React.ReactNode; tall?: boolean }) {
  return (
    <section className="relative isolate overflow-hidden bg-(--pub-deep) text-white">
      <Image src={image} alt="" fill priority placeholder="blur" sizes="100vw" className="-z-20 object-cover" />
      <div className="pub-photo-shade absolute inset-0 -z-10" aria-hidden />
      <Container className={cn("flex flex-col gap-5", tall ? "py-20 sm:py-28 lg:py-32" : "py-14 sm:py-20")}>
        {eyebrow && <span className="text-[13px] font-semibold tracking-[0.16em] text-[#b9eccb] uppercase">{eyebrow}</span>}
        <h1 className={cn("max-w-3xl leading-[1.12] font-semibold tracking-tight", tall ? "text-4xl sm:text-5xl lg:text-6xl" : "text-3xl sm:text-4xl")}>{title}</h1>
        {description && <p className="max-w-2xl text-[16px] leading-relaxed text-white/85 sm:text-[17px]">{description}</p>}
        {children}
      </Container>
    </section>
  );
}

export function SectionHeading({ eyebrow, title, description, align = "center" }: { eyebrow?: string; title: string; description?: string; align?: "center" | "left" }) {
  return (
    <Reveal className={cn("flex flex-col gap-3", align === "center" ? "mx-auto max-w-2xl items-center text-center" : "max-w-2xl")}>
      {eyebrow && <span className="text-[12px] font-semibold tracking-[0.16em] text-(--pub-accent-ink) uppercase">{eyebrow}</span>}
      <h2 className="text-[28px] leading-tight font-semibold tracking-tight sm:text-[34px]">{title}</h2>
      {description && <p className="text-[16px] leading-relaxed text-ink-2">{description}</p>}
    </Reveal>
  );
}

/** Thẻ ảnh dùng cho các vai trò trong chuỗi. */
export function PhotoCard({ image, title, children, href, delay }: { image: StaticImageData; title: string; children: React.ReactNode; href: string; delay?: number }) {
  return (
    <Reveal delay={delay} className="h-full">
      <Link href={href} className="pub-zoom group flex h-full flex-col overflow-hidden rounded-2xl border border-line bg-card transition-shadow hover:shadow-lg">
        <div className="relative aspect-[16/10] overflow-hidden">
          <Image src={image} alt="" fill placeholder="blur" sizes="(max-width: 640px) 100vw, (max-width: 1024px) 50vw, 33vw" className="object-cover" />
        </div>
        <div className="flex flex-1 flex-col gap-2 p-6">
          <h3 className="text-[18px] font-semibold group-hover:text-brand">{title}</h3>
          <p className="text-[15px] leading-relaxed text-ink-2">{children}</p>
        </div>
      </Link>
    </Reveal>
  );
}

/** Băng kêu gọi cuối trang trên nền ảnh lá chè. */
export function CtaBand() {
  return (
    <section className="py-16">
      <Container>
        <Reveal className="relative isolate overflow-hidden rounded-3xl bg-(--pub-deep) px-6 py-14 text-white sm:px-14">
          <Image src={PHOTOS.teaLeaves} alt="" fill placeholder="blur" sizes="(max-width: 1280px) 100vw, 1280px" className="-z-20 object-cover" />
          <div className="pub-photo-shade absolute inset-0 -z-10" aria-hidden />
          <div className="flex flex-col items-start justify-between gap-6 lg:flex-row lg:items-center">
            <div className="flex max-w-2xl flex-col gap-2">
              <h2 className="text-[28px] leading-tight font-semibold tracking-tight">{pt("Đưa sản phẩm của bạn lên chuỗi truy xuất")}</h2>
              <p className="text-[16px] text-white/85">{pt("Đăng ký hồ sơ doanh nghiệp, được xét duyệt năng lực và nhận mã QR truy xuất cho từng lô hàng.")}</p>
            </div>
            <div className="flex flex-wrap gap-3">
              <Button asChild size="lg" className="bg-(--pub-accent) text-white hover:bg-(--pub-accent-hover)">
                <Link href={customerHref("/solutions")}>{pt("Xem giải pháp")}</Link>
              </Button>
              <Button asChild size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white">
                <Link href={customerHref("/contact")}>{pt("Liên hệ tư vấn")}</Link>
              </Button>
            </div>
          </div>
        </Reveal>
      </Container>
    </section>
  );
}
