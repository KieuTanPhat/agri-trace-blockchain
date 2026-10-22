import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import { LedgerProviders } from "@/components/ledger/providers";
import { RegisterServiceWorker } from "@/components/register-service-worker";
import "./globals.css";
const sans = IBM_Plex_Sans({ subsets: ["latin", "vietnamese"], weight: ["400", "500", "600"], variable: "--font-plex-sans" });
const mono = IBM_Plex_Mono({ subsets: ["latin", "vietnamese"], weight: ["400", "500"], variable: "--font-plex-mono" });
export const metadata: Metadata = { title: { default: "AgriTrace", template: "%s · AgriTrace" }, description: "Truy xuất nguồn gốc nông sản AgriTrace", manifest: "/manifest.webmanifest" };
export default function RootLayout({ children }: { children: React.ReactNode }) {
  return <html lang="vi" suppressHydrationWarning><body className={`${sans.variable} ${mono.variable} font-sans text-[14px]`}><script dangerouslySetInnerHTML={{ __html: "try{var t=localStorage.getItem('agt-admin.theme');if(t==='dark'||(!t&&matchMedia('(prefers-color-scheme: dark)').matches))document.documentElement.classList.add('dark')}catch(e){}" }} /><LedgerProviders>{children}<RegisterServiceWorker /></LedgerProviders></body></html>;
}
