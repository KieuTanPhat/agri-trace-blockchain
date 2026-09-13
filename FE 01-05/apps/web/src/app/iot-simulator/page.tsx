"use client";

import { useEffect, useMemo, useState } from "react";
import { IconThermometer, IconDroplet, IconWifi, IconActivity } from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { sendSensorReading } from "@/lib/api-client";
import { saveStoredIotReading } from "@/lib/iot-local-store";
import type { SensorReadingResponse } from "@/lib/types";
import { ShieldCheck, Code2, Copy, Check } from "lucide-react";

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
  const [timestampUtc, setTimestampUtc] = useState("");
  const [response, setResponse] = useState<SensorReadingResponse | null>(null);
  const [status, setStatus] = useState("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => { setTimestampUtc(new Date().toISOString()); }, []);

  const payload = useMemo(() => ({ deviceId, batchId, temperature, humidity, timestampUtc }), [
    batchId, deviceId, humidity, temperature, timestampUtc
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
    <div className="design-page simulator-page">
      <section className="page-header">
        <div className="page-header-icon">
          <IconWifi size={22} />
        </div>
        <div>
          <p className="eyebrow">IOT-01</p>
          <h1>Bộ giả lập cảm biến IoT</h1>
          <p className="muted">Mô phỏng gói dữ liệu thiết bị gửi nhiệt độ, độ ẩm và thời điểm UTC.</p>
        </div>
        <div className="header-features">
          <span className="header-feature"><IconThermometer size={14} /> Giám sát môi trường</span>
          <span className="header-feature"><IconActivity size={14} /> Dữ liệu thời gian thực</span>
          <span className="header-feature"><IconWifi size={14} /> Kết nối minh bạch</span>
        </div>
      </section>

      <section className="grid two">
        <div className="panel form-grid">
          <div className="panel-title">
          <div className="panel-title-left">
              <span className="panel-icon info"><IconActivity size={16} /></span>
              <div>
                <h2>Cấu hình cảm biến</h2>
                <p className="muted" style={{marginTop: 2, fontSize: 12}}>Thiết lập thiết bị, lô nông sản và dữ liệu cảm biến cần gửi.</p>
              </div>
            </div>
          </div>
          <div className="field">
            <label htmlFor="device"><IconWifi size={12} /> Thiết bị</label>
            <select className="select" id="device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)}>
              <option value="device-cu-chi-01">device-cu-chi-01</option>
              <option value="device-nha-be-02">device-nha-be-02</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="batch">Lô nông sản</label>
            <select className="select" id="batch" value={batchId} onChange={(e) => setBatchId(e.target.value)}>
              <option value="batch-rau-001">batch-rau-001</option>
              <option value="batch-xoai-002">batch-xoai-002</option>
            </select>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="temperature"><IconThermometer size={12} /> Nhiệt độ °C</label>
              <input className="input" id="temperature" type="number" value={temperature} onChange={(e) => setTemperature(Number(e.target.value))} />
              <p className="field-hint">Ví dụ: -10 đến 50</p>
            </div>
            <div className="field">
              <label htmlFor="humidity"><IconDroplet size={12} /> Độ ẩm %</label>
              <input className="input" id="humidity" type="number" value={humidity} onChange={(e) => setHumidity(Number(e.target.value))} />
              <p className="field-hint">Ví dụ: 0 đến 100</p>
            </div>
          </div>
          <div className="field">
            <label htmlFor="timestamp">Thời điểm UTC</label>
            <input className="input" id="timestamp" value={timestampUtc} onChange={(e) => setTimestampUtc(e.target.value)} />
            <p className="field-hint">Định dạng ISO 8601 (UTC)</p>
          </div>
          <div className="form-row">
            <button className="button" onClick={() => submitReading(false)} disabled={status === "sending" || status === "retrying"}>
              <IconActivity size={14} /> Gửi dữ liệu
            </button>
            <button className="button secondary" onClick={() => submitReading(true)} disabled={!response || status === "sending" || status === "retrying"}>
              Gửi lại
            </button>
          </div>
        </div>

        <div className="grid">
          <ErrorState
            status={response?.error?.status ?? 200}
            title={`Tình trạng: ${statusLabels[status] ?? status}`}
            message={response?.error?.message ?? "Gói dữ liệu sẵn sàng gửi đến điểm nhận mô phỏng."}
          />
          <div className="system-health">
            <span className="health-dot" />
            <span className="health-text">Hệ thống hoạt động bình thường<br/><small>Sẵn sàng nhận dữ liệu</small></span>
          </div>
          <div className="json-panel"><div className="json-heading"><span><Code2 size={22} />Dữ liệu yêu cầu (JSON)</span><button onClick={async () => { try { await navigator.clipboard.writeText(JSON.stringify({ request: payload, response }, null, 2)); setCopied(true); setTimeout(() => setCopied(false), 2000); } catch { setCopied(false); } }}><span>{copied ? <Check size={17} /> : <Copy size={17} />}{copied ? "Đã sao chép" : "Sao chép"}</span></button></div><pre className="contract-preview">{JSON.stringify({ request: payload, response }, null, 2)}</pre></div>
          <div className="design-note"><ShieldCheck size={40} /><div><strong>Dữ liệu sẽ được gửi an toàn</strong><p>Mô phỏng giao thức gửi dữ liệu IoT tới điểm nhận chuẩn và có thể được ghi nhận trên blockchain.</p></div></div>
        </div>
      </section>
    </div>
  );
}
