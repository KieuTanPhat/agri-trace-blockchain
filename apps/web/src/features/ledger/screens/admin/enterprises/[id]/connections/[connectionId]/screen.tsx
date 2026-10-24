"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { Guard } from "@/components/ledger/kit/guard";
import { useLocale } from "@/components/ledger/locale";
import { ConnectionDetail } from "../../../connection-detail";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen
      route={route}
      name="admin-enterprises-detail-connections-detail"
    >
      <Guard permission="enrollment.read">
        <ConnectionDetail
          id={String(route.params.id)}
          connectionId={String(route.params.connectionId)}
        />
      </Guard>
    </LedgerRouteScreen>
  );
}
