import { afterEach, expect, it, vi } from "vitest";
import { getAuthorizationScope } from "./auth-scope";
import {
  IOT_READING_STORAGE_KEY,
  readStoredIotReadings,
  saveStoredIotReading,
  type StoredIotReading,
} from "./iot-local-store";

const owner = {
  id: "first",
  role: { code: "FARM_STAFF" },
  organizationId: "farm",
};
const scope = getAuthorizationScope(owner);
const reading: StoredIotReading = {
  readingId: "reading",
  deviceId: "device",
  cycleId: "old-cycle",
  sensorType: "TEMPERATURE",
  value: 27,
  unit: "°C",
  recordedAt: "2026-10-09T00:00:00Z",
  acceptedAt: "2026-10-09T00:00:01Z",
  status: "accepted",
};
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
});

it("keeps an accepted server write successful when browser storage is full", () => {
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
    throw new DOMException("Storage full", "QuotaExceededError");
  });
  expect(() => saveStoredIotReading(reading, scope)).not.toThrow();
});

it("isolates readings when account, role or organization changes", () => {
  saveStoredIotReading(reading, scope);
  expect(readStoredIotReadings(scope)).toEqual([reading]);
  for (const user of [
    { ...owner, id: "second" },
    { ...owner, organizationId: "other-farm" },
    { ...owner, role: { code: "SYSTEM_ADMIN" } },
  ])
    expect(readStoredIotReadings(getAuthorizationScope(user))).toEqual([]);
  expect(readStoredIotReadings(scope)).toEqual([reading]);
});
it("does not attribute legacy unowned data to the current user", () => {
  localStorage.setItem(
    "agri-traceability:iot-readings:v2",
    JSON.stringify([reading]),
  );
  expect(readStoredIotReadings(scope)).toEqual([]);
});
it("handles malformed storage and avoids reading or writing without a user", () => {
  localStorage.setItem(`${IOT_READING_STORAGE_KEY}:${scope}`, "invalid");
  expect(readStoredIotReadings(scope)).toEqual([]);
  saveStoredIotReading(reading, "null");
  expect(readStoredIotReadings("null")).toEqual([]);
  expect(localStorage.getItem(`${IOT_READING_STORAGE_KEY}:null`)).toBeNull();
});
it("keeps the latest twenty readings within one scope", () => {
  for (let i = 0; i < 21; i++)
    saveStoredIotReading({ ...reading, readingId: String(i) }, scope);
  expect(readStoredIotReadings(scope)).toHaveLength(20);
  expect(readStoredIotReadings(scope)[0].readingId).toBe("20");
});
