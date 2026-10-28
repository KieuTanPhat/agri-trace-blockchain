"use client";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale } from "@/components/ledger/locale";
import Content from "@/features/ledger/workspace/home";
export default function LedgerScreen({ route }: LedgerScreenProps) { useLocale(); return <LedgerRouteScreen route={route} name="enterprise"><Content/></LedgerRouteScreen>; }
