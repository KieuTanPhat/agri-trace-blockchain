import type {components} from "../../../src/lib/generated/api";
import {registerScenario,readScenario} from "./scenarios";
import {organizationId,siteId} from "./enterprise-membership";
type S=components["schemas"];
export const productId="66666666-6666-4666-8666-666666666666", farmId="77777777-7777-4777-8777-777777777777";
const farm:S["CatalogFarmDto"]={id:farmId,organizationId,name:"Vùng đã hoàn tất",status:"ACTIVE",evidenceComplete:true,version:4,organization:{id:organizationId,name:"DOANH_NGHIEP_A",type:"FARM",status:"ACTIVE",createdAt:"2026-10-22T00:00:00Z",updatedAt:"2026-10-22T00:00:00Z"},address:"Địa chỉ vùng",areaM2:"100.00",createdAt:"2026-10-22T00:00:00Z",updatedAt:"2026-10-22T00:00:00Z",cropCode:null,email:null,expectedOutput:"100",inputMaterialIds:[],internalCode:"V001",kind:"Cây ăn quả",linkedSiteId:siteId,location:"Địa chỉ vùng",otherInfo:null,outputUnit:"kg",phone:null,privacy:"PRIVATE",region:"Long An",representative:null,seedMaterialIds:[]};
const product:S["ProductRecordDto"]={id:productId,organizationId,productName:"Xoài Ledger",sku:"XOAI-01",gtin:null,category:"FRUIT",originFarmId:farmId,defaultUnit:"kg",variety:null,price:"0.00",storageConditions:"Bảo quản mát",ingredients:"Xoài tươi",usageInstructions:"Rửa sạch",status:"INACTIVE",evidenceComplete:false,version:7,createdAt:"2026-10-22T00:00:00Z",updatedAt:"2026-10-22T00:00:00Z",description:null};
for(const name of ["products.baseline","products.unknown"])registerScenario(name,{handle(r,state){
 const path=new URL("http://fixture"+r.path).pathname;
 if(r.method==="GET"&&path==="/lots")return {data:[]};
 if(r.method==="GET"&&path==="/catalog")return {data:{farms:[farm],products:[product],plots:[]} satisfies S["CatalogDto"]};
 if(r.method==="GET"&&path==="/enterprise-access")return {data:{stage:"ACTIVE",capabilities:["FARM"],owner:state.actor==="org-owner",primary:state.actor==="org-owner",tier:state.actor==="org-owner"?1:3,permissions:state.actor==="org-owner"?["catalog.read","catalog.manage","sites.read","members.read","evidence.read","evidence.manage"]:["catalog.read"]}};
 if(r.method==="POST"&&path==="/enterprise-workspace/products-import/preview")return {data:{record:{count:1,digest:"a".repeat(64),canApply:true,errors:[]}}};
 if(r.method==="POST"&&(path==="/catalog/products"||path===`/enterprise-workspace/products/${productId}`||path==="/enterprise-workspace/products-import/apply")){
  if(name==="products.unknown")return {status:503,error:{code:"UPSTREAM_UNAVAILABLE",message:"Chưa nhận được kết quả lệnh"}};
  return {data:{record:{id:productId,version:8}}};
 }
 if(path==="/command-requests/status")return {data:{status:"COMMITTED",responseStatus:201,result:{record:{id:productId,version:8}}}};
 return readScenario("membership.baseline").handle(r,state);
}});
