"use client";

import Link from "next/link";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { BarList, CommandState, DataTable, LoadState, ManagePage, Metrics, PageHeader, ReasonAction, ReloadButton, Section } from "@/components/manage";
import { dateTime, type RecordOf, type Row } from "@/lib/platform-admin";

type Overview = { totalQr: number; blocked: Row[]; printsByOrganization: Row[]; scansByDay: Row[] };

/** QR statistics and administrative blocks. Admin never creates labels for an
 * enterprise; a block keeps the page reachable with a public warning. */
export default function QrPage() {
  const state = useWorkspaceData<RecordOf<Overview>>("/platform-admin/qr");
  const command = useWorkspaceCommand();
  const data = state.data?.record;
  const active = data?.blocked.filter((b) => !b.unblockedAt) ?? [];
  return (
    <ManagePage>
      <PageHeader
        title="Quản lý mã QR"
        description="Thống kê in tem, lượt quét ẩn danh và khóa mã QR vi phạm. Khóa mới đặt từ trang Tra cứu lô; cần người thứ hai duyệt khi bật phê duyệt hai bước."
        actions={<><Link className="button secondary" href="/admin/lots">Tra cứu lô để khóa</Link><ReloadButton onClick={state.reload} /></>}
      />
      <LoadState loading={state.loading} error={state.error} />
      <CommandState command={command} />
      {data && (
        <>
          <Metrics
            label="Mã QR"
            items={[
              { label: "Mã QR đã phát hành", value: data.totalQr },
              { label: "Đang khóa", value: active.length },
              { label: "Lượt quét 30 ngày", value: data.scansByDay.reduce((a, d) => a + Number(d.scans), 0) },
              { label: "Doanh nghiệp in tem", value: data.printsByOrganization.length },
            ]}
          />
          <div className="admin-grid-2">
            <Section title="Lượt quét theo ngày (30 ngày)">
              <BarList label="Lượt quét" rows={data.scansByDay.map((d) => ({ label: String(d.day), value: Number(d.scans) }))} />
            </Section>
            <Section title="Tem đã in theo doanh nghiệp">
              <BarList label="Tem đã in" rows={data.printsByOrganization.slice(0, 15).map((p) => ({ label: String(p.organizationName), value: Number(p.copies) }))} />
            </Section>
          </div>
          <Section title="Mã QR bị khóa">
            <DataTable
              label="Mã QR bị khóa"
              rows={data.blocked}
              rowKey={(r) => String(r.id)}
              empty={{ title: "Không có mã bị khóa", description: "Khóa mã khi phát hiện tem giả hoặc lưu hành sai." }}
              columns={[
                { header: "Lô", cell: (r) => <><strong>{String(r.lotCode)}</strong><br /><small>{String(r.productName)} · {String(r.organizationName)}</small></> },
                { header: "Lý do", cell: (r) => String(r.reason) },
                { header: "Cảnh báo công khai", cell: (r) => String(r.publicMessage) },
                { header: "Khóa lúc", cell: (r) => dateTime(r.blockedAt) },
                {
                  header: "Trạng thái",
                  cell: (r) =>
                    r.unblockedAt ? (
                      `Đã mở ${dateTime(r.unblockedAt)}`
                    ) : (
                      <ReasonAction
                        label="Mở khóa"
                        disabled={command.pending}
                        onSubmit={async (reason) => {
                          const done = await command.run(`/platform-admin/qr-blocks/${r.id}/unblock`, { version: r.version, reason });
                          if (done !== false) state.reload();
                          return done;
                        }}
                      />
                    ),
                },
              ]}
            />
          </Section>
        </>
      )}
    </ManagePage>
  );
}
