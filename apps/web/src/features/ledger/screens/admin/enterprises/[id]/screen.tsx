"use client";
import { RegistrationDocumentDownload } from "../document-download";
import { EnrollmentProducts } from "../enrollment-products";
import { ProfileDetails } from "../profile-details";

import Link from "next/link";
import { useLedgerParams as useParams } from "@/components/ledger/route-screen";

import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { CheckCircle2, CircleDashed, FileText, XCircle } from "lucide-react";
import { api } from "@/lib/ledger/platform-api";
import type {
  CapabilityRequest,
  Enrollment,
  EnterpriseConnection,
} from "@/lib/ledger/platform-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import {
  fmtBytes,
  fmtDate,
  fmtDateTime,
  fmtDue,
  shortHash,
} from "@/lib/ledger/format";
import {
  CAPABILITY_LABEL,
  DOC_KIND_LABEL,
  MODEL_LABEL,
} from "@/lib/ledger/labels";
import { decision, note, reason } from "@/lib/ledger/platform-schemas";
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
  Field,
  Fields,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
import { Badge, Code, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";
import { useNow } from "@/lib/ledger/use-now";

import { t as tr } from "@/lib/ledger/i18n";
const reviewSchema = z.object({ decision, note: note(1, 1000) });
const activateSchema = z.object({ reason: reason() });

function PreviewScreen() {
  return (
    <Guard permission="enrollment.read">
      <EnrollmentDetail />
    </Guard>
  );
}

const DETAIL_LABEL: Record<string, string> = {
  get legalForm() {
    return tr("Loại hình chủ thể");
  },
  get province() {
    return tr("Tỉnh/thành");
  },
  get ward() {
    return tr("Phường/xã");
  },
  get address() {
    return tr("Địa chỉ");
  },
  get phone() {
    return tr("Điện thoại");
  },
  get area() {
    return tr("Diện tích");
  },
  get standard() {
    return tr("Tiêu chuẩn");
  },
  get crops() {
    return tr("Cây trồng");
  },
  get vehicles() {
    return tr("Số phương tiện");
  },
  get scope() {
    return tr("Phạm vi");
  },
  get licenseNo() {
    return tr("Giấy phép vận tải");
  },
  get scale() {
    return tr("Quy mô");
  },
  get channels() {
    return tr("Kênh");
  },
  get stores() {
    return tr("Số cửa hàng");
  },
  get region() {
    return tr("Khu vực");
  },
  get foodSafetyCertNo() {
    return tr("Số giấy ATTP");
  },
  get foodSafetyExpiresAt() {
    return tr("ATTP hết hạn");
  },
  get processingType() {
    return tr("Loại hình chế biến");
  },
  get facilityCertNo() {
    return tr("GCN cơ sở ATTP");
  },
  get facilityCertExpiresAt() {
    return tr("GCN hết hạn");
  },
};

function EnrollmentDetail() {
  const { id } = useParams<{ id: string }>();
  const { can } = useSession();
  const q = useQuery({
    queryKey: ["enrollment", id],
    queryFn: () => api.enterprises.enrollment(id),
  });
  const org = useQuery({
    queryKey: ["organization", q.data?.organizationId],
    queryFn: () => api.enterprises.organization(q.data!.organizationId),
    enabled: !!q.data && can("directory.read"),
  });
  const inbox = useQuery({
    queryKey: ["inbox"],
    queryFn: api.workbench.inbox,
    enabled: can("inbox.read"),
  });

  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={10} className="p-8" />;
  const e = q.data;
  const due = fmtDue(
    inbox.data?.items.find(
      (item) => item.kind === "ENROLLMENT" && item.id === e.id,
    )?.dueAt ?? null,
  );
  const invalidate = [
    ["enrollment", id],
    ["enrollments"],
    ["inbox"],
    ["organization", e.organizationId],
    ["directory"],
  ];

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/admin/enterprises", label: tr("Hồ sơ đăng ký") },
          { label: e.organizationName },
        ]}
        title={e.organizationName}
        meta={
          <>
            <Status group="enrollment" value={e.onboardingStage} />
            {e.status === "PENDING_REVIEW" && due.overdue && (
              <Badge tone="danger" dot={false}>
                {tr("Quá hạn")} {due.text.replace(/^quá | overdue$/g, "")}
              </Badge>
            )}
          </>
        }
        description={
          <>
            {MODEL_LABEL[e.participationModel]} ·{" "}
            {e.payingParticipant ? tr("Trả phí") : tr("Miễn phí")}{" "}
            {tr("· Lưu trữ")} <span className="font-mono">{e.hostingMode}</span>{" "}
            · MST <span className="font-mono">{e.businessId ?? "—"}</span>{" "}
            {tr("· nộp")} {fmtDateTime(e.createdAt)}
          </>
        }
        actions={
          <>
            <Button variant="outline" size="sm" asChild>
              <Link
                href={`/admin/organizations?organizationId=${e.organizationId}`}
              >
                {tr("Hồ sơ tổ chức")}
              </Link>
            </Button>
            <Button variant="outline" size="sm" asChild>
              <Link href={`/admin/products/${e.organizationId}`}>
                {tr("Sản phẩm của tổ chức")}
              </Link>
            </Button>
          </>
        }
      />
      <PageBody wide>
        <Stepper e={e} />
        <div className="flex flex-wrap items-start gap-5">
          <div className="flex min-w-0 flex-[999_1_600px] flex-col gap-5">
            <Section
              title={tr("Pháp lý & đại diện")}
              aside={<span className="font-mono">version {e.version}</span>}
            >
              <Fields>
                <Field label={tr("Người đại diện")}>
                  {e.representativeName}
                </Field>
                <Field label={tr("Email đại diện")}>
                  {e.representativeEmail}
                </Field>
                <Field label={tr("Loại tổ chức")}>
                  {CAPABILITY_LABEL[e.organizationType] ?? e.organizationType}
                </Field>
                <Field label={tr("Mã số thuế")} mono>
                  {e.businessId ?? "—"}
                </Field>
              </Fields>
              {e.details && <ProfileDetails data={e.details} />}
            </Section>

            <Capabilities e={e} invalidate={invalidate} />

            <Section
              title={tr("Tài liệu đính kèm")}
              aside={tr("{p0} tệp · tối đa 5 MB mỗi tệp", {
                p0: e.documents.length,
              })}
            >
              <ul className="divide-y divide-line/70">
                {e.documents.map((d) => (
                  <li
                    key={d.id}
                    className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-4 py-2.5 text-[13px] sm:grid-cols-[160px_minmax(0,1fr)_80px_170px] sm:px-5"
                  >
                    <span className="text-[12px] font-semibold text-ink-2">
                      {DOC_KIND_LABEL[d.kind]}
                    </span>
                    <span className="flex min-w-0 items-center gap-2">
                      <FileText className="size-3.5 shrink-0 text-ink-2" />
                      <RegistrationDocumentDownload document={d} />
                    </span>
                    <span className="font-mono text-[12px] text-ink-2">
                      {fmtBytes(d.size)}
                    </span>
                    <span
                      className="font-mono text-[12px] text-ink-2"
                      title={d.sha256}
                    >
                      sha256 {shortHash(d.sha256)}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="border-t border-line/70 px-4 py-2.5 text-[12px] text-ink-2 sm:px-5">
                {tr(
                  "Quyền truy cập tài liệu riêng tư được kiểm tra khi tải tệp.",
                )}
              </p>
            </Section>

            {e.connections.length > 0 && (
              <Connections e={e} invalidate={invalidate} />
            )}
            <EnrollmentProducts organizationId={e.organizationId} />
          </div>

          <aside
            aria-label={tr("Quyết định")}
            className="flex min-w-0 flex-[1_1_340px] flex-col gap-4 lg:sticky lg:top-[68px] lg:max-w-[420px]"
          >
            <DecisionPanel
              e={e}
              invalidate={invalidate}
              subscriptionActive={
                org.data?.billing.subscription?.status === "ACTIVE"
              }
              orgLoaded={!!org.data}
            />
          </aside>
        </div>
      </PageBody>
    </>
  );
}

function Stepper({ e }: { e: Enrollment }) {
  const steps = [
    {
      label: tr("Xét duyệt hồ sơ"),
      done: e.status === "APPROVED",
      failed: e.status === "REJECTED",
      current: e.status === "PENDING_REVIEW",
    },
    {
      label: e.payingParticipant
        ? tr("Doanh nghiệp chọn gói & hợp đồng")
        : tr("Không cần gói (miễn phí)"),
      done:
        e.status === "APPROVED" &&
        (!e.payingParticipant || !!e.serviceActivatedAt),
      current:
        e.onboardingStage === "AWAITING_ACTIVATION" && e.payingParticipant,
    },
    {
      label: tr("Thanh toán"),
      done:
        !!e.serviceActivatedAt ||
        (e.status === "APPROVED" && !e.payingParticipant),
      current: false,
    },
    {
      label: tr("Kích hoạt dịch vụ"),
      done: !!e.serviceActivatedAt,
      current: e.onboardingStage === "AWAITING_ACTIVATION",
    },
  ];
  return (
    <ol
      aria-label={tr("Tiến trình hồ sơ")}
      className="grid grid-cols-2 overflow-hidden rounded-md border border-line bg-card text-[12.5px] md:grid-cols-4"
    >
      {steps.map((s, i) => (
        <li
          key={i}
          aria-current={s.current ? "step" : undefined}
          className={cn(
            "flex items-center gap-2 border-line px-4 py-2.5 max-md:border-b md:border-r md:last:border-r-0",
            s.current && "bg-brand-weak font-semibold text-brand-ink",
          )}
        >
          {s.failed ? (
            <XCircle className="size-4 text-danger" />
          ) : s.done ? (
            <CheckCircle2 className="size-4 text-ok" />
          ) : (
            <CircleDashed className="size-4 text-ink-2" />
          )}
          <span>
            <span className="font-mono text-ink-2">{i + 1}</span> {s.label}
          </span>
        </li>
      ))}
    </ol>
  );
}

function Capabilities({
  e,
  invalidate,
}: {
  e: Enrollment;
  invalidate: unknown[][];
}) {
  const { can } = useSession();
  const dialog = useDialog<CapabilityRequest>();
  const separate = e.status !== "REJECTED";
  const pending = e.capabilityRequests.filter(
    (c) => c.status === "PENDING",
  ).length;
  const now = useNow();
  return (
    <Section
      id="capabilities"
      title={tr("Năng lực đề nghị")}
      aside={
        separate && pending
          ? tr(
              "Xét riêng {p0} năng lực đang chờ; duyệt hồ sơ không thay thế quyết định năng lực",
              { p0: pending },
            )
          : undefined
      }
    >
      <ul className="divide-y divide-line/70">
        {e.capabilityRequests.map((c) => {
          const exp = (
            c.details.processing &&
            typeof c.details.processing === "object" &&
            "foodSafetyCertificateExpiry" in c.details.processing
              ? c.details.processing.foodSafetyCertificateExpiry
              : c.details.foodSafetyCertificateExpiry
          ) as string | undefined;
          const expDue = exp ? fmtDue(exp) : null;
          const soon =
            exp && !expDue!.overdue && Date.parse(exp) - now < 30 * 86_400_000;
          return (
            <li
              key={c.id}
              className="flex flex-wrap items-start gap-x-6 gap-y-2 px-4 py-3 sm:px-5"
            >
              <div className="flex w-full shrink-0 flex-col gap-1 sm:w-[150px]">
                <Code>{c.code}</Code>
                <span className="text-[12px] text-ink-2">
                  {CAPABILITY_LABEL[c.code]}
                </span>
              </div>
              <dl className="grid min-w-0 flex-1 grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-x-5 gap-y-1.5 text-[12.5px]">
                {Object.entries(c.details).length === 0 && (
                  <span className="text-ink-2">
                    {tr("Không có thông tin khai báo thêm.")}
                  </span>
                )}
                {Object.entries(c.details).map(([k, v]) => (
                  <div key={k} className="flex flex-col">
                    <dt className="text-[11.5px] text-ink-2">
                      {DETAIL_LABEL[k] ?? k}
                    </dt>
                    <dd
                      className={cn(
                        /(?:ExpiresAt|Expiry)$/.test(k) &&
                          expDue?.overdue &&
                          "font-medium text-danger",
                        /(?:ExpiresAt|Expiry)$/.test(k) &&
                          soon &&
                          "font-medium text-warn",
                      )}
                    >
                      {/(?:ExpiresAt|Expiry)$/.test(k)
                        ? fmtDate(String(v))
                        : typeof v === "object"
                          ? JSON.stringify(v)
                          : String(v)}
                    </dd>
                  </div>
                ))}
              </dl>
              <div className="flex shrink-0 flex-col items-end gap-1.5">
                <Status group="request" value={c.status} />
                {expDue?.overdue && (
                  <span className="text-[12px] font-medium text-danger">
                    {tr("ATTP đã hết hạn")}
                  </span>
                )}
                {soon && (
                  <span className="text-[12px] font-medium text-warn">
                    ATTP {expDue!.text}
                  </span>
                )}
                {c.reviewNote && (
                  <span className="max-w-[220px] text-right text-[12px] text-ink-2">
                    {c.reviewNote}
                  </span>
                )}
                {separate &&
                  c.status === "PENDING" &&
                  can("capability.review") && (
                    <Button
                      size="xs"
                      variant="outline"
                      onClick={() => dialog.open(c)}
                    >
                      {tr("Xét năng lực")}
                    </Button>
                  )}
              </div>
            </li>
          );
        })}
      </ul>
      {dialog.target && (
        <CommandDialog
          {...dialog.props}
          title={tr("Xét năng lực {p0}", { p0: dialog.target.code })}
          endpoint="POST /capability-requests/:id/review"
          description={
            e.serviceActivatedAt
              ? tr(
                  "Doanh nghiệp đã kích hoạt: phê duyệt sẽ cấp năng lực ngay trong cùng lệnh.",
                )
              : tr(
                  "Phê duyệt ghi nhận năng lực. Cần hoàn tất bước kích hoạt dịch vụ riêng.",
                )
          }
          schema={reviewSchema}
          defaultValues={{ decision: "APPROVE", note: "" }}
          version={dialog.target.version}
          submitLabel={tr("Ghi quyết định")}
          invalidate={invalidate}
          run={(v, cmd) =>
            api.enterprises.reviewCapability(
              dialog.target!.id,
              { ...v, version: dialog.target!.version },
              cmd,
            )
          }
          proposal={{
            operation: "CAPABILITY_REQUEST_APPROVE",
            params: (v) => ({
              requestId: dialog.target!.id,
              version: dialog.target!.version,
              note: v.note,
            }),
            reason: (v) => v.note,
          }}
          success={tr("Đã ghi quyết định năng lực")}
        >
          {(f) => (
            <>
              <ChoiceField
                control={f.control}
                name="decision"
                label={tr("Kết quả")}
                options={[
                  { value: "APPROVE", label: tr("Phê duyệt") },
                  { value: "REJECT", label: tr("Từ chối"), tone: "danger" },
                ]}
              />
              <TextAreaField
                control={f.control}
                name="note"
                label={tr("Ghi chú gửi doanh nghiệp")}
                hint={tr("1–1000 ký tự · email CAPABILITY_DECISION")}
              />
            </>
          )}
        </CommandDialog>
      )}
    </Section>
  );
}

export function Connections({
  e,
  invalidate,
}: {
  e: Enrollment;
  invalidate: unknown[][];
}) {
  const { can } = useSession();
  const dialog = useDialog<EnterpriseConnection>();
  return (
    <Section id="connections" title={tr("Kết nối blockchain (peer)")}>
      <ul className="divide-y divide-line/70">
        {e.connections.map((c) => (
          <li
            key={c.id}
            className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 text-[13px] sm:px-5"
          >
            <div className="flex min-w-0 flex-col gap-0.5">
              <span className="font-mono text-[12px]">
                {String(c.publicConfig.mspId ?? "")} ·{" "}
                {String(c.publicConfig.peer ?? "")}
              </span>
              <span className="text-[12px] text-ink-2">
                {c.hostingMode} {tr("· kiểm tra")} {fmtDateTime(c.checkedAt)} ·
                chain <span className="font-mono">{c.chainId.slice(-8)}</span>
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Status group="connection" value={c.status} />
              {c.status === "PENDING_REVIEW" && can("enrollment.review") && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() => dialog.open(c)}
                >
                  {tr("Xét kết nối")}
                </Button>
              )}
            </div>
          </li>
        ))}
      </ul>
      {dialog.target && (
        <CommandDialog
          {...dialog.props}
          title={tr("Xét kết nối peer")}
          endpoint="POST /enterprise-connections/:id/review"
          description={tr(
            "Chấp nhận kết nối có thể cần gửi đề xuất để một quản trị viên khác phê duyệt.",
          )}
          schema={reviewSchema}
          defaultValues={{ decision: "APPROVE", note: "" }}
          version={dialog.target.version}
          submitLabel={tr("Ghi quyết định")}
          invalidate={invalidate}
          run={(v, cmd) =>
            api.enterprises.reviewConnection(
              dialog.target!.id,
              { ...v, version: dialog.target!.version },
              cmd,
            )
          }
          proposal={{
            operation: "CONNECTION_APPROVE",
            params: (v) => ({
              connectionId: dialog.target!.id,
              version: dialog.target!.version,
              note: v.note,
            }),
            reason: (v) => v.note,
          }}
        >
          {(f) => (
            <>
              <ChoiceField
                control={f.control}
                name="decision"
                label={tr("Kết quả")}
                options={[
                  { value: "APPROVE", label: tr("Chấp nhận kết nối") },
                  { value: "REJECT", label: tr("Từ chối"), tone: "danger" },
                ]}
              />
              <TextAreaField
                control={f.control}
                name="note"
                label={tr("Ghi chú")}
              />
            </>
          )}
        </CommandDialog>
      )}
    </Section>
  );
}

