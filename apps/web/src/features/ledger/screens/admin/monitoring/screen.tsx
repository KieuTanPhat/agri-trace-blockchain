"use client";import{Monitoring}from"@/features/ledger/operations/workspace";import{Guard}from"@/components/ledger/kit/guard";import{PageHeader,PageBody}from"@/components/ledger/kit/page";import{t}from"@/lib/ledger/i18n";function Content(){return <Guard permission="monitoring.read"><PageHeader title={t("Giám sát")}/><PageBody><Monitoring/></PageBody></Guard>;}
import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-monitoring"><Content/></LedgerRouteScreen>;}
