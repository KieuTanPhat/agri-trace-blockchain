"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspaceData } from "@/lib/workspace";
import { DataTable, FilterBar, LoadState, ManagePage, PageHeader, ReloadButton, SearchField, Section, StatusBadge } from "@/components/manage";
import { capabilityLabels, label, shortDate, type Items, type Row } from "@/lib/platform-admin";

/** Every supply chain on the platform, read-only. Chain owners manage members;
 * the platform watches state, activity and ledger binding. */
export default function ChainsMonitorPage() {
  const state = useWorkspaceData<Items>("/platform-admin/chains");
  const [q, setQ] = useState("");
  const rows = (state.data?.items ?? []).filter(
    (r) => !q || `${r.name} ${r.code} ${r.ownerName}`.toLowerCase().includes(q.toLowerCase()),
  );
  return (
    <ManagePage>
      <PageHeader
        title="Giám sát chuỗi truy xuất"
        description="Chủ chuỗi, thành viên theo vai trò, hoạt động và trạng thái binding sổ cái. Chỉ đọc; chủ chuỗi quản lý thành viên."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <Section label="Bộ lọc">
        <FilterBar>
          <SearchField label="Tìm chuỗi, mã hoặc chủ chuỗi" value={q} onChange={setQ} />
        </FilterBar>
      </Section>
      <LoadState loading={state.loading} error={state.error} />
      <Section title={`Chuỗi (${rows.length})`}>
        <DataTable<Row>
          label="Chuỗi truy xuất"
          rows={rows}
          rowKey={(r) => String(r.id)}
          empty={{ title: "Chưa có chuỗi", description: "Nhà sản xuất/HTX hoặc doanh nghiệp chuỗi tạo chuỗi sau khi kích hoạt." }}
          columns={[
            { header: "Chuỗi", cell: (r) => <><strong>{String(r.name)}</strong><br /><small>{String(r.code ?? "")}</small></> },
            { header: "Chủ chuỗi", cell: (r) => <Link href={`/admin/directory/${r.ownerId}`}>{String(r.ownerName)}</Link> },
            { header: "Thành viên", cell: (r) => `${r.members} hoạt động${r.invited ? ` · ${r.invited} đang mời` : ""}` },
            { header: "Vai trò có mặt", cell: (r) => (r.roles as string[]).map((c) => label(capabilityLabels, c)).join(", ") || "—" },
            { header: "Vụ / lệnh chế biến", cell: (r) => `${r.cycles} / ${r.processingRuns}` },
            { header: "Giao nhận mở", cell: (r) => String(r.openTransfers) },
            { header: "Sổ cái", cell: (r) => (r.ledgerBound ? "Đã gắn binding" : "Route mặc định") },
            { header: "Trạng thái", cell: (r) => <StatusBadge value={String(r.state)} /> },
            { header: "Tạo", cell: (r) => shortDate(r.createdAt) },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
