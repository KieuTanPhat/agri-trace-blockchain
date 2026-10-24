import type { components } from "../../../src/lib/generated/api";
export const ACTOR_KEYS = [
  "anonymous",
  "platform-admin",
  "auditor",
  "platform-operator",
  "case-manager",
  "privacy-officer",
  "org-owner",
  "org-manager",
  "org-staff",
  "processor",
  "transporter",
  "distributor",
  "retailer",
  "compliance-reviewer",
] as const;
export type ActorKey = (typeof ACTOR_KEYS)[number];
export type Session = components["schemas"]["AuthSessionDto"];
const roles: Record<
  Exclude<ActorKey, "anonymous">,
  components["schemas"]["AuthRoleDto"]["code"]
> = {
  "platform-admin": "SYSTEM_ADMIN",
  auditor: "AUDITOR",
  "platform-operator": "PLATFORM_OPERATOR",
  "case-manager": "PLATFORM_CASE_MANAGER",
  "privacy-officer": "PLATFORM_PRIVACY_OFFICER",
  "org-owner": "FARM_STAFF",
  "org-manager": "FARM_STAFF",
  "org-staff": "FARM_STAFF",
  processor: "PROCESSOR",
  transporter: "TRANSPORTER",
  distributor: "DISTRIBUTOR",
  retailer: "RETAILER",
  "compliance-reviewer": "COMPLIANCE_REVIEWER",
};
export function actorSession(key: ActorKey): Session | null {
  if (key === "anonymous") return null;
  const id =
    String(ACTOR_KEYS.indexOf(key)).padStart(8, "0") +
    "-1111-4111-8111-111111111111";
  const organizationId =
    key.startsWith("platform-") ||
    ["case-manager", "privacy-officer"].includes(key)
      ? null
      : "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
  return {
    accessToken: `fixture-${key}`,
    tokenType: "Bearer",
    sessionId: "11111111-2222-4333-8444-555555555555",
    user: {
      id,
      email: `${key}@example.invalid`,
      fullName: `Tài khoản ${key}`,
      organizationId,
      organization: organizationId ? { status: "ACTIVE" } : null,
      accountStatus: "ACTIVE",
      mustChangePassword: false,
      createdAt: "2026-10-22T00:00:00.000Z",
      updatedAt: "2026-10-22T00:00:00.000Z",
      role: {
        id: "11111111-1111-4111-8111-222222222222",
        code: roles[key],
        name: roles[key],
      },
    },
  };
}
