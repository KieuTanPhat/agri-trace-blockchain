"use client";

import Link from "next/link";
import { useWorkspaceData } from "@/lib/workspace";
import {
  BarList,
  DataTable,
  LoadState,
  ManagePage,
  Metrics,
  OverviewChart,
  PageHeader,
  ReloadButton,
  Section,
} from "@/components/manage";
import {
  capabilityLabels,
  dateTime,
  inboxKindLabels,
  label,
  money,
  participationLabels,
  shortDate,
  type RecordOf,
  type Row,
} from "@/lib/platform-admin";

type Dashboard = {
  generatedAt: string;
  organizations: Record<string, Record<string, number>>;
  pending: Record<string, number>;
  billing: {
    active: number;
    grace: number;
    restricted: number;
    expiringSoon: Row[];
    monthRevenue: number;
    monthSimulated: number;
    outstanding: number;
  };
  traceability: Record<string, number>;
  ledger: {
    outbox: Record<string, number>;
    proofs: Record<string, number>;
    unresolvedHolds: number;
    lastConfirmedAt: string | null;
  };
  security: { lockedAccounts: number; adminsWithoutMfa: number; admins: number };
  recentActivity: Row[];
  notices: Row[];
};

/** Platform dashboard: what waits on administrators, how the network and the
 * business are doing, and the latest audited activity. */
