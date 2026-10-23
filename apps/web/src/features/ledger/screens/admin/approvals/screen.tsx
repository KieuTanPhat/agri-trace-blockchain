"use client";

import { useEffect, useRef, useState } from "react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import type { Control, UseFormReturn } from "react-hook-form";
import { z } from "zod";
import {
  approvalFormSchema,
  parseApprovalProposal,
} from "@/lib/ledger/platform-approval-input";
import Link from "next/link";
import { Plus } from "lucide-react";
import { api } from "@/lib/ledger/platform-api";
import type { Approval, ApprovalStatus } from "@/lib/ledger/platform-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import {
  ROLE_LABEL,
  type PlatformRole,
} from "@/lib/ledger/platform-role-labels";
import { fmtDateTime, fmtDue } from "@/lib/ledger/format";
import { OPERATION_LABEL } from "@/lib/ledger/labels";
import { Button } from "@/components/ledger/ui/button";
import { CommandDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import {
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import {
  Callout,
  EmptyState,
  PageBody,
  PageHeader,
} from "@/components/ledger/kit/page";
import { Code, Due, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const TABS: (ApprovalStatus | "")[] = [
  "PENDING",
  "APPROVED",
  "REJECTED",
  "CANCELLED",
  "EXPIRED",
  "",
];

function PreviewScreen() {
  return (
    <Guard permission="approval.read">
      <Approvals />
    </Guard>
  );
}

function Approvals() {
  const { can } = useSession();
  const [status, setStatus] = useState<ApprovalStatus | "">("PENDING");
  const q = useQuery({
    queryKey: ["approvals", status],
    queryFn: () => api.approvals.list(status || undefined),
  });

  const columns: Column<Approval>[] = [
    {
      key: "op",
      header: tr("Thao tác"),
      cell: (a) => (
        <div className="flex flex-col gap-0.5">
          <span className="font-medium">
            {OPERATION_LABEL[a.operation] ?? a.operation}
          </span>
          <Code className="w-fit">{a.operation}</Code>
        </div>
      ),
    },
    {
      key: "subject",
      header: tr("Đối tượng"),
      hideBelow: "md",
      cell: (a) => (
        <span className="font-mono text-[12px] text-ink-2">
          {a.subjectType} · {a.subjectId.slice(-8)}
        </span>
      ),
    },
    {
      key: "proposer",
      header: tr("Người đề xuất"),
      cell: (a) => (
        <span className="flex flex-col">
          <span>{a.proposer.fullName}</span>
          <span className="text-[11.5px] text-ink-2">
            {fmtDateTime(a.createdAt)}
          </span>
        </span>
      ),
    },
    {
      key: "exp",
      header: tr("Hạn / Quyết định"),
      sort: (a) => a.expiresAt,
      cell: (a) => {
        if (a.effectiveStatus === "PENDING") {
          const d = fmtDue(a.expiresAt);
          return (
            <Due overdue={d.overdue}>
              {d.overdue
                ? tr("hết hạn")
                : tr("hết hạn sau {p0}", {
                    p0: d.text.replace(/^còn | left$/g, ""),
                  })}
            </Due>
          );
        }
        return a.decidedBy ? (
          <span className="text-[12px]">
            {a.decidedBy.fullName}
            <span className="block text-ink-2">{fmtDateTime(a.decidedAt)}</span>
          </span>
        ) : (
          <span className="text-ink-2">—</span>
        );
      },
    },
    {
      key: "status",
      header: tr("Trạng thái"),
      cell: (a) => <Status group="approval" value={a.effectiveStatus} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={tr("Phê duyệt hai bước")}
        description={tr(
          "Maker–checker: đề xuất bất biến, có thời hạn; người duyệt phải khác người đề xuất; quyết định là cuối cùng và thực thi trong cùng giao dịch.",
        )}
        actions={
          can("approval.propose") && (
            <Button size="sm" asChild>
              <Link href="/admin/approvals/new">
                <Plus /> {tr("Tạo đề xuất")}
              </Link>
            </Button>
          )
        }
      />
      <PageBody>
        <Callout tone="info">
          {tr(
            "Đề xuất nghiệp vụ có thể được tạo tại hồ sơ hoặc thao tác tương ứng. Khi quy trình phê duyệt hai bước được áp dụng,",
          )}{" "}
          {tr(
            "một quản trị viên khác phải ghi quyết định trước khi thay đổi có hiệu lực.",
          )}
        </Callout>
        <div role="tablist" className="-mx-1 flex gap-1 overflow-x-auto px-1">
          {TABS.map((t) => (
            <button
              key={t || "all"}
              role="tab"
              type="button"
              aria-selected={status === t}
              onClick={() => setStatus(t)}
              className={cn(
                "h-8 shrink-0 rounded-md border px-3 text-[12.5px] font-medium",
                status === t
                  ? "border-ink bg-ink text-canvas"
                  : "border-line bg-card hover:border-line-strong",
              )}
            >
              {t
                ? {
                    PENDING: tr("Chờ duyệt"),
                    APPROVED: tr("Đã phê duyệt"),
                    REJECTED: tr("Từ chối"),
                    CANCELLED: tr("Đã hủy"),
                    EXPIRED: tr("Hết hạn"),
                  }[t]
                : tr("Tất cả")}
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            columns={columns}
            rowKey={(a) => a.id}
            href={(a) => `/admin/approvals/${a.id}`}
            empty={
              <EmptyState title={tr("Không có đề xuất")}>
                {tr("Đổi bộ lọc trạng thái để xem lịch sử.")}
              </EmptyState>
            }
          />
        </div>
      </PageBody>
    </>
  );
}

const ADMIN_ROLES: PlatformRole[] = [
  "SYSTEM_ADMIN",
  "PLATFORM_OPERATOR",
  "PLATFORM_CASE_MANAGER",
  "PLATFORM_PRIVACY_OFFICER",
];
const proposeSchema = approvalFormSchema;

export function ProposeDialog(props: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialValues?: Record<string, string | string[] | undefined>;
}) {
  const users = useQuery({ queryKey: ["users"], queryFn: api.users.list });
  const orgs = useQuery({
    queryKey: ["organizations"],
    queryFn: api.enterprises.organizations,
  });
  return (
    <CommandDialog
      {...props}
      title={tr("Tạo đề xuất phê duyệt")}
      endpoint="POST /platform-approvals"
      description={tr(
        "Một quản trị viên khác phải duyệt trước thời hạn được ghi trên đề xuất.",
      )}
      schema={proposeSchema}
      defaultValues={{
        operation: "SYSTEM_ADMIN_CREATE",
        roleCode: "PLATFORM_OPERATOR",
        reason: "",
        ...Object.fromEntries(
          Object.entries(props.initialValues ?? {}).filter(
            ([k, v]) =>
              typeof v === "string" &&
              !["temporaryPassword", "mfaCode"].includes(k),
          ),
        ),
      }}
      stepUp
      submitLabel={tr("Gửi đề xuất")}
      invalidate={[["approvals"], ["inbox"]]}
      success={tr("Đã tạo đề xuất, chờ người duyệt thứ hai")}
      wide
      run={(v, cmd) => api.approvals.propose(parseApprovalProposal(v), cmd)}
    >
      {(f) => {
        const op = f.watch("operation");
        const orgId = f.watch("organizationId") ?? "";
        return (
          <>
            <SelectField
              control={f.control}
              name="operation"
              label={tr("Thao tác")}
              options={(
                [
                  "SYSTEM_ADMIN_CREATE",
                  "ADMIN_PASSWORD_RESET",
                  "CREATE_CHAIN_GRANT",
                  "CAPABILITY_GRANT",
                  "CONNECTION_APPROVE",
                  "CAPABILITY_REQUEST_APPROVE",
                  "PLAN_VERSION_PUBLISH",
                  "INVOICE_CONFIRM_PAYMENT",
                  "SETTING_CHANGE",
                  "QR_BLOCK",
                ] as const
              ).map((o) => ({
                value: o,
                label: `${OPERATION_LABEL[o]} (${o})`,
              }))}
            />
            {op === "SYSTEM_ADMIN_CREATE" && (
              <>
                <div className="grid gap-3 sm:grid-cols-2">
                  <TextField
                    control={f.control}
                    name="email"
                    label="Email"
                    type="email"
                    autoComplete="off"
                  />
                  <TextField
                    control={f.control}
                    name="fullName"
                    label={tr("Họ tên")}
                    autoComplete="off"
                  />
                </div>
                <SelectField
                  control={f.control}
                  name="roleCode"
                  label={tr("Vai quản trị")}
                  options={ADMIN_ROLES.map((r) => ({
                    value: r,
                    label: `${ROLE_LABEL[r]} (${r})`,
                  }))}
                />
                <p className="text-[12px] text-ink-2">
                  {tr(
                    "Đề xuất không chứa mật khẩu: khi được duyệt, hệ thống sinh mật khẩu tạm và gửi qua email; tài khoản phải đổi ở lần đăng nhập đầu.",
                  )}
                </p>
              </>
            )}
            {op === "ADMIN_PASSWORD_RESET" && (
              <>
                <SelectField
                  control={f.control}
                  name="userId"
                  label={tr("Tài khoản quản trị")}
                  options={(users.data ?? [])
                    .filter((u) =>
                      ADMIN_ROLES.includes(u.role.code as PlatformRole),
                    )
                    .map((u) => ({
                      value: u.id,
                      label: `${u.fullName} · ${u.role.code}`,
                    }))}
                />
                <TextField
                  control={f.control}
                  name="temporaryPassword"
                  label={tr("Mật khẩu tạm")}
                  type="password"
                  autoComplete="new-password"
                  hint={tr("12–72 byte · chỉ lưu bcrypt hash trong đề xuất")}
                />
              </>
            )}
            {op === "CREATE_CHAIN_GRANT" && (
              <>
                <SelectField
                  control={f.control}
                  name="organizationId"
                  label={tr("Tổ chức")}
                  options={(orgs.data ?? []).map((o) => ({
                    value: o.id,
                    label: o.name,
                  }))}
                />
                <MemberSelect control={f.control} orgId={orgId} />
                <p className="text-[12px] text-ink-2">
                  {tr(
                    "Chỉ sản xuất/HTX và doanh nghiệp chuỗi được cấp CREATE_CHAIN; nhà chế biến chỉ có ORG_ADMIN.",
                  )}
                </p>
              </>
            )}
            {op === "CAPABILITY_GRANT" && (
              <>
                <SelectField
                  control={f.control}
                  name="organizationId"
                  label={tr("Tổ chức")}
                  options={(orgs.data ?? []).map((o) => ({
                    value: o.id,
                    label: o.name,
                  }))}
                />
                <SelectField
                  control={f.control}
                  name="code"
                  label={tr("Năng lực")}
                  options={[
                    "FARM",
                    "TRANSPORTER",
                    "PROCESSOR",
                    "DISTRIBUTOR",
                    "RETAILER",
                    "AUDITOR",
                  ].map((value) => ({ value, label: value }))}
                />
              </>
            )}
            {op === "CONNECTION_APPROVE" && (
              <EnrollmentSubjectFields form={f} kind="connection" />
            )}
            {op === "CAPABILITY_REQUEST_APPROVE" && (
              <EnrollmentSubjectFields form={f} kind="capability" />
            )}
            {op === "PLAN_VERSION_PUBLISH" && (
              <TextField
                control={f.control}
                name="versionId"
                label={tr("Mã phiên bản gói")}
              />
            )}
            {op === "INVOICE_CONFIRM_PAYMENT" && (
              <>
                <TextField
                  control={f.control}
                  name="invoiceId"
                  label={tr("Mã hóa đơn")}
                />
                <TextField
                  control={f.control}
                  name="reference"
                  label={tr("Tham chiếu thanh toán")}
                />
              </>
            )}
            {op === "SETTING_CHANGE" && (
              <>
                <TextField
                  control={f.control}
                  name="key"
                  label={tr("Tham số")}
                />
                <TextAreaField
                  control={f.control}
                  name="value"
                  label={tr("Giá trị JSON")}
                />
              </>
            )}
            {op === "QR_BLOCK" && (
              <>
                <TextField
                  control={f.control}
                  name="lotId"
                  label={tr("Mã lô")}
                />
                <TextAreaField
                  control={f.control}
                  name="publicMessage"
                  label={tr("Thông báo công khai")}
                />
              </>
            )}
            {[
              "CONNECTION_APPROVE",
              "CAPABILITY_REQUEST_APPROVE",
              "INVOICE_CONFIRM_PAYMENT",
              "SETTING_CHANGE",
            ].includes(op) && (
              <TextField
                control={f.control}
                name="version"
                label={tr("Phiên bản hiện tại")}
                type="number"
              />
            )}
            {["CONNECTION_APPROVE", "CAPABILITY_REQUEST_APPROVE"].includes(
              op,
            ) && (
              <TextAreaField
                control={f.control}
                name="note"
                label={tr("Ghi chú xử lý")}
              />
            )}
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do đề xuất")}
              hint={tr("10–1000 ký tự · người duyệt sẽ đọc lý do này")}
            />
          </>
        );
      }}
    </CommandDialog>
  );
}

/** Danh sách thành viên của tổ chức đã chọn (GET /platform-admin/organizations/:id). */
function MemberSelect({
  control,
  orgId,
}: {
  control: Control<z.infer<typeof proposeSchema>>;
  orgId: string;
}) {
  const org = useQuery({
    queryKey: ["scoped-users", orgId],
    queryFn: () => api.enterprises.scopedUsers(orgId),
    enabled: !!orgId,
  });
  return (
    <SelectField
      control={control}
      name="userId"
      label={tr("Thành viên được cấp quyền tạo chuỗi")}
      placeholder={orgId ? tr("Chọn…") : tr("Chọn tổ chức trước")}
      options={(org.data ?? []).map((m) => ({
        value: m.id,
        label: m.fullName,
      }))}
    />
  );
}

function EnrollmentSubjectFields({
  form,
  kind,
}: {
  form: UseFormReturn<z.infer<typeof proposeSchema>>;
  kind: "connection" | "capability";
}) {
  const q = useQuery({
      queryKey: ["enrollments"],
      queryFn: api.enterprises.enrollments,
    }),
    field = kind === "connection" ? "connectionId" : "requestId",
    id = form.watch(field),
    last = useRef<string | undefined>(undefined);
  const choices = (q.data ?? []).flatMap((e) =>
    kind === "connection"
      ? e.connections
          .filter((c) => c.status === "PENDING_REVIEW")
          .map((c) => ({
            id: c.id,
            version: c.version,
            label: `${e.organizationName} · ${String(c.publicConfig.mspId ?? c.id)}`,
          }))
      : e.capabilityRequests
          .filter((c) => c.status === "PENDING")
          .map((c) => ({
            id: c.id,
            version: c.version,
            label: `${e.organizationName} · ${c.code}`,
          })),
  );
  const selected = choices.find((c) => c.id === id);
  useEffect(() => {
    if (selected && last.current !== selected.id) {
      last.current = selected.id;
      form.setValue("version", String(selected.version));
    }
  }, [selected, form]);
  return (
    <>
      <SelectField
        control={form.control}
        name={field}
        label={
          kind === "connection"
            ? tr("Kết nối chờ xét")
            : tr("Yêu cầu năng lực chờ xét")
        }
        options={choices.map((c) => ({ value: c.id, label: c.label }))}
      />
      {q.error && (
        <p role="alert" className="text-[12px] text-danger">
          {tr("Không tải được danh sách yêu cầu. Hãy tải lại trang.")}
        </p>
      )}
    </>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale as useLedgerLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLedgerLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-approvals">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
