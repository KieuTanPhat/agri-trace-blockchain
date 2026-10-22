"use client";

import { useLedgerParams as useParams } from "@/components/ledger/route-screen";

import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { api } from "@/lib/ledger/platform-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtDateTime, fmtDue, fmtMoney } from "@/lib/ledger/format";
import { OPERATION_LABEL } from "@/lib/ledger/labels";
import { decision, note } from "@/lib/ledger/platform-schemas";
import { Button } from "@/components/ledger/ui/button";
import {
  CommandDialog,
  CommandForm,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import {
  ChoiceField,
  TextAreaField,
} from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import {
  Callout,
  ErrorState,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
import { Badge, Code, Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
const decideSchema = z.object({ decision, note: note(10, 1000) });
const cancelSchema = z.object({ note: note(10, 1000) });

const PAYLOAD_LABEL: Record<string, string> = {
  get organizationId() {
    return tr("Tổ chức");
  },
  get code() {
    return tr("Năng lực");
  },
  get userId() {
    return tr("Tài khoản");
  },
  role: "Vai",
  email: "Email",
  get fullName() {
    return tr("Họ tên");
  },
  get roleCode() {
    return tr("Vai quản trị");
  },
  get passwordHash() {
    return tr("Mật khẩu tạm");
  },
  get connectionId() {
    return tr("Kết nối");
  },
  get enrollmentId() {
    return tr("Hồ sơ");
  },
  get requestId() {
    return tr("Yêu cầu năng lực");
  },
  get versionId() {
    return tr("Phiên bản gói");
  },
  get planCode() {
    return tr("Mã gói");
  },
  version: "version",
  get setupFee() {
    return tr("Phí khởi tạo");
  },
  get annualFee() {
    return tr("Phí năm");
  },
  get limits() {
    return tr("Hạn mức");
  },
  get invoiceId() {
    return tr("Hóa đơn");
  },
  get number() {
    return tr("Số hóa đơn");
  },
  get amount() {
    return tr("Số tiền");
  },
  get reference() {
    return tr("Mã giao dịch");
  },
  get key() {
    return tr("Tham số");
  },
  get value() {
    return tr("Giá trị mới");
  },
  get before() {
    return tr("Giá trị hiện tại");
  },
  get lotId() {
    return tr("Lô");
  },
  get lotCode() {
    return tr("Mã lô");
  },
  get publicMessage() {
    return tr("Thông điệp công khai");
  },
  get note() {
    return tr("Ghi chú kèm");
  },
};

function fmtValue(k: string, v: unknown) {
  if (k === "setupFee" || k === "annualFee" || k === "amount")
    return fmtMoney(Number(v));
  if (v && typeof v === "object") return JSON.stringify(v);
  return String(v);
}

function PreviewScreen() {
  return (
    <Guard permission="approval.read">
      <Detail />
    </Guard>
  );
}

function Detail() {
  const { id } = useParams<{ id: string }>();
  const { user, can } = useSession();
  const q = useQuery({
    queryKey: ["approval", id],
    queryFn: () => api.approvals.get(id),
  });
  const cancel = useDialog();
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={8} className="p-8" />;
  const a = q.data;
  const pending = a.effectiveStatus === "PENDING";
  const isProposer = a.proposer.id === user?.id;
  const due = fmtDue(a.expiresAt);
  const invalidate = [["approval", id], ["approvals"], ["inbox"]];

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/admin/approvals", label: tr("Phê duyệt hai bước") },
          { label: a.id.slice(-8) },
        ]}
        title={OPERATION_LABEL[a.operation] ?? a.operation}
        meta={
          <>
            <Code>{a.operation}</Code>
            <Status group="approval" value={a.effectiveStatus} />
            {pending && (
              <span className="text-[13px] text-ink-2">
                {tr("Hết hạn sau")}{" "}
                <strong className="font-semibold text-ink">
                  {due.text.replace(/^còn | left$/g, "")}
                </strong>
              </span>
            )}
          </>
        }
        actions={
          pending && can("approval.cancel") ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => cancel.open(true)}
            >
              {tr("Hủy đề xuất")}
            </Button>
          ) : null
        }
      />
      <PageBody wide>
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-5">
            <Section
              title={tr("Nội dung đề xuất — bất biến")}
              aside={<span className="font-mono">version {a.version}</span>}
            >
              <div className="grid gap-0 md:grid-cols-2">
                <dl className="flex flex-col gap-2 border-line/70 px-4 py-4 text-[13px] sm:px-5 md:border-r">
                  <span className="label-caps">{tr("Đối tượng")}</span>
                  <div className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5">
                    <dt className="text-ink-2">{tr("Loại")}</dt>
                    <dd className="font-mono text-[12px]">{a.subjectType}</dd>
                    <dt className="text-ink-2">ID</dt>
                    <dd className="font-mono text-[12px] break-all">
                      {a.subjectId}
                    </dd>
                    <dt className="text-ink-2">{tr("Tổ chức")}</dt>
                    <dd className="font-mono text-[12px]">
                      {a.organizationId ?? "—"}
                    </dd>
                  </div>
                </dl>
                <div className="flex flex-col gap-2 px-4 py-4 sm:px-5">
                  <span className="label-caps">
                    {tr("Thay đổi sẽ thực thi khi duyệt")}
                  </span>
                  <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-y-1.5 rounded-md bg-sunken px-3 py-2.5 text-[12.5px]">
                    {Object.entries(a.payload).map(([k, v]) => (
                      <div key={k} className="contents">
                        <dt className="text-ink-2">{PAYLOAD_LABEL[k] ?? k}</dt>
                        <dd className="font-mono break-all">
                          {fmtValue(k, v)}
                        </dd>
                      </div>
                    ))}
                  </dl>
                </div>
              </div>
              <div className="border-t border-line/70 px-4 py-2.5 font-mono text-[12px] break-all text-ink-2 sm:px-5">
                payloadHash {a.payloadHash}
              </div>
            </Section>
            <Section title={tr("Dòng thời gian")}>
              <ol className="flex flex-col gap-4 px-4 py-4 text-[13px] sm:px-5">
                <li className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
                  <span className="font-mono text-[12px] text-ink-2">
                    {fmtDateTime(a.createdAt)}
                  </span>
                  <span>
                    <strong className="font-semibold">
                      {a.proposer.fullName}
                    </strong>{" "}
                    <span className="text-ink-2">({a.proposer.email})</span>{" "}
                    {tr("đề xuất · “")}
                    {a.proposerReason}”
                  </span>
                </li>
                {a.decidedAt ? (
                  <li className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
                    <span className="font-mono text-[12px] text-ink-2">
                      {fmtDateTime(a.decidedAt)}
                    </span>
                    <span>
                      {a.status === "CANCELLED" ? (
                        tr("Đã hủy")
                      ) : (
                        <>
                          <strong className="font-semibold">
                            {a.decidedBy?.fullName}
                          </strong>{" "}
                          {a.status === "APPROVED"
                            ? tr("phê duyệt")
                            : tr("từ chối")}
                        </>
                      )}{" "}
                      · “{a.decisionNote}”
                    </span>
                  </li>
                ) : (
                  <li className="grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
                    <span className="font-mono text-[12px] text-ink-2">
                      {fmtDateTime(a.expiresAt)}
                    </span>
                    <span className="text-ink-2">
                      {a.effectiveStatus === "EXPIRED"
                        ? tr(
                            "Đã hết hạn — hệ thống chuyển EXPIRED khi có đề xuất mới cho cùng đối tượng.",
                          )
                        : tr("Hết hạn nếu chưa có quyết định.")}
                    </span>
                  </li>
                )}
              </ol>
            </Section>
          </div>
          <aside className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 lg:sticky lg:top-[68px] lg:max-w-[420px]">
            {!pending ? (
              <Callout
                tone={a.effectiveStatus === "APPROVED" ? "ok" : "neutral"}
                title={tr("Đề xuất đã kết thúc")}
              >
                {tr("Quyết định là cuối cùng. Muốn thay đổi, tạo đề xuất mới.")}
              </Callout>
            ) : !can("approval.decide") ? (
              <Callout>
                Vai {user?.role.code} {tr("chỉ được xem đề xuất.")}
              </Callout>
            ) : isProposer ? (
              <Callout tone="warn" title={tr("Bạn là người đề xuất")}>
                {tr(
                  "Người đề xuất cần một quản trị viên khác quyết định. Bạn vẫn có thể hủy đề xuất.",
                )}
                <Button type="button" className="mt-3" disabled>
                  {tr("Phê duyệt đề xuất")}
                </Button>
              </Callout>
            ) : (
              <div className="rounded-md border border-line-strong bg-card p-5">
                <CommandForm
                  title={tr("Quyết định của người duyệt")}
                  endpoint="POST /platform-approvals/:id/decision"
                  schema={decideSchema}
                  defaultValues={{ decision: "APPROVE", note: "" }}
                  version={a.version}
                  stepUp
                  submitLabel={tr("Ghi quyết định cuối cùng")}
                  invalidate={invalidate}
                  success={(r) =>
                    (r as typeof a).status === "APPROVED"
                      ? tr("Đã phê duyệt và thực thi")
                      : tr("Đã từ chối đề xuất")
                  }
                  run={(v, cmd) =>
                    api.approvals.decide(id, { ...v, version: a.version }, cmd)
                  }
                >
                  {(f) => (
                    <>
                      <ChoiceField
                        control={f.control}
                        name="decision"
                        label={tr("Kết quả")}
                        options={[
                          {
                            value: "APPROVE",
                            label: tr("Phê duyệt"),
                            help: tr("Thực thi thay đổi trong cùng giao dịch."),
                          },
                          {
                            value: "REJECT",
                            label: tr("Từ chối"),
                            tone: "danger",
                          },
                        ]}
                      />
                      <TextAreaField
                        control={f.control}
                        name="note"
                        label={tr("Ghi chú quyết định")}
                        hint={tr("10–1000 ký tự · ghi vào nhật ký kiểm toán")}
                      />
                    </>
                  )}
                </CommandForm>
              </div>
            )}
            <Badge
              tone="neutral"
              dot={false}
              className="h-auto py-1 leading-relaxed whitespace-normal"
            >
              {tr(
                "Thao tác bị ràng buộc maker–checker: đề xuất của người đã bị vô hiệu hóa không duyệt được.",
              )}
            </Badge>
          </aside>
        </div>
      </PageBody>
      <CommandDialog
        {...cancel.props}
        title={tr("Hủy đề xuất")}
        endpoint="POST /platform-approvals/:id/cancel"
        schema={cancelSchema}
        defaultValues={{ note: "" }}
        version={a.version}
        tone="danger"
        submitLabel={tr("Hủy đề xuất")}
        invalidate={invalidate}
        run={(v, cmd) =>
          api.approvals.cancel(id, { ...v, version: a.version }, cmd)
        }
      >
        {(f) => (
          <TextAreaField
            control={f.control}
            name="note"
            label={tr("Lý do hủy")}
            hint={tr("10–1000 ký tự")}
          />
        )}
      </CommandDialog>
    </>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale as useLedgerLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLedgerLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-approvals-detail">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
