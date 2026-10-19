"use client";

import type { CSSProperties } from "react";

type ChartItem = { label: string; value: number };
const colors = ["var(--chart-0)", "var(--chart-1)", "var(--chart-2)", "var(--chart-3)"];

/** Compares current counts without suggesting a time trend. */
export function OverviewChart({
  title,
  description,
  items,
}: {
  title: string;
  description: string;
  items: ChartItem[];
}) {
  const maximum = Math.max(1, ...items.map((item) => item.value));
  const total = items.reduce((sum, item) => sum + item.value, 0);
  let cursor = 0;
  const segments = items.map((item, index) => {
    const start = cursor;
    cursor += total ? (item.value / total) * 100 : 0;
    return `${colors[index % colors.length]} ${start}% ${cursor}%`;
  });
  const ringStyle: CSSProperties = {
    background: total ? `conic-gradient(${segments.join(", ")})` : "var(--line)",
  };
  return (
    <div className="dashboard-insights">
      <section className="manage-section overview-chart" aria-labelledby="overview-chart-title">
        <div className="manage-section-heading">
          <div>
            <h2 id="overview-chart-title">{title}</h2>
            <p>{description}</p>
          </div>
        </div>
        <div className="overview-chart-rows">
          {items.map((item, index) => (
            <div className="overview-chart-row" key={item.label}>
              <div className="overview-chart-label">
                <span>{item.label}</span>
                <strong>{item.value.toLocaleString("vi-VN")}</strong>
              </div>
              <div className="overview-chart-track" aria-hidden="true">
                <span className={`overview-chart-bar overview-chart-bar--${index % 4}`} style={{ width: `${item.value ? Math.max(3, item.value / maximum * 100) : 0}%` }} />
              </div>
            </div>
          ))}
        </div>
      </section>
      <aside className="manage-section overview-total" aria-label="Tổng số theo các mục trên biểu đồ">
        <div className="manage-section-heading">
          <div>
            <h2>Phân bổ hiện tại</h2>
            <p>So sánh các mục được hiển thị</p>
          </div>
        </div>
        <div className="overview-total-body">
          <div className="overview-total-ring" style={ringStyle}>
            <span><strong>{total.toLocaleString("vi-VN")}</strong><small>tổng mục</small></span>
          </div>
          <ul className="overview-total-legend">
            {items.map((item, index) => (
              <li key={item.label}>
                <span className={`overview-legend-dot overview-chart-bar--${index % 4}`} />
                <span>{item.label}</span>
                <strong>{item.value.toLocaleString("vi-VN")}</strong>
              </li>
            ))}
          </ul>
        </div>
      </aside>
    </div>
  );
}
