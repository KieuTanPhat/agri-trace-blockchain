"use client";

import { useState } from "react";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {ShipmentPlans as Plans} from "./shipment-plans";
import {EvidencePanel} from "@/components/ledger/workspace/evidence-panel";

import { useFieldArray, type Control } from "react-hook-form";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";

import { chainApi } from "@/lib/ledger/chain-api";
import { CHAIN_TYPES, SUPPLY_STAGES, type MemberRecord } from "@/lib/ledger/chain-types";
import { cn } from "@/lib/ledger/utils";


import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import type {SupplyChain} from "@/lib/ledger/chain-types";
import {useAuth as useSession} from "@/lib/auth-store";
import { fmtDate } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";

import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader, Section } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

const CHAIN_TYPE_LABEL: Record<string, string> = localized({ CROP: "Trồng trọt", LIVESTOCK: "Chăn nuôi", AQUACULTURE: "Thủy sản", PROCESSED_FOOD: "Thực phẩm chế biến" });
const STAGE_LABEL: Record<string, string> = localized({ FARM: "Sản xuất", PROCESSOR: "Chế biến", TRANSPORTER: "Vận chuyển", DISTRIBUTOR: "Phân phối", RETAILER: "Bán lẻ" });
const MEMBER_LABEL: Record<string, string> = localized({ INVITED: "Đang mời", ACTIVE: "Hoạt động", SUSPENDED: "Tạm ngừng", REVOKED: "Đã thu hồi" });
const MEMBER_TONE: Record<string, "info" | "ok" | "warn" | "neutral"> = { INVITED: "info", ACTIVE: "ok", SUSPENDED: "warn", REVOKED: "neutral" };
const PROFILE_LABEL: Record<string, string> = localized({ PREPARING: "Đang chuẩn bị", ACTIVE: "Đang vận hành", SUSPENDED: "Đã ngừng" });
const reason10 = z.string().trim().min(10, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 10 }) }).max(1000);

/** Tên tổ chức: doanh nghiệp mình và đối tác đã liên kết; tổ chức khác chỉ hiện mã rút gọn. */
function useOrgNames() {
  const {user}=useSession();
  const {can}=useWorkspaceAccess();
  const directory=useQuery({queryKey:["chain-organizations"],queryFn:chainApi.organizations});
  const overview = useQuery({ queryKey: ["ws-overview"], queryFn: wapi.overview,enabled:!!user?.organizationId });
  const partners = useQuery({ queryKey: ["ws-partners"], queryFn: wapi.partners,enabled:!!user?.organizationId && can("partners.read") });
  const map = new Map<string, string>((directory.data??[]).map(o=>[o.id,o.name]));
  if (overview.data) map.set(overview.data.organization.id, overview.data.organization.name);
  for (const p of partners.data ?? []) for (const o of [p.inviter, p.invitee]) if (o) map.set(o.id, o.name);
  return { name: (id: string) => map.get(id) ?? `${tr("Tổ chức")} ${id.slice(0, 8)}`, partners: partners.data ?? [], me: overview.data?.organization };
}

