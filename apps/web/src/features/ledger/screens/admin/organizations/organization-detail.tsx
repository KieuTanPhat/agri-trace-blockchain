"use client";

import Link from "next/link";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { api } from "@/lib/ledger/platform-api";
import { chainApi } from "@/lib/ledger/chain-api";
import type { OrganizationDetail } from "@/lib/ledger/platform-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "@/lib/ledger/format";
import {
  CAPABILITY_LABEL,
  MODEL_LABEL,
  ORG_TYPE_LABEL,
} from "@/lib/ledger/labels";
import { reason } from "@/lib/ledger/platform-schemas";
import { Button } from "@/components/ledger/ui/button";
import {
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
} from "@/components/ledger/ui/tabs";
import {
  CommandDialog,
  useDialog,
} from "@/components/ledger/kit/command-dialog";
import {
  ChoiceField,
  SelectField,
  TextAreaField,
  TextField,
} from "@/components/ledger/kit/form-fields";
import {
  EmptyState,
  ErrorState,
  Field,
  Fields,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
} from "@/components/ledger/kit/page";
import { Code, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const updateSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, { error: () => tr("Không được để trống") })
    .max(255),
  status: z.enum(["ACTIVE", "INACTIVE"]),
  reason: reason(),
});
const renewalSchema = z.object({
  planCode: z
    .string()
    .regex(/^[A-Z][A-Z0-9_]{1,29}$/, { error: () => tr("Chọn gói") }),
  reason: reason(),
});
const grantSchema = z.object({
  code: z.enum([
    "FARM",
    "TRANSPORTER",
    "PROCESSOR",
    "DISTRIBUTOR",
    "RETAILER",
    "AUDITOR",
  ]),
});

