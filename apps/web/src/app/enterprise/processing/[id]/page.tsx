"use client";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { CommandState, DataTable, DetailList, LoadState, ManagePage, PageHeader, ReasonAction, ReloadButton, Section, StatusBadge } from "@/components/manage";
import { dateTime, label, lossReasonLabels, processTypeLabels, runStatusLabels, type RecordOf, type Row } from "@/lib/platform-admin";

/** One processing run. Completing it is atomic: inputs are consumed, output lots
 * with QR codes are created and hashed events are queued for the ledger. */
export default function ProcessingRunPage() {
  const { id } = useParams<{ id: string }>();
  const state = useWorkspaceData<RecordOf<Row>>(`/processing-runs/${id}`);
  const command = useWorkspaceCommand();
  const run = state.data?.record;
  async function complete() {
    if (!run) return;
    if ((await command.run(`/processing-runs/${id}/complete`, { version: run.version })) !== false) state.reload();
  }
  return (
    <ManagePage>
      <PageHeader back="/enterprise/processing" title={run ? `Lệnh ${run.code}` : "Lệnh chế biến"} actions={<ReloadButton onClick={state.reload} />} />
      <LoadState loading={state.loading} error={state.error} />
      <CommandState command={command} />
      {run && (
        <>
          <Section
            title="Thông tin lệnh"
            actions={
              run.status === "DRAFT" && (
                <div className="actions">
                  <Button type="button" className="button" disabled={command.pending} onClick={() => void complete()}>Hoàn tất chế biến</Button>
                  <ReasonAction label="Hủy lệnh" danger disabled={command.pending} onSubmit={async (reason) => {
                    const done = await command.run(`/processing-runs/${id}/cancel`, { version: run.version, reason });
                    if (done !== false) state.reload();
                    return done;
                  }} />
                </div>
              )
            }
          >
            <DetailList
              items={[
                ["Trạng thái", <StatusBadge key="s" value={run.status === "COMPLETED" ? "ACTIVE" : run.status === "CANCELLED" ? "CANCELLED" : "PENDING_REVIEW"} label={label(runStatusLabels, run.status)} />],
                ["Loại chế biến", label(processTypeLabels, run.processType)],
                ["Chuỗi", String(run.chainName)],
                ["Quy trình", String(run.recipe ?? "—")],
                ["Đơn vị cơ sở", String(run.baseUnit)],
                ["Cân bằng", run.inputTotal ? `${run.inputTotal} = ${run.outputTotal} + ${run.lossTotal} (sai lệch ${run.variancePercent}%)` : "Tính khi hoàn tất"],
                ["Tạo lúc", dateTime(run.createdAt)],
                ["Hoàn tất", dateTime(run.completedAt)],
                ...(run.cancelReason ? ([["Lý do hủy", String(run.cancelReason)]] as [string, string][]) : []),
              ]}
            />
            {run.status === "DRAFT" && <p className="muted">Khi hoàn tất, hệ thống kiểm tra lại tồn tại cơ sở, trạng thái lô (không hết hạn/thu hồi) và cân bằng khối lượng.</p>}
          </Section>
          <Section title="Nguyên liệu đầu vào">
            <DataTable label="Đầu vào" rows={run.inputs as Row[]} rowKey={(r) => String(r.lotId)} columns={[
              { header: "Lô", cell: (r) => <><strong>{String(r.lotCode)}</strong><br /><small>{String(r.productName)}</small></> },
              { header: "Nguồn", cell: (r) => String(r.sourceOrganization) },
              { header: "Lượng dùng", cell: (r) => `${r.quantity} ${r.unit}` },
              { header: "Còn tại cơ sở", cell: (r) => (r.availableQuantity == null ? "—" : `${r.availableQuantity} ${r.unit}`) },
            ]} />
          </Section>
          <Section title="Thành phẩm và phụ phẩm">
            <DataTable label="Đầu ra" rows={run.outputs as Row[]} rowKey={(r) => String(r.id)} columns={[
              { header: "Sản phẩm", cell: (r) => `${r.productName}${r.kind === "BY_PRODUCT" ? " (phụ phẩm)" : ""}` },
              { header: "Lượng", cell: (r) => `${r.quantity} ${r.unit}${r.unit !== run.baseUnit ? ` ≈ ${r.baseQuantity} ${run.baseUnit}` : ""}` },
              { header: "Quy cách", cell: (r) => `${r.packaging ?? "—"}${r.packageCount ? ` × ${r.packageCount}` : ""}` },
              { header: "Hạn dùng", cell: (r) => String(r.expiryDate ?? "—") },
              { header: "Lô tạo ra", cell: (r) => (r.lotId ? <>{String(r.lotCode)} {r.traceToken ? <Link href={`/trace/${r.traceToken}`}>· Trang QR</Link> : null}</> : "Tạo khi hoàn tất") },
            ]} />
          </Section>
          {(run.losses as Row[]).length > 0 && (
            <Section title="Hao hụt">
              <DataTable label="Hao hụt" rows={run.losses as Row[]} rowKey={(r) => `${r.reason}-${r.quantity}`} columns={[
                { header: "Lý do", cell: (r) => label(lossReasonLabels, r.reason) },
                { header: "Lượng", cell: (r) => `${r.quantity} ${run.baseUnit}` },
                { header: "Ghi chú", cell: (r) => String(r.note ?? "—") },
              ]} />
            </Section>
          )}
        </>
      )}
    </ManagePage>
  );
}
