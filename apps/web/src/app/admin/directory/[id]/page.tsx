"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useState } from "react";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import {
  CommandState,
  DataTable,
  DetailList,
  LoadState,
  ManagePage,
  PageHeader,
  ReasonAction,
  ReloadButton,
  Section,
  StatusBadge,
  Tabs,
} from "@/components/manage";
import {
  capabilityLabels,
  dateTime,
  invoiceLabels,
  label,
  money,
  participationLabels,
  resourceLabels,
  shortDate,
  subscriptionLabels,
  ticketStatusLabels,
  type RecordOf,
  type Row,
} from "@/lib/platform-admin";

type Org = Row & {
  capabilities: Row[];
  capabilityRequests: Row[];
  enrollment: (Row & { connections: Row[] }) | null;
  billing: { applies: boolean; paying: boolean; status: string; limits: Record<string, number> | null; usage: Record<string, number>; subscription: Row | null; invoices: Row[] };
  chains: { owned: Row[]; memberships: Row[] };
  sites: Row[];
  members: Row[];
  activity: { lots: number; processingRuns: number };
  cases: Row[];
  tickets: Row[];
  audit: Row[];
  profile: Row | null;
};

/** 360° view of one organization. Status changes use the audited organization
 * command, which revokes sessions when an organization is suspended. */
