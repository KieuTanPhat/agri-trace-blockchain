import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { test,expect } from "./fixtures";
import { operationId } from "./fixtures/platform-operations";
test("trace report exports the server CSV with explicit dates and no domain write",async({page,api})=>{
 await api.useActor("auditor");await api.scenario("operations.report");await page.goto("/admin/trace-report");await expect(page.getByText("LOT_CREATED",{exact:true})).toBeVisible();await page.getByLabel("Từ ngày",{exact:true}).fill("2026-10-01");await page.getByLabel("Đến ngày",{exact:true}).fill("2026-10-23");const download=page.waitForEvent("download");await page.getByRole("button",{name:"Xuất CSV",exact:true}).click();const file=await download;expect(file.suggestedFilename()).toBe("baseline-kde.csv");expect(await readFile((await file.path())!,"utf8")).toContain("9007199254740993.125");expect(api.requests().filter(r=>r.method!=="GET"&&!r.path.startsWith("/auth/"))).toHaveLength(0);
});
test("invoice settlement retains exact pending body and version; auditor cannot settle",async({page,api})=>{
 await api.useActor("platform-admin");await api.scenario("billing.unknown");await page.goto("/admin/billing/invoices?id="+operationId);await expect(page.getByRole("heading",{name:"INV-REAL-17",exact:true})).toBeVisible();await page.getByRole("button",{name:"Xác nhận chuyển khoản",exact:true}).click();const d=page.getByRole("dialog").last();await d.getByLabel("Mã giao dịch ngân hàng",{exact:true}).fill("BANK-1234");await d.getByLabel("Căn cứ xác nhận",{exact:true}).fill("Đã đối soát chuyển khoản thực tế");await d.getByRole("button",{name:"Xác nhận đã thu",exact:true}).click();await expect(page.getByTestId("ledger-command-pending")).toBeVisible();await expect(d.getByLabel("Mã giao dịch ngân hàng",{exact:true})).toBeDisabled();await d.getByRole("button",{name:"Đối soát",exact:true}).click();await expect(page.getByTestId("ledger-command-pending")).toHaveCount(0);const posts=api.requests().filter(r=>r.method==="POST"&&r.path.endsWith("/confirm-payment"));expect(posts).toHaveLength(2);expect(posts[1]!.body).toBe(posts[0]!.body);expect(posts[1]!.idempotencyKey).toBe(posts[0]!.idempotencyKey);expect(api.requests().some(r=>/activate/.test(r.path))).toBe(false);
 await api.useActor("auditor");await api.scenario("billing.denied");await page.goto("/admin/billing/invoices?id="+operationId);await expect(page.getByRole("heading",{name:"INV-REAL-17",exact:true})).toBeVisible();await expect(page.getByRole("button",{name:"Xác nhận chuyển khoản",exact:true})).toHaveCount(0);
});
test("plan draft sends only baseline fees limits and note without preview modules",async({page,api})=>{
 await api.useActor("platform-admin");await api.scenario("billing.allowed");await page.goto("/admin/billing");await page.getByRole("button",{name:"Tạo phiên bản nháp",exact:true}).click();const d=page.getByRole("dialog");await d.getByLabel("Ghi chú thay đổi",{exact:true}).fill("Bảng giá cho kỳ tiếp theo");await d.getByRole("button",{name:"Lưu bản nháp",exact:true}).click();await expect(d).toHaveCount(0);const r=api.requests().find(r=>r.method==="POST"&&r.path.endsWith("/versions"));expect(r).toBeTruthy();expect(JSON.parse(r!.body!)).toEqual({setupFee:100000,annualFee:200000,termMonths:12,limits:{chains:3,members:5,products:100,qrLabels:1000},note:"Bảng giá cho kỳ tiếp theo"});
});

