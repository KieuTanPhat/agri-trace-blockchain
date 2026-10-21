"use client";

import { useState } from "react";
import { request } from "@/lib/api-client";
import { downloadText } from "@/lib/platform-governance";
import { errorMessage, useWorkspaceData } from "@/lib/workspace";
import { labelForEvent } from "@/lib/display-labels";
import { BarList, LoadState, ManagePage, Metrics, PageHeader, ReloadButton, Section } from "@/components/manage";
import type { RecordOf, Row } from "@/lib/platform-admin";

type Report = {
  months: Row[];
  eventsByType: Row[];
  proofs: Record<string, number>;
  totalEvents: number;
  proofCoveragePercent: number;
  csv: string | null;
  fileName: string | null;
};

/** Traceability volume and blockchain proof coverage, with a key-data-element
 * export per lot (creation and transformation records). */
export default function TraceReportPage() {
  const state = useWorkspaceData<RecordOf<Report>>("/platform-admin/trace-report");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const r = state.data?.record;
  async function exportCsv() {
    setBusy(true);
    setError("");
    try {
      const params = new URLSearchParams({ export: "true", ...(from ? { from } : {}), ...(to ? { to } : {}) });
      const data = (await request<RecordOf<Report>>(`/platform-admin/trace-report?${params}`)).record;
      if (data.csv && data.fileName) downloadText(data.fileName, "﻿" + data.csv, "text/csv;charset=utf-8");
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <ManagePage>
      <PageHeader
        title="Báo cáo dữ liệu truy xuất"
        description="Số lô thu hoạch và lô chế biến theo tháng, sự kiện theo loại, độ phủ bằng chứng blockchain và xuất dữ liệu khóa (KDE) theo lô."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <LoadState loading={state.loading} error={state.error} />
      {r && (
        <>
          <Metrics
            label="Tổng quan dữ liệu"
            items={[
              { label: "Sự kiện truy xuất", value: r.totalEvents },
              { label: "Đã xác nhận trên sổ cái", value: r.proofs.CONFIRMED ?? 0 },
              { label: "Đang chờ / lỗi", value: `${r.proofs.PENDING ?? 0} / ${r.proofs.FAILED ?? 0}` },
              { label: "Độ phủ bằng chứng", value: `${r.proofCoveragePercent}%` },
            ]}
          />
          <div className="admin-grid-2">
            <Section title="Lô tạo mới theo tháng">
              <BarList label="Lô theo tháng" rows={r.months.map((m) => ({ label: `${m.month} (chế biến ${m.processedLots})`, value: Number(m.harvestLots) + Number(m.processedLots) }))} />
            </Section>
            <Section title="Sự kiện theo loại (12 tháng)">
              <BarList label="Sự kiện theo loại" rows={r.eventsByType.slice(0, 15).map((e) => ({ label: labelForEvent(String(e.eventType)), value: Number(e.count) }))} />
            </Section>
          </div>
        </>
      )}
      <Section title="Xuất dữ liệu khóa theo lô (CSV)" help="Mỗi dòng: mã lô, sản phẩm, tổ chức, nguồn gốc (thu hoạch/chế biến), lượng, thời điểm, chuỗi, lệnh chế biến và các lô đầu vào. Mặc định 90 ngày gần nhất.">
        <div className="admin-inline-form">
          <label className="field">Từ ngày<input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></label>
          <label className="field">Đến ngày<input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <button type="button" className="button" disabled={busy} onClick={() => void exportCsv()}>
            {busy ? "Đang xuất…" : "Tải CSV"}
          </button>
        </div>
        {error && <p className="notice error">{error}</p>}
      </Section>
    </ManagePage>
  );
}
