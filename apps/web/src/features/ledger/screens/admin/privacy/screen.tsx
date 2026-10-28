"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { Guard } from "@/components/ledger/kit/guard";
import { PrivacyView } from "@/features/ledger/privacy/workspace";
import { useLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-privacy">
      <Guard permission="privacy.read">
        <PrivacyView admin={true} />
      </Guard>
    </LedgerRouteScreen>
  );
}
