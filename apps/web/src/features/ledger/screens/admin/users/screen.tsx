"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useMemo, useState } from "react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { MoreHorizontal, Plus } from "lucide-react";
import { api } from "@/lib/ledger/platform-api";
import { temporaryPasswordSchema } from "@/lib/ledger/platform-approval-input";
import type { PlatformUser } from "@/lib/ledger/platform-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtAgo, fmtDateTime } from "@/lib/ledger/format";
import { reason } from "@/lib/ledger/platform-schemas";
import { Button } from "@/components/ledger/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ledger/ui/dropdown-menu";
import {
  CommandDialog,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterBar, FilterSelect } from "@/components/ledger/kit/filters";
import {
  ChoiceField,
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
import { Badge, Code, Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
const ADMIN_LIKE = [
  "SYSTEM_ADMIN",
  "PLATFORM_OPERATOR",
  "PLATFORM_CASE_MANAGER",
  "PLATFORM_PRIVACY_OFFICER",
];

const createSchema = z
  .object({
    email: z
      .string()
      .trim()
      .email({ error: () => tr("Email không hợp lệ") })
      .max(255),
    fullName: z
      .string()
      .trim()
      .min(1, { error: () => tr("Không được để trống") })
      .max(255),
    roleCode: z.string().min(1, { error: () => tr("Chọn vai") }),
    organizationId: z.string().optional(),
  })
  .refine(
    (v) =>
      !["AUDITOR", "COMPLIANCE_REVIEWER"].includes(v.roleCode) ||
      !!v.organizationId,
    {
      path: ["organizationId"],
      error: () => tr("Vai này phải thuộc một tổ chức kiểm định (AUDITOR)"),
    },
  );
const statusSchema = z.object({
  accountStatus: z.enum(["ACTIVE", "INACTIVE", "LOCKED"]),
  reason: reason(),
});
const reasonSchema = z.object({ reason: reason() });
const resetSchema = z.object({
  temporaryPassword: temporaryPasswordSchema,
  reason: reason(),
});

type Action = {
  kind: "status" | "unlock" | "reset" | "revoke";
  user: PlatformUser;
};

function PreviewScreen() {
  return (
    <Guard permission="users.read">
      <PlatformUsers />
    </Guard>
  );
}

export function PlatformUsers({
  accountId,
  createMode = false,
}: { accountId?: string; createMode?: boolean } = {}) {
  const router = useRouter();
  const { user: me } = useSession();
  const q = useQuery({ queryKey: ["users"], queryFn: api.users.list });
  const roles = useQuery({ queryKey: ["roles"], queryFn: api.users.roles });
  const orgs = useQuery({
    queryKey: ["organizations"],
    queryFn: api.enterprises.organizations,
  });
  const action = useDialog<Action>();
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("");
  const [status, setStatus] = useState("");

  const rows = useMemo(
    () =>
      q.data?.filter(
        (u) =>
          (!accountId || u.id === accountId) &&
          (!role || u.role.code === role) &&
          (!status || u.accountStatus === status) &&
          (!search ||
            `${u.fullName} ${u.email}`
              .toLowerCase()
              .includes(search.toLowerCase())),
      ),
    [q.data, role, status, search, accountId],
  );
  const invalidate = [["users"], ["approvals"], ["inbox"]];

  const columns: Column<PlatformUser>[] = [
    {
      key: "name",
      header: tr("Tài khoản"),
      sort: (u) => u.fullName,
      cell: (u) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">
            {u.fullName}{" "}
            {u.id === me?.id && (
              <span className="text-[11.5px] font-normal text-ink-2">
                {tr("(bạn)")}
              </span>
            )}
          </span>
          <span className="truncate font-mono text-[11.5px] text-ink-2">
            {u.email}
          </span>
        </div>
      ),
    },
    {
      key: "role",
      header: "Vai",
      sort: (u) => u.role.code,
      cell: (u) => <Code>{u.role.code}</Code>,
    },
    {
      key: "org",
      header: tr("Tổ chức"),
      hideBelow: "md",
      cell: (u) => (
        <span className="text-ink-2">
          {u.organization?.name ?? tr("Nền tảng")}
        </span>
      ),
    },
    {
      key: "status",
      header: tr("Trạng thái"),
      cell: (u) => (
        <div className="flex flex-wrap gap-1">
          <Status group="account" value={u.accountStatus} />
          {u.lockedUntil && Date.parse(u.lockedUntil) > Date.now() && (
            <Badge tone="danger" dot={false}>
              {tr("khóa tạm đến")} {fmtDateTime(u.lockedUntil).slice(0, 5)}
            </Badge>
          )}
          {u.mustChangePassword && (
            <Badge tone="warn" dot={false}>
              {tr("phải đổi mật khẩu")}
            </Badge>
          )}
        </div>
      ),
    },
    {
      key: "updated",
      header: tr("Cập nhật"),
      hideBelow: "lg",
      sort: (u) => u.updatedAt,
      cell: (u) => (
        <span className="text-[12px] text-ink-2">
          {fmtAgo(u.updatedAt)} ·{" "}
          <span className="font-mono">v{u.version}</span>
        </span>
      ),
    },
    {
      key: "act",
      header: <span className="sr-only">{tr("Thao tác")}</span>,
      className: "w-10 text-right",
      cell: (u) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={tr("Thao tác với {p0}", { p0: u.fullName })}
              onClick={(e) => e.stopPropagation()}
            >
              <MoreHorizontal />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
            <DropdownMenuItem
              onSelect={() => action.open({ kind: "status", user: u })}
            >
              {tr("Đổi trạng thái tài khoản")}
            </DropdownMenuItem>
            <DropdownMenuItem
              disabled={u.accountStatus !== "LOCKED" && !u.lockedUntil}
              onSelect={() => action.open({ kind: "unlock", user: u })}
            >
              {tr("Mở khóa")}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => action.open({ kind: "reset", user: u })}
            >
              {tr("Đặt mật khẩu tạm")}
            </DropdownMenuItem>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              onSelect={() => action.open({ kind: "revoke", user: u })}
            >
              {tr("Thu hồi mọi phiên")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];

  const a = action.target;
  const roleOptions = (roles.data ?? []).map((r) => ({
    value: r.code,
    label: `${r.name} (${r.code})`,
  }));

  return (
    <>
      <PageHeader
        title={
          createMode
            ? tr("Tạo tài khoản nền tảng")
            : accountId
              ? (q.data?.find((u) => u.id === accountId)?.fullName ??
                tr("Tài khoản"))
              : tr("Tài khoản nền tảng")
        }
        description={tr(
          "Tài khoản quản trị và tài khoản thuộc tổ chức kiểm định. Mọi thay đổi cần lý do, version hiện tại và được ghi nhật ký; khóa tài khoản thu hồi mọi phiên trong cùng giao dịch.",
        )}
        actions={
          <Button size="sm" asChild>
            <Link href="/admin/users/new">
              <Plus /> {tr("Tạo tài khoản")}
            </Link>
          </Button>
        }
      />
      <PageBody>
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder={tr("Tên hoặc email")}
          active={!!(search || role || status)}
          onReset={() => (setSearch(""), setRole(""), setStatus(""))}
        >
          <FilterSelect
            label="Vai"
            value={role}
            onChange={setRole}
            options={roleOptions}
          />
          <FilterSelect
            label={tr("Trạng thái")}
            value={status}
            onChange={setStatus}
            options={[
              { value: "ACTIVE", label: tr("Hoạt động") },
              { value: "INACTIVE", label: tr("Vô hiệu hóa") },
              { value: "LOCKED", label: tr("Bị khóa") },
            ]}
          />
        </FilterBar>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={rows}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            columns={columns}
            rowKey={(u) => u.id}
            href={accountId ? undefined : (u) => `/admin/users/${u.id}`}
            empty={<EmptyState title={tr("Không có tài khoản phù hợp")} />}
          />
        </div>
        <p className="text-[12px] text-ink-2">
          {tr(
            "Tài khoản hiện hữu không có thao tác đổi vai trò. Trạng thái MFA từng tài khoản xem ở",
          )}{" "}
          <Link
            className="text-brand hover:underline"
            href="/admin/security-alerts"
          >
            {tr("Cảnh báo bảo mật")}
          </Link>
          .
        </p>
      </PageBody>

      <CommandDialog
        open={createMode}
        onOpenChange={(open) => {
          if (!open) router.push("/admin/users");
        }}
        title={tr("Tạo tài khoản")}
        endpoint="POST /users"
        description={tr(
          "Mật khẩu tạm do hệ thống tạo và gửi; tài khoản phải đổi ở lần đăng nhập đầu. Tạo tài khoản quản trị có thể cần người quản trị thứ hai phê duyệt.",
        )}
        schema={createSchema}
        defaultValues={{
          email: "",
          fullName: "",
          roleCode: "PLATFORM_OPERATOR",
        }}
        submitLabel={tr("Tạo tài khoản")}
        invalidate={invalidate}
        proposal={{
          operation: "SYSTEM_ADMIN_CREATE",
          params: (v) => ({
            email: v.email,
            fullName: v.fullName,
            roleCode: v.roleCode,
          }),
          reason: (v) =>
            tr("Tạo tài khoản {p0} cho {p1}", {
              p0: v.roleCode,
              p1: v.fullName,
            }),
        }}
        run={(v, cmd) =>
          api.users.create(
            {
              email: v.email,
              fullName: v.fullName,
              roleCode: v.roleCode,
              organizationId: v.organizationId || undefined,
            },
            cmd,
          )
        }
      >
        {(f) => {
          const rc = f.watch("roleCode");
          return (
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
                label="Vai"
                options={roleOptions}
              />
              {["AUDITOR", "COMPLIANCE_REVIEWER"].includes(rc) && (
                <SelectField
                  control={f.control}
                  name="organizationId"
                  label={tr("Tổ chức kiểm định")}
                  options={(orgs.data ?? [])
                    .filter((o) => o.type === "AUDITOR")
                    .map((o) => ({ value: o.id, label: o.name }))}
                  placeholder={tr("Chọn tổ chức AUDITOR")}
                />
              )}
              {ADMIN_LIKE.includes(rc) && (
                <Callout tone="info">
                  {tr(
                    "Tài khoản quản trị có thể cần phê duyệt hai bước. Khi được yêu cầu, bạn có thể gửi đề xuất tại đây.",
                  )}
                </Callout>
              )}
            </>
          );
        }}
      </CommandDialog>

      {a?.kind === "status" && (
        <CommandDialog
          {...action.props}
          title={tr("Đổi trạng thái · {p0}", { p0: a.user.fullName })}
          endpoint="PATCH /users/:id/status"
          description={tr(
            "Không tự khóa chính mình; không vô hiệu hóa quản trị viên hoạt động cuối cùng. Khóa/vô hiệu hóa thu hồi mọi refresh session.",
          )}
          schema={statusSchema}
          defaultValues={{ accountStatus: a.user.accountStatus, reason: "" }}
          version={a.user.version}
          submitLabel={tr("Ghi trạng thái")}
          invalidate={invalidate}
          run={(v, cmd) =>
            api.users.setStatus(
              a.user.id,
              { ...v, version: a.user.version },
              cmd,
            )
          }
        >
          {(f) => (
            <>
              <ChoiceField
                control={f.control}
                name="accountStatus"
                label={tr("Trạng thái mới")}
                options={[
                  { value: "ACTIVE", label: tr("Hoạt động") },
                  {
                    value: "INACTIVE",
                    label: tr("Vô hiệu hóa"),
                    tone: "danger",
                  },
                  {
                    value: "LOCKED",
                    label: tr("Khóa"),
                    help: tr("Khóa thủ công cho tới khi quản trị viên mở."),
                    tone: "danger",
                  },
                ]}
              />
              <TextAreaField
                control={f.control}
                name="reason"
                label={tr("Lý do")}
              />
            </>
          )}
        </CommandDialog>
      )}
      {a?.kind === "unlock" && (
        <CommandDialog
          {...action.props}
          title={tr("Mở khóa · {p0}", { p0: a.user.fullName })}
          endpoint="POST /users/:id/unlock"
          schema={reasonSchema}
          defaultValues={{ reason: "" }}
          version={a.user.version}
          submitLabel={tr("Mở khóa")}
          invalidate={invalidate}
          run={(v, cmd) =>
            api.users.unlock(a.user.id, { ...v, version: a.user.version }, cmd)
          }
        >
          {(f) => (
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do")}
            />
          )}
        </CommandDialog>
      )}
      {a?.kind === "reset" && (
        <CommandDialog
          {...action.props}
          title={tr("Đặt mật khẩu tạm · {p0}", { p0: a.user.fullName })}
          endpoint="POST /users/:id/reset-password"
          description={tr(
            "Tài khoản phải đổi mật khẩu tạm trước khi tiếp tục sử dụng. Đặt lại mật khẩu quản trị có thể cần một quản trị viên khác phê duyệt.",
          )}
          schema={resetSchema}
          defaultValues={{ temporaryPassword: "", reason: "" }}
          version={a.user.version}
          tone="danger"
          submitLabel={tr("Đặt mật khẩu tạm")}
          invalidate={invalidate}
          proposal={
            ADMIN_LIKE.includes(a.user.role.code)
              ? {
                  operation: "ADMIN_PASSWORD_RESET",
                  params: (v) => ({
                    userId: a.user.id,
                    temporaryPassword: v.temporaryPassword,
                  }),
                  reason: (v) => v.reason,
                }
              : undefined
          }
          run={(v, cmd) =>
            api.users.resetPassword(
              a.user.id,
              { ...v, version: a.user.version },
              cmd,
            )
          }
        >
          {(f) => (
            <>
              <TextField
                control={f.control}
                name="temporaryPassword"
                label={tr("Mật khẩu tạm")}
                type="password"
                autoComplete="new-password"
                hint={tr("12–72 byte UTF-8")}
              />
              <TextAreaField
                control={f.control}
                name="reason"
                label={tr("Lý do")}
              />
            </>
          )}
        </CommandDialog>
      )}
      {a?.kind === "revoke" && (
        <CommandDialog
          {...action.props}
          title={tr("Thu hồi phiên · {p0}", { p0: a.user.fullName })}
          endpoint="POST /users/:id/revoke-sessions"
          description={tr("Đăng xuất tài khoản khỏi mọi thiết bị.")}
          schema={reasonSchema}
          defaultValues={{ reason: "" }}
          tone="danger"
          submitLabel={tr("Thu hồi phiên")}
          invalidate={invalidate}
          success={(r) =>
            tr("Đã thu hồi {p0} phiên", {
              p0: (r as { sessionsRevoked: number }).sessionsRevoked,
            })
          }
          run={(v, cmd) => api.users.revokeSessions(a.user.id, v, cmd)}
        >
          {(f) => (
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do")}
            />
          )}
        </CommandDialog>
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
    <LedgerRouteScreen route={route} name="admin-users">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
