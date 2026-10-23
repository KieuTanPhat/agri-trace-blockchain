"use client";

import { useState } from "react";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import { useFieldArray, useWatch, type Control } from "react-hook-form";
import { z } from "zod";
import { Plus, Trash2 } from "lucide-react";
import {usePathname,useRouter} from "next/navigation";
import DistributionSigningPage from "./chain-signing";
import {DistributionSignature} from "./distribution-signing";

import { distApi } from "@/lib/ledger/dist-api";
import type {Phase, Transfer, TransferAction, TransferDetail } from "@/lib/ledger/dist-types";
import { wapi } from "@/lib/ledger/enterprise-coordination-api";
import {useAuth as useSession} from "@/lib/auth-store";
import { fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { isoToLocal, localToIso } from "@/lib/ledger/ops-dates";

import { useNow } from "@/lib/ledger/use-now";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";

import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ledger/ui/sheet";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

export const TRANSFER_STATUS_LABEL: Record<string, string> = localized({ PROPOSED: "Chờ đồng thuận", READY: "Sẵn sàng lấy hàng", IN_TRANSIT: "Đang vận chuyển", DELIVERED: "Đã giao", CANCELLED: "Đã hủy" });
const TRANSFER_TONE: Record<string, "info" | "brand" | "ok" | "neutral" | "warn"> = { PROPOSED: "info", READY: "warn", IN_TRANSIT: "brand", DELIVERED: "ok", CANCELLED: "neutral" };
const ACTION_LABEL: Record<string, string> = localized({
  CONSENT: "Ký đồng thuận",
  PICKUP: "Ký lấy hàng",
  DELIVERY: "Ký giao hàng",
  ACTUAL_RECEIPT: "Lập biên bản thực nhận",
  CANCEL: "Hủy chặng",
  OBSERVE: "Ghi nhật ký vận chuyển",
  RETURN: "Đề nghị trả hàng",
  RENEW_CONSENT: "Yêu cầu đồng thuận lại",
  SIGN_RETURN: "Ký trả hàng",
  RECONCILE_REMAINDER: "Đối soát phần còn lại",
});
const ROLE_LABEL: Record<string, string> = localized({ SENDER: "Bên giao", CARRIER: "Bên vận chuyển", RECEIVER: "Bên nhận" });
const PHASE_LABEL: Record<Phase, string> = localized({ CONSENT: "Đồng thuận (3 bên)", PICKUP: "Lấy hàng (giao + vận chuyển)", DELIVERY: "Giao hàng (vận chuyển + nhận)" });
const DEC = /^\d{1,11}(\.\d{1,3})?$/;
const dec = (msg = () => tr("Số không âm, tối đa 3 chữ số thập phân")) => z.string().regex(DEC, { error: msg });
const reason10 = z.string().trim().min(10, { error: () => tr("Tối thiểu 10 ký tự") }).max(1000);

export default function DistributionPage({route}:{route:import("@/lib/ledger/route-input").LedgerRouteInput}) {
 const pathname=usePathname(),router=useRouter(),routeId=typeof route.params.id==="string"?route.params.id:undefined,isNew=pathname==="/distribution/new";
  const { can } = useWorkspaceAccess();
  const [tab, setTab] = useState<"transfers" | "tasks" | "keys">("transfers");
  const [openId, setOpenId] = useState<string | null>(routeId??null);
  const transfers = useQuery({ queryKey: ["dist-transfers"], queryFn: distApi.transfers, enabled: can("distribution.read") });
  const create = useDialog();
  if (!can("distribution.read")) return <ErrorState error={new Error(tr("Bạn chưa có quyền distribution.read"))} />;
  const cols: Column<Transfer>[] = [
    { key: "route", header: tr("Chặng"), cell: (t) => <span className="flex flex-col"><span className="font-medium">{t.origin} → {t.destination}</span><span className="font-mono text-[11px] text-ink-2">{t.id.slice(0, 8)} · v{t.version}</span></span> },
    { key: "parties", header: tr("Giao → vận chuyển → nhận"), hideBelow: "md", cell: (t) => <span className="text-[12.5px]">{t.senderName} → {t.carrierName} → {t.receiverName}</span> },
    { key: "lines", header: tr("Lô"), hideBelow: "lg", cell: (t) => <span className="text-[12.5px]">{t.lines.map((l) => `${l.lotCode} (${fmtNumber(l.quantity)} ${l.unit})`).join(", ")}</span> },
    { key: "pickup", header: tr("Dự kiến lấy"), hideBelow: "lg", cell: (t) => <span className="font-mono text-[12px]">{fmtDateTime(t.plannedPickupAt)}</span> },
    { key: "status", header: tr("Trạng thái"), cell: (t) => <Badge tone={TRANSFER_TONE[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Badge> },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (t) => <Button size="xs" variant="outline" onClick={() => router.push(`/distribution/${t.id}`)}>{tr("Chi tiết")}</Button> },
  ];
  return (
    <>
      <PageHeader
        title={tr("Giao nhận")}
        description={tr("Chặng giao nhận giữa ba doanh nghiệp độc lập (giao, vận chuyển, nhận) đã liên kết đối tác và cùng thuộc chuỗi. Mỗi bước được ký số Ed25519 trên ảnh chụp chuẩn hóa của chặng: đồng thuận (3 bên) → lấy hàng (2 bên) → giao hàng (2 bên). Tồn kho chỉ dịch chuyển khi đủ chữ ký.")}
        actions={can("distribution.write") && <Button size="sm" onClick={() => router.push("/distribution/new")}><Plus /> {tr("Tạo chặng giao nhận")}</Button>}
      />
      <PageBody>
        <div role="tablist" className="flex gap-1">
          {(["transfers", "tasks", "keys"] as const).map((k) => (
            <button key={k} role="tab" type="button" aria-selected={tab === k} onClick={() => setTab(k)} className={cn("h-8 rounded-md border px-3 text-[12.5px] font-medium", tab === k ? "border-ink bg-ink text-canvas" : "border-line bg-card")}>
              {{ transfers: tr("Chặng giao nhận"), tasks: tr("Việc chờ"), keys: tr("Khóa ký") }[k]}
            </button>
          ))}
        </div>
        {tab === "transfers" && (
          <div className="overflow-hidden rounded-md border border-line bg-card">
            <DataTable rows={transfers.data} loading={transfers.isLoading} error={transfers.error} onRetry={() => transfers.refetch()} columns={cols} rowKey={(t) => t.id} empty={<EmptyState title={tr("Chưa có chặng giao nhận")} />} />
          </div>
        )}
        {tab === "tasks" && <Tasks onOpen={setOpenId} />}
        {tab === "keys" && <DistributionSigningPage/>}
      </PageBody>
      <TransferSheet id={openId} view={pathname.endsWith("/journal")?"journal":"detail"} onClose={() => {setOpenId(null);router.push("/distribution");}}/>
      {(create.target||isNew)&&can("distribution.write")&&<CreateTransfer props={{open:true,onOpenChange:o=>{if(!o){create.close();if(isNew)router.push("/distribution");}}}}/>}
    </>
  );
}

// ---------------------------------------------------------------------------
function Tasks({ onOpen }: { onOpen: (id: string) => void }) {
  const q = useQuery({ queryKey: ["dist-tasks"], queryFn: distApi.tasks });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows rows={4} />;
  const { transfers, stock } = q.data;
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <section className="rounded-md border border-line bg-card">
        <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">{tr("Giao nhận chờ bạn")} <span className="font-mono text-ink-2">{transfers.length}</span></h3>
        {transfers.length ? (
          <ul className="divide-y divide-line/70">
            {transfers.map((t, i) => (
              <li key={`${t.transferId}-${t.action}-${i}`} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                <Badge tone="brand" dot={false}>{ACTION_LABEL[t.action] ?? t.action}</Badge>
                <span className="min-w-0 flex-1 truncate">{t.origin} → {t.destination}</span>
                <span className="text-[12px] text-ink-2">{ROLE_LABEL[t.role]}</span>
                <Button size="xs" variant="outline" onClick={() => onOpen(t.transferId)}>{tr("Mở")}</Button>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={tr("Không có giao nhận chờ xử lý")} />
        )}
      </section>
      <section className="rounded-md border border-line bg-card">
        <h3 className="border-b border-line px-4 py-2.5 text-[13px] font-semibold">{tr("Hàng cần chú ý")} <span className="font-mono text-ink-2">{stock.length}</span></h3>
        {stock.length ? (
          <ul className="divide-y divide-line/70">
            {stock.map((s) => (
              <li key={s.lotId} className="flex flex-wrap items-center gap-2 px-4 py-2.5 text-[13px]">
                <Badge tone={s.kind === "RECALL" || s.kind === "EXPIRED" ? "danger" : "warn"} dot={false}>{{ RECALL: tr("Có thông báo thu hồi"), EXPIRED: tr("Đã hết hạn"), EXPIRING: tr("Sắp hết hạn"), QUARANTINED: tr("Đang cách ly") }[s.kind]}</Badge>
                <span className="font-mono text-[12px]">{s.lotCode}</span>
                <span className="text-ink-2">{fmtNumber(s.held)} {s.unit}</span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title={tr("Không có hàng cần chú ý")} />
        )}
      </section>
    </div>
  );
}

// ---------------------------------------------------------------------------
const createSchema = z
  .object({
    chainId: z.string().min(1, { error: () => tr("Chọn chuỗi") }),
    carrierId: z.string().min(1, { error: () => tr("Chọn bên vận chuyển") }),
    receiverId: z.string().min(1, { error: () => tr("Chọn bên nhận") }),
    senderSiteId: z.string().min(1, { error: () => tr("Chọn cơ sở giao") }),
    carrierSiteId: z.string().min(1, { error: () => tr("Chọn cơ sở vận chuyển") }),
    receiverSiteId: z.string().min(1, { error: () => tr("Chọn cơ sở nhận") }),
    vehicleId: z.string().optional(),
    origin: z.string().trim().min(3, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 3 }) }).max(500),
    destination: z.string().trim().min(3, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 3 }) }).max(500),
    plannedPickupAt: z.string().min(1, { error: () => tr("Không được để trống") }),
    plannedDeliveryAt: z.string().optional(),
    note: z.string().max(1000).optional(),
    lines: z.array(z.object({ lotId: z.string().min(1, { error: () => tr("Chọn lô") }), quantity: dec() })).min(1).max(30),
  })
  .refine((v) => !v.plannedDeliveryAt || v.plannedDeliveryAt >= v.plannedPickupAt, { path: ["plannedDeliveryAt"], error: () => tr("Dự kiến giao không trước dự kiến lấy hàng") })
  .refine((v) => new Set(v.lines.map((l) => l.lotId)).size === v.lines.length, { path: ["lines"], error: () => tr("Không lặp lô trong cùng giao nhận") });

function CreateTransfer({ props }: { props: { open: boolean; onOpenChange: (o: boolean) => void } }) {
  const { user } = useSession();
  const now = useNow();
  const chains = useQuery({ queryKey: ["ws-chains"], queryFn: wapi.chains });
  const options = useQuery({ queryKey: ["dist-options"], queryFn: distApi.options });
  const partners = useQuery({ queryKey: ["ws-partners"], queryFn: wapi.partners });
  const stock = useQuery({ queryKey: ["dist-report"], queryFn: () => distApi.report() });
  const me = user?.organizationId ?? "";
  const partyOrgs = (partners.data ?? []).filter((p) => p.status === "ACTIVE").flatMap((p) => (p.inviterId === me ? p.invitee : p.inviter) ?? []);
  return (
    <CommandDialog
      {...props}
      title={tr("Tạo chặng giao nhận")}
      endpoint="POST /distribution/transfers"
      description={tr("Lượng giao được giữ chỗ tại cơ sở giao cho tới khi lấy hàng hoặc hủy. Bên vận chuyển phải là tổ chức vận chuyển; bên nhận là chế biến, phân phối hoặc bán lẻ; cả hai đã liên kết đối tác với bạn và cùng thuộc chuỗi.")}
      schema={createSchema}
      defaultValues={{ chainId: chains.data?.[0]?.id ?? "", carrierId: "", receiverId: "", senderSiteId: "", carrierSiteId: "", receiverSiteId: "", vehicleId: "", origin: "", destination: "", plannedPickupAt: isoToLocal(new Date(now + 3600_000).toISOString()), plannedDeliveryAt: "", note: "", lines: [{ lotId: "", quantity: "" }] }}
      submitLabel={tr("Tạo chặng")}
      invalidate={[["dist-transfers"], ["dist-report"], ["dist-tasks"]]}
      wide
      run={(v, cmd) =>
        distApi.create(
          {
            chainId: v.chainId,
            carrierId: v.carrierId,
            receiverId: v.receiverId,
            senderSiteId: v.senderSiteId,
            carrierSiteId: v.carrierSiteId,
            receiverSiteId: v.receiverSiteId,
            vehicleId: v.vehicleId || undefined,
            origin: v.origin,
            destination: v.destination,
            plannedPickupAt: localToIso(v.plannedPickupAt)!,
            plannedDeliveryAt: localToIso(v.plannedDeliveryAt),
            note: v.note || undefined,
            lines: v.lines.map((l) => ({ lotId: l.lotId, quantity: l.quantity, unit: stock.data?.lots.find((x) => x.lotId === l.lotId)?.unit ?? "kg" })),
          },
          cmd,
        )
      }
    >
      {(f) => {
        const c = f.control as unknown as Control<z.infer<typeof createSchema>>;
        return (
          <>
            <div className="grid gap-3 sm:grid-cols-2">
              <SelectField control={c} name="chainId" label={tr("Chuỗi cung ứng")} options={(chains.data ?? []).map((x) => ({ value: x.id, label: x.name }))} />
              <SelectField control={c} name="senderSiteId" label={tr("Cơ sở giao (của bạn)")} options={(options.data?.items ?? []).filter((s) => s.organizationId === me).map((s) => ({ value: s.id, label: s.name }))} />
              <SelectField control={c} name="carrierId" label={tr("Bên vận chuyển")} options={partyOrgs.filter((o) => o.type === "TRANSPORTER").map((o) => ({ value: o.id, label: o.name }))} />
              <PartySite control={c} party="carrierId" name="carrierSiteId" label={tr("Cơ sở vận chuyển")} sites={options.data?.items ?? []} />
              <SelectField control={c} name="receiverId" label={tr("Bên nhận")} options={partyOrgs.filter((o) => ["PROCESSOR", "DISTRIBUTOR", "RETAILER"].includes(o.type)).map((o) => ({ value: o.id, label: o.name }))} />
              <PartySite control={c} party="receiverId" name="receiverSiteId" label={tr("Cơ sở nhận")} sites={options.data?.items ?? []} />
              <PartyVehicle control={c} vehicles={options.data?.vehicles ?? []} />
              <TextField control={c} name="plannedPickupAt" label={tr("Dự kiến lấy hàng")} type="datetime-local" />
              <TextField control={c} name="origin" label={tr("Nơi lấy hàng")} />
              <TextField control={c} name="destination" label={tr("Nơi giao")} />
              <TextField control={c} name="plannedDeliveryAt" label={tr("Dự kiến giao (tùy chọn)")} type="datetime-local" />
            </div>
            <LinesField control={c} lots={(stock.data?.lots ?? []).filter((l) => !l.blocked)} />
            <TextAreaField control={c} name="note" label={tr("Ghi chú (tùy chọn)")} max={1000} />
          </>
        );
      }}
    </CommandDialog>
  );
}
type CreateValues = z.infer<typeof createSchema>;
function PartySite({ control, party, name, label, sites }: { control: Control<CreateValues>; party: "carrierId" | "receiverId"; name: "carrierSiteId" | "receiverSiteId"; label: string; sites: { id: string; organizationId: string; name: string }[] }) {
  const org = useWatch({ control, name: party });
  return <SelectField control={control} name={name} label={label} options={sites.filter((s) => s.organizationId === org).map((s) => ({ value: s.id, label: s.name }))} />;
}
function PartyVehicle({ control, vehicles }: { control: Control<CreateValues>; vehicles: { id: string; organizationId: string; registration: string; kind: string }[] }) {
  const org = useWatch({ control, name: "carrierId" });
  return <SelectField control={control} name="vehicleId" label={tr("Phương tiện (tùy chọn)")} options={vehicles.filter((v) => v.organizationId === org).map((v) => ({ value: v.id, label: `${v.registration} · ${v.kind}` }))} />;
}
function LinesField({ control, lots }: { control: Control<CreateValues>; lots: { lotId: string; lotCode: string; productName: string; available: string; unit: string; siteHoldings: { siteId: string; available: string }[] }[] }) {
  const { fields, append, remove } = useFieldArray({ control, name: "lines" });
  const site = useWatch({ control, name: "senderSiteId" });
  const pickable = lots.filter((l) => l.siteHoldings.some((s) => s.siteId === site && Number(s.available) > 0));
  return (
    <fieldset className="flex flex-col gap-2">
      <legend className="mb-1 text-[13px] font-medium">{tr("Dòng lô (tối đa 30)")}</legend>
      {!site && <p className="text-[12.5px] text-ink-2">{tr("Chọn cơ sở giao để thấy lô còn khả dụng tại cơ sở.")}</p>}
      {fields.map((f, i) => (
        <div key={f.id} className="grid grid-cols-[minmax(0,1fr)_120px_auto] items-end gap-2">
          <SelectField control={control} name={`lines.${i}.lotId`} label={tr("Lô {p0}", { p0: i + 1 })} options={pickable.map((l) => ({ value: l.lotId, label: `${l.lotCode} · ${l.productName} · ${tr("khả dụng")} ${fmtNumber(l.siteHoldings.find((s) => s.siteId === site)?.available)} ${l.unit}` }))} />
          <TextField control={control} name={`lines.${i}.quantity`} label={tr("Số lượng")} inputMode="decimal" />
          <Button type="button" variant="ghost" size="icon-sm" aria-label={tr("Bỏ dòng này")} onClick={() => remove(i)} disabled={fields.length === 1}><Trash2 /></Button>
        </div>
      ))}
      <Button type="button" size="xs" variant="outline" className="self-start" onClick={() => append({ lotId: "", quantity: "" })} disabled={fields.length >= 30}><Plus /> {tr("Thêm dòng lô")}</Button>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
function TransferSheet({ id, onClose,view }: { id: string | null; onClose: () => void;view:string }) {
  const { user } = useSession();
  const now = useNow();
  const q = useQuery({ queryKey: ["dist-transfer", id], queryFn: () => distApi.transfer(id!), enabled: !!id });


  const router=useRouter();
  const act = useDialog<TransferAction | { signReturn: string }>();
  const journalProps={...act.props,open:act.props.open||view==="journal",onOpenChange:(o:boolean)=>{act.props.onOpenChange(o);if(!o&&view==="journal")router.push(`/distribution/${id}`);}};
  const t = q.data;
  const invalidate = [["dist-transfer", id], ["dist-transfers"], ["dist-tasks"], ["dist-report"], ["ws-lots"]];
  const me = user?.organizationId ?? "";

  const nowLocal = isoToLocal(new Date(now).toISOString());


  return (
    <Sheet open={!!id} onOpenChange={(o) => !o && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-2xl">
        {!t ? (
          q.error ? <ErrorState error={q.error} onRetry={() => q.refetch()} /> : <LoadingRows rows={6} />
        ) : (
          <>
            <SheetHeader>
              <SheetTitle>{t.origin} → {t.destination}</SheetTitle>
              <SheetDescription>
                <span className="font-mono">{t.id.slice(0, 8)}</span> · v{t.version}{t.attestationEpoch ? ` · ${tr("lượt đồng thuận")} ${t.attestationEpoch + 1}` : ""}
              </SheetDescription>
            </SheetHeader>
            <div className="flex flex-col gap-5 px-4 pb-6">
              <div className="flex flex-wrap gap-1.5">
                <Badge tone={TRANSFER_TONE[t.status]}>{TRANSFER_STATUS_LABEL[t.status]}</Badge>
                <Badge tone="neutral" dot={false}>{t.senderId === me ? ROLE_LABEL.SENDER : t.carrierId === me ? ROLE_LABEL.CARRIER : ROLE_LABEL.RECEIVER}</Badge>
              </div>
              {t.allowedActions.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {t.allowedActions.map((a) => (
                    <Button key={a} size="sm" variant={["CANCEL", "RENEW_CONSENT"].includes(a) ? "outline" : "default"} onClick={() => act.open(a)}>{ACTION_LABEL[a]}</Button>
                  ))}
                </div>
              )}
              <dl className="grid grid-cols-[minmax(0,140px)_minmax(0,1fr)] gap-x-3 gap-y-1.5 text-[13px]">
                <dt className="text-ink-2">{ROLE_LABEL.SENDER}</dt>
                <dd>{t.senderName}</dd>
                <dt className="text-ink-2">{ROLE_LABEL.CARRIER}</dt>
                <dd>{t.carrierName}</dd>
                <dt className="text-ink-2">{ROLE_LABEL.RECEIVER}</dt>
                <dd>{t.receiverName}</dd>
                <dt className="text-ink-2">{tr("Dự kiến lấy / giao")}</dt>
                <dd className="font-mono text-[12px]">{fmtDateTime(t.plannedPickupAt)} / {fmtDateTime(t.plannedDeliveryAt)}</dd>
                {t.note && (
                  <>
                    <dt className="text-ink-2">{tr("Ghi chú")}</dt>
                    <dd>{t.note}</dd>
                  </>
                )}
              </dl>
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Dòng lô")}</h3>
                <ul className="divide-y divide-line/70 rounded-md border border-line">
                  {t.lines.map((l) => {
                    const r = t.receipt?.lines.find((x) => x.lotId === l.lotId);
                    return (
                      <li key={l.id} className="flex flex-wrap items-center gap-2 px-3 py-2 text-[13px]">
                        <span className="font-mono text-[12px]">{l.lotCode}</span>
                        <span className="text-ink-2">{l.productName}</span>
                        <span className="ml-auto font-mono text-[12px]">{fmtNumber(l.quantity)} {l.unit}</span>
                        {r && <span className="w-full text-[12px] text-ink-2">{tr("Thực nhận {p0} · từ chối {p1} · cách ly {p2} · thiếu {p3}", { p0: fmtNumber(r.received), p1: fmtNumber(r.rejected), p2: fmtNumber(r.quarantined), p3: fmtNumber(r.missing) })}</span>}
                      </li>
                    );
                  })}
                </ul>
              </section>
              <section className="flex flex-col gap-2">
                <h3 className="text-[13px] font-semibold">{tr("Chữ ký")}</h3>
                <ul className="flex flex-col gap-1.5">
                  {(["CONSENT", "PICKUP", "DELIVERY"] as const).map((p) => {
                    const signed = t.attestations.filter((a) => a.phase === p && a.epoch === t.attestationEpoch);
                    const need = p === "CONSENT" ? 3 : 2;
                    return (
                      <li key={p} className="flex flex-wrap items-center gap-2 text-[13px]">
                        <Badge tone={signed.length >= need ? "ok" : signed.length ? "warn" : "neutral"} dot>{signed.length}/{need}</Badge>
                        <span>{PHASE_LABEL[p]}</span>
                        <span className="text-[12px] text-ink-2">{signed.map((a) => (a.organizationId === t.senderId ? t.senderName : a.organizationId === t.carrierId ? t.carrierName : t.receiverName)).join(", ")}</span>
                      </li>
                    );
                  })}
                </ul>
              </section>
              {t.observations.length > 0 && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{tr("Nhật ký vận chuyển")}</h3>
                  <ol className="flex flex-col gap-1 border-l-2 border-line pl-3 text-[13px]">
                    {t.observations.map((o) => (
                      <li key={o.id}>
                        <span className="font-mono text-[11.5px] text-ink-2">{fmtDateTime(o.eventTime)}</span> {o.note}{o.temperature ? ` · ${o.temperature} °C` : ""}
                      </li>
                    ))}
                  </ol>
                </section>
              )}
              {(t.remainders.length > 0 || t.returns.length > 0) && (
                <section className="flex flex-col gap-2">
                  <h3 className="text-[13px] font-semibold">{tr("Phần còn lại & trả hàng")}</h3>
                  {t.remainders.map((r) => (
                    <p key={r.lotId} className="text-[13px]">{t.lines.find((l) => l.lotId === r.lotId)?.lotCode}: {tr("chờ đối soát")} {fmtNumber(r.quantity)}</p>
                  ))}
                  {t.returns.map((r) => (
                    <div key={r.id} className="flex flex-wrap items-center gap-2 rounded-md border border-line px-3 py-2 text-[13px]">
                      <Badge tone={r.status === "RETURNED" ? "ok" : "info"}>{r.status === "RETURNED" ? tr("Đã trả") : tr("Chờ ký trả ({p0}/2)", { p0: r.signedOrganizations.length })}</Badge>
                      <span className="min-w-0 flex-1">{r.reason}</span>
                      {r.allowedActions.includes("SIGN_RETURN") && <Button size="xs" onClick={() => act.open({ signReturn: r.id })}>{ACTION_LABEL.SIGN_RETURN}</Button>}
                    </div>
                  ))}
                </section>
              )}
            </div>

            {(act.target==="CONSENT"||act.target==="PICKUP"||act.target==="DELIVERY")&&<DistributionSignature transfer={t} phase={act.target} props={act.props}/>}
            {act.target === "ACTUAL_RECEIPT" && <ReceiptDialog t={t} props={act.props} invalidate={invalidate} />}
            {act.target === "CANCEL" && (
              <CommandDialog {...act.props} title={tr("Hủy chặng giao nhận")} endpoint="POST /distribution/transfers/:id/cancel" description={tr("Chỉ bên giao hủy được trước khi lấy hàng; lượng giữ chỗ được trả lại cơ sở giao.")} schema={z.object({})} defaultValues={{}} version={t.version} tone="danger" submitLabel={tr("Hủy chặng")} invalidate={invalidate} run={(_, cmd) => distApi.cancel(t.id, { version: t.version }, cmd)}>
                {() => null}
              </CommandDialog>
            )}
            {act.target === "RENEW_CONSENT" && (
              <CommandDialog {...act.props} title={tr("Yêu cầu đồng thuận lại")} endpoint="POST /distribution/transfers/:id/consent-renewal" description={tr("Mở lượt đồng thuận mới: cả ba bên phải ký đồng thuận lại trước bước bàn giao kế tiếp.")} schema={z.object({ reason: reason10 })} defaultValues={{ reason: "" }} version={t.version} submitLabel={tr("Gửi yêu cầu")} invalidate={invalidate} run={(v, cmd) => distApi.renewConsent(t.id, { version: t.version, reason: v.reason }, cmd)}>
                {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />}
              </CommandDialog>
            )}
            {(act.target === "OBSERVE" || view==="journal") && t.allowedActions.includes("OBSERVE") && (
              <CommandDialog {...journalProps} title={tr("Ghi nhật ký vận chuyển")} endpoint="POST /distribution/transfers/:id/journal" description={tr("Nhiệt độ ghi tay, không phải dữ liệu thiết bị IoT.")} schema={z.object({ eventTime: z.string().min(1), note: z.string().trim().min(3, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 3 }) }).max(1000), temperature: z.union([z.literal(""), z.string().regex(/^-?\d{1,2}(\.\d{1,2})?$/, { error: () => tr("Ví dụ: 4.5 hoặc -18") })]).optional() })} defaultValues={{ eventTime: nowLocal, note: "", temperature: "" }} submitLabel={tr("Ghi nhật ký")} invalidate={invalidate} run={(v, cmd) => distApi.observe(t.id, { eventTime: localToIso(v.eventTime)!, note: v.note, temperature: v.temperature || undefined }, cmd)}>
                {(f) => (
                  <>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <TextField control={f.control} name="eventTime" label={tr("Thời điểm")} type="datetime-local" />
                      <TextField control={f.control} name="temperature" label={tr("Nhiệt độ (°C, tùy chọn)")} />
                    </div>
                    <TextAreaField control={f.control} name="note" label={tr("Nội dung")} max={1000} />
                  </>
                )}
              </CommandDialog>
            )}
            {act.target === "RETURN" && (
              <CommandDialog
                {...act.props}
                title={tr("Đề nghị trả hàng")}
                endpoint="POST /distribution/transfers/:id/returns"
                description={tr("Trả lại bên giao phần chưa được nhận; cần chữ ký của bên vận chuyển và bên giao.")}
                schema={z.object({ reason: reason10, lines: z.array(z.object({ lotId: z.string(), quantity: dec() })) })}
                defaultValues={{ reason: "", lines: t.remainders.map((r) => ({ lotId: r.lotId, quantity: r.quantity })) }}
                version={t.version}
                submitLabel={tr("Gửi đề nghị")}
                invalidate={invalidate}
                run={(v, cmd) => distApi.proposeReturn(t.id, { version: t.version, reason: v.reason, lines: v.lines.filter((l) => Number(l.quantity) > 0).map((l) => ({ ...l, unit: t.lines.find((x) => x.lotId === l.lotId)?.unit ?? "kg" })) }, cmd)}
              >
                {(f) => (
                  <>
                    {t.remainders.map((r, i) => (
                      <TextField key={r.lotId} control={f.control} name={`lines.${i}.quantity`} label={tr("Trả {p0} (tối đa {p1})", { p0: t.lines.find((l) => l.lotId === r.lotId)?.lotCode ?? "", p1: fmtNumber(r.quantity) })} inputMode="decimal" />
                    ))}
                    <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={1000} />
                  </>
                )}
              </CommandDialog>
            )}
            {act.target&&typeof act.target==="object"&&<DistributionSignature transfer={t} phase="RETURN" returnId={act.target.signReturn} props={act.props}/>}
          </>
        )}
      </SheetContent>
    </Sheet>
  );
}

