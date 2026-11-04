import { test, expect } from "./fixtures";
import { resolve } from "node:path";
import { memberId, roleId, siteId, chainId } from "./fixtures/enterprise-membership";
import {registerScenario,readScenario} from "./fixtures/scenarios";
import { AUTH_SYNC_KEY } from "../../src/lib/auth-coordination";
registerScenario("membership.permission-unavailable",{handle(r,state){return r.path==="/chain-permissions"?{status:503,error:{code:"UNAVAILABLE",message:"Quyền tạm thời chưa kiểm tra được"}}:readScenario("membership.baseline").handle(r,state);}});

test("members stay aligned across tiers and can be filtered by name and tier", async ({ page, api }) => {
  await api.useActor("org-owner");
  await api.scenario("membership.baseline");
  const managerId = "77777777-7777-4777-8777-777777777777";
  const member = { id: memberId, fullName: "Nguyễn Thành Viên", email: "member@example.invalid", accountStatus: "ACTIVE", enterpriseRevision: 7, enterpriseRoles: [], enterpriseTier: 3, jobTitle: "Nhân viên", memberCode: "NV0017", supervisorId: managerId, phone: null, contactAddress: null, memberNote: null, responsibleFarmId: null, workSiteId: siteId };
  await page.route("**/api/enterprise-workspace/members", (route) => route.fulfill({ json: {
    success: true, data: { items: [member, { ...member, id: managerId, fullName: "Trần Quản Lý", email: "manager@example.invalid", enterpriseTier: 2, jobTitle: "Quản lý sản xuất", supervisorId: null }] },
    timestamp: "2026-11-04T06:00:00Z", requestId: "isolated-members-ui",
  } }));
  await page.goto("/enterprise/members");
  const list = page.getByRole("list", { name: "Danh sách thành viên", exact: true });
  await expect(list.getByRole("button")).toHaveCount(2);
  const manager = await list.getByText("Trần Quản Lý", { exact: true }).boundingBox();
  const staff = await list.getByText("Nguyễn Thành Viên", { exact: true }).boundingBox();
  expect(manager!.x).toBe(staff!.x);
  await page.getByRole("textbox", { name: "Tìm thành viên", exact: true }).fill("Quản lý");
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list.getByText("Trần Quản Lý", { exact: true })).toBeVisible();
  await page.getByRole("textbox", { name: "Tìm thành viên", exact: true }).fill("");
  await page.getByRole("combobox", { name: "Cấp", exact: true }).click();
  await page.getByRole("option", { name: "Cấp 3", exact: true }).click();
  await expect(list.getByRole("button")).toHaveCount(1);
  await expect(list.getByText("Nguyễn Thành Viên", { exact: true })).toBeVisible();
});

