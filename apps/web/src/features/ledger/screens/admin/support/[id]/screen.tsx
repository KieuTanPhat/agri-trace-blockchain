"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { Guard } from "@/components/ledger/kit/guard";
import { SupportView } from "@/features/ledger/support/workspace";
import { useLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-support-[id]">
      <Guard permission="tickets.read">
        <SupportView detailId={String(route.params.id)} />
      </Guard>
    </LedgerRouteScreen>
  );
}
