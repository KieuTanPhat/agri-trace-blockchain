"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { IconActivity, IconThermometer, IconDroplet } from "./icons";
import { readStoredIotReadings, type StoredIotReading } from "@/lib/iot-local-store";

const statMeta: Record<string, { icon: React.ReactNode }> = {
  "Bản ghi IoT đã gửi": { icon: <IconActivity size={20} /> },
  "Độ ẩm gần nhất": { icon: <IconDroplet size={20} /> },
  "Nhiệt độ gần nhất": { icon: <IconThermometer size={20} /> },
};

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
      { label: "Độ ẩm gần nhất", value: latest ? `${latest.humidity}%` : "Chưa có" },
      { label: "Nhiệt độ gần nhất", value: latest ? `${latest.temperature}°C` : "Chưa có" }
    ],
    [latest, readings.length]
  );

  return (
    <section className="panel iot-panel">
      <div className="panel-title">
        <div className="panel-title-left">
          <span className="panel-icon info"><IconActivity size={18} /></span>
          <div>
            <p className="eyebrow">IOT GIẢ LẬP</p>
            <h2>Điều kiện môi trường</h2>
            <p className="muted" style={{marginTop: 4, fontSize: 13}}>Theo dõi dữ liệu cảm biến trong thời gian thực từ các lô nông sản của trang trại.</p>
          </div>
        </div>
        <Link href="/iot-simulator" className="button secondary">Xem cảm biến →</Link>
      </div>
      <div className="stats-row" style={{ marginBottom: 16 }}>
        {stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-icon">
              {statMeta[stat.label]?.icon ?? <IconActivity size={20} />}
            </div>
            <div className="stat-body">
              <span className="stat-value" style={{ fontSize: 20 }}>{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
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
                  {reading.temperature}°C — {reading.humidity}% — {reading.timestampUtc}
                </p>
              </div>
              <span className="badge success">Đã tiếp nhận</span>
            </div>
          ))}
        </div>
      ) : (
        <div className="notice">
          Chưa có bản ghi cảm biến.
        </div>
      )}
    </section>
  );
}
