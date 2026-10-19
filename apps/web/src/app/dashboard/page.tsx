"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { ErrorState } from "@/components/error-state";
import { LoadingState } from "@/components/loading-state";
import { TimelineItem } from "@/components/timeline-item";
import { getDashboard } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { canWriteFarm } from "@/lib/permissions";
import type { Dashboard } from "@/lib/types";


export default function DashboardPage() {
  const { user } = useAuth();
  const canSimulate = canWriteFarm(user?.role.code);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    getDashboard()
      .then(setDashboard)
      .catch((cause) =>
        setError(cause?.message ?? "Không tải được tổng quan."),
      );
  }, []);
  useEffect(load, [load]);
  if (error)
    return (
      <ErrorState
        status={503}
        title="Không tải được tổng quan"
        message={error}
      />
    );
  if (!dashboard) return <LoadingState />;
  const lot = dashboard.featuredLot;

  return (
    <div className="dashboard">
      <div className="dashboard-heading">
        <div>
          <h1>Tổng quan</h1>
        </div>
        <Link href="/lots" className="button secondary">
          Danh sách lô
        </Link>
      </div>

      <section className="stats-row" aria-label="Số liệu chính">
        {dashboard.stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-body">
              <span className="stat-value">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="panel">
        <div className="panel-title">
          <div className="panel-title-left">
            <div>
              <h2>Dòng thời gian gần nhất</h2>
              <p className="muted">
                Các hoạt động mới nhất của lô nông sản này trên hệ thống.
              </p>
            </div>
          </div>
          <Link href="/lots" className="button secondary">
            Xem tất cả
          </Link>
        </div>
        <div className="timeline">
          {lot?.timeline.slice(0, 4).map((event) => (
            <TimelineItem event={event} key={event.eventId} />
          ))}
        </div>
      </section>

      <section className="quick-links" aria-label="Lối tắt">
        <Link className="quick-link-card" href="/lots">
          <span className="quick-link-text">
            <strong>Lô nông sản</strong>
            <span>Quản lý tất cả các lô</span>
          </span>
        </Link>
        <Link className="quick-link-card" href="/scan">
          <span className="quick-link-text">
            <strong>Quét QR</strong>
            <span>Tra cứu nhanh nông sản</span>
          </span>
        </Link>
        {canSimulate && (
          <Link className="quick-link-card" href="/iot-simulator">
            <span className="quick-link-text">
              <strong>IoT giả lập</strong>
              <span>Mô phỏng cảm biến</span>
            </span>
          </Link>
        )}
        <Link
          className="quick-link-card"
          href={lot?.traceToken ? `/trace/${lot.traceToken}` : "/scan"}
        >
          <span className="quick-link-text">
            <strong>Tra cứu công khai</strong>
            <span>Xem lịch sử truy xuất</span>
          </span>
        </Link>
      </section>
    </div>
  );
}
