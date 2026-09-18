import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { LotPicker } from "@/components/lot-picker";
import { IconPackage, IconClock, IconShield, IconLink } from "@/components/icons";
import { QrCodeCard } from "@/components/qr-code-card";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { getLotById, getLots } from "@/lib/api-client";
import { labelForProof } from "@/lib/display-labels";

export default async function LotDetailPage({ params }: { params: Promise<{ lotId: string }> }) {
  const { lotId } = await params;
  const lots = await getLots();
  const lot = await getLotById(lotId);
  const traceUrl = `${process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace"}/${lot.lotId}`;

  return (
    <>
      <section className="page-header">
        <div className="page-header-icon">
          <IconPackage size={22} />
        </div>
        <div>
          <p className="eyebrow">Chi tiết lô</p>
          <h1>{lot.productName}</h1>
          <p className="muted">{lot.lotCode} — {lot.farmOrg.name}</p>
        </div>
        <div className="header-actions">
          <StateBadge state={lot.currentState} />
          <LotPicker lots={lots} currentLotId={lot.lotId} basePath="lots" />
        </div>
      </section>

      <section className="grid two">
        <div className="grid">
          <div className="panel">
            <div className="panel-title">
              <div className="panel-title-left">
                <span className="panel-icon info"><IconPackage size={16} /></span>
                <h2>Thông tin lô</h2>
              </div>
            </div>
            <div className="info-grid">
              <div className="info-item">
                <span className="info-label">Mã định danh lô</span>
                <span className="info-value">{lot.lotId}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Trang trại/HTX</span>
                <span className="info-value">{lot.farmOrg.name}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Điểm bán đích</span>
                <span className="info-value">{lot.retailerOrg?.name ?? "Chưa gán"}</span>
              </div>
              <div className="info-item">
                <span className="info-label">Bằng chứng</span>
                <span className="info-value">{labelForProof(lot.proofStatus)}</span>
              </div>
            </div>
            <Link className="button secondary" href={`/trace/${lot.lotId}`}>
              <IconLink size={14} /> Xem trang tra cứu công khai
            </Link>
          </div>

          <div className="panel">
            <div className="panel-title">
              <div className="panel-title-left">
                <span className="panel-icon warning"><IconClock size={16} /></span>
                <h2>Dòng thời gian</h2>
              </div>
            </div>
            <div className="timeline">
              {lot.timeline.map((event) => (
                <TimelineItem event={event} key={event.eventId} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid">
          <ActionPanel allowedCommands={lot.allowedCommands} lotId={lot.lotId} />
          <div className="panel">
            <div className="panel-title">
              <div className="panel-title-left">
                <span className="panel-icon success"><IconShield size={16} /></span>
                <h2>Mã QR truy xuất</h2>
              </div>
            </div>
            <QrCodeCard value={traceUrl} />
            <p className="muted" style={{ marginTop: 8 }}>{traceUrl}</p>
          </div>
        </div>
      </section>
    </>
  );
}
