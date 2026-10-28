"use client";

import { useState } from "react";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import {useRouter} from "next/navigation";
import Link from "next/link";
import {ChainSigningKeys as SigningKeys} from "./chain-signing";
import {ShipmentPlans as Plans} from "./shipment-plans";
import {EvidencePanel} from "@/components/ledger/workspace/evidence-panel";

import { useFieldArray, type Control } from "react-hook-form";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";

import { chainApi } from "@/lib/ledger/chain-api";
import { CHAIN_ROLES, CHAIN_TYPES, SUPPLY_STAGES, SCOPED_ROLES, type GrantRecord, type MemberRecord } from "@/lib/ledger/chain-types";


import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import type {SupplyChain} from "@/lib/ledger/chain-types";
import {useAuth as useSession} from "@/lib/auth-store";
import { fmtDate, fmtDateTime } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import {FilterSelect} from "@/components/ledger/kit/filters";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

const CHAIN_TYPE_LABEL: Record<string, string> = localized({ CROP: "Trồng trọt", LIVESTOCK: "Chăn nuôi", AQUACULTURE: "Thủy sản", PROCESSED_FOOD: "Thực phẩm chế biến" });
const STAGE_LABEL: Record<string, string> = localized({ FARM: "Sản xuất", PROCESSOR: "Chế biến", TRANSPORTER: "Vận chuyển", DISTRIBUTOR: "Phân phối", RETAILER: "Bán lẻ" });
const MEMBER_LABEL: Record<string, string> = localized({ INVITED: "Đang mời", ACTIVE: "Hoạt động", SUSPENDED: "Tạm ngừng", REVOKED: "Đã thu hồi" });
const MEMBER_TONE: Record<string, "info" | "ok" | "warn" | "neutral"> = { INVITED: "info", ACTIVE: "ok", SUSPENDED: "warn", REVOKED: "neutral" };
const PROFILE_LABEL: Record<string, string> = localized({ PREPARING: "Đang chuẩn bị", ACTIVE: "Đang vận hành", SUSPENDED: "Đã ngừng" });
const GRANT_LABEL: Record<string, string> = localized({ ORG_ADMIN: "Quản trị tổ chức", CREATE_CHAIN: "Tạo chuỗi", CHAIN_MANAGER: "Điều phối chuỗi", FARM_STAFF: "Sản xuất", TRANSPORTER: "Vận chuyển", RETAILER: "Bán lẻ", DISTRIBUTOR: "Phân phối" });
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
  const [openId, setOpenId] = useState<string | null>(chainId ?? null);
  const accept = useDialog<{ chain: SupplyChain; member: MemberRecord }>();
  const names = useOrgNames();
  const me = user?.organizationId ?? "";
  const canCreate = ctxQ.data?.grants.some((g) => g.scope==="ORGANIZATION" && g.role === "CREATE_CHAIN" && !g.revokedAt);
  const membership = (chainId: string) => ctxQ.data?.memberships.find((m) => m.chainId === chainId);
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
        description={tr("Chuỗi gom các doanh nghiệp theo khâu sản xuất → chế biến → vận chuyển → phân phối → bán lẻ. Chủ chuỗi mời và điều phối thành viên, kích hoạt hồ sơ nghiệp vụ; mỗi doanh nghiệp tự chấp nhận lời mời và cấp vai trò theo chuỗi cho người của mình.")}
        actions={canCreate && <Button size="sm" onClick={() => router.push("/supply-chains/new")}><Plus /> {tr("Tạo chuỗi")}</Button>}
      />
      <PageBody className="min-w-0">
        <div className="min-w-0 overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={chains.data} loading={chains.isLoading} error={chains.error} onRetry={() => chains.refetch()} columns={cols} rowKey={(c) => c.id} empty={<EmptyState title={tr("Doanh nghiệp chưa tham gia chuỗi nào")} />} />
        </div>
      </PageBody>
      <ChainSheet id={openId} view={view} onClose={() => {setOpenId(null);router.push("/supply-chains");}} names={names} />
      {canCreate && view==="new" && <CreateChain props={{open:true,onOpenChange:o=>{if(!o)router.push("/supply-chains");}}} names={names} />}
      {accept.target && (
        <CommandDialog {...accept.props} title={tr("Tham gia chuỗi “{p0}”", { p0: accept.target.chain.name })} endpoint="POST /supply-chains/:id/memberships/:organizationId/accept" description={tr("Doanh nghiệp trở thành thành viên hoạt động; sau đó tài khoản cấp 1 cấp vai trò theo chuỗi cho người thực hiện.")} schema={z.object({})} defaultValues={{}} version={accept.target.member.version} submitLabel={tr("Chấp nhận")} invalidate={[["ws-chains"], ["chain-context"]]} run={(_, cmd) => chainApi.accept(accept.target!.chain.id, me, { version: accept.target!.member.version }, cmd)}>
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
function ChainSheet({ id, onClose, names,view }: { id: string | null; onClose: () => void; names: Names;view:string }) {
  const { user } = useSession();
  const me = user?.organizationId ?? "";
  const chain = useQuery({ queryKey: ["chain", id], queryFn: () => chainApi.chain(id!), enabled: !!id });
  const members = useQuery({ queryKey: ["chain-members", id], queryFn: () => chainApi.members(id!), enabled: !!id });
  const profile = useQuery({ queryKey: ["chain-profile", id], queryFn: () => chainApi.profile(id!), enabled: !!id });
  const ledger = useQuery({ queryKey: ["chain-ledger", id], queryFn: () => chainApi.ledger(id!), enabled: !!id });
  const ctxQ = useQuery({ queryKey: ["chain-context"], queryFn: chainApi.context, enabled: !!id });
  const access=useWorkspaceAccess();
  const useEvidencePermission=access.can("evidence.manage");
  const memberAct = useDialog<MemberAct>();
  const invite = useDialog();
  const prof = useDialog<"ACTIVATE" | "SUSPEND">();
  const c = chain.data;
  const owner = c?.ownerOrganizationId === me;
  const orgAdmin=!!ctxQ.data?.grants.some(g=>g.scope==="ORGANIZATION" && g.role==="ORG_ADMIN" && !g.revokedAt);
  const platformAdmin=user?.role.code==="SYSTEM_ADMIN";
  const manager = owner && !!ctxQ.data?.grants.some((g) => g.chainId === id && g.role === "CHAIN_MANAGER" && !g.revokedAt);
  const invalidate = [["chain", id], ["chain-members", id], ["chain-profile", id], ["ws-chains"], ["chain-context"]];
  const memberIds = new Set((members.data ?? []).map((m) => m.organizationId));
  const invitable = names.partners.filter((p) => p.status === "ACTIVE").flatMap((p) => (p.inviterId === me ? p.invitee : p.inviter) ?? []).filter((o) => !memberIds.has(o.id));
  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {!c ? (
          chain.error ? <ErrorState error={chain.error} onRetry={() => chain.refetch()} /> : <LoadingRows rows={6} />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{c.name}</SheetTitle>
              <SheetDescription><span className="font-mono">{c.code}</span> · {CHAIN_TYPE_LABEL[c.chainType]} · {owner ? tr("bạn là chủ chuỗi") : tr("chủ chuỗi: {p0}", { p0: names.name(c.ownerOrganizationId) })}</SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <nav className="flex flex-wrap gap-3 text-[12.5px] text-brand">{[["",tr("Tổng quan")],["members",tr("Thành viên")],["roles",tr("Vai trò")],["business",tr("Nghiệp vụ")],["plans",tr("Kế hoạch")],["signing",tr("Khóa ký")],["ledger",tr("Sổ cái")]].map(([part,label])=><Link key={part} aria-current={view===part || view==="detail" && part===""?"page":undefined} href={`/supply-chains/${c.id}${part?"/"+part:""}`}>{label}</Link>)}</nav>
              {c.description && <p className="text-[13px]">{c.description}</p>}
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Hồ sơ nghiệp vụ")}</h3>
                {profile.data ? (
                  <div className="flex flex-wrap items-center gap-2 text-[13px]">
                    <Badge tone={profile.data.state === "ACTIVE" ? "ok" : profile.data.state === "PREPARING" ? "info" : "warn"}>{PROFILE_LABEL[profile.data.state]}</Badge>
                    {profile.data.suspensionReason && <span className="text-ink-2">{profile.data.suspensionReason}</span>}
                    {manager && profile.data.state === "PREPARING" && <Button size="xs" onClick={() => prof.open("ACTIVATE")}>{tr("Kích hoạt")}</Button>}
                    {manager && profile.data.state === "ACTIVE" && <Button size="xs" variant="outline" onClick={() => prof.open("SUSPEND")}>{tr("Ngừng vận hành")}</Button>}
                  </div>
                ) : (
                  <LoadingRows rows={1} />
                )}
              </section>
              {c.supplyModel && c.supplyModel.stages.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{tr("Mô hình khâu")}</h3>
                  <ol className="flex flex-wrap items-center gap-1.5 text-[12.5px]">
                    {c.supplyModel.stages.map((s, i) => (
                      <li key={s.stage} className="flex items-center gap-1.5">
                        {i > 0 && <span aria-hidden className="text-ink-2">→</span>}
                        <span className="rounded-sm border border-line px-2 py-1"><span className="font-medium">{STAGE_LABEL[s.stage]}</span>: {s.organizationIds.map(names.name).join(", ")}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              <section className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-[13px] font-semibold">{manager ? tr("Thành viên") : tr("Tư cách thành viên của bạn")}</h3>
                  {manager && <Button size="xs" variant="outline" onClick={() => invite.open(true)} disabled={!invitable.length}><Plus /> {tr("Mời thành viên")}</Button>}
                </div>
                {manager && !invitable.length && (
                  <p className="text-[12.5px] text-ink-2">
                    {tr("Chỉ mời được doanh nghiệp đã là đối tác đang hoạt động và chưa ở trong chuỗi.")}{" "}
                    <Link href="/enterprise/partners" className="text-brand underline">{tr("Kết nối đối tác")}</Link>
                    {c.personal ? ` ${tr("Đối tác cũng tự vào chuỗi khi nhận phiếu giao từ bạn.")}` : ""}
                  </p>
                )}
                <ul className="divide-y divide-line/70 rounded-md border border-line">
                  {(members.data ?? []).map((m) => (
                    <li key={m.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                      <span className="min-w-0 flex-1">{names.name(m.organizationId)}{m.organizationId === c.ownerOrganizationId ? ` · ${tr("chủ chuỗi")}` : ""}</span>
                      <Badge tone={MEMBER_TONE[m.status]}>{MEMBER_LABEL[m.status]}</Badge>
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
              </section>
              {profile.data?.state === "ACTIVE" && <Plans chainId={c.id} manager={manager} names={names} members={members.data ?? []} />}
              {(orgAdmin || platformAdmin) && <Grants chainId={c.id} ownerOrganizationId={c.ownerOrganizationId}/> }
              {me && <SigningKeys chainId={c.id} canManage={orgAdmin}/>}
              {access.can("evidence.read") && <EvidencePanel entityType="CHAIN" entityId={c.id} canManage={manager && useEvidencePermission}/>}
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Sổ cái của chuỗi")}</h3>
                {ledger.data ? (
                  <dl className="grid grid-cols-[minmax(0,170px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                    <dt className="text-ink-2">{tr("Hồ sơ / kênh")}</dt>
                    <dd className="font-mono text-[12px]">{ledger.data.profile} · {ledger.data.channelId ?? tr("chưa gắn kênh")}</dd>
                    <dt className="text-ink-2">{tr("Trạng thái gắn kết")}</dt>
                    <dd>{ledger.data.bindingStatus ? <Badge tone={ledger.data.worker.healthy ? "ok" : "warn"}>{ledger.data.bindingStatus}</Badge> : "—"}</dd>
                    <dt className="text-ink-2">{tr("Quyền trên sổ cái")}</dt>
                    <dd className="font-mono text-[12px]">{tr("{p0} hiệu lực · {p1} chờ · {p2} đang thu hồi", { p0: ledger.data.permissions.active, p1: ledger.data.permissions.pending, p2: ledger.data.permissions.revoking })}</dd>
                    <dt className="text-ink-2">{tr("Ghi sổ")}</dt>
                    <dd className="font-mono text-[12px]">{tr("{p0} xong · {p1} chờ · {p2} lỗi", { p0: ledger.data.delivery.completed, p1: ledger.data.delivery.pending, p2: ledger.data.failedControlJobs })}</dd>
                    <dt className="text-ink-2">{tr("Giữ lệnh đang mở")}</dt>
                    <dd className="font-mono text-[12px]">{ledger.data.openHolds}</dd>
                    {ledger.data.worker.lastCheckedAt && (
                      <>
                        <dt className="text-ink-2">{tr("Kiểm tra gần nhất")}</dt>
                        <dd className="font-mono text-[12px]">{fmtDateTime(ledger.data.worker.lastCheckedAt)}</dd>
                      </>
                    )}
                  </dl>
                ) : ledger.error ? (
                  <p className="text-[12.5px] text-ink-2">{ledger.error.message}</p>
                ) : (
                  <LoadingRows rows={2} />
                )}
                {ledger.data && <dl className="grid grid-cols-[minmax(0,170px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">{[[tr("Quyền đang giữ"),ledger.data.permissions.held],[tr("Lệnh điều khiển chờ"),ledger.data.pendingControlJobs],[tr("Đang thử ghi lại"),ledger.data.delivery.retry],[tr("Cần xử lý ghi sổ"),ledger.data.delivery.deadLetter],[tr("Tuổi yêu cầu chờ (giây)"),ledger.data.delivery.pendingAgeSeconds ?? "—"],[tr("Chờ lâu nhất từ"),ledger.data.delivery.oldestPendingAt?fmtDateTime(ledger.data.delivery.oldestPendingAt):"—"],[tr("Lỗi điều khiển gần nhất"),ledger.data.lastControlFailureAt?fmtDateTime(ledger.data.lastControlFailureAt):"—"],[tr("Hạn chứng thư"),ledger.data.worker.certificateExpiresAt?fmtDateTime(ledger.data.worker.certificateExpiresAt):"—"],[tr("Worker hoạt động lần cuối"),ledger.data.worker.lastHealthyAt?fmtDateTime(ledger.data.worker.lastHealthyAt):"—"]].map(([label,value])=><div key={label} className="contents"><dt className="text-ink-2">{label}</dt><dd className="min-w-0 break-words font-mono text-[12px]">{value}</dd></div>)}</dl>}
                {ledger.data && !ledger.data.worker.healthy && <Callout tone="warn">{tr("Chưa xác nhận Worker đang hoạt động bình thường")}</Callout>}
                {ledger.data?.worker.certificateExpired && <Callout tone="danger">{tr("Chứng thư sổ cái đã hết hạn")}</Callout>}{ledger.data?.worker.heartbeatStale && <Callout tone="warn">{tr("Chưa nhận được heartbeat Worker mới")}</Callout>}{ledger.data?.worker.lastErrorCode && <Callout tone="warn">{ledger.data.worker.lastErrorCode}</Callout>}
                <p className="text-[11.5px] text-ink-2">{tr("Chỉ đọc; gắn kết sổ cái do nền tảng quản lý.")}</p>
              </section>
            </div>
            {invite.target && (
              <CommandDialog {...invite.props} title={tr("Mời thành viên")} endpoint="POST /supply-chains/:id/memberships" description={tr("Doanh nghiệp được mời phải đang hoạt động và tự chấp nhận lời mời.")} schema={z.object({ organizationId: z.string().min(1, { error: () => tr("Chọn tổ chức") }) })} defaultValues={{ organizationId: "" }} submitLabel={tr("Gửi lời mời")} invalidate={invalidate} run={(v, cmd) => chainApi.invite(c.id, v, cmd)}>
                {(f) => <SelectField control={f.control} name="organizationId" label={tr("Đối tác")} options={invitable.map((o) => ({ value: o.id, label: o.name }))} />}
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
        )}
      </SheetContent>
    </Sheet>
  );
}

function Grants({ chainId,ownerOrganizationId }: { chainId: string;ownerOrganizationId:string }) {
  const { user } = useSession();
  const platformAdmin=user?.role.code==="SYSTEM_ADMIN";
  const [selectedOrg,setSelectedOrg]=useState(ownerOrganizationId);
  const org = platformAdmin?selectedOrg:user?.organizationId ?? "";
  const organizations=useQuery({queryKey:["chain-organizations"],queryFn:chainApi.organizations,enabled:platformAdmin});
  const grants = useQuery({ queryKey: ["scoped-grants", org], queryFn: () => chainApi.scopedGrants(org) });
  const users = useQuery({ queryKey: ["scoped-users", org], queryFn: () => chainApi.scopedUsers(org) });
  const add = useDialog();
  const revoke = useDialog<GrantRecord>();
  const name = (id: string) => users.data?.find((u) => u.id === id)?.fullName ?? id.slice(0, 8);
  const capability=useDialog();
  const {access}=useWorkspaceAccess();
  const businessCapability:Record<string,string>={FARM_STAFF:"FARM",TRANSPORTER:"TRANSPORTER",PROCESSOR:"PROCESSOR",DISTRIBUTOR:"DISTRIBUTOR",RETAILER:"RETAILER"};
  const eligibleRoles=platformAdmin?[...SCOPED_ROLES]:CHAIN_ROLES.filter(r=>access?.capabilities.includes(businessCapability[r]));
  const rows = (grants.data ?? []).filter((g) => !g.revokedAt && (g.chainId === chainId || platformAdmin && !g.chainId));
  const invalidate = [["scoped-grants", org], ["chain-context"]];
  return (
    <section className="flex flex-col gap-2">
      <div className="flex items-center justify-between">
        <h3 className="text-[13px] font-semibold">{tr("Vai trò theo chuỗi của doanh nghiệp bạn")}</h3>
        <Button size="xs" variant="outline" disabled={!eligibleRoles.length} onClick={() => add.open(true)}><Plus /> {tr("Cấp vai trò")}</Button>
      </div>
      {platformAdmin && <div className="flex flex-wrap gap-2"><FilterSelect label={tr("Tổ chức quản lý quyền")} value={selectedOrg} onChange={v=>setSelectedOrg(v||ownerOrganizationId)} options={(organizations.data??[]).map(o=>({value:o.id,label:o.name}))}/><Button size="xs" variant="outline" onClick={()=>capability.open(true)}>{tr("Cấp năng lực")}</Button></div>}
      <Callout tone="info">{tr("Tài khoản cấp 1 chỉ cấp được vai trò thực hiện nghiệp vụ (sản xuất, vận chuyển, bán lẻ, phân phối) phù hợp năng lực doanh nghiệp, khi doanh nghiệp là thành viên hoạt động của chuỗi. Vai trò quản trị do nền tảng cấp.")}</Callout>
      {grants.error ? (
        <ErrorState error={grants.error} onRetry={() => grants.refetch()} />
      ) : rows.length ? (
        <ul className="divide-y divide-line/70 rounded-md border border-line">
          {rows.map((g) => (
            <li key={g.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
              <span className="min-w-0 flex-1">{name(g.userId)}</span>
              <Badge tone="brand" dot={false}>{GRANT_LABEL[g.role] ?? g.role}</Badge>
              <span className="font-mono text-[11.5px] text-ink-2">{fmtDate(g.createdAt)}</span>
              {(platformAdmin || ["FARM_STAFF", "TRANSPORTER", "PROCESSOR", "DISTRIBUTOR", "RETAILER"].includes(g.role)) && <Button size="xs" variant="outline" onClick={() => revoke.open(g)}>{tr("Thu hồi")}</Button>}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[12.5px] text-ink-2">{tr("Chưa cấp vai trò nào trong chuỗi này.")}</p>
      )}
      {platformAdmin && <CommandDialog {...capability.props} title={tr("Cấp năng lực tổ chức")} endpoint={`POST /organizations/${org}/capabilities`} schema={z.object({code:z.enum(["FARM","TRANSPORTER","DISTRIBUTOR","RETAILER","AUDITOR"])})} defaultValues={{code:"FARM"}} submitLabel={tr("Cấp năng lực")} invalidate={[["chain-context"]]} run={(v,cmd)=>chainApi.capability(org,v,cmd)}>{f=><SelectField control={f.control} name="code" label={tr("Năng lực")} options={["FARM","TRANSPORTER","DISTRIBUTOR","RETAILER","AUDITOR"].map(v=>({value:v,label:v}))}/>}</CommandDialog>}
      {add.target && (
        <CommandDialog {...add.props} title={tr("Cấp vai trò theo chuỗi")} endpoint="POST /organizations/:id/scoped-grants" schema={z.object({ userId: z.string().min(1, { error: () => tr("Chọn người") }), role: z.enum(SCOPED_ROLES) })} defaultValues={{ userId: "", role: eligibleRoles[0]??"FARM_STAFF" }} submitLabel={tr("Cấp vai trò")} invalidate={invalidate} run={(v, cmd) => chainApi.grant(org, { ...v, chainId:["ORG_ADMIN","CREATE_CHAIN"].includes(v.role)?undefined:chainId }, cmd)}>
          {(f) => (
            <>
              <SelectField control={f.control} name="userId" label={tr("Người nhận")} options={(users.data ?? []).map((u) => ({ value: u.id, label: u.fullName }))} />
              <SelectField control={f.control} name="role" label={tr("Vai trò")} options={eligibleRoles.map((r) => ({ value: r, label: GRANT_LABEL[r] }))} />
            </>
          )}
        </CommandDialog>
      )}
      {revoke.target && (
        <CommandDialog {...revoke.props} title={tr("Thu hồi vai trò {p0} của {p1}", { p0: GRANT_LABEL[revoke.target.role], p1: name(revoke.target.userId) })} endpoint="POST /organizations/:id/scoped-grants/:grantId/revoke" schema={z.object({})} defaultValues={{}} version={revoke.target.revision} tone="danger" submitLabel={tr("Thu hồi")} invalidate={invalidate} run={(_, cmd) => chainApi.revokeGrant(org, revoke.target!.id, { chainId: revoke.target!.chainId, version: revoke.target!.revision }, cmd)}>
          {() => null}
        </CommandDialog>
      )}
    </section>
  );
}
