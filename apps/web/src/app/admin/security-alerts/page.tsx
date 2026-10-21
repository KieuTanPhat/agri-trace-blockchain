"use client";

import Link from "next/link";
import { useWorkspaceData } from "@/lib/workspace";
import { DataTable, LoadState, ManagePage, Metrics, PageHeader, ReloadButton, Section } from "@/components/manage";
import { dateTime, type RecordOf, type Row } from "@/lib/platform-admin";

type Alerts = { lockedAccounts: Row[]; repeatedFailures: Row[]; adminsWithoutMfa: Row[]; deniedActions: Row[]; sensitiveActions: Row[] };

const auditColumns = [
  { header: "Thời điểm", cell: (r: Row) => dateTime(r.occurredAt) },
  { header: "Hành động", cell: (r: Row) => String(r.action) },
  { header: "Vai trò", cell: (r: Row) => String(r.actorRole) },
  { header: "Đối tượng", cell: (r: Row) => String(r.subjectType) },
  { header: "Lý do", cell: (r: Row) => String(r.reason ?? "—") },
];

/** Locked accounts, repeated failures, administrators without MFA and the
 * last week's denied and sensitive actions from the hash-chained audit log. */
export default function SecurityAlertsPage() {
  const state = useWorkspaceData<RecordOf<Alerts>>("/platform-admin/security");
  const a = state.data?.record;
  return (
    <ManagePage>
      <PageHeader
        title="Cảnh báo bảo mật"
        description="Tài khoản bị khóa, đăng nhập sai nhiều lần, quản trị viên chưa bật MFA và thao tác nhạy cảm/bị từ chối 7 ngày qua."
        actions={<><Link className="button secondary" href="/admin/security">Bảo mật tài khoản của tôi</Link><ReloadButton onClick={state.reload} /></>}
      />
      <LoadState loading={state.loading} error={state.error} />
      {a && (
        <>
          <Metrics
            label="Cảnh báo"
            items={[
              { label: "Tài khoản đang khóa", value: a.lockedAccounts.length },
              { label: "Đăng nhập sai ≥ 3 lần", value: a.repeatedFailures.length },
              { label: "Quản trị chưa bật MFA", value: a.adminsWithoutMfa.length },
              { label: "Thao tác bị từ chối (7 ngày)", value: a.deniedActions.length },
            ]}
          />
          <div className="admin-grid-2">
            <Section title="Quản trị viên chưa bật MFA">
              <DataTable label="Chưa bật MFA" rows={a.adminsWithoutMfa} rowKey={(r) => String(r.id)} empty={{ title: "Tất cả đã bật MFA", description: "Không có cảnh báo." }} columns={[
                { header: "Email", cell: (r) => <Link href={`/admin/users/${r.id}`}>{String(r.email)}</Link> },
                { header: "Vai trò", cell: (r) => String(r.role) },
              ]} />
            </Section>
            <Section title="Tài khoản bị khóa / đăng nhập sai">
              <DataTable label="Tài khoản rủi ro" rows={[...a.lockedAccounts, ...a.repeatedFailures.filter((f) => !a.lockedAccounts.some((l) => l.id === f.id))]} rowKey={(r) => String(r.id)} empty={{ title: "Không có", description: "Không có tài khoản bị khóa." }} columns={[
                { header: "Email", cell: (r) => <Link href={`/admin/users/${r.id}`}>{String(r.email)}</Link> },
                { header: "Sai liên tiếp", cell: (r) => String(r.failedLoginCount ?? "—") },
                { header: "Khóa đến", cell: (r) => dateTime(r.lockedUntil) },
              ]} />
            </Section>
          </div>
          <Section title="Thao tác bị từ chối"><DataTable label="Bị từ chối" rows={a.deniedActions} rowKey={(r) => String(r.sequence)} empty={{ title: "Không có", description: "Không có thao tác bị từ chối." }} columns={auditColumns} /></Section>
          <Section title="Thao tác nhạy cảm"><DataTable label="Nhạy cảm" rows={a.sensitiveActions} rowKey={(r) => String(r.sequence)} empty={{ title: "Không có", description: "Không có thao tác nhạy cảm." }} columns={auditColumns} /></Section>
        </>
      )}
    </ManagePage>
  );
}