function DecisionPanel({
  e,
  invalidate,
  subscriptionActive,
  orgLoaded,
}: {
  e: Enrollment;
  invalidate: unknown[][];
  subscriptionActive: boolean;
  orgLoaded: boolean;
}) {
  const { can } = useSession();
  if (!can("enrollment.review"))
    return <Callout>{tr("Vai hiện tại chỉ được xem hồ sơ.")}</Callout>;

  if (e.status === "PENDING_REVIEW") {
    return (
      <div className="rounded-md border border-line-strong bg-card p-5">
        <CommandForm
          title={tr("Quyết định")}
          endpoint="POST /enterprise-enrollments/:id/review"
          schema={reviewSchema}
          defaultValues={{ decision: "APPROVE", note: "" }}
          version={e.version}
          submitLabel={tr("Ghi quyết định")}
          invalidate={invalidate}
          success={(r) =>
            (r as Enrollment).status === "APPROVED"
              ? tr("Đã phê duyệt hồ sơ")
              : tr("Đã trả hồ sơ")
          }
          run={(v, cmd) =>
            api.enterprises.review(e.id, { ...v, version: e.version }, cmd)
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
                    help: tr(
                      "Duyệt hồ sơ doanh nghiệp. Năng lực và kích hoạt dịch vụ được xét riêng.",
                    ),
                  },
                  {
                    value: "REJECT",
                    label: tr("Trả hồ sơ"),
                    help: tr(
                      "Trả cả hồ sơ; doanh nghiệp bổ sung qua đề xuất sửa hồ sơ.",
                    ),
                    tone: "danger",
                  },
                ]}
              />
              <TextAreaField
                control={f.control}
                name="note"
                label={tr("Ghi chú gửi doanh nghiệp")}
                hint={tr("1–1000 ký tự · gửi kèm email quyết định")}
                rows={4}
              />
            </>
          )}
        </CommandForm>
      </div>
    );
  }

  if (e.status === "REJECTED") {
    return (
      <Callout tone="danger" title={tr("Hồ sơ đã bị trả")}>
        {e.reviewNote ?? "—"}
        <span className="mt-2 block text-ink-2">
          {tr(
            "Doanh nghiệp bổ sung và nộp lại qua đề xuất sửa hồ sơ; mục này sẽ xuất hiện ở Điều chỉnh hồ sơ.",
          )}
        </span>
      </Callout>
    );
  }

  if (e.serviceActivatedAt) {
    return (
      <Callout tone="ok" title={tr("Dịch vụ đang hoạt động")}>
        {tr("Kích hoạt")} {fmtDateTime(e.serviceActivatedAt)}.
        <br />
        <span className="text-ink-2">{e.serviceActivationReason}</span>
      </Callout>
    );
  }

  return (
    <ActivatePanel
      e={e}
      invalidate={invalidate}
      subscriptionActive={subscriptionActive}
      orgLoaded={orgLoaded}
    />
  );
}

