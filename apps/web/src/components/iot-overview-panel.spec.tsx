import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { IotOverviewPanel } from "./iot-overview-panel";
import { saveStoredIotReading } from "@/lib/iot-local-store";
import { getAuthorizationScope } from "@/lib/auth-scope";

afterEach(() => {
  cleanup();
  localStorage.clear();
});
it("clears local sensor data when the same user changes organization", () => {
  const user = {
    id: "same",
    role: { code: "FARM_STAFF" },
    organizationId: "old",
  };
  const oldScope = getAuthorizationScope(user);
  saveStoredIotReading(
    {
      readingId: "reading",
      deviceId: "device",
      cycleId: "PRIVATE-OLD-CYCLE",
      sensorType: "TEMPERATURE",
      value: 27,
      unit: "°C",
      recordedAt: "2026-10-09T00:00:00Z",
      acceptedAt: "2026-10-09T00:00:01Z",
      status: "accepted",
    },
    oldScope,
  );
  const view = render(
    <IotOverviewPanel authorizationScope={oldScope} canOpenSimulator={true} />,
  );
  expect(screen.getByText("PRIVATE-OLD-CYCLE")).toBeInTheDocument();
  view.rerender(
    <IotOverviewPanel
      authorizationScope={getAuthorizationScope({
        ...user,
        organizationId: "new",
      })}
      canOpenSimulator={false}
    />,
  );
  expect(screen.queryByText("PRIVATE-OLD-CYCLE")).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Xem cảm biến →" }),
  ).not.toBeInTheDocument();
});
