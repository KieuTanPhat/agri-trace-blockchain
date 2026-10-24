"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {LedgerRouteScreen} from "@/components/ledger/route-screen";
import {useLocale} from "@/components/ledger/locale";
import Workspace from "@/features/ledger/workspace/cycles";
export default function Screen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="production-cycles-new"><Workspace cycleId={typeof route.params.id==="string"?route.params.id:undefined} view="new"/></LedgerRouteScreen>;}
