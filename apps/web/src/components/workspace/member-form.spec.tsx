import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { request } from "@/lib/api-client";
import { MemberForm } from "./member-form";

vi.mock("@/lib/api-client", () => ({ request: vi.fn() }));
vi.mock("@/lib/ledger/confirmation",()=>({importantAction:()=>null,useConfirm:()=>async()=>true}));
vi.mock("@/lib/auth-store", () => ({
  useAuth: () => ({
    user: { id: "owner", organizationId: "org", role: { code: "FARM_STAFF" } },
  }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

beforeEach(() => {
  vi.mocked(request).mockImplementation(async (path, init) => {
    if (path === "/enterprise-workspace/roles")
      return { items: [{ id: "role-1", name: "Nhân viên kho" }] } as never;
    if (path === "/enterprise-workspace")
      return { member: { primary: true }, permissions: ["members.manage"] } as never;
    if (path === "/enterprise-workspace/members" && init?.method !== "POST")
      return { items: [] } as never;
    if (path === "/supply-chains") return [] as never;
    if (path === "/catalog") return { farms: [] } as never;
    if (path === "/enterprise-workspace/sites") return { items: [] } as never;
    if (path === "/enterprise-workspace/members" && init?.method === "POST")
      return {
        record: { id: "member-7", memberCode: "NV0007", email: "a@example.test" },
      } as never;
    return {} as never;
  });
});
afterEach(() => {
  cleanup();
  vi.mocked(request).mockReset();
});

const fill = (label: RegExp, value: string) =>
  fireEvent.change(screen.getByLabelText(label), { target: { value } });

it("shows validation errors under each field and requires a phone", async () => {
  render(<MemberForm />);
  await screen.findByText("Nhân viên kho");
  fireEvent.click(screen.getByRole("button", { name: "Tạo tài khoản" }));
  const phone = screen.getByLabelText(/Số điện thoại liên hệ/);
  expect(phone).toHaveAttribute("aria-invalid", "true");
  expect(document.getElementById("member-phone-error")).toHaveTextContent(
    /số điện thoại/i,
  );
  expect(document.getElementById("member-email-error")).toBeTruthy();
  expect(document.getElementById("member-contactAddress-error")).toBeTruthy();
  expect(document.getElementById("member-roles-error")).toHaveTextContent(
    /nhóm quyền/i,
  );
  expect(
    vi.mocked(request).mock.calls.some(
      ([path, init]) => path === "/enterprise-workspace/members" && init?.method === "POST",
    ),
  ).toBe(false);
});

it("confirms the member before creating it and then shows the created member code", async () => {
  render(<MemberForm />);
  await screen.findByText("Nhân viên kho");
  fill(/^Họ tên/, "Nguyễn Văn A");
  fill(/^Email đăng nhập/, "a@example.test");
  fill(/^Chức danh/, "Nhân viên kho");
  fill(/Số điện thoại liên hệ/, "0901234567");
  fill(/^Địa chỉ liên hệ/, "12 Nguyễn Huệ, Quận 1");
  fireEvent.click(screen.getByRole("checkbox", { name: "Nhân viên kho" }));
  fireEvent.click(screen.getByRole("button", { name: "Tạo tài khoản" }));
  // Photo and documents are required before anything is sent.
  expect(await screen.findByText(/Ảnh đại diện: cần ít nhất 1 file/)).toBeInTheDocument();
  const image = new File([new Uint8Array([0xff, 0xd8, 0xff])], "a.jpg", { type: "image/jpeg" });
  fireEvent.change(screen.getByLabelText(/^Ảnh đại diện/), { target: { files: [image] } });
  fireEvent.change(screen.getByLabelText(/^Giấy tờ \/ chứng nhận/), { target: { files: [image] } });
  fireEvent.click(screen.getByRole("button", { name: "Tạo tài khoản" }));
  await screen.findByRole("heading", { name: "Xác nhận tạo thành viên" });
  expect(screen.getByText("0901234567")).toBeInTheDocument();
  expect(
    vi.mocked(request).mock.calls.some(
      ([path, init]) => path === "/enterprise-workspace/members" && init?.method === "POST",
    ),
  ).toBe(false);
  fireEvent.click(screen.getByRole("button", { name: "Xác nhận tạo" }));
  await screen.findByRole("heading", { name: "Đã tạo tài khoản thành viên" });
  expect(screen.getByText("NV0007")).toBeInTheDocument();
  const post = vi
    .mocked(request)
    .mock.calls.find(
      ([path, init]) => path === "/enterprise-workspace/members" && init?.method === "POST",
    )!;
  const body = JSON.parse(String(post[1]!.body));
  expect(body.phone).toBe("0901234567");
  expect(body.password).toBeUndefined();
  expect(body.contactAddress).toBe("12 Nguyễn Huệ, Quận 1");
  const uploads = vi
    .mocked(request)
    .mock.calls.filter(([path]) => path === "/enterprise-workspace/evidence");
  expect(uploads.map(([, init]) => (init!.body as FormData).get("kind"))).toEqual([
    "MEMBER_AVATAR",
    "MEMBER_DOCUMENT",
  ]);
  expect((uploads[0][1]!.body as FormData).get("entityId")).toBe("member-7");
  expect(screen.queryByLabelText("Liên kết kích hoạt")).toBeNull();
});
