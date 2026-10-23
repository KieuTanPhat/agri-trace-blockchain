"use client";
import type {LedgerScreenProps} from "@/lib/ledger/route-input";
import {LedgerRouteScreen} from "@/components/ledger/route-screen";
import {useLocale} from "@/components/ledger/locale";
import {OnboardingPage as Workspace} from "@/features/ledger/workspace/coordination";
export default function Screen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="enterprise-onboarding"><Workspace /></LedgerRouteScreen>;}
