import Link from "next/link";
import { ActionPanel } from "@/components/action-panel";
import { BatchPicker } from "@/components/batch-picker";
import { QrCodeCard } from "@/components/qr-code-card";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { getBatchById, getBatches } from "@/lib/api-client";
import { labelForProof } from "@/lib/display-labels";

export default async function BatchDetailPage({ params }: { params: Promise<{ batchId: string }> }) {
  const { batchId } = await params;
  const batches = await getBatches();
  const batch = await getBatchById(batchId);
  const traceUrl = `${process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace"}/${batch.batchId}`;

  return (
    <>
      <section className="page-header">
        <div>
          <p className="eyebrow">Chi tiết lô</p>
          <h1>{batch.productName}</h1>
          <p className="muted">{batch.batchCode} - {batch.farmOrg.name}</p>
        </div>
        <div className="header-actions">
          <StateBadge state={batch.currentState} />
          <BatchPicker batches={batches} currentBatchId={batch.batchId} basePath="batches" />
        </div>
      </section>

      <section className="grid two">
        <div className="grid">
          <div className="panel">
            <div className="panel-title">
              <h2>Thông tin lô</h2>
            </div>
            <p><strong>Mã định danh lô:</strong> {batch.batchId}</p>
            <p><strong>Trang trại/HTX:</strong> {batch.farmOrg.name}</p>
            <p><strong>Điểm bán đích:</strong> {batch.retailerOrg?.name ?? "Chưa gán"}</p>
            <p><strong>Bằng chứng:</strong> {labelForProof(batch.proofStatus)}</p>
            <Link className="button secondary" href={`/trace/${batch.batchId}`}>Xem trang tra cứu công khai</Link>
          </div>

          <div className="panel">
            <div className="panel-title">
              <h2>Dòng thời gian</h2>
            </div>
            <div className="timeline">
              {batch.timeline.map((event) => (
                <TimelineItem event={event} key={event.eventId} />
              ))}
            </div>
          </div>
        </div>

        <div className="grid">
          <ActionPanel allowedCommands={batch.allowedCommands} batchId={batch.batchId} />
          <div className="panel">
            <div className="panel-title">
              <h2>Đường dẫn QR</h2>
            </div>
            <QrCodeCard value={traceUrl} />
            <p className="muted">{traceUrl}</p>
          </div>
        </div>
      </section>
    </>
  );
}
