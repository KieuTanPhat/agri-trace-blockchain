import { describe, expect, it } from "vitest";
import { commandRequest } from "./command-request";

const id = "c51e4dbe-8279-4943-b68d-8433e3231192";
const other = "d79f9be3-748b-48f9-9a3f-5bf2bf7e954b";
describe("command status controller payload contract", () => {
  it.each([
    [
      `/production-cycles/${id}/sensor-reconciliations`,
      "RECONCILE_CYCLE_SENSOR",
      { id },
    ],
    [`/production-cycles/${id}/harvests`, "RECORD_HARVEST", { cycleId: id }],
    [
      `/supply-chains/${id}/business-profile/activate`,
      "HYB_ACTIVATE_BUSINESS_PROFILE",
      { chainId: id },
    ],
    [`/iot/cycles/${id}/digests`, "CREATE_SENSOR_DIGEST", { cycleId: id }],
    [
      `/iot/shipments/${id}/devices/${other}/unbind`,
      "UNBIND_SHIPMENT_DEVICE",
      { shipmentId: id, deviceId: other },
    ],
    [
      `/iot/shipments/${id}/telemetry-digests`,
      "CREATE_SHIPMENT_TELEMETRY_DIGEST",
      { shipmentId: id },
    ],
    [
      `/supply-chains/${id}/shipment-plans/${other}/accept`,
      "SCOPE_ACCEPT_SHIPMENT_PLAN",
      { chainId: id, planId: other },
    ],
  ])("normalizes %s for the status inspector", (path, operation, ids) => {
    expect(
      commandRequest(String(path), "POST", JSON.stringify({ version: 1 })),
    ).toEqual({
      operation,
      payload: { version: 1, ...(ids as object) },
      discriminator: "",
    });
  });
  it("keeps consent party identities separate and excludes secret/auth/device-ingest endpoints", () => {
    const path = `/supply-chains/${id}/shipment-plans/${other}/accept`;
    expect(
      commandRequest(path, "POST", '{"party":"TRANSPORTER"}')?.discriminator,
    ).toBe("TRANSPORTER");
    expect(
      commandRequest(path, "POST", '{"party":"RETAILER"}')?.discriminator,
    ).toBe("RETAILER");
    for (const path of [
      "/auth/login",
      "/users",
      "/iot/devices",
      "/iot/device-readings",
      "/command-requests/status",
    ])
      expect(commandRequest(path, "POST", "{}")).toBeNull();
    expect(
      commandRequest(`/production-cycles/${id}/PLANT`, "POST", "{}"),
    ).toBeNull();
  });
});
