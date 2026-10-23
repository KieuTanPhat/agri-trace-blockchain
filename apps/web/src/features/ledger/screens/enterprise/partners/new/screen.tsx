"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {LedgerRouteScreen} from "@/components/ledger/route-screen";
import {useLocale} from "@/components/ledger/locale";
import Workspace from "@/features/ledger/workspace/partners";
export default function Screen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="enterprise-partners-new"><Workspace view="new" externalMode={route.searchParams.mode==="external"}/></LedgerRouteScreen>;}
