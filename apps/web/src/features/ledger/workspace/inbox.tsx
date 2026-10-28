"use client";
import Link from "next/link";
import { z } from "zod";
import type { components } from "@/lib/generated/api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { ledgerRequest } from "@/lib/ledger/request";
import { wapi } from "@/lib/ledger/workspace-api";
import { useWorkspaceAccess, useOverview } from "@/lib/ledger/workspace-context";
import { t } from "@/lib/ledger/i18n";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { TextAreaField } from "@/components/ledger/kit/form-fields";
import { DataTable } from "@/components/ledger/kit/data-table";
import { PageHeader, PageBody, Section, StatRow, Stat, ErrorState, LoadingRows } from "@/components/ledger/kit/page";
import { Button } from "@/components/ledger/ui/button";
type Case = components["schemas"]["EnterpriseCaseDto"];
const schema = z.object({ note: z.string().trim().min(1).max(2000) });
const transferTask = z.object({ transferId: z.string(), action: z.string(), status: z.string(), origin: z.string(), destination: z.string(), role: z.string() });
const stockTask = z.object({ lotId: z.string(), lotCode: z.string(), productName: z.string(), kind: z.string(), held: z.string(), quarantined: z.string(), unit: z.string() });
export default function Inbox() {
  const { can } = useWorkspaceAccess();
  const overview = useOverview();
  const tasks = useLedgerQuery({ queryKey: ["distribution-tasks"], queryFn: wapi.distributionTasks, enabled: can("distribution.read") || can("inventory.manage") || can("quarantine.manage") });
  const cases = useLedgerQuery({ queryKey: ["ws-cases"], queryFn: wapi.cases, enabled: can("cases.read") });
  const action = useDialog<{ record: Case; kind: "ACKNOWLEDGE" | "RESPOND" }>();
  const transferRows = tasks.data?.transfers.map(row => transferTask.parse(row));
  const stockRows = tasks.data?.stock.map(row => stockTask.parse(row));
  return <><PageHeader title={t("Hộp việc doanh nghiệp")}/><PageBody>{overview.error ? <ErrorState error={overview.error} onRetry={() => overview.refetch()}/> : !overview.data ? <LoadingRows/> : <>
    <Section title={t("Giao nhận & tồn kho")}><StatRow>{Object.entries(tasks.data?.counts ?? {}).map(([key, value]) => <Stat key={key} label={key} value={value}/>)}</StatRow>{tasks.error && <ErrorState error={tasks.error} onRetry={() => tasks.refetch()}/>}<Link className="block p-4 text-brand" href="/distribution">{t("Mở giao nhận")}</Link><Link className="block px-4 pb-4 text-brand" href="/enterprise/inventory">{t("Xem tồn kho")}</Link></Section>
    {tasks.data && <><Section title={t("Việc giao nhận đang chờ")}><DataTable rows={transferRows} rowKey={row => row.transferId + row.action} href={row => `/distribution/${row.transferId}`} columns={[{key:"action",header:t("Thao tác"),cell:row=>row.action},{key:"origin",header:t("Điểm đi"),cell:row=>row.origin},{key:"destination",header:t("Điểm đến"),cell:row=>row.destination},{key:"status",header:t("Trạng thái"),cell:row=>row.status}]}/></Section><Section title={t("Cảnh báo tồn kho")}><DataTable rows={stockRows} rowKey={row=>row.lotId} href={row=>`/lots/${row.lotId}`} columns={[{key:"lot",header:t("Lô"),cell:row=>row.lotCode},{key:"warning",header:t("Cảnh báo"),cell:row=>row.kind},{key:"held",header:t("Đang giữ"),cell:row=>`${row.held} ${row.unit}`},{key:"quarantine",header:t("Cách ly"),cell:row=>`${row.quarantined} ${row.unit}`}]}/></Section></>}
    {can("cases.read") && <Section title={t("Sự cố được giao")}><DataTable rows={cases.data} loading={cases.isLoading} error={cases.error} onRetry={() => cases.refetch()} rowKey={r => r.id} columns={[{ key: "title", header: t("Hồ sơ"), cell: r => r.title },{ key: "status", header: t("Trạng thái"), cell: r => r.status },{ key: "actions", header: t("Thao tác"), cell: r => can("cases.respond") && <div className="flex gap-2">{(["ACKNOWLEDGE", "RESPOND"] as const).filter(kind => r.allowedActions.includes(kind)).map(kind => <Button key={kind} size="xs" onClick={() => action.open({ record: r, kind })}>{t(kind === "ACKNOWLEDGE" ? "Tiếp nhận" : "Phản hồi")}</Button>)}</div> }]}/></Section>}
  </>}
  <CommandDialog {...action.props} title={t(action.target?.kind === "ACKNOWLEDGE" ? "Tiếp nhận sự cố" : "Phản hồi sự cố")} endpoint="POST /enterprise-cases/:id/:action" schema={schema} defaultValues={{ note: "" }} version={action.target?.record.version} submitLabel={t("Gửi")} invalidate={[["ws-cases"]]} run={(value, cmd) => ledgerRequest(`/enterprise-cases/${action.target!.record.id}/${action.target!.kind === "ACKNOWLEDGE" ? "acknowledge" : "respond"}`, { method: "POST", headers: { "Idempotency-Key": cmd.idempotencyKey }, body: JSON.stringify({ version: action.target!.record.version, note: value.note }) })}>{form => <TextAreaField control={form.control} name="note" label={t("Nội dung")}/>}</CommandDialog>
  </PageBody></>;
}
