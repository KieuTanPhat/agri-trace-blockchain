import Image from "next/image";
import { ErrorState } from "@/components/error-state";
import { IconClock, IconShield, IconDatabase } from "@/components/icons";
import { QrCodeCard } from "@/components/qr-code-card";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { getPublicTrace } from "@/lib/api-client";
import { labelForProof } from "@/lib/display-labels";
import { formatTraceDate } from "@/lib/format-date";

export default async function PublicTracePage({
  params,
}: {
  params: Promise<{ lotId: string }>;
}) {
  const { lotId } = await params;
  const trace = await getPublicTrace(lotId);
  if (!trace)
    return (
      <ErrorState
        status={404}
        title="Không tìm thấy lô"
        message="Mã QR hoặc mã lô không tồn tại."
      />
    );

  const proof = trace.blockchainProof;
  const traceUrl = `${process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace"}/${trace.traceToken ?? lotId}`;
  return (
    <div className="design-page trace-page">
      <section className="page-header">
        <Image
          className="trace-product-photo"
          src="/farm-greens.png"
          alt="Ảnh minh họa nông sản tại trang trại"
          width={500}
          height={500}
        />
        <div>
          <p className="eyebrow">Tra cứu công khai</p>
          <h1>{trace.productName}</h1>
          <p className="muted">
            {trace.lotCode} · {trace.farmOrg.name} · Vụ{" "}
            {trace.productionCycle.cycleCode}
          </p>
          <p className="muted" style={{ marginTop: 8, maxWidth: 620 }}>
            Lô được tạo từ một lần thu hoạch độc lập; lịch sử canh tác và
            logistics được liên kết nhưng không dùng chung một trạng thái.
          </p>
        </div>
        <div className="header-actions">
          <StateBadge state={trace.currentState} />
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-title">
            <div className="panel-title-left">
              <span className="panel-icon warning">
                <IconClock size={18} />
              </span>
              <div>
                <h2>Lịch sử truy xuất</h2>
                <p className="muted">Các sự kiện công khai theo thời gian</p>
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
              <span className="panel-icon success">
                <IconDatabase size={18} />
              </span>
              <div>
                <h2>Bằng chứng chuỗi khối</h2>
                <p className="muted">
                  Hash và trạng thái giao dịch của TraceEvent
                </p>
              </div>
            </div>
          </div>
          <div className="proof-overview">
            <QrCodeCard value={traceUrl} />
            <div className={`proof-summary proof-${trace.proofStatus}`}>
              <IconShield size={54} />
              <div>
                <h3>{labelForProof(trace.proofStatus)}</h3>
                <p className="muted">
                  Không đánh đồng lỗi kết nối blockchain với sai lệch dữ liệu.
                </p>
              </div>
            </div>
          </div>
          <div className="info-grid" style={{ marginTop: 16 }}>
            <div className="info-item">
              <span className="info-label">Mạng ghi nhận</span>
              <span className="info-value">{proof?.network ?? "Chưa có"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Mã giao dịch</span>
              <span className="info-value" style={{ wordBreak: "break-all" }}>
                {proof?.txId ?? "Đang chờ"}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Hàm băm dữ liệu</span>
              <span className="info-value" style={{ wordBreak: "break-all" }}>
                {proof?.dataHash ?? "Chưa tạo"}
              </span>
            </div>
            <div className="info-item">
              <span className="info-label">Thời điểm ghi nhận</span>
              <span className="info-value">
                {proof?.recordedAt
                  ? formatTraceDate(proof.recordedAt)
                  : "Đang chờ"}
              </span>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
