import { describe, expect, it } from "vitest";
import { canAccessManagementRoute, canWriteFarm } from "./permissions";

describe("Web business permissions", () => {
  it.each(["SYSTEM_ADMIN", "AUDITOR", "TRANSPORTER", "RETAILER"] as const)(
    "keeps %s from farmer writes and the user IoT simulator",
    (role) => {
      expect(canWriteFarm(role)).toBe(false);
      expect(canAccessManagementRoute("/iot-simulator", role)).toBe(false);
      expect(canAccessManagementRoute("/production-cycles", role)).toBe(true);
    },
  );
  it("keeps farmer commands and Admin master-data management", () => {
    expect(canWriteFarm("FARM_STAFF")).toBe(true);
    expect(canWriteFarm()).toBe(false);
    expect(canAccessManagementRoute("/iot-simulator", "FARM_STAFF")).toBe(true);
    expect(canAccessManagementRoute("/admin", "SYSTEM_ADMIN")).toBe(true);
    expect(canAccessManagementRoute("/admin/users", "FARM_STAFF")).toBe(false);
  });
});
