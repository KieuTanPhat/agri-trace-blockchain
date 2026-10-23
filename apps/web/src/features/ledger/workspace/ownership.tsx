"use client";

import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { wapi } from "@/lib/ledger/workspace-api";
import type { OwnershipTransfer } from "@/lib/ledger/workspace-types";
import { useAuth } from "@/lib/auth-store";
import { fmtDateTime, fmtDue } from "@/lib/ledger/format";
import { reason } from "@/lib/ledger/platform-schemas";
import { useOverview, useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { CommandDialog, CommandForm, useDialog } from "@/components/ledger/kit/command-dialog";
import { ChoiceField, SelectField, TextAreaField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader, Section } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
const proposeSchema = z.object({ toUserId: z.string().min(1, { error: () => tr("Chọn người nhận") }), retain: z.enum(["yes", "no"]), reason: reason() });
const resolveSchema = z.object({ note: reason() });

const STATUS: Record<string, [string, "info" | "ok" | "neutral" | "danger"]> = {
  PENDING: [tr("Chờ người nhận"), "info"],
  ACCEPTED: [tr("Đã chuyển"), "ok"],
  DECLINED: [tr("Bị từ chối"), "danger"],
  CANCELLED: [tr("Đã hủy"), "neutral"],
  EXPIRED: [tr("Hết hạn"), "neutral"],
};

export default function OwnershipPage() {
  const { user } = useAuth();
  const { primary, can } = useWorkspaceAccess();
  const o = useOverview();
  const q = useQuery({ queryKey: ["ws-transfers"], queryFn: wapi.transfers });
  const members = useQuery({ queryKey: ["ws-members"], queryFn: wapi.members, enabled: primary && can("members.read") });
  const act = useDialog<{ kind: "accept" | "decline" | "cancel"; row: OwnershipTransfer }>();
  const invalidate = [["ws-transfers"], ["ws-access"], ["ws-overview"], ["ws-members"]];

  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const rows = q.data ?? [];
  const pending = rows.find((r) => r.status === "PENDING" && !r.expired);
  const owner = o.data?.member.enrollmentOwner;
  const a = act.target;

  return (
    <>
      <PageHeader title={tr("Chuyển quyền chủ quản")} description={tr("Chủ quản đứng tên hồ sơ đề xuất chuyển cho một thành viên đang hoạt động; người nhận phải chấp nhận trong 7 ngày. Lịch sử nghiệp vụ, khóa ký và chữ ký vẫn gắn với tài khoản đã tạo ra chúng.")} />
      <PageBody>
        {!q.data ? (
          <LoadingRows />
        ) : (
          <>
            {pending && (
              <Section title={tr("Yêu cầu đang chờ")} aside={<Badge tone="info">{fmtDue(pending.expiresAt).text}</Badge>}>
                <div className="flex flex-col gap-3 px-4 py-4 text-[13px] sm:px-5">
                  <p>
                    <strong className="font-semibold">{pending.from?.fullName}</strong> → <strong className="font-semibold">{pending.to?.fullName}</strong>
                    {pending.retainPreviousAdmin ? tr(" · người chuyển vẫn giữ quyền quản trị cấp 1") : tr(" · người chuyển mất quyền quản trị, nhân viên trực thuộc chuyển sang chủ quản mới")}
                  </p>
                  <p className="text-ink-2">“{pending.reason}”</p>
                  <div className="flex flex-wrap gap-2">
                    {pending.toUserId === user?.id && (
                      <>
                        <Button size="sm" onClick={() => act.open({ kind: "accept", row: pending })}>
                          {tr("Chấp nhận làm chủ quản")}
                        </Button>
                        <Button size="sm" variant="outline" onClick={() => act.open({ kind: "decline", row: pending })}>
                          {tr("Từ chối")}
                        </Button>
                      </>
                    )}
                    {pending.fromUserId === user?.id && (
                      <Button size="sm" variant="outline" onClick={() => act.open({ kind: "cancel", row: pending })}>
                        {tr("Hủy yêu cầu")}
                      </Button>
                    )}
                  </div>
                </div>
              </Section>
            )}
            {primary && owner && !pending && (
              <div className="rounded-md border border-line-strong bg-card p-5">
                <CommandForm
                  title={tr("Đề xuất chuyển chủ quản")}
                  endpoint="POST /enterprise-workspace/ownership-transfers"
                  schema={proposeSchema}
                  defaultValues={{ toUserId: "", retain: "yes", reason: "" }}
                  submitLabel={tr("Gửi đề xuất")}
                  invalidate={invalidate}
                  run={(v, cmd) => wapi.proposeTransfer({ toUserId: v.toUserId, retainPreviousAdmin: v.retain === "yes", reason: v.reason }, cmd)}
                >
                  {(f) => (
                    <>
                      <SelectField control={f.control} name="toUserId" label={tr("Người nhận")} options={(members.data ?? []).filter((m) => m.accountStatus === "ACTIVE" && m.id !== user?.id).map((m) => ({ value: m.id, label: `${m.fullName} · ${m.jobTitle ?? ""}` }))} />
                      <ChoiceField
                        control={f.control}
                        name="retain"
                        label={tr("Sau khi chuyển")}
                        options={[
                          { value: "yes", label: tr("Tôi vẫn là quản trị cấp 1") },
                          { value: "no", label: tr("Tôi thôi quản trị"), help: tr("Mất ORG_ADMIN/CREATE_CHAIN, phiên bị thu hồi; nhân viên trực thuộc chuyển cho chủ quản mới."), tone: "danger" },
                        ]}
                      />
                      <TextAreaField control={f.control} name="reason" label={tr("Lý do")} />
                    </>
                  )}
                </CommandForm>
              </div>
            )}
            {!primary && !pending && <Callout>{tr("Chỉ chủ quản cấp 1 đứng tên hồ sơ đăng ký mới đề xuất chuyển quyền. Yêu cầu gửi cho bạn sẽ hiện ở đây.")}</Callout>}
            {primary && !owner && !pending && <Callout>{tr("Bạn là quản trị cấp 1 nhưng không đứng tên hồ sơ đăng ký, nên không đề xuất chuyển quyền được.")}</Callout>}
            <Section title={tr("Lịch sử")}>
              {rows.length ? (
                <ul className="divide-y divide-line/70">
                  {rows.map((r) => {
                    const [label, tone] = STATUS[r.expired ? "EXPIRED" : r.status] ?? [r.status, "neutral" as const];
                    return (
                      <li key={r.id} className="flex flex-col gap-1 px-4 py-3 text-[13px] sm:px-5">
                        <span className="flex flex-wrap items-center justify-between gap-2">
                          <span>
                            {r.from?.fullName} → {r.to?.fullName}
                          </span>
                          <Badge tone={tone}>{tr(label)}</Badge>
                        </span>
                        <span className="text-[12px] text-ink-2">
                          {fmtDateTime(r.createdAt)} · {r.reason}
                          {r.resolutionNote && ` · ${r.resolutionNote}`}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              ) : (
                <EmptyState title={tr("Chưa có yêu cầu chuyển chủ quản")} />
              )}
            </Section>
          </>
        )}
      </PageBody>
      {a && (
        <CommandDialog
          {...act.props}
          title={a.kind === "accept" ? tr("Chấp nhận làm chủ quản") : a.kind === "decline" ? tr("Từ chối yêu cầu") : tr("Hủy yêu cầu")}
          endpoint={`POST /enterprise-workspace/ownership-transfers/:id/${a.kind}`}
          description={a.kind === "accept" ? tr("Bạn trở thành quản trị cấp 1 (ORG_ADMIN, CREATE_CHAIN) và người đứng tên hồ sơ doanh nghiệp. Người chuyển phải còn quyền cấp 1 tại thời điểm chấp nhận.") : undefined}
          schema={resolveSchema}
          defaultValues={{ note: "" }}
          version={a.row.version}
          tone={a.kind === "accept" ? "default" : "danger"}
          submitLabel={a.kind === "accept" ? tr("Chấp nhận") : a.kind === "decline" ? tr("Từ chối") : tr("Hủy yêu cầu")}
          invalidate={invalidate}
          run={(v, cmd) => wapi.resolveTransfer(a.row.id, a.kind, { note: v.note, version: a.row.version }, cmd)}
        >
          {(f) => <TextAreaField control={f.control} name="note" label={tr("Ghi chú")} />}
        </CommandDialog>
      )}
    </>
  );
}
