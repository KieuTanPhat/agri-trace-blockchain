import type {components} from "../../../src/lib/generated/api";
import {registerScenario,readScenario} from "./scenarios";
import {organizationId} from "./enterprise-membership";
import "./enterprise-products";
type S=components["schemas"];
export const partnerId="88888888-8888-4888-8888-888888888888",peerId="99999999-9999-4999-8999-999999999999";
const partner:S["EnterprisePartnerDto"]={id:partnerId,inviteeId:organizationId,inviterId:peerId,inviter:{id:peerId,name:"Đối tác Ledger",code:"AGT-PEER1",type:"TRANSPORTER"},invitee:{id:organizationId,name:"DOANH_NGHIEP_A",code:"AGT-0017",type:"FARM"},note:"Liên kết doanh nghiệp",status:"INVITED",version:4,createdAt:"2026-10-22T00:00:00Z"};
const catalog:S["ServiceCatalogView"]={version:"catalog-digest-17",plans:[{code:"TRACE_10",name:"Gói mười sản phẩm",version:{id:"5d6a2f0e-3c1b-4a8e-9f21-7b0c4e5d6a10",version:1,setupFee:500000,annualFee:1000000,termMonths:12,limits:{products:10,chains:1,members:5,qrLabels:1000}}}],hosting:[],qrReference:[],currency:"VND",disclaimer:"Mô phỏng dịch vụ; không thu tiền thật",simulationEnabled:true,sourceDate:"2026-10-22",sourceUrl:"https://example.invalid/catalog",checkedAt:"2026-10-22T00:00:00Z",termMonths:12};
const contract:S["ServicePreviewView"]={contractDigest:"b".repeat(64),contractText:"Hợp đồng mô phỏng đúng nội dung đã xem trước",quotation:{total:1500000}};
const order:S["ServiceOrderView"]={id:partnerId,...contract,status:"AWAITING_PAYMENT",version:5,acceptedAt:"2026-10-22T00:00:00Z",amount:1500000,billingAddress:"Địa chỉ hóa đơn",billingEmail:"bill@example.invalid",billingName:"Doanh nghiệp Ledger",hostingMode:"MANAGED_ORG",planCode:"TRACE_10"};
const enrollment:S["EnterpriseEnrollmentViewDto"]={id:partnerId,organizationId,organizationName:"DOANH_NGHIEP_A",organizationType:"FARM",businessId:"1234567890",capabilityRequests:[],connections:[],createdAt:"2026-10-22T00:00:00Z",documents:[],hostingMode:"MANAGED_ORG",onboardingStage:"SELECT_SERVICE",participationModel:"SINGLE",payingParticipant:true,representativeEmail:"bill@example.invalid",representativeName:"Chủ doanh nghiệp",serviceActivatedAt:null,serviceActivationReason:null,status:"APPROVED",version:7};
for(const name of ["coordination.partners","coordination.service"])registerScenario(name,{handle(r,state){const path=new URL("http://fixture"+r.path).pathname;
 if(path==="/enterprise-access"&&r.method==="GET")return {data:{stage:name==="coordination.service"?"SELECT_SERVICE":"ACTIVE",capabilities:["FARM"],owner:state.actor==="org-owner",primary:state.actor==="org-owner",tier:state.actor==="org-owner"?1:3,permissions:state.actor==="org-owner"?["profile.read","partners.read","partners.manage","evidence.read","evidence.manage"]:["profile.read","partners.read"]}};
 if(r.method==="GET"){
  if(path==="/enterprise-workspace/partners")return {data:{items:[{...partner,status:state.values.has("accepted")?"ACTIVE":"INVITED"}]}};
  if(path==="/enterprise-workspace/partners/external"||path==="/enterprise-workspace/partners/search")return {data:{items:[]}};
  if(path==="/enterprise-enrollments/mine")return {data:enrollment};
  if(path==="/enterprise-service")return {data:{catalog,emails:[],stage:state.values.has("paid")?"AWAITING_ACTIVATION":state.values.has("order")?"AWAITING_PAYMENT":"SELECT_SERVICE",order:state.values.has("order")?{...order,status:state.values.has("paid")?"PAID_SIMULATED":"AWAITING_PAYMENT"}:null} satisfies S["ServiceWorkspaceView"]};
 }
 if(r.method==="POST"){
  if(path===`/enterprise-workspace/partners/${partnerId}`){state.values.set("accepted",true);return {data:{record:{...partner,status:"ACTIVE"}}};}
  if(path==="/enterprise-service/preview")return {data:contract};
  if(path==="/enterprise-service/orders"){state.values.set("order",true);return {data:order};}
  if(path==="/enterprise-service/payment-simulation"){state.values.set("paid",true);return {data:{...order,status:"PAID_SIMULATED"}};}
 }
 return readScenario("products.baseline").handle(r,state);
}});
