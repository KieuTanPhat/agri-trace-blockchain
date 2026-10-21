"use client";

import { useWorkspaceData } from "@/lib/workspace";
import { BarList, LoadState, ManagePage, Metrics, PageHeader, ReloadButton, Section } from "@/components/manage";
import type { RecordOf, Row } from "@/lib/platform-admin";

type Stats = { months: Row[]; totals: Record<string, number> };

/** Platform growth over twelve months. */
export default function StatisticsPage() {
  const state = useWorkspaceData<RecordOf<Stats>>("/platform-admin/statistics");
  const s = state.data?.record;
  const series = (key: string) => (s?.months ?? []).map((m) => ({ label: String(m.month), value: Number(m[key]) }));
  return (
    <ManagePage>
      <PageHeader title="Thống kê nền tảng" description="Tăng trưởng doanh nghiệp, lô, lệnh chế biến, lượt quét QR và yêu cầu hỗ trợ trong 12 tháng." actions={<ReloadButton onClick={state.reload} />} />
      <LoadState loading={state.loading} error={state.error} />
      {s && (
        <>
          <Metrics
            label="Tổng"
            items={[
              { label: "Tổ chức", value: s.totals.organizations, href: "/admin/directory" },
              { label: "Tài khoản hoạt động", value: s.totals.users, href: "/admin/users" },
              { label: "Chuỗi truy xuất", value: s.totals.chains, href: "/admin/chains" },
              { label: "Lô", value: s.totals.lots, href: "/admin/lots" },
              { label: "Sự kiện truy xuất", value: s.totals.events, href: "/admin/trace-report" },
            ]}
          />
          <div className="admin-grid-2">
            <Section title="Doanh nghiệp mới"><BarList label="Doanh nghiệp mới" rows={series("organizations")} /></Section>
            <Section title="Lô tạo mới"><BarList label="Lô tạo mới" rows={series("lots")} /></Section>
            <Section title="Lệnh chế biến hoàn tất"><BarList label="Lệnh chế biến" rows={series("processingRuns")} /></Section>
            <Section title="Lượt quét QR"><BarList label="Lượt quét" rows={series("scans")} /></Section>
            <Section title="Yêu cầu hỗ trợ"><BarList label="Yêu cầu hỗ trợ" rows={series("tickets")} /></Section>
          </div>
        </>
      )}
    </ManagePage>
  );
}
