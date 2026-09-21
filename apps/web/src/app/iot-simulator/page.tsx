"use client";

import { useEffect, useMemo, useState } from "react";
import {
  IconThermometer,
  IconDroplet,
  IconWifi,
  IconActivity,
} from "@/components/icons";
import { ErrorState } from "@/components/error-state";
import { getProductionCycles, sendSensorReading } from "@/lib/api-client";
import { saveStoredIotReading } from "@/lib/iot-local-store";
import type { ProductionCycleOption, SensorReadingResponse } from "@/lib/types";
import { ShieldCheck, Code2, Copy, Check } from "lucide-react";

const statusLabels: Record<string, string> = {
  idle: "Sẵn sàng",
  sending: "Đang gửi",
  retrying: "Đang gửi lại",
  accepted: "Đã tiếp nhận",
  rejected: "Bị từ chối",
};

export default function IotSimulatorPage() {
  const [deviceId, setDeviceId] = useState("");
  const [cycleId, setCycleId] = useState("");
  const [cycles, setCycles] = useState<ProductionCycleOption[]>([]);
  const [sensorType, setSensorType] = useState("TEMPERATURE");
  const [value, setValue] = useState(27.5);
  const [unit, setUnit] = useState("°C");
  const [recordedAt, setRecordedAt] = useState("");
  const [response, setResponse] = useState<SensorReadingResponse | null>(null);
  const [status, setStatus] = useState("idle");
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    setRecordedAt(new Date().toISOString());
    getProductionCycles()
      .then((items) => {
        const active = items.filter((item) =>
          ["PLANTED", "GROWING"].includes(item.currentState),
        );
        setCycles(active);
        setCycleId(active[0]?.id ?? "");
      })
      .catch(() => setCycles([]));
  }, []);

  const payload = useMemo(
    () => ({ deviceId, cycleId, sensorType, value, unit, recordedAt }),
    [cycleId, deviceId, recordedAt, sensorType, unit, value],
  );

  async function submitReading(retry = false) {
    setStatus(retry ? "retrying" : "sending");
    try {
      const result = await sendSensorReading(payload);
      setResponse(result);
      setStatus(result.status);
      if (result.status === "accepted" && result.readingId) {
        saveStoredIotReading({
          ...payload,
          readingId: result.readingId,
          acceptedAt: new Date().toISOString(),
          status: "accepted",
        });
      }
    } catch (cause) {
      const error = cause as {
        status?: number;
        code?: string;
        message?: string;
      };
      setResponse({
        status: "rejected",
        error: {
          status: (error.status ?? 503) as 403 | 409 | 422 | 503,
          code: error.code ?? "IOT_INGEST_FAILED",
          message: error.message ?? "Không gửi được dữ liệu cảm biến.",
        },
      });
      setStatus("rejected");
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
          <p className="muted">
            Mô phỏng một bản ghi cảm biến chuẩn hóa gắn với ProductionCycle.
          </p>
        </div>
        <div className="header-features">
          <span className="header-feature">
            <IconThermometer size={14} /> Giám sát môi trường
          </span>
          <span className="header-feature">
            <IconActivity size={14} /> Dữ liệu thời gian thực
          </span>
          <span className="header-feature">
            <IconWifi size={14} /> Kết nối minh bạch
          </span>
        </div>
      </section>

      <section className="grid two">
        <div className="panel form-grid">
          <div className="panel-title">
            <div className="panel-title-left">
              <span className="panel-icon info">
                <IconActivity size={16} />
              </span>
              <div>
                <h2>Cấu hình cảm biến</h2>
                <p className="muted" style={{ marginTop: 2, fontSize: 12 }}>
                  Thiết lập thiết bị, vụ trồng và dữ liệu cảm biến cần gửi.
                </p>
              </div>
            </div>
          </div>
          <div className="field">
            <label htmlFor="device">
              <IconWifi size={12} /> Thiết bị
            </label>
            <input
              className="input"
              id="device"
              placeholder="Nhập UUID hoặc mã thiết bị đã đăng ký"
              required
              value={deviceId}
              onChange={(e) => setDeviceId(e.target.value)}
            />
          </div>
          <div className="field">
            <label htmlFor="cycle">Vụ trồng</label>
            <select
              className="select"
              id="cycle"
              value={cycleId}
              onChange={(e) => setCycleId(e.target.value)}
            >
              <option value="">Chọn chu kỳ đang hoạt động</option>
              {cycles.map((cycle) => (
                <option key={cycle.id} value={cycle.id}>
                  {cycle.cycleCode} — {cycle.product.productName}
                </option>
              ))}
            </select>
          </div>
          <div className="form-row">
            <div className="field">
              <label htmlFor="sensor-type">
                <IconThermometer size={12} /> Loại cảm biến
              </label>
              <select
                className="select"
                id="sensor-type"
                value={sensorType}
                onChange={(e) => {
                  setSensorType(e.target.value);
                  setUnit(e.target.value === "HUMIDITY" ? "%" : "°C");
                }}
              >
                <option value="TEMPERATURE">Nhiệt độ</option>
                <option value="HUMIDITY">Độ ẩm</option>
                <option value="SOIL_MOISTURE">Độ ẩm đất</option>
              </select>
            </div>
            <div className="field">
              <label htmlFor="sensor-value">
                <IconDroplet size={12} /> Giá trị và đơn vị
              </label>
              <input
                className="input"
                id="sensor-value"
                type="number"
                value={value}
                onChange={(e) => setValue(Number(e.target.value))}
              />
              <input
                className="input"
                aria-label="Đơn vị"
                value={unit}
                onChange={(e) => setUnit(e.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label htmlFor="recorded-at">Thời điểm ghi nhận UTC</label>
            <input
              className="input"
              id="recorded-at"
              value={recordedAt}
              onChange={(e) => setRecordedAt(e.target.value)}
            />
            <p className="field-hint">Định dạng ISO 8601 (UTC)</p>
          </div>
          <div className="form-row">
            <button
              className="button"
              onClick={() => submitReading(false)}
              disabled={
                !deviceId ||
                !cycleId ||
                status === "sending" ||
                status === "retrying"
              }
            >
              <IconActivity size={14} /> Gửi dữ liệu
            </button>
            <button
              className="button secondary"
              onClick={() => submitReading(true)}
              disabled={
                !response || status === "sending" || status === "retrying"
              }
            >
              Gửi lại
            </button>
          </div>
        </div>

        <div className="grid">
          <ErrorState
            status={response?.error?.status ?? 200}
            title={`Tình trạng: ${statusLabels[status] ?? status}`}
            message={
              response?.error?.message ??
              "Gói dữ liệu sẵn sàng gửi đến điểm nhận mô phỏng."
            }
          />
          <div className="system-health">
            <span className="health-dot" />
            <span className="health-text">
              Hệ thống hoạt động bình thường
              <br />
              <small>Sẵn sàng nhận dữ liệu</small>
            </span>
          </div>
          <div className="json-panel">
            <div className="json-heading">
              <span>
                <Code2 size={22} />
                Dữ liệu yêu cầu (JSON)
              </span>
              <button
                onClick={async () => {
                  try {
                    await navigator.clipboard.writeText(
                      JSON.stringify({ request: payload, response }, null, 2),
                    );
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2000);
                  } catch {
                    setCopied(false);
                  }
                }}
              >
                <span>
                  {copied ? <Check size={17} /> : <Copy size={17} />}
                  {copied ? "Đã sao chép" : "Sao chép"}
                </span>
              </button>
            </div>
            <pre className="contract-preview">
              {JSON.stringify({ request: payload, response }, null, 2)}
            </pre>
          </div>
          <div className="design-note">
            <ShieldCheck size={40} />
            <div>
              <strong>Dữ liệu sẽ được gửi an toàn</strong>
              <p>
                Mô phỏng giao thức gửi dữ liệu IoT tới điểm nhận chuẩn và có thể
                được ghi nhận trên blockchain.
              </p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
