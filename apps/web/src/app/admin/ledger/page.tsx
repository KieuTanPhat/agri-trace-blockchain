"use client";

import Link from "next/link";
import { useState } from "react";
import { useWorkspaceData } from "@/lib/workspace";
import { labelForEvent } from "@/lib/display-labels";
import { DataTable, FilterBar, LoadState, ManagePage, Metrics, PageHeader, ReloadButton, SearchField, Section, StatusBadge, Tabs } from "@/components/manage";
import { dateTime, type Items, type RecordOf, type Row } from "@/lib/platform-admin";

type Overview = {
  routes: Row[];
  bindings: Row[];
  outbox: Record<string, number>;
  proofs: Record<string, number>;
  controlJobs: Record<string, number>;
  unresolvedHolds: number;
  oldestPendingAgeMinutes: number;
  lastConfirmed: Row | null;
  lastFailure: Row | null;
  note: string;
};

/** Read-only picture of the Fabric network, organizations/identities and
 * transactions. Replays and repairs stay with operators. */
export default function LedgerPage() {
  const overview = useWorkspaceData<RecordOf<Overview>>("/platform-admin/ledger");
  const [tab, setTab] = useState("network");
  const [status, setStatus] = useState("");
  const [q, setQ] = useState("");
  const params = new URLSearchParams(Object.entries({ status, q }).filter(([, v]) => v)).toString();
  const txs = useWorkspaceData<Items>(tab === "transactions" ? `/platform-admin/ledger/transactions${params ? "?" + params : ""}` : null);
  const o = overview.data?.record;
  return (
    <ManagePage>
      <PageHeader
        title="Mạng & giao dịch blockchain"
        description="Tổng quan mạng Fabric, tổ chức/danh tính ghi sổ, giao dịch và tình trạng đồng bộ. Chỉ đọc."
        actions={<><Link className="button secondary" href="/admin/operations">Lỗi đồng bộ chi tiết</Link><ReloadButton onClick={overview.reload} /></>}
      />
      <LoadState loading={overview.loading} error={overview.error} />
      {o && (
        <>
          <Metrics
            label="Đồng bộ sổ cái"
            items={[
              { label: "Đã xác nhận", value: o.proofs.CONFIRMED ?? 0 },
              { label: "Outbox chờ / thử lại", value: `${o.outbox.PENDING ?? 0} / ${o.outbox.RETRY ?? 0}` },
              { label: "Lỗi vĩnh viễn", value: o.outbox.DEAD_LETTER ?? 0, href: "/admin/operations" },
              { label: "Hold chưa xử lý", value: o.unresolvedHolds, href: "/admin/operations" },
              { label: "Chờ lâu nhất", value: `${o.oldestPendingAgeMinutes} phút` },
            ]}
          />
          <p className="muted">
            Xác nhận gần nhất: {dateTime(o.lastConfirmed?.at)} {o.lastConfirmed?.txId ? `· tx ${String(o.lastConfirmed.txId).slice(0, 16)}…` : ""}
            {o.lastFailure && ` · Lỗi gần nhất ${dateTime(o.lastFailure.at)}: ${String(o.lastFailure.error ?? o.lastFailure.status)}`}
          </p>
          <p className="notice">{o.note}</p>
        </>
      )}
      <Tabs value={tab} onChange={setTab} tabs={[{ value: "network", label: "Mạng & danh tính" }, { value: "transactions", label: "Giao dịch" }]} />
      {tab === "network" && o && (
        <>
          <Section title="Binding theo chuỗi (tổ chức & danh tính ghi sổ)">
            <DataTable
              label="Binding"
              rows={o.bindings}
              rowKey={(r) => String(r.digest)}
              empty={{ title: "Chưa có binding", description: "Các chuỗi đang dùng route ghi mặc định." }}
              columns={[
                { header: "Chuỗi", cell: (r) => String(r.chainName ?? r.chainId) },
                { header: "Kênh / chaincode", cell: (r) => `${r.channelId} / ${r.chaincodeName}` },
                { header: "MSP ghi", cell: (r) => `${r.writerMspId} (${r.writerRole})` },
                { header: "Trạng thái", cell: (r) => <StatusBadge value={String(r.status)} /> },
                { header: "Khỏe lần cuối", cell: (r) => dateTime(r.lastHealthyAt) },
                { header: "Chứng thư hết hạn", cell: (r) => dateTime(r.certificateExpiresAt) },
                { header: "Lỗi", cell: (r) => String(r.lastErrorCode ?? "—") },
              ]}
            />
          </Section>
          <Section title="Route ghi sổ">
            <DataTable
              label="Route"
              rows={o.routes}
              rowKey={(r) => String(r.digest)}
              columns={[
                { header: "Mạng", cell: (r) => String(r.network) },
                { header: "Chế độ", cell: (r) => String(r.mode) },
                { header: "Kênh / chaincode", cell: (r) => `${r.channelId} / ${r.chaincodeName}.${r.contractName}` },
                { header: "MSP", cell: (r) => String(r.writerMspId ?? "—") },
                { header: "Tạo", cell: (r) => dateTime(r.createdAt) },
              ]}
            />
          </Section>
          <Section title="Ledger control job">
            <p>{Object.entries(o.controlJobs).map(([k, v]) => `${k}: ${v}`).join(" · ") || "Không có job"}</p>
          </Section>
        </>
      )}
      {tab === "transactions" && (
        <Section title="Giao dịch gần nhất">
          <FilterBar>
            <SearchField label="Tìm theo txId hoặc mã băm" value={q} onChange={setQ} />
            <label className="field">
              Trạng thái
              <select className="input" value={status} onChange={(e) => setStatus(e.target.value)}>
                <option value="">Tất cả</option>
                <option value="PENDING">Đang chờ</option>
                <option value="CONFIRMED">Đã xác nhận</option>
                <option value="FAILED">Lỗi</option>
              </select>
            </label>
          </FilterBar>
          <LoadState loading={txs.loading} error={txs.error} />
          <DataTable<Row>
            label="Giao dịch blockchain"
            rows={txs.data?.items}
            rowKey={(r) => String(r.eventId)}
            empty={{ title: "Không có giao dịch", description: "Chưa có sự kiện phù hợp bộ lọc." }}
            columns={[
              { header: "Sự kiện", cell: (r) => labelForEvent(String(r.eventType)) },
              { header: "Đối tượng", cell: (r) => `${r.entityType}` },
              { header: "Tổ chức", cell: (r) => String(r.organizationName ?? "—") },
              { header: "txId", cell: (r) => (r.txId ? `${String(r.txId).slice(0, 18)}…` : "—") },
              { header: "Trạng thái", cell: (r) => <StatusBadge value={r.status === "CONFIRMED" ? "ACTIVE" : r.status === "FAILED" ? "FAILED" : "PENDING_REVIEW"} label={String(r.status)} /> },
              { header: "Lần thử", cell: (r) => String(r.attempts) },
              { header: "Ghi nhận", cell: (r) => dateTime(r.recordedAt ?? r.createdAt) },
            ]}
          />
        </Section>
      )}
    </ManagePage>
  );
}
