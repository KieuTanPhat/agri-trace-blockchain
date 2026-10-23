import type {components} from "../../../src/lib/generated/api";
import type {Cycle} from "../../../src/lib/ledger/ops-types";
import {registerScenario,readScenario} from "./scenarios";
import {farm,product,farmId,productId} from "./enterprise-products";
import {organizationId,chainId,memberId} from "./enterprise-membership";
type S=components["schemas"];
export const cycleId="88888888-8888-4888-8888-888888888888",harvestImage="99999999-9999-4999-8999-999999999991",lotImage="99999999-9999-4999-8999-999999999992";
const cycle:Cycle={id:cycleId,name:"Vụ Ledger",chainId,createdAt:"2026-10-20T00:00:00Z",updatedAt:"2026-10-20T00:00:00Z",currentState:"GROWING",cycleCode:"VU-001",cultivationMethod:null,cultivatedArea:"100",plantedAt:"2026-10-20T00:00:00Z",farmId,farmOrgId:organizationId,harvestUnit:"kg",maxHarvestQuantity:"1000.000",note:null,plannedHarvest:null,plotId:null,productId,responsibleUserId:memberId,seedMaterialId:null,startDate:"2026-10-20T00:00:00Z",version:7,canWriteProduction:true,canReviewCompliance:false,careRecords:[],certificates:[],farm,plot:null,product,sensorDigests:[],sensorReadings:[],harvestEvents:[]};
const image=(id:string,kind:string):S["TraceEvidenceRecordDto"]=>({id,entityId:cycleId,entityType:"CYCLE",description:kind,fileName:kind+".jpg",kind,mediaType:"image/jpeg",public:false,sha256:"a".repeat(64),size:300,siteId:null,supersedesId:null,createdAt:"2026-10-20T00:00:00Z"});
for(const name of ["iot.unknown","iot.rejected"])registerScenario(name,{handle(r,state){
 const p=new URL("http://fixture"+r.path).pathname;
 if(p==="/chain-permissions")return {data:{accessRevision:"a".repeat(64),productionChains:[{id:chainId}],businessChains:[],grants:[],memberships:[],capabilities:[]}};
 if(p==="/command-requests/status")return {data:{status:"NOT_FOUND"}};
 if(p==="/iot/readings"&&r.method==="POST"){
  if(name==="iot.rejected")return {status:422,error:{code:"VALIDATION_ERROR",message:"Chu kỳ không ở trạng thái nhận dữ liệu cảm biến"}};
  if(!state.values.has("firstReading")){state.values.set("firstReading",true);return {status:503,error:{code:"UNAVAILABLE",message:"Chưa rõ kết quả"}};}
  return {data:{status:"accepted",readingId:"original-reading"}};
 }
 return readScenario("production.baseline").handle(r,state);
}});
for(const name of ["production.baseline","production.stale","production.denied"])registerScenario(name,{handle(r,state){const p=new URL("http://fixture"+r.path).pathname;if(p==="/enterprise-access")return {data:{stage:"ACTIVE",capabilities:["FARM"],owner:true,primary:true,tier:1,permissions:["production.read","production.write","catalog.read","materials.read","members.read","sites.read","evidence.read","evidence.manage"]}};
if(p==="/production-cycles"&&r.method==="GET")return {data:[{...cycle,canWriteProduction:name!=="production.denied"}]};if(p===`/production-cycles/${cycleId}`&&r.method==="GET")return {data:{...cycle,canWriteProduction:name!=="production.denied"}};
if(p==="/production-cycles/drafts")return {data:{items:[]}};if(p==="/enterprise-workspace/materials")return {data:{items:[]}};if(p==="/enterprise-workspace/evidence")return {data:{items:[image(harvestImage,"HARVEST_IMAGE"),image(lotImage,"LOT_IMAGE")]}};
if(p===`/production-cycles/${cycleId}/harvests`&&r.method==="POST"){if(name==="production.stale")return {status:409,error:{code:"VERSION_CONFLICT",message:"Phiên bản vụ đã thay đổi; kiểm tra trước khi thu hoạch lại"}};state.values.set("harvest",true);return {data:{cycleVersion:8,lot:{id:productId,lotCode:"LO-01"},traceQr:{traceToken:"trace-token"}}};}
return readScenario("products.baseline").handle(r,state);
}});
