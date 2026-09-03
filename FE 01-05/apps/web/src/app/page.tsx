import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { IotOverviewPanel } from "@/components/iot-overview-panel";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { getDashboard } from "@/lib/api-client";

export default async function DashboardPage() {
  const dashboard = await getDashboard();
  const batch = dashboard.featuredBatch;

  return (
    <>
      <section className="page-header">
        <div>
          <p className="eyebrow">Bản dựng giao diện</p>
          <h1>Bảng điều phối truy xuất nông sản</h1>
          <p className="muted">
            Giao diện mô phỏng dùng danh sách thao tác được phép từ backend, sẵn sàng nối API thật khi nhóm BE chốt ma trận quyền.
          </p>
        </div>
        <StateBadge state={batch.currentState} />
      </section>

      <section className="grid two">
        <div className="grid">
          <div className="panel">
            <div className="panel-title">
              <h2>{batch.productName}</h2>
              <Link className="button secondary" href={`/batches/${batch.batchId}`}>Chi tiết</Link>
            </div>
            <p className="muted">
              Mã lô `{batch.batchCode}` thuộc {batch.farmOrg.name}. Điểm bán đích: {batch.retailerOrg?.name ?? "chưa gán"}.
            </p>
            <div className="grid three">
              {dashboard.stats.map((stat) => (
                <div className="card" key={stat.label}>
                  <p className="muted">{stat.label}</p>
                  <h2>{stat.value}</h2>
                </div>
              ))}
            </div>
          </div>

          <IotOverviewPanel />

          <div className="panel">
            <div className="panel-title">
              <h2>Dòng thời gian gần nhất</h2>
            </div>
            <div className="timeline">
              {batch.timeline.slice(0, 4).map((event) => (
                <TimelineItem event={event} key={event.eventId} />
              ))}
            </div>
          </div>
        </div>

        <ActionPanel allowedCommands={batch.allowedCommands} batchId={batch.batchId} />
      </section>
    </>
  );
}
