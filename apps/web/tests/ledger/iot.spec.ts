import type { Page } from "@playwright/test";
import { test, expect } from "./fixtures";
import "./fixtures/enterprise-membership";

const id = "55555555-5555-4555-8555-555555555555";
const vehicleId = "66666666-6666-4666-8666-666666666666";
const movingDevice = {
  id, deviceCode: "SIM-GPS-TEST", name: "GPS trên xe đang chở", type: "GPS_TRACKER",
  status: "ACTIVE", simulated: true, authorityRevision: 1, online: true,
  lastSeenAt: "2026-11-04T06:00:00Z", createdAt: "2026-11-04T05:00:00Z",
  plotId: null, plot: null, publicKey: null, runningCycles: [], vehicleId,
  vehicle: { id: vehicleId, registration: "51C-TEST", kind: "Xe tải" },
  activeTransfer: { id: "trip-test", origin: "Lâm Đồng", destination: "Hồ Chí Minh" },
};
async function devices(page: Page) {
  await page.route("**/api/iot/v2/**", async (route) => {
    const path = new URL(route.request().url()).pathname;
    const data = path.endsWith("/device-options")
      ? { plots: [], vehicles: [{ ...movingDevice.vehicle, inTransit: true, trackerId: id, trackerName: movingDevice.name }] }
      : path.endsWith(`/devices/${id}`)
        ? { ...movingDevice, keyFingerprint: null, recordsLast24h: 3, recent: [], latestPosition: { recordedAt: "2026-11-04T06:00:00Z", latitude: 10.8, longitude: 106.7, speedKmh: 32, heading: 90, battery: 95 } }
        : { items: [movingDevice] };
    await route.fulfill({ json: { success: true, data, timestamp: "2026-11-04T06:00:00Z", requestId: "isolated-iot-ui" } });
  });
}

test("the old simulator address opens device management without the legacy ingest form", async ({ page, api }) => {
  await api.useActor("org-owner");
  await api.scenario("membership.baseline");
  await devices(page);
  await page.goto("/iot-simulator");
  await expect(page).toHaveURL(/\/enterprise\/devices$/);
  await expect(page.getByText("51C-TEST", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gửi bản ghi", exact: true })).toHaveCount(0);
  expect(api.requests().some((request) => request.path === "/iot/readings")).toBe(false);
});

test("a moving vehicle shows its assignment and readings while GPS rebinding is disabled", async ({ page, api }) => {
  await api.useActor("org-owner");
  await api.scenario("membership.baseline");
  await devices(page);
  await page.goto("/enterprise/devices");
  await expect(page.getByText("51C-TEST", { exact: true })).toBeVisible();
  await expect(page.getByText("Lâm Đồng → Hồ Chí Minh", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Gắn", exact: true })).toBeDisabled();
  await page.getByRole("button", { name: "Chi tiết", exact: true }).click();
  const detail = page.getByTestId("device-detail");
  await expect(detail).toBeVisible();
  await expect(detail.getByText("Mô phỏng", { exact: true })).toBeVisible();
});
