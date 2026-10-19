"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspaceData } from "@/lib/workspace";
import { DataTable, LoadState, ManagePage, PageHeader, ReloadButton, Section, StatusBadge, Tabs } from "@/components/manage";
import { dateTime, label, processTypeLabels, runStatusLabels, type Items, type Row } from "@/lib/platform-admin";

/** Processing runs of this processor and the raw material it holds. */
export default function ProcessingRunsPage() {
  const [status, setStatus] = useState("");
  const runs = useWorkspaceData<Items>(`/processing-runs${status ? `?status=${status}` : ""}`);
  const materials = useWorkspaceData<Items>("/processing-runs/materials");
  return (
    <ManagePage>
      <PageHeader
        title="Lệnh chế biến"
        description="Dùng lô nguyên liệu đã nhận tại cơ sở chế biến để tạo lô thành phẩm mới. Hoàn tất lệnh trừ lượng nguyên liệu, tạo lô và mã QR thành phẩm, ghi sự kiện băm lên sổ cái."
        action={{ href: "/enterprise/processing/new", label: "Lập lệnh chế biến" }}
        actions={
          <>
            <Link className="button secondary" href="/enterprise/processing/conversions">Hệ số quy đổi</Link>
            <ReloadButton onClick={() => { runs.reload(); materials.reload(); }} />
          </>
        }
      />
      <Section title="Nguyên liệu đang giữ tại cơ sở chế biến">
        <LoadState loading={materials.loading} error={materials.error} />
        <DataTable<Row>
          label="Nguyên liệu"
          rows={materials.data?.items}
          rowKey={(r) => `${r.lotId}-${r.siteId}`}
          empty={{ title: "Chưa có nguyên liệu", description: "Nhận hàng qua giao nhận và chọn cơ sở loại chế biến/đóng gói làm nơi nhận." }}
          columns={[
            { header: "Lô", cell: (r) => <><strong>{String(r.lotCode)}</strong><br /><small>{String(r.productName)}</small></> },
            { header: "Nguồn", cell: (r) => String(r.sourceOrganization) },
            { header: "Cơ sở", cell: (r) => String(r.siteName) },
            { header: "Khả dụng", cell: (r) => `${r.available} ${r.unit}` },
            { header: "Hạn dùng", cell: (r) => String(r.expiryDate ?? "—") },
            { header: "Tình trạng", cell: (r) => (r.blocked ? <StatusBadge value="LOCKED" label="Không dùng được" /> : <StatusBadge value="ACTIVE" label="Sẵn sàng" />) },
          ]}
        />
      </Section>
      <Section title="Lệnh chế biến">
        <Tabs value={status} onChange={setStatus} tabs={[{ value: "", label: "Tất cả" }, { value: "DRAFT", label: "Nháp" }, { value: "COMPLETED", label: "Đã hoàn tất" }, { value: "CANCELLED", label: "Đã hủy" }]} />
        <LoadState loading={runs.loading} error={runs.error} />
        <DataTable<Row>
          label="Lệnh chế biến"
          rows={runs.data?.items}
          rowKey={(r) => String(r.id)}
          empty={{ title: "Chưa có lệnh chế biến", description: "Lập lệnh đầu tiên từ nguyên liệu đang giữ." }}
          columns={[
            { header: "Mã lệnh", cell: (r) => <Link href={`/enterprise/processing/${r.id}`}>{String(r.code)}</Link> },
            { header: "Loại", cell: (r) => label(processTypeLabels, r.processType) },
            { header: "Chuỗi", cell: (r) => String(r.chainName) },
            { header: "Đầu vào → thành phẩm", cell: (r) => `${(r.inputs as Row[]).length} lô → ${(r.outputs as Row[]).length} lô` },
            { header: "Cân bằng", cell: (r) => (r.inputTotal ? `${r.inputTotal} = ${r.outputTotal} + ${r.lossTotal} ${r.baseUnit}` : "—") },
            { header: "Trạng thái", cell: (r) => <StatusBadge value={r.status === "COMPLETED" ? "ACTIVE" : r.status === "CANCELLED" ? "CANCELLED" : "PENDING_REVIEW"} label={label(runStatusLabels, r.status)} /> },
            { header: "Tạo / hoàn tất", cell: (r) => `${dateTime(r.createdAt)}${r.completedAt ? ` → ${dateTime(r.completedAt)}` : ""}` },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
