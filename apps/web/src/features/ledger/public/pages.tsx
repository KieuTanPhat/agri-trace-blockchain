"use client";
import Image from "next/image";
import Link from "next/link";
import { Check } from "lucide-react";
import { businessHref, customerHref } from "@/lib/site-origins";
import { SITE_CONTACT } from "@/lib/site-contact";
import { pt } from "@/lib/ledger/public-i18n";
import { cn } from "@/lib/ledger/utils";
import { Button } from "@/components/ledger/ui/button";
import { Container, CtaBand, PhotoHero, Reveal, SectionHeading } from "./blocks";
import { PHOTOS, PLANS, SOLUTIONS, TRACE_STEPS } from "./content";

function TextCard({ title, children, index, delay }: { title: string; children: React.ReactNode; index?: number; delay?: number }) {
  return (
    <Reveal delay={delay} className="flex h-full flex-col gap-3 rounded-2xl border border-line bg-card p-7">
      {index !== undefined && <span className="text-[13px] font-semibold text-(--pub-accent-ink)">{String(index).padStart(2, "0")}</span>}
      <h3 className="text-[18px] font-semibold">{title}</h3>
      <p className="text-[15px] leading-relaxed text-ink-2">{children}</p>
    </Reveal>
  );
}

export function AboutPage() {
  const values = [
    { title: "Minh bạch đúng phạm vi", copy: "Chỉ công khai thông tin doanh nghiệp cho phép; dữ liệu riêng và liên hệ của người phản ánh không hiển thị." },
    { title: "Trung thực về trạng thái", copy: "Đang chờ, chưa khả dụng hay cảnh báo đều được ghi rõ, không làm tròn thành “đã xác minh”." },
    { title: "Khóa ký thuộc về doanh nghiệp", copy: "Khóa ký số được tạo và giữ trên thiết bị của bên bàn giao, không gửi về máy chủ." },
  ];
  const stack = [
    { title: "Cơ sở dữ liệu nghiệp vụ", copy: "PostgreSQL lưu vụ sản xuất, lô hàng và nhật ký lệnh trong cùng giao dịch với kiểm tra quyền." },
    { title: "Sổ cái Hyperledger Fabric", copy: "Worker chuyên trách gửi dấu dữ liệu lên mạng Fabric nhiều tổ chức và lưu bằng chứng giao dịch." },
    { title: "Trang truy xuất công khai", copy: "Người tiêu dùng đọc bản tóm tắt lô qua mã QR, kèm trạng thái đối chiếu với sổ cái." },
  ];
  return (
    <>
      <PhotoHero
        image={PHOTOS.aboutRiceVillage}
        eyebrow={pt("Giới thiệu")}
        title={pt("Về AgriTrace")}
        description={pt("AgriTrace giúp nông trại, nhà chế biến, đơn vị vận chuyển và bán lẻ cùng ghi nhận hành trình nông sản, để người tiêu dùng có thể tự đối chiếu nguồn gốc.")}
      />
      <section className="py-20">
        <Container className="grid items-start gap-12 lg:grid-cols-2">
          <SectionHeading
            align="left"
            eyebrow={pt("Sứ mệnh")}
            title={pt("Đưa niềm tin vào từng lô nông sản Việt")}
            description={pt("Thay vì một con tem chỉ ghi tên sản phẩm, mỗi mã AgriTrace dẫn tới chuỗi sự kiện có người thực hiện, thời điểm và bằng chứng. Doanh nghiệp làm đúng có cách chứng minh; người mua có cách kiểm tra.")}
          />
          <ol className="flex flex-col gap-4">
            {TRACE_STEPS.map((s, i) => (
              <Reveal as="li" key={s.title} delay={i * 90} className="flex gap-4 rounded-2xl border border-line bg-card p-5">
                <span className="inline-flex size-10 shrink-0 items-center justify-center rounded-full bg-brand text-[15px] font-semibold text-white">{i + 1}</span>
                <div>
                  <h3 className="font-semibold">{pt(s.title)}</h3>
                  <p className="text-[15px] leading-relaxed text-ink-2">{pt(s.copy)}</p>
                </div>
              </Reveal>
            ))}
          </ol>
        </Container>
      </section>
      <section className="bg-card py-20">
        <Container className="flex flex-col gap-12">
          <SectionHeading eyebrow={pt("Giá trị")} title={pt("Nguyên tắc chúng tôi giữ")} />
          <div className="grid gap-6 md:grid-cols-3">
            {values.map((v, i) => (
              <TextCard key={v.title} title={pt(v.title)} delay={i * 90}>
                {pt(v.copy)}
              </TextCard>
            ))}
          </div>
        </Container>
      </section>
      <section className="py-20">
        <Container className="flex flex-col gap-12">
          <SectionHeading eyebrow={pt("Công nghệ")} title={pt("Kiến trúc lai: cơ sở dữ liệu và sổ cái")} description={pt("Lệnh nghiệp vụ được ghi vào cơ sở dữ liệu trước, sau đó dấu dữ liệu mới được đưa lên sổ cái. Hai lớp đối chiếu lẫn nhau.")} />
          <div className="grid gap-6 md:grid-cols-3">
            {stack.map((v, i) => (
              <TextCard key={v.title} title={pt(v.title)} index={i + 1} delay={i * 90}>
                {pt(v.copy)}
              </TextCard>
            ))}
          </div>
        </Container>
      </section>
      <CtaBand />
    </>
  );
}

