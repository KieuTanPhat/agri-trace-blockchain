import { ErrorState } from "@/components/error-state";
import { BatchPicker } from "@/components/batch-picker";
import { IconClock, IconShield, IconDatabase } from "@/components/icons";
import { QrCodeCard } from "@/components/qr-code-card";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { getBatches, getPublicTrace } from "@/lib/api-client";
import { labelForProof } from "@/lib/display-labels";
import { formatTraceDate } from "@/lib/format-date";

export default async function PublicTracePage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const batches = await getBatches();
  const trace = await getPublicTrace(batchId);

  if (!trace) {
    return <ErrorState status={404} title="Không tìm thấy lô" message="Mã QR hoặc mã lô không tồn tại trong dữ liệu mô phỏng." />;
  }

  return (
    <>
      <section className="page-header">
        <div className="page-header-icon">
          <IconShield size={28} />
        </div>
        <div>
          <p className="eyebrow">Tra cứu công khai</p>
          <h1>{trace.productName}</h1>
          <p className="muted">Mã lô {trace.batchCode} — {trace.farmOrg.name}</p>
        </div>
        <div className="header-actions">
          <StateBadge state={trace.currentState} />
          <BatchPicker batches={batches} currentBatchId={trace.batchId} basePath="trace" />
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-title">
            <div className="panel-title-left">
              <span className="panel-icon warning"><IconClock size={18} /></span>
              <h2>Lịch sử truy xuất</h2>
            </div>
            <StateBadge state={trace.proofStatus} />
          </div>
          <div className="timeline">
            {trace.timeline.map((event) => (
              <TimelineItem event={event} key={event.eventId} />
            ))}
          </div>
        </div>

        <div className="panel">
          <div className="panel-title">
            <div className="panel-title-left">
              <span className="panel-icon success"><IconDatabase size={18} /></span>
              <h2>Bằng chứng chuỗi khối</h2>
            </div>
          </div>
          <QrCodeCard value={`${process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace"}/${trace.batchId}`} />
          <div className="info-grid" style={{ marginTop: 16 }}>
            <div className="info-item">
              <span className="info-label">Trạng thái</span>
              <span className="info-value">{labelForProof(trace.proofStatus)}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Mạng ghi nhận</span>
              <span className="info-value">{trace.blockchainProof.network}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Mã giao dịch</span>
              <span className="info-value" style={{ wordBreak: "break-all" }}>{trace.blockchainProof.txId}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Hàm băm dữ liệu</span>
              <span className="info-value" style={{ wordBreak: "break-all" }}>{trace.blockchainProof.dataHash}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Thời điểm ghi nhận</span>
              <time className="info-value" dateTime={trace.blockchainProof.recordedAt}>{formatTraceDate(trace.blockchainProof.recordedAt)}</time>
            </div>
          </div>
        </div>
      </section>
    </>
  );
}
