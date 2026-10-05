import { traceStyles } from "@/styles";
import { withFeatureClasses } from "@/shared/utils/feature-classes";
import Image from "next/image";
import { ErrorState } from "@/shared/ui/error-state";
import { IconClock, IconShield, IconDatabase } from "@/shared/ui/icons";
import { QrCodeCard } from "@/shared/ui/qr-code-card";
import { StateBadge } from "@/shared/ui/state-badge";
import { TimelineItem } from "@/features/trace/components/timeline-item";
import { getPublicTrace } from "@/features/trace/api";
import { labelForProof } from "@/shared/utils/display-labels";
import { formatTraceDate } from "@/shared/utils/format-date";

export default async function PublicTracePage({
  params,
}: {
  params: Promise<{ traceToken: string }>;
}) {
  const { traceToken } = await params;
  const trace = await getPublicTrace(traceToken);
  if (!trace)
    return (
      <ErrorState
        status={404}
        title="Không tìm thấy lô"
        message="Mã QR hoặc mã lô không tồn tại."
      />
    );

  const proof = trace.blockchainProof;
  const traceUrl = `${process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace"}/${trace.traceToken ?? traceToken}`;
  return (
    <div className={withFeatureClasses("design-page trace-page", traceStyles)}>
      <section className="page-header">
        <Image
          className={withFeatureClasses("trace-product-photo", traceStyles)}
          src="/assets/shared/farm-greens.png"
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
          <div className={withFeatureClasses("proof-overview", traceStyles)}>
            <QrCodeCard value={traceUrl} />
            <div
              className={withFeatureClasses(
                `proof-summary proof-${trace.proofStatus}`,
                traceStyles,
              )}
            >
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
