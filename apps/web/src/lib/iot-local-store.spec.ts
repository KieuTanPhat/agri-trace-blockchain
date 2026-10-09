import { beforeEach, expect, it, vi } from "vitest";

beforeEach(() => {
  vi.resetModules();
  localStorage.clear();
});

it("isolates simulated sensor readings by account and organization", async () => {
  const { setSession } = await import("./api-client");
  const { readStoredIotReadings, saveStoredIotReading } = await import("./iot-local-store");
  const user = {
    id: "first",
    email: "first@example.com",
    fullName: "First",
    organizationId: "farm-1",
    role: { code: "FARM_STAFF" as const, name: "Farm staff" },
    accountStatus: "ACTIVE",
  };
  setSession({ accessToken: "first", tokenType: "Bearer", user });
  saveStoredIotReading({
    readingId: "reading-1",
    acceptedAt: "2026-10-09T00:00:00.000Z",
    status: "accepted",
    deviceId: "device-1",
    cycleId: "cycle-1",
    sensorType: "TEMPERATURE",
    value: 25,
    unit: "C",
    recordedAt: "2026-10-09T00:00:00.000Z",
  });
  expect(readStoredIotReadings()).toHaveLength(1);
  setSession({ accessToken: "second", tokenType: "Bearer", user: { ...user, id: "second" } });
  expect(readStoredIotReadings()).toEqual([]);
});
