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
    <div className="design-page trace-page">
      <section className="page-header">
        <img className="trace-product-photo" src="/farm-greens.png" alt="Ảnh minh họa nông sản tại trang trại" />
        <div>
          <p className="eyebrow">Tra cứu công khai</p>
          <h1>{trace.productName}</h1>
          <p className="muted"><span>{trace.batchCode}</span> <span className="header-separator">·</span> <span>{trace.farmOrg.name}</span> <span className="header-separator">·</span> <span>Cù Chi, TP. Hồ Chí Minh</span></p>
          <span className="badge info" style={{marginTop: 6}}>Rau ăn lá</span>
          <p className="muted" style={{marginTop: 8, maxWidth: 620}}>Rau cải ngọt được trồng theo quy trình canh tác an toàn, giám sát xuyên suốt bằng công nghệ số, minh bạch từ trang trại đến người tiêu dùng.</p>
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
              <div>
                <h2>Lịch sử truy xuất</h2>
                <p className="muted" style={{marginTop: 2, fontSize: 12}}>Dòng thời gian các hoạt động của sản phẩm trong suốt vòng đời</p>
              </div>
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
              <div>
                <h2>Bằng chứng chuỗi khối</h2>
                <p className="muted" style={{marginTop: 2, fontSize: 12}}>Quét mã QR hoặc kiểm tra thông tin dưới đây để xác thực nguồn gốc</p>
              </div>
            </div>
          </div>
          <div className="proof-overview"><QrCodeCard value={`${process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace"}/${trace.batchId}`} /><div className={`proof-summary proof-${trace.proofStatus}`}><IconShield size={54} /><div><h3>{labelForProof(trace.proofStatus)}</h3><p className="muted">Dữ liệu trên hệ thống trùng khớp với bản ghi trên blockchain.</p></div></div></div>
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
          <div className="design-note" style={{marginTop: 16}}>
            <IconDatabase size={25} />
            <div>
              <strong>Dữ liệu đã được ghi lên mạng blockchain của AgriTrace.</strong>
              <p>Không thể chỉnh sửa hoặc xóa sau khi đã được xác nhận.</p>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
