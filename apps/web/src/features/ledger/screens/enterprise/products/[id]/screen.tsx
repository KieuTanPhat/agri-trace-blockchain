"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {LedgerRouteScreen} from "@/components/ledger/route-screen";
import {useLocale} from "@/components/ledger/locale";
import Products from "@/features/ledger/workspace/products";
export default function Screen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="enterprise-products-[id]"><Products view="detail" productId={typeof route.params.id==="string"?route.params.id:undefined}/></LedgerRouteScreen>;}
