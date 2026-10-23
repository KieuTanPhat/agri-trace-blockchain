"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {LedgerRouteScreen} from "@/components/ledger/route-screen";
import {useLocale} from "@/components/ledger/locale";
import Workspace from "@/features/ledger/workspace/sites";
export default function Screen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="enterprise-vehicles"><Workspace view="list" resourceId={typeof route.params.id==="string"?route.params.id:undefined} family="vehicles"/></LedgerRouteScreen>;}
