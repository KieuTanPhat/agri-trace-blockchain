import type {components} from "../generated/api";
import {ledgerRequest} from "./request";
import type {LedgerCommandContext} from "./command-context";
import type {Cycle,CycleList,CycleDraft} from "./ops-types";
type S=components["schemas"];
const post=<T=unknown>(path:string,input:unknown,cmd:LedgerCommandContext)=>ledgerRequest<T>(path,{method:"POST",headers:{"Idempotency-Key":cmd.idempotencyKey},body:JSON.stringify(input)});
const root="/production-cycles", path=(id:string)=>root+"/"+encodeURIComponent(id);
export const opsApi={
 cycles:()=>ledgerRequest<CycleList[]>(root),cycle:(id:string)=>ledgerRequest<Cycle>(path(id)),
 drafts:async()=>(await ledgerRequest<{items:CycleDraft[]}>(root+"/drafts")).items,
 createCycle:(v:S["CreateProductionCycleDto"],c:LedgerCommandContext)=>post(root,v,c),
 createDraft:(v:S["CreateProductionCycleDraftDto"],c:LedgerCommandContext)=>post(root+"/drafts",v,c),
 linkDraft:(id:string,v:S["LinkProductionCycleDraftDto"],c:LedgerCommandContext)=>post(root+"/drafts/"+encodeURIComponent(id)+"/link",v,c),
 setStaff:(id:string,v:S["SetCycleStaffDto"],c:LedgerCommandContext)=>post(root+"/"+encodeURIComponent(id)+"/staff",v,c),
 plant:(id:string,v:S["PlantCycleDto"],c:LedgerCommandContext)=>post(path(id)+"/plant",v,c),
 care:(id:string,v:S["CareRecordDto"],c:LedgerCommandContext)=>post(path(id)+"/care",v,c),
 harvest:(id:string,v:S["RecordHarvestDto"],c:LedgerCommandContext)=>post<S["HarvestResultDto"]>(path(id)+"/harvests",v,c),
 close:(id:string,v:{version:number},c:LedgerCommandContext)=>post(path(id)+"/close",v,c),
 cancel:(id:string,v:S["CancelCycleDto"],c:LedgerCommandContext)=>post(path(id)+"/cancel",v,c),
 certificates:()=>ledgerRequest<S["CertificateRecordDto"][]>("/certificates"),inspections:()=>ledgerRequest<S["InspectionListDto"][]>("/inspections"),
 certificate:(v:S["CreateCertificateDto"],c:LedgerCommandContext)=>post("/certificates",v,c),
 review:(id:string,v:S["ReviewCertificateDto"],c:LedgerCommandContext)=>ledgerRequest("/certificates/"+encodeURIComponent(id)+"/review",{method:"PATCH",headers:{"Idempotency-Key":c.idempotencyKey},body:JSON.stringify(v)}),
 inspection:(v:S["CreateInspectionDto"],c:LedgerCommandContext)=>post("/inspections",v,c),
};
