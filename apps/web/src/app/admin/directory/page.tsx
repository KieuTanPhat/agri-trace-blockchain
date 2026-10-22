"use client";
import { NativeSelect } from "@/components/ui/native-select";

import Link from "next/link";
import { useState } from "react";
import { useWorkspaceData } from "@/lib/workspace";
import {
  DataTable,
  FilterBar,
  LoadState,
  ManagePage,
  PageHeader,
  ReloadButton,
  SearchField,
  Section,
  StatusBadge,
} from "@/components/manage";
import {
  capabilityLabels,
  label,
  participationLabels,
  shortDate,
  subscriptionLabels,
  type Items,
  type Row,
} from "@/lib/platform-admin";

/** Every participating organization with its capabilities, plan and size. */
export default function DirectoryPage() {
  const [q, setQ] = useState("");
  const [capability, setCapability] = useState("");
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [plan, setPlan] = useState("");
  const params = new URLSearchParams(
    Object.entries({ q, capability, status, model, plan }).filter(([, v]) => v),
  ).toString();
  const state = useWorkspaceData<Items>(`/platform-admin/organizations${params ? "?" + params : ""}`);
  const select = (
    labelText: string,
    value: string,
    set: (v: string) => void,
    options: Record<string, string>,
  ) => (
    <label className="field">
      {labelText}
      <NativeSelect className="input" value={value} onChange={(e) => set(e.target.value)}>
        <option value="">Tất cả</option>
        {Object.entries(options).map(([k, v]) => (
          <option key={k} value={k}>
            {v}
          </option>
        ))}
      </NativeSelect>
    </label>
  );
  return (
    <ManagePage>
      <PageHeader
        title="Danh sách doanh nghiệp"
        description="Tra cứu mọi tổ chức tham gia theo năng lực, mô hình tham gia, trạng thái và gói dịch vụ. Mở từng doanh nghiệp để xem toàn cảnh."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <Section label="Bộ lọc">
        <FilterBar>
          <SearchField label="Tìm theo tên doanh nghiệp" value={q} onChange={setQ} />
          {select("Năng lực", capability, setCapability, { FARM: "Nhà sản xuất/HTX", TRANSPORTER: "Vận chuyển", PROCESSOR: "Chế biến", DISTRIBUTOR: "Phân phối", RETAILER: "Bán lẻ" })}
          {select("Mô hình", model, setModel, participationLabels)}
          {select("Trạng thái", status, setStatus, { ACTIVE: "Đang hoạt động", INACTIVE: "Ngừng hoạt động" })}
          {select("Gói dịch vụ", plan, setPlan, { ACTIVE: "Đang hiệu lực", GRACE: "Trong ân hạn", RESTRICTED: "Hạn chế", PENDING_PAYMENT: "Chờ thanh toán" })}
        </FilterBar>
      </Section>
      <LoadState loading={state.loading} error={state.error} />
      <Section title={`Tổ chức (${state.data?.items.length ?? 0})`}>
        <DataTable<Row>
          label="Danh sách doanh nghiệp"
          rows={state.data?.items}
          rowKey={(r) => String(r.id)}
          empty={{ title: "Không có doanh nghiệp phù hợp", description: "Thử bỏ bớt bộ lọc." }}
          columns={[
            { header: "Doanh nghiệp", cell: (r) => <Link href={`/admin/directory/${r.id}`}>{String(r.name)}</Link> },
            { header: "Mô hình", cell: (r) => label(participationLabels, r.participationModel) },
            {
              header: "Năng lực",
              cell: (r) =>
                [
                  ...(r.capabilities as string[]).map((c) => label(capabilityLabels, c)),
                  ...(r.pendingCapabilities as string[]).map((c) => `${label(capabilityLabels, c)} (chờ duyệt)`),
                ].join(", ") || "—",
            },
            { header: "Gói", cell: (r) => (r.planName ? `${r.planName} · ${label(subscriptionLabels, r.subscriptionStatus)}` : "—") },
            { header: "Hết hạn", cell: (r) => shortDate(r.endsAt) },
            { header: "Thành viên", cell: (r) => String(r.members) },
            { header: "Chuỗi sở hữu", cell: (r) => String(r.ownedChains) },
            { header: "Trạng thái", cell: (r) => <StatusBadge value={String(r.status)} /> },
          ]}
        />
      </Section>
    </ManagePage>
  );
}
