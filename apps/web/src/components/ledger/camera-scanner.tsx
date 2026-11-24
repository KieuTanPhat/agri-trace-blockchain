"use client";
import {useEffect} from "react";
import {useCameraScanner} from "@/lib/ledger/use-camera-scanner";
import {Button} from "./ui/button";
import {Callout} from "./kit/page";
import {pt as t} from "@/lib/ledger/public-i18n";
/** autoStart opens the camera at once (the dialog was opened by a click). */
export function CameraScanner({onTrace,autoStart=false}:{onTrace(path:string):void;autoStart?:boolean}){const c=useCameraScanner({onTrace});
// eslint-disable-next-line react-hooks/exhaustive-deps
useEffect(()=>{if(autoStart)void c.start();},[]);return <section className="flex flex-col gap-3 rounded-md border border-line bg-card p-4"><h2 className="text-base font-semibold">{t("Quét bằng camera")}</h2><p className="text-sm text-ink-2">{t("Camera chỉ bật khi bạn cho phép. Ảnh QR được đọc tại thiết bị.")}</p><video ref={c.video} aria-label={t("Camera quét QR")} muted playsInline className="aspect-video w-full rounded-md bg-sunken object-cover"/><div className="flex flex-wrap gap-2"><Button disabled={c.phase!=="idle"||c.readingImage} onClick={()=>void c.start()}>{t("Mở camera")}</Button><Button variant="outline" disabled={c.phase==="idle"} onClick={()=>{c.release();c.setPhase("idle");c.setMessage("");}}>{t("Tắt camera")}</Button><Button variant="outline" disabled={c.readingImage} onClick={()=>c.fileInput.current?.click()}>{t("Chọn ảnh mã QR")}</Button></div><input ref={c.fileInput} type="file" accept="image/png,image/jpeg,image/webp,image/gif" className="sr-only" aria-label={t("Chọn ảnh mã QR")} onChange={e=>{void c.readImage(e.target.files?.[0]);e.target.value="";}}/>{c.message&&<div role="status"><Callout tone="info">{t(c.message)}</Callout></div>}</section>;}