function ActivatePanel({
  e,
  invalidate,
  subscriptionActive,
  orgLoaded,
}: {
  e: Enrollment;
  invalidate: unknown[][];
  subscriptionActive: boolean;
  orgLoaded: boolean;
}) {
  const caps = e.capabilityRequests;
  const checks = [
    {
      ok: !caps.some((c) => c.status === "PENDING"),
      label: tr("Mọi năng lực đã được xét"),
    },
    {
      ok: !caps.length || caps.some((c) => c.status === "APPROVED"),
      label: tr("Có ít nhất một năng lực được duyệt"),
    },
    {
      ok: !caps.length || !e.payingParticipant || subscriptionActive,
      label: !caps.length
        ? tr("Hồ sơ không có yêu cầu năng lực — không cần gói")
        : e.payingParticipant
          ? orgLoaded
            ? tr("Có gói dịch vụ ACTIVE (tổ chức trả phí)")
            : tr("Đang kiểm tra gói dịch vụ…")
          : tr("Tổ chức miễn phí — không cần gói"),
    },
  ];
  const ready = checks.every((c) => c.ok);
  return (
    <div className="flex flex-col gap-4 rounded-md border border-line-strong bg-card p-5">
      <div className="flex flex-col gap-1">
        <h2 className="text-[16px] font-semibold">{tr("Kích hoạt dịch vụ")}</h2>
        <p className="text-[13px] text-ink-2">
          {tr(
            "Kiểm tra năng lực và gói dịch vụ trước khi xác nhận kích hoạt. Phê duyệt hồ sơ và thanh toán không thay thế quyết định kích hoạt.",
          )}
        </p>
      </div>
      <ul className="flex flex-col gap-2 text-[13px]">
        {checks.map((c) => (
          <li key={c.label} className="flex items-start gap-2">
            {c.ok ? (
              <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-ok" />
            ) : (
              <XCircle className="mt-0.5 size-4 shrink-0 text-danger" />
            )}
            {c.label}
          </li>
        ))}
      </ul>
      {ready ? (
        <CommandForm
          title={tr("Kích hoạt thủ công")}
          endpoint="POST /enterprise-enrollments/:id/activate"
          schema={activateSchema}
          defaultValues={{ reason: "" }}
          version={e.version}
          submitLabel={tr("Kích hoạt dịch vụ")}
          invalidate={invalidate}
          success={tr("Đã kích hoạt dịch vụ")}
          run={(v, cmd) =>
            api.enterprises.activate(e.id, { ...v, version: e.version }, cmd)
          }
        >
          {(f) => (
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do kích hoạt thủ công")}
              hint={tr(
                "Tối thiểu 10 ký tự · ghi ENTERPRISE_SERVICE_ACTIVATED (manual: true)",
              )}
            />
          )}
        </CommandForm>
      ) : (
        <Callout tone="warn">
          {tr("Chưa đủ điều kiện kích hoạt — API sẽ trả 409.")}{" "}
          {e.payingParticipant && !subscriptionActive && (
            <Link
              className="underline"
              href={`/admin/billing/invoices?organizationId=${e.organizationId}`}
            >
              {tr("Xem hóa đơn của tổ chức")}
            </Link>
          )}
        </Callout>
      )}
    </div>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale as useLedgerLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLedgerLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-enterprises-detail">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