export default function AdminDashboardPage() {
  const state = useWorkspaceData<RecordOf<Dashboard>>("/platform-admin/dashboard");
  const d = state.data?.record;
  const pendingItems = d
    ? Object.entries(d.pending)
        .filter(([key, value]) => key !== "total" && key !== "overdue" && value > 0)
        .map(([key, value]) => ({ label: label(inboxKindLabels, key), value }))
    : [];
  return (
    <ManagePage>
      <PageHeader
        title="Dashboard hệ thống"
        description="Tình trạng nền tảng, công việc chờ xử lý và hoạt động gần đây. Quản trị chỉ điều phối; mọi ghi nghiệp vụ lô, giao nhận thuộc doanh nghiệp."
        actions={<ReloadButton onClick={state.reload} />}
      />
      <LoadState loading={state.loading} error={state.error} />
      {d && (
        <>
          <Metrics
            label="Công việc cần xử lý"
            items={[
              { label: "Việc chờ xử lý", value: d.pending.total, href: "/admin/inbox", hint: `${d.pending.overdue} việc quá hạn` },
              { label: "Hồ sơ đăng ký", value: d.pending.ENROLLMENT, href: "/admin/enterprises" },
              { label: "Năng lực chờ duyệt", value: d.pending.CAPABILITY, href: "/admin/inbox" },
              { label: "Báo cáo vi phạm mới", value: d.pending.CONSUMER_REPORT, href: "/admin/reports" },
              { label: "Yêu cầu hỗ trợ mở", value: d.pending.TICKET, href: "/admin/support" },
              { label: "Phê duyệt hai bước", value: d.pending.APPROVAL, href: "/admin/approvals" },
            ]}
          />
          {pendingItems.length > 0 && (
            <OverviewChart title="Hàng đợi" description="Số việc hiện tại theo loại" items={pendingItems} />
          )}
          <div className="admin-grid-2">
            <Section title="Doanh nghiệp tham gia" help="Theo năng lực đã được cấp">
              <BarList
                label="Tổ chức theo năng lực"
                rows={Object.entries(d.organizations.capabilities ?? {}).map(([code, value]) => ({ label: label(capabilityLabels, code), value }))}
              />
              <p className="muted">
                {Object.entries(d.organizations.byModel ?? {})
                  .map(([model, n]) => `${label(participationLabels, model)}: ${n}`)
                  .join(" · ")}
                {" · "}Ngừng hoạt động: {d.organizations.byStatus?.INACTIVE ?? 0}
              </p>
              <Link className="manage-section-footer" href="/admin/directory">Danh sách doanh nghiệp</Link>
            </Section>
            <Section title="Dịch vụ & doanh thu tháng này">
              <Metrics
                label="Gói dịch vụ"
                items={[
                  { label: "Gói hiệu lực", value: d.billing.active, href: "/admin/billing/subscriptions" },
                  { label: "Ân hạn / hạn chế", value: `${d.billing.grace} / ${d.billing.restricted}`, href: "/admin/billing/subscriptions" },
                  { label: "Doanh thu thật", value: money(d.billing.monthRevenue), href: "/admin/billing/revenue" },
                  { label: "Công nợ", value: money(d.billing.outstanding), href: "/admin/billing/invoices" },
                ]}
              />
              {d.billing.monthSimulated > 0 && (
                <p className="muted">Thanh toán mô phỏng tháng này: {money(d.billing.monthSimulated)} (không phải tiền thật).</p>
              )}
              {d.billing.expiringSoon.length > 0 && (
                <DataTable
                  label="Gói sắp hết hạn"
                  rows={d.billing.expiringSoon}
                  rowKey={(r) => String(r.organizationId)}
                  columns={[
                    { header: "Doanh nghiệp", cell: (r) => <Link href={`/admin/directory/${r.organizationId}`}>{String(r.organizationName)}</Link> },
                    { header: "Gói", cell: (r) => String(r.planName) },
                    { header: "Hết hạn", cell: (r) => shortDate(r.endsAt) },
                  ]}
                />
              )}
            </Section>
          </div>
          <div className="admin-grid-2">
            <Section title="Truy xuất nguồn gốc">
              <Metrics
                label="Truy xuất"
                items={[
                  { label: "Tổng số lô", value: d.traceability.lots, href: "/admin/lots" },
                  { label: "Lô thành phẩm chế biến", value: d.traceability.processedLots },
                  { label: "Lệnh chế biến 30 ngày", value: d.traceability.processingRuns30Days },
                  { label: "Lượt quét QR 7 ngày", value: d.traceability.scans7Days, href: "/admin/qr" },
                  { label: "QR đang khóa", value: d.traceability.blockedQr, href: "/admin/qr" },
                ]}
              />
            </Section>
            <Section title="Blockchain & bảo mật">
              <Metrics
                label="Blockchain"
                items={[
                  { label: "Outbox chờ/thử lại", value: (d.ledger.outbox.PENDING ?? 0) + (d.ledger.outbox.RETRY ?? 0), href: "/admin/ledger" },
                  { label: "Lỗi vĩnh viễn", value: d.ledger.outbox.DEAD_LETTER ?? 0, href: "/admin/operations" },
                  { label: "Hold chưa xử lý", value: d.ledger.unresolvedHolds, href: "/admin/operations" },
                  { label: "Admin chưa bật MFA", value: `${d.security.adminsWithoutMfa}/${d.security.admins}`, href: "/admin/security-alerts" },
                ]}
              />
              <p className="muted">Bằng chứng xác nhận gần nhất: {dateTime(d.ledger.lastConfirmedAt)}</p>
            </Section>
          </div>
          {d.notices.length > 0 && (
            <Section title="Thông báo đang hiển thị">
              <ul>
                {d.notices.map((n) => (
                  <li key={String(n.id)}>
                    <strong>{String(n.title)}</strong> — đến {dateTime(n.endsAt)}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          <Section title="Hoạt động gần đây" actions={<Link className="button secondary" href="/admin/audit-log">Nhật ký đầy đủ</Link>}>
            <DataTable
              label="Hoạt động gần đây"
              rows={d.recentActivity}
              rowKey={(r) => String(r.sequence)}
              empty={{ title: "Chưa có hoạt động", description: "Các thao tác quản trị sẽ được ghi tại đây." }}
              columns={[
                { header: "Thời điểm", cell: (r) => dateTime(r.occurredAt) },
                { header: "Hành động", cell: (r) => String(r.action) },
                { header: "Vai trò", cell: (r) => String(r.actorRole) },
                { header: "Đối tượng", cell: (r) => String(r.subjectType) },
                { header: "Kết quả", cell: (r) => String(r.outcome) },
              ]}
            />
          </Section>
          <p className="muted">Cập nhật lúc {dateTime(d.generatedAt)}</p>
        </>
      )}
    </ManagePage>
  );
}
