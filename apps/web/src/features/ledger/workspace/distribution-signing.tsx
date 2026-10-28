"use client";
import {useRef,useState} from "react";
import {z} from "zod";
import {useAuth} from "@/lib/auth-store";
import {retryPendingCommand} from "@/lib/api-client";
import {distributionKeyStore,signDistribution,signDistributionReturn} from "@/lib/distribution-signer";
import {signDistributionC2} from "@/lib/distribution-c2";
import {usePendingCommands} from "@/lib/use-pending-commands";
import {ledgerCommandError} from "@/lib/ledger/command-context";
import {distApi} from "@/lib/ledger/dist-api";
import {ledgerRequest} from "@/lib/ledger/request";
import type {TransferDetail,Phase} from "@/lib/ledger/dist-types";
import {CommandForm} from "@/components/ledger/kit/command-dialog";
import {Callout} from "@/components/ledger/kit/page";
import {Button} from "@/components/ledger/ui/button";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ledger/ui/dialog";
import {t as tr} from "@/lib/ledger/i18n";
const schema=z.object({}),operations=["DIST_C2_PREPARE","DIST_C2_SUBMIT","DIST_SIGN","DIST_RETURN_SIGN"] as const;
const prepared=z.object({items:z.array(z.object({intentId:z.string(),operation:z.string(),keyRef:z.string(),expiresAt:z.string(),intent:z.record(z.string(),z.string()),payload:z.record(z.string(),z.string()),intentDigest:z.string(),signedMessage:z.string()}))});
export function DistributionSignature({transfer:t,phase,returnId,props}:{transfer:TransferDetail;phase:Phase|"RETURN";returnId?:string;props:{open:boolean;onOpenChange:(o:boolean)=>void}}){
 const{user}=useAuth(),pending=usePendingCommands(operations),[body,setBody]=useState<unknown>(),[busy,setBusy]=useState(false),[error,setError]=useState(""),[locked,setLocked]=useState(false),preparation=useRef<string|undefined>(undefined),org=user?.organizationId;
 const r=t.returns.find(x=>x.id===returnId),dual=t.handoverMode==="DUAL_SIGNED",allowed=phase==="RETURN"?r?.allowedActions.includes("SIGN_RETURN"):t.allowedActions.includes(phase),endpoint=dual?"POST /distribution/transfers/:id/c2/submit":phase==="RETURN"?"POST /distribution/transfers/:id/returns/:returnId/sign":"POST /distribution/transfers/:id/sign";
 async function prepare(){if(!org||!user||busy||pending&&!preparation.current)return;setBusy(true);setError("");try{
 if(dual){const resume=preparation.current?async()=>prepared.parse(await retryPendingCommand(preparation.current!)):undefined;setBody(await signDistributionC2(t,phase,{id:user.id,organizationId:org},r,resume));preparation.current=undefined;return;}
 const local=await distributionKeyStore.list("distribution",org),active=await distApi.keys(),key=local.find(k=>active.some(a=>a.id===k.id&&a.status==="ACTIVE"));if(!key)throw new Error(tr("Thiết bị chưa có khóa ký đang hoạt động của doanh nghiệp"));const expiresAt=new Date(Date.now()+15*60000).toISOString();
 if(phase==="RETURN"){if(!r)throw new Error(tr("Không tìm thấy chặng trả hàng"));const signature=await signDistributionReturn(r,{returnId:r.id,transferId:t.id,digest:r.digest,organizationId:org,userId:user.id,keyRef:key.id,version:String(r.version),expiresAt});setBody({version:r.version,keyRef:key.id,expiresAt,signature});}
 else{const challenge=await distApi.challenge(t.id);if(!challenge.phases.includes(phase))throw new Error(tr("Bước bàn giao đã thay đổi. Tải lại giao nhận."));const signature=await signDistribution(challenge,{transferId:t.id,phase,organizationId:org,userId:user.id,keyRef:key.id,version:String(t.version),expiresAt});setBody({phase,version:t.version,keyRef:key.id,expiresAt,signature});}
 }catch(cause){const e=ledgerCommandError(cause);preparation.current=e.recoveryId??preparation.current;setError(e.message);}finally{setBusy(false);}}
 if(!org||!user||!allowed)return <Callout tone="warn">{tr("Bạn chưa có quyền ký bước bàn giao này.")}</Callout>;
 return <Dialog open={props.open} onOpenChange={o=>{if(!busy&&!locked)props.onOpenChange(o);}}><DialogContent className="max-h-[92vh] overflow-y-auto"><DialogHeader><DialogTitle>{phase==="RETURN"?tr("Ký trả hàng"):tr("Ký bàn giao")}</DialogTitle><DialogDescription>{tr("Kiểm tra nội dung hiện hành trước khi ký và gửi.")}</DialogDescription></DialogHeader><Callout tone="info">{t.origin} → {t.destination} · v{r?.version??t.version}<ul>{(r?.lines??t.lines).map(l=><li key={l.lotId}>{t.lines.find(x=>x.lotId===l.lotId)?.lotCode} · {l.quantity} {l.unit}</li>)}</ul>{tr("Khóa riêng được giữ trên thiết bị. Máy chủ xác minh chữ ký trước khi chuyển quyền giữ hàng.")}</Callout>{error&&<Callout tone="danger">{error}</Callout>}{body===undefined?<Button disabled={busy||pending&&!preparation.current} onClick={()=>void prepare()}>{preparation.current?tr("Đối soát bước chuẩn bị"):tr("Chuẩn bị chữ ký")}</Button>:<CommandForm title={tr("Gửi chữ ký đã kiểm tra")} endpoint={endpoint} schema={schema} defaultValues={{}} version={r?.version??t.version} submitLabel={tr("Ký và gửi")} onLockChange={setLocked} onDone={()=>props.onOpenChange(false)} invalidate={[["dist-transfer",t.id],["dist-transfers"],["dist-report"],["dist-tasks"]]} run={(_,cmd)=>ledgerRequest(`/distribution/transfers/${t.id}`+(dual?"/c2/submit":phase==="RETURN"?`/returns/${r!.id}/sign`:"/sign"),{method:"POST",headers:{"Idempotency-Key":cmd.idempotencyKey},body:JSON.stringify(body)})}>{()=>null}</CommandForm>}</DialogContent></Dialog>;
}
