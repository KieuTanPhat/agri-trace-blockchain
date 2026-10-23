import {test,expect} from "./fixtures";
import {registerScenario,readScenario} from "./fixtures/scenarios";
import {cycle,cycleId} from "./fixtures/production-harvest";
import {mockLots} from "../../src/test/domain-fixtures";
import type {components} from "../../src/lib/generated/api";
type S=components["schemas"];
const certificateId="99999999-9999-4999-8999-999999999993",inspectionId="99999999-9999-4999-8999-999999999994";
const lot={...mockLots[0],productionCycle:{...mockLots[0].productionCycle!,cycleId},lotCode:"LOT-CORRECTION"};
const certificate:S["CertificateRecordDto"]={id:certificateId,cycleId,lotId:null,version:2,type:"VietGAP",issuer:"Đơn vị độc lập",status:"APPROVED",issueDate:"2026-10-01T00:00:00Z",expiryDate:null,documentRef:"original-document",documentHash:"a".repeat(64),isPublic:false,correctionReason:null,createdAt:"2026-10-01T00:00:00Z",reviewedAt:"2026-10-02T00:00:00Z",reviewedBy:null,reviewNote:null,submittedByUserId:null,supersedesId:null};
for(const name of ["compliance.certificate","compliance.inspection"])registerScenario(name,{handle(r,state){
 const p=new URL("http://fixture"+r.path).pathname;
 if(r.method==="GET"){
  if(p==="/production-cycles")return {data:[{...cycle,canWriteProduction:name.endsWith("certificate"),canReviewCompliance:name.endsWith("inspection")}]};
  if(p==="/lots")return {data:[lot]};
  if(p==="/certificates")return {data:name.endsWith("certificate")?[certificate]:[]};
  if(p==="/inspections")return {data:name.endsWith("inspection")?[{id:inspectionId,lotId:lot.lotId,lot:{lotCode:lot.lotCode},result:"PASS",note:null,inspectedAt:"2026-10-01T00:00:00Z",supersedesId:null}]:[]};
 }
 if(r.method==="POST"&&["/certificates","/inspections"].includes(p))return {data:{id:"corrected-record"}};
 return readScenario("production.baseline").handle(r,state);
}});
for(const kind of ["certificate","inspection"] as const)test(`${kind} correction validates its reason before freezing or sending`,async({page,api})=>{
 await api.useActor(kind==="certificate"?"org-owner":"compliance-reviewer");await api.scenario(`compliance.${kind}`);await page.goto("/compliance");
 const row=page.getByRole("row").filter({hasText:kind==="certificate"?"VietGAP":"LOT-CORRECTION"});await row.getByRole("button",{name:"Đính chính",exact:true}).click();
 const dialog=page.getByRole("dialog"),submit=dialog.getByRole("button",{name:kind==="certificate"?"Nộp chứng nhận":"Ghi kiểm định",exact:true}),reason=dialog.getByLabel("Lý do đính chính",{exact:true});
 if(kind==="certificate"){await dialog.getByLabel("Tham chiếu tài liệu",{exact:true}).fill("corrected-document");await dialog.getByLabel("SHA-256",{exact:true}).fill("b".repeat(64));}
 await submit.click();await expect(dialog.getByText("Nhập lý do đính chính",{exact:true})).toBeVisible();await expect(reason).toBeEnabled();await expect(page.getByTestId("ledger-command-pending")).toHaveCount(0);
 expect(api.requests().filter(r=>r.method==="POST"&&r.path===`/${kind==="certificate"?"certificates":"inspections"}`)).toHaveLength(0);
 await reason.fill("Cập nhật tài liệu đã được đối chiếu");const response=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/${kind==="certificate"?"certificates":"inspections"}`&&r.request().method()==="POST");await submit.click();
 expect((await response).request().postDataJSON()).toMatchObject({supersedesId:kind==="certificate"?certificateId:inspectionId,correctionReason:"Cập nhật tài liệu đã được đối chiếu"});
});
