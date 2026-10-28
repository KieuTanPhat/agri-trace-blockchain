"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {useLocale} from "@/components/ledger/locale";
import Workspace from "@/features/ledger/public/home";
export default function Screen({route}:LedgerScreenProps){void route;useLocale();return <Workspace />;}
