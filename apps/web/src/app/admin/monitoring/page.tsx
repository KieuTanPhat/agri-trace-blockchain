"use client";

import { useWorkspaceData } from "@/lib/workspace";
import { DataTable, LoadState, ManagePage, Metrics, PageHeader, ReloadButton, Section } from "@/components/manage";
import { dateTime, type RecordOf, type Row } from "@/lib/platform-admin";

type Monitoring = { generatedAt: string; api: Record<string, number | string>; activeSessions: number; checks: Row[] };
const statusText: Record<string, string> = { OK: "Bình thường", SLOW: "Chậm", WARN: "Cần theo dõi", ALERT: "Cần xử lý" };
const statusClass: Record<string, string> = { OK: "admin-check-ok", SLOW: "admin-check-warn", WARN: "admin-check-warn", ALERT: "admin-check-alert" };

/** API, database, worker and queue health. Read-only. */
export default function MonitoringPage() {
  const state = useWorkspaceData<RecordOf<Monitoring>>("/platform-admin/monitoring");
  const m = state.data?.record;
  return (
    <ManagePage>
      <PageHeader title="Giám sát API & dịch vụ" description="Độ trễ cơ sở dữ liệu, lệnh treo, hàng đợi blockchain, email và worker binding." actions={<ReloadButton onClick={state.reload} />} />
      <LoadState loading={state.loading} error={state.error} />
      {m && (
        <>
          <Metrics
            label="API"
            items={[
              { label: "Thời gian chạy", value: `${Math.floor(Number(m.api.uptimeSeconds) / 3600)} giờ` },
              { label: "Bộ nhớ heap", value: `${m.api.heapUsedMb} MB` },
              { label: "Phiên đăng nhập hoạt động", value: m.activeSessions },
              { label: "Node.js", value: String(m.api.node) },
            ]}
          />
          <Section title="Kiểm tra dịch vụ">
            <DataTable
              label="Kiểm tra dịch vụ"
              rows={m.checks}
              rowKey={(r) => String(r.name)}
              columns={[
                { header: "Hạng mục", cell: (r) => String(r.name) },
                { header: "Trạng thái", cell: (r) => <span className={statusClass[String(r.status)]}>{statusText[String(r.status)] ?? String(r.status)}</span> },
                { header: "Chi tiết", cell: (r) => String(r.detail) },
              ]}
            />
          </Section>
          <p className="muted">Cập nhật lúc {dateTime(m.generatedAt)}</p>
        </>
      )}
    </ManagePage>
  );
}
