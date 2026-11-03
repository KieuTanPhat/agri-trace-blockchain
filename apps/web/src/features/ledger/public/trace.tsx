"use client";
import {useEffect,useState} from "react";
import Link from "next/link";
import Image from "next/image";
import {AlertTriangle} from "lucide-react";
import type {PublicLotTrace} from "@/lib/types";
import {getPublicTrace,getPublicLotPhoto} from "@/lib/api-client";
import {Section,Fields,Field,Callout,ErrorState,LoadingRows} from "@/components/ledger/kit/page";
import {Badge} from "@/components/ledger/kit/status";
import {Button} from "@/components/ledger/ui/button";
import {LOT_STATE_LABEL,LOT_STATE_TONE} from "@/lib/ledger/ops-labels";
import {fmtDate,fmtDateTime,fmtNumber} from "@/lib/ledger/format";
import {pt as t} from "@/lib/ledger/public-i18n";
import {cn} from "@/lib/ledger/utils";
import {Container,PageIntro} from "./blocks";
/** Bước nhật ký chế biến hiển thị công khai (không có người ghi). */
const STEP_LABEL:Record<string,string>={RECEIVING:"Tiếp nhận nguyên liệu",SORTING:"Phân loại",WASHING:"Rửa",PRELIMINARY:"Sơ chế",DRYING:"Sấy",ROASTING:"Rang",MILLING:"Xay / nghiền",FERMENTING:"Lên men",COOKING:"Nấu / chần",FREEZING:"Cấp đông",PACKING:"Đóng gói",QUALITY_CHECK:"Kiểm tra chất lượng",CORRECTION:"Đính chính",OTHER:"Khác"};
import {PublicJourney} from "./journey";
import {ConsumerReport} from "./report";
const proof={VERIFIED:["Đã lưu, không sửa được","ok"],PENDING:["Đang lưu","info"],INTEGRITY_WARNING:["Cần kiểm tra lại","danger"],BLOCKCHAIN_UNAVAILABLE:["Chưa lưu được","warn"]} as const;
const card="rounded-2xl";
/** Cảnh báo của lô bằng lời thường; hết hạn và lệch số lượng đã có ô riêng ở trên. */
const WARNING_LABEL:Record<string,string>={RECALLED:"Lô đang bị thu hồi",DAMAGED:"Lô bị hư hỏng",REJECTED:"Lô bị từ chối nhận",NO_DATA:"Chưa có dữ liệu nhiệt độ, độ ẩm",SENSOR_INTEGRITY_WARNING:"Dữ liệu nhiệt độ, độ ẩm có điểm bất thường",LATE_READINGS:"Một số số đo nhiệt độ, độ ẩm được gửi muộn"};
const SHOWN_ELSEWHERE={EXPIRED:1,QUANTITY_MISMATCH:1,STATE_MISMATCH:1};
export function PublicTraceContent({lot,photo}:{lot:PublicLotTrace;photo?:string|null}){
return <>
<PageIntro eyebrow={t("Kết quả truy xuất")} title={lot.lotName??lot.productName} description={`${lot.productName} · ${lot.lotCode}`}><div className="flex flex-wrap gap-2"><Badge tone={LOT_STATE_TONE[lot.currentState]??"neutral"}>{LOT_STATE_LABEL[lot.currentState]??lot.currentState}</Badge></div></PageIntro>
<Container className="grid min-w-0 gap-6 py-8 lg:grid-cols-[360px_minmax(0,1fr)]">
<aside className="flex min-w-0 flex-col gap-4 lg:sticky lg:top-20 lg:self-start">
{photo&&<div className="relative aspect-[4/3] min-w-0 overflow-hidden rounded-2xl border border-line bg-card"><Image src={photo} alt={lot.productName} fill unoptimized sizes="(max-width: 1024px) 100vw, 360px" className="object-cover"/></div>}
{lot.isExpired&&<Callout tone="danger" title={t("Lô đã hết hạn sử dụng")}>{fmtDate(lot.expiryDate)}</Callout>}
{(!lot.quantityReconciled||!lot.stateReconciled||lot.proofStatus==="INTEGRITY_WARNING")&&<Callout tone="danger">{t("Thông tin lô đang được kiểm tra lại. Hãy cân nhắc trước khi dùng.")}</Callout>}
{lot.notices?.map((n,i)=><Callout key={i} tone={n.kind==="RECALL"?"danger":"warn"} title={n.kind==="RECALL"?t("Thông báo thu hồi"):t("Cảnh báo")}>{n.message}</Callout>)}
{lot.brand&&<Section className={card} title={t("Thương hiệu sản phẩm")} bodyClassName="flex flex-col gap-2 p-5"><p className="text-sm font-semibold">{lot.brand.productName} · {lot.brand.organizationName}</p>{lot.brand.story&&<p className="text-sm text-ink-2">{lot.brand.story}</p>}<p className="text-[12px] text-ink-2">{t("Sản phẩm đã được nền tảng AgriTrace duyệt bản công bố; chủ chuỗi chịu trách nhiệm về thông tin đứng tên.")}</p></Section>}
{lot.sourceTrust&&<Section className={card} title={t("Mức tin cậy nguồn nguyên liệu")} bodyClassName="p-5"><Fields cols={4}><Field label={t("Ghi trên AgriTrace")}>{lot.sourceTrust.selfRecorded}</Field><Field label={t("Nhà cung cấp xác nhận")}>{lot.sourceTrust.supplierConfirmed}</Field><Field label={t("Có chứng từ")}>{lot.sourceTrust.evidenced}</Field><Field label={t("Bên bán tự khai")}>{lot.sourceTrust.declared}</Field></Fields></Section>}
{lot.warnings.filter(w=>!(w in SHOWN_ELSEWHERE)).map((w,i)=><Callout key={i} tone="warn">{WARNING_LABEL[w]?t(WARNING_LABEL[w]):w}</Callout>)}
{lot.productionWarnings?.map((w,i)=><Callout key={i} tone="warn">{w}</Callout>)}
<div className={cn("flex flex-col gap-3 border border-line bg-card p-5",card)}><p className="text-[13px] text-ink-2">{t("Thông tin chưa đúng hoặc nghi hàng giả? Gửi phản ánh để doanh nghiệp và AgriTrace kiểm tra.")}</p><div className="flex flex-wrap items-center gap-3"><ConsumerReport key={lot.traceToken} traceToken={lot.traceToken}/><Button asChild variant="ghost"><Link href="/scan">{t("Quét mã khác")}</Link></Button></div></div>
</aside>
<div className="flex min-w-0 flex-col gap-5">
<Section className={card} title={t("Nguồn gốc lô hàng")}><Fields cols={3}><Field label={t("Tổ chức sản xuất")}>{lot.farmOrg.name}</Field><Field label={t("Mã lô")} mono>{lot.lotCode}</Field><Field label={t("Loại nguồn")}>{lot.originType==="TRANSFORMATION"?t("Chế biến"):t("Thu hoạch")}</Field><Field label={t("Ngày thu hoạch")}>{fmtDateTime(lot.harvestTime)}</Field><Field label={t("Hạn sử dụng")}>{fmtDate(lot.expiryDate)}</Field><Field label={t("Số lượng ban đầu")}>{fmtNumber(lot.initialQuantity)} {lot.unit}</Field>{lot.productionCycle&&<Field label={t("Vụ sản xuất")}>{lot.productionCycle.cycleCode}</Field>}</Fields></Section>
{lot.journey?.length?<PublicJourney groups={lot.journey}/>:(<Section className={card} title={t("Nhật ký truy xuất")} bodyClassName="p-5"><ol className="flex flex-col">{lot.timeline.map((e,i)=>{const[step,stepTone]=proof[e.proofStatus];return <li key={e.eventId} className="relative flex gap-4 pb-6 last:pb-0">{i<lot.timeline.length-1&&<span aria-hidden className="absolute top-7 left-[13px] h-[calc(100%-1.25rem)] w-0.5 bg-line"/>}<span aria-hidden className={cn("relative mt-0.5 inline-flex size-7 shrink-0 items-center justify-center rounded-full ring-4 ring-card",stepTone==="ok"?"bg-brand text-white":"bg-sunken text-ink-2")}><span className="text-[11px] font-semibold">{i+1}</span></span><div className="min-w-0 text-sm"><p className="font-medium break-words">{e.summary}</p><p className="text-xs text-ink-2">{e.actor.organizationName} · {fmtDateTime(e.eventTime)} · {t(step)}</p></div></li>;})}</ol></Section>)}
{lot.processing&&<Section className={card} title={t("Nguồn nguyên liệu và chế biến")} bodyClassName="flex flex-col gap-3 p-5"><p className="text-sm">{lot.processing.processorName} · {lot.processing.code} · {lot.processing.processType}</p><ul className="divide-y divide-line text-sm">{lot.processing.inputs.map((i,n)=><li key={n} className="flex flex-wrap gap-2 py-2"><span className="font-mono">{i.lotCode}</span><span>{i.productName} · {i.producerName}</span><span className="rounded-full bg-brand/10 px-2 text-xs text-brand-ink">{t("Có ký nhận khi bàn giao")}</span><span className="ml-auto">{fmtNumber(i.quantity)} {i.unit}</span></li>)}{(lot.processing.externalInputs as Array<Record<string,unknown>>).map((i,n)=><ExternalSource key={`x${n}`} source={i} />)}</ul>{(lot.processing.steps as Array<Record<string,unknown>>).length>0&&<div className="flex flex-col gap-2"><h3 className="text-sm font-semibold">{t("Các bước chế biến")}</h3><ol className="flex flex-col gap-2 text-sm">{(lot.processing.steps as Array<Record<string,unknown>>).map((s,n)=><li key={n} className="flex flex-col"><span><span className="font-medium">{STEP_LABEL[String(s.step)]?t(STEP_LABEL[String(s.step)]):String(s.step)}</span> · <span className="font-mono text-xs">{fmtDateTime(String(s.occurredAt))}</span>{s.correction?` · ${t("đính chính")}`:""}</span><span className="text-ink-2">{String(s.note)}</span></li>)}</ol></div>}<p className="text-xs text-ink-2">{fmtDateTime(lot.processing.completedAt)}</p></Section>}
{!lot.journey?.length&&lot.shipment&&<Section className={card} title={t("Chuyến hàng")}><Fields><Field label={t("Tuyến")}>{lot.shipment.origin} → {lot.shipment.destination}</Field><Field label={t("Trạng thái")}>{lot.shipment.status}</Field><Field label={t("Lấy hàng")}>{fmtDateTime(lot.shipment.pickupTime)}</Field><Field label={t("Đến nơi")}>{fmtDateTime(lot.shipment.arrivalTime)}</Field><Field label={t("Nhận hàng")}>{fmtDateTime(lot.shipment.receivedTime)}</Field></Fields></Section>}
{!lot.journey?.length&&!!lot.distributionJourney?.length&&<Section className={card} title={t("Hành trình giao nhận")} bodyClassName="divide-y divide-line">{lot.distributionJourney.map((l,i)=><article key={i} className="flex flex-col gap-2 p-5 text-sm"><p className="font-medium">{l.senderName} → {l.carrierName} → {l.receiverName}</p><p>{l.status} · {l.custodyStage} · {l.quantity} {l.unit}</p><p className="text-ink-2">{t("Thực nhận")}: {l.receivedQuantity??"—"} · {t("Đang kiểm đếm")}: {l.pendingQuantity??"—"} · {t("Đã trả")}: {l.returnedQuantity??"—"}</p></article>)}</Section>}
{lot.sensorEvidence.readingCount>0&&<Section className={card} title={t("Nhiệt độ, độ ẩm")}><Fields cols={2}><Field label={t("Thời gian theo dõi")}>{fmtDateTime(lot.sensorEvidence.periodStart)} → {fmtDateTime(lot.sensorEvidence.periodEnd)}</Field><Field label={t("Số lần đo")}>{lot.sensorEvidence.readingCount}</Field></Fields></Section>}
{lot.blockchainProof&&<details className={cn("border border-line bg-card px-5 py-4 text-sm",card)}><summary className="cursor-pointer font-medium">{t("Mã xác thực dành cho người cần kiểm tra kỹ")}</summary><Fields cols={2} className="mt-4"><Field label={t("Mã giao dịch")} className="break-all" mono>{lot.blockchainProof.txId}</Field><Field label={t("Mã kiểm tra")} className="break-all" mono>{lot.blockchainProof.dataHash}</Field><Field label={t("Lưu lúc")}>{fmtDateTime(lot.blockchainProof.recordedAt)}</Field></Fields></details>}
<Section className={card} title={t("Chứng nhận được công khai")} bodyClassName="divide-y divide-line">{lot.certificates.length?lot.certificates.map((c,i)=><article key={i} className="flex flex-col gap-1 p-5 text-sm"><h3 className="font-medium">{c.type} · {c.issuer}</h3><p>{fmtDate(c.issueDate)} → {fmtDate(c.expiryDate)}</p></article>):<p className="p-5 text-sm text-ink-2">{t("Chưa có chứng nhận được công khai")}</p>}</Section>
</div></Container></>;}
export default function Trace({token}:{token:string}){const[state,setState]=useState<{token:string;lot:PublicLotTrace|null;photo:string|null;error:unknown;loading:boolean}>({token,lot:null,photo:null,error:null,loading:true}),[revision,setRevision]=useState(0);useEffect(()=>{let active=true;setState({token,lot:null,photo:null,error:null,loading:true});void getPublicTrace(token).then(async lot=>{if(!active)return;setState({token,lot,photo:null,error:null,loading:false});if(lot){const photo=await getPublicLotPhoto(token);if(active)setState({token,lot,photo,error:null,loading:false});}}).catch(error=>{if(active)setState({token,lot:null,photo:null,error,loading:false});});return()=>{active=false;};},[token,revision]);return <>{state.token!==token||state.loading?<Container className="py-10"><LoadingRows/></Container>:state.error?<Container className="py-10"><ErrorState error={state.error} onRetry={()=>setRevision(v=>v+1)}/></Container>:state.lot?<PublicTraceContent lot={state.lot} photo={state.photo}/>:<Container className="flex flex-col items-start gap-4 py-20"><span className="inline-flex size-14 items-center justify-center rounded-2xl bg-warn-bg text-warn"><AlertTriangle className="size-7" aria-hidden/></span><h1 className="text-2xl font-semibold">{t("Không tìm thấy mã truy xuất")}</h1><p className="text-sm text-ink-2">{t("Kiểm tra lại mã trên bao bì hoặc liên hệ bên cung cấp.")}</p><Button asChild><Link href="/scan">{t("Quét mã khác")}</Link></Button></Container>}</>;}

