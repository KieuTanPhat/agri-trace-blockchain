"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { ActionPanel } from "@/components/action-panel";
import { LotPicker } from "@/components/lot-picker";
import {
  IconPackage,
  IconClock,
  IconShield,
  IconLink,
} from "@/components/icons";
import { QrCodeCard } from "@/components/qr-code-card";
import { StateBadge } from "@/components/state-badge";
import { TimelineItem } from "@/components/timeline-item";
import { getLotById, getLots } from "@/lib/api-client";
import { labelForProof } from "@/lib/display-labels";
import type { LotTrace } from "@/lib/types";
import { LoadingState } from "@/components/loading-state";
import { ErrorState } from "@/components/error-state";

export default function LotDetailPage() {
  const { lotId } = useParams<{ lotId: string }>();
  const [lots, setLots] = useState<LotTrace[]>([]);
  const [lot, setLot] = useState<LotTrace | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(() => {
    setError("");
    Promise.all([getLots(), getLotById(lotId)])
      .then(([items, detail]) => {
        setLots(items);
        setLot(detail);
      })
      .catch((cause) =>
        setError(cause?.message ?? "Không tải được chi tiết lô."),
      );
  }, [lotId]);
  useEffect(load, [load]);
  if (error)
    return (
      <ErrorState
        status={503}
        title="Không tải được chi tiết lô"
        message={error}
        actionLabel="Thử lại"
        onAction={load}
      />
    );
  if (!lot) return <LoadingState title="Đang tải chi tiết lô" />;
  const traceToken = lot.traceToken;
  const traceUrl = traceToken
    ? `${process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace"}/${traceToken}`
    : "";

  return (
    <>
      <section className="page-header">
        <div className="page-header-icon">
          <IconPackage size={22} />
        </div>
        <div>
          <p className="eyebrow">Chi tiết lô</p>
          <h1>{lot.productName}</h1>
          <p className="muted">
            {lot.lotCode} — {lot.farmOrg.name}
          </p>
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
                <span className="panel-icon info">
                  <IconPackage size={16} />
                </span>
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
                <span className="info-value">
                  {lot.retailerOrg?.name ?? "Chưa gán"}
                </span>
              </div>
              <div className="info-item">
                <span className="info-label">Bằng chứng</span>
                <span className="info-value">
                  {labelForProof(lot.proofStatus)}
                </span>
              </div>
            </div>
            {traceToken && (
              <Link className="button secondary" href={`/trace/${traceToken}`}>
                <IconLink size={14} /> Xem trang tra cứu công khai
              </Link>
            )}
          </div>

          <div className="panel">
            <div className="panel-title">
              <div className="panel-title-left">
                <span className="panel-icon warning">
                  <IconClock size={16} />
                </span>
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
          <ActionPanel lot={lot} onCompleted={load} />
          <div className="panel">
            <div className="panel-title">
              <div className="panel-title-left">
                <span className="panel-icon success">
                  <IconShield size={16} />
                </span>
                <h2>Mã QR truy xuất</h2>
              </div>
            </div>
            {traceUrl ? (
              <>
                <QrCodeCard value={traceUrl} />
                <p className="muted" style={{ marginTop: 8 }}>
                  {traceUrl}
                </p>
              </>
            ) : (
              <p className="muted">Lô chưa có mã truy xuất công khai.</p>
            )}
          </div>
        </div>
      </section>
    </>
  );
}
