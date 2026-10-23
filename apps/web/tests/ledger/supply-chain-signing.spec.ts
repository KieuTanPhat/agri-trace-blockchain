import {test,expect} from "./fixtures";
import {chainId,bindingDigest,planId} from "./fixtures/supply-chain-signing";
import {organizationId} from "./fixtures/enterprise-membership";
import {keyPopMessage} from "../../src/lib/signing/canonical";
import {createPublicKey,verify} from "node:crypto";
import {resolve} from "node:path";

test("shipment finalize requires every party's current consent and unchanged exact stock",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("chains.signing");await page.goto(`/supply-chains/${chainId}/plans`);
 await expect(page.getByRole("heading",{name:"Kế hoạch giao nhận & đồng thuận",exact:true})).toBeVisible();
 await expect(page.getByRole("button",{name:"Chốt kế hoạch",exact:true})).toHaveCount(0);
 await api.scenario("chains.stock-changed");await page.reload();
 await expect(page.getByText(/Tồn kho đã thay đổi/)).toBeVisible();
 await expect(page.getByRole("button",{name:"Chốt kế hoạch",exact:true})).toHaveCount(0);
 await api.scenario("chains.stock-exact");await page.reload();
 await expect(page.getByRole("button",{name:"Chốt kế hoạch",exact:true})).toBeVisible();
 expect(api.requests().some(r=>r.method==="POST"&&r.path.endsWith("/finalize"))).toBe(false);
});
test("chain consumer creates a non-extractable key with real Ed25519 proof and preserves plan consent digest",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("chains.signing");await page.goto(`/supply-chains/${chainId}/signing`);await page.getByLabel("Nhãn khóa ký sổ cái",{exact:true}).fill("Khóa chuỗi tại thiết bị");await page.getByRole("button",{name:"Tạo khóa ký sổ cái",exact:true}).click();await expect(page.getByText("Chờ sổ cái nạp",{exact:true})).toBeVisible();
 const request=api.requests().find(r=>r.method==="POST"&&r.path===`/supply-chains/${chainId}/signing-keys`)!;const body=JSON.parse(request.body!);expect(Object.keys(body).sort()).toEqual(["keyRef","label","popSignature","publicKey"]);expect(request.idempotencyKey).toBeTruthy();const key=createPublicKey({key:Buffer.from(body.publicKey,"base64url"),format:"der",type:"spki"});expect(verify(null,keyPopMessage({bindingDigest,keyRef:body.keyRef,orgRef:organizationId,publicKey:body.publicKey}),key,Buffer.from(body.popSignature,"base64url"))).toBe(true);expect(verify(null,keyPopMessage({bindingDigest:"d".repeat(64),keyRef:body.keyRef,orgRef:organizationId,publicKey:body.publicKey}),key,Buffer.from(body.popSignature,"base64url"))).toBe(false);
 const local=await page.evaluate(async id=>{const db=await new Promise<IDBDatabase>((resolve,reject)=>{const r=indexedDB.open("agritrace-signing");r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);});try{return await new Promise<{extractable:boolean;type:string;chainId:string;organizationId:string}>((resolve,reject)=>{const request=db.transaction("keys","readonly").objectStore("keys").get(id);request.onsuccess=()=>{const k=request.result;resolve({extractable:k.privateKey.extractable,type:k.privateKey.type,chainId:k.chainId,organizationId:k.organizationId});};request.onerror=()=>reject(request.error);});}finally{db.close();}},body.keyRef);expect(local).toEqual({extractable:false,type:"private",chainId,organizationId});
 await page.getByRole("button",{name:"Đồng ý PRODUCER",exact:true}).click();const consentResponse=page.waitForResponse(r=>new URL(r.url()).pathname===`/api/supply-chains/${chainId}/shipment-plans/${planId}/accept`&&r.request().method()==="POST");await page.getByRole("dialog").last().getByRole("button",{name:"Đồng ý nội dung hiện hành",exact:true}).click();const consent=await consentResponse;expect(consent.status()).toBe(200);expect(consent.request().postDataJSON()).toEqual({party:"PRODUCER",revision:6,payloadDigest:"e".repeat(64)});await expect(page.getByRole("heading",{name:"Xác nhận đồng thuận",exact:true})).toHaveCount(0);
 await expect(page.getByRole("heading",{name:"Chuỗi Ledger",exact:true})).toBeVisible();await page.screenshot({path:resolve(test.info().project.outputDir,"../task-13-chain-desktop.png"),fullPage:true,animations:"disabled"});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(test.info().project.outputDir,"../task-13-chain-mobile.png"),fullPage:true,animations:"disabled"});
});
test("wrong organization signing context and read-only membership cannot register a key",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("chains.wrong-scope");await page.goto(`/supply-chains/${chainId}/signing`);await expect(page.getByText("Khóa ký không thuộc chuỗi hoặc tổ chức đang xem.",{exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Tạo khóa ký sổ cái",exact:true})).toHaveCount(0);
 await api.useActor("org-staff");await api.scenario("chains.signing");await page.goto(`/supply-chains/${chainId}/signing`);await expect(page.getByRole("heading",{name:"Chuỗi Ledger",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Tạo khóa ký sổ cái",exact:true})).toHaveCount(0);expect(api.requests().filter(r=>r.method==="POST"&&r.path.endsWith("/signing-keys"))).toHaveLength(0);
});

test("uncertain key registration keeps the local key and blocks another generation after reload",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("chains.unknown");await page.goto(`/supply-chains/${chainId}/signing`);await page.getByLabel("Nhãn khóa ký sổ cái",{exact:true}).fill("Khóa đang đối soát");await page.getByRole("button",{name:"Tạo khóa ký sổ cái",exact:true}).click();await expect(page.getByTestId("ledger-recovery-panel")).toBeVisible();await page.reload();await expect(page.getByRole("button",{name:"Tạo khóa ký sổ cái",exact:true})).toBeDisabled();await expect(page.getByText("Chờ sổ cái nạp",{exact:true})).toBeVisible();
 await page.goto("/supply-chains");await page.getByTestId("ledger-recovery-panel").getByRole("button",{name:"Đối soát",exact:true}).click();await expect(page.getByTestId("ledger-recovery-panel")).toHaveCount(0);expect(api.requests().filter(r=>r.method==="POST"&&r.path===`/supply-chains/${chainId}/signing-keys`)).toHaveLength(1);
});
