import { describe, expect, it } from "vitest";
import { canAccessManagementRoute, canWriteFarm } from "./permissions";

describe("Web business permissions", () => {
  it("keeps specialist platform roles inside their assigned functions", () => {
    const allowed = {
      PLATFORM_OPERATOR: ["/admin/operations", "/admin/recall"],
      PLATFORM_CASE_MANAGER: [
        "/admin/cases",
        "/admin/cases/new",
        "/admin/recall",
      ],
      PLATFORM_PRIVACY_OFFICER: ["/admin/privacy"],
    } as const;
    for (const role of Object.keys(allowed) as (keyof typeof allowed)[]) {
      for (const path of allowed[role])
        expect(canAccessManagementRoute(path, role)).toBe(true);
      for (const path of [
        "/admin/users",
        "/admin/approvals",
        "/admin/organizations",
        "/production-cycles",
        "/lots",
        "/distribution",
        "/enterprise",
        "/iot-simulator",
      ])
        expect(canAccessManagementRoute(path, role)).toBe(false);
      expect(canAccessManagementRoute("/admin/security", role)).toBe(true);
      expect(canAccessManagementRoute("/account/privacy", role)).toBe(true);
    }
    expect(
      canAccessManagementRoute("/admin/privacy", "PLATFORM_CASE_MANAGER"),
    ).toBe(false);
    expect(
      canAccessManagementRoute("/admin/cases/new", "PLATFORM_OPERATOR"),
    ).toBe(false);
  });
  it.each(["AUDITOR", "TRANSPORTER", "RETAILER"] as const)(
    "keeps %s from farmer writes and the user IoT simulator",
    (role) => {
      expect(canWriteFarm(role)).toBe(false);
      expect(canAccessManagementRoute("/iot-simulator", role)).toBe(false);
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
  it("uses current server production access for the scoped IoT route", () => {
    expect(
      canAccessManagementRoute("/iot-simulator", "TRANSPORTER", true),
    ).toBe(true);
    expect(
      canAccessManagementRoute("/iot-simulator", "FARM_STAFF", false),
    ).toBe(false);
    expect(canAccessManagementRoute("/admin", "TRANSPORTER", true)).toBe(false);
  });
});
