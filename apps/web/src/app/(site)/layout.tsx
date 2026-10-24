import { LedgerPublicShell } from "@/components/ledger/shell/public-shell";

/** Header/footer công khai nằm ở layout để giữ nguyên khi chuyển giữa các trang. */
export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return <LedgerPublicShell>{children}</LedgerPublicShell>;
}
