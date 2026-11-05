import { describe, expect, it } from "vitest";
import {
  canUseEnterpriseRoute,
  enterpriseLanding,
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
  it("allows a distributor's own vehicles and devices while keeping production behind its capability", () => {
    const distributor = {
      ...staff,
      primary: true,
      capabilities: ["DISTRIBUTOR"],
      permissions: [
        "profile.read",
        "production.read",
        "vehicles.read",
        "devices.read",
        "distribution.read",
      ],
    };
    expect(canUseEnterpriseRoute("/distribution", distributor)).toBe(true);
    expect(canUseEnterpriseRoute("/production-cycles", distributor)).toBe(
      false,
    );
    expect(canUseEnterpriseRoute("/enterprise/vehicles", distributor)).toBe(
      true,
    );
    expect(canUseEnterpriseRoute("/enterprise/devices", distributor)).toBe(true);
    expect(canUseEnterpriseRoute("/iot-simulator", distributor)).toBe(true);
    const reader = { ...distributor, permissions: ["profile.read"] };
    expect(canUseEnterpriseRoute("/enterprise/vehicles", reader)).toBe(false);
    expect(canUseEnterpriseRoute("/enterprise/devices", reader)).toBe(false);
    expect(canUseEnterpriseRoute("/iot-simulator", reader)).toBe(false);
  });
});

describe("enterpriseLanding", () => {
  it("sends an owner awaiting activation to the service page, not a blocked workspace", () => {
    const pending = { ...staff, stage: "APPROVED", owner: true, primary: true };
    expect(canUseEnterpriseRoute("/enterprise/partners", pending)).toBe(false);
    expect(enterpriseLanding(pending)).toBe("/enterprise/service");
  });
  it("keeps the workspace home once the service is active and has nothing for others", () => {
    expect(enterpriseLanding(staff)).toBe("/enterprise");
    expect(enterpriseLanding({ ...staff, stage: "APPROVED" })).toBeNull();
  });
});

it("only the primary enterprise owner can open employee activity",()=>{
 expect(canUseEnterpriseRoute("/enterprise/audit-log",staff)).toBe(false);
 expect(canUseEnterpriseRoute("/enterprise/audit-log",{...staff,permissions:["members.manage"]})).toBe(false);
 expect(canUseEnterpriseRoute("/enterprise/audit-log",{...staff,primary:true,permissions:["members.manage"]})).toBe(true);
});