export function SolutionsPage() {
  return (
    <>
      <PhotoHero image={PHOTOS.teaHills} eyebrow={pt("Giải pháp")} title={pt("Giải pháp truy xuất theo vai trò")} description={pt("Mỗi bên trong chuỗi có không gian làm việc và quyền riêng, dữ liệu nối thành hành trình của lô hàng.")}>
        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg" className="bg-(--pub-accent) text-white hover:bg-(--pub-accent-hover)">
            <Link href={businessHref("/register")}>{pt("Đăng ký doanh nghiệp")}</Link>
          </Button>
          <Button asChild size="lg" variant="outline" className="border-white/40 bg-transparent text-white hover:bg-white/10 hover:text-white">
            <a href="#bang-gia">{pt("Xem bảng giá")}</a>
          </Button>
        </div>
      </PhotoHero>
      <section className="py-20">
        <Container className="flex flex-col gap-16">
          {SOLUTIONS.map((s, i) => (
            <article key={s.slug} id={s.slug} className="grid scroll-mt-28 items-center gap-8 lg:grid-cols-2 lg:gap-14">
              <Reveal className={cn("relative aspect-[16/10] overflow-hidden rounded-3xl", i % 2 && "lg:order-2")}>
                <Image src={s.image} alt="" fill placeholder="blur" sizes="(max-width: 1024px) 100vw, 50vw" className="object-cover" />
              </Reveal>
              <Reveal delay={120} className="flex flex-col gap-4">
                <span className="text-[13px] font-semibold text-(--pub-accent-ink)">{String(i + 1).padStart(2, "0")}</span>
                <h2 className="text-[28px] leading-tight font-semibold tracking-tight">{pt(s.title)}</h2>
                <p className="text-[16px] leading-relaxed text-ink-2">{pt(s.summary)}</p>
                <ul className="flex flex-col gap-2.5">
                  {s.points.map((p) => (
                    <li key={p} className="flex gap-2.5 text-[15px]">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                      {pt(p)}
                    </li>
                  ))}
                </ul>
              </Reveal>
            </article>
          ))}
        </Container>
      </section>
      <section id="bang-gia" className="scroll-mt-20 bg-card py-20">
        <Container className="flex flex-col gap-12">
          <SectionHeading
            eyebrow={pt("Bảng giá")}
            title={pt("Bảng giá dịch vụ")}
            description={pt("Gói dịch vụ được chọn sau khi hồ sơ doanh nghiệp được duyệt. Chi phí phụ thuộc quy mô và số bên tham gia chuỗi, vui lòng liên hệ để nhận báo giá.")}
          />
          <div className="grid gap-6 lg:grid-cols-3">
            {PLANS.map((p, i) => (
              <Reveal as="article" key={p.name} delay={i * 90} className={cn("relative flex flex-col gap-5 rounded-2xl border bg-card p-7", p.highlight ? "border-brand shadow-lg ring-1 ring-brand" : "border-line")}>
                {p.highlight && <span className="absolute -top-3 left-7 rounded-full bg-(--pub-accent) px-3 py-0.5 text-[12px] font-semibold text-white">{pt("Phổ biến")}</span>}
                <div className="flex flex-col gap-1.5">
                  <h3 className="text-xl font-semibold">{pt(p.name)}</h3>
                  <p className="text-[14px] text-ink-2">{pt(p.audience)}</p>
                </div>
                <p className="text-2xl font-semibold text-brand">{pt("Liên hệ báo giá")}</p>
                <ul className="flex flex-1 flex-col gap-2.5">
                  {p.features.map((f) => (
                    <li key={f} className="flex gap-2.5 text-[14px]">
                      <Check className="mt-0.5 size-4 shrink-0 text-brand" aria-hidden />
                      {pt(f)}
                    </li>
                  ))}
                </ul>
                <Button asChild size="lg" variant={p.highlight ? "default" : "outline"}>
                  <Link href={businessHref("/register")}>{pt("Đăng ký doanh nghiệp")}</Link>
                </Button>
              </Reveal>
            ))}
          </div>
          <p className="text-center text-[14px] text-ink-2">
            {pt("Trang truy xuất cho người tiêu dùng luôn miễn phí. Gói dịch vụ chỉ áp dụng cho doanh nghiệp ghi dữ liệu.")}{" "}
            <Link href={customerHref("/contact")} className="font-medium text-brand underline underline-offset-4">
              {pt("Nhận tư vấn")}
            </Link>
          </p>
        </Container>
      </section>
    </>
  );
}

