"use client";

import { useState } from "react";
import {
  useLedgerInfiniteQuery as useInfiniteQuery,
  useLedgerQuery as useQuery,
} from "@/lib/ledger/data";
import { z } from "zod";
import { Loader2, Plus } from "lucide-react";
import { api } from "@/lib/ledger/privacy-api";
import type { components } from "@/lib/generated/api";
type PrivacyItem = components["schemas"]["PrivacyTicketDto"];
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtAgo, fmtDateTime, fmtDue } from "@/lib/ledger/format";
import {
  isoToLocal,
  localToIso,
  note,
} from "@/features/ledger/privacy/schemas";
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
  TextField,
} from "@/components/ledger/kit/form-fields";
import {
  Callout,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageBody,
  PageHeader,
} from "@/components/ledger/kit/page";
import { Badge, Due, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const TYPE_LABEL: Record<string, string> = {
  get ACCESS() {
    return tr("Truy cập dữ liệu");
  },
  get DELETION() {
    return tr("Xóa dữ liệu");
  },
  get CORRECTION() {
    return tr("Chỉnh sửa");
  },
  get OBJECTION() {
    return tr("Phản đối xử lý");
  },
  get RESTRICTION() {
    return tr("Hạn chế xử lý");
  },
  get WITHDRAWAL() {
    return tr("Rút lại đồng ý");
  },
  get INCIDENT() {
    return tr("Sự cố vi phạm");
  },
};

const requestSchema = z.object({
  requestType: z.enum([
    "ACCESS",
    "CORRECTION",
    "DELETION",
    "RESTRICTION",
    "WITHDRAWAL",
    "OBJECTION",
  ]),
  message: note(10, 4000),
});
const reviewSchema = z
  .object({
    status: z.enum(["IN_REVIEW", "RESPONDED", "CLOSED", "REJECTED"]),
    note: note(10, 4000),
    mfaCode: z.string().optional(),
    visibility: z.enum(["INTERNAL", "SHARED"]),
    reporting: z.enum(["UNASSESSED", "REQUIRED", "NOT_REQUIRED"]).optional(),
    reportedAt: z.string().optional(),
    notificationReference: z.string().trim().max(500).optional(),
  })
  .refine((v) => v.status !== "RESPONDED" || v.visibility === "SHARED", {
    path: ["visibility"],
    error: () => tr("RESPONDED phải kèm phản hồi SHARED cho người gửi"),
  })
  .refine(
    (v) => !v.notificationReference || v.notificationReference.length >= 5,
    { path: ["notificationReference"], error: () => tr("Tối thiểu 5 ký tự") },
  );
const breachSchema = z.object({
  mfaCode: z.string().optional(),
  detectedAt: z
    .string()
    .min(1, { error: () => tr("Bắt buộc") })
    .refine((v) => Date.parse(v) <= Date.now(), {
      error: () => tr("Không được ở tương lai"),
    }),
  message: note(10, 4000),
});

export function PrivacyView({ admin }: { admin: boolean }) {
  const { can } = useSession();
  const [lockedId, setLockedId] = useState<string | null>(null);
  const [selectedId, setSelected] = useState<string | null>(null);
  const breach = useDialog();
  const q = useInfiniteQuery({
    queryKey: ["privacy", admin],
    queryFn: ({ pageParam }) => api.privacy.list(admin, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items);
  const currentId = lockedId ?? selectedId ?? rows?.[0]?.id;
  return (
    <div data-testid="ledger-privacy-workspace">
      <PageHeader
        title={
          admin ? tr("Quyền dữ liệu cá nhân") : tr("Quyền dữ liệu của tôi")
        }
        description={tr(
          "Hộp thư yêu cầu của chủ thể dữ liệu và hồ sơ vi phạm. Nội dung lưu mã hóa; nhật ký kiểm toán chỉ giữ metadata. Phần mềm không tự gửi báo cáo ra ngoài.",
        )}
        actions={
          (admin ? can("privacy.write") : true) && (
            <Button size="sm" onClick={() => breach.open(true)}>
              <Plus />{" "}
              {admin ? tr("Ghi nhận vi phạm") : tr("Gửi yêu cầu quyền dữ liệu")}
            </Button>
          )
        }
      />
      <PageBody wide>
        <div className="grid items-start gap-5 lg:grid-cols-[minmax(0,400px)_minmax(0,1fr)]">
          <div className="overflow-hidden rounded-md border border-line bg-card">
            {q.error ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !rows ? (
              <LoadingRows />
            ) : !rows.length ? (
              <EmptyState title={tr("Hộp thư trống")} />
            ) : (
              <ul className="divide-y divide-line/70">
                {rows.map((r) => (
                  <li key={r.id}>
                    <Row
                      r={r}
                      disabled={lockedId !== null}
                      on={currentId === r.id}
                      onClick={() => setSelected(r.id)}
                    />
                  </li>
                ))}
              </ul>
            )}
            {q.hasNextPage && (
              <div className="border-t border-line p-2 text-center">
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={() => q.fetchNextPage()}
                  disabled={q.isFetchingNextPage}
                >
                  {q.isFetchingNextPage && <Loader2 className="animate-spin" />}{" "}
                  {tr("Tải thêm")}
                </Button>
              </div>
            )}
          </div>
          {currentId ? (
            <Detail
              id={currentId}
              admin={admin}
              onLockChange={(v) => setLockedId(v ? currentId : null)}
            />
          ) : (
            <div />
          )}
        </div>
      </PageBody>
      {admin ? (
        <CommandDialog
          {...breach.props}
          title={tr("Ghi nhận sự cố vi phạm dữ liệu")}
          endpoint="POST /platform-privacy/breaches"
          description={tr(
            "Hạn đánh giá cố định 72 giờ tính từ thời điểm phát hiện; không thể dời đồng hồ hay xóa lịch sử.",
          )}
          schema={breachSchema}
          defaultValues={{
            detectedAt: isoToLocal(new Date().toISOString()),
            message: "",
          }}
          submitLabel={tr("Ghi nhận")}
          invalidate={[["privacy"]]}
          run={(v, cmd) =>
            api.privacy.breach(
              { detectedAt: localToIso(v.detectedAt)!, message: v.message },
              { ...cmd, mfaCode: v.mfaCode },
            )
          }
        >
          {(f) => (
            <>
              <TextField
                control={f.control}
                name="mfaCode"
                label={tr("Mã MFA (khi được yêu cầu)")}
              />
              <TextField
                control={f.control}
                name="detectedAt"
                label={tr("Thời điểm phát hiện")}
                type="datetime-local"
              />
              <TextAreaField
                control={f.control}
                name="message"
                label={tr("Mô tả sự cố")}
                max={4000}
                rows={4}
                hint={tr("Không ghi dữ liệu cá nhân không cần thiết")}
              />
            </>
          )}
        </CommandDialog>
      ) : (
        <CommandDialog
          {...breach.props}
          title={tr("Gửi yêu cầu quyền dữ liệu")}
          endpoint="POST /privacy-requests"
          schema={requestSchema}
          defaultValues={{ requestType: "ACCESS", message: "" }}
          submitLabel={tr("Gửi yêu cầu")}
          invalidate={[["privacy"]]}
          run={(v, cmd) => api.privacy.create(v, cmd)}
        >
          {(f) => (
            <>
              <SelectField
                control={f.control}
                name="requestType"
                label={tr("Loại yêu cầu")}
                options={Object.entries(TYPE_LABEL)
                  .filter(([v]) => v !== "INCIDENT")
                  .map(([value, label]) => ({ value, label }))}
              />
              <TextAreaField
                control={f.control}
                name="message"
                label={tr("Nội dung yêu cầu")}
                max={4000}
                rows={4}
                hint={tr("Không nhập mật khẩu, OTP hoặc khóa ký")}
              />
            </>
          )}
        </CommandDialog>
      )}
    </div>
  );
}

function Row({
  r,
  on,
  onClick,
  disabled,
}: {
  r: PrivacyItem;
  on: boolean;
  onClick: () => void;
  disabled: boolean;
}) {
  const due = r.deadlineAt ? fmtDue(r.deadlineAt) : null;
  return (
    <button
      disabled={disabled}
      type="button"
      onClick={onClick}
      className={cn(
        "flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-row-alt",
        on &&
          "bg-brand-weak shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-weak",
      )}
    >
      <span className="flex items-center justify-between gap-2">
        <span
          className={cn(
            "text-[13px] font-medium",
            r.kind === "BREACH" && "text-danger",
          )}
        >
          {TYPE_LABEL[r.requestType] ?? r.requestType}
        </span>
        <Status group="privacy" value={r.status} />
      </span>
      <span className="flex items-center justify-between gap-2 text-[12px] text-ink-2">
        <span>{fmtAgo(r.createdAt)}</span>
        {due && !["CLOSED", "REJECTED"].includes(r.status) && (
          <Due overdue={due.overdue}>72h: {due.text}</Due>
        )}
      </span>
    </button>
  );
}

function Detail({
  id,
  admin,
  onLockChange,
}: {
  id: string;
  admin: boolean;
  onLockChange: (v: boolean) => void;
}) {
  const { can } = useSession();
  const q = useQuery({
    queryKey: ["privacy", admin, id],
    queryFn: () => api.privacy.get(admin, id),
  });
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const p = q.data;
  const ended = ["CLOSED", "REJECTED"].includes(p.status);
  const breach = p.kind === "BREACH";
  const due = p.deadlineAt ? fmtDue(p.deadlineAt) : null;
  return (
    <section className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-line bg-card p-5">
        <div className="flex flex-wrap items-center gap-2">
          <h2 className="text-[17px] font-semibold">
            {TYPE_LABEL[p.requestType] ?? p.requestType}
          </h2>
          <Status group="privacy" value={p.status} />
          {breach && <Status group="reporting" value={p.reporting} />}
          {p.overdue && (
            <Badge tone="danger" dot={false}>
              {tr("Quá hạn 72 giờ")}
            </Badge>
          )}
        </div>
        {breach && (
          <dl className="grid grid-cols-2 gap-3 rounded-md bg-sunken px-3 py-2.5 text-[12.5px] sm:grid-cols-3">
            <div>
              <dt className="text-ink-2">{tr("Phát hiện")}</dt>
              <dd className="font-mono">{fmtDateTime(p.detectedAt)}</dd>
            </div>
            <div>
              <dt className="text-ink-2">{tr("Hạn 72 giờ")}</dt>
              <dd className="font-mono">
                {fmtDateTime(p.deadlineAt)}{" "}
                {due && !ended && <Due overdue={due.overdue}>{due.text}</Due>}
              </dd>
            </div>
            <div>
              <dt className="text-ink-2">{tr("Đã thông báo")}</dt>
              <dd className="font-mono">{fmtDateTime(p.reportedAt)}</dd>
            </div>
          </dl>
        )}
        <p className="text-[14px] leading-relaxed whitespace-pre-line">
          {p.message}
        </p>
      </div>
      <div className="rounded-md border border-line bg-card">
        <h3 className="border-b border-line/70 px-5 py-3 text-[14px] font-semibold">
          {tr("Lịch sử xử lý")}
        </h3>
        <ol className="flex flex-col divide-y divide-line/70">
          {p.events.map((e) => (
            <li
              key={e.id}
              className="flex flex-col gap-1 px-5 py-2.5 text-[13px]"
            >
              <span className="flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
                <span className="font-mono">{e.action}</span>
                <span className="font-mono">{fmtDateTime(e.createdAt)}</span>
                <Badge
                  tone={e.visibility === "SHARED" ? "brand" : "neutral"}
                  dot={false}
                  className="h-5 text-[11px]"
                >
                  {e.visibility === "SHARED"
                    ? tr("Gửi người yêu cầu")
                    : tr("Nội bộ")}
                </Badge>
              </span>
              <span>{e.note}</span>
              {e.notificationReference && (
                <span className="font-mono text-[12px] text-ink-2">
                  {tr("Tham chiếu:")} {e.notificationReference}
                </span>
              )}
            </li>
          ))}
        </ol>
      </div>
      {!ended && admin && can("privacy.write") ? (
        <div className="rounded-md border border-line-strong bg-card p-5">
          <CommandForm
            key={p.id}
            onLockChange={onLockChange}
            title={tr("Cập nhật hồ sơ")}
            endpoint="POST /platform-privacy/:id/review"
            schema={reviewSchema}
            defaultValues={{
              status: "IN_REVIEW",
              note: "",
              visibility: "INTERNAL",
              reporting:
                breach &&
                (p.reporting === "UNASSESSED" ||
                  p.reporting === "REQUIRED" ||
                  p.reporting === "NOT_REQUIRED")
                  ? p.reporting
                  : undefined,
            }}
            version={p.version}

            submitLabel={tr("Ghi cập nhật")}
            invalidate={[["privacy"]]}
            run={(v, cmd) =>
              api.privacy.review(
                p.id,
                {
                  status: v.status,
                  note: v.note,
                  visibility: v.visibility,
                  version: p.version,
                  ...(breach
                    ? {
                        reporting: v.reporting,
                        reportedAt: localToIso(v.reportedAt),
                        notificationReference:
                          v.notificationReference || undefined,
                      }
                    : {}),
                },
                { ...cmd, mfaCode: v.mfaCode },
              )
            }
          >
            {(f) => (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <SelectField
                    control={f.control}
                    name="status"
                    label={tr("Trạng thái mới")}
                    options={[
                      { value: "IN_REVIEW", label: tr("Đang xem xét") },
                      { value: "RESPONDED", label: tr("Đã phản hồi") },
                      { value: "CLOSED", label: tr("Đóng") },
                      { value: "REJECTED", label: tr("Từ chối") },
                    ]}
                  />
                  <ChoiceField
                    control={f.control}
                    name="visibility"
                    label={tr("Hiển thị ghi chú")}
                    options={[
                      { value: "INTERNAL", label: tr("Nội bộ") },
                      { value: "SHARED", label: tr("Gửi người yêu cầu") },
                    ]}
                  />
                </div>
                <TextField
                  control={f.control}
                  name="mfaCode"
                  label={tr("Mã MFA (khi được yêu cầu)")}
                />
                <TextAreaField
                  control={f.control}
                  name="note"
                  label={tr("Ghi chú")}
                  max={4000}
                />
                {breach && (
                  <>
                    <SelectField
                      control={f.control}
                      name="reporting"
                      label={tr("Đánh giá diện báo cáo")}
                      options={[
                        { value: "UNASSESSED", label: tr("Chưa đánh giá") },
                        { value: "REQUIRED", label: tr("Phải báo cáo") },
                        {
                          value: "NOT_REQUIRED",
                          label: tr("Không thuộc diện"),
                        },
                      ]}
                    />
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField
                        control={f.control}
                        name="reportedAt"
                        label={tr("Thời điểm đã thông báo")}
                        type="datetime-local"
                      />
                      <TextField
                        control={f.control}
                        name="notificationReference"
                        label={tr("Tham chiếu bằng chứng")}
                        hint={tr("5–500 ký tự")}
                      />
                    </div>
                    <p className="text-[12px] text-ink-2">
                      {tr(
                        "Đóng hồ sơ vi phạm cần căn cứ không thuộc diện báo cáo, hoặc thời điểm đã thông báo kèm tham chiếu bằng chứng.",
                      )}
                    </p>
                  </>
                )}
              </>
            )}
          </CommandForm>
        </div>
      ) : ended ? (
        <Callout>{tr("Hồ sơ đã kết thúc.")}</Callout>
      ) : null}
    </section>
  );
}
