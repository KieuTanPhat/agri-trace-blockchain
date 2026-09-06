import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { IconBarChart, IconClock, IconLeaf, IconPackage, IconShield, IconSprout, IconStore, IconTruck, IconZap } from "@/components/icons";
import { IotOverviewPanel } from "@/components/iot-overview-panel";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { getDashboard } from "@/lib/api-client";

const statIcons: Record<string, React.ReactNode> = {
  "Lô đang theo dõi": <IconPackage size={20} />,
  "Bằng chứng đang chờ": <IconShield size={20} />,
  "Chuyến vận chuyển mở": <IconTruck size={20} />,
  "Sự kiện ghi nhận": <IconClock size={18} />,
  "Tổng lô": <IconPackage size={18} />,
  "Bằng chứng xác minh": <IconShield size={18} />,
};

function getStatIcon(label: string) {
  return statIcons[label] ?? <IconBarChart size={18} />;
}

export default async function DashboardPage() {
  const dashboard = await getDashboard();
  const batch = dashboard.featuredBatch;

  return (
    <div className="dashboard">
      <div className="dashboard-heading">
        <div><p className="workspace-kicker">KHÔNG GIAN QUẢN LÝ</p><h1>Tổng quan</h1></div>
        <Link href="/batches" className="overview-link">Danh sách lô <span aria-hidden="true">↗</span></Link>
      </div>
      <section className="hero-banner">
        <div className="hero-deco" aria-hidden="true">
          <IconSprout size={100} className="hero-icon" />
        </div>
        <div className="hero-content">
          <p className="eyebrow">Hệ thống truy xuất nông sản</p>
          <h2>Mỗi nông sản,<br />một hành trình <span>minh bạch.</span></h2>
          <p className="hero-desc">
            Từ trang trại đến điểm bán, minh bạch từng hành trình.
          </p>
          <div className="hero-actions">
            <Link className="button" href="/batches"><IconPackage size={18} /> Quản lý lô nông sản <span aria-hidden="true">↗</span></Link>
            <Link className="hero-text-link" href="/scan">Quét mã truy xuất <span aria-hidden="true">→</span></Link>
          </div>
          <div className="hero-journey" aria-label="Các chặng trong chuỗi cung ứng">
            <span><IconSprout size={16} />Trang trại</span><i aria-hidden="true" /><span><IconTruck size={16} />Vận chuyển</span><i aria-hidden="true" /><span><IconStore size={16} />Điểm bán</span>
          </div>
        </div>
        <div className="hero-badge">
          <IconLeaf size={16} /> Từ nông trại đến bàn ăn
        </div>
      </section>

      <section className="stats-row">
        {dashboard.stats.map((stat) => (
          <div className="stat-card" key={stat.label}>
            <div className="stat-icon">
              {getStatIcon(stat.label)}
            </div>
            <div className="stat-body">
              <span className="stat-value">{stat.value}</span>
              <span className="stat-label">{stat.label}</span>
            </div>
          </div>
        ))}
      </section>

      <section className="grid two dashboard-feature-row">
        <div className="grid">
          <div className="panel featured-panel">
            <div className="produce-visual"><img className="produce-photo" src="/farm-greens.png" alt="Ảnh minh họa rau xanh tại vườn" /><span className="produce-label"><IconLeaf size={14} /> Nông sản từ trang trại</span></div>
            <div className="featured-details">
            <div className="featured-caption"><span>Lô nông sản nổi bật</span><StateBadge state={batch.currentState} /></div>
            <div className="panel-title">
              <div className="panel-title-left">
                <span className="panel-icon accent"><IconLeaf size={16} /></span>
                <h2>{batch.productName}</h2>
              </div>
              <Link className="button secondary" href={`/batches/${batch.batchId}`}>
                Chi tiết →
              </Link>
            </div>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Mã lô</span>
                <span className="info-value">{batch.batchCode}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Trang trại</span>
                <span className="info-value">{batch.farmOrg.name}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Điểm bán đích</span>
                <span className="info-value">{batch.retailerOrg?.name ?? "Chưa gán"}</span>
              </div>
            </div>
            </div>
          </div>
        </div>
        <ActionPanel allowedCommands={batch.allowedCommands} batchId={batch.batchId} />
      </section>
      <IotOverviewPanel />

          <div className="panel">
            <div className="panel-title">
              <div className="panel-title-left">
                <span className="panel-icon warning"><IconClock size={16} /></span>
                <div>
                  <h2>Dòng thời gian gần nhất</h2>
                  <p className="muted" style={{marginTop: 2, fontSize: 13}}>Các hoạt động mới nhất của lô nông sản này trên hệ thống.</p>
                </div>
              </div>
              <Link href="/batches" className="button secondary">Xem tất cả →</Link>
            </div>
            <div className="timeline">
              {batch.timeline.slice(0, 4).map((event) => (
                <TimelineItem event={event} key={event.eventId} />
              ))}
            </div>
          </div>

      <section className="quick-links">
        <Link className="quick-link-card" href="/batches">
          <span className="quick-link-icon"><IconPackage size={18} /></span>
          <span className="quick-link-text">
            <strong>Lô nông sản</strong>
            <span>Quản lý tất cả các lô</span>
          </span>
        </Link>
        <Link className="quick-link-card" href="/scan">
          <span className="quick-link-icon accent"><IconStore size={18} /></span>
          <span className="quick-link-text">
            <strong>Quét QR</strong>
            <span>Tra cứu nhanh nông sản</span>
          </span>
        </Link>
        <Link className="quick-link-card" href="/iot-simulator">
          <span className="quick-link-icon success"><IconZap size={18} /></span>
          <span className="quick-link-text">
            <strong>IoT giả lập</strong>
            <span>Mô phỏng cảm biến</span>
          </span>
        </Link>
        <Link className="quick-link-card" href="/trace/batch-rau-001">
          <span className="quick-link-icon info"><IconTruck size={18} /></span>
          <span className="quick-link-text">
            <strong>Tra cứu công khai</strong>
            <span>Xem lịch sử truy xuất</span>
          </span>
        </Link>
      </section>
    </div>
  );
}
