"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconQrCode, IconSearch } from "@/components/icons";
import { QrCodeCard } from "@/components/qr-code-card";
import { mockBatches } from "@/lib/mock-api";

export default function ScanPage() {
  const router = useRouter();
  const [code, setCode] = useState("batch-rau-001");
  const traceBaseUrl = process.env.NEXT_PUBLIC_TRACE_BASE_URL ?? "http://localhost:3000/trace";
  const selectedTraceUrl = code.startsWith("http://") || code.startsWith("https://") ? code : `${traceBaseUrl}/${code}`;

  function openTrace() {
    const trimmed = code.trim();
    if (!trimmed) return;
    try {
      const url = new URL(trimmed);
      const traceIndex = url.pathname.indexOf("/trace/");
      if (traceIndex >= 0) {
        router.push(url.pathname);
        return;
      }
    } catch {
      // Plain batch ids are accepted.
    }
    router.push(`/trace/${encodeURIComponent(trimmed)}`);
  }

  return (
    <>
      <section className="page-header">
        <div className="page-header-icon">
          <IconQrCode size={22} />
        </div>
        <div>
          <p className="eyebrow">Luồng quét mã</p>
          <h1>Quét hoặc nhập mã truy xuất</h1>
          <p className="muted">Nhập mã lô hoặc dán đường dẫn tra cứu công khai.</p>
        </div>
      </section>

      <section className="grid two">
        <div className="panel">
          <div className="panel-title">
            <div className="panel-title-left">
              <span className="panel-icon info"><IconQrCode size={16} /></span>
              <h2>Mã QR đang chọn</h2>
            </div>
          </div>
          <QrCodeCard value={selectedTraceUrl} />
          <p className="muted" style={{ marginTop: 8 }}>{selectedTraceUrl}</p>
        </div>
        <div className="panel form-grid">
          <div className="panel-title">
            <div className="panel-title-left">
              <span className="panel-icon success"><IconSearch size={16} /></span>
              <h2>Tra cứu nông sản</h2>
            </div>
          </div>
          <div className="field">
            <label htmlFor="batch-select">Chọn nông sản mẫu</label>
            <select className="select" id="batch-select" value={code} onChange={(event) => setCode(event.target.value)}>
              {mockBatches.map((batch) => (
                <option key={batch.batchId} value={batch.batchId}>
                  {batch.productName} — {batch.batchCode}
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label htmlFor="trace-code">Mã lô hoặc đường dẫn</label>
            <input className="input" id="trace-code" placeholder="Nhập mã lô..." value={code} onChange={(event) => setCode(event.target.value)} />
          </div>
          <button className="button" onClick={openTrace}>
            <IconSearch size={14} /> Mở trang tra cứu
          </button>
        </div>
      </section>
    </>
  );
}