test("operations filters refresh the scoped outbox and cursor; operator has no write action",async({page,api})=>{
 await api.useActor("platform-operator");await api.scenario("operations.scoped");await page.goto("/admin/operations");await page.getByRole("tab",{name:"Outbox",exact:true}).click();await expect(page.getByText("GLOBAL_OUTBOX",{exact:true})).toBeVisible();await page.getByRole("combobox",{name:"Chuỗi",exact:true}).click();await page.getByRole("option",{name:"Chuỗi được chọn",exact:true}).click();await expect(page.getByText("SCOPED_OUTBOX",{exact:true})).toBeVisible();await expect(page.getByText("GLOBAL_OUTBOX",{exact:true})).toHaveCount(0);await page.getByRole("button",{name:"Tải thêm",exact:true}).click();await expect(page.getByText("CURSOR_SECOND",{exact:true})).toBeVisible();expect(api.requests().some(r=>r.path.includes("chainId="+operationId)&&r.path.includes("cursor=cursor-2"))).toBe(true);expect(api.requests().filter(r=>r.method!=="GET"&&!r.path.startsWith("/auth/"))).toHaveLength(0);await expect(page.getByRole("button",{name:/phát lại|sửa binding|giải phóng hold/i})).toHaveCount(0);
 await expect(page.getByRole("tab",{name:"Sao lưu",exact:true})).toHaveCount(0);
});
test("retained health scope certificate expiry and mail metadata remain explicit",async({page,api})=>{
 await api.useActor("platform-operator");await api.scenario("operations.scoped");await page.goto("/admin/operations");await page.getByRole("combobox",{name:"Chuỗi",exact:true}).click();await page.getByRole("option",{name:"Chuỗi được chọn",exact:true}).click();await expect(page.getByText("Không lọc được theo bộ lọc này",{exact:true}).first()).toBeVisible();await page.getByRole("combobox",{name:"Tổ chức",exact:true}).click();await expect(page.getByRole("option",{name:"Đơn vị kiểm định",exact:true})).toHaveCount(0);await page.keyboard.press("Escape");await page.getByRole("tab",{name:"Chứng thư & khóa ký",exact:true}).click();await expect(page.getByText("Quá hạn 2 ngày",{exact:true})).toBeVisible();await expect(page.getByText(/Schema không có cột hết hạn cho khóa ký/)).toBeVisible();await expect(page.getByText(/ACTIVE 4/)).toBeVisible();await page.getByRole("tab",{name:"Email hệ thống",exact:true}).click();await expect(page.getByText("MAIL_METADATA_ONLY",{exact:true})).toBeVisible();await expect(page.getByRole("tabpanel")).not.toContainText("@");
});
test("retained catalog grouping search scope shared empty and unknown organization behavior",async({page,api})=>{
 await api.useActor("platform-admin");await api.scenario("operations.products");await page.goto("/admin/products");const farm=page.getByRole("row").filter({hasText:"Nông trại An Phú"});await expect(farm).toContainText("2");await expect(page.getByText("Đơn vị kiểm định",{exact:true})).toHaveCount(0);await expect(page.getByRole("link",{name:"Danh mục dùng chung",exact:true})).toHaveAttribute("href","/admin/products/shared");await page.getByRole("textbox",{name:"Tìm tổ chức, sản phẩm, SKU, GTIN hoặc giống",exact:true}).fill("Xoài cát");await expect(page.getByText("Hợp tác xã Bình Minh",{exact:true})).toBeVisible();await expect(page.getByText("Nông trại An Phú",{exact:true})).toHaveCount(0);await page.getByRole("textbox",{name:"Tìm tổ chức, sản phẩm, SKU, GTIN hoặc giống",exact:true}).fill("");await page.getByRole("combobox",{name:"Sản phẩm",exact:true}).click();await page.getByRole("option",{name:"Chưa có sản phẩm",exact:true}).click();await expect(page.getByText("Vận tải Chưa Có",{exact:true})).toBeVisible();await expect(page.getByText("Nông trại An Phú",{exact:true})).toHaveCount(0);await page.goto("/admin/products/"+operationId);await expect(page.getByText("Cải ngọt VietGAP",{exact:true})).toBeVisible();await expect(page.getByText("Cà chua bi",{exact:true})).toBeVisible();await expect(page.getByText("Xoài cát",{exact:true})).toHaveCount(0);await expect(page.getByText("Rau cải xanh",{exact:true})).toHaveCount(0);await page.goto("/admin/products/shared");await expect(page.getByText("Rau cải xanh",{exact:true})).toBeVisible();await page.goto("/admin/products/33333333-3333-4333-8333-333333333333");await expect(page.getByText("Chưa có sản phẩm",{exact:true})).toBeVisible();await page.goto("/admin/products/55555555-5555-4555-8555-555555555555");await expect(page.getByText("Không tìm thấy tổ chức",{exact:true})).toBeVisible();
});

