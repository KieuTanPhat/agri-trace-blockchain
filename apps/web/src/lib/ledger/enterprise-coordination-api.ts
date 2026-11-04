import type {components} from "../generated/api";
import {ledgerRequest} from "./request";
import {wapi as workspace} from "./workspace-api";
import type {LedgerCommandContext} from "./command-context";
import type {Partner,ExternalPartner,PartnerSearchItem,Billing,MessageList,MessageThread} from "./coordination-types";
type S=components["schemas"];
const items=async<T,>(p:string)=>(await ledgerRequest<{items:T[]}>(p)).items;
const post=<T=unknown,>(path:string,body:unknown,cmd:LedgerCommandContext)=>ledgerRequest<T>(path,{method:"POST",headers:{"Idempotency-Key":cmd.idempotencyKey},body:JSON.stringify(body)});
export const wapi={...workspace,
 partners:()=>items<Partner>("/enterprise-workspace/partners"),externalPartners:()=>items<ExternalPartner>("/enterprise-workspace/partners/external"),
 searchPartners:(q:string)=>items<PartnerSearchItem>("/enterprise-workspace/partners/search?q="+encodeURIComponent(q)),
 partnerDirectory:(cursor?:string)=>ledgerRequest<S["PartnerDirectoryPageDto"]>("/enterprise-workspace/partners/directory"+(cursor?"?cursor="+encodeURIComponent(cursor):"")),
 partnerProfile:(id:string)=>ledgerRequest<S["PartnerDirectoryProfileDto"]>("/enterprise-workspace/partners/directory/"+encodeURIComponent(id)),
 invitePartner:(input:S["EnterprisePartnerInput"],cmd:LedgerCommandContext)=>post("/enterprise-workspace/partners",input,cmd),
 resolvePartner:(id:string,input:S["EnterprisePartnerDecision"],cmd:LedgerCommandContext)=>post("/enterprise-workspace/partners/"+encodeURIComponent(id),input,cmd),
 createExternalPartner:(input:S["EnterpriseExternalPartnerInput"],cmd:LedgerCommandContext)=>post("/enterprise-workspace/partners/external",input,cmd),
 billing:()=>ledgerRequest<Billing>("/enterprise-billing"),renew:(input:S["EnterpriseRenewalInput"],cmd:LedgerCommandContext)=>post("/enterprise-billing/renewals",input,cmd),
 paySimulated:(id:string,input:{version:number},cmd:LedgerCommandContext)=>post(`/enterprise-billing/invoices/${encodeURIComponent(id)}/payment-simulation`,input,cmd),
 messages:()=>ledgerRequest<MessageList>("/enterprise-messages"),message:async(id:string)=>(await ledgerRequest<{record:MessageThread}>("/enterprise-messages/"+encodeURIComponent(id))).record,
 sendMessage:async(input:S["MessageThreadInput"],cmd:LedgerCommandContext)=>(await post<{record:{recipients:number}}>("/enterprise-messages",input,cmd)).record,
 readMessage:(id:string,cmd:LedgerCommandContext)=>post(`/enterprise-messages/${encodeURIComponent(id)}/read`,{},cmd),replyMessage:(id:string,input:S["MessageReplyInput"],cmd:LedgerCommandContext)=>post(`/enterprise-messages/${encodeURIComponent(id)}/replies`,input,cmd),
 enrollment:()=>ledgerRequest<S["EnterpriseEnrollmentViewDto"]>("/enterprise-enrollments/mine"),
 service:()=>ledgerRequest<S["ServiceWorkspaceView"]>("/enterprise-service"),previewService:(input:S["ServiceQuoteInput"],cmd:LedgerCommandContext)=>post<S["ServicePreviewView"]>("/enterprise-service/preview",input,cmd),
 orderService:(input:S["ServiceOrderInput"],cmd:LedgerCommandContext)=>post("/enterprise-service/orders",input,cmd),
 upgradeToChainOwner:(input:S["ParticipationUpgradeInput"],cmd:LedgerCommandContext)=>post<S["ParticipationUpgradeView"]>("/enterprise-service/upgrade",input,cmd),
 requestCapability:(input:S["CapabilityAddInput"],cmd:LedgerCommandContext)=>post<S["CapabilityAddView"]>("/capability-requests",input,cmd),payService:(input:S["ServicePaymentInput"],cmd:LedgerCommandContext)=>post("/enterprise-service/payment-simulation",input,cmd),
 traceReports:()=>ledgerRequest<{lots:{lotId:string;lotCode:string;productName:string}[]}>("/distribution/reports"),notice:(input:S["TraceNoticeInput"],cmd:LedgerCommandContext)=>post("/distribution/notices",input,cmd),
};
