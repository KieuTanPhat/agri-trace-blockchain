import { ErrorState } from "@/components/error-state";
import { BatchPicker } from "@/components/batch-picker";
import { QrCodeCard } from "@/components/qr-code-card";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { getBatches, getPublicTrace } from "@/lib/api-client";
import { labelForProof } from "@/lib/display-labels";

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
        <div>
          <p className="eyebrow">Tra cứu công khai</p>
          <h1>{trace.productName}</h1>
          <p className="muted">Mã lô `{trace.batchCode}` - {trace.farmOrg.name}</p>
        </div>
        <div className="header-actions">
          <StateBadge state={trace.currentState} />
          <BatchPicker batches={batches} currentBatchId={trace.batchId} basePath="trace" />
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-title">
            <h2>Lịch sử truy xuất</h2>
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
          <h2>Bằng chứng chuỗi khối</h2>
        </div>
          <QrCodeCard value={`${process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace"}/${trace.batchId}`} />
          <p><strong>Trạng thái:</strong> {labelForProof(trace.proofStatus)}</p>
          <p><strong>Mạng ghi nhận:</strong> {trace.blockchainProof.network}</p>
          <p><strong>Mã giao dịch:</strong> {trace.blockchainProof.txId}</p>
          <p><strong>Hàm băm dữ liệu:</strong> {trace.blockchainProof.dataHash}</p>
          <p><strong>Thời điểm ghi nhận:</strong> {trace.blockchainProof.recordedAt}</p>
      </div>
      </section>
    </>
  );
}
