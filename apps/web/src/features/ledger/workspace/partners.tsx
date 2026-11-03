"use client";

import {useRouter} from "next/navigation";
import {EvidencePanel} from "@/components/ledger/workspace/evidence-panel";
import {Sheet,SheetContent,SheetHeader,SheetTitle,SheetDescription} from "@/components/ledger/ui/sheet";
import {Dialog,DialogContent,DialogHeader,DialogTitle,DialogDescription} from "@/components/ledger/ui/dialog";
import { useState } from "react";
import {useLedgerInfiniteQuery as useInfiniteQuery, useLedgerQuery as useQuery} from "@/lib/ledger/data";
import { z } from "zod";
import { Building2, Plus, Search, UserPlus } from "lucide-react";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import type { ExternalPartner, Partner, PartnerSearchItem } from "@/lib/ledger/coordination-types";
import { fmtDate } from "@/lib/ledger/format";
import { CAPABILITY_LABEL } from "@/lib/ledger/labels";
import { useOverview, useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { PartnerProfileDialog } from "@/components/ledger/workspace/partner-profile";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { useDebounced } from "@/components/ledger/kit/filters";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const inviteSchema = z.object({ note: z.string().max(500, { error: () => tr("Tối đa 500 ký tự") }).optional() });
const externalSchema = z.object({
  kind: z.enum(["FARM", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"]),
  name: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(255),
  businessId: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(40),
  taxCode: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(14),
  address: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(500),
  representative: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(255),
  phone: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(30),
  email: z.string().trim().email({ error: () => tr("Email không hợp lệ") }),
  note: z.string().trim().min(1, { error: () => tr("Bắt buộc") }).max(1000),
});
const STATUS: Record<string, "info" | "ok" | "danger" | "neutral"> = { INVITED: "info", ACTIVE: "ok", REJECTED: "danger", REVOKED: "neutral" };
const STATUS_TEXT: Record<string, string> = { get INVITED() { return tr("Chờ phản hồi"); }, get ACTIVE() { return tr("Đang liên kết"); }, get REJECTED() { return tr("Bị từ chối"); }, get REVOKED() { return tr("Đã chấm dứt"); } };
type Source = "AGRITRACE" | "EXTERNAL";
/** One row of the merged partner list: an AgriTrace link or a private address-book entry. */
type Row = { id: string; source: Source; name: string; code: string; kind: string; detail: string; note: string | null; createdAt: string; link?: Partner; ext?: ExternalPartner };

export default function PartnersPage({view="list",partnerId,externalMode=false}:{view?:"list"|"new"|"external";partnerId?:string;externalMode?:boolean}) {
 const router=useRouter();
  const { can } = useWorkspaceAccess();
  const o = useOverview();
  const me = o.data?.organization.id;
  const manage=can("partners.manage");
  const [filter, setFilter] = useState<"ALL" | Source>(view==="external" ? "EXTERNAL" : "ALL");
  const [adding, setAdding] = useState(view==="new" && !externalMode);
  const partners = useQuery({ queryKey: ["ws-partners"], queryFn: wapi.partners, enabled: can("partners.read") });
  const external = useQuery({ queryKey: ["ws-external"], queryFn: wapi.externalPartners, enabled: can("partners.read") });
  const [text, setText] = useState("");
  const q = useDebounced(text.trim());
  const search = useQuery({ queryKey: ["ws-partner-search", q], queryFn: () => wapi.searchPartners(q), enabled: manage && adding && q.length >= 2 });
  const directory = useInfiniteQuery({
    queryKey: ["ws-partner-directory"],
    queryFn: ({ pageParam }) => wapi.partnerDirectory(pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.nextCursor ?? undefined,
    enabled: manage && adding && q.length < 2,
  });
  // Search also returns our own external entries; those are already in the table and have no AgriTrace profile.
  const found = search.data?.filter((s) => s.registered);
  const directoryItems = directory.data?.pages.flatMap((page) => page.items);
  const searching = q.length >= 2;
  const candidates: PartnerSearchItem[] = searching
    ? found ?? []
    : (directoryItems ?? []).map((item) => ({
        id: item.id,
        businessId: item.agriTraceCode,
        taxCode: null,
        agriTraceCode: item.agriTraceCode,
        name: item.name,
        kind: item.kind,
        registered: true,
        matched: "CODE",
      }));
  const candidateError = searching ? search.error : directory.error;
  const candidateLoading = searching ? search.isLoading : directory.isLoading;
  const invite = useDialog<PartnerSearchItem>();
  const resolve = useDialog<{ p: Partner; decision: "ACCEPT" | "REJECT" | "REVOKE" }>();
  const addExternal = useDialog();
  const [profileOf, setProfileOf] = useState<string | null>(null);

  const detail=external.data?.find(p=>p.id===partnerId);
  const invalidate = [["ws-partners"]];

  const other = (p: Partner) => (p.inviterId === me ? p.invitee : p.inviter);
  const rows: Row[] = [
    ...(partners.data ?? []).map((p): Row => ({ id: `l-${p.id}`, source: "AGRITRACE", name: other(p)?.name ?? "—", code: other(p)?.code ?? "", kind: other(p)?.type ?? "", detail: p.inviterId === me ? tr("Mình mời liên kết") : tr("Được mời liên kết"), note: p.note ?? null, createdAt: p.createdAt, link: p })),
    ...(external.data ?? []).map((p): Row => ({ id: `e-${p.id}`, source: "EXTERNAL", name: p.name, code: p.taxCode ? `MST ${p.taxCode}` : p.businessId, kind: p.kind, detail: [p.representative, p.phone].filter(Boolean).join(" · ") || "—", note: p.note, createdAt: p.createdAt, ext: p })),
  ].filter((r) => filter === "ALL" || r.source === filter).sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const count = (k: Source) => (k === "AGRITRACE" ? partners.data?.length : external.data?.length) ?? 0;
  const linkActions = (p: Partner) => (
    <span className="flex gap-1">
      {p.status === "INVITED" && p.inviteeId === me && (
        <>
          <Button size="xs" onClick={() => resolve.open({ p, decision: "ACCEPT" })}>{tr("Chấp nhận")}</Button>
          <Button size="xs" variant="outline" onClick={() => resolve.open({ p, decision: "REJECT" })}>{tr("Từ chối")}</Button>
        </>
      )}
      {(p.status === "ACTIVE" || (p.status === "INVITED" && p.inviterId === me)) && (
        <Button size="xs" variant="ghost" onClick={() => resolve.open({ p, decision: "REVOKE" })}>{p.status === "ACTIVE" ? tr("Chấm dứt") : tr("Rút lời mời")}</Button>
      )}
    </span>
  );
  const cols: Column<Row>[] = [
    { key: "org", header: tr("Đối tác"), cell: (r) => <span className="flex flex-col"><button type="button" className="text-left font-medium hover:underline" onClick={() => r.link ? setProfileOf(other(r.link)?.id ?? null) : router.push(`/enterprise/partners/external/${r.ext!.id}`)}>{r.name}</button><span className="font-mono text-[11px] text-ink-2">{r.code}</span></span> },
    { key: "source", header: tr("Nguồn"), cell: (r) => r.source === "AGRITRACE" ? <Badge tone="info">AgriTrace</Badge> : <Badge tone="neutral">{tr("Ngoài AgriTrace")}</Badge> },
    { key: "type", header: tr("Loại"), hideBelow: "md", cell: (r) => <span className="text-[12px]">{CAPABILITY_LABEL[r.kind] ?? r.kind}</span> },
    { key: "detail", header: tr("Liên kết / liên hệ"), hideBelow: "md", cell: (r) => <span className="text-[12px] text-ink-2">{r.detail}</span> },
    { key: "note", header: tr("Ghi chú"), hideBelow: "lg", cell: (r) => <span className="line-clamp-1 text-ink-2">{r.note ?? "—"}</span> },
    { key: "date", header: tr("Từ"), hideBelow: "md", cell: (r) => <span className="font-mono text-[12px]">{fmtDate(r.createdAt)}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (r) => r.link ? <Badge tone={STATUS[r.link.status] ?? "neutral"}>{STATUS_TEXT[r.link.status] ?? r.link.status}</Badge> : <Badge tone="neutral" dot={false}>{tr("Danh bạ riêng")}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (r) => manage && r.link ? linkActions(r.link) : null },
  ];
  const r = resolve.target;

  return (
    <>
      <PageHeader
        title={tr("Đối tác")}
        description={tr("Danh sách chung đối tác trong AgriTrace (liên kết để giao lô, mời vào chuỗi) và đối tác ngoài AgriTrace (danh bạ riêng, dùng làm nhà cung cấp khai báo).")}
        actions={
          manage && (
            <Button size="sm" onClick={() => setAdding(true)}>
              <Plus /> {tr("Thêm đối tác")}
            </Button>
          )
        }
      />
      <PageBody className="min-w-0">
        <div role="tablist" className="flex flex-wrap gap-1">
          {(["ALL", "AGRITRACE", "EXTERNAL"] as const).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={filter === k} onClick={() => setFilter(k)} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", filter === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
              {k === "ALL" ? tr("Tất cả") : k === "AGRITRACE" ? tr("Trong AgriTrace") : tr("Ngoài AgriTrace")}
              <span className="ml-1.5 font-mono text-[11px] opacity-70">{k === "ALL" ? count("AGRITRACE") + count("EXTERNAL") : count(k)}</span>
            </button>
          ))}
        </div>
        <div className="min-w-0 overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={partners.isLoading || external.isLoading ? undefined : rows} loading={partners.isLoading || external.isLoading} error={partners.error ?? external.error} onRetry={() => { partners.refetch(); external.refetch(); }} columns={cols} rowKey={(r) => r.id} empty={<EmptyState title={tr("Chưa có đối tác")} />} />
        </div>
      </PageBody>
      <Dialog open={manage && adding} onOpenChange={(o) => { setAdding(o); if (!o) { setText(""); if (view === "new") router.push("/enterprise/partners"); } }}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader className="pr-8">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <DialogTitle>{tr("Thêm đối tác")}</DialogTitle>
                <DialogDescription className="mt-1">{tr("Doanh nghiệp đã dùng AgriTrace thì gửi lời mời liên kết; chưa dùng thì lưu vào danh bạ riêng.")}</DialogDescription>
              </div>
              <Button size="xs" variant="outline" className="shrink-0" title={tr("Khai báo đối tác chưa dùng AgriTrace")} onClick={() => { setAdding(false); addExternal.open(true); }}>
                <UserPlus className="size-3.5" aria-hidden /> {tr("Ngoài AgriTrace")}
              </Button>
            </div>
          </DialogHeader>
          <div className="flex min-h-0 flex-col gap-3">
            <div className="rounded-md border border-line p-3">
              <p className="flex items-center gap-2 text-[13px] font-medium"><Building2 className="size-4" aria-hidden /> {tr("Trong AgriTrace")}</p>
              <p className="mt-0.5 text-[12px] text-ink-2">{tr("Chỉ doanh nghiệp đã được duyệt hồ sơ trên AgriTrace mới được mời liên kết.")}</p>
              <div className="relative mt-2">
                <Search className="absolute top-2.5 left-2.5 size-4 text-ink-2" aria-hidden />
                <Input aria-label={tr("Tìm theo tên, mã AgriTrace hoặc MST")} placeholder={tr("Tên, mã AGT-… hoặc mã số thuế")} value={text} onChange={(e) => setText(e.target.value)} className="bg-card pl-8" />
              </div>
              {candidateError && !candidates.length ? (
                <ErrorState error={candidateError} compact onRetry={() => { void (searching ? search.refetch() : directory.refetch()); }} />
              ) : candidateLoading && !candidates.length ? (
                <LoadingRows rows={3} className="mt-2" />
              ) : !candidates.length ? (
                <EmptyState title={tr(searching ? "Không tìm thấy doanh nghiệp phù hợp." : "Chưa có doanh nghiệp phù hợp để mời.")} />
              ) : (
                <ul className="mt-2 flex max-h-[55vh] flex-col gap-2 overflow-y-auto pr-1">
                  {candidates.map((s) => (
                    <li key={s.id} className="flex flex-col gap-2 rounded-md border border-line bg-card p-3 text-[13px]">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium">{s.name}</p>
                          <p className="mt-0.5 text-[12px] text-ink-2">{CAPABILITY_LABEL[s.kind] ?? s.kind}</p>
                        </div>
                        <Badge tone="info">AgriTrace</Badge>
                      </div>
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line/70 pt-2">
                        <span className="font-mono text-[11px] text-ink-2">{s.taxCode ? `MST ${s.taxCode}` : s.agriTraceCode}</span>
                        <span className="flex shrink-0 gap-1">
                          <Button size="xs" variant="ghost" onClick={() => setProfileOf(s.id)}>{tr("Hồ sơ")}</Button>
                          <Button size="xs" variant="outline" onClick={() => { setAdding(false); invite.open(s); }}>{tr("Mời liên kết")}</Button>
                        </span>
                      </div>
                    </li>
                  ))}
                  {!searching && directory.hasNextPage && (
                    <li className="flex justify-center py-1">
                      <Button size="xs" variant="outline" onClick={() => void directory.fetchNextPage()} disabled={directory.isFetchingNextPage}>
                        {directory.isFetchingNextPage ? tr("Đang tải…") : tr("Tải thêm")}
                      </Button>
                    </li>
                  )}
                </ul>
              )}
              {candidateError && !!candidates.length && (
                <div className="mt-2 flex items-center justify-between gap-2 text-[12px] text-danger" role="alert">
                  <span>{tr("Không tải thêm được doanh nghiệp.")}</span>
                  <Button size="xs" variant="outline" onClick={() => { void (searching ? search.refetch() : directory.refetch()); }}>{tr("Thử lại")}</Button>
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>
      {invite.target && (
        <CommandDialog {...invite.props} title={tr("Mời liên kết · {p0}", { p0: invite.target.name })} endpoint="POST /enterprise-workspace/partners" schema={inviteSchema} defaultValues={{ note: "" }} submitLabel={tr("Gửi lời mời")} invalidate={invalidate} run={(v, cmd) => wapi.invitePartner({ businessId: invite.target!.agriTraceCode ?? invite.target!.businessId, note: v.note || undefined }, cmd)}>
          {(f) => <TextAreaField control={f.control} name="note" label={tr("Ghi chú cho đối tác")} max={500} />}
        </CommandDialog>
      )}
      {r && (
        <CommandDialog
          {...resolve.props}
          title={r.decision === "ACCEPT" ? tr("Chấp nhận liên kết") : r.decision === "REJECT" ? tr("Từ chối liên kết") : tr("Chấm dứt liên kết")}
          endpoint={`POST /enterprise-workspace/partners/${r.p.id}`}
          description={`${other(r.p)?.name ?? ""}`}
          schema={z.object({})}
          defaultValues={{}}
          version={r.p.version}
          tone={r.decision === "ACCEPT" ? "default" : "danger"}
          submitLabel={tr("Xác nhận")}
          invalidate={invalidate}
          run={(_, cmd) => wapi.resolvePartner(r.p.id, { decision: r.decision, version: r.p.version }, cmd)}
        >
          {() => null}
        </CommandDialog>
      )}
      <CommandDialog
        {...addExternal.props} open={manage && (externalMode || addExternal.props.open)} onOpenChange={o=>{addExternal.props.onOpenChange(o);if(!o && externalMode)router.push("/enterprise/partners");}} onDone={()=>router.push("/enterprise/partners")}
        title={tr("Thêm đối tác ngoài hệ thống")}
        endpoint="POST /enterprise-workspace/partners/external"
        description={tr("Nếu mã đã thuộc một doanh nghiệp AgriTrace, hệ thống từ chối và đề nghị gửi lời mời liên kết.")}
        schema={externalSchema}
        defaultValues={{ kind: "TRANSPORTER", name: "", businessId: "", taxCode: "", address: "", representative: "", phone: "", email: "", note: "" }}
        submitLabel={tr("Thêm đối tác")}
        invalidate={[["ws-external"]]}
        wide
        run={(v, cmd) => wapi.createExternalPartner({...v,phone:v.phone.replace(/[ .()-]/g,"")}, cmd)}
      >
        {(f) => (
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField control={f.control} name="kind" label={tr("Loại")} options={["FARM", "TRANSPORTER", "DISTRIBUTOR", "RETAILER"].map((k) => ({ value: k, label: CAPABILITY_LABEL[k] }))} />
            <TextField control={f.control} name="name" label={tr("Tên")} />
            <TextField control={f.control} name="businessId" label={tr("Số đăng ký kinh doanh")} />
            <TextField control={f.control} name="taxCode" label={tr("Mã số thuế")} />
            <TextField control={f.control} name="representative" label={tr("Người đại diện")} />
            <TextField control={f.control} name="phone" label={tr("Điện thoại")} />
            <TextField control={f.control} name="email" label="Email" type="email" />
            <TextField control={f.control} name="address" label={tr("Địa chỉ")} />
            <TextAreaField control={f.control} name="note" label={tr("Ghi chú")} className="sm:col-span-2" />
          </div>
        )}
      </CommandDialog>
      <Sheet open={!!detail} onOpenChange={o=>{if(!o)router.push("/enterprise/partners");}}><SheetContent className="w-full overflow-y-auto sm:max-w-xl"><SheetHeader><SheetTitle>{detail?.name}</SheetTitle><SheetDescription>{detail?.businessId}</SheetDescription></SheetHeader>{detail && <div className="flex flex-col gap-4 px-4 pb-6"><p className="text-sm">{[detail.representative,detail.phone,detail.email,detail.address,detail.note].filter(Boolean).join(" · ")}</p><EvidencePanel entityType="EXTERNAL_PARTNER" entityId={detail.id} canManage={manage && can("evidence.manage")} required={[{kind:"PARTNER_LOGO",min:1},{kind:"PARTNERSHIP_EVIDENCE",min:1}]}/></div>}</SheetContent></Sheet>
      <PartnerProfileDialog organizationId={profileOf} onClose={() => setProfileOf(null)} />
    </>
  );
}
