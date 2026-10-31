import {test,expect} from "./fixtures";
import {publicLot,publicToken} from "./fixtures/public-trace";
import {resolve} from "node:path";
import QRCode from "qrcode";
import {registerScenario} from "./fixtures/scenarios";
test("public proof never hides recall expiry warnings and report retries its exact private body in memory",async({page,api})=>{await api.useActor("anonymous");await api.scenario("public.trace");await page.goto(`/trace/${publicToken}`);await expect(page.getByText("Đã xác nhận trên sổ cái",{exact:true})).toBeVisible();await expect(page.getByText("Dừng sử dụng và liên hệ bên cung cấp",{exact:true})).toBeVisible();await expect(page.getByText("Lô đã hết hạn sử dụng",{exact:true})).toBeVisible();expect(api.requests().some(r=>r.path.startsWith("/lots"))).toBe(false);await page.screenshot({path:resolve(test.info().project.outputDir,"../task-17-trace-desktop.png"),animations:"disabled"});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(test.info().project.outputDir,"../task-17-trace-mobile.png"),animations:"disabled"});await page.getByRole("button",{name:"Phản ánh thông tin lô",exact:true}).click();await page.getByLabel("Nội dung phản ánh",{exact:true}).fill("Nội dung phản ánh riêng cần kiểm tra");await page.getByLabel("Email",{exact:true}).fill("private@example.invalid");await page.getByLabel("Tôi xác nhận nội dung phản ánh trung thực",{exact:true}).check();await page.getByRole("button",{name:"Gửi phản ánh",exact:true}).click();await expect(page.getByText("Chưa rõ kết quả phản ánh",{exact:true})).toBeVisible();await expect(page.getByLabel("Nội dung phản ánh",{exact:true})).toBeDisabled();await page.getByRole("button",{name:"Gửi lại cùng yêu cầu",exact:true}).click();await expect(page.getByText("Đã tiếp nhận phản ánh",{exact:true})).toBeVisible();const writes=api.requests().filter(r=>r.method==="POST"&&r.path.endsWith("/reports"));expect(writes).toHaveLength(2);expect(writes[0].body).toBe(writes[1].body);expect(writes[0].idempotencyKey).toBe(writes[1].idempotencyKey);expect(JSON.parse(writes[0].body!)).not.toHaveProperty("contactEmail");expect(await page.evaluate(()=>JSON.stringify({...localStorage}))).not.toContain("Nội dung phản ánh riêng");});
test("scanner requests camera only on consent and unsafe input stays local with missing trace fallback",async({page,api})=>{await api.useActor("anonymous");await api.scenario("public.missing");await page.addInitScript(()=>{Object.defineProperty(navigator,"mediaDevices",{configurable:true,value:{getUserMedia:async()=>{(window as Window&{cameraCalls?:number}).cameraCalls=((window as Window&{cameraCalls?:number}).cameraCalls??0)+1;throw new DOMException("Denied","NotAllowedError");}}});});await page.goto("/scan");expect(await page.evaluate(()=>(window as Window&{cameraCalls?:number}).cameraCalls??0)).toBe(0);await page.getByRole("button",{name:"Mở camera",exact:true}).click();await expect(page.getByRole("status").filter({hasText:/Chưa được cấp quyền camera/})).toBeVisible();await page.getByLabel("Chọn ảnh mã QR",{exact:true}).setInputFiles({name:"bad.txt",mimeType:"text/plain",buffer:Buffer.from("not-an-image")});await expect(page.getByRole("status").filter({hasText:/Chọn ảnh PNG/})).toBeVisible();await page.getByLabel("Mã truy xuất hoặc đường dẫn",{exact:true}).fill("javascript:alert(1)");await page.getByRole("button",{name:"Tra cứu",exact:true}).click();await expect(page.getByRole("alert").filter({hasText:/hợp lệ/})).toBeVisible();await expect(page).toHaveURL(/\/scan$/);await page.getByLabel("Mã truy xuất hoặc đường dẫn",{exact:true}).fill("https://external.example/trace/a-valid-token");await page.getByRole("button",{name:"Tra cứu",exact:true}).click();await expect(page).toHaveURL(/127\.0\.0\.1:3300\/trace\/a-valid-token$/);await expect(page.getByRole("heading",{name:"Không tìm thấy mã truy xuất",exact:true})).toBeVisible();});

