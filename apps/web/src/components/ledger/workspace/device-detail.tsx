"use client";

import Link from "next/link";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { iotApi, type FieldRecord, type GpsRecord } from "@/lib/ledger/iot-api";
import { fmtAgo, fmtDateTime } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { Callout, ErrorState, LoadingRows } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

const SENSOR_LABEL: Record<string, string> = { TEMPERATURE: "Nhiệt độ", HUMIDITY: "Độ ẩm không khí", SOIL_MOISTURE: "Độ ẩm đất" };
const VALIDITY: Record<string, { label: string; tone: "ok" | "danger" | "neutral" }> = {
  VALID: { label: "Hợp lệ", tone: "ok" },
  ANOMALY: { label: "Bất thường", tone: "danger" },
  LATE: { label: "Đến muộn", tone: "neutral" },
};

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-3 border-b border-line py-1.5 text-[12.5px] last:border-0">
      <dt className="text-ink-2">{label}</dt>
      <dd className="text-right">{children}</dd>
    </div>
  );
}

/** ADR-006: what one device is reporting right now. Refreshes every 10 seconds. */
export function DeviceDetail({ id }: { id: string }) {
  const q = useQuery({ queryKey: ["iot-device", id], queryFn: () => iotApi.device(id), refetchInterval: 10_000 });
  if (q.error) return <ErrorState compact error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  if (!d) return <LoadingRows rows={6} />;
  const field = d.type === "FIELD_SENSOR";
  const recent = (d.recent ?? []) as (FieldRecord | GpsRecord)[];
  return (
    <div className="flex flex-col gap-5 px-4 pb-6" data-testid="device-detail">
      <div className="flex flex-wrap gap-1">
        <Badge tone={d.online ? "ok" : "neutral"}>{d.online ? tr("Đang gửi") : tr("Mất kết nối")}</Badge>
        <Badge tone={d.status === "ACTIVE" ? "ok" : "neutral"}>{d.status === "ACTIVE" ? tr("Hoạt động") : tr("Ngừng")}</Badge>
      </div>

      {field ? (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">{tr("Chỉ số hiện tại")}</h3>
          {d.latest?.length ? (
            <div className="grid grid-cols-3 gap-2">
              {d.latest.map((r) => (
                <div key={r.sensorType} className="rounded-md border border-line bg-card p-2">
                  <p className="text-[11.5px] text-ink-2">{tr(SENSOR_LABEL[r.sensorType] ?? r.sensorType)}</p>
                  <p className="font-mono text-[18px]">{r.value.toFixed(1)}<span className="ml-1 text-[12px] text-ink-2">{r.unit}</span></p>
                  <p className="text-[11px] text-ink-2">{fmtAgo(r.recordedAt)}</p>
                </div>
              ))}
            </div>
          ) : (
            <Callout>{d.runningCycles.length ? tr("Chưa có bản ghi nào được nhận.") : tr("Thửa chưa có vụ đang trồng nên dữ liệu gửi lên bị bỏ qua. Gắn thiết bị vào thửa có vụ đang chạy.")}</Callout>
          )}
        </section>
      ) : (
        <section className="flex flex-col gap-2">
          <h3 className="text-[13px] font-semibold">{tr("Vị trí gần nhất")}</h3>
          {d.latestPosition ? (
            <dl>
              <Row label={tr("Tọa độ")}><span className="font-mono">{d.latestPosition.latitude.toFixed(5)}, {d.latestPosition.longitude.toFixed(5)}</span></Row>
              <Row label={tr("Tốc độ / hướng")}>{d.latestPosition.speedKmh != null ? `${Math.round(d.latestPosition.speedKmh)} km/h` : "—"}{d.latestPosition.heading != null ? ` · ${Math.round(d.latestPosition.heading)}°` : ""}</Row>
              <Row label={tr("Sai số / vệ tinh")}>{d.latestPosition.accuracyM != null ? `±${d.latestPosition.accuracyM} m` : "—"}{d.latestPosition.satellites != null ? ` · ${d.latestPosition.satellites}` : ""}</Row>
              <Row label={tr("Pin")}>{d.latestPosition.battery != null ? `${Math.round(d.latestPosition.battery)}%` : "—"}</Row>
              <Row label={tr("Thời điểm đo")}>{fmtDateTime(d.latestPosition.recordedAt)}</Row>
            </dl>
          ) : (
            <Callout>{tr("Vị trí chỉ được lưu khi xe đang chở một phiếu giao nhận (từ lúc ký lấy hàng đến lúc ký nhận).")}</Callout>
          )}
        </section>
      )}

      <section className="flex flex-col gap-1">
        <h3 className="text-[13px] font-semibold">{tr("Thông số thiết bị")}</h3>
        <dl>
          <Row label={tr("Mã thiết bị")}><span className="font-mono">{d.deviceCode}</span></Row>
          <Row label={tr("Gắn vào")}>{d.plot ? `${d.plot.farm.name} · ${d.plot.name}` : d.vehicle ? d.vehicle.registration : tr("Chưa gắn")}</Row>
          {field ? (
            <Row label={tr("Vụ đang nhận dữ liệu")}>{d.runningCycles.length ? d.runningCycles.map((c, i) => <span key={c.id}>{i ? ", " : ""}<Link className="text-brand underline-offset-2 hover:underline" href={`/production-cycles/${c.id}`}>{c.cycleCode}</Link></span>) : tr("Không có")}</Row>
          ) : (
            <Row label={tr("Phiếu đang chở")}>{d.activeTransfer ? <Link className="text-brand underline-offset-2 hover:underline" href={`/distribution/${d.activeTransfer.id}`}>{d.activeTransfer.origin} → {d.activeTransfer.destination}</Link> : tr("Không có")}</Row>
          )}
          <Row label={tr("Lần gửi gần nhất")}>{d.lastSeenAt ? `${fmtAgo(d.lastSeenAt)} (${fmtDateTime(d.lastSeenAt)})` : tr("Chưa gửi")}</Row>
          <Row label={tr("Bản ghi 24 giờ qua")}>{d.recordsLast24h}</Row>
          <Row label={tr("Phiên bản ủy quyền")}>v{d.authorityRevision}</Row>
          <Row label={tr("Mã nhận diện khóa")}><span className="font-mono">{d.keyFingerprint ?? "—"}</span></Row>
          <Row label={tr("Đăng ký lúc")}>{fmtDateTime(d.createdAt)}</Row>
        </dl>
      </section>

      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold">{tr("Bản ghi gần đây")}</h3>
        {!recent.length ? (
          <p className="text-[12px] text-ink-2">{tr("Chưa có bản ghi")}</p>
        ) : (
          <div className="max-h-[320px] overflow-auto rounded-md border border-line">
            <table className="w-full text-[12px]">
              <thead className="sticky top-0 bg-sunken text-left text-ink-2">
                <tr>
                  <th className="px-2 py-1">#</th>
                  <th className="px-2 py-1">{tr("Thời điểm đo")}</th>
                  <th className="px-2 py-1">{field ? tr("Chỉ số") : tr("Vị trí / tốc độ")}</th>
                  {!field && <th className="px-2 py-1">{tr("Trạng thái")}</th>}
                </tr>
              </thead>
              <tbody>
                {recent.map((r, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-2 py-1 font-mono text-ink-2">{r.sequence ?? "—"}</td>
                    <td className="px-2 py-1">{fmtDateTime(r.recordedAt)}</td>
                    {field ? (
                      <td className="px-2 py-1">{tr(SENSOR_LABEL[(r as FieldRecord).sensorType] ?? (r as FieldRecord).sensorType)}: <span className="font-mono">{(r as FieldRecord).value}</span> {(r as FieldRecord).unit}</td>
                    ) : (
                      <>
                        <td className="px-2 py-1 font-mono">{(r as GpsRecord).latitude.toFixed(5)}, {(r as GpsRecord).longitude.toFixed(5)}{(r as GpsRecord).speedKmh != null ? ` · ${Math.round((r as GpsRecord).speedKmh!)} km/h` : ""}</td>
                        <td className="px-2 py-1"><Badge tone={VALIDITY[(r as GpsRecord).validity]?.tone ?? "neutral"}>{tr(VALIDITY[(r as GpsRecord).validity]?.label ?? (r as GpsRecord).validity)}{(r as GpsRecord).anomalyCode ? ` · ${(r as GpsRecord).anomalyCode}` : ""}</Badge></td>
                      </>
                    )}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
