import {test,expect} from "./fixtures";
import {productId,farmId} from "./fixtures/enterprise-products";
import {resolve} from "node:path";
test("product revision keeps zero price, current version and canonical URLs; viewer cannot write",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("products.baseline");await page.goto(`/enterprise/products/${productId}/edit`);
 const dialog=page.getByRole("dialog").last();await expect(dialog.getByLabel("Giá (VND, tùy chọn)",{exact:true})).toHaveValue("0");
 await dialog.getByLabel("Lý do thay đổi",{exact:true}).fill("Cập nhật mô tả đã kiểm tra");await dialog.getByRole("button",{name:"Lưu phiên bản mới",exact:true}).click();
 await expect(dialog.getByRole("button",{name:"Lưu phiên bản mới",exact:true})).toHaveCount(0);
 const command=api.requests().find(r=>r.method==="POST"&&r.path===`/enterprise-workspace/products/${productId}`)!;expect(command.idempotencyKey).toBeTruthy();expect(JSON.parse(command.body!)).toMatchObject({version:7,status:"INACTIVE",product:{price:0,sku:"XOAI-01",originFarmId:farmId}});
 await page.goto("/enterprise/products");await page.getByRole("textbox",{name:"Tìm sản phẩm"}).fill("không tồn tại");await expect(page.getByText("Chưa có sản phẩm",{exact:true})).toBeVisible();
 await api.useActor("org-staff");await page.goto("/enterprise/products/new");await expect(page.getByRole("dialog")).toHaveCount(0);expect(api.requests().filter(r=>r.method==="POST"&&r.path==="/catalog/products")).toHaveLength(0);
});
test("CSV retains baseline syntax and applies only the previewed rows and digest",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("products.baseline");await page.goto("/enterprise/products/import");
 const csv=page.getByRole("textbox",{name:"Nội dung CSV"});await csv.fill('productName,sku\n"unclosed');await page.getByRole("button",{name:"Xem trước",exact:true}).click();await expect(page.getByText("CSV chưa đóng dấu nháy",{exact:true})).toBeVisible();expect(api.requests().filter(r=>r.path.endsWith("/preview"))).toHaveLength(0);
 await csv.fill(`productName,sku,category,originFarmId,defaultUnit,storageConditions,ingredients,usageInstructions,price\r\n"Xoài, tươi",X-1,FRUIT,${farmId},kg,Bảo quản mát,Xoài tươi,Rửa sạch,0`);await page.getByRole("button",{name:"Xem trước",exact:true}).click();await page.getByRole("button",{name:"Áp dụng 1 sản phẩm",exact:true}).click();
 await expect(page).toHaveURL(/\/enterprise\/products$/);const preview=api.requests().find(r=>r.path.endsWith("/preview"))!,apply=api.requests().find(r=>r.path.endsWith("/apply"))!;expect(JSON.parse(apply.body!)).toEqual({...JSON.parse(preview.body!),digest:"a".repeat(64)});expect(apply.idempotencyKey).toBeTruthy();
 await page.screenshot({path:resolve(test.info().project.outputDir,"../task-10-products-desktop.png"),fullPage:true});await page.setViewportSize({width:390,height:844});expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);await page.screenshot({path:resolve(test.info().project.outputDir,"../task-10-products-mobile.png"),fullPage:true});
});
test("unknown product outcome survives reload and reconciles across two tabs without another domain POST",async({page,context,api})=>{
 await api.useActor("org-owner");await api.scenario("products.unknown");await page.goto(`/enterprise/products/${productId}/edit`);
 const dialog=page.getByRole("dialog").last();await dialog.getByLabel("Lý do thay đổi",{exact:true}).fill("Đối soát kết quả chưa nhận được");await dialog.getByRole("button",{name:"Lưu phiên bản mới",exact:true}).click();await expect(page.getByTestId("ledger-recovery-panel")).toBeVisible();
 await page.reload();await expect(page.getByTestId("ledger-recovery-panel")).toBeVisible();const second=await context.newPage();await second.goto("/enterprise/products");await expect(second.getByTestId("ledger-recovery-panel")).toBeVisible();
 await second.getByTestId("ledger-recovery-panel").getByRole("button",{name:"Đối soát",exact:true}).click();await expect(second.getByTestId("ledger-recovery-panel")).toHaveCount(0);await expect(page.getByTestId("ledger-recovery-panel")).toHaveCount(0);
 const writes=api.requests().filter(r=>r.method==="POST"&&r.path===`/enterprise-workspace/products/${productId}`);expect(writes).toHaveLength(1);const inspect=api.requests().find(r=>r.path==="/command-requests/status")!;expect(inspect.idempotencyKey).toBe(writes[0].idempotencyKey);expect(JSON.parse(inspect.body!)).toMatchObject({operation:"EW_UPDATE_PRODUCT",payload:{id:productId,version:7}});await second.close();
});
