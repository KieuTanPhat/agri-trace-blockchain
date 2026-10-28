"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale } from "@/components/ledger/locale";
import MembersPage from "@/features/ledger/workspace/members";
export default function LedgerScreen({ route }: LedgerScreenProps) { useLocale(); return <LedgerRouteScreen route={route} name="enterprise-members-invitations"><MembersPage view="invitations" memberId={typeof route.params.id === "string" ? route.params.id : undefined}/></LedgerRouteScreen>; }
