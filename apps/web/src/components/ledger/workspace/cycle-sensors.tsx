"use client";

import { useState } from "react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { iotApi, type SensorSeries } from "@/lib/ledger/iot-api";
import { fmtAgo, fmtDateTime } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { Callout, ErrorState, LoadingRows } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

const LABEL: Record<string, string> = { TEMPERATURE: "Nhiệt độ", HUMIDITY: "Độ ẩm không khí", SOIL_MOISTURE: "Độ ẩm đất" };
const RANGES = [
  { hours: 24, label: "24 giờ" },
  { hours: 24 * 7, label: "7 ngày" },
  { hours: undefined, label: "Cả vụ" },
] as const;

function Chart({ s }: { s: SensorSeries }) {
  const w = 560, h = 140, pad = 28;
  const pts = s.points;
  if (pts.length < 2) return <p className="text-[12px] text-ink-2">{tr("Chưa đủ dữ liệu để vẽ")}</p>;
  const t0 = new Date(pts[0].t).getTime(), t1 = new Date(pts.at(-1)!.t).getTime();
  const lo = Math.min(...pts.map((p) => p.min)), hi = Math.max(...pts.map((p) => p.max));
  const span = hi - lo || 1;
  const x = (t: string) => pad + ((new Date(t).getTime() - t0) / Math.max(1, t1 - t0)) * (w - pad * 2);
  const y = (v: number) => h - pad + 8 - ((v - lo) / span) * (h - pad * 1.5);
  const band = [...pts.map((p) => `${x(p.t)},${y(p.max)}`), ...[...pts].reverse().map((p) => `${x(p.t)},${y(p.min)}`)].join(" ");
  const line = pts.map((p) => `${x(p.t)},${y(p.avg)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-auto w-full" role="img" aria-label={tr("Biểu đồ {p0}", { p0: tr(LABEL[s.sensorType] ?? s.sensorType) })}>
      <line x1={pad} x2={w - pad} y1={h - pad + 8} y2={h - pad + 8} className="stroke-line" />
      <text x={2} y={y(hi) + 4} className="fill-ink-2 text-[10px]">{hi.toFixed(1)}</text>
      <text x={2} y={y(lo) + 4} className="fill-ink-2 text-[10px]">{lo.toFixed(1)}</text>
      <polygon points={band} className="fill-brand/15" />
      <polyline points={line} fill="none" className="stroke-brand" strokeWidth={2} strokeLinejoin="round" />
      <text x={pad} y={h - 2} className="fill-ink-2 text-[10px]">{fmtDateTime(pts[0].t)}</text>
      <text x={w - pad} y={h - 2} textAnchor="end" className="fill-ink-2 text-[10px]">{fmtDateTime(pts.at(-1)!.t)}</text>
    </svg>
  );
}

/** ADR-006 field sensor readings of a cycle (from devices on its plot). */
export function CycleSensors({ cycleId }: { cycleId: string }) {
  const [hours, setHours] = useState<number | undefined>(24 * 7);
  const q = useQuery({ queryKey: ["cycle-readings", cycleId, hours ?? "all"], queryFn: () => iotApi.cycleReadings(cycleId, hours), refetchInterval: 60_000 });
  if (q.error) return <ErrorState compact error={q.error} onRetry={() => q.refetch()} />;
  const r = q.data;
  if (!r) return <LoadingRows rows={3} />;
  return (
    <section className="flex flex-col gap-3" data-testid="cycle-sensors">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap items-center gap-2">
          <h3 className="text-sm font-semibold">{tr("Cảm biến vùng trồng")}</h3>
          {r.simulated && <Badge tone="warn">{tr("Dữ liệu mô phỏng")}</Badge>}
          {r.lateCount > 0 && <Badge tone="neutral">{tr("{p0} bản ghi đến muộn", { p0: r.lateCount })}</Badge>}
        </div>
        <div role="tablist" className="flex gap-1">
          {RANGES.map((o) => (
            <button key={o.label} type="button" role="tab" aria-selected={hours === o.hours} onClick={() => setHours(o.hours)} className={cn("h-7 rounded-md border px-2 text-[12px]", hours === o.hours ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
              {tr(o.label)}
            </button>
          ))}
        </div>
      </div>
      {r.devices.length === 0 && <Callout>{tr("Thửa của vụ chưa gắn cảm biến. IoT không bắt buộc; gắn thiết bị ở mục Thiết bị IoT nếu cần.")}</Callout>}
      {r.devices.length > 0 && (
        <ul className="flex flex-wrap gap-2 text-[12px]">
          {r.devices.map((d) => (
            <li key={d.id}><Badge tone={d.online ? "ok" : "neutral"}>{d.name} · {d.online ? tr("đang gửi") : d.lastSeenAt ? fmtAgo(d.lastSeenAt) : tr("chưa gửi")}</Badge></li>
          ))}
        </ul>
      )}
      <div className="grid gap-3 lg:grid-cols-3">
        {r.series.map((s) => (
          <div key={s.sensorType} className="flex flex-col gap-1 rounded-md border border-line bg-card p-3">
            <div className="flex items-baseline justify-between gap-2">
              <span className="text-[12.5px] font-medium">{tr(LABEL[s.sensorType] ?? s.sensorType)}</span>
              {s.latest && <span className="font-mono text-[15px]">{s.latest.value.toFixed(1)} {s.unit}</span>}
            </div>
            <Chart s={s} />
          </div>
        ))}
      </div>
      {r.devices.length > 0 && r.series.length === 0 && <p className="text-[12px] text-ink-2">{tr("Chưa có bản ghi trong khoảng thời gian này.")}</p>}
      <p className="text-[11.5px] text-ink-2">{tr("Dữ liệu thô nằm ngoài blockchain. Khi thu hoạch, dữ liệu từ lúc trồng tới mốc thu hoạch được chốt và băm vào sự kiện thu hoạch.")}</p>
    </section>
  );
}
