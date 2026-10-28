"use client";
import {Button} from "@/components/ledger/ui/button";
import "./globals.css";
export default function GlobalError({reset}:{error:Error;reset:()=>void}){return <html lang="vi"><body><main className="mx-auto flex min-h-dvh max-w-3xl flex-col items-start justify-center gap-4 px-5"><span className="font-mono text-xs text-brand">AGRITRACE</span><h1 className="text-2xl font-semibold">Ứng dụng gặp lỗi</h1><p className="text-sm text-ink-2">Vui lòng tải lại màn hình để tiếp tục.</p><Button onClick={reset}>Thử lại</Button></main></body></html>;}
