"use client";
import Link from "next/link";
import { useState } from "react";
import { useRemote, queryString } from "@/lib/workspace-api";
import {
  DateFilters,
  isoDate,
  Pager,
  RemoteState,
} from "@/components/workspace-controls";
type Reading = {
  id: string;
  deviceId: string;
  sensorType: string;
  value: string;
  unit: string;
  recordedAt: string;
  device: { name: string; deviceCode: string };
  cycle: { cycleCode: string };
  alert: string;
  threshold: { min: number; max: number } | null;
};
type Cycle = { id: string; cycleCode: string };
export default function SensorHistoryPage() {
  const [from, setFrom] = useState(""),
    [to, setTo] = useState(""),
    [deviceId, setDevice] = useState(""),
    [cycleId, setCycle] = useState(""),
    [harvestId, setHarvest] = useState(""),
    [filter, setFilter] = useState(""),
    [page, setPage] = useState(1),
    [revision, setRevision] = useState(0);
  const devices = useRemote<{ id: string; name: string; deviceCode: string }[]>(
    "/iot/history/options",
    revision,
  );
  const cycles = useRemote<Cycle[]>("/production-cycles", revision);
  const cycle = useRemote<{
    devices?: { id: string; name: string }[];
    harvestEvents: { id: string; harvestTime: string }[];
  }>(cycleId ? "/production-cycles/" + cycleId : null, revision);
  const { data, error, loading } = useRemote<{
    items: Reading[];
    total: number;
    thresholdMessage: string;
  }>("/iot/history?" + filter + "&page=" + page, revision);
  const groups = [
    ...new Set(
      data?.items.map((r) => r.deviceId + "|" + r.sensorType + "|" + r.unit) ??
        [],
    ),
  ];
  return (
    <div className="workspace-page">
      <header className="page-header">
        <div>
          <h1>Lịch sử cảm biến</h1>
          <p>
            Dữ liệu được lấy từ backend. Biểu đồ hiển thị tối đa 100 bản ghi
            trên trang hiện tại.
          </p>
          <Link href="/iot-simulator">Mở trình giả lập cảm biến</Link>
        </div>
      </header>
      <form
        className="panel workspace-toolbar"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setFilter(
            queryString({
              from: isoDate(from),
              to: isoDate(to),
              deviceId,
              cycleId,
              harvestId,
            }),
          );
          setRevision((v) => v + 1);
        }}
      >
        <DateFilters {...{ from, to, setFrom, setTo }} />
        <label>
          Vụ trồng
          <select
            value={cycleId}
            onChange={(e) => {
              setCycle(e.target.value);
              setHarvest("");
            }}
          >
            <option value="">Tất cả</option>
            {cycles.data?.map((c) => (
              <option key={c.id} value={c.id}>
                {c.cycleCode}
              </option>
            ))}
          </select>
        </label>
        <label>
          Lần thu hoạch
          <select
            value={harvestId}
            disabled={!cycleId || cycle.loading}
            onChange={(e) => setHarvest(e.target.value)}
          >
            <option value="">Tất cả</option>
            {cycleId &&
              cycle.data?.harvestEvents.map((h) => (
                <option key={h.id} value={h.id}>
                  {new Date(h.harvestTime).toLocaleString("vi-VN")}
                </option>
              ))}
          </select>
        </label>
        <label>
          Thiết bị
          <select value={deviceId} onChange={(e) => setDevice(e.target.value)}>
            <option value="">Tất cả thiết bị có dữ liệu</option>
            {devices.data?.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} · {d.deviceCode}
              </option>
            ))}
          </select>
        </label>
        <button className="button" disabled={loading}>
          Áp dụng bộ lọc
        </button>
      </form>
      <p className="muted">
        Chọn lần thu hoạch để xem dữ liệu của vụ trồng đến thời điểm thu hoạch
        đó. Nhấn mã thiết bị trong bảng để lọc.
      </p>
      <RemoteState
        loading={cycles.loading}
        error={
          devices.error || cycles.error || (cycleId ? cycle.error : undefined)
        }
        retry={() => setRevision((v) => v + 1)}
      />
      <RemoteState
        loading={loading}
        error={error}
        empty={data?.items.length === 0}
        retry={() => setRevision((v) => v + 1)}
      />
      {data && (
        <>
          <p className="notice">{data.thresholdMessage}</p>
          <div className="grid two">
            {groups.map((group) => {
              const readings = data.items
                .filter(
                  (r) =>
                    r.deviceId + "|" + r.sensorType + "|" + r.unit === group,
                )
                .sort((a, b) => a.recordedAt.localeCompare(b.recordedAt));
              const values = readings.map((r) => Number(r.value));
              const min = Math.min(...values),
                max = Math.max(...values);
              const times = readings.map((r) =>
                new Date(r.recordedAt).getTime(),
              );
              const start = Math.min(...times),
                end = Math.max(...times);
              return (
                <section className="panel" key={group}>
                  <h2>
                    {readings[0].device.name} · {readings[0].sensorType} (
                    {readings[0].unit})
                  </h2>
                  <p>
                    Thấp nhất {min} · Cao nhất {max}
                  </p>
                  <svg
                    className="sensor-chart"
                    viewBox="0 0 600 200"
                    role="img"
                    aria-label={`Biểu đồ ${group}, từ ${min} đến ${max}`}
                  >
                    <line
                      x1="25"
                      y1="175"
                      x2="575"
                      y2="175"
                      stroke="currentColor"
                    />
                    <polyline
                      fill="none"
                      stroke="#15803d"
                      strokeWidth="3"
                      points={readings
                        .map(
                          (r, i) =>
                            `${25 + (550 * (times[i] - start)) / (end - start || 1)},${170 - (145 * (Number(r.value) - min)) / (max - min || 1)}`,
                        )
                        .join(" ")}
                    />
                    {readings.map((r, i) => (
                      <circle
                        key={r.id}
                        cx={
                          25 + (550 * (times[i] - start)) / (end - start || 1)
                        }
                        cy={
                          170 -
                          (145 * (Number(r.value) - min)) / (max - min || 1)
                        }
                        r="4"
                        fill="#15803d"
                      >
                        <title>
                          {r.device.name}: {r.value} {r.unit} ·{" "}
                          {new Date(r.recordedAt).toLocaleString("vi-VN")}
                        </title>
                      </circle>
                    ))}
                  </svg>
                  <div className="workspace-toolbar">
                    <small>{new Date(start).toLocaleString("vi-VN")}</small>
                    <small>{new Date(end).toLocaleString("vi-VN")}</small>
                  </div>
                </section>
              );
            })}
          </div>
          <section className="panel">
            <div className="table-scroll">
              <table>
                <thead>
                  <tr>
                    <th>Thời gian</th>
                    <th>Thiết bị</th>
                    <th>Vụ trồng</th>
                    <th>Cảm biến</th>
                    <th>Giá trị</th>
                    <th>Ngưỡng / Cảnh báo</th>
                  </tr>
                </thead>
                <tbody>
                  {data.items.map((r) => (
                    <tr key={r.id}>
                      <td>{new Date(r.recordedAt).toLocaleString("vi-VN")}</td>
                      <td>
                        <button
                          className="button secondary"
                          onClick={() => {
                            setDevice(r.deviceId);
                            setFilter(
                              queryString({
                                from: isoDate(from),
                                to: isoDate(to),
                                deviceId: r.deviceId,
                                cycleId,
                                harvestId,
                              }),
                            );
                            setPage(1);
                          }}
                        >
                          {r.device.name} · {r.device.deviceCode}
                        </button>
                      </td>
                      <td>{r.cycle.cycleCode}</td>
                      <td>{r.sensorType}</td>
                      <td>
                        {Number(r.value).toLocaleString("vi-VN")} {r.unit}
                      </td>
                      <td>
                        {r.threshold
                          ? `${r.threshold.min}–${r.threshold.max} ${r.unit}`
                          : "Chưa cấu hình"}
                        <br />
                        <strong
                          className={
                            ["HIGH", "LOW"].includes(r.alert)
                              ? "sensor-alert"
                              : ""
                          }
                        >
                          {
                            (
                              {
                                HIGH: "Vượt ngưỡng cao",
                                LOW: "Dưới ngưỡng thấp",
                                NORMAL: "Trong ngưỡng",
                                NOT_CONFIGURED: "Chưa đánh giá",
                              } as Record<string, string>
                            )[r.alert]
                          }
                        </strong>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <Pager
              page={page}
              total={data.total}
              size={100}
              onChange={setPage}
            />
          </section>
        </>
      )}
    </div>
  );
}
