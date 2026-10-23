"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { Guard } from "@/components/ledger/kit/guard";
import { useLocale } from "@/components/ledger/locale";
import { PlatformUsers } from "../screen";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-users-detail">
      <Guard permission="users.read">
        <PlatformUsers accountId={String(route.params.id)} />
      </Guard>
    </LedgerRouteScreen>
  );
}