test("background permission recheck keeps the draft usable and locks it only if verification fails",async({page,api})=>{
 await api.useActor("org-owner");await api.scenario("membership.baseline");await page.goto("/enterprise/members/new");
 const name=page.getByRole("dialog").getByLabel("Họ tên",{exact:true});await name.fill("Bản nháp đang nhập");
 let continueCheck!:()=>void;const held=new Promise<void>(resolve=>{continueCheck=resolve;});
 await page.route("**/api/chain-permissions",async route=>{await held;await route.fallback();});
 await page.evaluate(()=>window.dispatchEvent(new Event("focus")));
 await expect(name).toBeVisible();await expect(name).toHaveValue("Bản nháp đang nhập");expect(api.requests().some(r=>r.method==="POST"&&r.path==="/enterprise-workspace/members")).toBe(false);
 continueCheck();await expect(name).toBeVisible();await expect(name).toHaveValue("Bản nháp đang nhập");
 await page.unroute("**/api/chain-permissions");await api.scenario("membership.permission-unavailable");
 await page.evaluate(()=>window.dispatchEvent(new Event("focus")));await expect(page.getByText("Chưa xác minh được quyền truy cập",{exact:true}).first()).toBeVisible();await expect(name).toBeHidden();
 await api.scenario("membership.baseline");await page.getByRole("button",{name:"Thử lại",exact:true}).click();await expect(name).toBeVisible();await expect(name).toHaveValue("Bản nháp đang nhập");
});
test("member creation preserves delegated scopes and attachments; edit retains email and version", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("membership.baseline");
  await page.goto("/enterprise/members/new");
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Họ tên", { exact: true }).fill("Nguyễn Thành Viên");
  await dialog.getByLabel("Email", { exact: true }).fill("member@example.invalid");
  await dialog.getByLabel("Chức danh", { exact: true }).fill("Nhân viên");
  await dialog.getByLabel("Điện thoại", { exact: true }).fill("090 123 4567");
  await dialog.getByLabel("Địa chỉ liên hệ", { exact: true }).fill("Địa chỉ liên hệ ban đầu");
  await dialog.getByRole("button", { name: "Thêm nhóm quyền", exact: true }).click();
  await dialog.getByRole("combobox", { name: "Nhóm quyền 1", exact: true }).click();
  await page.getByRole("option", { name: /Nhân viên trong phạm vi/ }).click();
  await dialog.getByLabel("Chuỗi trong phạm vi", { exact: true }).check();
  await dialog.getByLabel("Cơ sở trong phạm vi PRODUCTION", { exact: true }).check();
  await dialog.getByLabel("Ảnh đại diện", { exact: true }).setInputFiles({ name: "avatar.png", mimeType: "image/png", buffer: Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aWQAAAABJRU5ErkJggg==", "base64") });
  await dialog.getByRole("button", { name: "Tạo thành viên", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const create = api.requests().find(request => request.method === "POST" && request.path === "/enterprise-workspace/members");
  expect(create?.idempotencyKey).toBeTruthy();
  expect(JSON.parse(create!.body!)).toMatchObject({ email: "member@example.invalid", tier: 2, phone: "0901234567", roles: [{ roleId, chainIds: [chainId], siteIds: [siteId] }] });
  const upload = api.requests().find(request => request.method === "POST" && request.path === "/enterprise-workspace/evidence");
  expect(upload?.body).toContain("MEMBER_AVATAR"); expect(upload?.body).toContain(memberId);
  await page.goto(`/enterprise/members/${memberId}/edit`);
  await expect(dialog.getByLabel("Email", { exact: true })).toHaveCount(0);
  await dialog.getByLabel("Địa chỉ liên hệ", { exact: true }).fill("Địa chỉ đã cập nhật");
  await dialog.getByRole("button", { name: "Lưu thay đổi", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  const edit = api.requests().find(request => request.method === "POST" && request.path === `/enterprise-workspace/members/${memberId}`);
  expect(JSON.parse(edit!.body!)).toMatchObject({ version: 7, contactAddress: "Địa chỉ đã cập nhật" });
  expect(JSON.parse(edit!.body!)).not.toHaveProperty("email");
  await api.useActor("org-staff"); await page.goto("/enterprise/members/new");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Tạo thành viên", exact: true })).toHaveCount(0);
});
test("profile respects private content denial and submits contact as a versioned pending amendment", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("membership.baseline");
  await page.goto("/enterprise/profile");
  await page.getByRole("button", { name: "Xem", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText("Không được tải nội dung chứng cứ này");
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "Đề nghị đổi liên hệ", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await dialog.getByLabel("Email liên hệ", { exact: true }).fill("new-contact@example.invalid");
  await dialog.getByLabel("Lý do thay đổi", { exact: true }).fill("Đổi thông tin liên hệ đã đối chiếu");
  await dialog.getByRole("button", { name: "Gửi đề nghị", exact: true }).click();
  await expect(dialog).toHaveCount(0);
  await expect(page.getByText("Đang có đề nghị chờ nền tảng duyệt", { exact: true })).toBeVisible();
  const command = api.requests().find(request => request.method === "POST" && request.path === "/enterprise-workspace/profile/contact");
  expect(JSON.parse(command!.body!)).toMatchObject({ contactEmail: "new-contact@example.invalid", version: 7 });
  expect(JSON.parse(command!.body!)).not.toHaveProperty("legalForm");
  await expect(page.getByText("contact@example.invalid", { exact: true })).toBeVisible();
  await page.screenshot({path:resolve(test.info().project.outputDir,"../task-9-profile-desktop.png"),fullPage:true});
  await page.setViewportSize({width:390,height:844});
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
  await page.screenshot({path:resolve(test.info().project.outputDir,"../task-9-profile-mobile.png"),fullPage:true});
});
test("enterprise identity switch clears rendered A before the delayed B workspace response", async ({ page, api }) => {
  await api.useActor("org-owner"); await api.scenario("membership.identity");
  await page.goto("/enterprise/profile");
  await expect(page.getByText("PRIVATE_ORG_A_ADDRESS", { exact: false })).toBeVisible();
  await api.useActor("org-manager");
  const bRequest = page.waitForRequest(request => new URL(request.url()).pathname === "/api/enterprise-workspace" && request.headers().authorization === "Bearer fixture-org-manager");
  await page.evaluate((key) => {
    localStorage.setItem(key, JSON.stringify({ id: crypto.randomUUID(), state: "signed-in" }));
    window.dispatchEvent(new StorageEvent("storage", { key }));
  }, AUTH_SYNC_KEY);
  await bRequest;
  await expect(page.getByText("PRIVATE_ORG_A_ADDRESS", { exact: false })).toHaveCount(0);
  await expect(page.getByText("PRIVATE_ORG_B_ADDRESS", { exact: false })).toBeVisible();
});
