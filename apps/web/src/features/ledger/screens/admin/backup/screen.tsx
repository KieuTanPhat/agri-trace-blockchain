"use client";import{Backup}from"@/features/ledger/operations/workspace";import{Guard}from"@/components/ledger/kit/guard";import{PageHeader,PageBody}from"@/components/ledger/kit/page";import{t}from"@/lib/ledger/i18n";function Content(){return <Guard permission="backup.read"><PageHeader title={t("Sao lưu")}/><PageBody><Backup/></PageBody></Guard>;}
import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-backup"><Content/></LedgerRouteScreen>;}