export function ContactPage() {
  const channels = [
    { label: "Email", value: SITE_CONTACT.email, href: SITE_CONTACT.emailUrl, note: "Tư vấn triển khai, báo giá và hỗ trợ kỹ thuật." },
    { label: "Zalo", value: SITE_CONTACT.zaloPhone, href: SITE_CONTACT.zaloUrl, note: "Trao đổi nhanh trong giờ làm việc." },
  ];
  return (
    <>
      <PhotoHero image={PHOTOS.teaLeaves} eyebrow={pt("Liên hệ")} title={pt("Liên hệ AgriTrace")} description={pt("Chúng tôi hỗ trợ doanh nghiệp đăng ký, triển khai truy xuất và giải đáp thắc mắc của người tiêu dùng.")} />
      <section className="py-20">
        <Container className="grid gap-8 lg:grid-cols-[1.2fr_1fr]">
          <div className="grid gap-6 sm:grid-cols-2">
            {channels.map((c, i) => (
              <Reveal key={c.label} delay={i * 90}>
                <a href={c.href} className="group flex h-full flex-col gap-2 rounded-2xl border border-line bg-card p-7 transition-shadow hover:shadow-lg">
                  <span className="text-[13px] font-semibold tracking-wide text-(--pub-accent-ink) uppercase">{c.label}</span>
                  <span className="text-[19px] font-semibold break-all group-hover:text-brand">{c.value}</span>
                  <span className="text-[15px] text-ink-2">{pt(c.note)}</span>
                </a>
              </Reveal>
            ))}
          </div>
          <Reveal delay={180} className="flex flex-col gap-4 rounded-2xl bg-(--pub-deep) p-8 text-(--pub-on-deep)">
            <h2 className="text-xl font-semibold text-white">{pt("Bạn cần gì?")}</h2>
            <ul className="flex flex-col gap-3 text-[15px]">
              <li>
                <Link href={customerHref("/solutions")} className="underline-offset-4 hover:text-white hover:underline">
                  {pt("Đăng ký doanh nghiệp tham gia truy xuất")}
                </Link>
              </li>
              <li>
                <Link href={customerHref("/scan")} className="underline-offset-4 hover:text-white hover:underline">
                  {pt("Tra cứu một mã trên bao bì")}
                </Link>
              </li>
            </ul>
            <p className="mt-auto text-[14px] text-(--pub-on-deep-2)">
              {pt("Phản ánh về một lô cụ thể nên gửi ngay trên trang truy xuất của lô đó để doanh nghiệp nhận được đúng thông tin.")}
            </p>
          </Reveal>
        </Container>
      </section>
    </>
  );
}
