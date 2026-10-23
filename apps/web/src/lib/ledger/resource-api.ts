import type {components} from "../generated/api";
import {wapi as workspace} from "./workspace-api";
import {ledgerRequest} from "./request";
import type {LedgerCommandContext} from "./command-context";
import type {Material,Vehicle} from "./resource-types";
type S=components["schemas"];
export type FarmInput=S["FarmDto"];
export type SiteInput=S["EnterpriseSiteInput"];
export type MaterialInput=S["MaterialInput"];
const post=(path:string,body:unknown,cmd:LedgerCommandContext)=>ledgerRequest<unknown>(path,{method:"POST",headers:{"Idempotency-Key":cmd.idempotencyKey},body:JSON.stringify(body)});
const root="/enterprise-workspace";
export const wapi={...workspace,
 materials:async()=>(await ledgerRequest<{items:Material[]}>(root+"/materials")).items,
 vehicles:async()=>(await ledgerRequest<{items:Vehicle[]}>(root+"/vehicles")).items,
 createFarm:(input:FarmInput,cmd:LedgerCommandContext)=>post("/catalog/farms",input,cmd),
 createPlot:(input:S["PlotDto"],cmd:LedgerCommandContext)=>post("/catalog/plots",input,cmd),
 completeFarm:(id:string,input:S["CompleteEvidenceDto"],cmd:LedgerCommandContext)=>post(`/catalog/farms/${encodeURIComponent(id)}/complete`,input,cmd),
 createSite:(input:SiteInput,cmd:LedgerCommandContext)=>post(root+"/sites",input,cmd),
 reviseSite:(id:string,input:S["SiteRevisionInput"],cmd:LedgerCommandContext)=>post(`${root}/sites/${encodeURIComponent(id)}/revisions`,input,cmd),
 completeSite:(id:string,input:S["EvidenceCompletionInput"],cmd:LedgerCommandContext)=>post(`${root}/sites/${encodeURIComponent(id)}/complete`,input,cmd),
 siteStatus:(id:string,input:S["ResourceStatusInput"],cmd:LedgerCommandContext)=>post(`${root}/sites/${encodeURIComponent(id)}/status`,input,cmd),
 createVehicle:(input:S["EnterpriseVehicleInput"],cmd:LedgerCommandContext)=>post(root+"/vehicles",input,cmd),
 reviseVehicle:(id:string,input:S["VehicleRevisionInput"],cmd:LedgerCommandContext)=>post(`${root}/vehicles/${encodeURIComponent(id)}/revisions`,input,cmd),
 vehicleStatus:(id:string,input:S["ResourceStatusInput"],cmd:LedgerCommandContext)=>post(`${root}/vehicles/${encodeURIComponent(id)}/status`,input,cmd),
 createMaterial:(input:MaterialInput,cmd:LedgerCommandContext)=>post(root+"/materials",input,cmd),
 reviseMaterial:(id:string,input:S["MaterialRevisionInput"],cmd:LedgerCommandContext)=>post(`${root}/materials/${encodeURIComponent(id)}`,input,cmd),
 completeMaterial:(id:string,input:S["EvidenceCompletionInput"],cmd:LedgerCommandContext)=>post(`${root}/materials/${encodeURIComponent(id)}/complete`,input,cmd),
};