/** One source bought outside AgriTrace: how far it is verified, and the
 * AgriTrace lot its supplier lot code matched, when the goods left and came back. */
function ExternalSource({ source: i }: { source: Record<string, unknown> }) {
  const origin = i.matchedOrigin as { lotCode: string; productName: string; producerName: string; traceToken: string | null } | null;
  return (
    <li className="flex flex-col gap-1 py-2">
      <span className="flex flex-wrap gap-2">
        <span>{String(i.materialName)}</span>
        <span className="text-ink-2">{t("Nguồn ngoài AgriTrace")} · {String(i.supplierName)}{i.supplierLotCode ? ` · ${t("lô")} ${String(i.supplierLotCode)}` : ""}</span>
        <span className="rounded-full bg-warn/15 px-2 text-xs">{i.trust === "SUPPLIER_CONFIRMED" ? t("Nhà cung cấp đã xác nhận") : t("Bên nhận khai báo, có chứng từ")}</span>
        <span className="ml-auto">{fmtNumber(String(i.quantity))} {String(i.unit)}</span>
      </span>
      {origin && (
        <span className="text-xs text-ink-2">
          {t("Nguồn gốc nối lại: {p0} · {p1} · lô {p2}", { p0: origin.productName, p1: origin.producerName, p2: origin.lotCode })}{" "}
          {origin.traceToken && <a href={`/trace/${origin.traceToken}`} className="text-brand underline">{t("Xem lô gốc")}</a>}
        </span>
      )}
    </li>
  );
}