export default function ChainsPage({chainId,view="chains"}:{chainId?:string;view?:"chains"|"new"|"detail"|"members"|"roles"|"business"|"ledger"|"signing"|"plans"}) {
 const router=useRouter();
  const { user } = useSession();
  const { primary } = useWorkspaceAccess();
  const chains = useQuery({ queryKey: ["ws-chains"], queryFn: chainApi.chains });
  const ctxQ = useQuery({ queryKey: ["chain-context"], queryFn: chainApi.context });
  const accept = useDialog<{ chain: SupplyChain; member: MemberRecord }>();
  const names = useOrgNames();
  const me = user?.organizationId ?? "";
  const canCreate = ctxQ.data?.grants.some((g) => g.scope==="ORGANIZATION" && g.role === "CREATE_CHAIN" && !g.revokedAt);
  const membership = (chainId: string) => ctxQ.data?.memberships.find((m) => m.chainId === chainId);
  if (chainId && view !== "new") return <ChainDetail id={chainId} view={view} names={names} />;
  const cols: Column<SupplyChain>[] = [
    { key: "name", header: tr("Chuỗi"), cell: (c) => <span className="flex flex-col"><span className="font-medium">{c.name}</span><span className="font-mono text-[11.5px] text-ink-2">{c.code} · {CHAIN_TYPE_LABEL[c.chainType]}{c.personal && <> · <span className="font-sans text-brand-ink">{tr("Chuỗi riêng")}</span></>}</span></span> },
    { key: "owner", header: tr("Chủ chuỗi"), hideBelow: "md", cell: (c) => <span className="text-[12.5px]">{c.ownerOrganizationId === me ? tr("Doanh nghiệp bạn") : names.name(c.ownerOrganizationId)}</span> },
    { key: "member", header: tr("Tư cách của bạn"), cell: (c) => {
      const m = membership(c.id);
      return m ? <Badge tone={MEMBER_TONE[m.status]}>{MEMBER_LABEL[m.status]}</Badge> : <span className="text-ink-2">—</span>;
    } },
    { key: "created", header: tr("Tạo lúc"), hideBelow: "lg", cell: (c) => <span className="font-mono text-[12px]">{fmtDate(c.createdAt)}</span> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (c) => {
      const m = membership(c.id);
      return (
        <span className="flex flex-wrap gap-1">
          {m?.status === "INVITED" && (primary || ctxQ.data?.grants.some(g=>g.scope==="ORGANIZATION" && g.role==="ORG_ADMIN" && !g.revokedAt)) && <Button size="xs" onClick={() => accept.open({ chain: c, member: m })}>{tr("Chấp nhận lời mời")}</Button>}
          {m?.status !== "INVITED" && <Button size="xs" variant="outline" onClick={() => router.push(`/supply-chains/${c.id}`)}>{tr("Chi tiết")}</Button>}
        </span>
      );
    } },
  ];
  return (
    <>
      <PageHeader
        title={tr("Chuỗi cung ứng")}
        description={tr("Chuỗi gom các doanh nghiệp theo khâu sản xuất → chế biến → vận chuyển → phân phối → bán lẻ. Chủ chuỗi mời và điều phối thành viên, kích hoạt hồ sơ nghiệp vụ; mỗi doanh nghiệp tự chấp nhận lời mời và giao chuỗi cho nhân viên trong nhóm quyền thành viên.")}
        actions={canCreate && <Button size="sm" onClick={() => router.push("/supply-chains/new")}><Plus /> {tr("Tạo chuỗi")}</Button>}
      />
      <PageBody className="min-w-0">
        <div className="min-w-0 overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={chains.data} loading={chains.isLoading} error={chains.error} onRetry={() => chains.refetch()} columns={cols} rowKey={(c) => c.id} empty={<EmptyState title={tr("Doanh nghiệp chưa tham gia chuỗi nào")} />} />
        </div>
      </PageBody>
      {canCreate && view==="new" && <CreateChain props={{open:true,onOpenChange:o=>{if(!o)router.push("/supply-chains");}}} names={names} />}
      {accept.target && (
        <CommandDialog {...accept.props} title={tr("Tham gia chuỗi “{p0}”", { p0: accept.target.chain.name })} endpoint="POST /supply-chains/:id/memberships/:organizationId/accept" description={tr("Doanh nghiệp trở thành thành viên hoạt động; sau đó giao chuỗi cho nhân viên trong nhóm quyền ở trang Thành viên.")} schema={z.object({})} defaultValues={{}} version={accept.target.member.version} submitLabel={tr("Chấp nhận")} invalidate={[["ws-chains"], ["chain-context"]]} run={(_, cmd) => chainApi.accept(accept.target!.chain.id, me, { version: accept.target!.member.version }, cmd)}>
          {() => null}
        </CommandDialog>
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
type Names = ReturnType<typeof useOrgNames>;
const createSchema = z.object({
  name: z.string().trim().min(1, { error: () => tr("Không được để trống") }).max(255),
  chainType: z.enum(CHAIN_TYPES),
  plannedStartDate: z.string().optional(),
  description: z.string().max(2000).optional(),
  note:z.string().max(2000).optional(),
  participants: z.array(z.object({ organizationId: z.string().min(1, { error: () => tr("Chọn tổ chức") }), stage: z.enum(SUPPLY_STAGES) })).max(50),
  productIds: z.array(z.string()).max(50),
});
type CreateValues = z.infer<typeof createSchema>;

function CreateChain({ props, names }: { props: { open: boolean; onOpenChange: (o: boolean) => void }; names: Names }) {
  const { access } = useWorkspaceAccess();
  const catalog = useQuery({ queryKey: ["ws-catalog"], queryFn: wapi.catalog });
  const me = names.me?.id ?? "";
  const myStages = SUPPLY_STAGES.filter((s) => access?.capabilities.includes(s));
  const partnerOrgs = names.partners.filter((p) => p.status === "ACTIVE").flatMap((p) => (p.inviterId === me ? p.invitee : p.inviter) ?? []);
  const products = (catalog.data?.products ?? []).filter((p) => p.status === "ACTIVE" && p.organizationId===me);
  return (
    <CommandDialog
      {...props}
      title={tr("Tạo chuỗi cung ứng")}
      endpoint="POST /supply-chains"
      description={tr("Doanh nghiệp bạn tham gia theo các năng lực đã duyệt; đối tác được thêm vào mô hình sẽ nhận lời mời tham gia. Chuỗi mới ở trạng thái chuẩn bị cho tới khi kích hoạt hồ sơ nghiệp vụ. Số chuỗi bị giới hạn theo gói dịch vụ.")}
      schema={createSchema}
      defaultValues={{ name: "", chainType: "CROP", plannedStartDate: "", description: "",note:"", participants: [], productIds: [] }}
      submitLabel={tr("Tạo chuỗi")}
      invalidate={[["ws-chains"], ["chain-context"]]}
      wide
      run={(v, cmd) =>
        chainApi.create(
          {
            name: v.name,
            chainType: v.chainType,
            plannedStartDate: v.plannedStartDate || undefined,
            description: v.description || undefined,note:v.note || undefined,
            productIds: v.productIds,
            ...(v.participants.length ? { participants: [...myStages.map((stage) => ({ organizationId: me, stage })), ...v.participants] } : {}),
          },
          cmd,
        )
      }
    >
      {(f) => {
        const c = f.control as unknown as Control<CreateValues>;
        const picked = f.watch("productIds") as string[];
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <TextField control={c} name="name" label={tr("Tên chuỗi")} />
              <SelectField control={c} name="chainType" label={tr("Loại chuỗi")} options={CHAIN_TYPES.map((k) => ({ value: k, label: CHAIN_TYPE_LABEL[k] }))} />
              <TextField control={c} name="plannedStartDate" label={tr("Dự kiến bắt đầu")} type="date" />
            </div>
            <p className="text-[12.5px] text-ink-2">{tr("Khâu của doanh nghiệp bạn: {p0}", { p0: myStages.map((s) => STAGE_LABEL[s]).join(", ") || "—" })}</p>
            <ParticipantsField control={c} orgs={partnerOrgs} />
            {products.length > 0 && (
              <fieldset className="flex flex-col gap-1.5">
                <legend className="mb-1 text-[13px] font-medium">{tr("Sản phẩm liên kết")}</legend>
                {products.map((p) => (
                  <label key={p.id} className="flex items-center gap-2 text-[13px]">
                    <input type="checkbox" checked={picked.includes(p.id)} onChange={(e) => f.setValue("productIds", e.target.checked ? [...picked, p.id] : picked.filter((x) => x !== p.id))} />
                    {p.productName}
                  </label>
                ))}
              </fieldset>
            )}
            <TextAreaField control={c} name="description" label={tr("Mô tả")} max={2000} /><TextAreaField control={c} name="note" label={tr("Ghi chú")} max={2000}/>
          </>
        );
      }}
    </CommandDialog>
  );
}

function ParticipantsField({ control, orgs }: { control: Control<CreateValues>; orgs: { id: string; name: string; type: string }[] }) {
  const { fields, append, remove } = useFieldArray({ control, name: "participants" });
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-medium">{tr("Đối tác tham gia (được mời)")}</legend>
      {fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-[minmax(0,1fr)_160px_auto] items-end gap-2">
          <SelectField control={control} name={`participants.${i}.organizationId`} label={tr("Đối tác {p0}", { p0: i + 1 })} options={orgs.map((o) => ({ value: o.id, label: o.name }))} />
          <SelectField control={control} name={`participants.${i}.stage`} label={tr("Khâu")} options={SUPPLY_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))} />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => remove(i)}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => append({ organizationId: "", stage: "TRANSPORTER" })} disabled={!orgs.length}><Plus /> {tr("Thêm đối tác")}</Button>
      {!orgs.length && <p className="text-[12.5px] text-ink-2">{tr("Chưa có đối tác đã liên kết để mời.")}</p>}
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
type MemberAct = { m: MemberRecord; status: "SUSPENDED" | "REVOKED" | "INVITED" };
// Staff, signing keys and ledger status are read-only views covered elsewhere (Members, Distribution → Keys).
const TABS: [string, string][] = [["", "Tổng quan"], ["members", "Thành viên"], ["plans", "Kế hoạch"]];

/** Chain detail as its own page; each tab holds one area of management. */
function ChainDetail({ id, names, view }: { id: string; names: Names; view: string }) {
  const { user } = useSession();
  const me = user?.organizationId ?? "";
  const chain = useQuery({ queryKey: ["chain", id], queryFn: () => chainApi.chain(id) });
  const members = useQuery({ queryKey: ["chain-members", id], queryFn: () => chainApi.members(id) });
  const profile = useQuery({ queryKey: ["chain-profile", id], queryFn: () => chainApi.profile(id) });
  const ctxQ = useQuery({ queryKey: ["chain-context"], queryFn: chainApi.context });
  const access=useWorkspaceAccess();
  const memberAct = useDialog<MemberAct>();
  const invite = useDialog();
  const leave = useDialog<MemberRecord>();
  const [sentLink, setSentLink] = useState<string | null>(null);
  const prof = useDialog<"ACTIVATE" | "SUSPEND">();
  const c = chain.data;
  const owner = c?.ownerOrganizationId === me;
  const tab = ["members", "plans"].includes(view) ? view : "";
  const orgAdmin=!!ctxQ.data?.grants.some(g=>g.scope==="ORGANIZATION" && g.role==="ORG_ADMIN" && !g.revokedAt);
  const canCreateChain=!!ctxQ.data?.grants.some(g=>g.scope==="ORGANIZATION" && g.role==="CREATE_CHAIN" && !g.revokedAt);
  const manager = owner && !!ctxQ.data?.grants.some((g) => g.chainId === id && g.role === "CHAIN_MANAGER" && !g.revokedAt);
  const invalidate = [["chain", id], ["chain-members", id], ["chain-profile", id], ["ws-chains"], ["chain-context"]];
  const memberIds = new Set((members.data ?? []).map((m) => m.organizationId));
  const external = useQuery({ queryKey: ["ws-external-partners"], queryFn: wapi.externalPartners, enabled: !!chain.data && chain.data.ownerOrganizationId === me && !chain.data.personal });
  const emailInvites = useQuery({ queryKey: ["chain-invitations", id], queryFn: () => chainApi.invitations(id), enabled: !!chain.data && chain.data.ownerOrganizationId === me && !chain.data.personal });
  const invitable = names.partners.filter((p) => p.status === "ACTIVE").flatMap((p) => (p.inviterId === me ? p.invitee : p.inviter) ?? []).filter((o) => !memberIds.has(o.id));
  // One invite list from partner management: AgriTrace partners join directly,
  // partners outside AgriTrace get an email link to register first.
  // An email with a pending invitation waits for its sign-up; it is not offered again.
  const pendingEmails = new Set((emailInvites.data ?? []).filter((i) => i.status === "PENDING").map((i) => i.email.toLowerCase()));
  const outside = (external.data ?? []).filter((p) => !!p.email && !pendingEmails.has(p.email.toLowerCase()));
  const inviteOptions = [...invitable.map((o) => ({ value: `ag:${o.id}`, label: o.name })), ...outside.map((p) => ({ value: `ex:${p.id}`, label: tr("{p0} (ngoài AgriTrace, mời qua email)", { p0: p.name }) }))];
  const noEmail = (external.data ?? []).filter((p) => !p.email);
  if (!c) return <PageBody>{chain.error ? <ErrorState error={chain.error} onRetry={() => chain.refetch()} /> : <LoadingRows rows={6} />}</PageBody>;
  const activeMembers = (members.data ?? []).filter((m) => m.status === "ACTIVE").length;
  return (
    <>
      <PageHeader
        crumbs={[{ href: "/supply-chains", label: tr("Chuỗi cung ứng") }, { label: c.name }]}
        title={c.name}
        description={<><span className="font-mono">{c.code}</span> · {CHAIN_TYPE_LABEL[c.chainType]} · {owner ? tr("bạn là chủ chuỗi") : tr("chủ chuỗi: {p0}", { p0: names.name(c.ownerOrganizationId) })}</>}
        meta={profile.data && <Badge tone={profile.data.state === "ACTIVE" ? "ok" : profile.data.state === "PREPARING" ? "info" : "warn"}>{PROFILE_LABEL[profile.data.state]}</Badge>}
      />
      <PageBody className="min-w-0">
        <nav aria-label={tr("Mục quản lý chuỗi")} className="flex flex-wrap gap-1 border-b border-line">
          {TABS.map(([part, label]) => (
            <Link key={part} aria-current={tab === part ? "page" : undefined} href={`/supply-chains/${c.id}${part ? "/" + part : ""}`}
              className={cn("-mb-px border-b-2 px-3 py-2 text-[13px]", tab === part ? "border-brand font-semibold text-brand-ink" : "border-transparent text-ink-2 hover:text-ink")}>{tr(label)}</Link>
          ))}
        </nav>
        <section aria-label={c.name} className="flex min-w-0 flex-col gap-5">
          {tab === "" && (
            <>
              {c.description && <p className="text-[13px]">{c.description}</p>}
              <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[[tr("Doanh nghiệp hoạt động"), activeMembers], [tr("Đang mời"), (members.data ?? []).filter((m) => m.status === "INVITED").length], [tr("Ngày tạo"), fmtDate(c.createdAt)], [tr("Sản phẩm"), c.productIds?.length ?? 0]].map(([label, value]) => (
                  <div key={String(label)} className="rounded-md border border-line bg-card p-3"><dt className="text-[12px] text-ink-2">{label}</dt><dd className="text-[18px] font-semibold">{value}</dd></div>
                ))}
              </dl>
              <Section title={tr("Hồ sơ nghiệp vụ")} bodyClassName="p-4">
                {profile.data ? (
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Badge tone={profile.data.state === "ACTIVE" ? "ok" : profile.data.state === "PREPARING" ? "info" : "warn"}>{PROFILE_LABEL[profile.data.state]}</Badge>
                    {profile.data.suspensionReason && <span className="text-ink-2">{profile.data.suspensionReason}</span>}
                    {manager && profile.data.state === "PREPARING" && <Button size="xs" onClick={() => prof.open("ACTIVATE")}>{tr("Kích hoạt")}</Button>}
                    {manager && profile.data.state === "ACTIVE" && <Button size="xs" variant="outline" onClick={() => prof.open("SUSPEND")}>{tr("Ngừng vận hành")}</Button>}
                  </div>
                ) : <LoadingRows rows={1} />}
              </Section>
              {c.supplyModel && c.supplyModel.stages.length > 0 && (
                <Section title={tr("Mô hình khâu")} bodyClassName="p-4">
                  <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                    {c.supplyModel.stages.map((s, i) => (
                      <li key={s.stage} className="flex items-center gap-1.5">
                        {i > 0 && <span aria-hidden className="text-ink-2">→</span>}
                        <span className="rounded-sm border border-line px-2 py-1"><span className="font-medium">{STAGE_LABEL[s.stage]}</span>: {s.organizationIds.map(names.name).join(", ")}</span>
                      </li>
                    ))}
                  </ol>
                </Section>
              )}
              {access.can("evidence.read") && <EvidencePanel entityType="CHAIN" entityId={c.id} canManage={manager && access.can("evidence.manage")}/>}
            </>
          )}
          {tab === "members" && (
            <Section title={manager ? tr("Doanh nghiệp trong chuỗi") : tr("Tư cách thành viên của bạn")} aside={manager && !c.personal && <Button size="xs" variant="outline" onClick={() => invite.open(true)} disabled={!inviteOptions.length}><Plus /> {tr("Mời thành viên")}</Button>} bodyClassName="flex flex-col gap-3 p-4">
              {c.personal && (
                <Callout tone="info">
                  {tr("Đây là sổ ghi riêng miễn phí của doanh nghiệp (nông trại ghi mùa vụ, cửa hàng ghi hàng nhập ngoài): không mời đối tác. Đối tác tự vào sổ khi nhận phiếu giao lô từ bạn.")}{" "}
                  {canCreateChain ? (
                    <>
                      {tr("Doanh nghiệp bạn là chủ chuỗi: tạo chuỗi theo dòng sản phẩm để mời đối tác (kể cả qua email).")}{" "}
                      <Link href="/supply-chains/new" className="text-brand underline">{tr("Tạo chuỗi")}</Link>
                    </>
                  ) : (
                    <>
                      {tr("Muốn mời đối tác, nâng cấp lên chủ chuỗi rồi tạo chuỗi riêng.")}{" "}
                      <Link href="/enterprise/service" className="text-brand underline">{tr("Nâng cấp chủ chuỗi")}</Link>
                    </>
                  )}
                </Callout>
              )}
              {manager && !c.personal && (
                <p className="text-[12.5px] text-ink-2">
                  {tr("Danh sách mời lấy từ Quản lý đối tác: đối tác AgriTrace đang hoạt động và đối tác ngoài AgriTrace có email.")}{" "}
                  {noEmail.length > 0 && tr("Chưa có email nên chưa mời được: {p0}.", { p0: noEmail.map((p) => p.name).join(", ") })}{" "}
                  <Link href="/enterprise/partners" className="text-brand underline">{tr("Quản lý đối tác")}</Link>
                </p>
              )}
              {manager && !c.personal && (emailInvites.data ?? []).length > 0 && (
                <div className="flex flex-col gap-1.5">
                  <h4 className="text-[12.5px] font-semibold">{tr("Lời mời qua email (đối tác ngoài AgriTrace)")}</h4>
                  <p className="text-[12px] text-ink-2">{tr("Đối tác chưa có tài khoản chỉ vào chuỗi sau khi đăng ký, được duyệt và chấp nhận lời mời. Lời mời hết hạn thì mời lại được.")}</p>
                  <ul className="divide-y divide-line/70 rounded-md border border-line">
                    {(emailInvites.data ?? []).map((i) => (
                      <li key={i.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                        <span className="min-w-0 flex-1">{i.organizationName}<span className="block font-mono text-[11.5px] text-ink-2">{i.email}</span></span>
                        <Badge tone={i.status === "ACCEPTED" ? "ok" : i.status === "PENDING" ? "info" : "neutral"}>{i.status === "ACCEPTED" ? tr("Đã đăng ký và nhận lời") : i.status === "PENDING" ? tr("Chờ đăng ký") : tr("Hết hạn")}</Badge>
                        {i.status === "PENDING" && <span className="font-mono text-[11.5px] text-ink-2">{tr("hạn {p0}", { p0: fmtDate(i.expiresAt) })}</span>}
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <ul className="divide-y divide-line/70 rounded-md border border-line">
                {(members.data ?? []).map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                    <span className="min-w-0 flex-1">{names.name(m.organizationId)}{m.organizationId === c.ownerOrganizationId ? ` · ${tr("chủ chuỗi")}` : ""}</span>
                    <Badge tone={MEMBER_TONE[m.status]}>{MEMBER_LABEL[m.status]}</Badge>
                    {m.closingAt && <Badge tone="warn">{tr("Đang ngừng hợp tác")}</Badge>}
                    {!owner && m.organizationId === me && m.status === "ACTIVE" && orgAdmin && <Button size="xs" variant="outline" onClick={() => leave.open(m)}>{tr("Rời chuỗi")}</Button>}
                    {manager && m.organizationId !== c.ownerOrganizationId && (
                      <span className="flex gap-1">
                        {m.status !== "REVOKED" && m.status !== "SUSPENDED" && m.status !== "INVITED" && <Button size="xs" variant="outline" onClick={() => memberAct.open({ m, status: "SUSPENDED" })}>{tr("Tạm ngừng")}</Button>}
                        {m.status !== "REVOKED" && <Button size="xs" variant="outline" onClick={() => memberAct.open({ m, status: "REVOKED" })}>{tr("Thu hồi")}</Button>}
                        {["SUSPENDED", "REVOKED"].includes(m.status) && <Button size="xs" onClick={() => memberAct.open({ m, status: "INVITED" })}>{tr("Mời lại")}</Button>}
                      </span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}
          {tab === "plans" && (profile.data?.state === "ACTIVE" ? <Plans chainId={c.id} manager={manager} names={names} members={members.data ?? []} /> : <Callout tone="info">{tr("Kế hoạch vận chuyển mở khi hồ sơ nghiệp vụ của chuỗi đang vận hành.")}</Callout>)}
        </section>
        {sentLink && <Callout tone="info" title={tr("Link mời (đã gửi email, chỉ hiện một lần)")}><span className="break-all font-mono text-[12px]">{sentLink}</span></Callout>}
      </PageBody>
      {leave.target && (
        <CommandDialog {...leave.props} title={tr("Rời chuỗi {p0}", { p0: c.name })} endpoint="POST /supply-chains/:id/memberships/:organizationId/leave" description={tr("Chỉ rời được khi doanh nghiệp không còn giữ hàng và không còn giao nhận mở trong chuỗi. Lịch sử đã ghi vẫn được giữ.")} schema={z.object({})} defaultValues={{}} version={leave.target.version} submitLabel={tr("Rời chuỗi")} tone="danger" invalidate={invalidate}
          run={(_, cmd) => chainApi.leave(c.id, leave.target!.organizationId, { version: leave.target!.version }, cmd)}>
          {() => null}
        </CommandDialog>
      )}
      {invite.target && (
        <CommandDialog {...invite.props} title={tr("Mời thành viên")} endpoint="POST /supply-chains/:id/memberships" description={tr("Đối tác AgriTrace tự chấp nhận lời mời. Đối tác ngoài AgriTrace nhận email đăng ký; khi hồ sơ được duyệt, lời mời vào chuỗi hiện trong tài khoản của họ.")} schema={z.object({ partner: z.string().min(1, { error: () => tr("Chọn đối tác") }) })} defaultValues={{ partner: "" }} submitLabel={tr("Gửi lời mời")} invalidate={[...invalidate, ["chain-invitations", id]]}
          run={async (v, cmd) => {
            const [kind, partnerId] = [v.partner.slice(0, 2), v.partner.slice(3)];
            if (kind === "ag") return chainApi.invite(c.id, { organizationId: partnerId }, cmd);
            const p = outside.find((x) => x.id === partnerId)!;
            const result = await chainApi.inviteByLink(c.id, { email: p.email!, organizationName: p.name }, cmd);
            setSentLink(result.link);
            return result;
          }}>
          {(f) => <SelectField control={f.control} name="partner" label={tr("Đối tác")} options={inviteOptions} />}
        </CommandDialog>
      )}
      {memberAct.target && (
        <CommandDialog
          {...memberAct.props}
          title={{ SUSPENDED: tr("Tạm ngừng {p0}", { p0: names.name(memberAct.target.m.organizationId) }), REVOKED: tr("Thu hồi {p0}", { p0: names.name(memberAct.target.m.organizationId) }), INVITED: tr("Mời lại {p0}", { p0: names.name(memberAct.target.m.organizationId) }) }[memberAct.target.status]}
          endpoint="POST /supply-chains/:id/memberships/:organizationId/status"
          description={memberAct.target.status === "INVITED" ? tr("Tạo lời mời mới; quyền cũ không tự hồi phục.") : tr("Mọi vai trò theo chuỗi của tổ chức này bị thu hồi ngay; sổ cái thu hồi phía sau.")}
          schema={z.object({})}
          defaultValues={{}}
          version={memberAct.target.m.version}
          tone={memberAct.target.status === "INVITED" ? "default" : "danger"}
          submitLabel={{ SUSPENDED: tr("Tạm ngừng"), REVOKED: tr("Thu hồi"), INVITED: tr("Mời lại") }[memberAct.target.status]}
          invalidate={invalidate}
          run={(_, cmd) => chainApi.changeMember(c.id, memberAct.target!.m.organizationId, { version: memberAct.target!.m.version, status: memberAct.target!.status }, cmd)}
        >
          {() => null}
        </CommandDialog>
      )}
      {prof.target === "ACTIVATE" && profile.data && (
        <CommandDialog {...prof.props} title={tr("Kích hoạt hồ sơ nghiệp vụ")} endpoint="POST /supply-chains/:id/business-profile/activate" description={tr("Mọi thành viên đang hoạt động phải còn hoạt động trên nền tảng. Sau khi kích hoạt, các nghiệp vụ trong chuỗi được phép ghi.")} schema={z.object({})} defaultValues={{}} version={profile.data.version} submitLabel={tr("Kích hoạt")} invalidate={invalidate} run={(_, cmd) => chainApi.activate(c.id, { version: profile.data!.version }, cmd)}>
          {() => null}
        </CommandDialog>
      )}
      {prof.target === "SUSPEND" && profile.data && (
        <CommandDialog {...prof.props} title={tr("Ngừng vận hành chuỗi")} endpoint="POST /supply-chains/:id/business-profile/suspend" description={tr("Chỉ ngừng được khi không còn giao nhận, phần lượng chờ đối soát, chuyến hàng đang chạy hoặc lô thu hồi chưa xử lý.")} schema={z.object({ reason: reason10 })} defaultValues={{ reason: "" }} version={profile.data.version} tone="danger" submitLabel={tr("Ngừng vận hành")} invalidate={invalidate} run={(v, cmd) => chainApi.suspend(c.id, { version: profile.data!.version, reason: v.reason }, cmd)}>
          {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />}
        </CommandDialog>
      )}
    </>
  );
}

/**
 * Staff of the enterprise working in this chain. Business roles come only from
 * member permission groups, so this list is read-only and links to the member.
 * The platform administrator still grants administrative roles here.
 */
