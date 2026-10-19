import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import "@/styles/tokens.css";
import "@/styles/base.css";
import "@/styles/motion.css";
import "@/styles/app.css";
import "@/styles/site.css";
import "@/styles/workspace.css";
import "@/styles/manager.css";
import "@/styles/refinement.css";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import { AuthProvider } from "@/lib/auth-store";
import { AppFrame } from "@/components/app-frame";
import { ConfirmProvider } from "@/lib/confirm";

// Inter is downloaded at build time and served from this origin.
const inter = Inter({
  subsets: ["latin", "vietnamese"],
  display: "swap",
  variable: "--font-inter",
});

const siteOrigin = new URL(
  process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace",
).origin;

export const metadata: Metadata = {
  metadataBase: new URL(siteOrigin),
  title: "AgriTrace | Truy xuất nguồn gốc nông sản Việt",
  description:
    "Truy xuất nguồn gốc nông sản Việt: một mã QR cho mỗi lô, hành trình minh bạch và bằng chứng đối chiếu trên chuỗi khối.",
  manifest: "/manifest.webmanifest",
  openGraph: {
    title: "AgriTrace | Truy xuất nguồn gốc nông sản Việt",
    description:
      "Biến dữ liệu nông trại thành truy xuất nguồn gốc có thể chứng minh.",
    locale: "vi_VN",
    type: "website",
    images: ["/agritrace/brand/agritrace-logo.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#087a3f",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="vi" className={inter.variable}>
      <body>
        <AuthProvider>
          <RegisterServiceWorker />
          <ConfirmProvider>
            <AppFrame>{children}</AppFrame>
          </ConfirmProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
