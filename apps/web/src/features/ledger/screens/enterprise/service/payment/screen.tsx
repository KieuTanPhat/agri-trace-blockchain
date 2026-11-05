"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {LedgerRouteScreen} from "@/components/ledger/route-screen";
import {useLocale} from "@/components/ledger/locale";
import Workspace from "@/features/ledger/workspace/service";
export default function Screen({route}:LedgerScreenProps){useLocale();const invoiceId=typeof route.searchParams.invoiceId==="string"?route.searchParams.invoiceId:undefined;return <LedgerRouteScreen route={route} name="enterprise-service-payment"><Workspace view="payment" invoiceId={invoiceId}/></LedgerRouteScreen>;}
