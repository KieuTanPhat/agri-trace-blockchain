"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale } from "@/components/ledger/locale";
import RolesPage from "@/features/ledger/workspace/roles";
export default function LedgerScreen({ route }: LedgerScreenProps) { useLocale(); return <LedgerRouteScreen route={route} name="enterprise-roles-[id]"><RolesPage roleId={typeof route.params.id === "string" ? route.params.id : undefined}/></LedgerRouteScreen>; }
