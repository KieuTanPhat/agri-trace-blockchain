"use client";

import { useEffect, useState } from "react";
import {useMutation,useLedgerQuery as useQuery,useLedgerQueryClient as useQueryClient} from "@/lib/ledger/data";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { PenLine } from "lucide-react";
import {newLedgerCommandKey as newIdempotencyKey} from "@/lib/ledger/command-context";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import { fmtAgo, fmtDateTime } from "@/lib/ledger/format";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { useAuth } from "@/lib/auth-store";
import { Button } from "@/components/ledger/ui/button";
import { Checkbox } from "@/components/ledger/ui/checkbox";
import { CommandDialog, CommandForm, useDialog } from "@/components/ledger/kit/command-dialog";
import { TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const composeSchema = z
  .object({ subject: z.string().trim().min(3, { error: () => tr("3–200 ký tự") }).max(200, { error: () => tr("3–200 ký tự") }), body: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(4000), allMembers: z.boolean(), recipientIds: z.array(z.string()) })
  .refine((v) => v.allMembers || v.recipientIds.length > 0, { path: ["recipientIds"], error: () => tr("Chọn ít nhất một người nhận") });
const replySchema = z.object({ body: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(4000) });

export default function MessagesPage() {
  const { can } = useWorkspaceAccess();
  const me = useAuth().user?.id;
  const q = useQuery({ queryKey: ["ws-messages"], queryFn: wapi.messages });
  const members = useQuery({ queryKey: ["ws-members"], queryFn: wapi.members, enabled: can("members.read") });
  const [selectedId, setSelected] = useState<string | null>(null);
  const compose = useDialog();
  const [lockedId,setLockedId]=useState<string|null>(null);
  const items = q.data?.items ?? [];
  const current = items.find((i) => i.id === (lockedId ?? selectedId)) ?? items[0];
  return (
    <>
      <PageHeader
        title={tr("Thông báo nội bộ")}
        description={tr("Thông báo giữa các thành viên doanh nghiệp. Người có quyền quản lý thành viên gửi thông báo mới; mọi người nhận đều trả lời được.")}
        actions={
          q.data?.canSend && (
            <Button size="sm" disabled={!!lockedId} onClick={() => compose.open(true)}>
              <PenLine /> {tr("Soạn thông báo")}
            </Button>
          )
        }
      />
      <PageBody wide>
        {q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !q.data ? (
          <LoadingRows />
        ) : !items.length ? (
          <EmptyState title={tr("Chưa có thông báo")} />
        ) : (
          <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,360px)_minmax(0,1fr)]">
            <ul className="divide-y divide-line/70 overflow-hidden rounded-md border border-line bg-card">
              {items.map((i) => (
                <li key={i.id}>
                  <button type="button" disabled={!!lockedId} onClick={() => setSelected(i.id)} className={cn("flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-row-alt", current?.id === i.id && "bg-brand-weak shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-weak")}>
                    <span className="flex items-center justify-between gap-2">
                      <span className={cn("line-clamp-1 text-[13px]", i.unread ? "font-semibold" : "font-medium")}>{i.subject}</span>
                      {i.unread && <span aria-label={tr("Chưa đọc")} className="size-2 shrink-0 rounded-full bg-brand" />}
                    </span>
                    <span className="line-clamp-1 text-[12px] text-ink-2">
                      {i.lastAuthorName}: {i.preview}
                    </span>
                    <span className="text-[11.5px] text-ink-2">
                      {fmtAgo(i.lastMessageAt)} · {i.participants} {tr("người ·")} {i.messages} tin
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {current && <Thread id={current.id} unread={current.unread} onLockChange={locked=>setLockedId(locked?current.id:null)} />}
          </div>
        )}
      </PageBody>
      <CommandDialog
        {...compose.props}
        title={tr("Soạn thông báo")}
        endpoint="POST /enterprise-messages"
        schema={composeSchema}
        defaultValues={{ subject: "", body: "", allMembers: false, recipientIds: [] }}
        submitLabel={tr("Gửi")}
        invalidate={[["ws-messages"]]}
        success={(r) => tr("Đã gửi tới {p0} người", { p0: (r as { recipients: number }).recipients })}
        wide
        run={(v, cmd) => wapi.sendMessage(v.allMembers ? { subject: v.subject, body: v.body, allMembers: true } : { subject: v.subject, body: v.body, recipientIds: v.recipientIds }, cmd)}
      >
        {(f) => (
          <>
            <TextField control={f.control} name="subject" label={tr("Tiêu đề")} max={200} />
            <TextAreaField control={f.control} name="body" label={tr("Nội dung")} max={4000} rows={5} />
            <Controller
              control={f.control}
              name="allMembers"
              render={({ field }) => (
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={field.value} onCheckedChange={(v) => field.onChange(v === true)} /> {tr("Gửi mọi thành viên đang hoạt động")}
                </label>
              )}
            />
            {!f.watch("allMembers") && (
              <Controller
                control={f.control}
                name="recipientIds"
                render={({ field, fieldState }) => (
                  <fieldset className="flex flex-col gap-1.5">
                    <legend className="mb-1 text-[13px] font-medium">{tr("Người nhận")}</legend>
                    <div className="grid max-h-48 gap-1 overflow-y-auto sm:grid-cols-2">
                      {(members.data ?? [])
                        .filter((m) => m.accountStatus === "ACTIVE" && m.id !== me)
                        .map((m) => (
                          <label key={m.id} className="flex items-center gap-2 text-[13px]">
                            <Checkbox checked={field.value.includes(m.id)} onCheckedChange={(on) => field.onChange(on ? [...field.value, m.id] : field.value.filter((x: string) => x !== m.id))} />
                            {m.fullName}
                          </label>
                        ))}
                    </div>
                    {fieldState.error && <span className="text-[12px] text-danger">{fieldState.error.message}</span>}
                  </fieldset>
                )}
              />
            )}
          </>
        )}
      </CommandDialog>
    </>
  );
}

function Thread({ id, unread, onLockChange }: { id: string; unread: boolean;onLockChange:(locked:boolean)=>void }) {
  const qc = useQueryClient();
  const q = useQuery({ queryKey: ["ws-message", id], queryFn: () => wapi.message(id) });
  const read = useMutation({ mutationFn: () => wapi.readMessage(id, { idempotencyKey: newIdempotencyKey() }), onSuccess: () => qc.invalidateQueries({ queryKey: ["ws-messages"] }) });
  const markRead = read.mutate;
  useEffect(() => {
    if (unread) markRead();
  }, [id, unread, markRead]);
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const t = q.data;
  return (
    <section className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-card">
      <header className="border-b border-line px-5 py-4">
        <h2 className="text-[17px] font-semibold">{t.subject}</h2>
        <p className="text-[12px] text-ink-2">{t.participants.map((p) => p.fullName).join(", ")}</p>
      </header>
      <ol className="flex flex-col gap-3 px-5 py-4">
        {t.messages.map((m) => (
          <li key={m.id} className={cn("flex max-w-[85%] flex-col gap-1 rounded-md px-3.5 py-2.5 text-[13px]", m.mine ? "self-end bg-brand-weak" : "self-start bg-sunken")}>
            <span className="text-[11.5px] text-ink-2">
              <span className="font-medium text-ink">{m.authorName}</span> · <span className="font-mono">{fmtDateTime(m.createdAt)}</span>
            </span>
            <p className="leading-relaxed whitespace-pre-line">{m.body}</p>
          </li>
        ))}
      </ol>
      <div className="border-t border-line bg-row-alt/60 px-5 py-4">
        <CommandForm onLockChange={onLockChange} key={id} title={tr("Trả lời")} endpoint={`POST /enterprise-messages/${id}/replies`} schema={replySchema} defaultValues={{ body: "" }} submitLabel={tr("Gửi trả lời")} invalidate={[["ws-message", id], ["ws-messages"]]} run={(v, cmd) => wapi.replyMessage(id, v, cmd)}>
          {(f) => <TextAreaField control={f.control} name="body" label={tr("Nội dung")} max={4000} rows={3} />}
        </CommandForm>
      </div>
    </section>
  );
}
