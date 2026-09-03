"use client";

import { useEffect, useMemo, useState } from "react";
import { readStoredIotReadings, type StoredIotReading } from "@/lib/iot-local-store";

export function IotOverviewPanel() {
  const [readings, setReadings] = useState<StoredIotReading[]>([]);

  useEffect(() => {
    function refresh() {
      setReadings(readStoredIotReadings());
    }

    refresh();
    window.addEventListener("storage", refresh);
    window.addEventListener("iot-readings-updated", refresh);
    return () => {
      window.removeEventListener("storage", refresh);
      window.removeEventListener("iot-readings-updated", refresh);
    };
  }, []);

  const latest = readings[0];
  const stats = useMemo(
    () => [
      { label: "Bản ghi IoT đã gửi", value: String(readings.length) },
      { label: "Lô gửi gần nhất", value: latest?.batchId ?? "Chưa có" },
      { label: "Nhiệt độ gần nhất", value: latest ? `${latest.temperature}°C` : "Chưa có" }
    ],
    [latest, readings.length]
  );

  return (
    <section className="panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Cập nhật từ IoT giả lập</p>
          <h2>Tín hiệu mới trong phiên duyệt</h2>
        </div>
      </div>
      <div className="grid three">
        {stats.map((stat) => (
          <div className="card compact-card" key={stat.label}>
            <p className="muted">{stat.label}</p>
            <h2>{stat.value}</h2>
          </div>
        ))}
      </div>
      {readings.length > 0 ? (
        <div className="table-list mini-list">
          {readings.slice(0, 3).map((reading) => (
            <div className="list-row" key={reading.readingId}>
              <div>
                <h3>{reading.batchId}</h3>
                <p className="muted">
                  {reading.temperature}°C - {reading.humidity}% - {reading.timestampUtc}
                </p>
              </div>
              <span className="badge success">Đã tiếp nhận</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="notice">
          <strong>Chưa có dữ liệu mới:</strong> gửi một bản ghi ở màn hình IoT giả lập rồi quay lại Tổng quan để thấy cập nhật.
        </div>
      )}
    </section>
  );
}
