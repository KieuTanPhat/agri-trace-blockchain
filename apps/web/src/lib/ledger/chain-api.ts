import type {components} from "../generated/api";
import {ledgerRequest} from "./request";
import {chainView} from "./chain-types";
import type {LedgerCommandContext} from "./command-context";
type S=components["schemas"];
const path=(id:string)=>"/supply-chains/"+encodeURIComponent(id),org=(id:string)=>"/organizations/"+encodeURIComponent(id),plans=(id:string)=>path(id)+"/shipment-plans";
const post=<T=unknown,>(p:string,body:unknown,cmd:LedgerCommandContext)=>ledgerRequest<T>(p,{method:"POST",headers:{"Idempotency-Key":cmd.idempotencyKey},body:JSON.stringify(body)});
export const chainApi={
 context:()=>ledgerRequest<S["ChainContextDto"]>("/chain-permissions"),chains:async()=>(await ledgerRequest<S["ChainRecordDto"][]>("/supply-chains")).map(chainView),chain:async(id:string)=>chainView(await ledgerRequest<S["ChainRecordDto"]>(path(id))),
 organizations:()=>ledgerRequest<{id:string;name:string;type:string}[]>("/organizations"),
 members:(id:string)=>ledgerRequest<S["MemberRecordDto"][]>(path(id)+"/memberships"),profile:(id:string)=>ledgerRequest<S["BusinessProfileDto"]>(path(id)+"/business-profile"),ledger:(id:string)=>ledgerRequest<S["LedgerStatusDto"]>(path(id)+"/ledger-status"),
 create:(input:S["CreateChainDto"],cmd:LedgerCommandContext)=>post(path("").slice(0,-1),input,cmd),invite:(id:string,input:S["InviteMemberDto"],cmd:LedgerCommandContext)=>post(path(id)+"/memberships",input,cmd),
 accept:(id:string,organizationId:string,input:S["ChainVersionDto"],cmd:LedgerCommandContext)=>post(path(id)+"/memberships/"+encodeURIComponent(organizationId)+"/accept",input,cmd),changeMember:(id:string,organizationId:string,input:S["ChangeMemberDto"],cmd:LedgerCommandContext)=>post(path(id)+"/memberships/"+encodeURIComponent(organizationId)+"/status",input,cmd),
 activate:(id:string,input:S["ChainVersionDto"],cmd:LedgerCommandContext)=>post(path(id)+"/business-profile/activate",input,cmd),suspend:(id:string,input:S["SuspendChainDto"],cmd:LedgerCommandContext)=>post(path(id)+"/business-profile/suspend",input,cmd),
 scopedGrants:(id:string)=>ledgerRequest<S["GrantRecordDto"][]>(org(id)+"/scoped-grants"),scopedUsers:(id:string)=>ledgerRequest<S["ScopedUserDto"][]>(org(id)+"/scoped-users"),
 grant:(id:string,input:S["GrantRoleDto"],cmd:LedgerCommandContext)=>post(org(id)+"/scoped-grants",input,cmd),revokeGrant:(id:string,grantId:string,input:{chainId:string|null;version:number},cmd:LedgerCommandContext)=>post(org(id)+"/scoped-grants/"+encodeURIComponent(grantId)+"/revoke",input,cmd),
 capability:(id:string,input:S["CapabilityDto"],cmd:LedgerCommandContext)=>post(org(id)+"/capabilities",input,cmd),
 signingContext:(id:string)=>ledgerRequest<S["SigningContextDto"]>(path(id)+"/signing-keys"),registerSigningKey:(id:string,input:S["RegisterSigningKeyDto"],cmd:LedgerCommandContext)=>post(path(id)+"/signing-keys",input,cmd),revokeSigningKey:(id:string,keyRef:string,input:S["RevokeSigningKeyDto"],cmd:LedgerCommandContext)=>post(path(id)+"/signing-keys/"+encodeURIComponent(keyRef)+"/revoke",input,cmd),
 plans:(id:string)=>ledgerRequest<S["ShipmentPlanRecordDto"][]>(plans(id)),planningLots:(id:string)=>ledgerRequest<S["PlanningLotDto"][]>(plans(id)+"/planning-lots"),
 createPlan:(id:string,input:S["CreateShipmentPlanDto"],cmd:LedgerCommandContext)=>post(plans(id),input,cmd),revisePlan:(id:string,planId:string,input:S["ReviseShipmentPlanDto"],cmd:LedgerCommandContext)=>post(plans(id)+"/"+encodeURIComponent(planId)+"/revise",input,cmd),acceptPlan:(id:string,planId:string,input:S["AcceptShipmentPlanDto"],cmd:LedgerCommandContext)=>post(plans(id)+"/"+encodeURIComponent(planId)+"/accept",input,cmd),finishPlan:(id:string,planId:string,action:"cancel"|"finalize",input:S["ChainVersionDto"],cmd:LedgerCommandContext)=>post(plans(id)+"/"+encodeURIComponent(planId)+"/"+action,input,cmd),
 distributionKeys:async()=>(await ledgerRequest<{items:{id:string;label:string;publicKey:string;status:string}[]}>("/distribution/keys")).items,
 registerDistributionKey:(input:S["TransferKeyInput"],cmd:LedgerCommandContext)=>post("/distribution/keys",input,cmd),revokeDistributionKey:(id:string,cmd:LedgerCommandContext)=>post("/distribution/keys/"+encodeURIComponent(id)+"/revoke",{},cmd),
};
