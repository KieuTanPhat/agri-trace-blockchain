"use client";

import { useState } from "react";
import Link from "next/link";
import { useLedgerSearchParams as useSearchParams } from "@/components/ledger/route-screen";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { api } from "@/lib/ledger/support-api";
import type { Ticket, TicketStatus } from "@/lib/ledger/support-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtAgo, fmtDateTime, fmtDue } from "@/lib/ledger/format";
import { reason } from "@/lib/ledger/platform-schemas";
import { Button } from "@/components/ledger/ui/button";
import {
  CommandDialog,
  CommandForm,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import {
  ChoiceField,
  SelectField,
  TextAreaField,
} from "@/components/ledger/kit/form-fields";
import {
  EmptyState,
  ErrorState,
  LoadingRows,
  PageBody,
  PageHeader,
} from "@/components/ledger/kit/page";
import { Badge, Due, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const replySchema = z.object({
  body: z
    .string()
    .trim()
    .min(2, { error: () => tr("Tối thiểu 2 ký tự") })
    .max(4000),
  mode: z.enum(["SHARED", "INTERNAL"]),
  status: z.enum(["IN_PROGRESS", "WAITING_CUSTOMER", "RESOLVED"]),
});
const assignSchema = z.object({
  assigneeId: z.uuid(),
  priority: z.enum(["LOW", "NORMAL", "HIGH", "URGENT"]),
});
const closeSchema = z.object({ reason: reason() });

export function SupportView({ detailId }: { detailId?: string }) {
  const params = useSearchParams();
  const [lockedTicket, setLockedTicket] = useState<Ticket | null>(null);
  const [status, setStatus] = useState<TicketStatus | "" | "ACTIVE">("");
  const selectedId = detailId ?? params.get("id");
  const q = useQuery({
    queryKey: ["tickets", status],
    queryFn: () =>
      api.support.tickets(
        status === "ACTIVE" ? undefined : status || undefined,
      ),
  });
  const rows = q.data?.filter((t) =>
    status === "ACTIVE"
      ? !["RESOLVED", "CLOSED"].includes(t.status)
      : !status || t.status === status,
  );
  const current =
    lockedTicket ??
    (selectedId ? q.data?.find((t) => t.id === selectedId) : rows?.[0]);
  return (
    <div data-testid="ledger-support-workspace">
      <PageHeader
        title={tr("Yêu cầu hỗ trợ")}
        description={tr(
          "Hạn phản hồi theo support.reviewSlaHours và mức ưu tiên. Ghi chú nội bộ không hiện cho doanh nghiệp; yêu cầu đã đóng không nhận trả lời.",
        )}
      />
      <PageBody wide>
        <div className="flex gap-1 overflow-x-auto">
          {(
            [
              "ACTIVE",
              "OPEN",
              "IN_PROGRESS",
              "WAITING_CUSTOMER",
              "RESOLVED",
              "CLOSED",
              "",
            ] as const
          ).map((s) => (
            <button
              disabled={lockedTicket !== null}
              key={s || "all"}
              type="button"
              onClick={() => setStatus(s)}
              className={cn(
                "h-8 shrink-0 rounded-md border px-3 text-[12.5px] font-medium",
                status === s
                  ? "border-ink bg-ink text-canvas"
                  : "border-line bg-card",
              )}
            >
              {s === "ACTIVE"
                ? tr("Đang mở")
                : s
                  ? {
                      OPEN: tr("Mới"),
                      IN_PROGRESS: tr("Đang xử lý"),
                      WAITING_CUSTOMER: tr("Chờ DN"),
                      RESOLVED: tr("Đã giải quyết"),
                      CLOSED: tr("Đã đóng"),
                    }[s]
                  : tr("Tất cả")}
            </button>
          ))}
        </div>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-md border border-line bg-card">
            {q.error ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !rows ? (
              <LoadingRows />
            ) : !rows.length ? (
              <EmptyState title={tr("Không có yêu cầu")} />
            ) : (
              <ul className="divide-y divide-line/70">
                {rows.map((t) => {
                  const due = fmtDue(t.dueAt);
                  return (
                    <li key={t.id}>
                      <Link
                        aria-disabled={lockedTicket !== null}
                        onClick={(e) => {
                          if (lockedTicket) e.preventDefault();
                        }}
                        href={"/admin/support/" + t.id}
                        className={cn(
                          "flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-row-alt",
                          current?.id === t.id &&
                            "bg-brand-weak shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-weak",
                        )}
                      >
                        <span className="flex items-center justify-between gap-2 text-[12px]">
                          <span className="font-mono text-ink-2">{t.code}</span>
                          <Status group="priority" value={t.priority} />
                        </span>
                        <span className="line-clamp-1 text-[13px] font-medium">
                          {t.subject}
                        </span>
                        <span className="flex items-center justify-between gap-2 text-[12px] text-ink-2">
                          <span className="truncate">{t.organizationName}</span>
                          {!["RESOLVED", "CLOSED"].includes(t.status) ? (
                            <Due overdue={t.overdue}>{due.text}</Due>
                          ) : (
                            <Status group="ticket" value={t.status} />
                          )}
                        </span>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
          {current ? (
            <Thread
              t={current}
              onLockChange={(locked) =>
                setLockedTicket(locked ? current : null)
              }
            />
          ) : detailId && q.data ? (
            <EmptyState title={tr("Không tìm thấy yêu cầu hỗ trợ")} />
          ) : (
            <div />
          )}
        </div>
      </PageBody>
    </div>
  );
}

function Thread({
  t,
  onLockChange,
}: {
  t: Ticket;
  onLockChange: (locked: boolean) => void;
}) {
  const { can } = useSession();
  const staff = useQuery({
    queryKey: ["support-staff"],
    queryFn: api.support.staff,
    enabled: can("tickets.write"),
  });
  const assign = useDialog();
  const close = useDialog();
  const writable = can("tickets.write") && t.status !== "CLOSED";
  const invalidate = [["tickets"], ["inbox"]];
  return (
    <section
      aria-label={tr("Yêu cầu {p0}", { p0: t.code })}
      className="flex min-w-0 flex-col overflow-hidden rounded-md border border-line bg-card"
    >
      <header className="flex flex-col gap-2 border-b border-line px-5 py-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="flex min-w-0 flex-col gap-1">
            <span className="font-mono text-[12px] text-ink-2">
              {t.code} · {t.category}
            </span>
            <h2 className="text-[17px] font-semibold">{t.subject}</h2>
            <span className="text-[13px] text-ink-2">
              <Link
                className="text-brand hover:underline"
                href={`/admin/organizations?organizationId=${t.organizationId}`}
              >
                {t.organizationName}
              </Link>{" "}
              {tr("· mở")} {fmtAgo(t.createdAt)} {tr("· hạn")}{" "}
              {fmtDateTime(t.dueAt)}
            </span>
          </div>
          <div className="flex flex-wrap items-center gap-1.5">
            <Status group="ticket" value={t.status} />
            <Status group="priority" value={t.priority} />
            {t.overdue && (
              <Badge tone="danger" dot={false}>
                {tr("Quá hạn")}
              </Badge>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-[13px]">
          <span className="text-ink-2">{tr("Phụ trách:")}</span>{" "}
          <span className="font-medium">
            {t.assigneeName ?? tr("Chưa gán")}
          </span>
          {writable && (
            <>
              <Button
                size="xs"
                variant="outline"
                onClick={() => assign.open(true)}
              >
                {tr("Gán / đổi ưu tiên")}
              </Button>
              <Button
                size="xs"
                variant="outline"
                onClick={() => close.open(true)}
              >
                {tr("Đóng yêu cầu")}
              </Button>
            </>
          )}
        </div>
      </header>
      <ol className="flex flex-col gap-3 px-5 py-4">
        {t.messages.map((m) => (
          <li
            key={m.id}
            className={cn(
              "flex max-w-[85%] flex-col gap-1 rounded-md px-3.5 py-2.5 text-[13px]",
              m.authorSide === "PLATFORM"
                ? "self-end bg-brand-weak"
                : "self-start bg-sunken",
              m.internal && "border border-dashed border-warn-dot bg-warn-bg",
            )}
          >
            <span className="flex flex-wrap items-center gap-2 text-[11.5px] text-ink-2">
              <span className="font-medium text-ink">
                {m.authorName ??
                  (m.authorSide === "PLATFORM"
                    ? tr("Nền tảng")
                    : tr("Doanh nghiệp"))}
              </span>
              <span className="font-mono">{fmtDateTime(m.createdAt)}</span>
              {m.internal && (
                <span className="font-semibold text-warn">{tr("Nội bộ")}</span>
              )}
            </span>
            <p className="leading-relaxed whitespace-pre-line">{m.body}</p>
          </li>
        ))}
        {t.status === "CLOSED" && (
          <li className="self-center text-[12px] text-ink-2">
            {tr("Đã đóng")} {fmtDateTime(t.closedAt)} · {t.resolution}
          </li>
        )}
      </ol>
      {writable && (
        <div className="border-t border-line bg-row-alt/60 px-5 py-4">
          <CommandForm
            key={t.id}
            onLockChange={onLockChange}
            title={tr("Trả lời")}
            endpoint="POST /platform-admin/tickets/:id/reply"
            schema={replySchema}
            defaultValues={{
              body: "",
              mode: "SHARED",
              status: "WAITING_CUSTOMER",
            }}
            version={t.version}
            submitLabel={tr("Gửi")}
            invalidate={invalidate}
            success={tr("Đã gửi trả lời")}
            run={(v, cmd) =>
              api.support.reply(
                t.id,
                {
                  body: v.body,
                  internal: v.mode === "INTERNAL",
                  status: v.mode === "INTERNAL" ? undefined : v.status,
                  version: t.version,
                },
                cmd,
              )
            }
          >
            {(f) => (
              <>
                <TextAreaField
                  control={f.control}
                  name="body"
                  label={tr("Nội dung")}
                  max={4000}
                  rows={3}
                />
                <div className="grid gap-3 sm:grid-cols-2">
                  <ChoiceField
                    control={f.control}
                    name="mode"
                    label={tr("Gửi tới")}
                    options={[
                      { value: "SHARED", label: tr("Doanh nghiệp") },
                      { value: "INTERNAL", label: tr("Ghi chú nội bộ") },
                    ]}
                  />
                  <SelectField
                    control={f.control}
                    name="status"
                    label={tr("Chuyển trạng thái")}
                    options={[
                      { value: "IN_PROGRESS", label: tr("Đang xử lý") },
                      {
                        value: "WAITING_CUSTOMER",
                        label: tr("Chờ doanh nghiệp"),
                      },
                      { value: "RESOLVED", label: tr("Đã giải quyết") },
                    ]}
                  />
                </div>
              </>
            )}
          </CommandForm>
        </div>
      )}
      <CommandDialog
        {...assign.props}
        title={tr("Gán người phụ trách")}
        endpoint="POST /platform-admin/tickets/:id/assign"
        schema={assignSchema}
        defaultValues={{ assigneeId: t.assigneeId ?? "", priority: t.priority }}
        version={t.version}
        submitLabel={tr("Gán")}
        invalidate={invalidate}
        run={(v, cmd) =>
          api.support.assign(t.id, { ...v, version: t.version }, cmd)
        }
      >
        {(f) => (
          <>
            <SelectField
              control={f.control}
              name="assigneeId"
              label={tr("Người phụ trách")}
              options={(staff.data ?? []).map((s) => ({
                value: s.id,
                label: `${s.fullName} · ${s.role}`,
              }))}
            />
            <SelectField
              control={f.control}
              name="priority"
              label={tr("Ưu tiên")}
              options={[
                { value: "LOW", label: tr("Thấp") },
                { value: "NORMAL", label: tr("Bình thường") },
                { value: "HIGH", label: "Cao" },
                { value: "URGENT", label: tr("Khẩn") },
              ]}
            />
          </>
        )}
      </CommandDialog>
      <CommandDialog
        {...close.props}
        title={tr("Đóng {p0}", { p0: t.code })}
        endpoint="POST /platform-admin/tickets/:id/close"
        description={tr("Yêu cầu đã đóng không nhận trả lời mới.")}
        schema={closeSchema}
        defaultValues={{ reason: "" }}
        version={t.version}
        tone="danger"
        submitLabel={tr("Đóng yêu cầu")}
        invalidate={invalidate}
        run={(v, cmd) =>
          api.support.close(t.id, { ...v, version: t.version }, cmd)
        }
      >
        {(f) => (
          <TextAreaField
            control={f.control}
            name="reason"
            label={tr("Kết quả xử lý")}
          />
        )}
      </CommandDialog>
    </section>
  );
}
