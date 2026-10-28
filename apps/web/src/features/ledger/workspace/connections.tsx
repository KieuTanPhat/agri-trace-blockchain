"use client";
import {useState} from "react";
import {z} from "zod";
import {useAuth} from "@/lib/auth-store";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import {wapi} from "@/lib/ledger/enterprise-coordination-api";
import {statusLabels,errorLabels} from "@/lib/enterprise-onboarding";
import {t as tr} from "@/lib/ledger/i18n";
import {CommandForm} from "@/components/ledger/kit/command-dialog";
import {TextField,TextAreaField,SelectField} from "@/components/ledger/kit/form-fields";
import {PageHeader,PageBody,Section,Callout,ErrorState,LoadingRows,Fields,Field} from "@/components/ledger/kit/page";
const schema=z.object({chainId:z.uuid(),peerHost:z.string().max(253),peerPort:z.union([z.literal(""),z.coerce.number<number>().int().min(1).max(65535)]),peerServerName:z.string().max(253),mspId:z.string().max(100),tlsCaPem:z.string().max(16384).refine(v=>!v.includes("PRIVATE KEY"),{error:()=>tr("Chỉ nhập chứng thư TLS công khai")})});
export default function ConnectionsPage(){
 const {user}=useAuth(),[id]=useState(()=>crypto.randomUUID()),q=useQuery({queryKey:["ws-enrollment"],queryFn:wapi.enrollment}),chains=useQuery({queryKey:["ws-owned-chains"],queryFn:wapi.connectionChains});
 if(q.error||chains.error)return <ErrorState error={q.error??chains.error}/>;if(!q.data)return <LoadingRows/>;
 const row=q.data,available=(chains.data??[]).filter(c=>c.ownerOrganizationId===user?.organizationId && !row.connections.some(x=>x.chainId===c.id && !["REJECTED","FAILED"].includes(x.status))),self=row.hostingMode==="SELF_MANAGED_ORG";
 return <><PageHeader title={tr("Kết nối doanh nghiệp")} description={tr("Theo dõi kiểm chứng kết nối cho các chuỗi do doanh nghiệp sở hữu.")}/><PageBody className="min-w-0">{row.connections.map(c=><Section key={c.id} title={chains.data?.find(x=>x.id===c.chainId)?.name ?? c.chainId}><Fields cols={2}><Field label={tr("Trạng thái")}>{statusLabels[c.status]??c.status}</Field><Field label={tr("Giao dịch kiểm chứng")} mono>{c.txId??"—"}</Field><Field label={tr("Ghi chú")}>{c.reviewNote}</Field><Field label={tr("Kết quả kiểm chứng")}>{c.errorCode?errorLabels[c.errorCode]??c.errorCode:"—"}</Field></Fields></Section>)}{available.length && row.status==="APPROVED" ? <Section title={tr("Yêu cầu kết nối")} bodyClassName="p-4"><CommandForm title={tr("Yêu cầu kiểm chứng")} endpoint="POST /enterprise-connections" schema={schema} defaultValues={{chainId:available[0].id,peerHost:"",peerPort:"",peerServerName:"",mspId:"",tlsCaPem:""}} submitLabel={tr("Yêu cầu kết nối")} invalidate={[["ws-enrollment"]]} run={(v,cmd)=>wapi.connect({id,chainId:v.chainId,...(self?{peerHost:v.peerHost,peerPort:typeof v.peerPort==="number"?v.peerPort:undefined,peerServerName:v.peerServerName,mspId:v.mspId,tlsCaPem:v.tlsCaPem}: {})},cmd)}>{f=><><SelectField control={f.control} name="chainId" label={tr("Chuỗi")} options={available.map(c=>({value:c.id,label:c.name}))}/>{self && <><TextField control={f.control} name="peerHost" label="Peer host"/><TextField control={f.control} name="peerPort" label="Peer port" type="number"/><TextField control={f.control} name="peerServerName" label="TLS server name"/><TextField control={f.control} name="mspId" label="MSP ID"/><TextAreaField control={f.control} name="tlsCaPem" label={tr("Chứng thư TLS công khai (PEM)")} rows={5}/></>}</>}</CommandForm></Section>:<Callout>{tr("Chưa có chuỗi đủ điều kiện để gửi yêu cầu kết nối mới.")}</Callout>}</PageBody></>;
}
