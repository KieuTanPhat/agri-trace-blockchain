import type { Metadata, Viewport } from "next";
import Link from "next/link";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import { AuthProvider } from "@/lib/auth-store";

export const metadata: Metadata = {
  title: "Truy xuất nông sản",
  description: "Giao diện truy xuất nguồn gốc nông sản ứng dụng chuỗi khối.",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  themeColor: "#285c45",
  width: "device-width",
  initialScale: 1
};

const navItems = [
  { href: "/", label: "Tổng quan" },
  { href: "/batches", label: "Lô nông sản" },
  { href: "/scan", label: "Quét QR" },
  { href: "/iot-simulator", label: "IoT giả lập" },
  { href: "/components", label: "Giao diện mẫu" }
];

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <AuthProvider>
          <RegisterServiceWorker />
          <div className="app-shell">
            <header className="topbar">
              <Link className="brand" href="/">
                <span className="brand-mark">A</span>
                <span>Truy xuất nông sản</span>
              </Link>
              <div className="topbar-meta">
                <span>Vai trò mẫu: FARM_STAFF</span>
                <span>Đơn vị: HTX Rau Sạch Củ Chi</span>
              </div>
            </header>
            <div className="layout">
              <aside className="sidebar">
                <div className="sidebar-heading">Khu vực làm việc</div>
                <nav className="nav-list" aria-label="Điều hướng chính">
                  {navItems.map((item) => (
                    <Link className="nav-link" href={item.href} key={item.href}>
                      {item.label}
                    </Link>
                  ))}
                </nav>
              </aside>
              <main className="content">{children}</main>
            </div>
          </div>
        </AuthProvider>
      </body>
    </html>
  );
}
