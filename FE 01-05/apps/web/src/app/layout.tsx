import type { Metadata, Viewport } from "next";
import "./globals.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import { AuthProvider } from "@/lib/auth-store";
import { AppFrame } from "@/components/app-frame";

export const metadata: Metadata = {
  title: "AgriTrace – Truy xuất nông sản",
  description: "Giao diện truy xuất nguồn gốc nông sản ứng dụng chuỗi khối.",
  manifest: "/manifest.webmanifest"
};

export const viewport: Viewport = {
  themeColor: "#23764f",
  width: "device-width",
  initialScale: 1
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi">
      <body>
        <AuthProvider>
          <RegisterServiceWorker />
          <AppFrame>{children}</AppFrame>
        </AuthProvider>
      </body>
    </html>
  );
}
