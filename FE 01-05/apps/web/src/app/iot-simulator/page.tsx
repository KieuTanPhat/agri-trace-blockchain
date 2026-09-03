"use client";

import { useMemo, useState } from "react";
import { ErrorState } from "@/components/error-state";
import { sendSensorReading } from "@/lib/api-client";
import { saveStoredIotReading } from "@/lib/iot-local-store";
import type { SensorReadingResponse } from "@/lib/types";

const statusLabels: Record<string, string> = {
  idle: "Sẵn sàng",
  sending: "Đang gửi",
  retrying: "Đang gửi lại",
  accepted: "Đã tiếp nhận",
  rejected: "Bị từ chối"
};

export default function IotSimulatorPage() {
  const [deviceId, setDeviceId] = useState("device-cu-chi-01");
  const [batchId, setBatchId] = useState("batch-rau-001");
  const [temperature, setTemperature] = useState(27.5);
  const [humidity, setHumidity] = useState(68);
  const [timestampUtc, setTimestampUtc] = useState(new Date().toISOString());
  const [response, setResponse] = useState<SensorReadingResponse | null>(null);
  const [status, setStatus] = useState("idle");

  const payload = useMemo(() => ({ deviceId, batchId, temperature, humidity, timestampUtc }), [
    batchId,
    deviceId,
    humidity,
    temperature,
    timestampUtc
  ]);

  async function submitReading(retry = false) {
    setStatus(retry ? "retrying" : "sending");
    const result = await sendSensorReading(payload);
    setResponse(result);
    setStatus(result.status);
    if (result.status === "accepted" && result.readingId) {
      saveStoredIotReading({
        ...payload,
        readingId: result.readingId,
        acceptedAt: new Date().toISOString(),
        status: "accepted"
      });
    }
  }

  return (
    <>
      <section className="page-header">
        <div>
          <p className="eyebrow">IOT-01</p>
          <h1>Bộ giả lập cảm biến IoT</h1>
          <p className="muted">Mô phỏng gói dữ liệu thiết bị gửi nhiệt độ, độ ẩm và thời điểm UTC cho từng lô.</p>
        </div>
      </section>

      <section className="grid two">
        <div className="panel form-grid">
          <div className="field">
            <label htmlFor="device">Thiết bị</label>
            <select className="select" id="device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}>
              <option value="device-cu-chi-01">device-cu-chi-01</option>
              <option value="device-nha-be-02">device-nha-be-02</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="batch">Lô nông sản</label>
            <select className="select" id="batch" value={batchId} onChange={(event) => setBatchId(event.target.value)}>
              <option value="batch-rau-001">batch-rau-001</option>
              <option value="batch-xoai-002">batch-xoai-002</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="temperature">Nhiệt độ °C</label>
            <input className="input" id="temperature" type="number" value={temperature} onChange={(event) => setTemperature(Number(event.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="humidity">Độ ẩm %</label>
            <input className="input" id="humidity" type="number" value={humidity} onChange={(event) => setHumidity(Number(event.target.value))} />
          </div>
          <div className="field">
            <label htmlFor="timestamp">Thời điểm UTC</label>
            <input className="input" id="timestamp" value={timestampUtc} onChange={(event) => setTimestampUtc(event.target.value)} />
          </div>
          <button className="button" onClick={() => submitReading(false)} disabled={status === "sending" || status === "retrying"}>Gửi dữ liệu</button>
          <button className="button secondary" onClick={() => submitReading(true)} disabled={!response || status === "sending" || status === "retrying"}>Gửi lại lần gần nhất</button>
        </div>

        <div className="grid">
          <ErrorState
            status={response?.error?.status ?? 200}
            title={`Tình trạng: ${statusLabels[status] ?? status}`}
            message={response?.error?.message ?? "Gói dữ liệu đã sẵn sàng gửi đến điểm nhận mô phỏng."}
          />
          <pre className="contract-preview">{JSON.stringify({ request: payload, response }, null, 2)}</pre>
        </div>
      </section>
    </>
  );
}
