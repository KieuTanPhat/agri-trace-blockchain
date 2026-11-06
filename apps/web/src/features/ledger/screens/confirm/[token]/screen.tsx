"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {useLocale} from "@/components/ledger/locale";
import SupplierConfirm from "@/features/ledger/public/supplier-confirm";
export default function Screen({route}:LedgerScreenProps){useLocale();return <SupplierConfirm token={String(route.params.token??"")}/>;}