for(const width of [320,768,1440])test(`public warnings precede verified proof at ${width}px`,async({page,api})=>{
 await api.useActor("anonymous");await api.scenario("public.trace");await page.setViewportSize({width,height:900});await page.goto(`/trace/${publicToken}`);
 const proof=page.getByText("Đã xác nhận trên sổ cái",{exact:true});await expect(proof).toBeVisible();
 for(const text of ["Lô đã hết hạn sử dụng","Dừng sử dụng và liên hệ bên cung cấp"]){const box=await page.getByText(text,{exact:true}).boundingBox();expect(box!.y).toBeLessThan((await proof.boundingBox())!.y);}
 expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 await page.screenshot({path:resolve(test.info().project.outputDir,`../phi-public-${width}.png`),animations:"disabled"});
});

test("a QR image containing the public URL opens its Lot without an account",async({page,api})=>{
 await api.useActor("anonymous");await api.scenario("public.trace");await page.goto("/scan");
 const url=`http://127.0.0.1:3300/trace/${publicToken}`;
 const png=await QRCode.toBuffer(url,{width:420,margin:4,errorCorrectionLevel:"M"});
 await page.getByLabel("Chọn ảnh mã QR",{exact:true}).setInputFiles({name:"public-lot.png",mimeType:"image/png",buffer:png});
 await expect(page).toHaveURL(url);
 await expect(page.getByRole("heading",{name:"Nông sản có cảnh báo cần đọc trước khi sử dụng",exact:true})).toBeVisible();
 expect(api.requests().some(r=>r.path.startsWith("/lots"))).toBe(false);
 await QRCode.toFile(resolve(test.info().project.outputDir,"../phi-public-qr.png"),url,{width:420,margin:4});
});

const proofLabels={VERIFIED:"Đã xác nhận trên sổ cái",PENDING:"Đang chờ xác nhận sổ cái",INTEGRITY_WARNING:"Cảnh báo tính toàn vẹn",BLOCKCHAIN_UNAVAILABLE:"Sổ cái chưa khả dụng"} as const;
for(const proofStatus of Object.keys(proofLabels) as Array<keyof typeof proofLabels>){
 registerScenario(`public.edge.${proofStatus}`,{handle(r){
  if(r.path.startsWith("/public/trace/"))return {data:{...publicLot,proofStatus,currentState:"FOR_SALE",isExpired:false,lotName:"X".repeat(200),lotCode:"Q".repeat(100)}};
  if(r.path.endsWith("/evidence"))return {data:{items:[]}};
 }});
 test(`recall notice and long names remain readable with ${proofStatus} at 320px`,async({page,api})=>{
  await api.useActor("anonymous");await api.scenario(`public.edge.${proofStatus}`);await page.setViewportSize({width:320,height:900});await page.goto(`/trace/${publicToken}`);
  const heading=page.getByRole("heading",{level:1});await expect(heading).toHaveText("X".repeat(200));
  expect(await heading.evaluate(e=>e.scrollWidth<=e.clientWidth)).toBe(true);
  await expect(page.getByText("Đang bày bán",{exact:true})).not.toHaveClass(/bg-ok-bg/);
  await expect(page.getByText(proofLabels[proofStatus],{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  await page.getByRole("button",{name:"EN",exact:true}).click();
  await expect(page.getByText(({VERIFIED:"Confirmed on the ledger",PENDING:"Awaiting ledger confirmation",INTEGRITY_WARNING:"Integrity warning",BLOCKCHAIN_UNAVAILABLE:"Ledger unavailable"})[proofStatus],{exact:true})).toBeVisible();
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
 });
}
test("public API outage is retryable and never presented as a missing lot",async({page,api})=>{
 await api.useActor("anonymous");await api.scenario("public.unavailable");await page.goto(`/trace/${publicToken}`);
 await expect(page.getByText("Không tải được dữ liệu",{exact:true})).toBeVisible();
 await expect(page.getByRole("heading",{name:"Không tìm thấy mã truy xuất",exact:true})).toHaveCount(0);
 await api.scenario("public.trace");await page.getByRole("button",{name:"Thử lại",exact:true}).click();
 await expect(page.getByText("Đã xác nhận trên sổ cái",{exact:true})).toBeVisible();
});
