import { expect, it } from "vitest";
import { labelForEvent } from "./display-labels";

it.each([
  "PRODUCTION_CYCLE_CREATED",
  "CYCLE_PLANTED",
  "CYCLE_COMPLETED",
  "CYCLE_CANCELLED",
  "CARE_RECORDED",
  "SENSOR_READING_RECORDED",
  "SENSOR_DIGEST_CREATED",
  "SENSOR_DIGEST_FINALIZED",
  "HARVEST_RECORDED",
  "SHIPMENT_CREATED",
  "SHIPMENT_STARTED",
  "SHIPMENT_ARRIVED",
  "SHIPMENT_RECEIVED",
  "SHIPMENT_REJECTED",
  "SHIPMENT_DAMAGE_RECORDED",
  "SHIPMENT_TELEMETRY_DIGEST_CREATED",
  "SHIPMENT_TELEMETRY_DIGEST_FINALIZED",
  "TRACKING_DEVICE_BOUND",
  "TRACKING_DEVICE_UNBOUND",
  "INSPECTION_RECORDED",
  "CERTIFICATE_SUBMITTED",
  "CERTIFICATE_APPROVED",
  "CERTIFICATE_REJECTED",
])(
  "translates the current API event %s instead of rendering its code",
  (event) => {
    expect(labelForEvent(event)).not.toBe(event);
    expect(labelForEvent(event)).not.toContain("_");
  },
);
