"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DataTable, LoadState, ManagePage, PageHeader, ReloadButton, Section, Tabs } from "@/components/manage";
import { dateTime, label, reportCategoryLabels, reportStatusLabels, type Items, type Row } from "@/lib/platform-admin";

function Triage({ row, onDone }: { row: Row; onDone(): void }) {
  const command = useWorkspaceCommand();
  const [note, setNote] = useState("");
  const [severity, setSeverity] = useState("MEDIUM");
  const send = async (decision: string) => {
    if ((await command.run(`/platform-admin/consumer-reports/${row.id}/triage`, { decision, note: note.trim(), severity, version: row.version })) !== false) onDone();
  };
  return (
    <div className="admin-reason">
      <textarea className="input" aria-label="Ghi chú phân loại" placeholder="Ghi chú phân loại (tối thiểu 10 ký tự)" value={note} onChange={(e) => setNote(e.target.value)} />
      <label className="field">
        Mức độ khi chuyển sự cố
        <select className="input" value={severity} onChange={(e) => setSeverity(e.target.value)}>
          <option value="LOW">Thấp</option>
          <option value="MEDIUM">Trung bình</option>
          <option value="HIGH">Cao</option>
          <option value="CRITICAL">Nghiêm trọng</option>
        </select>
      </label>
      <div className="actions">
        <button type="button" className="button" disabled={command.pending || note.trim().length < 10} onClick={() => void send("ESCALATE")}>Chuyển hồ sơ sự cố</button>
        <button type="button" className="button secondary" disabled={command.pending || note.trim().length < 10} onClick={() => void send("DUPLICATE")}>Trùng lặp</button>
        <button type="button" className="button secondary" disabled={command.pending || note.trim().length < 10} onClick={() => void send("DISMISS")}>Không xử lý</button>
      </div>
      <CommandState command={command} />
    </div>
  );
}

/** Reports submitted from public QR pages. Contact data stays with the
 * platform; escalation opens a case assigned to the lot owner. */
export default function ConsumerReportsPage() {
  const [status, setStatus] = useState("NEW");
  const state = useWorkspaceData<Items>(`/platform-admin/consumer-reports${status ? `?status=${status}` : ""}`);
  return (
    <ManagePage>
      <PageHeader
        title="Báo cáo vi phạm"
        description="Phản ánh của người tiêu dùng gửi từ trang truy xuất QR. Thông tin liên hệ chỉ nhân sự nền tảng thấy; khi chuyển hồ sơ sự cố, doanh nghiệp chỉ nhận nội dung phản ánh."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <Tabs value={status} onChange={setStatus} tabs={[{ value: "NEW", label: "Mới" }, { value: "ESCALATED", label: "Đã chuyển sự cố" }, { value: "DISMISSED", label: "Không xử lý" }, { value: "DUPLICATE", label: "Trùng lặp" }, { value: "", label: "Tất cả" }]} />
      <LoadState loading={state.loading} error={state.error} />
      <Section label="Báo cáo">
        <DataTable<Row>
          label="Báo cáo vi phạm"
          rows={state.data?.items}
          rowKey={(r) => String(r.id)}
          empty={{ title: "Không có báo cáo", description: "Chưa có phản ánh phù hợp bộ lọc." }}
          columns={[
            { header: "Lúc", cell: (r) => dateTime(r.createdAt) },
            { header: "Sản phẩm / lô", cell: (r) => <><strong>{String(r.productName ?? "—")}</strong><br /><small>{String(r.lotCode ?? "")} · {String(r.organizationName ?? "")}</small></> },
            { header: "Loại", cell: (r) => label(reportCategoryLabels, r.category) },
            { header: "Nội dung", cell: (r) => String(r.description) },
            { header: "Liên hệ", cell: (r) => [r.contactEmail, r.contactPhone].filter(Boolean).join(" · ") || (r.hasContact ? "Có (chỉ nhân sự xử lý xem)" : "Ẩn danh") },
            { header: "Cùng nguồn", cell: (r) => String(r.sameSourceReports) },
            {
              header: "Xử lý",
              cell: (r) =>
                r.status === "NEW" ? (
                  <Triage row={r} onDone={state.reload} />
                ) : (
                  <>
                    {label(reportStatusLabels, r.status)}
                    {r.caseId ? <> · <Link href={`/admin/cases/${r.caseId}`}>Mở sự cố</Link></> : null}
                    <br />
                    <small>{String(r.triageNote ?? "")}</small>
                  </>
                ),
            },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