export default function OrganizationDetailPage() {
  const { id } = useParams<{ id: string }>();
  const state = useWorkspaceData<RecordOf<Org>>(`/platform-admin/organizations/${id}`);
  const command = useWorkspaceCommand();
  const [tab, setTab] = useState("overview");
  const org = state.data?.record;
  async function setStatus(status: "ACTIVE" | "INACTIVE", reason: string) {
    if (!org) return false;
    const done = await command.run(`/organizations/${org.id}`, { status, reason, version: org.version }, "PATCH");
    if (done !== false) state.reload();
    return done;
  }
  return (
    <ManagePage>
      <PageHeader
        back="/admin/directory"
        title={org ? String(org.name) : "Doanh nghiệp"}
        description="Hồ sơ, năng lực, gói dịch vụ, thành viên, chuỗi, sự cố và nhật ký của tổ chức."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <LoadState loading={state.loading} error={state.error} />
      <CommandState command={command} />
      {org && (
        <>
          <Section
            title="Tóm tắt"
            actions={
              org.status === "ACTIVE" ? (
                <ReasonAction label="Tạm ngưng tổ chức" danger disabled={command.pending} onSubmit={(r) => setStatus("INACTIVE", r)} />
              ) : (
                <ReasonAction label="Khôi phục hoạt động" disabled={command.pending} onSubmit={(r) => setStatus("ACTIVE", r)} />
              )
            }
          >
            <DetailList
              items={[
                ["Trạng thái", <StatusBadge key="s" value={String(org.status)} />],
                ["Mô hình tham gia", label(participationLabels, org.participationModel)],
                ["Năng lực hiệu lực", org.capabilities.filter((c) => !c.revokedAt).map((c) => label(capabilityLabels, c.code)).join(", ") || "—"],
                ["Hồ sơ đăng ký", org.enrollment ? <Link key="e" href={`/admin/enterprises/${org.enrollment.id}`}>{String(org.enrollment.stage)}</Link> : "Tạo bởi vận hành"],
                ["Gói dịch vụ", org.billing.subscription ? `${org.billing.subscription.planName} · ${label(subscriptionLabels, org.billing.status)}` : label(subscriptionLabels, org.billing.status)],
                ["Lô đã tạo / lệnh chế biến", `${org.activity.lots} / ${org.activity.processingRuns}`],
                ["Tham gia từ", shortDate(org.createdAt)],
              ]}
            />
            <p className="muted">Tạm ngưng chặn mọi thao tác ghi của tổ chức và thu hồi phiên đăng nhập; lịch sử truy xuất giữ nguyên.</p>
          </Section>
          <Tabs
            value={tab}
            onChange={setTab}
            tabs={[
              { value: "overview", label: "Năng lực & gói" },
              { value: "members", label: "Thành viên", count: org.members.length },
              { value: "chains", label: "Chuỗi & cơ sở", count: org.chains.owned.length + org.chains.memberships.length },
              { value: "support", label: "Sự cố & hỗ trợ", count: org.cases.length + org.tickets.length },
              { value: "audit", label: "Nhật ký", count: org.audit.length },
            ]}
          />
          {tab === "overview" && (
            <>
              <Section title="Yêu cầu năng lực">
                <DataTable
                  label="Yêu cầu năng lực"
                  rows={org.capabilityRequests}
                  rowKey={(r) => String(r.id)}
                  empty={{ title: "Không có yêu cầu năng lực", description: "Tổ chức được tạo trước khi duyệt từng năng lực." }}
                  columns={[
                    { header: "Năng lực", cell: (r) => label(capabilityLabels, r.code) },
                    { header: "Trạng thái", cell: (r) => <StatusBadge value={r.status === "PENDING" ? "PENDING_REVIEW" : String(r.status)} /> },
                    { header: "Ghi chú", cell: (r) => String(r.reviewNote ?? "—") },
                    { header: "Duyệt lúc", cell: (r) => dateTime(r.reviewedAt) },
                  ]}
                />
              </Section>
              <Section title="Hạn mức & sử dụng">
                {org.billing.limits ? (
                  <DataTable
                    label="Hạn mức"
                    rows={Object.keys(resourceLabels).map((k) => ({ k }))}
                    rowKey={(r) => r.k}
                    columns={[
                      { header: "Hạng mục", cell: (r) => resourceLabels[r.k] },
                      { header: "Đã dùng", cell: (r) => String(org.billing.usage[r.k] ?? 0) },
                      { header: "Hạn mức", cell: (r) => String(org.billing.limits?.[r.k] ?? "—") },
                    ]}
                  />
                ) : (
                  <p className="muted">Tổ chức không áp hạn mức gói (tạo trước khi áp dụng gói dịch vụ).</p>
                )}
              </Section>
              <Section title="Hóa đơn">
                <DataTable
                  label="Hóa đơn của tổ chức"
                  rows={org.billing.invoices}
                  rowKey={(r) => String(r.id)}
                  empty={{ title: "Chưa có hóa đơn", description: "Hóa đơn phát sinh khi doanh nghiệp chấp nhận hợp đồng hoặc gia hạn." }}
                  columns={[
                    { header: "Số", cell: (r) => String(r.number) },
                    { header: "Loại", cell: (r) => String(r.kind) },
                    { header: "Số tiền", cell: (r) => money(r.amount) },
                    { header: "Trạng thái", cell: (r) => `${label(invoiceLabels, r.status)}${r.simulated ? " (mô phỏng)" : ""}` },
                    { header: "Hạn", cell: (r) => shortDate(r.dueAt) },
                  ]}
                />
              </Section>
            </>
          )}
          {tab === "members" && (
            <Section title="Thành viên">
              <DataTable
                label="Thành viên"
                rows={org.members}
                rowKey={(r) => String(r.id)}
                columns={[
                  { header: "Họ tên", cell: (r) => String(r.fullName) },
                  { header: "Email", cell: (r) => String(r.email) },
                  { header: "Vai trò", cell: (r) => String(r.role) },
                  { header: "Cấp", cell: (r) => String(r.enterpriseTier ?? "—") },
                  { header: "Trạng thái", cell: (r) => <StatusBadge value={String(r.accountStatus)} /> },
                ]}
              />
            </Section>
          )}
          {tab === "chains" && (
            <>
              <Section title="Chuỗi sở hữu">
                <DataTable label="Chuỗi sở hữu" rows={org.chains.owned} rowKey={(r) => String(r.id)} empty={{ title: "Không sở hữu chuỗi", description: "Chỉ nhà sản xuất/HTX và doanh nghiệp chuỗi trả phí được tạo chuỗi." }} columns={[
                  { header: "Tên", cell: (r) => String(r.name) },
                  { header: "Mã", cell: (r) => String(r.code ?? "—") },
                  { header: "Trạng thái", cell: (r) => <StatusBadge value={String(r.state ?? "UNKNOWN")} /> },
                ]} />
              </Section>
              <Section title="Tham gia chuỗi">
                <DataTable label="Tham gia chuỗi" rows={org.chains.memberships} rowKey={(r) => String(r.chainId)} columns={[
                  { header: "Chuỗi", cell: (r) => String(r.name) },
                  { header: "Trạng thái", cell: (r) => <StatusBadge value={String(r.status)} /> },
                ]} />
              </Section>
              <Section title="Cơ sở">
                <DataTable label="Cơ sở" rows={org.sites} rowKey={(r) => String(r.id)} columns={[
                  { header: "Tên", cell: (r) => String(r.name) },
                  { header: "Loại", cell: (r) => String(r.kind) },
                  { header: "Trạng thái", cell: (r) => <StatusBadge value={String(r.status)} /> },
                ]} />
              </Section>
            </>
          )}
          {tab === "support" && (
            <>
              <Section title="Hồ sơ sự cố">
                <DataTable label="Sự cố" rows={org.cases} rowKey={(r) => String(r.id)} columns={[
                  { header: "Số", cell: (r) => <Link href={`/admin/cases/${r.id}`}>#{String(r.caseNumber)}</Link> },
                  { header: "Tiêu đề", cell: (r) => String(r.title) },
                  { header: "Mức độ", cell: (r) => String(r.severity) },
                  { header: "Trạng thái", cell: (r) => String(r.status) },
                ]} />
              </Section>
              <Section title="Yêu cầu hỗ trợ">
                <DataTable label="Yêu cầu hỗ trợ" rows={org.tickets} rowKey={(r) => String(r.id)} columns={[
                  { header: "Mã", cell: (r) => <Link href={`/admin/support/${r.id}`}>{String(r.code)}</Link> },
                  { header: "Chủ đề", cell: (r) => String(r.subject) },
                  { header: "Trạng thái", cell: (r) => label(ticketStatusLabels, r.status) },
                ]} />
              </Section>
            </>
          )}
          {tab === "audit" && (
            <Section title="Nhật ký kiểm toán liên quan">
              <DataTable label="Nhật ký" rows={org.audit} rowKey={(r) => String(r.sequence)} columns={[
                { header: "Thời điểm", cell: (r) => dateTime(r.occurredAt) },
                { header: "Hành động", cell: (r) => String(r.action) },
                { header: "Vai trò", cell: (r) => String(r.actorRole) },
                { header: "Lý do", cell: (r) => String(r.reason ?? "—") },
              ]} />
            </Section>
          )}
        </>
      )}
    </ManagePage>
  );
}
