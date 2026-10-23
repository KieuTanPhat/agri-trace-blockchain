"use client";
import Link from "next/link";
import {LedgerPublicShell} from "@/components/ledger/shell/public-shell";
import {PageHeader,PageBody,Section,Callout} from "@/components/ledger/kit/page";
import {legalCopy} from "@/lib/ledger/legal-copy";
import {t} from "@/lib/ledger/i18n";
export default function Legal({kind}:{kind:"privacy"|"terms"}){const start=kind==="privacy"?2:10;return <LedgerPublicShell><PageHeader title={kind==="privacy"?t("Quyền riêng tư"):t("Điều khoản")}/><PageBody className="max-w-4xl"><p className="font-mono text-xs text-ink-2">{legalCopy[0]}</p><Callout tone="info">{legalCopy[1]}</Callout>{[0,1,2,3].map(i=><Section key={i} title={legalCopy[start+i*2]} bodyClassName="p-5 text-sm leading-relaxed">{legalCopy[start+i*2+1]}</Section>)}<Link href="/register" className="text-sm text-brand underline">{t("Về biểu mẫu đăng ký")}</Link></PageBody></LedgerPublicShell>;}
