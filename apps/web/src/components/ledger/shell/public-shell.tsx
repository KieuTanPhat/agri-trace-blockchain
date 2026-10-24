"use client";
import "./public-site.css";
import { useLayoutEffect, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, Menu, ScanLine } from "lucide-react";
import { businessHref, customerHref } from "@/lib/site-origins";
import { SITE_CONTACT } from "@/lib/site-contact";
import { pt } from "@/lib/ledger/public-i18n";
import { cn } from "@/lib/ledger/utils";
import { LanguageSwitch, useLocale } from "../locale";
import { Button } from "../ui/button";
import { Sheet, SheetContent, SheetDescription, SheetTitle, SheetTrigger } from "../ui/sheet";

const LOGO_RATIO = 720 / 212;

/** Logo cố định theo nền (sáng hoặc tối), không phụ thuộc chế độ tối của khu quản trị. */
export function PublicLogo({ height, onDark, priority }: { height: number; onDark?: boolean; priority?: boolean }) {
  return (
    <Image
      src={onDark ? "/brand/agritrace-logo-on-dark.png" : "/brand/agritrace-logo.png"}
      alt="AgriTrace"
      width={Math.round(height * LOGO_RATIO)}
      height={height}
      priority={priority}
      style={{ height, width: "auto" }}
    />
  );
}

/** Trang công khai chỉ có nền sáng: tạm gỡ `.dark` của khu quản trị, trả lại khi rời trang. */
export function useForceLight() {
  useLayoutEffect(() => {
    const root = document.documentElement;
    const wasDark = root.classList.contains("dark");
    root.classList.remove("dark");
    return () => {
      if (wasDark) root.classList.add("dark");
    };
  }, []);
}

const SOLUTION_LINKS = [
  { href: customerHref("/solutions"), label: "Giải pháp theo vai trò" },
  { href: customerHref("/solutions#bang-gia"), label: "Bảng giá" },
  { href: businessHref("/register"), label: "Đăng ký doanh nghiệp" },
];

function isActive(path: string, href: string) {
  return href === "/" ? path === "/" : path === href || path.startsWith(`${href}/`);
}

const navLink = "rounded-md px-3.5 py-2 text-[15px] font-medium whitespace-nowrap transition-colors hover:text-brand";

