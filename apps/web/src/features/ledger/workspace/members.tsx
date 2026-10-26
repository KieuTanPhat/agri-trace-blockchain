"use client";

import { Suspense, useMemo, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLedgerSearchParams as useSearchParams } from "@/components/ledger/route-screen";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { Copy, MailPlus, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { wapi } from "@/lib/ledger/workspace-api";
import type { Invitation, Member, RoleGrant } from "@/lib/ledger/workspace-types";
import { useAuth } from "@/lib/auth-store";
import { randomToken, sha256Hex } from "@/lib/ledger/workspace-protocol";
import { fmtDateTime, fmtDue } from "@/lib/ledger/format";
import { PERMISSION_LABEL, TIER_LABEL, type EnterprisePermission } from "@/lib/ledger/workspace-permissions";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ledger/ui/dialog";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { ChoiceField, SelectField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge, Status } from "@/components/ledger/kit/status";
import { EvidencePanel } from "@/components/ledger/workspace/evidence-panel";
import { GrantsField } from "@/components/ledger/workspace/grants-editor";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const grantSchema = z.array(z.object({ roleId: z.string().min(1, { error: () => tr("Chọn nhóm quyền") }), chainIds: z.array(z.string()), siteIds: z.array(z.string()) }));
const profileSchema = z.object({
  fullName: z.string().trim().min(2, { error: () => tr("Bắt buộc") }).max(255),
  email: z.string().trim().email({ error: () => tr("Email không hợp lệ") }).max(255),
  jobTitle: z.string().trim().min(2, { error: () => tr("Bắt buộc") }).max(255),
  phone: z.string().transform(v => v.replace(/[ .()-]/g, "")).pipe(z.string().regex(/^(?:0[35789]\d{8}|02\d{9}|\+84(?:[35789]\d{8}|2\d{9}))$/, tr("Số điện thoại liên hệ không hợp lệ"))),
  contactAddress: z.string().trim().min(5, { error: () => tr("Tối thiểu 5 ký tự") }).max(500),
  memberNote: z.string().max(1000).optional(),
  workSiteId: z.string().optional(),
  responsibleFarmId: z.string().optional(),
  tier: z.enum(["2", "3"]),
  roles: grantSchema.min(1, { error: () => tr("Gán ít nhất một nhóm quyền") }),
});
const editSchema = z.object({
  workSiteId: z.string().optional(), responsibleFarmId: z.string().optional(), contactAddress: z.string().max(500).optional(), memberNote: z.string().max(1000).optional(),
  status: z.enum(["ACTIVE", "LOCKED", "INACTIVE"]),
  jobTitle: z.string().trim().min(2, { error: () => tr("Bắt buộc") }).max(255),
  phone: z.string().trim().max(30),
  roles: grantSchema,
});
const supervisorSchema = z.object({ supervisorId: z.string() });

type MembersView = "tree" | "new" | "detail" | "edit" | "invitations";
export default function MembersPage({ view = "tree", memberId }: { view?: MembersView; memberId?: string }) {
  return (
    <Suspense>
      <Members view={view} memberId={memberId}/>
    </Suspense>
  );
}

function Members({ view, memberId }: { view: MembersView; memberId?: string }) {
  const router = useRouter();
  const avatar = useRef<File | null>(null);
  const params = useSearchParams();
  const { user } = useAuth();
  const { can, primary, tier } = useWorkspaceAccess();
  const [tab, setTab] = useState<"tree" | "invitations">((view === "invitations" || params.get("tab") === "invitations") ? "invitations" : "tree");
  const [selectedId, setSelected] = useState<string | null>(null);
  const [showRemoved, setShowRemoved] = useState(false);
  const [createdMember, setCreatedMember] = useState<string>();
  const [uploadError, setUploadError] = useState("");
  const members = useQuery({ queryKey: ["ws-members"], queryFn: wapi.members, enabled: can("members.read") });
  const manage = can("members.manage") && tier !== 3;
  const roles = useQuery({ queryKey: ["ws-roles"], queryFn: wapi.roles, enabled: can("members.read") });
  const chains = useQuery({ queryKey: ["ws-chains"], queryFn: wapi.chains });
  const sites = useQuery({ queryKey: ["ws-sites"], queryFn: wapi.sites, enabled: can("sites.read") });
  const catalog = useQuery({ queryKey: ["catalog"], queryFn: wapi.catalog, enabled: can("catalog.read") });
  const create = useDialog<"member" | "invite">();
  const [inviteLink, setInviteLink] = useState<string | null>(null);

  const tree = useMemo(() => {
    const list = (members.data ?? []).filter(member => memberId || (showRemoved ? member.accountStatus === "INACTIVE" : member.accountStatus !== "INACTIVE"));
    const ids = new Set(list.map((m) => m.id));
    const rows: { m: Member; depth: number }[] = [];
    const walk = (parent: string | null, depth: number) => {
      for (const m of list.filter((x) => (parent === null ? !x.supervisorId || !ids.has(x.supervisorId) : x.supervisorId === parent)).sort((a, b) => (a.enterpriseTier ?? 1) - (b.enterpriseTier ?? 1) || a.fullName.localeCompare(b.fullName, "vi"))) {
        rows.push({ m, depth });
        walk(m.id, depth + 1);
      }
    };
    walk(null, 0);
    return rows;
  }, [members.data, memberId, showRemoved]);

  if (!can("members.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền members.read"))} />;
  const current = memberId ? tree.find(r => r.m.id === memberId)?.m : tree.find((r) => r.m.id === selectedId)?.m ?? tree[0]?.m;
  const sharedOpts = { roles: roles.data ?? [], chains: chains.data ?? [], sites: [...(sites.data ?? []), ...(catalog.data?.farms ?? []).map(farm => ({id:farm.id,name:farm.name,status:farm.status,kind:"FARM"}))] };
  const invalidate = [["ws-members"], ["ws-invitations"], ["ws-overview"]];

  return (
    <>
      <PageHeader
        title={tr("Thành viên")}
        description={primary ? tr("Toàn bộ thành viên, xếp theo người quản lý trực tiếp. Chủ quản tạo được cấp 2 và cấp 3; cấp 2 chỉ tạo cấp 3.") : tr("Nhân viên do bạn quản lý trực tiếp. Bạn chỉ cấp được quyền và phạm vi mà chính mình đang có.")}
        actions={
          manage && (
            <>
              <Button size="sm" variant="outline" onClick={() => create.open("invite")}>
                <MailPlus /> {tr("Mời qua liên kết")}
              </Button>
              <Button size="sm" onClick={() => create.open("member")}>
                <UserPlus /> {tr("Tạo thành viên")}
              </Button>
            </>
          )
        }
      />
      <PageBody wide>
        {uploadError && <Callout tone="warn">{uploadError}</Callout>}
        {createdMember && <EvidencePanel entityType="MEMBER" entityId={createdMember} canManage={manage}/>}
        {(view === "new" || view === "edit") && <datalist id="ledger-member-farms">{catalog.data?.farms.map(farm => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</datalist>}
        {view === "tree" && <Button size="sm" variant="outline" aria-pressed={showRemoved} onClick={() => setShowRemoved(value => !value)}>{tr(showRemoved ? "Xem thành viên đang làm việc" : "Xem thành viên đã ngừng")}</Button>}
        {manage && (
          <div role="tablist" className="flex gap-1">
            {(["tree", "invitations"] as const).map((k) => (
              <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", tab === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
                {k === "tree" ? tr("Cây thành viên") : tr("Lời mời")}
              </button>
            ))}
          </div>
        )}
        {tab === "invitations" && manage ? (
          <Invitations />
        ) : members.error ? (
          <ErrorState error={members.error} onRetry={() => members.refetch()} />
        ) : !members.data ? (
          <LoadingRows />
        ) : !tree.length ? (
          <EmptyState title={tr("Chưa có thành viên trực thuộc")}>{tr("Tạo thành viên hoặc gửi lời mời để giao việc.")}</EmptyState>
        ) : (
          <div className="flex flex-wrap items-start gap-5">
            <ul aria-label={tr("Cây thành viên")} className="min-w-0 flex-[1_1_380px] overflow-hidden rounded-md border border-line bg-card py-1">
              {tree.map(({ m, depth }) => (
                <li key={m.id}>
                  <button
                    type="button"
                    onClick={() => setSelected(m.id)}
                    aria-current={current?.id === m.id || undefined}
                    className={cn("flex w-full items-center justify-between gap-3 py-2.5 pr-4 text-left hover:bg-row-alt", current?.id === m.id && "bg-brand-weak shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-weak")}
                    style={{ paddingLeft: 16 + depth * 24 }}
                  >
                    <span className="flex min-w-0 flex-col">
                      <span className={cn("truncate text-[13px] font-medium", m.accountStatus !== "ACTIVE" && "text-ink-2 line-through")}>
                        {m.fullName} {m.id === user?.id && <span className="font-normal text-ink-2">{tr("(bạn)")}</span>}
                      </span>
                      <span className="truncate text-[12px] text-ink-2">{m.jobTitle ?? "—"}</span>
                    </span>
                    <span className="flex shrink-0 items-center gap-1.5">
                      {m.accountStatus !== "ACTIVE" && <Status group="account" value={m.accountStatus} />}
                      <span className="rounded-sm bg-sunken px-1.5 py-0.5 font-mono text-[11px]">{m.enterpriseTier ? `C${m.enterpriseTier}` : "C1"}</span>
                    </span>
                  </button>
                </li>
              ))}
            </ul>
            {memberId && !current && !members.isLoading && <EmptyState title={tr("Không tìm thấy thành viên")}/>}
            {current && <MemberDetail canonicalEdit={view === "edit"} m={current} all={members.data} manage={manage} primary={primary} {...sharedOpts} invalidate={invalidate} />}
          </div>
        )}
      </PageBody>

      {(create.target === "member" || (view === "new" && manage)) && (
        <CommandDialog
          {...create.props}
          open={view === "new" || create.props.open}
          onOpenChange={open => view === "new" && !open ? router.push("/enterprise/members") : create.props.onOpenChange(open)}
          title={tr("Tạo thành viên")}
          endpoint="POST /enterprise-workspace/members"
          description={tr("Hệ thống gửi mật khẩu tạm qua email; thành viên phải đổi ở lần đăng nhập đầu. Người tạo trở thành người quản lý trực tiếp.")}
          schema={profileSchema}
          defaultValues={{ fullName: "", email: "", jobTitle: "", phone: "", contactAddress: "", tier: primary ? "2" : "3", roles: [] }}
          submitLabel={tr("Tạo thành viên")}
          invalidate={invalidate}
          wide
          onDone={async result => { if (avatar.current && result && typeof result === "object" && "record" in result) { const record = result.record; if (record && typeof record === "object" && "id" in record && typeof record.id === "string") { setCreatedMember(record.id); try { await wapi.uploadEvidence({file: avatar.current, entityType:"MEMBER", entityId:record.id,kind:"MEMBER_AVATAR",description:"Ảnh đại diện thành viên mới"},{idempotencyKey:crypto.randomUUID()}); } catch { setUploadError("Tài khoản đã tạo; ảnh chưa tải được. Bổ sung tại khối chứng cứ của thành viên, không tạo lại tài khoản."); } } } if (view === "new") router.push("/enterprise/members"); }}
          run={(v, cmd) => wapi.createMember({ ...v, tier: Number(v.tier) as 2 | 3, workSiteId: v.workSiteId || undefined, responsibleFarmId: v.responsibleFarmId || undefined, memberNote: v.memberNote || undefined }, cmd)}
        >
          {(f) => <><ProfileFields f={f} primary={primary} {...sharedOpts}/><label className="flex flex-col gap-2 text-sm">{tr("Ảnh đại diện")}<Input type="file" accept="image/png,image/jpeg" onChange={event => { avatar.current = event.target.files?.[0] ?? null; }}/></label></>}
        </CommandDialog>
      )}
      {create.target === "invite" && (
        <InviteDialog
          {...create.props}
          primary={primary}
          {...sharedOpts}
          invalidate={invalidate}
          onCreated={(link) => {
            setInviteLink(link);
            setTab("invitations");
          }}
        />
      )}
      <Dialog open={!!inviteLink} onOpenChange={(o) => !o && setInviteLink(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{tr("Gửi liên kết mời")}</DialogTitle>
            <DialogDescription>{tr("Mã mời được tạo trên máy của bạn; máy chủ chỉ lưu bản băm SHA-256. Liên kết chỉ hiện một lần, hiệu lực 72 giờ.")}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Input readOnly value={inviteLink ?? ""} className="font-mono text-[12px]" aria-label={tr("Liên kết mời")} />
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                navigator.clipboard?.writeText(inviteLink ?? "");
                toast.success(tr("Đã sao chép liên kết"));
              }}
            >
              <Copy /> {tr("Sao chép")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}

function ProfileFields({ f, primary, roles, chains, sites }: { f: Parameters<Parameters<typeof CommandDialog<typeof profileSchema>>[0]["children"]>[0]; primary: boolean } & Pick<React.ComponentProps<typeof GrantsField>, "roles" | "chains" | "sites">) {
  return (
    <>
      <div className="grid gap-3 sm:grid-cols-2">
        <TextField control={f.control} name="fullName" label={tr("Họ tên")} autoComplete="off" />
        <TextField control={f.control} name="email" label="Email" type="email" autoComplete="off" />
        <TextField control={f.control} name="jobTitle" label={tr("Chức danh")} />
        <TextField control={f.control} name="phone" label={tr("Điện thoại")} />
      </div>
      <TextField control={f.control} name="contactAddress" label={tr("Địa chỉ liên hệ")} hint={tr("Bắt buộc theo quy định thêm thành viên")} />
      <SelectField control={f.control} name="responsibleFarmId" label={tr("Vùng trồng phụ trách")} options={sites.filter(site => site.kind === "FARM" && site.status === "ACTIVE").map(site => ({value:site.id,label:site.name}))}/>
      <TextField control={f.control} name="memberNote" label={tr("Ghi chú")}/>
      <div className="grid gap-3 sm:grid-cols-2">
        <SelectField control={f.control} name="workSiteId" label={tr("Cơ sở làm việc")} options={sites.filter((s) => s.status === "ACTIVE" && s.kind !== "FARM").map((s) => ({ value: s.id, label: s.name }))} />
        <ChoiceField
          control={f.control}
          name="tier"
          label={tr("Cấp")}
          options={[...(primary ? [{ value: "2", label: tr("Cấp 2 · quản lý"), help: tr("Được quản lý nhân viên cấp 3 trong phạm vi được giao.") }] : []), { value: "3", label: tr("Cấp 3 · nhân viên"), help: tr("Không quản trị thành viên hay nhóm quyền.") }]}
        />
      </div>
      <GrantsField control={f.control} name="roles" roles={roles} chains={chains} sites={sites} />
    </>
  );
}

function InviteDialog({ open, onOpenChange, primary, roles, chains, sites, invalidate, onCreated }: { open: boolean; onOpenChange: (o: boolean) => void; primary: boolean; invalidate: string[][]; onCreated: (link: string) => void } & Pick<React.ComponentProps<typeof GrantsField>, "roles" | "chains" | "sites">) {
  const [token] = useState(randomToken);
  const [id] = useState(() => crypto.randomUUID());
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={tr("Mời thành viên qua liên kết")}
      endpoint="POST /enterprise-workspace/member-invitations"
      description={tr("Người được mời tự đặt mật khẩu khi chấp nhận. Lời mời mất hiệu lực nếu quyền, nhóm hoặc phạm vi của người mời thay đổi trước khi chấp nhận.")}
      schema={profileSchema}
      defaultValues={{ fullName: "", email: "", jobTitle: "", phone: "", contactAddress: "", tier: primary ? "2" : "3", roles: [] }}
      submitLabel={tr("Tạo lời mời")}
      invalidate={invalidate}
      wide
      onDone={() => onCreated(`${window.location.origin}/join-organization?id=${id}&token=${token}`)}
      run={async (v, cmd) => wapi.invite({ ...v, tier: Number(v.tier) as 2 | 3, workSiteId: v.workSiteId || undefined, memberNote: v.memberNote || undefined, id, tokenDigest: await sha256Hex(token) }, cmd)}
    >
      {(f) => <ProfileFields f={f} primary={primary} roles={roles} chains={chains} sites={sites} />}
    </CommandDialog>
  );
}

function MemberDetail({ canonicalEdit = false, m, all, manage, primary, roles, chains, sites, invalidate }: { canonicalEdit?: boolean; m: Member; all: Member[]; manage: boolean; primary: boolean; invalidate: string[][] } & Pick<React.ComponentProps<typeof GrantsField>, "roles" | "chains" | "sites">) {
  const { user } = useAuth();
  const router = useRouter();
  const edit = useDialog();
  const sup = useDialog();
  const byId = (id: string | null) => all.find((x) => x.id === id);
  const chain: Member[] = [];
  for (let p: Member | undefined = m; p && chain.length < 4; p = byId(p.supervisorId)) chain.unshift(p);
  const isOwner = m.enterpriseTier === 1 || m.enterpriseTier === null;
  const perms = isOwner ? null : [...new Set(m.enterpriseRoles.flatMap((g) => g.role.permissions))];
  const name = (list: { id: string; name: string }[], ids: string[]) => ids.map((id) => list.find((x) => x.id === id)?.name ?? id.slice(-6)).join(", ") || "—";
  const editable = manage && !isOwner && m.id !== user?.id;
  const managers = all.filter((x) => x.enterpriseTier === 2 && x.accountStatus === "ACTIVE" && x.id !== m.id);
  return (
    <section aria-label={tr("Chi tiết {p0}", { p0: m.fullName })} className="flex min-w-0 flex-[2_1_520px] flex-col gap-4 rounded-md border border-line bg-card p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <h2 className="text-[18px] font-semibold">{m.fullName}</h2>
          <span className="text-[13px] text-ink-2">
            {m.email} · <span className="font-mono">{m.memberCode ?? "—"}</span>
          </span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <Status group="account" value={m.accountStatus} />
          <Badge tone="neutral" dot={false}>
            {TIER_LABEL[m.enterpriseTier ?? 1]}
          </Badge>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="label-caps">{tr("Chuỗi ủy quyền")}</span>
        <div className="rounded-md bg-sunken px-3 py-2.5 font-mono text-[12.5px]">
          {chain.map((p, i) => (
            <span key={p.id}>
              {i > 0 && " → "}
              {p.fullName}
              {i === 0 && (p.enterpriseTier ?? 1) === 1 ? tr(" (chủ quản)") : ""}
            </span>
          ))}
        </div>
        {!isOwner && <span className="text-[12px] text-ink-2">{tr("Mọi quyền của thành viên đều phải được người quản lý ở các cấp trên nắm giữ; người quản lý bị khóa thì nhân viên trực thuộc bị khóa theo.")}</span>}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="label-caps">{tr("Nhóm quyền × phạm vi")}</span>
        {isOwner ? (
          <p className="text-[13px]">{tr("ORG_ADMIN · toàn doanh nghiệp")}</p>
        ) : m.enterpriseRoles.length ? (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-[13px]">
              <thead>
                <tr className="border-b border-line text-left text-[12px] text-ink-2">
                  <th className="py-1.5 pr-3 font-semibold">{tr("Nhóm")}</th>
                  <th className="py-1.5 pr-3 font-semibold">{tr("Chuỗi")}</th>
                  <th className="py-1.5 font-semibold">{tr("Cơ sở")}</th>
                </tr>
              </thead>
              <tbody>
                {m.enterpriseRoles.map((g, i) => (
                  <tr key={i} className="border-b border-line/60 last:border-0">
                    <td className="py-2 pr-3 font-medium">{g.role.name}</td>
                    <td className="py-2 pr-3 text-ink-2">{name(chains, g.chainIds)}</td>
                    <td className="py-2 text-ink-2">{name(sites, g.siteIds)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="text-[13px] text-ink-2">{tr("Không có nhóm quyền (tài khoản bị khóa hoặc ngừng thì mất nhóm quyền).")}</p>
        )}
      </div>
      <div className="flex flex-col gap-1.5">
        <span className="label-caps">{tr("Quyền hiệu lực")}</span>
        <div className="flex flex-wrap gap-1.5">
          {perms === null ? (
            <span className="text-[13px]">{tr("Mọi quyền")}</span>
          ) : perms.length ? (
            perms.map((p) => (
              <span key={p} title={p} className="rounded-sm bg-brand-weak px-1.5 py-0.5 text-[12px] text-brand-ink">
                {PERMISSION_LABEL[p as EnterprisePermission] ?? p}
              </span>
            ))
          ) : (
            <span className="text-[13px] text-ink-2">—</span>
          )}
        </div>
      </div>
      {editable && (
        <div className="flex flex-wrap gap-2 border-t border-line/70 pt-4">
          <Button size="sm" onClick={() => edit.open(true)}>
            {tr("Sửa quyền & trạng thái")}
          </Button>
          {primary && (
            <Button size="sm" variant="outline" onClick={() => sup.open(true)}>
              {tr("Đổi người quản lý")}
            </Button>
          )}
        </div>
      )}
      <EvidencePanel entityType="MEMBER" entityId={m.id} canManage={manage}/>
      <CommandDialog
        {...edit.props}
        open={manage && (canonicalEdit || edit.props.open)}
        onDone={() => { if (canonicalEdit) router.push(`/enterprise/members/${m.id}`); }}
        onOpenChange={open => canonicalEdit && !open ? router.push(`/enterprise/members/${m.id}`) : edit.props.onOpenChange(open)}
        title={tr("Sửa {p0}", { p0: m.fullName })}
        endpoint="POST /enterprise-workspace/members/:id"
        description={tr("Lưu sẽ thu hồi phiên của thành viên. Khóa hoặc ngừng thành viên sẽ khóa mọi nhân viên trực thuộc và gỡ nhóm quyền của họ.")}
        schema={editSchema}
        defaultValues={{ status: m.accountStatus, jobTitle: m.jobTitle ?? "", phone: m.phone ?? "", workSiteId: m.workSiteId ?? "", responsibleFarmId: m.responsibleFarmId ?? "", contactAddress: m.contactAddress ?? "", memberNote: m.memberNote ?? "", roles: m.enterpriseRoles.map((g) => ({ roleId: g.roleId, chainIds: g.chainIds, siteIds: g.siteIds })) }}
        version={m.enterpriseRevision}
        submitLabel={tr("Lưu thay đổi")}
        invalidate={invalidate}
        wide
        run={(v, cmd) => wapi.updateMember(m.id, { status: v.status, jobTitle: v.jobTitle, phone: v.phone || null, workSiteId: v.workSiteId || null, responsibleFarmId: v.responsibleFarmId || null, contactAddress: v.contactAddress || null, memberNote: v.memberNote || null, roles: v.roles as RoleGrant[], version: m.enterpriseRevision }, cmd)}
      >
        {(f) => (
          <>
            <ChoiceField
              control={f.control}
              name="status"
              label={tr("Trạng thái")}
              options={[
                { value: "ACTIVE", label: tr("Hoạt động") },
                { value: "LOCKED", label: tr("Khóa"), help: tr("Gỡ nhóm quyền; nhân viên trực thuộc bị khóa theo."), tone: "danger" },
                { value: "INACTIVE", label: tr("Ngừng"), help: tr("Thôi việc; giữ lịch sử thao tác."), tone: "danger" },
              ]}
            />
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField control={f.control} name="jobTitle" label={tr("Chức danh")} />
              <TextField control={f.control} name="phone" label={tr("Điện thoại")} />
            </div>
            <TextField control={f.control} name="contactAddress" label={tr("Địa chỉ liên hệ")}/>
            <TextField control={f.control} name="memberNote" label={tr("Ghi chú")}/>
            <SelectField control={f.control} name="responsibleFarmId" label={tr("Vùng trồng phụ trách")} options={sites.filter(site => site.kind === "FARM" && site.status === "ACTIVE").map(site => ({value:site.id,label:site.name}))}/>
            <SelectField control={f.control} name="workSiteId" label={tr("Cơ sở làm việc")} options={sites.filter(site => site.status === "ACTIVE" && site.kind !== "FARM").map(site => ({ value: site.id, label: site.name }))}/>
            <GrantsField control={f.control} name="roles" roles={roles} chains={chains} sites={sites} />
          </>
        )}
      </CommandDialog>
      <CommandDialog
        {...sup.props}
        title={tr("Đổi người quản lý · {p0}", { p0: m.fullName })}
        endpoint="POST /enterprise-workspace/members/:id/supervisor"
        description={tr("Chỉ chủ quản thực hiện. Cấp 2 luôn trực thuộc chủ quản; cấp 3 có thể chuyển sang một quản lý cấp 2 đang nắm đủ mọi quyền và phạm vi của nhân viên.")}
        schema={supervisorSchema}
        defaultValues={{ supervisorId: m.supervisorId ?? "" }}
        version={m.enterpriseRevision}
        submitLabel={tr("Đổi người quản lý")}
        invalidate={invalidate}
        run={(v, cmd) => wapi.changeSupervisor(m.id, { supervisorId: v.supervisorId || null, version: m.enterpriseRevision }, cmd)}
      >
        {(f) => (
          <SelectField
            control={f.control}
            name="supervisorId"
            label={tr("Người quản lý trực tiếp")}
            options={[{ value: user?.id ?? "", label: tr("{p0} (chủ quản)", { p0: user?.fullName ?? "" }) }, ...(m.enterpriseTier === 3 ? managers.map((x) => ({ value: x.id, label: tr("{p0} · cấp 2", { p0: x.fullName }) })) : [])]}
          />
        )}
      </CommandDialog>
    </section>
  );
}

function Invitations() {
  const q = useQuery({ queryKey: ["ws-invitations"], queryFn: wapi.invitations });
  const revoke = useDialog<Invitation>();
  const columns: Column<Invitation>[] = [
    { key: "who", header: tr("Người được mời"), cell: (i) => <span className="flex flex-col"><span className="font-medium">{i.fullName}</span><span className="font-mono text-[11.5px] text-ink-2">{i.email}</span></span> },
    { key: "tier", header: tr("Cấp"), cell: (i) => <span className="font-mono text-[12px]">{i.tier}</span> },
    { key: "created", header: tr("Tạo lúc"), cell: (i) => <span className="font-mono text-[12px]">{fmtDateTime(i.createdAt)}</span> },
    { key: "exp", header: tr("Hạn"), cell: (i) => (i.status === "PENDING" ? <span className="text-[12px]">{fmtDue(i.expiresAt).text}</span> : <span className="font-mono text-[12px] text-ink-2">{fmtDateTime(i.expiresAt)}</span>) },
    { key: "status", header: tr("Trạng thái"), cell: (i) => <Badge tone={i.status === "PENDING" ? "info" : i.status === "ACCEPTED" ? "ok" : "neutral"}>{{ PENDING: tr("Chờ chấp nhận"), ACCEPTED: tr("Đã chấp nhận"), REVOKED: tr("Đã thu hồi"), EXPIRED: tr("Hết hạn") }[i.status] ?? i.status}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (i) => (i.status === "PENDING" ? <Button size="xs" variant="outline" onClick={() => revoke.open(i)}>{tr("Thu hồi")}</Button> : null) },
  ];
  return (
    <>
      <div className="overflow-hidden rounded-md border border-line bg-card">
        <DataTable rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={columns} rowKey={(i) => i.id} empty={<EmptyState title={tr("Chưa có lời mời")} />} />
      </div>
      {revoke.target && (
        <CommandDialog {...revoke.props} title={tr("Thu hồi lời mời {p0}", { p0: revoke.target.fullName })} endpoint="POST /enterprise-workspace/member-invitations/:id/revoke" description={tr("Liên kết đã gửi sẽ không dùng được nữa.")} schema={z.object({})} defaultValues={{}} tone="danger" submitLabel={tr("Thu hồi")} invalidate={[["ws-invitations"]]} run={(_, cmd) => wapi.revokeInvitation(revoke.target!.id, cmd)}>
          {() => null}
        </CommandDialog>
      )}
    </>
  );
}
