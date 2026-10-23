import type {components} from "../generated/api";
import {ledgerRequest} from "./request";
import type {LedgerCommandContext} from "./command-context";
import type {DistKey,StockLot,Transfer,TransferDetail,SiteTransferView,QuarantineCaseView,Printed} from "./dist-types";
type S=components["schemas"];
const root="/distribution",id=(v:string)=>encodeURIComponent(v),items=async<T>(p:string)=>(await ledgerRequest<{items:T[]}>(root+p)).items,record=async<T>(p:string)=>(await ledgerRequest<{record:T}>(root+p)).record;
const post=<T=unknown>(p:string,v:unknown,c:LedgerCommandContext)=>ledgerRequest<T>(root+p,{method:"POST",headers:{"Idempotency-Key":c.idempotencyKey},body:JSON.stringify(v)});
export const distApi={
 report:(query:Record<string,string|number|undefined>={})=>{const q=new URLSearchParams();for(const[k,v]of Object.entries(query))if(v!==undefined&&v!=="")q.set(k,String(v));return ledgerRequest<{lots:StockLot[];transfers:Transfer[];hasNext?:boolean;page?:number}>(root+"/reports"+(q.size?"?"+q:""));},
 qr:()=>ledgerRequest<{lots:StockLot[]}>(root+"/qr"),labelHistory:(v:string)=>items<Printed>("/qr/prints/"+id(v)),printLabels:async(v:S["LabelPrintInput"],c:LedgerCommandContext)=>(await post<{record:Printed}>("/qr/prints",v,c)).record,
 transfers:()=>items<Transfer>("/transfers"),transfer:(v:string)=>record<TransferDetail>("/transfers/"+id(v)),
 keys:()=>items<DistKey>("/keys"),
 tasks:()=>ledgerRequest<{transfers:{transferId:string;action:string;status:string;origin:string;destination:string;role:string;createdAt:string}[];stock:(StockLot&{kind:string})[];counts:Record<string,number>}>(root+"/tasks"),
 options:()=>ledgerRequest<{items:{id:string;organizationId:string;name:string;kind:string}[];vehicles:{id:string;organizationId:string;registration:string;kind:string}[]}>(root+"/options"),
 create:(v:S["TransferInput"],c:LedgerCommandContext)=>post("/transfers",v,c),
 cancel:(v:string,b:S["TransferVersion"],c:LedgerCommandContext)=>post("/transfers/"+id(v)+"/cancel",b,c),
 challenge:(v:string)=>ledgerRequest<S["DistributionChallengeDto"]>(root+"/transfers/"+id(v)+"/challenge"),
 sign:(v:string,b:S["TransferSignature"],c:LedgerCommandContext)=>post("/transfers/"+id(v)+"/sign",b,c),
 submitC2:(v:string,b:S["DistributionC2Submit"],c:LedgerCommandContext)=>post("/transfers/"+id(v)+"/c2/submit",b,c),
 receipt:(v:string,b:S["ActualReceiptInput"],c:LedgerCommandContext)=>post("/transfers/"+id(v)+"/receipt",b,c),
 proposeReturn:(v:string,b:S["ReturnInput"],c:LedgerCommandContext)=>post("/transfers/"+id(v)+"/returns",b,c),
 signReturn:(v:string,r:string,b:S["ReturnSignatureInput"],c:LedgerCommandContext)=>post("/transfers/"+id(v)+"/returns/"+id(r)+"/sign",b,c),
 renewConsent:(v:string,b:S["ConsentRenewInput"],c:LedgerCommandContext)=>post("/transfers/"+id(v)+"/consent-renewal",b,c),
 observe:(v:string,b:S["TransferObservationInput"],c:LedgerCommandContext)=>post("/transfers/"+id(v)+"/journal",b,c),
 allocate:(v:S["SiteAllocationInput"],c:LedgerCommandContext)=>post("/allocations",v,c),quarantine:(v:S["QuarantineInput"],c:LedgerCommandContext)=>post("/quarantine",v,c),dispose:(v:S["HoldingDispositionInput"],c:LedgerCommandContext)=>post("/quantities",v,c),notice:(v:S["TraceNoticeInput"],c:LedgerCommandContext)=>post("/notices",v,c),
 siteTransfers:()=>items<SiteTransferView>("/site-transfers"),createSiteTransfer:(v:S["SiteTransferInput"],c:LedgerCommandContext)=>post("/site-transfers",v,c),
 dispatchSiteTransfer:(v:string,b:S["SiteTransferVersion"],c:LedgerCommandContext)=>post("/site-transfers/"+id(v)+"/dispatch",b,c),receiveSiteTransfer:(v:string,b:S["SiteTransferReceiptInput"],c:LedgerCommandContext)=>post("/site-transfers/"+id(v)+"/receive",b,c),resolveSiteTransfer:(v:string,b:S["SiteTransferResolutionInput"],c:LedgerCommandContext)=>post("/site-transfers/"+id(v)+"/resolve",b,c),cancelSiteTransfer:(v:string,b:S["SiteTransferVersion"],c:LedgerCommandContext)=>post("/site-transfers/"+id(v)+"/cancel",b,c),
 quarantineCases:()=>items<QuarantineCaseView>("/quarantine-cases"),
};
