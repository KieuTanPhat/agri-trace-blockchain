import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
import type { LedgerCommandContext } from "./command-context";
import type * as V from "./operations-types";
import { api as platform } from "./platform-api";
type S=components["schemas"];
export function queryString(filters:object={}) { const query=new URLSearchParams();for(const [key,value]of Object.entries(filters))if(value!==undefined&&value!==null&&value!=="")query.set(key,String(value));return query.size?"?"+query.toString():""; }
const record=async<T>(url:string)=>(await ledgerRequest<{record:T}>(url)).record;
const items=async<T>(url:string)=>(await ledgerRequest<{items:T[]}>(url)).items;
const post=(url:string,body:unknown,cmd:LedgerCommandContext)=>ledgerRequest<S["AdminRecordDto"]>(url,{method:"POST",headers:{"Idempotency-Key":cmd.idempotencyKey},body:JSON.stringify(body)});
export const api={
 enterprises:{...platform.enterprises,chains:()=>ledgerRequest<{id:string;name:string}[]>("/supply-chains"),organizations:platform.enterprises.organizations},
 ops:{
  summary:(f:V.OpsFilters={})=>ledgerRequest<S["OperationsSummaryDto"]>("/platform-operations/summary"+queryString(f)),
  credentials:(f:V.OpsFilters={})=>ledgerRequest<S["CredentialsOverviewDto"]>("/platform-operations/credentials"+queryString(f)),
  outbox:(f:V.OpsFilters={})=>ledgerRequest<S["OutboxPageDto"]>("/platform-operations/outbox"+queryString(f)),
  holds:(f:V.OpsFilters={})=>ledgerRequest<S["HoldPageDto"]>("/platform-operations/holds"+queryString(f)),
  ledgerJobs:(f:V.OpsFilters={})=>ledgerRequest<S["JobPageDto"]>("/platform-operations/ledger-jobs"+queryString(f)),
  bindingHealth:(f:V.OpsFilters={})=>ledgerRequest<S["HealthPageDto"]>("/platform-operations/binding-health"+queryString(f)),
  mail:(f:V.OpsFilters={})=>ledgerRequest<S["MailPageDto"]>("/platform-operations/mail"+queryString(f)),
  monitoring:()=>record<V.Monitoring>("/platform-admin/monitoring"),backup:()=>record<V.Backup>("/platform-admin/backup"),
  ledger:()=>record<V.LedgerOverview>("/platform-admin/ledger"),ledgerTransactions:(f:{status?:string;q?:string}={})=>items<V.LedgerTx>("/platform-admin/ledger/transactions"+queryString(f)),
  traceReport:(f:{export?:boolean;from?:string;to?:string})=>record<V.TraceReport>("/platform-admin/trace-report"+queryString(f)),
  statistics:()=>record<V.Statistics>("/platform-admin/statistics"),security:()=>record<V.SecurityAlerts>("/platform-admin/security"),
 },
 chains:()=>items<V.ChainItem>("/platform-admin/chains"),
 trace:{lots:(q:string)=>items<V.LotSearchItem>("/platform-admin/lots"+queryString({q})),lineage:(id:string)=>record<{lotId:string;upstream:V.LineageNode[];downstream:V.LineageNode[]}>("/platform-admin/lots/"+encodeURIComponent(id)+"/lineage"),qr:()=>record<V.QrOverview>("/platform-admin/qr"),block:(v:S["BlockQrInput"],cmd:LedgerCommandContext)=>post("/platform-admin/qr-blocks",v,cmd),unblock:(id:string,v:S["VersionReasonInput"],cmd:LedgerCommandContext)=>post("/platform-admin/qr-blocks/"+encodeURIComponent(id)+"/unblock",v,cmd)},
 config:{references:(category?:string)=>items<V.ReferenceItem>("/platform-admin/reference-items"+queryString({category})),upsertReference:(v:S["ReferenceItemInput"],cmd:LedgerCommandContext)=>post("/platform-admin/reference-items",v,cmd)},
 billing:{plans:()=>items<V.Plan>("/platform-billing/plans"),draftVersion:(code:string,v:S["PlanVersionDraftInput"],cmd:LedgerCommandContext)=>post("/platform-billing/plans/"+encodeURIComponent(code)+"/versions",v,cmd),publishVersion:(id:string,v:S["BillingReasonInput"],cmd:LedgerCommandContext)=>post("/platform-billing/plan-versions/"+encodeURIComponent(id)+"/publish",v,cmd),invoices:(f:{status?:string;organizationId?:string}={})=>items<V.Invoice>("/platform-billing/invoices"+queryString(f)),subscriptions:(status?:string)=>items<V.Subscription>("/platform-billing/subscriptions"+queryString({status})),revenue:(months:number)=>ledgerRequest<V.Revenue>("/platform-billing/revenue"+queryString({months})),confirmPayment:(id:string,v:S["ConfirmPaymentInput"],cmd:LedgerCommandContext)=>post("/platform-billing/invoices/"+encodeURIComponent(id)+"/confirm-payment",v,cmd),voidInvoice:(id:string,v:S["InvoiceVersionInput"],cmd:LedgerCommandContext)=>post("/platform-billing/invoices/"+encodeURIComponent(id)+"/void",v,cmd),renewal:(id:string,v:S["IssueRenewalInput"],cmd:LedgerCommandContext)=>post("/platform-billing/organizations/"+encodeURIComponent(id)+"/renewal-invoices",v,cmd)},
};
