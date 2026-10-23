import type {components} from "../../../src/lib/generated/api";
import {registerScenario,readScenario} from "./scenarios";
import {organizationId,siteId,memberId} from "./enterprise-membership";
import "./enterprise-products";
type S=components["schemas"];
const site:S["EnterpriseSiteRecordDto"]={id:siteId,name:"Kho Ledger",organizationId,address:"Địa chỉ cơ sở Ledger",kind:"WAREHOUSE",status:"ACTIVE",version:7,areaM2:"100.00",capacityKg:"9000.000",coldAreaM2:null,email:null,evidenceComplete:true,expectedOutputTons:null,farmId:null,manager:null,otherInfo:null,phone:null,region:"Long An",representative:null,staffUserId:memberId,ward:"Phường Bến Lức"};
for(const name of ["resources.baseline","resources.evidence","resources.stock","resources.vehicles"])registerScenario(name,{handle(r,state){
 const path=new URL("http://fixture"+r.path).pathname;
 if(path==="/enterprise-access"&&r.method==="GET")return {data:{stage:"ACTIVE",capabilities:name==="resources.vehicles"?["TRANSPORTER"]:["FARM"],owner:state.actor==="org-owner",primary:state.actor==="org-owner",tier:state.actor==="org-owner"?1:3,permissions:state.actor==="org-owner"?["catalog.read","catalog.manage","members.read","materials.read","materials.manage","sites.read","sites.manage","vehicles.read","vehicles.manage","evidence.read","evidence.manage"]:["sites.read","vehicles.read"]}};
 if(path==="/enterprise-workspace/sites"&&r.method==="GET")return {data:{items:[{...site,evidenceComplete:name!=="resources.evidence",version:state.values.has("revised")?8:7,name:state.values.has("revised")?"Kho đã cập nhật":site.name}]}};
 if((path==="/enterprise-workspace/materials"||path==="/enterprise-workspace/vehicles")&&r.method==="GET")return {data:{items:[]}};
 if(r.method==="POST"){
  if(path==="/enterprise-workspace/vehicles")return {data:{record:{id:siteId,version:1}}};
  if(path==="/enterprise-workspace/sites")return {data:{record:{id:siteId,version:7}}};
  if(path===`/enterprise-workspace/sites/${siteId}/revisions`){state.values.set("revised",true);return {data:{record:{id:siteId,version:8}}};}
  if(path===`/enterprise-workspace/sites/${siteId}/complete`)return {status:409,error:{code:"CONFLICT",message:"Cần ít nhất một ảnh cơ sở hợp lệ"}};
  if(path===`/enterprise-workspace/sites/${siteId}/status`)return {status:409,error:{code:"CONFLICT",message:"Đối soát tồn hoặc chặng đang mở trước khi ngừng sử dụng"}};
 }
 return readScenario("products.baseline").handle(r,state);
}});
