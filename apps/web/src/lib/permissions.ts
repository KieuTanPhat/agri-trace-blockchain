import type { Role } from "./types";

export function canWriteFarm(role?: Role): boolean {
  return role === "FARM_STAFF";
}

export function canAccessManagementRoute(path: string, role: Role): boolean {
  const within = (prefix: string) =>
    path === prefix || path.startsWith(prefix + "/");
  if (within("/admin")) return role === "SYSTEM_ADMIN";
  if (within("/iot-simulator")) return canWriteFarm(role);
  if (within("/production-cycles")) {
    return [
      "SYSTEM_ADMIN",
      "FARM_STAFF",
      "TRANSPORTER",
      "RETAILER",
      "AUDITOR",
    ].includes(role);
  }
  return true;
}
