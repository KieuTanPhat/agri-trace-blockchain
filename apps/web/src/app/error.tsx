"use client";
import {LedgerPublicShell} from "@/components/ledger/shell/public-shell";
import {PageBody,Callout} from "@/components/ledger/kit/page";
import {Button} from "@/components/ledger/ui/button";
export default function ErrorScreen({reset}:{error:Error;reset:()=>void}){return <LedgerPublicShell><PageBody><h1 className="text-2xl font-semibold">Ứng dụng gặp lỗi</h1><Callout tone="warn">Không thể hoàn tất việc tải màn hình. Vui lòng thử lại.</Callout><Button onClick={reset} className="self-start">Thử lại</Button></PageBody></LedgerPublicShell>;}
