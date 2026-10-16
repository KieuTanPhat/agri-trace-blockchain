import Link from "next/link";
import { Mail, MessageCircle } from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { SITE_CONTACT } from "@/lib/site-contact";

export function SiteFooter() {
  return (
    <footer className="site-footer">
      <div className="container site-footer-grid">
        <div className="site-footer-brand">
          <BrandLogo height={52} />
          <p>Nguồn gốc rõ ràng. Hành trình có thể tra cứu.</p>
        </div>
        <nav aria-label="Liên kết chân trang">
          <h2>Khám phá</h2>
          <Link href="/#solution">Giải pháp</Link>
          <Link href="/#how">Cách hoạt động</Link>
          <Link href="/#integrity">Toàn vẹn dữ liệu</Link>
          <Link href="/scan">Quét mã QR</Link>
        </nav>
        <div id="footer-contact">
          <h2>Liên hệ</h2>
          <a href={SITE_CONTACT.emailUrl}>
            <Mail size={16} /> {SITE_CONTACT.email}
          </a>
          <a href={SITE_CONTACT.zaloUrl} target="_blank" rel="noopener noreferrer">
            <MessageCircle size={16} /> Zalo {SITE_CONTACT.zaloPhone}
          </a>
        </div>
      </div>
      <div className="container site-footer-bottom">
        <span>© 2026 AgriTrace · Truy xuất nguồn gốc nông sản Việt</span>
      </div>
    </footer>
  );
}

/** Floating Zalo shortcut on public pages. */
export function ZaloFloat() {
  return (
    <a
      className="zalo-float"
      href={SITE_CONTACT.zaloUrl}
      target="_blank"
      rel="noopener noreferrer"
      aria-label={`Nhắn Zalo ${SITE_CONTACT.zaloPhone}`}
    >
      <MessageCircle size={22} />
      <span>Zalo</span>
    </a>
  );
}
