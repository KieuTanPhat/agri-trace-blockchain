"use client";

import {useRouter} from "next/navigation";
import type {Ticket} from "@/lib/ledger/support-api";
import { useState } from "react";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import { z } from "zod";
import { Plus } from "lucide-react";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import { fmtAgo, fmtDateTime, fmtDue } from "@/lib/ledger/format";
import { Button } from "@/components/ledger/ui/button";
import { CommandDialog, CommandForm, useDialog } from "@/components/ledger/kit/command-dialog";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Due, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const createSchema = z.object({
  subject: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(200),
  body: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(4000),
  category: z.enum(["ACCOUNT", "BILLING", "TECHNICAL", "TRACEABILITY", "BLOCKCHAIN", "PROCESSING", "OTHER"]),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
});
const replySchema = z.object({ body: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(4000) });
const CATEGORY: Record<string, string> = { get ACCOUNT() { return tr("Tài khoản"); }, get BILLING() { return tr("Thanh toán"); }, get TECHNICAL() { return tr("Kỹ thuật"); }, get TRACEABILITY() { return tr("Truy xuất"); }, BLOCKCHAIN: "Blockchain", get PROCESSING() { return tr("Chế biến"); }, get OTHER() { return tr("Khác"); } };

export default function SupportPage({ticketId,createNew=false}:{ticketId?:string;createNew?:boolean}) {
 const router=useRouter();
  const q = useQuery({ queryKey: ["ws-tickets"], queryFn: wapi.tickets });
  const [selectedId, setSelected] = useState<string | null>(ticketId ?? null);
  const create = useDialog();
  const [lockedTicket,setLockedTicket]=useState<Ticket|null>(null);
  const rows = q.data ?? [];
  const current = lockedTicket ?? rows.find((t) => t.id === selectedId) ?? rows[0];
  return (
    <>
      <PageHeader
        title={tr("Hỗ trợ từ nền tảng")}
        description={tr("Gửi yêu cầu tới đội ngũ AgriTrace. Hạn phản hồi tính theo mức ưu tiên.")}
        actions={
          <Button size="sm" disabled={!!lockedTicket} onClick={() => router.push("/enterprise/support/new")}>
            <Plus /> {tr("Gửi yêu cầu")}
          </Button>
        }
      />
      <PageBody wide>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : !rows.length ? (
          <EmptyState title={tr("Chưa có yêu cầu hỗ trợ")} />
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <ul className="divide-y divide-line/70 overflow-hidden rounded-md border border-line bg-card">
              {rows.map((t) => (
                <li key={t.id}>
                  <button type="button" disabled={!!lockedTicket} onClick={() => {setSelected(t.id);router.push(`/enterprise/support/${t.id}`);}} className={cn("flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-row-alt", current?.id === t.id && "bg-brand-weak shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-weak")}>
                    <span className="flex items-center justify-between gap-2 text-[12px]">
                      <span className="font-mono text-ink-2">{t.code}</span>
                      <Status group="ticket" value={t.status} />
                    </span>
                    <span className="line-clamp-1 text-[13px] font-medium">{t.subject}</span>
                    <span className="text-[11.5px] text-ink-2">{fmtAgo(t.createdAt)}</span>
                  </button>
                </li>
              ))}
            </ul>
            {current && (
              <section className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-card">
                <header className="flex flex-col gap-1 border-b border-line px-5 py-4">
                  <span className="font-mono text-[12px] text-ink-2">
                    {current.code} · {CATEGORY[current.category] ?? current.category}
                  </span>
                  <h2 className="text-[17px] font-semibold">{current.subject}</h2>
                  <span className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                    <Status group="priority" value={current.priority} /> {tr("Phụ trách:")} {current.assigneeName ?? tr("chưa gán")}
                    {!["RESOLVED", "CLOSED"].includes(current.status) && <Due overdue={current.overdue}>{fmtDue(current.dueAt).text}</Due>}
                  </span>
                </header>
                <ol className="flex flex-col gap-3 px-5 py-4">
                  {current.messages.map((m) => (
                    <li key={m.id} className={cn("flex max-w-[85%] flex-col gap-1 rounded-md px-3.5 py-2.5 text-[13px]", m.authorSide === "ENTERPRISE" ? "self-end bg-brand-weak" : "self-start bg-sunken")}>
                      <span className="text-[11.5px] text-ink-2">
                        <span className="font-medium text-ink">{m.authorSide === "PLATFORM" ? "AgriTrace" : m.authorName}</span> · <span className="font-mono">{fmtDateTime(m.createdAt)}</span>
                      </span>
                      <p className="leading-relaxed whitespace-pre-line">{m.body}</p>
                    </li>
                  ))}
                </ol>
                {current.status === "CLOSED" ? (
                  <div className="border-t border-line px-5 py-4">
                    <Callout>{tr("Yêu cầu đã đóng:")} {current.resolution}</Callout>
                  </div>
                ) : (
                  <div className="border-t border-line bg-row-alt/60 px-5 py-4">
                    <CommandForm onLockChange={locked=>setLockedTicket(locked?current:null)} key={current.id} title={tr("Trả lời")} endpoint={`POST /enterprise-support/tickets/${current.id}/reply`} schema={replySchema} defaultValues={{ body: "" }} version={current.version} submitLabel={tr("Gửi")} invalidate={[["ws-tickets"], ["tickets"]]} run={(v, cmd) => wapi.replyTicket(current.id, { body: v.body, version: current.version }, cmd)}>
                      {(f) => <TextAreaField control={f.control} name="body" label={tr("Nội dung")} max={4000} rows={3} />}
                    </CommandForm>
                  </div>
                )}
              </section>
            )}
          </div>
        )}
      </PageBody>
      <CommandDialog
        {...create.props} open={createNew || create.props.open} onOpenChange={o=>{create.props.onOpenChange(o);if(!o && createNew)router.push("/enterprise/support");}} onDone={()=>router.push("/enterprise/support")}
        title={tr("Gửi yêu cầu hỗ trợ")}
        endpoint="POST /enterprise-support/tickets"
        schema={createSchema}
        defaultValues={{ subject: "", body: "", category: "TECHNICAL", priority: "NORMAL" }}
        submitLabel={tr("Gửi yêu cầu")}
        invalidate={[["ws-tickets"], ["tickets"], ["inbox"]]}
        wide
        run={(v, cmd) => wapi.createTicket(v, cmd)}
      >
        {(f) => (
          <>
            <TextField control={f.control} name="subject" label={tr("Tiêu đề")} max={200} />
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField control={f.control} name="category" label={tr("Chủ đề")} options={Object.entries(CATEGORY).map(([value, label]) => ({ value, label }))} />
              <SelectField control={f.control} name="priority" label={tr("Ưu tiên")} options={[{ value: "LOW", label: tr("Thấp") }, { value: "NORMAL", label: tr("Bình thường") }, { value: "HIGH", label: "Cao" }, { value: "URGENT", label: tr("Khẩn") }]} />
            </div>
            <TextAreaField control={f.control} name="body" label={tr("Mô tả")} max={4000} rows={5} />
          </>
        )}
      </CommandDialog>
    </>
  );
}
