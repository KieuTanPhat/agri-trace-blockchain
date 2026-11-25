import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { SensorPanel } from "./sensor-panel";

describe("SensorPanel", () => {
  it("shows the growing-period averages with lowest and highest and a daily line", () => {
    const { container } = render(
      <SensorPanel
        sensor={{
          status: "FINALIZED",
          readingCount: 219,
          digestHash: "x",
          periodStart: "2026-09-13T04:54:00Z",
          periodEnd: "2026-11-05T04:54:00Z",
          finalizedAt: "2026-11-07T05:35:45Z",
          lateReadingCount: 0,
          simulated: true,
          summary: [
            { sensorType: "SOIL_MOISTURE", unit: "%", min: 30, avg: 36.8, max: 42 },
            { sensorType: "TEMPERATURE", unit: "°C", min: 18, avg: 22.2, max: 27.5 },
          ],
          daily: [
            { sensorType: "TEMPERATURE", day: "2026-09-13", avg: 21 },
            { sensorType: "TEMPERATURE", day: "2026-09-14", avg: 23 },
          ],
        }}
      />,
    );
    expect(screen.getByText("Cảm biến vùng trồng")).toBeTruthy();
    const labels = screen.getAllByText(/Nhiệt độ|Độ ẩm đất/).map((e) => e.textContent);
    expect(labels).toEqual(["Nhiệt độ", "Độ ẩm đất"]);
    expect(screen.getByText(/22,2 °C/)).toBeTruthy();
    expect(screen.getByText(/thấp nhất 18 °C · cao nhất 27,5 °C/)).toBeTruthy();
    expect(container.querySelectorAll("svg polyline")).toHaveLength(1);
    expect(screen.getByText(/thiết bị mô phỏng/)).toBeTruthy();
  });
  it("renders nothing without readings", () => {
    const { container } = render(
      <SensorPanel sensor={{ status: "NO_DATA", readingCount: 0, digestHash: null, periodStart: null, periodEnd: null, finalizedAt: null, lateReadingCount: 0, simulated: false, summary: [], daily: [] }} />,
    );
    expect(container.innerHTML).toBe("");
  });
});
