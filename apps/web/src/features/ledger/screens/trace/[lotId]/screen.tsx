"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {useLocale} from "@/components/ledger/locale";
import Workspace from "@/features/ledger/public/trace";
export default function Screen({route}:LedgerScreenProps){useLocale();return <Workspace token={String(route.params.lotId??"")}/>;}
