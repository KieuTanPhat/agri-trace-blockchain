"use client";
import{OperationsPage}from"@/features/ledger/operations/workspace";
import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-operations"><OperationsPage/></LedgerRouteScreen>;}
