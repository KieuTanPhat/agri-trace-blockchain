"use client";
import type { PublicLotTrace } from "@/lib/types";
import { fmtDateTime } from "@/lib/ledger/format";
import { pt as t } from "@/lib/ledger/public-i18n";

type Sensor = PublicLotTrace["sensorEvidence"];

const LABEL: Record<string, string> = {
  TEMPERATURE: "Nhiệt độ",
  HUMIDITY: "Độ ẩm không khí",
  SOIL_MOISTURE: "Độ ẩm đất",
};
const ORDER = ["TEMPERATURE", "HUMIDITY", "SOIL_MOISTURE"];
const num = (n: number) => n.toLocaleString("vi-VN", { maximumFractionDigits: 1 });

/** A daily-average line for one sensor type. */
function Spark({ points, label }: { points: { day: string; avg: number }[]; label: string }) {
  if (points.length < 2) return null;
  const w = 240, h = 48, pad = 4;
  const lo = Math.min(...points.map((p) => p.avg)), hi = Math.max(...points.map((p) => p.avg));
  const span = hi - lo || 1;
  const x = (i: number) => pad + (i / (points.length - 1)) * (w - pad * 2);
  const y = (v: number) => h - pad - ((v - lo) / span) * (h - pad * 2);
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="h-12 w-full" role="img" aria-label={t("Biểu đồ {p0} theo ngày", { p0: label })}>
      <polyline
        points={points.map((p, i) => `${x(i)},${y(p.avg)}`).join(" ")}
        fill="none"
        className="stroke-brand"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** Growing-period sensor figures shown inside the farm stage of the journey. */
export function SensorPanel({ sensor }: { sensor: Sensor }) {
  if (!sensor || sensor.readingCount <= 0) return null;
  const summary = [...(sensor.summary ?? [])].sort((a, b) => ORDER.indexOf(a.sensorType) - ORDER.indexOf(b.sensorType));
  return (
    <section className="flex flex-col gap-3 rounded-xl border border-line p-4" aria-label={t("Cảm biến vùng trồng")}>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h4 className="text-sm font-semibold">{t("Cảm biến vùng trồng")}</h4>
        <p className="text-xs text-ink-2">
          {fmtDateTime(sensor.periodStart)} → {fmtDateTime(sensor.periodEnd)} · {t("{p0} lần đo", { p0: sensor.readingCount })}
        </p>
      </div>
      {summary.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-3">
          {summary.map((s) => {
            const label = t(LABEL[s.sensorType] ?? s.sensorType);
            return (
              <div key={s.sensorType} className="flex flex-col gap-1 rounded-lg bg-sunken p-3">
                <span className="text-xs text-ink-2">{label}</span>
                <span className="text-lg font-semibold">
                  {num(s.avg)} {s.unit}
                </span>
                <span className="text-xs text-ink-2">
                  {t("thấp nhất {p0} · cao nhất {p1}", { p0: `${num(s.min)} ${s.unit}`, p1: `${num(s.max)} ${s.unit}` })}
                </span>
                <Spark label={label} points={(sensor.daily ?? []).filter((d) => d.sensorType === s.sensorType)} />
              </div>
            );
          })}
        </div>
      )}
      <p className="text-xs text-ink-2">
        {t("Số trung bình trong thời gian trồng; đường kẻ là trung bình từng ngày. Toàn bộ số đo gốc được băm và lưu lên blockchain lúc thu hoạch.")}
        {sensor.simulated ? ` ${t("Dữ liệu từ thiết bị mô phỏng.")}` : ""}
      </p>
    </section>
  );
}
