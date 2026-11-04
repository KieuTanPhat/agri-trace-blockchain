"use client";

import dynamic from "next/dynamic";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { iotApi, type RouteWarning } from "@/lib/ledger/iot-api";
import { fmtAgo, fmtDateTime, fmtSeconds, shortHash } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { Callout, ErrorState, LoadingRows } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

const RouteMap = dynamic(() => import("./route-map").then((m) => m.RouteMap), { ssr: false, loading: () => <LoadingRows rows={4} /> });

const SOURCE_LABEL: Record<string, string> = { DEVICE: "GPS trên xe", SIMULATED: "Dữ liệu mô phỏng", NONE: "Không có dữ liệu định vị" };
function warningText(w: RouteWarning) {
  if (w.code === "SIGNAL_GAP") return tr("Mất tín hiệu {p0} ({p1} → {p2})", { p0: fmtSeconds(w.seconds), p1: fmtDateTime(w.from), p2: fmtDateTime(w.to) });
  if (w.code === "LONG_STOP") return tr("Dừng lâu {p0} ngoài điểm nhận ({p1})", { p0: fmtSeconds(w.seconds), p1: fmtDateTime(w.from) });
  return tr("{p0} điểm GPS bất thường không tính vào hành trình", { p0: w.seconds ?? 0 });
}

