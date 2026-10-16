import Link from "next/link";
import Image from "next/image";
import { Clock, Database, ShieldCheck } from "lucide-react";
import { ErrorState } from "@/components/error-state";
import { QrCodeCard } from "@/components/qr-code-card";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { Reveal } from "@/components/ui/reveal";
import { getPublicTrace } from "@/lib/api-client";
import { labelForProof } from "@/lib/display-labels";
import { formatTraceDate } from "@/lib/format-date";
import { LotWarnings } from "@/components/lot-warnings";

export const dynamic = "force-dynamic";

export default async function PublicTracePage({
  params,
}: {
  params: Promise<{ lotId: string }>;
}) {
  const { lotId } = await params;
  let trace: Awaited<ReturnType<typeof getPublicTrace>>;
  try {
    trace = await getPublicTrace(lotId);
  } catch {
    return (
      <ErrorState
        status={503}
        title="Chưa tải được thông tin truy xuất"
        message="Kết nối tạm thời gián đoạn. Vui lòng tải lại trang để lấy trạng thái mới nhất."
      />
    );
  }
  if (!trace)
    return (
      <ErrorState
        status={404}
        title="Không tìm thấy lô"
        message="Mã QR hoặc mã truy xuất không tồn tại. Kiểm tra lại mã trên sản phẩm."
        action={
          <Link className="button secondary" href="/scan">
            Quét lại mã QR
          </Link>
        }
      />
    );

  const proof = trace.blockchainProof;
  const proofTone = {
    VERIFIED: "verified",
    PENDING: "pending",
    INTEGRITY_WARNING: "mismatch",
    BLOCKCHAIN_UNAVAILABLE: "unavailable",
  }[trace.proofStatus];
  const traceUrl = `${process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace"}/${trace.traceToken ?? lotId}`;
  return (
    <div className="trace-page">
      <LotWarnings lot={trace} />

      <section className="trace-hero enter">
        <Image
          className="trace-product-photo"
          src="/farm-greens.png"
          alt="Nông sản tại trang trại"
          width={500}
          height={500}
        />
        <div>
          <p className="eyebrow eyebrow-pill">Tra cứu công khai</p>
          <h1>{trace.productName}</h1>
          <p className="muted">
            {trace.lotCode} · {trace.farmOrg.name} · Vụ{" "}
            {trace.productionCycle.cycleCode}
          </p>
          <div className="actions">
            <StateBadge state={trace.currentState} />
            <StateBadge state={trace.proofStatus} />
          </div>
        </div>
      </section>

      <Reveal className="grid two">
        <section className="panel">
          <h2>Thông tin lô hàng</h2>
          <ul className="fact-list">
            <li>
              <span>Thu hoạch</span>
              <span>{formatTraceDate(trace.harvestTime)}</span>
            </li>
            <li>
              <span>Số lượng</span>
              <span>
                {trace.initialQuantity} {trace.unit} · còn lại{" "}
                {trace.availableQuantity} {trace.unit}
              </span>
            </li>
            <li>
              <span>Hạn sử dụng</span>
              <span>{trace.expiryDate ?? "Chưa khai báo"}</span>
            </li>
            <li>
              <span>Cảm biến</span>
              <span>
                {trace.sensorEvidence.readingCount} mẫu trong khoảng đã chốt
              </span>
            </li>
            {trace.sensorEvidence.periodStart &&
              trace.sensorEvidence.periodEnd && (
                <li>
                  <span>Khoảng đã chốt</span>
                  <span>
                    {formatTraceDate(trace.sensorEvidence.periodStart)} đến{" "}
                    {formatTraceDate(trace.sensorEvidence.periodEnd)}
                  </span>
                </li>
              )}
            {trace.shipment && (
              <li>
                <span>Giao nhận</span>
                <span>
                  {trace.shipment.origin} → {trace.shipment.destination}
                </span>
              </li>
            )}
          </ul>
        </section>

        <section className="panel">
          <h2>Chứng nhận công khai đang hiệu lực</h2>
          {trace.certificates.length ? (
            <div className="grid">
              {trace.certificates.map((certificate, index) => (
                <article
                  className="certificate-card"
                  key={`${certificate.documentHash}-${index}`}
                >
                  <h3>
                    {certificate.type} — {certificate.issuer}
                  </h3>
                  <p>
                    Ngày cấp: {formatTraceDate(certificate.issueDate)} · Hết
                    hạn:{" "}
                    {certificate.expiryDate
                      ? formatTraceDate(certificate.expiryDate)
                      : "Chưa khai báo"}
                  </p>
                  <p className="muted">SHA-256: {certificate.documentHash}</p>
                </article>
              ))}
            </div>
          ) : (
            <p>Chưa có chứng nhận công khai đang hiệu lực.</p>
          )}
        </section>
      </Reveal>

      <Reveal className="grid two">
        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-left">
              <span className="panel-icon warning">
                <Clock size={18} />
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
        </section>

        <section className="panel">
          <div className="panel-title">
            <div className="panel-title-left">
              <span className="panel-icon success">
                <Database size={18} />
              </span>
              <div>
                <h2>Bằng chứng chuỗi khối</h2>
                <p className="muted">
                  Mã băm và trạng thái bằng chứng của sự kiện
                </p>
              </div>
            </div>
          </div>
          <div className="proof-overview">
            <QrCodeCard value={traceUrl} />
            <div className={`proof-summary proof-${proofTone}`}>
              <ShieldCheck size={44} />
              <div>
                <h3>{labelForProof(trace.proofStatus)}</h3>
                <p className="muted">
                  Bằng chứng kiểm tra tính toàn vẹn dữ liệu đã ghi nhận.
                </p>
              </div>
            </div>
          </div>
          <div className="info-grid">
            <div className="info-item">
              <span className="info-label">Mạng ghi nhận</span>
              <span className="info-value">{proof?.network ?? "Chưa có"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Mã giao dịch</span>
              <span className="info-value">{proof?.txId ?? "Đang chờ"}</span>
            </div>
            <div className="info-item">
              <span className="info-label">Hàm băm dữ liệu</span>
              <span className="info-value">{proof?.dataHash ?? "Chưa tạo"}</span>
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
        </section>
      </Reveal>
    </div>
  );
}
