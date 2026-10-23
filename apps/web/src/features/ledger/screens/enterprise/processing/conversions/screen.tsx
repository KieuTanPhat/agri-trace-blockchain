"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {LedgerRouteScreen} from "@/components/ledger/route-screen";
import {useLocale} from "@/components/ledger/locale";
import Workspace from "@/features/ledger/workspace/processing";
export default function Screen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="enterprise-processing-conversions"><Workspace runId={typeof route.params.id==="string"?route.params.id:undefined} view="conversions"/></LedgerRouteScreen>;}
