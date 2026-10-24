"use client";
import Image from "next/image";
import Link from "next/link";
import { customerHref } from "@/lib/site-origins";
import { SITE_CONTACT } from "@/lib/site-contact";
import { pt } from "@/lib/ledger/public-i18n";
import { Button } from "@/components/ledger/ui/button";
import { Container, CtaBand, PhotoCard, PhotoHero, Reveal, SectionHeading } from "./blocks";
import { PHOTOS, PLATFORM_FEATURES, SOLUTIONS, TRACE_STEPS } from "./content";
import { TraceSearch } from "./trace-search";

function Hero() {
  return (
    <PhotoHero
      tall
      image={PHOTOS.heroRiceTerraces}
      eyebrow={pt("Truy xuất nguồn gốc nông sản trên blockchain")}
      title={pt("Hành trình nông sản, thông tin có thể đối chiếu.")}
      description={pt("Từ sản xuất, thu hoạch đến chế biến và giao nhận. Quét mã để xem nguồn gốc, nhật ký và bằng chứng được công khai của từng lô.")}
    >
      <TraceSearch className="mt-2 max-w-xl" onDark />
      <p className="text-[14px] text-white/80">
        {["Không cần đăng nhập", "Đọc mã ngay trên thiết bị", "Cảnh báo thu hồi hiển thị riêng"].map((x) => pt(x)).join(" · ")}
      </p>
    </PhotoHero>
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
          description={pt("Vụ sản xuất → Thu hoạch → Lô hàng → Giao nhận. Mỗi bước đều có thời điểm, người thực hiện và trạng thái sổ cái.")}
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
            description={pt("Dữ liệu nghiệp vụ được ghi dấu trên mạng Hyperledger Fabric. Người mua thấy được điều gì đã xác nhận, điều gì đang chờ và cảnh báo nào cần chú ý.")}
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
      <Audiences />
      <Process />
      <Features />
      <ConsumerGuide />
      <Contact />
      <CtaBand />
    </>
  );
}