test("admin can block and release public QR without changing a lot or rounding quantity", async ({ page, api }) => {
  await api.useActor("platform-admin");
  await api.scenario("operations.qr-control");
  await page.goto("/admin/lots?q=LOT-17");
  await expect(page.getByRole("heading", { name: "LOT-17", exact: true })).toBeVisible();
  await expect(page.getByText("9007199254740993.125 / 9007199254740993.125 kg", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Khóa QR", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Thông điệp hiển thị trên trang QR công khai", { exact: true }).fill("Lô hàng đang được xác minh");
  await dialog.getByLabel("Lý do nội bộ", { exact: true }).fill("Đối soát cảnh báo lô hàng");
  await dialog.getByRole("button", { name: "Khóa QR", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Mở khóa QR", exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Mở khóa QR", exact: true }).click();
  await dialog.getByLabel("Lý do mở khóa", { exact: true }).fill("Đã đối soát và gỡ cảnh báo");
  await dialog.getByRole("button", { name: "Mở khóa", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const writes = api.requests().filter(r => r.method === "POST" && !r.path.startsWith("/auth/"));
  expect(writes.map(r => r.path)).toEqual(["/platform-admin/qr-blocks", "/platform-admin/qr-blocks/66666666-6666-4666-8666-666666666666/unblock"]);
  expect(JSON.parse(writes[0]!.body!)).toEqual({ lotId: operationId, reason: "Đối soát cảnh báo lô hàng", publicMessage: "Lô hàng đang được xác minh" });
  expect(JSON.parse(writes[1]!.body!)).toEqual({ version: 3, reason: "Đã đối soát và gỡ cảnh báo" });
  await api.useActor("platform-operator");
  await page.goto("/admin/lots?q=LOT-17");
  await expect(page.getByRole("heading", { name: "LOT-17", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Khóa QR", exact: true })).toHaveCount(0);
});

test("reference edits retain the read version and baseline uppercase normalization", async ({ page, api }) => {
  await api.useActor("platform-admin");
  await api.scenario("operations.reference");
  await page.goto("/admin/reference-data");
  await page.getByRole("button", { name: "Sửa", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Mã", { exact: true }).fill(" kg ");
  await dialog.getByRole("button", { name: "Lưu", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const writes = api.requests().filter(r => r.method === "POST" && r.path === "/platform-admin/reference-items");
  expect(writes).toHaveLength(1);
  expect(writes[0]!.idempotencyKey).toBeTruthy();
  expect(JSON.parse(writes[0]!.body!)).toEqual({ category: "UNIT", code: "KG", label: "Kilogram", sortOrder: 10, status: "ACTIVE", version: 4 });
});

// Local presentation evidence shares the existing typed report scenario, without another smoke fixture per URL.
test("report layout keeps Ledger presentation on desktop and mobile", async ({ page, api }) => {
  await api.useActor("auditor");
  await api.scenario("operations.report");
  await page.goto("/admin/trace-report");
  await expect(page.getByText("LOT_CREATED", { exact: true })).toBeVisible();
  await page.evaluate(() => document.fonts.ready);
  await page.screenshot({ path: resolve(test.info().project.outputDir, "../task-8-report-desktop.png"), fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: resolve(test.info().project.outputDir, "../task-8-report-mobile.png"), fullPage: true });
});
