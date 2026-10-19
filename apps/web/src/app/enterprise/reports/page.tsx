"use client";
import Link from "next/link";
import { useState } from 'react';
import { useWorkspaceData, textValue, type Row,type Overview } from "@/lib/workspace";
import { EmptyState, LoadState, PageHeader, StatusBadge } from "@/components/manage";
export default function ReportsPage() {
  const [page,setPage]=useState(1),[q,setQ]=useState(''),[siteId,setSiteId]=useState(''),[expiryBefore,setExpiryBefore]=useState('');
  const query=new URLSearchParams({page:String(page),pageSize:'25',...(q?{q}:{}),...(siteId?{siteId}:{}),...(expiryBefore?{expiryBefore}:{})});
  const state = useWorkspaceData<{ lots: Row[]; transfers: Row[];hasNext:boolean }>(`/distribution/reports?${query}`),sites=useWorkspaceData<{items:Row[]}>('/enterprise-workspace/sites'),overview=useWorkspaceData<Overview>('/enterprise-workspace');
  function download() {
    if (!state.data) return;
    const columns = [
      "lotCode",
      "productName",
      "initialQuantity",
      "globalAvailable",
      "held",
      "reserved",
      "available",
      "unit",
    ];
    const safe = (v: unknown) => {
      let s = textValue(v);
      if (/^[\s\u0000-\u001f]*[=+@-]/.test(s)) s = "'" + s;
      return '"' + s.replaceAll('"', '""') + '"';
    };
    const csv =
      "\uFEFF" +
      [
        "Mã lô,Sản phẩm,Lượng nguồn,Còn toàn lô,Đang giữ,Đã dành giao,Có thể giao,Đơn vị",
        ...state.data.lots.map((r) => columns.map((c) => safe(r[c])).join(",")),
      ].join("\r\n");
    const url = URL.createObjectURL(
      new Blob([csv], { type: "text/csv;charset=utf-8" }),
    );
    const a = document.createElement("a");
    a.href = url;
    a.download = "doi-soat-truy-xuat.csv";
    a.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="manage-console">
      <PageHeader actionKind="create" back="/enterprise" backLabel="Doanh nghiệp"
        title="Đối soát & báo cáo truy xuất"
        description="Số lượng theo lô nguồn và doanh nghiệp đang giữ. Các lượng khác đơn vị được đối soát riêng."
      />
      <div className="workspace-actions">
        <button
          className="button secondary"
          onClick={download}
          disabled={!state.data}
        >
          Tải CSV trang đang xem
        </button>
        {overview.data?.permissions.includes('quantity.adjust')&&<Link className="button secondary" href="/enterprise/reports/adjust">
          Ghi giảm lượng hàng
        </Link>}
        {(overview.data?.permissions.includes('inventory.manage')||overview.data?.permissions.includes('quarantine.manage'))&&<Link className="button secondary" href="/enterprise/inventory">Tồn và cách ly theo cơ sở</Link>}
        <Link className="text-link" href="/distribution">
          Xem các chặng giao nhận →
        </Link>
      </div>
      <section className="panel enterprise-fields" aria-label="Lọc báo cáo"><label>Tìm lô / sản phẩm<input className="input" value={q} maxLength={100} onChange={e=>{setQ(e.target.value);setPage(1);}}/></label><label>Cơ sở<select className="input" value={siteId} onChange={e=>{setSiteId(e.target.value);setPage(1);}}><option value="">Tất cả cơ sở trong quyền</option>{sites.data?.items.map(s=><option key={String(s.id)} value={String(s.id)}>{textValue(s.name)}</option>)}</select></label><label>Hết hạn đến ngày<input className="input" type="date" value={expiryBefore} onChange={e=>{setExpiryBefore(e.target.value);setPage(1);}}/></label></section>
      <LoadState {...state} />
      <div className="manage-section manage-table-scroll">
        {state.data?.lots.length ? (
          <table className="manage-table">
            <thead>
              <tr>
                <th>Lô nguồn</th>
                <th>Lượng nguồn</th>
                <th>Còn toàn lô</th>
                <th>Đang giữ</th>
                <th>Đã dành giao</th>
                <th>Có thể giao tiếp</th>
              </tr>
            </thead>
            <tbody>
              {state.data.lots.map((l) => (
                <tr key={String(l.lotId)}>
                  <td>
                    {textValue(l.lotCode)}
                    {Boolean(l.blocked) && (
                      <small className="workspace-badge blocked">
                        Dừng giao nhận — xem cảnh báo QR
                      </small>
                    )}
                    <small>{textValue(l.productName)}</small>
                    {Boolean(l.traceToken) && (
                      <Link
                        className="text-link"
                        href={`/trace/${l.traceToken}`}
                      >
                        Truy xuất hai chiều →
                      </Link>
                    )}
                  </td>
                  {[
                    "initialQuantity",
                    "globalAvailable",
                    "held",
                    "reserved",
                    "available",
                  ].map((c) => (
                    <td key={c}>
                      {textValue(l[c])} {textValue(l.unit)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        ) : (
          !state.loading && !state.error && <EmptyState />
        )}
      </div>
      <nav className="workspace-actions" aria-label="Trang báo cáo"><button className="button secondary" disabled={page===1||state.loading} onClick={()=>setPage(p=>p-1)}>Trang trước</button><span>Trang {page}</span><button className="button secondary" disabled={!state.data?.hasNext||state.loading} onClick={()=>setPage(p=>p+1)}>Trang sau</button></nav>
      <section className="panel">
        <h2>Hành trình phân phối</h2>
        <p className="muted">
          Truy ngược về nguồn và truy xuôi qua các lần giao tiếp của cùng mã lô.
        </p>
        <div className="workspace-journey">
          {state.data?.transfers.map((t) => (
            <article key={String(t.id)}>
              <h3>
                <Link className="text-link" href={`/distribution/${t.id}`}>
                  {textValue(t.senderName)} → {textValue(t.receiverName)}
                </Link>
              </h3>
              <p>
                {textValue(t.carrierName)} ·{" "}
                {(t.lines as Row[])
                  .map(
                    (l) =>
                      `${textValue(l.quantity)} ${textValue(l.unit)} (${textValue(l.lotCode)})`,
                  )
                  .join(", ")}
              </p>
              <StatusBadge value={String(t.status)} />
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
