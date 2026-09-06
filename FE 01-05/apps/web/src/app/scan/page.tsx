"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { IconQrCode, IconSearch } from "@/components/icons";
import { QrCodeCard } from "@/components/qr-code-card";
import { mockBatches } from "@/lib/mock-api";
import { Smartphone, Leaf, ShieldCheck, Lightbulb, Link as LinkIcon } from "lucide-react";

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
    <div className="design-page scan-page">
      <section className="page-header">
        <div className="page-header-icon">
          <IconQrCode size={22} />
        </div>
        <div>
          <p className="eyebrow">Luồng quét mã</p>
          <h1>Quét hoặc nhập mã truy xuất</h1>
          <p className="muted">Nhập mã lô hoặc dán đường dẫn tra cứu công khai.</p>
        </div>
        <div className="header-features">
          <span className="header-feature"><ShieldCheck size={16} /> Minh bạch nguồn gốc</span>
          <span className="header-feature"><Leaf size={16} /> An toàn nông sản</span>
          <span className="header-feature"><Smartphone size={16} /> Vì người tiêu dùng</span>
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
          <div className="scan-display"><div className="qr-display"><QrCodeCard value={selectedTraceUrl} /><p className="qr-url"><LinkIcon size={18} />{selectedTraceUrl}</p></div><div className="scan-guide"><div className="phone-illustration" aria-hidden="true"><Smartphone size={120} strokeWidth={1.2} /><IconQrCode size={40} /><Leaf size={54} /></div><h3>Quét bằng camera điện thoại</h3><p className="muted">Hướng camera vào mã QR để mở trang truy xuất nguồn gốc trên thiết bị di động.</p><p className="guide-item"><IconQrCode size={22} />Truy cập nhanh chóng</p><p className="guide-item"><ShieldCheck size={22} />Thông tin rõ ràng, dễ đối chiếu</p><p className="guide-item"><Leaf size={22} />Kết nối trang trại và người tiêu dùng</p></div></div>
          <div className="design-note" style={{marginTop: 18}}><ShieldCheck size={28} /><div><strong>Mã QR được tạo từ hệ thống AgriTrace.</strong><p>Đảm bảo tính toàn vẹn và bảo mật dữ liệu.</p></div></div>
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
          <div className="design-note"><Lightbulb size={28} /><div><strong>Mẹo nhỏ</strong><p>Bạn có thể quét mã QR trên bao bì sản phẩm hoặc nhập trực tiếp mã lô để xem thông tin chi tiết.</p></div></div>
        </div>
      </section>
    </div>
  );
}
