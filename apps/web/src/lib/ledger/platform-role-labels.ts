/** Display names only. All permissions are supplied by baseline policies and API guards. */
export type PlatformRole =
  | "SYSTEM_ADMIN"
  | "PLATFORM_OPERATOR"
  | "PLATFORM_CASE_MANAGER"
  | "PLATFORM_PRIVACY_OFFICER"
  | "AUDITOR";
export const ROLE_LABEL: Record<PlatformRole, string> = {
  SYSTEM_ADMIN: "Quản trị nền tảng",
  PLATFORM_OPERATOR: "Vận hành nền tảng",
  PLATFORM_CASE_MANAGER: "Quản lý vụ việc",
  PLATFORM_PRIVACY_OFFICER: "Phụ trách quyền riêng tư",
  AUDITOR: "Kiểm toán viên",
};
