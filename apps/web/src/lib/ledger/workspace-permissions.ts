import { localized } from "./i18n";
export const ENTERPRISE_PERMISSION_CODES = ["profile.read", "profile.manage", "members.read", "members.manage", "roles.manage", "partners.read", "partners.manage", "catalog.read", "catalog.manage", "sites.read", "sites.manage", "vehicles.read", "vehicles.manage", "production.read", "production.write", "distribution.read", "distribution.write", "distribution.sign", "trace.read", "qr.manage", "reports.read", "processing.read", "processing.write", "materials.read", "materials.manage", "inventory.manage", "quarantine.manage", "evidence.read", "evidence.manage", "quantity.adjust", "cases.read", "cases.respond"] as const;
export type EnterprisePermission = typeof ENTERPRISE_PERMISSION_CODES[number];
export const PERMISSION_LABEL: Record<string, string> = localized({
  "profile.read": "Xem hồ sơ", "profile.manage": "Điều chỉnh hồ sơ", "members.read": "Xem thành viên", "members.manage": "Quản lý thành viên", "roles.manage": "Quản lý nhóm quyền",
  "partners.read": "Xem đối tác", "partners.manage": "Quản lý đối tác", "catalog.read": "Xem danh mục", "catalog.manage": "Quản lý danh mục", "sites.read": "Xem cơ sở", "sites.manage": "Quản lý cơ sở",
  "vehicles.read": "Xem phương tiện", "vehicles.manage": "Quản lý phương tiện", "materials.read": "Xem vật tư", "materials.manage": "Quản lý vật tư",
  "production.read": "Xem sản xuất", "production.write": "Ghi sản xuất", "processing.read": "Xem chế biến", "processing.write": "Ghi chế biến", "inventory.manage": "Phân bổ tồn kho", "quarantine.manage": "Cách ly hàng",
  "distribution.read": "Xem giao nhận", "distribution.write": "Tạo giao nhận", "distribution.sign": "Ký giao nhận", "trace.read": "Xem truy xuất", "qr.manage": "Xem kho QR", "reports.read": "Xem báo cáo", "quantity.adjust": "Ghi nhận số lượng",
  "evidence.read": "Xem chứng cứ", "evidence.manage": "Quản lý chứng cứ", "cases.read": "Xem sự cố", "cases.respond": "Phản hồi sự cố",
});
export const PERMISSION_GROUPS = [
  { label: "Tổ chức", keys: ["profile.read", "profile.manage", "members.read", "members.manage", "roles.manage", "partners.read", "partners.manage"] },
  { label: "Nguồn lực", keys: ["catalog.read", "catalog.manage", "sites.read", "sites.manage", "vehicles.read", "vehicles.manage", "materials.read", "materials.manage"] },
  { label: "Vận hành", keys: ["production.read", "production.write", "processing.read", "processing.write", "inventory.manage", "quarantine.manage", "quantity.adjust"] },
  { label: "Giao nhận & truy xuất", keys: ["distribution.read", "distribution.write", "distribution.sign", "trace.read", "qr.manage", "reports.read", "evidence.read", "evidence.manage", "cases.read", "cases.respond"] },
];
export const TIER_LABEL: Record<number, string> = localized({ 1: "Cấp 1 · chủ quản", 2: "Cấp 2 · quản lý", 3: "Cấp 3 · nhân viên" });
/** Mirrors EnterpriseWorkspaceService's baseline dependency closure; the server remains authority. */
export function withDependencies(input: readonly string[]) {
  const dependencies: Record<string, string[]> = {
    "members.manage": ["members.read"], "roles.manage": ["members.read"], "partners.manage": ["partners.read"],
    "catalog.manage": ["catalog.read"], "sites.manage": ["sites.read"], "vehicles.manage": ["vehicles.read"],
    "production.write": ["production.read"], "distribution.write": ["distribution.read", "reports.read", "partners.read"],
    "distribution.sign": ["distribution.read"], "cases.respond": ["cases.read"], "evidence.manage": ["evidence.read"],
    "materials.manage": ["materials.read"], "inventory.manage": ["reports.read", "sites.read"],
    "quarantine.manage": ["reports.read", "sites.read"], "quantity.adjust": ["reports.read"],
  };
  const result = new Set(["profile.read", ...input]);
  for (const permission of result) for (const dependency of dependencies[permission] ?? []) result.add(dependency);
  return result;
}
