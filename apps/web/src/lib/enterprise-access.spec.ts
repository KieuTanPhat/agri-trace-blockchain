import { describe, expect, it } from "vitest";
import {
  canUseEnterpriseRoute,
  type EnterpriseAccess,
} from "./enterprise-access";
const staff: EnterpriseAccess = {
  stage: "ACTIVE",
  owner: false,
  primary: false,
  capabilities: ["FARM"],
  permissions: ["profile.read", "production.read", "production.write"],
};
describe("Current enterprise navigation authority", () => {
  it("gives journal staff production access without exposing membership, distribution or service administration", () => {
    for (const path of [
      "/production-cycles",
      "/production-cycles/cycle/journal/new",
      "/enterprise/profile",
    ])
      expect(canUseEnterpriseRoute(path, staff)).toBe(true);
    for (const path of [
      "/enterprise/members",
      "/enterprise/roles",
      "/enterprise/products/new",
      "/distribution",
      "/enterprise/service",
      "/enterprise/connections",
      "/enterprise/qr",
    ])
      expect(canUseEnterpriseRoute(path, staff)).toBe(false);
  });
  it("does not turn member read permission into editable account detail access", () => {
    const reader = { ...staff, permissions: ["profile.read", "members.read"] };
    expect(canUseEnterpriseRoute("/enterprise/members", reader)).toBe(true);
    expect(canUseEnterpriseRoute("/enterprise/members/id", reader)).toBe(false);
    expect(canUseEnterpriseRoute("/enterprise/members/new", reader)).toBe(
      false,
    );
  });
  it("keeps unactivated owners on review and service pages", () => {
    const pending = {
      ...staff,
      owner: true,
      primary: true,
      stage: "SELECT_SERVICE",
      permissions: [],
    };
    expect(canUseEnterpriseRoute("/enterprise/service/contract", pending)).toBe(
      true,
    );
    expect(canUseEnterpriseRoute("/enterprise/onboarding", pending)).toBe(true);
    for (const path of [
      "/enterprise",
      "/enterprise/connections",
      "/distribution",
      "/production-cycles",
    ])
      expect(canUseEnterpriseRoute(path, pending)).toBe(false);
  });
  it("hides producer and vehicle administration from a distributor without those capabilities", () => {
    const distributor = {
      ...staff,
      primary: true,
      capabilities: ["DISTRIBUTOR"],
      permissions: [
        "profile.read",
        "production.read",
        "vehicles.read",
        "distribution.read",
      ],
    };
    expect(canUseEnterpriseRoute("/distribution", distributor)).toBe(true);
    expect(canUseEnterpriseRoute("/production-cycles", distributor)).toBe(
      false,
    );
    expect(canUseEnterpriseRoute("/enterprise/vehicles", distributor)).toBe(
      false,
    );
  });
});
