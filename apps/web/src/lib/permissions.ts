import type { Role } from "./types";

export function canWriteFarm(role?: Role, productionAccess?: boolean): boolean {
  return productionAccess ?? role === "FARM_STAFF";
}

export function canAccessManagementRoute(
  path: string,
  role: Role,
  productionAccess?: boolean,
): boolean {
  const within = (prefix: string) =>
    path === prefix || path.startsWith(prefix + "/");
  if (within("/admin")) return role === "SYSTEM_ADMIN";
  if (within("/iot-simulator")) return canWriteFarm(role, productionAccess);
  if (within("/compliance"))
    return [
      "SYSTEM_ADMIN",
      "FARM_STAFF",
      "TRANSPORTER",
      "RETAILER",
      "AUDITOR",
      "COMPLIANCE_REVIEWER",
    ].includes(role);
  if (within("/production-cycles")) {
    return [
      "SYSTEM_ADMIN",
      "FARM_STAFF",
      "TRANSPORTER",
      "RETAILER",
      "AUDITOR",
      "COMPLIANCE_REVIEWER",
    ].includes(role);
  }
  return true;
}
