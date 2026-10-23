"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {LedgerRouteScreen} from "@/components/ledger/route-screen";
import {useLocale} from "@/components/ledger/locale";
import Workspace from "@/features/ledger/workspace/lots";
export default function Screen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="lots"><Workspace route={route}/></LedgerRouteScreen>;}
