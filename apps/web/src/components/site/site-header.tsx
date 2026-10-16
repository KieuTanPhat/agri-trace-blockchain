"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { Menu, ScanLine, X } from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";

const links = [
  { href: "/#solution", label: "Giải pháp" },
  { href: "/#how", label: "Cách hoạt động" },
  { href: "/#integrity", label: "Toàn vẹn dữ liệu" },
  { href: "/scan", label: "Quét QR" },
  { href: "/#contact", label: "Liên hệ" },
  { href: "/register", label: "Đăng ký doanh nghiệp" },
];

/** Public header shared by the landing page, the QR scanner, trace pages and login. */
export function SiteHeader() {
  const [open, setOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const menuButton = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 8);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  return (
    <header className="site-header" data-scrolled={scrolled}>
      <div className="container site-header-inner">
        <Link className="brand" href="/" aria-label="AgriTrace — Trang chủ">
          <BrandLogo height={44} priority />
        </Link>
        <nav className="site-nav" aria-label="Điều hướng chính">
          {links.map(({ href, label }) => (
            <Link href={href} key={href}>
              {label}
            </Link>
          ))}
        </nav>
        <div className="site-header-actions">
          <Link className="button accent small" href="/#contact">
            Liên hệ tư vấn
          </Link>
          <button
            className="icon-button site-menu-button"
            ref={menuButton}
            type="button"
            aria-label={open ? "Đóng menu" : "Mở menu"}
            aria-expanded={open}
            aria-controls="site-mobile-nav"
            onClick={() => setOpen(!open)}
          >
            {open ? <X size={20} /> : <Menu size={20} />}
          </button>
        </div>
      </div>
      <nav
        id="site-mobile-nav"
        className="site-mobile-nav"
        aria-label="Điều hướng di động"
        hidden={!open}
        onKeyDown={(event) => {
          if (event.key === "Escape") {
            setOpen(false);
            menuButton.current?.focus();
          }
        }}
      >
        {links.map(({ href, label }) => (
          <Link href={href} key={href} onClick={() => setOpen(false)}>
            {href === "/scan" && <ScanLine size={18} />}
            {label}
          </Link>
        ))}
      </nav>
    </header>
  );
}
