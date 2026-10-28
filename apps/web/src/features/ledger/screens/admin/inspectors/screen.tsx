"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { Guard } from "@/components/ledger/kit/guard";
import { useLocale } from "@/components/ledger/locale";
import { InspectorsView } from "./inspectors-view";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-inspectors">
      <Guard permission="inspectors.read">
        <InspectorsView />
      </Guard>
    </LedgerRouteScreen>
  );
}