function DesktopNav({ path }: { path: string }) {
  const link = (href: string, label: string) => (
    <Link href={customerHref(href)} aria-current={isActive(path, href) ? "page" : undefined} className={cn(navLink, isActive(path, href) ? "text-brand" : "text-ink")}>
      {pt(label)}
    </Link>
  );
  return (
    <nav aria-label={pt("Điều hướng chính")} className="hidden items-center gap-1 lg:flex">
      {link("/", "Trang chủ")}
      {link("/about", "Giới thiệu")}
      <div className="group relative">
        <Link
          href={customerHref("/solutions")}
          aria-current={isActive(path, "/solutions") ? "page" : undefined}
          aria-haspopup="true"
          className={cn(navLink, "inline-flex items-center gap-1", isActive(path, "/solutions") ? "text-brand" : "text-ink")}
        >
          {pt("Giải pháp")}
          <ChevronDown className="size-4 transition-transform group-hover:rotate-180 group-focus-within:rotate-180" aria-hidden />
        </Link>
        <div className="invisible absolute top-full left-0 z-40 pt-2 opacity-0 transition-opacity group-focus-within:visible group-focus-within:opacity-100 group-hover:visible group-hover:opacity-100">
          <ul className="w-60 rounded-xl border border-line bg-card p-2 shadow-xl">
            {SOLUTION_LINKS.map((l) => (
              <li key={l.label}>
                <Link href={l.href} className="block rounded-lg px-3 py-2.5 text-[14px] text-ink hover:bg-brand-weak hover:text-brand-ink">
                  {pt(l.label)}
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
      {link("/contact", "Liên hệ")}
    </nav>
  );
}

function MobileNav({ path }: { path: string }) {
  const [open, setOpen] = useState(false);
  const item = (href: string, label: string, sub?: boolean) => (
    <Link
      key={label}
      href={href}
      onClick={() => setOpen(false)}
      className={cn("rounded-md px-3 py-2.5 hover:bg-brand-weak", sub ? "pl-7 text-[14px] text-ink-2" : "text-[15px] font-medium", !sub && isActive(path, new URL(href, "http://x").pathname) ? "text-brand" : !sub && "text-ink")}
    >
      {pt(label)}
    </Link>
  );
  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button variant="ghost" size="icon" className="lg:hidden" aria-label={pt("Mở menu")}>
          <Menu />
        </Button>
      </SheetTrigger>
      <SheetContent side="right" className="pub-site w-[min(320px,86vw)] gap-0 p-0">
        <div className="border-b border-line px-5 py-4">
          <SheetTitle>
            <PublicLogo height={36} />
          </SheetTitle>
          <SheetDescription className="sr-only">{pt("Điều hướng chính")}</SheetDescription>
        </div>
        <nav aria-label={pt("Điều hướng chính")} className="flex flex-col p-3">
          {item(customerHref("/"), "Trang chủ")}
          {item(customerHref("/about"), "Giới thiệu")}
          {item(customerHref("/solutions"), "Giải pháp")}
          {SOLUTION_LINKS.slice(1).map((l) => item(l.href, l.label, true))}
          {item(customerHref("/contact"), "Liên hệ")}
        </nav>
        <div className="mt-auto border-t border-line p-4">
          <Button asChild className="w-full">
            <Link href={customerHref("/scan")} onClick={() => setOpen(false)}>
              {pt("Quét mã truy xuất")}
            </Link>
          </Button>
        </div>
      </SheetContent>
    </Sheet>
  );
}

function Header({ path }: { path: string }) {
  return (
    <header className="sticky top-0 z-30 bg-card/95 shadow-[0_1px_0_var(--line)] backdrop-blur">
      <div className="mx-auto flex h-[72px] max-w-[1280px] items-center justify-between gap-4 px-4 sm:px-7">
        <Link href={customerHref("/")} aria-label="AgriTrace" className="shrink-0">
          <PublicLogo height={46} priority />
        </Link>
        <DesktopNav path={path} />
        <div className="flex items-center gap-2">
          <LanguageSwitch />
          <Button asChild className="hidden sm:inline-flex">
            <Link href={customerHref("/scan")}>
              <ScanLine />
              {pt("Quét mã")}
            </Link>
          </Button>
          <MobileNav path={path} />
        </div>
      </div>
    </header>
  );
}

function Footer() {
  const columns = [
    {
      title: "Về AgriTrace",
      links: [
        { href: customerHref("/about"), label: "Giới thiệu" },
        { href: customerHref("/contact"), label: "Liên hệ" },
        { href: customerHref("/scan"), label: "Quét mã truy xuất" },
      ],
    },
    {
      title: "Giải pháp",
      links: [
        ...SOLUTION_LINKS,
        { href: businessHref("/login"), label: "Đăng nhập doanh nghiệp" },
      ],
    },
    {
      title: "Chính sách",
      links: [
        { href: "/terms", label: "Điều khoản" },
        { href: "/privacy", label: "Quyền riêng tư" },
      ],
    },
  ];
  return (
    <footer className="bg-(--pub-deep) text-(--pub-on-deep-2)">
      <div className="mx-auto grid max-w-[1280px] gap-10 px-4 py-14 sm:px-7 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
        <div className="flex flex-col gap-4">
          <PublicLogo height={48} onDark />
          <p className="max-w-sm text-[14px] leading-relaxed">
            {pt("Nền tảng truy xuất nguồn gốc nông sản: dữ liệu sản xuất, thu hoạch, lô hàng và giao nhận được ghi nhận và đối chiếu trên sổ cái.")}
          </p>
          <div className="flex flex-col gap-1 text-[14px]">
            <a href={SITE_CONTACT.emailUrl} className="w-fit hover:text-white">
              {SITE_CONTACT.email}
            </a>
            <a href={SITE_CONTACT.zaloUrl} className="w-fit hover:text-white">
              Zalo {SITE_CONTACT.zaloPhone}
            </a>
          </div>
        </div>
        {columns.map((c) => (
          <div key={c.title} className="flex flex-col gap-3">
            <h2 className="text-[13px] font-semibold tracking-wide text-white uppercase">{pt(c.title)}</h2>
            <ul className="flex flex-col gap-2 text-[14px]">
              {c.links.map((l) => (
                <li key={l.label}>
                  <Link href={l.href} className="hover:text-white">
                    {pt(l.label)}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10">
        <div className="mx-auto flex max-w-[1280px] flex-wrap items-center justify-between gap-3 px-4 py-4 text-[12px] sm:px-7">
          <span>© {new Date().getFullYear()} AgriTrace</span>
          <span>{pt("Ảnh minh họa: Unsplash")}</span>
        </div>
      </div>
    </footer>
  );
}

/** Khung chung của trang công khai; đặt trong layout để header không dựng lại khi chuyển trang. */
export function LedgerPublicShell({ children }: { children: React.ReactNode }) {
  useLocale();
  useForceLight();
  const path = usePathname() ?? "/";
  return (
    <div className="pub-site flex min-h-dvh flex-col">
      <a href="#public-main" className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-card focus:px-3 focus:py-2">
        {pt("Bỏ qua tới nội dung")}
      </a>
      <Header path={path} />
      <main id="public-main" className="flex min-w-0 flex-1 flex-col">
        {children}
      </main>
      <Footer />
    </div>
  );
}
