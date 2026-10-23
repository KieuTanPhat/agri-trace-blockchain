import {z} from "zod";
import type {components} from "../../../src/lib/generated/api";
import {registerScenario,readScenario} from "./scenarios";
import {organizationId,memberId,chainId} from "./enterprise-membership";
import {peerId} from "./enterprise-coordination";
import {actorSession} from "./actors";
type S=components["schemas"];
export {chainId};
const keySchema=z.object({keyRef:z.string(),label:z.string(),publicKey:z.string(),chainId:z.string(),organizationId:z.string(),algorithm:z.string(),status:z.enum(["PENDING_LEDGER","ACTIVE","REVOKED"]),createdAt:z.string(),activatedAt:z.string().nullable(),revokedAt:z.string().nullable()});
export const bindingDigest="c".repeat(64),planId="abababab-abab-4bab-8bab-abababababab";
const owner=actorSession("org-owner")!.user.id;
const chain:S["ChainRecordDto"]={id:chainId,ownerOrganizationId:organizationId,name:"Chuỗi Ledger",code:"CHAIN-17",chainType:"CROP",createdAt:"2026-10-22T00:00:00Z",description:"Chuỗi kiểm tra ký",note:null,plannedStartDate:null,supplyModel:null,version:3};
const membership:S["MemberRecordDto"]={id:memberId,chainId,organizationId,status:"ACTIVE",version:4,invitationRevision:1,createdAt:"2026-10-22T00:00:00Z",updatedAt:"2026-10-22T00:00:00Z"};
const grant=(role:string,scope:string):S["GrantRecordDto"]=>({id:memberId,userId:owner,organizationId,chainId:scope==="CHAIN"?chainId:null,role,scope,revision:4,revokedAt:null,createdAt:"2026-10-22T00:00:00Z"});
const business:S["BusinessProfileDto"]={chainId,state:"ACTIVE",version:2,scopeVersion:1,createdAt:"2026-10-22T00:00:00Z",suspendedAt:null,suspendedBy:null,suspensionReason:null};
const ledger:S["LedgerStatusDto"]={chainId,profile:"MANAGED_ORG",channelId:"channel17",bindingStatus:"ACTIVE",delivery:{pending:0,completed:1,deadLetter:0,retry:0,oldestPendingAt:null,pendingAgeSeconds:null},failedControlJobs:0,lastControlFailureAt:null,openHolds:0,pendingControlJobs:0,permissions:{active:3,pending:0,revoking:0,held:0},worker:{healthy:true,certificateExpired:false,certificateExpiresAt:null,heartbeatStale:false,lastCheckedAt:"2026-10-22T00:00:00Z",lastErrorCode:null,lastHealthyAt:"2026-10-22T00:00:00Z"}};
const plan:S["ShipmentPlanRecordDto"]={id:planId,chainId,lotId:memberId,version:9,currentRevision:6,status:"DRAFT",shipmentId:null,createdAt:"2026-10-22T00:00:00Z",current:{revision:6,producerOrgId:organizationId,transporterOrgId:peerId,retailerOrgId:peerId,quantity:"10.000",unit:"kg",origin:"Vườn",destination:"Kho",vehicleRef:null,plannedPickupTime:null,expectedArrivalTime:null,payloadDigest:"e".repeat(64),acceptances:[]}};
for(const name of ["chains.signing","chains.wrong-scope","chains.unknown","chains.stock-changed","chains.stock-exact"])registerScenario(name,{handle(r,state){const path=new URL("http://fixture"+r.path).pathname,ownerActor=state.actor==="org-owner";
 if(r.method==="GET"){
  if(path==="/enterprise-access")return {data:{stage:"ACTIVE",capabilities:["FARM"],owner:ownerActor,primary:ownerActor,tier:ownerActor?1:3,permissions:ownerActor?["profile.read","catalog.read","partners.read","members.read","evidence.read","evidence.manage","distribution.sign","roles.manage"]:["profile.read","catalog.read","partners.read","trace.read"]}};
  if(path==="/chain-permissions")return {data:{accessRevision:"a".repeat(64),productionChains:ownerActor?[chain]:[],businessChains:[chainId],grants:ownerActor?[grant("ORG_ADMIN","ORGANIZATION"),grant("CHAIN_MANAGER","CHAIN"),grant("FARM_STAFF","CHAIN")]:[],memberships:[membership],capabilities:[]} satisfies S["ChainContextDto"]};
  if(path==="/organizations")return {data:[{id:organizationId,name:"DOANH_NGHIEP_A",type:"FARM"}]};
  if(path==="/supply-chains")return {data:[chain]};
  if(path===`/supply-chains/${chainId}`)return {data:chain};
  if(path.endsWith("/memberships"))return {data:[membership]};
  if(path.endsWith("/business-profile"))return {data:business};
  if(path.endsWith("/ledger-status"))return {data:ledger};
  if(path.endsWith("/scoped-grants"))return {data:[grant("FARM_STAFF","CHAIN")]};
  if(path.endsWith("/scoped-users"))return {data:[{id:owner,fullName:"Chủ chuỗi"}]};
  if(path.endsWith("/signing-keys"))return {data:{chainId,organizationId:name==="chains.wrong-scope"?peerId:organizationId,chainRef:chainId,bindingDigest,handoverMode:"DUAL_SIGNED",keys:state.values.has("key")?[keySchema.parse(state.values.get("key"))]:[]} satisfies S["SigningContextDto"]};
  if(path.endsWith("/shipment-plans"))return {data:[{...plan,current:{...plan.current,...(name.startsWith("chains.stock-")?{quantity:"99999999999.001"}:{}),acceptances:name.startsWith("chains.stock-")?(["PRODUCER","TRANSPORTER","RETAILER"] as const).map(party=>({party,organizationId:party==="PRODUCER"?organizationId:peerId,acceptedAt:"2026-10-22T00:00:00Z"})):state.values.has("consent")?[{party:"PRODUCER",organizationId,acceptedAt:"2026-10-22T00:00:00Z"}]:[]}}]};
  if(path.endsWith("/planning-lots"))return {data:name.startsWith("chains.stock-")?[{id:memberId,lotCode:"DECIMAL-LOT",lotName:"Lot",productName:"Rice",quantity:name==="chains.stock-changed"?"99999999999.002":"99999999999.001",unit:"kg"}]:[]};
 }
 if(path==="/command-requests/status")return {data:{status:"COMMITTED",responseStatus:201,result:state.values.get("key")}};
 if(r.method==="POST"){
  if(path===`/supply-chains/${chainId}/signing-keys`){const input=JSON.parse(r.body!);state.values.set("key",{...input,chainId,organizationId,algorithm:"Ed25519",status:"PENDING_LEDGER",createdAt:"2026-10-22T00:00:00Z",activatedAt:null,revokedAt:null});return name==="chains.unknown"?{status:503,error:{code:"UPSTREAM_UNAVAILABLE",message:"Chưa nhận được kết quả đăng ký khóa"}}:{data:state.values.get("key")};}
  if(path===`/supply-chains/${chainId}/shipment-plans/${planId}/accept`){state.values.set("consent",true);return {data:{id:memberId,planId,party:"PRODUCER",organizationId,revision:6,acceptedAt:"2026-10-22T00:00:00Z"}};}
 }
 return readScenario("coordination.partners").handle(r,state);
}});
