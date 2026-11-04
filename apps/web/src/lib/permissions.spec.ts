import { describe, expect, it } from "vitest";
import { canAccessManagementRoute, canWriteFarm } from "./permissions";

describe("Web business permissions", () => {
  it("gives the single Admin role every platform function but no business workspace", () => {
    for (const path of [
      "/admin/operations",
      "/admin/recall",
      "/admin/cases",
      "/admin/cases/new",
      "/admin/privacy",
      "/admin/security",
      "/admin/users",
      "/admin/notifications",
      "/account/privacy",
    ])
      expect(canAccessManagementRoute(path, "SYSTEM_ADMIN")).toBe(true);
    for (const path of ["/enterprise", "/distribution"])
      expect(canAccessManagementRoute(path, "SYSTEM_ADMIN")).toBe(false);
  });
  it.each(["AUDITOR", "TRANSPORTER", "RETAILER"] as const)(
    "keeps %s from farmer writes while IoT follows device-route permissions",
    (role) => {
      expect(canWriteFarm(role)).toBe(false);
      expect(canAccessManagementRoute("/iot-simulator", role)).toBe(canAccessManagementRoute("/enterprise/devices", role));
      expect(canAccessManagementRoute("/production-cycles", role)).toBe(true);
    },
  );
  it("keeps farmer commands and limits Admin to platform routes", () => {
    expect(canWriteFarm("FARM_STAFF")).toBe(true);
    expect(canWriteFarm()).toBe(false);
    expect(canAccessManagementRoute("/iot-simulator", "FARM_STAFF")).toBe(true);
    expect(canAccessManagementRoute("/admin", "SYSTEM_ADMIN")).toBe(true);
    expect(canAccessManagementRoute("/production-cycles", "SYSTEM_ADMIN")).toBe(
      false,
    );
    expect(canAccessManagementRoute("/lots", "SYSTEM_ADMIN")).toBe(false);
    expect(canAccessManagementRoute("/admin/enterprises", "SYSTEM_ADMIN")).toBe(
      true,
    );
    expect(
      canAccessManagementRoute("/admin/compliance-assignments", "SYSTEM_ADMIN"),
    ).toBe(true);
    expect(canAccessManagementRoute("/admin/products", "SYSTEM_ADMIN")).toBe(
      true,
    );
    expect(
      canAccessManagementRoute("/admin/products/new", "SYSTEM_ADMIN"),
    ).toBe(false);
    expect(
      canAccessManagementRoute("/admin/products/shared", "SYSTEM_ADMIN"),
    ).toBe(true);
    expect(
      canAccessManagementRoute(
        "/admin/products/16e83e47-205d-4c9a-8ece-4e741b90ed32",
        "SYSTEM_ADMIN",
      ),
    ).toBe(true);
    expect(
      canAccessManagementRoute(
        "/admin/products/16e83e47-205d-4c9a-8ece-4e741b90ed32",
        "FARM_STAFF",
      ),
    ).toBe(false);
    for (const path of [
      "/admin/audit-log",
      "/admin/notifications",
      "/admin/security",
      "/admin/operations",
      "/admin/cases",
      "/admin/cases/new",
    ])
      expect(canAccessManagementRoute(path, "SYSTEM_ADMIN")).toBe(true);
    // Auditors read the platform audit log only.
    expect(canAccessManagementRoute("/admin/audit-log", "AUDITOR")).toBe(true);
    expect(canAccessManagementRoute("/admin/operations", "AUDITOR")).toBe(true);
    expect(canAccessManagementRoute("/admin/cases", "AUDITOR")).toBe(true);
    expect(
      canAccessManagementRoute(
        "/admin/cases/16e83e47-205d-4c9a-8ece-4e741b90ed32",
        "AUDITOR",
      ),
    ).toBe(true);
    expect(canAccessManagementRoute("/admin/cases/new", "AUDITOR")).toBe(false);
    for (const path of ["/admin", "/admin/approvals", "/admin/users"])
      expect(canAccessManagementRoute(path, "AUDITOR")).toBe(false);
    expect(canAccessManagementRoute("/admin/audit-log", "FARM_STAFF")).toBe(
      false,
    );
    // Everyone signed in may change their own password.
    for (const role of ["SYSTEM_ADMIN", "AUDITOR", "FARM_STAFF"] as const)
      expect(canAccessManagementRoute("/account/password", role)).toBe(true);
    expect(canAccessManagementRoute("/admin/farms", "SYSTEM_ADMIN")).toBe(
      false,
    );
    expect(canAccessManagementRoute("/admin/plots", "SYSTEM_ADMIN")).toBe(
      false,
    );
    expect(canAccessManagementRoute("/admin/users", "FARM_STAFF")).toBe(false);
    expect(canAccessManagementRoute("/admin/products", "FARM_STAFF")).toBe(
      false,
    );
  });
  it("gives the retired IoT address the same boundary as device management", () => {
    for (const role of ["FARM_STAFF", "TRANSPORTER", "DISTRIBUTOR", "RETAILER", "AUDITOR", "SYSTEM_ADMIN", "IOT_DEVICE"] as const)
      for (const production of [true, false])
        expect(canAccessManagementRoute("/iot-simulator", role, production)).toBe(canAccessManagementRoute("/enterprise/devices", role, production));
    expect(canAccessManagementRoute("/admin", "TRANSPORTER", true)).toBe(false);
  });
});
