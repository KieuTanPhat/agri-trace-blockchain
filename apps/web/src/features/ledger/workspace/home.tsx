"use client";

import Link from "next/link";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { Button } from "@/components/ledger/ui/button";
import { ArrowRight } from "lucide-react";
import { wapi } from "@/lib/ledger/workspace-api";
import { useAuth } from "@/lib/auth-store";
import { CAPABILITY_LABEL, MODEL_LABEL } from "@/lib/ledger/labels";
import { PERMISSION_GROUPS, PERMISSION_LABEL, TIER_LABEL } from "@/lib/ledger/workspace-permissions";
import { useOverview, useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { ErrorState, Field, Fields, LoadingRows, PageBody, PageHeader, Section, Stat, StatRow } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
export default function WorkspaceHome() {
  const { user } = useAuth();
  const o = useOverview();
  const { can, primary, access } = useWorkspaceAccess();
  const transfers = useQuery({ queryKey: ["ws-transfers"], queryFn: wapi.transfers });
  const invitations = useQuery({ queryKey: ["ws-invitations"], queryFn: wapi.invitations, enabled: can("members.manage") && access?.tier !== 3 });



  if (o.error) return <ErrorState error={o.error} onRetry={() => o.refetch()} />;
  if (!o.data) return <LoadingRows rows={8} className="p-8" />;
  const d = o.data;
  const perms = new Set(d.permissions);
  const forMe = transfers.data?.filter((x) => x.status === "PENDING" && !x.expired && x.toUserId === user?.id) ?? [];
  const todo = [
    ...forMe.map((x) => ({ href: "/enterprise/ownership", text: tr("{p0} đề nghị chuyển quyền chủ quản cho bạn", { p0: x.from?.fullName }), tone: "warn" as const })),
    ...(invitations.data ?? []).filter((i) => i.status === "PENDING").map((i) => ({ href: "/enterprise/members/invitations", text: tr("Lời mời {p0} chưa được chấp nhận", { p0: i.fullName }), tone: "neutral" as const })),
  ];

  return (
    <>
      <PageHeader
        actions={<Button variant="outline" onClick={() => o.refetch()}>{tr("Làm mới")}</Button>} title={d.organization.name}
        meta={<Badge tone={d.organization.status === "ACTIVE" ? "ok" : "neutral"}>{d.organization.status === "ACTIVE" ? tr("Hoạt động") : tr("Ngừng hoạt động")}</Badge>}
        description={
          <>
            {tr("Mã AgriTrace")} <span className="font-mono">{d.organization.code}</span> · MST <span className="font-mono">{d.organization.businessId ?? "—"}</span> · {d.organization.participationModel ? MODEL_LABEL[d.organization.participationModel] : "—"}
          </>
        }
      />
      <PageBody>
        <StatRow>
          <Stat label={tr("Thành viên bạn quản lý")} value={perms.has("members.read") ? d.counts.members : "—"} href={perms.has("members.read") ? "/enterprise/members" : undefined} />
          <Stat label={tr("Cơ sở trong phạm vi")} value={perms.has("sites.read") ? d.counts.sites : "—"} href={perms.has("sites.read") ? "/enterprise/sites" : undefined} />
          <Stat label={tr("Sản phẩm")} value={perms.has("catalog.read") ? d.counts.products : "—"} />
          <Stat label={tr("Giao nhận liên quan")} value={perms.has("distribution.read") ? d.counts.transfers : "—"} />
        </StatRow>
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <Section title={tr("Quyền của bạn")} aside={<span className="font-mono">{TIER_LABEL[d.member.tier] ?? tr("Cấp {p0}", { p0: d.member.tier })}</span>}>
            <div className="flex flex-col gap-3 px-4 py-4 sm:px-5">
              <p className="text-[13px] text-ink-2">
                {primary
                  ? tr("Bạn là chủ quản (ORG_ADMIN cấp 1): có mọi quyền trong doanh nghiệp.")
                  : tr("Quyền hiệu lực là hợp của các nhóm quyền được gán, giới hạn theo chuỗi và cơ sở, và người quản lý trực tiếp của bạn cũng phải nắm giữ quyền đó.")}
                {d.member.enrollmentOwner && tr(" Bạn là người đứng tên hồ sơ đăng ký.")}
              </p>
              {PERMISSION_GROUPS.map((g) => (
                <div key={g.label} className="flex flex-col gap-1.5">
                  <span className="label-caps">{g.label}</span>
                  <div className="flex flex-wrap gap-1.5">
                    {g.keys.map((k) => (
                      <span key={k} title={k} className={cn("rounded-sm px-1.5 py-0.5 text-[12px]", perms.has(k) ? "bg-brand-weak text-brand-ink" : "bg-sunken text-ink-2 line-through decoration-ink-2/40")}>
                        {PERMISSION_LABEL[k]}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </Section>
          <div className="flex flex-col gap-5">
            <Section title={tr("Việc cần chú ý")}>
              {todo.length ? (
                <ul className="divide-y divide-line/70">
                  {todo.map((x, i) => (
                    <li key={i}>
                      <Link href={x.href} className="flex items-center justify-between gap-3 px-4 py-2.5 text-[13px] hover:bg-row-alt sm:px-5">
                        <span className={cn(x.tone === "warn" && "font-medium")}>{x.text}</span>
                        <ArrowRight className="size-3.5 shrink-0 text-ink-2" />
                      </Link>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="px-5 py-4 text-[13px] text-ink-2">{tr("Không có việc nào đang chờ bạn.")}</p>
              )}
            </Section>
            <Section title={tr("Hồ sơ doanh nghiệp")}>
              <Fields cols={1}>
                <Field label={tr("Năng lực")}>{d.organization.capabilities.map((c) => CAPABILITY_LABEL[c] ?? c).join(", ") || "—"}</Field>
                <Field label={tr("Người đại diện")}>{d.profile?.representative}</Field>
                <Field label={tr("Địa chỉ")}>{d.profile?.address}</Field>
                <Field label={tr("Liên hệ")}>{d.profile ? `${d.profile.contactEmail} · ${d.profile.phone}` : "—"}</Field>
                <Field label={tr("Lưu trữ sổ cái")} mono>
                  {d.organization.hostingMode ?? "—"}
                </Field>
              </Fields>
            </Section>
          </div>
        </div>
      </PageBody>
    </>
  );
}
