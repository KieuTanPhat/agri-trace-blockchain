"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { PrivacyView } from "@/features/ledger/privacy/workspace";
import { useLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="account-privacy">
      <PrivacyView admin={false} />
    </LedgerRouteScreen>
  );
}
