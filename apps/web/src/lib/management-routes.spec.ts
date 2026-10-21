import { describe, expect, it } from "vitest";
import {
  mobileShortcuts,
  navigationGroups,
  routeContext,
  visibleAccountLinks,
  visibleGroups,
} from "./management-routes";

const owner = {
  stage: "ACTIVE",
  owner: true,
  primary: true,
  tier: 1,
  permissions: [
    "profile.read",
    "members.read",
    "trace.read",
    "distribution.read",
  ],
  capabilities: ["DISTRIBUTOR"],
};

describe("management route registry", () => {
  it("lists every route once", () => {
    const hrefs = navigationGroups.flatMap((g) => g.items.map((i) => i.href));
    expect(new Set(hrefs).size).toBe(hrefs.length);
  });
  it("shows the system administrator only platform groups", () => {
    const groups = visibleGroups({
      role: "SYSTEM_ADMIN",
      enterpriseUser: false,
    });
    expect(groups.every((g) => g.area === "platform")).toBe(true);
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(hrefs).toContain("/admin/enterprises");
    expect(hrefs).not.toContain("/admin/products");
    expect(mobileShortcuts(groups).map((i) => i.href)).toEqual([
      "/admin",
      "/admin/inbox",
      "/admin/enterprises",
      "/admin/audit-log",
    ]);
  });
  it("keeps the case manager to assigned functions", () => {
    const groups = visibleGroups({
      role: "PLATFORM_CASE_MANAGER",
      enterpriseUser: false,
    });
    expect(groups.flatMap((g) => g.items.map((i) => i.href))).toEqual([
      "/admin/inbox",
      "/admin/lots",
      "/admin/recall",
      "/admin/reports",
      "/admin/support",
      "/admin/cases",
    ]);
  });
  it("hides every enterprise route until enterprise access is loaded", () => {
    expect(
      visibleGroups({
        role: "DISTRIBUTOR",
        enterpriseUser: true,
        enterpriseAccess: null,
      }),
    ).toEqual([]);
  });
  it("shows enterprise members only what their permissions open", () => {
    const groups = visibleGroups({
      role: "DISTRIBUTOR",
      enterpriseUser: true,
      enterpriseAccess: owner,
    });
    const hrefs = groups.flatMap((g) => g.items.map((i) => i.href));
    expect(groups.every((g) => g.area === "enterprise")).toBe(true);
    expect(hrefs).toContain("/enterprise/members");
    expect(hrefs).not.toContain("/enterprise/roles/new");
    expect(hrefs).not.toContain("/enterprise/qr");
    expect(hrefs).not.toContain("/production-cycles");
  });
  it("offers account pages the role may open", () => {
    expect(
      visibleAccountLinks({ role: "FARM_STAFF", enterpriseUser: true }).map(
        (l) => l.href,
      ),
    ).toEqual(["/account/password", "/account/privacy"]);
    expect(
      visibleAccountLinks({ role: "SYSTEM_ADMIN", enterpriseUser: false }).map(
        (l) => l.href,
      ),
    ).toContain("/admin/security");
  });
  it("names the closest navigation entry for breadcrumbs", () => {
    expect(routeContext("/admin/enterprises/amendments/abc")?.item.label).toBe(
      "Điều chỉnh hồ sơ",
    );
    expect(routeContext("/admin/products/abc")?.item.label).toBe(
      "Sản phẩm doanh nghiệp",
    );
    expect(routeContext("/enterprise/members/new")?.group.title).toBe(
      "Quản trị",
    );
  });
});
