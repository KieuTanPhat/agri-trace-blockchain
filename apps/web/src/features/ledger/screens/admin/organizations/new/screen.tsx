"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { Guard } from "@/components/ledger/kit/guard";
import { useLocale } from "@/components/ledger/locale";
import { CreateAuditorOrganization } from "../create-organization";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-organizations-new">
      <Guard permission="directory.read">
        <CreateAuditorOrganization />
      </Guard>
    </LedgerRouteScreen>
  );
}
