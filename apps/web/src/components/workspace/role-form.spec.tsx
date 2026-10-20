import "@testing-library/jest-dom/vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  groupPermissions,
  permissionLabels,
  type EnterpriseRole,
} from "@/lib/workspace";
import { RoleForm } from "./role-form";

const fixture = vi.hoisted(() => ({
  run: vi.fn(),
  push: vi.fn(),
  templates: [
    {
      code: "FARM_RECORDER",
      name: "Nhân viên sản xuất",
      capability: "FARM",
      permissions: ["profile.read", "catalog.read", "production.write"],
    },
    {
      code: "FARM_SUPERVISOR",
      name: "Quản lý sản xuất",
      capability: "FARM",
      permissions: ["profile.read", "profile.manage", "members.manage"],
    },
  ],
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: fixture.push }),
}));
vi.mock("@/components/manage", () => ({
  PageHeader: ({ title }: { title: string }) => <h1>{title}</h1>,
  CommandState: () => null,
}));
vi.mock("@/lib/workspace", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/workspace")>();
  return {
    ...actual,
    useWorkspaceData: (path: string) => ({
      data: path.endsWith("role-templates")
        ? { items: fixture.templates }
        : { permissions: Object.keys(actual.permissionLabels) },
      loading: false,
      error: "",
    }),
    useWorkspaceCommand: () => ({
      run: fixture.run,
      pending: false,
      frozen: false,
      retrying: false,
      error: "",
    }),
  };
});

afterEach(cleanup);
beforeEach(() => {
  fixture.run.mockReset().mockResolvedValue(false);
  fixture.push.mockReset();
});

describe("role permission matrix", () => {
  it("shows every permission together and preserves existing values and the role version", async () => {
    const role = {
      id: "role-1",
      name: "Nhóm công việc riêng",
      permissions: ["profile.read", "future.permission"],
      version: 7,
    } as EnterpriseRole;
    const { container } = render(<RoleForm role={role} />);

    const groups = groupPermissions(Object.keys(permissionLabels));
    const visibleLabels = screen
      .getAllByRole("rowheader")
      .map((row) => row.textContent);
    expect(visibleLabels).toHaveLength(
      Object.keys(permissionLabels).length + groups.length,
    );
    expect(visibleLabels).toEqual(
      expect.arrayContaining([
        ...Object.values(permissionLabels),
        ...groups.map((group) => group.title),
      ]),
    );
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(container.querySelector("[aria-expanded]")).toBeNull();

    fireEvent.click(
      screen.getByLabelText("Chọn quyền Xem giống và vật tư truy xuất"),
    );
    expect(
      screen.getByLabelText("Tự chọn quyền: Xem giống và vật tư truy xuất"),
    ).toBeChecked();
    expect(
      screen.getByRole("rowheader", {
        name: "Xem giống và vật tư truy xuất",
      }),
    ).toBeVisible();
    fireEvent.click(screen.getByRole("button", { name: "Lưu thay đổi" }));

    await waitFor(() =>
      expect(fixture.run).toHaveBeenCalledWith(
        "/enterprise-workspace/roles/role-1",
        {
          name: role.name,
          permissions: ["profile.read", "future.permission", "materials.read"],
          version: 7,
        },
      ),
    );
  });

  it("edits only the active template column and preserves a name entered by the user", async () => {
    render(<RoleForm />);
    fireEvent.click(screen.getByRole("button", { name: "Nhân viên sản xuất" }));
    expect(screen.getByLabelText(/^Tên nhóm quyền/)).toHaveValue(
      "Nhân viên sản xuất",
    );
    expect(
      screen.getByLabelText("Quản lý sản xuất: Sửa hồ sơ và gửi lại xét duyệt"),
    ).toBeDisabled();
    fireEvent.click(
      screen.getByLabelText("Nhân viên sản xuất: Xem giống và vật tư truy xuất"),
    );
    for (const column of screen.getAllByLabelText("Chọn mẫu Nhân viên sản xuất"))
      expect(column).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByRole("button", { name: "Tạo nhóm quyền" }));
    await waitFor(() =>
      expect(fixture.run).toHaveBeenCalledWith("/enterprise-workspace/roles", {
        name: "Nhân viên sản xuất",
        permissions: [...fixture.templates[0].permissions, "materials.read"],
      }),
    );

    fireEvent.change(screen.getByLabelText(/^Tên nhóm quyền/), {
      target: { value: "Nhóm do tôi đặt tên" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Quản lý sản xuất" }));
    expect(screen.getByLabelText(/^Tên nhóm quyền/)).toHaveValue(
      "Nhóm do tôi đặt tên",
    );
    fireEvent.click(
      screen.getByLabelText("Chọn cả nhóm Đối tác"),
    );
    expect(
      screen.getByLabelText("Quản lý sản xuất: Xem đối tác"),
    ).toBeChecked();
    expect(
      screen.getByLabelText("Quản lý sản xuất: Mời và quản lý liên kết"),
    ).toBeChecked();
    expect(
      screen.getByLabelText("Quản lý sản xuất: Xem giống và vật tư truy xuất"),
    ).not.toBeChecked();
  });
});
