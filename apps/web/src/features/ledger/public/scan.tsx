"use client";
import {useState,type FormEvent} from "react";
import {useRouter} from "next/navigation";
import {getTracePath} from "@/lib/trace-input";
import {LedgerPublicShell} from "@/components/ledger/shell/public-shell";
import {CameraScanner} from "@/components/ledger/camera-scanner";
import {PageHeader,PageBody,Section,Callout} from "@/components/ledger/kit/page";
import {Input} from "@/components/ledger/ui/input";
import {Button} from "@/components/ledger/ui/button";
import {t} from "@/lib/ledger/i18n";
export default function Scan(){const router=useRouter(),[code,setCode]=useState(""),[error,setError]=useState("");function submit(e:FormEvent){e.preventDefault();const path=getTracePath(code);if(!path){setError(t("Nhập mã trên QR hoặc đường dẫn /trace/<token> hợp lệ."));return;}router.push(path);}return <LedgerPublicShell><PageHeader title={t("Quét mã truy xuất")} description={t("Dùng camera, ảnh mã QR hoặc nhập mã truy xuất trên bao bì.")}/><PageBody className="grid gap-5 md:grid-cols-2"><CameraScanner onTrace={path=>router.push(path)}/><Section title={t("Nhập mã thủ công")} bodyClassName="p-5"><form aria-label="Tra cứu nông sản" onSubmit={submit} className="flex flex-col gap-3"><label htmlFor="public-trace-input" className="text-sm">{t("Mã truy xuất hoặc đường dẫn")}</label><Input id="public-trace-input" value={code} onChange={e=>{setCode(e.target.value);setError("");}} autoComplete="off"/>{error&&<div role="alert"><Callout tone="danger">{error}</Callout></div>}<Button type="submit">{t("Tra cứu")}</Button></form></Section></PageBody></LedgerPublicShell>;}