export function OrganizationDetailView({ id }: { id: string }) {
  const { can } = useSession();
  const q = useQuery({
    queryKey: ["organization", id],
    queryFn: () => api.enterprises.organization(id),
  });
  const plans = useQuery({
    queryKey: ["plans"],
    queryFn: api.billing.plans,
    enabled: can("billing.write"),
  });
  const edit = useDialog();
  const renew = useDialog();
  const grant = useDialog();

  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={10} className="p-8" />;
  const o = q.data;
  const invalidate = [["organization", id], ["directory"], ["inbox"]];

  return (
    <>
      <PageHeader
        crumbs={[
          { href: "/admin/organizations", label: tr("Danh bạ tổ chức") },
          { label: o.name },
        ]}
        title={o.name}
        meta={
          <>
            <Status group="org" value={o.status} />
            {o.enrollment && (
              <Status group="enrollment" value={o.enrollment.stage} />
            )}
          </>
        }
        description={
          <>
            {ORG_TYPE_LABEL[o.type]} ·{" "}
            {o.participationModel ? MODEL_LABEL[o.participationModel] : "—"} ·{" "}
            {o.profile?.province ?? "—"} · tham gia {fmtDate(o.createdAt)} ·{" "}
            <span className="font-mono">version {o.version}</span>
          </>
        }
        actions={
          <>
            {o.enrollment && (
              <Button variant="outline" size="sm" asChild>
                <Link href={`/admin/enterprises/${o.enrollment.id}`}>
                  {tr("Hồ sơ đăng ký")}
                </Link>
              </Button>
            )}
            {can("capability.grant") && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => grant.open(true)}
              >
                {tr("Cấp năng lực")}
              </Button>
            )}
            {can("billing.write") && o.billing.subscription && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => renew.open(true)}
              >
                {tr("Hóa đơn gia hạn")}
              </Button>
            )}
            {can("organization.update") && (
              <Button size="sm" onClick={() => edit.open(true)}>
                {tr("Sửa tên / trạng thái")}
              </Button>
            )}
          </>
        }
      />
      <PageBody wide>
        <Tabs defaultValue="overview" className="gap-4">
          <TabsList className="h-9 w-full justify-start overflow-x-auto sm:w-auto">
            <TabsTrigger value="overview">{tr("Tổng quan")}</TabsTrigger>
            <TabsTrigger value="billing">{tr("Gói & hóa đơn")}</TabsTrigger>
            <TabsTrigger value="members">
              {tr("Thành viên (")}
              {o.members.length})
            </TabsTrigger>
            <TabsTrigger value="incidents">
              {tr("Sự cố & hỗ trợ (")}
              {o.cases.length + o.tickets.length})
            </TabsTrigger>
            <TabsTrigger value="audit">
              {tr("Nhật ký (")}
              {o.audit.length})
            </TabsTrigger>
          </TabsList>
          <TabsContent value="overview" className="flex flex-col gap-5">
            <Overview o={o} />
          </TabsContent>
          <TabsContent value="billing" className="flex flex-col gap-5">
            <Billing o={o} />
          </TabsContent>
          <TabsContent value="members">
            <Section
              title={tr("Thành viên")}
              aside={tr(
                "Quản lý thành viên thuộc không gian doanh nghiệp; nền tảng chỉ xem.",
              )}
            >
              <div className="overflow-x-auto">
                <table className="w-full min-w-[640px] text-[13px]">
                  <thead>
                    <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-2">
                      <th className="h-9 px-4 font-semibold">{tr("Họ tên")}</th>
                      <th className="px-3 font-semibold">Email</th>
                      <th className="px-3 font-semibold">Vai</th>
                      <th className="px-3 font-semibold">{tr("Cấp")}</th>
                      <th className="px-4 font-semibold">{tr("Trạng thái")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {o.members.map((m) => (
                      <tr
                        key={m.id}
                        className="border-b border-line/70 last:border-0"
                      >
                        <td className="h-10 px-4 font-medium">{m.fullName}</td>
                        <td className="px-3 font-mono text-[12px]">
                          {m.email}
                        </td>
                        <td className="px-3">
                          <Code>{m.role}</Code>
                        </td>
                        <td className="px-3 font-mono text-[12px]">
                          {m.enterpriseTier ?? "—"}
                        </td>
                        <td className="px-4">
                          <Status group="account" value={m.accountStatus} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Section>
          </TabsContent>
          <TabsContent value="incidents" className="grid gap-5 lg:grid-cols-2">
            <Section title={tr("Hồ sơ sự cố")}>
              {o.cases.length ? (
                <ul className="divide-y divide-line/70">
                  {o.cases.map((c) => (
                    <li key={c.id}>
                      <Link
                        href={`/admin/cases/${c.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] hover:bg-row-alt sm:px-5"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-ink-2">
                            #{c.caseNumber}
                          </span>{" "}
                          {c.title}
                        </span>
                        <span className="flex shrink-0 gap-1.5">
                          <Status group="severity" value={c.severity} />
                          <Status group="case" value={c.status} />
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={tr("Không có hồ sơ sự cố")} />
              )}
            </Section>
            <Section title={tr("Yêu cầu hỗ trợ")}>
              {o.tickets.length ? (
                <ul className="divide-y divide-line/70">
                  {o.tickets.map((t) => (
                    <li key={t.id}>
                      <Link
                        href={`/admin/support?id=${t.id}`}
                        className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] hover:bg-row-alt sm:px-5"
                      >
                        <span className="min-w-0 truncate">
                          <span className="font-mono text-ink-2">{t.code}</span>{" "}
                          {t.subject}
                        </span>
                        <Status group="ticket" value={t.status} />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={tr("Không có yêu cầu hỗ trợ")} />
              )}
            </Section>
          </TabsContent>
          <TabsContent value="audit">
            <Section
              title={tr("Nhật ký kiểm toán liên quan")}
              aside={
                <Link
                  className="text-brand hover:underline"
                  href={`/admin/audit-log?organizationId=${o.id}`}
                >
                  {tr("Mở trong Nhật ký kiểm toán →")}
                </Link>
              }
            >
              {o.audit.length ? (
                <ul className="divide-y divide-line/70">
                  {o.audit.map((a) => (
                    <li
                      key={a.sequence}
                      className="grid grid-cols-[70px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-[13px] sm:grid-cols-[80px_200px_minmax(0,1fr)_140px] sm:px-5"
                    >
                      <span className="font-mono text-[12px] text-ink-2">
                        #{a.sequence}
                      </span>
                      <span className="font-mono text-[12px]">{a.action}</span>
                      <span className="hidden truncate text-ink-2 sm:block">
                        {a.reason ?? "—"}
                      </span>
                      <span className="font-mono text-[12px] text-ink-2">
                        {fmtDateTime(a.occurredAt)}
                      </span>
                    </li>
                  ))}
                </ul>
              ) : (
                <EmptyState title={tr("Chưa có bản ghi")} />
              )}
            </Section>
          </TabsContent>
        </Tabs>
      </PageBody>

      <CommandDialog
        {...edit.props}
        title={tr("Sửa tên hoặc trạng thái tổ chức")}
        endpoint="PATCH /organizations/:id"
        description={tr(
          "Ngừng hoạt động tổ chức sẽ thu hồi phiên của mọi tài khoản thuộc tổ chức.",
        )}
        schema={updateSchema}
        defaultValues={{ name: o.name, status: o.status, reason: "" }}
        version={o.version}
        submitLabel={tr("Ghi thay đổi")}
        invalidate={invalidate}
        run={(v, cmd) =>
          api.enterprises.updateOrganization(
            id,
            {
              name: v.name !== o.name ? v.name : undefined,
              status: v.status !== o.status ? v.status : undefined,
              reason: v.reason,
              version: o.version,
            },
            cmd,
          )
        }
      >
        {(f) => (
          <>
            <TextField
              control={f.control}
              name="name"
              label={tr("Tên tổ chức")}
              max={255}
            />
            <ChoiceField
              control={f.control}
              name="status"
              label={tr("Trạng thái")}
              options={[
                { value: "ACTIVE", label: tr("Hoạt động") },
                {
                  value: "INACTIVE",
                  label: tr("Ngừng hoạt động"),
                  help: tr("Thu hồi phiên các tài khoản của tổ chức."),
                  tone: "danger",
                },
              ]}
            />
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do")}
              hint={tr("10–1000 ký tự")}
            />
          </>
        )}
      </CommandDialog>

      <CommandDialog
        {...renew.props}
        title={tr("Phát hành hóa đơn gia hạn")}
        endpoint="POST /platform-billing/organizations/:id/renewal-invoices"
        description={tr(
          "Khi kỳ đã trả còn hiệu lực chỉ gia hạn được cùng gói; đổi gói sau khi kỳ hiện tại kết thúc. Hóa đơn gia hạn nối kỳ từ ngày hết hạn hiện tại.",
        )}
        schema={renewalSchema}
        defaultValues={{
          planCode: o.billing.subscription?.planCode ?? "",
          reason: "",
        }}
        submitLabel={tr("Phát hành hóa đơn")}
        invalidate={[...invalidate, ["invoices"]]}
        run={(v, cmd) => api.billing.renewal(id, v, cmd)}
      >
        {(f) => (
          <>
            <SelectField
              control={f.control}
              name="planCode"
              label={tr("Gói")}
              options={(plans.data ?? []).map((p) => ({
                value: p.code,
                label: `${p.name} (${p.code})`,
              }))}
            />
            <TextAreaField
              control={f.control}
              name="reason"
              label={tr("Lý do")}
            />
          </>
        )}
      </CommandDialog>

      <CommandDialog
        {...grant.props}
        title={tr("Cấp năng lực")}
        endpoint="POST /organizations/:id/capabilities"
        schema={grantSchema}
        defaultValues={{ code: "PROCESSOR" }}
        submitLabel={tr("Cấp năng lực")}
        invalidate={invalidate}
        success={tr("Đã cấp năng lực")}
        run={(v, cmd) => chainApi.capability(id, { code: v.code }, cmd)}
      >
        {(f) => (
          <>
            <SelectField
              control={f.control}
              name="code"
              label={tr("Năng lực")}
              options={Object.entries(CAPABILITY_LABEL).map(
                ([value, label]) => ({ value, label: `${label} (${value})` }),
              )}
            />
          </>
        )}
      </CommandDialog>
    </>
  );
}

function Overview({ o }: { o: OrganizationDetail }) {
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Section title={tr("Hồ sơ pháp lý")}>
          <Fields>
            <Field label={tr("Loại hình")}>{o.profile?.legalForm}</Field>
            <Field label={tr("Người đại diện")}>
              {o.profile?.representative}
            </Field>
            <Field label={tr("Email liên hệ")}>{o.profile?.contactEmail}</Field>
            <Field label={tr("Điện thoại")}>{o.profile?.phone}</Field>
            <Field label={tr("Địa chỉ")} className="sm:col-span-2">
              {o.profile?.address}
            </Field>
          </Fields>
        </Section>
        <Section
          title={tr("Năng lực")}
          aside={tr("Năng lực đã cấp và yêu cầu đang chờ")}
        >
          <ul className="divide-y divide-line/70">
            {o.capabilities.map((c) => (
              <li
                key={c.code}
                className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5"
              >
                <span className="flex items-center gap-2">
                  <Code>{c.code}</Code> {CAPABILITY_LABEL[c.code]}
                </span>
                <span className="text-[12px] text-ink-2">
                  {c.revokedAt
                    ? tr("thu hồi {p0}", { p0: fmtDate(c.revokedAt) })
                    : tr("cấp {p0}", { p0: fmtDate(c.createdAt) })}{" "}
                  · rev {c.revision}
                </span>
              </li>
            ))}
            {o.capabilityRequests
              .filter((c) => c.status === "PENDING")
              .map((c) => (
                <li
                  key={c.id}
                  className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5"
                >
                  <span className="flex items-center gap-2">
                    <Code>{c.code}</Code> {CAPABILITY_LABEL[c.code]}
                  </span>
                  <Status group="request" value={c.status} />
                </li>
              ))}
            {!o.capabilities.length && !o.capabilityRequests.length && (
              <li className="px-5 py-3 text-[13px] text-ink-2">
                {tr("Chưa có năng lực.")}
              </li>
            )}
          </ul>
        </Section>
      </div>
      <div className="flex flex-col gap-5">
        <Section title={tr("Hoạt động")}>
          <dl className="grid grid-cols-2 divide-x divide-line border-b border-line/70 text-center">
            <div className="py-3">
              <dt className="text-[12px] text-ink-2">{tr("Lô đã tạo")}</dt>
              <dd className="font-mono text-[20px]">
                {fmtNumber(o.activity.lots)}
              </dd>
            </div>
            <div className="py-3">
              <dt className="text-[12px] text-ink-2">{tr("Lệnh chế biến")}</dt>
              <dd className="font-mono text-[20px]">
                {fmtNumber(o.activity.processingRuns)}
              </dd>
            </div>
          </dl>
          <div className="flex flex-col gap-2 px-4 py-3 text-[13px] sm:px-5">
            <span className="label-caps">{tr("Chuỗi sở hữu")}</span>
            {o.chains.owned.length ? (
              o.chains.owned.map((c) => (
                <span key={c.id} className="flex justify-between gap-2">
                  <span>
                    {c.name}{" "}
                    <span className="font-mono text-[12px] text-ink-2">
                      {c.code}
                    </span>
                  </span>
                  <Status group="chain" value={c.state ?? "NONE"} />
                </span>
              ))
            ) : (
              <span className="text-ink-2">—</span>
            )}
            <span className="label-caps mt-2">Tham gia</span>
            {o.chains.memberships.length ? (
              o.chains.memberships.map((c) => (
                <span key={c.chainId}>{c.name}</span>
              ))
            ) : (
              <span className="text-ink-2">—</span>
            )}
            <span className="label-caps mt-2">{tr("Cơ sở")}</span>
            {o.sites.length ? (
              o.sites.map((s) => (
                <span key={s.id}>
                  {s.name}{" "}
                  <span className="font-mono text-[12px] text-ink-2">
                    {s.kind}
                  </span>
                </span>
              ))
            ) : (
              <span className="text-ink-2">—</span>
            )}
          </div>
        </Section>
      </div>
    </div>
  );
}

function Billing({ o }: { o: OrganizationDetail }) {
  const s = o.billing.subscription;
  const limits = o.billing.limits ?? {};
  const usage = o.billing.usage ?? {};
  return (
    <>
      <Section
        title={tr("Gói dịch vụ")}
        aside={
          o.billing.paying
            ? tr("Tổ chức trả phí")
            : tr("Tham gia miễn phí · hạn mức dành cho thành viên")
        }
      >
        {s ? (
          <Fields cols={4}>
            <Field label={tr("Gói")}>
              {s.planName}{" "}
              <span className="font-mono text-[12px] text-ink-2">
                v{s.planVersion.version}
              </span>
            </Field>
            <Field label={tr("Hiệu lực")}>
              <Status group="subscription" value={s.effectiveStatus} />
            </Field>
            <Field label={tr("Kết thúc")}>
              {fmtDate(s.endsAt)}{" "}
              {s.daysRemaining !== null && (
                <span className="text-ink-2">
                  ({s.daysRemaining} {tr("ngày)")}
                </span>
              )}
            </Field>
            <Field label={tr("Hết ân hạn")}>{fmtDate(s.graceEndsAt)}</Field>
          </Fields>
        ) : (
          <p className="px-5 py-3 text-[13px] text-ink-2">
            {o.billing.paying
              ? tr("Chưa có gói đang hiệu lực.")
              : tr("Không áp dụng gói trả phí.")}
          </p>
        )}
        <div className="grid grid-cols-2 gap-x-6 gap-y-3 border-t border-line/70 px-4 py-4 sm:grid-cols-4 sm:px-5">
          {(["products", "chains", "members"] as const).map((k) => {
            const lim = limits[k];
            const used = usage[k] ?? 0;
            const pct = lim ? Math.min(100, (used / lim) * 100) : 0;
            return (
              <div key={k} className="flex flex-col gap-1.5 text-[12px]">
                <span className="text-ink-2">
                  {
                    {
                      products: tr("Sản phẩm"),
                      chains: tr("Chuỗi"),
                      members: tr("Thành viên"),
                    }[k]
                  }
                </span>
                <span className="font-mono text-[13px]">
                  {fmtNumber(used)} / {lim === undefined ? "—" : fmtNumber(lim)}
                </span>
                <div className="h-1.5 rounded-full bg-sunken" aria-hidden>
                  <div
                    className={cn(
                      "h-full rounded-full",
                      pct >= 90
                        ? "bg-danger"
                        : pct >= 70
                          ? "bg-warn-dot"
                          : "bg-brand",
                    )}
                    style={{ width: `${pct}%` }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </Section>
      <Section
        title={tr("Hóa đơn")}
        aside={
          <Link
            className="text-brand hover:underline"
            href={`/admin/billing/invoices?organizationId=${o.id}`}
          >
            {tr("Mở trong Hóa đơn →")}
          </Link>
        }
      >
        {o.billing.invoices.length ? (
          <ul className="divide-y divide-line/70">
            {o.billing.invoices.map((i) => (
              <li
                key={i.id}
                className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5 text-[13px] sm:px-5"
              >
                <span className="font-mono">{i.number}</span>
                <span className="text-ink-2">
                  {i.kind === "INITIAL" ? tr("Khởi tạo") : tr("Gia hạn")}{" "}
                  {tr("· hạn")} {fmtDate(i.dueAt)}
                </span>
                <span className="font-mono">{fmtMoney(i.amount)}</span>
                <Status group="invoice" value={i.status} />
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={tr("Chưa có hóa đơn")} />
        )}
      </Section>
    </>
  );
}
