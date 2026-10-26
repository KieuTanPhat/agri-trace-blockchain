import { LedgerAppShell } from "@/components/ledger/shell/app-shell";
export default function Layout({ children }: { children: React.ReactNode }) {
  return <LedgerAppShell>{children}</LedgerAppShell>;
}
