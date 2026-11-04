/** Display names only. All permissions are supplied by baseline policies and API guards. */
export type PlatformRole =
  | "SYSTEM_ADMIN"
  | "AUDITOR";
export const ROLE_LABEL: Record<PlatformRole, string> = {
  SYSTEM_ADMIN: "Quản trị nền tảng",
  AUDITOR: "Kiểm toán viên",
};
