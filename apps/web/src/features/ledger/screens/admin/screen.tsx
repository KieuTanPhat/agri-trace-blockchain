"use client";

import Link from "next/link";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { api } from "@/lib/ledger/platform-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtDate, fmtDateTime, fmtMoney, fmtNumber } from "@/lib/ledger/format";
import {
  CAPABILITY_LABEL,
  INBOX_KIND_LABEL,
  MODEL_LABEL,
} from "@/lib/ledger/labels";
import { Guard } from "@/components/ledger/kit/guard";
import {
  ErrorState,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
  Stat,
  StatRow,
} from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
function PreviewScreen() {
  return (
    <Guard permission="dashboard.read">
      <Overview />
    </Guard>
  );
}

function Bars({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort((a, b) => b[1] - a[1]);
  const max = Math.max(...entries.map((e) => e[1]), 1);
  return (
    <ul className="flex flex-col gap-2 px-4 py-3 sm:px-5">
      {entries.map(([k, v]) => (
        <li
          key={k}
          className="grid grid-cols-[110px_minmax(0,1fr)_36px] items-center gap-3 text-[12.5px]"
        >
          <span className="truncate text-ink-2">
            {CAPABILITY_LABEL[k] ?? MODEL_LABEL[k] ?? k}
          </span>
          <span className="h-2 rounded-full bg-sunken" aria-hidden>
            <span
              className="block h-full rounded-full bg-brand"
              style={{ width: `${(v / max) * 100}%` }}
            />
          </span>
          <span className="text-right font-mono">{v}</span>
        </li>
      ))}
    </ul>
  );
}

function Overview() {
  const { can } = useSession();
  const q = useQuery({
    queryKey: ["dashboard"],
    queryFn: api.workbench.dashboard,
  });
  const stats = useQuery({
    queryKey: ["statistics"],
    queryFn: api.ops.statistics,
    enabled: can("statistics.read"),
  });
  const isAdmin = can("operations.adminSummary");
  const summary = useQuery({
    queryKey: ["admin-summary"],
    queryFn: api.ops.adminSummary,
    enabled: isAdmin,
  });
  const s = summary.data;
  if (q.error)
    return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  const d = q.data;
  return (
    <>
      <PageHeader
        title={tr("Tổng quan nền tảng")}
        description={
          d
            ? tr(
                "Ảnh chụp lúc {p0}. Chỉ đọc; số liệu sổ cái là trạng thái trong DB, không phải bằng chứng Fabric.",
                { p0: fmtDateTime(d.generatedAt) },
              )
            : tr("Đang tải…")
        }
      />
      <PageBody wide>
        {!d ? (
          <LoadingRows rows={10} />
        ) : (
          <>
            <StatRow>
              <Stat
                label={tr("Việc chờ quyết định")}
                value={d.pending.total}
                hint={tr("{p0} quá hạn", { p0: d.pending.overdue })}
                tone={d.pending.overdue ? "danger" : undefined}
                href="/admin/inbox"
              />
              <Stat
                label={tr("Thu tháng này")}
                value={fmtMoney(d.billing.monthRevenue)}
                hint={tr("+ {p0} mô phỏng", {
                  p0: fmtMoney(d.billing.monthSimulated),
                })}
                href="/admin/billing"
              />
              <Stat
                label={tr("Chờ thanh toán")}
                value={fmtMoney(d.billing.outstanding)}
                href="/admin/billing/invoices"
              />
              <Stat
                label={tr("Lô / đã chế biến")}
                value={`${fmtNumber(d.traceability.lots)} / ${fmtNumber(d.traceability.processedLots)}`}
                hint={tr("{p0} lượt quét 7 ngày", {
                  p0: fmtNumber(d.traceability.scans7Days),
                })}
              />
              <Stat
                label={tr("QR đang khóa")}
                value={d.traceability.blockedQr}
                tone={d.traceability.blockedQr ? "warn" : undefined}
                href="/admin/lots"
              />
            </StatRow>
            {isAdmin && s && (
              <Section
                title={tr("Việc quản trị cần theo dõi")}
                aside={
                  <span className="font-mono text-[11px]">
                    {fmtDateTime(s.generatedAt)}
                  </span>
                }
              >
                <dl className="grid grid-cols-2 divide-line/70 sm:grid-cols-4 lg:grid-cols-7 lg:divide-x">
                  {[
                    {
                      label: tr("Đề xuất chờ duyệt"),
                      value: s.pendingApprovals,
                      href: "/admin/approvals",
                    },
                    {
                      label: tr("Sự cố đang mở"),
                      value: s.openCases,
                      href: "/admin/cases",
                    },
                    {
                      label: tr("Sự cố quá hạn phản hồi"),
                      value: s.overdueCases,
                      href: "/admin/cases",
                      danger: true,
                    },
                    {
                      label: tr("Yêu cầu quyền dữ liệu"),
                      value: s.privacyRequests,
                      href: "/admin/privacy",
                    },
                    {
                      label: tr("Vi phạm chờ báo cáo"),
                      value: s.breachReportsDue,
                      href: "/admin/privacy",
                      warn: true,
                    },
                    {
                      label: tr("Vi phạm quá hạn 72 giờ"),
                      value: s.breachReportsOverdue,
                      href: "/admin/privacy",
                      danger: true,
                    },
                    {
                      label: tr("Tài khoản đang khóa"),
                      value: s.lockedAccounts,
                      href: "/admin/users",
                      warn: true,
                    },
                  ].map((x) => (
                    <Link
                      key={x.label}
                      href={x.href}
                      className="flex flex-col gap-1 px-4 py-3 hover:bg-sunken"
                    >
                      <dt className="text-[11.5px] text-ink-2">{x.label}</dt>
                      <dd
                        className={cn(
                          "font-mono text-[20px]",
                          x.value > 0 && x.danger && "text-danger",
                          x.value > 0 && x.warn && "text-warn",
                        )}
                      >
                        {fmtNumber(x.value)}
                      </dd>
                    </Link>
                  ))}
                </dl>
              </Section>
            )}
            <div className="grid gap-5 lg:grid-cols-3">
              <Section
                title={tr("Hàng đợi theo loại")}
                aside={
                  <Link
                    className="text-brand hover:underline"
                    href="/admin/inbox"
                  >
                    {tr("Mở hàng đợi →")}
                  </Link>
                }
              >
                <ul className="divide-y divide-line/70">
                  {(
                    Object.keys(
                      INBOX_KIND_LABEL,
                    ) as (keyof typeof INBOX_KIND_LABEL)[]
                  ).map((k) => (
                    <li
                      key={k}
                      className="flex items-center justify-between px-4 py-2 text-[13px] sm:px-5"
                    >
                      <span>{INBOX_KIND_LABEL[k]}</span>
                      <span className="font-mono">
                        {d.pending[k as keyof typeof d.pending] ?? 0}
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
              <Section title={tr("Năng lực đang hiệu lực")}>
                <Bars data={d.organizations.capabilities} />
                <div className="border-t border-line/70">
                  <Bars data={d.organizations.byModel} />
                </div>
              </Section>
              <div className="flex flex-col gap-5">
                <Section title={tr("Thuê bao")}>
                  <dl className="grid grid-cols-3 divide-x divide-line/70 text-center">
                    <div className="py-3">
                      <dt className="text-[11.5px] text-ink-2">
                        {tr("Hiệu lực")}
                      </dt>
                      <dd className="font-mono text-[18px] text-ok">
                        {d.billing.active}
                      </dd>
                    </div>
                    <div className="py-3">
                      <dt className="text-[11.5px] text-ink-2">
                        {tr("Ân hạn")}
                      </dt>
                      <dd className="font-mono text-[18px] text-warn">
                        {d.billing.grace}
                      </dd>
                    </div>
                    <div className="py-3">
                      <dt className="text-[11.5px] text-ink-2">
                        {tr("Hạn chế")}
                      </dt>
                      <dd className="font-mono text-[18px] text-danger">
                        {d.billing.restricted}
                      </dd>
                    </div>
                  </dl>
                  {d.billing.expiringSoon.length > 0 && (
                    <ul className="divide-y divide-line/70 border-t border-line/70">
                      {d.billing.expiringSoon.map((e) => (
                        <li
                          key={e.organizationId}
                          className="flex justify-between gap-2 px-4 py-2 text-[12.5px] sm:px-5"
                        >
                          <span className="truncate">{e.organizationName}</span>
                          <span className="text-ink-2">
                            {tr("hết hạn")} {fmtDate(e.endsAt)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Section>
                <Section title={tr("Sổ cái & bảo mật")}>
                  <dl className="grid grid-cols-2 gap-y-2 px-4 py-3 text-[12.5px] sm:px-5">
                    <dt className="text-ink-2">{tr("Outbox lỗi vĩnh viễn")}</dt>
                    <dd className="text-right font-mono">
                      {d.ledger.outbox.DEAD_LETTER ?? 0}
                    </dd>
                    <dt className="text-ink-2">{tr("Outbox thử lại")}</dt>
                    <dd className="text-right font-mono">
                      {d.ledger.outbox.RETRY ?? 0}
                    </dd>
                    <dt className="text-ink-2">{tr("Hold chưa xử lý")}</dt>
                    <dd className="text-right font-mono">
                      {d.ledger.unresolvedHolds}
                    </dd>
                    <dt className="text-ink-2">{tr("Xác nhận cuối")}</dt>
                    <dd className="text-right font-mono">
                      {fmtDateTime(d.ledger.lastConfirmedAt)}
                    </dd>
                    <dt className="text-ink-2">{tr("Tài khoản đang khóa")}</dt>
                    <dd className="text-right font-mono">
                      {d.security.lockedAccounts}
                    </dd>
                    <dt className="text-ink-2">{tr("Admin chưa bật MFA")}</dt>
                    <dd className="text-right font-mono">
                      {d.security.adminsWithoutMfa}/{d.security.admins}
                    </dd>
                  </dl>
                </Section>
              </div>
            </div>
            {stats.data && (
              <Section
                title={tr("12 tháng gần nhất")}
                aside={tr(
                  "Tổng: {p0} tổ chức · {p1} tài khoản · {p2} chuỗi · {p3} sự kiện",
                  {
                    p0: stats.data.totals.organizations,
                    p1: fmtNumber(stats.data.totals.users),
                    p2: stats.data.totals.chains,
                    p3: fmtNumber(stats.data.totals.events),
                  },
                )}
              >
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[760px] text-[12.5px]">
                    <thead>
                      <tr className="border-b border-line bg-sunken text-left text-ink-2">
                        <th className="h-9 px-4 font-semibold">
                          {tr("Tháng")}
                        </th>
                        <th className="px-3 text-right font-semibold">
                          {tr("Tổ chức mới")}
                        </th>
                        <th className="px-3 text-right font-semibold">
                          {tr("Lô")}
                        </th>
                        <th className="px-3 text-right font-semibold">
                          {tr("Lệnh chế biến")}
                        </th>
                        <th className="px-3 text-right font-semibold">
                          {tr("Lượt quét")}
                        </th>
                        <th className="px-3 text-right font-semibold">
                          {tr("Hỗ trợ")}
                        </th>
                        <th className="px-4 text-right font-semibold">
                          {tr("Doanh thu thật")}
                        </th>
                      </tr>
                    </thead>
                    <tbody className="font-mono">
                      {stats.data.months.map((m) => (
                        <tr
                          key={m.month}
                          className="border-b border-line/60 last:border-0"
                        >
                          <td className="h-8 px-4">{m.month}</td>
                          <td className="px-3 text-right">{m.organizations}</td>
                          <td className="px-3 text-right">{m.lots}</td>
                          <td className="px-3 text-right">
                            {m.processingRuns}
                          </td>
                          <td className="px-3 text-right">
                            {fmtNumber(m.scans)}
                          </td>
                          <td className="px-3 text-right">{m.tickets}</td>
                          <td className="px-4 text-right">
                            {fmtMoney(m.revenue)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </Section>
            )}
            <Section
              title={tr("Hoạt động quản trị gần đây")}
              aside={
                can("audit.read") ? (
                  <Link
                    className="text-brand hover:underline"
                    href="/admin/audit-log"
                  >
                    {tr("Nhật ký đầy đủ →")}
                  </Link>
                ) : undefined
              }
            >
              <ul className="divide-y divide-line/70">
                {d.recentActivity.map((a) => (
                  <li
                    key={a.sequence}
                    className="grid grid-cols-[60px_minmax(0,1fr)_auto] items-center gap-3 px-4 py-2 text-[12.5px] sm:grid-cols-[70px_220px_minmax(0,1fr)_110px_130px] sm:px-5"
                  >
                    <span className="font-mono text-ink-2">#{a.sequence}</span>
                    <span className="font-mono">{a.action}</span>
                    <span className="hidden truncate text-ink-2 sm:block">
                      {a.reason ?? "—"}
                    </span>
                    <span className="hidden sm:block">
                      <Status group="outcome" value={a.outcome} />
                    </span>
                    <span className="font-mono text-ink-2">
                      {fmtDateTime(a.occurredAt)}
                    </span>
                  </li>
                ))}
              </ul>
            </Section>
          </>
        )}
      </PageBody>
    </>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale as useLedgerLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLedgerLocale();
  return (
    <LedgerRouteScreen route={route} name="admin">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