function ReceiptDialog({ t, props, invalidate }: { t: TransferDetail; props: { open: boolean; onOpenChange: (o: boolean) => void }; invalidate: unknown[][] }) {
  const schema = z
    .object({ reason: reason10, lines: z.array(z.object({ lotId: z.string(), received: dec(), rejected: dec(), quarantined: dec() })) })
    .superRefine((v, ctx) =>
      v.lines.forEach((l, i) => {
        const max = Number(t.lines.find((x) => x.lotId === l.lotId)?.quantity ?? 0);
        if (Number(l.received) + Number(l.rejected) > max) ctx.addIssue({ code: "custom", path: ["lines", i, "received"], message: tr("Thực nhận + từ chối vượt lượng giao") });
        if (Number(l.quarantined) > Number(l.received)) ctx.addIssue({ code: "custom", path: ["lines", i, "quarantined"], message: tr("Cách ly vượt thực nhận") });
      }),
    );
  return (
    <CommandDialog
      {...props}
      title={tr("Biên bản thực nhận")}
      endpoint="POST /distribution/transfers/:id/receipt"
      description={tr("Lập một lần trước khi ký giao hàng. Phần thiếu (giao − nhận − từ chối) và phần từ chối chờ bên vận chuyển đối soát hoặc trả lại.")}
      schema={schema}
      defaultValues={{ reason: "", lines: t.lines.map((l) => ({ lotId: l.lotId, received: l.quantity, rejected: "0", quarantined: "0" })) }}
      version={t.version}
      wide
      submitLabel={tr("Lập biên bản")}
      invalidate={invalidate}
      run={(v, cmd) => distApi.receipt(t.id, { version: t.version, reason: v.reason, lines: v.lines }, cmd)}
    >
      {(f) => (
        <>
          {t.lines.map((l, i) => (
            <fieldset key={l.id} className="grid gap-2 rounded-md border border-line px-3 py-2 sm:grid-cols-3">
              <legend className="px-1 text-[12.5px] font-medium">{l.lotCode} · {tr("giao")} {fmtNumber(l.quantity)} {l.unit}</legend>
              <TextField control={f.control} name={`lines.${i}.received`} label={tr("Thực nhận")} inputMode="decimal" />
              <TextField control={f.control} name={`lines.${i}.rejected`} label={tr("Từ chối")} inputMode="decimal" />
              <TextField control={f.control} name={`lines.${i}.quarantined`} label={tr("Cách ly (trong thực nhận)")} inputMode="decimal" />
            </fieldset>
          ))}
          <TextAreaField control={f.control} name="reason" label={tr("Ghi chú biên bản")} max={1000} />
        </>
      )}
    </CommandDialog>
  );
}
