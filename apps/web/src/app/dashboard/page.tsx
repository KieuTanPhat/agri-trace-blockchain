"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import {
  ChartColumn,
  Clock,
  Leaf,
  ListChecks,
  Package,
  ScanLine,
  ShieldCheck,
  QrCode,
  Truck,
  Zap,
} from "lucide-react";
import { ActionPanel } from "@/components/action-panel";
import { ErrorState } from "@/components/error-state";
import { IotOverviewPanel } from "@/components/iot-overview-panel";
import { LoadingState } from "@/components/loading-state";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { getDashboard } from "@/lib/api-client";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { useAuth } from "@/lib/auth-store";
import { canWriteFarm } from "@/lib/permissions";
import type { Dashboard, LotTrace } from "@/lib/types";

const statIcons: Record<string, React.ReactNode> = {
  "Lô đang theo dõi": <Package size={20} />,
  "Bằng chứng đang chờ": <ShieldCheck size={20} />,
  "Chuyến vận chuyển mở": <Truck size={20} />,
  "Sự kiện ghi nhận": <Clock size={20} />,
  "Tổng lô": <Package size={20} />,
  "Bằng chứng xác minh": <ShieldCheck size={20} />,
};

type Todo = { key: string; tone: "danger" | "accent"; title: string; text: string };

/** Work that needs attention on the featured lot, derived from its warnings and permitted commands. */
function todosFor(lot: LotTrace): Todo[] {
  const items: Todo[] = [];
  if (lot.warnings.length)
    items.push({
      key: "warnings",
      tone: "danger",
      title: `Lô ${lot.lotCode} có cảnh báo`,
      text: "Xem chi tiết để đối soát trước khi thao tác tiếp.",
    });
  if (lot.allowedCommands.length)
    items.push({
      key: "commands",
      tone: "accent",
      title: `${lot.allowedCommands.length} thao tác khả dụng trên lô ${lot.lotCode}`,
      text: "Các thao tác theo quyền hiện tại của bạn.",
    });
  return items;
}

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
  const todos = lot ? todosFor(lot) : [];

  return (
    <div className="dashboard">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">Không gian quản lý</p>
          <h1>Tổng quan</h1>
        </div>
        <Link href="/lots" className="button secondary">
          Danh sách lô
        </Link>
      </div>

      <section className="stats-row" aria-label="Số liệu chính">
        {dashboard.stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-icon">
              {statIcons[stat.label] ?? <ChartColumn size={20} />}
            </div>
            <div className="stat-body">
              <span className="stat-value">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="panel" aria-label="Việc cần làm">
        <div className="panel-title">
          <div className="panel-title-left">
            <span className="panel-icon accent">
              <ListChecks size={18} />
            </span>
            <h2>Việc cần làm</h2>
          </div>
        </div>
        {todos.length ? (
          <ul className="todo-list">
            {todos.map((todo) => (
              <li className={`todo-item ${todo.tone === "danger" ? "danger" : ""}`} key={todo.key}>
                <div>
                  <strong>{todo.title}</strong>
                  <span className="muted">{todo.text}</span>
                </div>
                <Link className="button secondary small" href={`/lots/${lot?.lotId}`}>
                  Xem lô
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="muted">Hiện không có việc nào đang chờ bạn.</p>
        )}
      </section>

      {lot ? (
        <section className="grid two">
          <div className="panel">
            <div className="panel-title">
              <div className="panel-title-left">
                <span className="panel-icon success">
                  <Leaf size={18} />
                </span>
                <div>
                  <p className="muted">Lô nông sản nổi bật</p>
                  <h2>{lot.productName}</h2>
                </div>
              </div>
              <StateBadge state={lot.currentState} />
            </div>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Mã lô</span>
                <span className="info-value">{lot.lotCode}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Trang trại</span>
                <span className="info-value">{lot.farmOrg.name}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Điểm bán đích</span>
                <span className="info-value">
                  {lot.retailerOrg?.name ?? "Chưa gán"}
                </span>
              </div>
            </div>
            <div className="actions">
              <Link className="button secondary" href={`/lots/${lot.lotId}`}>
                Chi tiết lô
              </Link>
            </div>
          </div>
          <ActionPanel lot={lot} onCompleted={load} />
        </section>
      ) : (
        <ErrorState
          status={404}
          title="Chưa có lô nông sản"
          message="Hãy ghi nhận một lần thu hoạch để tạo lô đầu tiên."
        />
      )}

      <IotOverviewPanel
        authorizationScope={getAuthorizationScope(user)}
        canOpenSimulator={canSimulate}
      />

      <section className="panel">
        <div className="panel-title">
          <div className="panel-title-left">
            <span className="panel-icon warning">
              <Clock size={18} />
            </span>
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
          <span className="quick-link-icon">
            <Package size={18} />
          </span>
          <span className="quick-link-text">
            <strong>Lô nông sản</strong>
            <span>Quản lý tất cả các lô</span>
          </span>
        </Link>
        <Link className="quick-link-card" href="/scan">
          <span className="quick-link-icon accent">
            <ScanLine size={18} />
          </span>
          <span className="quick-link-text">
            <strong>Quét QR</strong>
            <span>Tra cứu nhanh nông sản</span>
          </span>
        </Link>
        {canSimulate && (
          <Link className="quick-link-card" href="/iot-simulator">
            <span className="quick-link-icon success">
              <Zap size={18} />
            </span>
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
          <span className="quick-link-icon info">
            <QrCode size={18} />
          </span>
          <span className="quick-link-text">
            <strong>Tra cứu công khai</strong>
            <span>Xem lịch sử truy xuất</span>
          </span>
        </Link>
      </section>
    </div>
  );
}