/** ADR-006 route of the vehicle carrying the transfer; positions only, no temperature. */
export function TransferRouteSection({ transferId, status }: { transferId: string; status: string }) {
  const live = status === "IN_TRANSIT";
  const q = useQuery({
    queryKey: ["dist-route", transferId],
    queryFn: () => iotApi.transferRoute(transferId),
    refetchInterval: live ? 15_000 : false,
  });
  if (q.error) return <ErrorState compact error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  if (!r) return <LoadingRows rows={3} />;
  if (r.window.inTransitAt && !r.trackable && !r.points.length)
    return (
      <section className="flex flex-col gap-2">
        <h3 className="text-[13px] font-semibold">{tr("Hành trình")}</h3>
        <Callout>{r.transportMode === "EXTERNAL_CARRIER" ? tr("Xe thuê ngoài: không có định vị tự động, chỉ có thời điểm lấy và giao hàng.") : tr("Phiếu chưa chọn xe đã khai nên không có định vị tự động.")}</Callout>
      </section>
    );
  const shown = r.seal?.source ?? r.source;
  const plannedText = r.planned
    ? tr("{p0} → {p1}: khoảng {p2} km, {p3}", {
        p0: r.origin?.name ?? "—",
        p1: r.destination?.name ?? "—",
        p2: Math.round(r.planned.distanceM / 1000),
        p3: fmtSeconds(r.planned.durationS),
      })
    : null;
  const byProvince = r.origin?.source === "PROVINCE" || r.destination?.source === "PROVINCE";
  if (!r.window.inTransitAt)
    return (
      <section className="flex flex-col gap-2" data-testid="transfer-route">
        <h3 className="text-[13px] font-semibold">{tr("Hành trình dự kiến")}</h3>
        {plannedText ? <p className="text-[13px]">{plannedText}</p> : <Callout>{tr("Cơ sở giao/nhận chưa có tọa độ hoặc tỉnh/thành nên chưa ước tính được quãng đường.")}</Callout>}
        {byProvince && <p className="text-[12px] text-ink-2">{tr("Ước tính theo điểm đại diện tỉnh/thành của cơ sở (đường chim bay × 1,3); thêm tọa độ cơ sở để chính xác hơn.")}</p>}
        <p className="text-[12px] text-ink-2">
          {r.tracker
            ? tr("Xe {p0} có GPS {p1}: tự ghi vị trí từ lúc ký lấy hàng đến lúc ký nhận.", { p0: r.vehicle?.registration ?? "", p1: r.tracker.deviceCode })
            : r.trackable
              ? tr("Xe {p0} chưa gắn GPS nên chuyến này sẽ không có định vị tự động.", { p0: r.vehicle?.registration ?? "" })
              : r.transportMode === "EXTERNAL_CARRIER"
                ? tr("Xe thuê ngoài: không có định vị tự động.")
                : tr("Phiếu chưa chọn xe đã khai nên không có định vị tự động.")}
        </p>
      </section>
    );
  return (
    <section className="flex flex-col gap-3" data-testid="transfer-route">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">{tr("Hành trình")}</h3>
        <Badge tone={shown === "SIMULATED" ? "warn" : shown === "DEVICE" ? "ok" : "neutral"}>{tr(SOURCE_LABEL[shown] ?? shown)}</Badge>
        {live && r.lastPosition && <Badge tone="info">{tr("Cập nhật {p0}", { p0: fmtAgo(r.lastPosition.recordedAt) })}</Badge>}
        {r.arrived && live && <Badge tone="ok">{tr("Xe đã đến gần điểm nhận")}</Badge>}
      </div>
      <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-[12.5px] sm:grid-cols-4">
        <div><dt className="text-ink-2">{tr("Xe")}</dt><dd className="font-mono">{r.vehicle?.registration ?? "—"}</dd></div>
        <div><dt className="text-ink-2">{tr("Thiết bị")}</dt><dd className="font-mono">{r.tracker?.deviceCode ?? tr("Chưa gắn GPS")}</dd></div>
        <div><dt className="text-ink-2">{tr("Quãng đường")}</dt><dd>{r.summary ? `${(r.summary.distanceM / 1000).toFixed(1)} km` : "—"}{r.planned ? <span className="text-ink-2"> / ~{Math.round(r.planned.distanceM / 1000)} km {tr("dự kiến")}</span> : null}</dd></div>
        <div><dt className="text-ink-2">{tr("Độ phủ tín hiệu")}</dt><dd>{r.summary ? `${Math.round(r.summary.coveragePercent)}%` : "—"}</dd></div>
        <div><dt className="text-ink-2">{tr("Bắt đầu")}</dt><dd>{fmtDateTime(r.window.inTransitAt)}</dd></div>
        <div><dt className="text-ink-2">{tr("Kết thúc")}</dt><dd>{fmtDateTime(r.window.deliveredAt)}</dd></div>
        <div><dt className="text-ink-2">{tr("Số điểm")}</dt><dd>{r.summary?.pointCount ?? 0}</dd></div>
        <div><dt className="text-ink-2">{tr("Tốc độ gần nhất")}</dt><dd>{r.lastPosition?.speedKmh != null ? `${Math.round(r.lastPosition.speedKmh)} km/h` : "—"}</dd></div>
      </dl>
      {!r.tracker && r.trackable && !r.points.length && <Callout>{tr("Xe chưa gắn GPS đang hoạt động. Gắn thiết bị ở mục Thiết bị IoT.")}</Callout>}
      {r.window.inTransitAt ? (
        <RouteMap points={r.points} origin={r.origin} destination={r.destination} live={live} />
      ) : (
        <Callout>{tr("Vị trí chỉ được ghi sau khi đủ chữ ký lấy hàng.")}</Callout>
      )}
      {(r.origin?.latitude == null || r.destination?.latitude == null) && r.window.inTransitAt && (
        <p className="text-[12px] text-ink-2">{tr("Cơ sở giao hoặc nhận chưa có tọa độ nên bản đồ không đánh dấu điểm đó và không tính được \"đã đến\".")}</p>
      )}
      {r.warnings.length > 0 && (
        <ul className="flex flex-col gap-1 text-[12.5px]">
          {r.warnings.map((w, i) => (
            <li key={i}><Badge tone={w.code === "LONG_STOP" ? "warn" : w.code === "ANOMALY_POINTS" ? "danger" : "neutral"}>{warningText(w)}</Badge></li>
          ))}
        </ul>
      )}
      {r.seal && (
        <p className="text-[12px] text-ink-2">
          {tr("Đã niêm phong lúc {p0} · băm {p1}. Điểm đến sau thời điểm này được đánh dấu muộn và không làm đổi băm.", { p0: fmtDateTime(r.seal.createdAt), p1: shortHash(r.seal.digestHash, 10) })}
        </p>
      )}
    </section>
  );
}
