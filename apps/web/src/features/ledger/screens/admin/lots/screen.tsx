"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useLedgerSearchParams as useSearchParams } from "@/components/ledger/route-screen";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { ArrowDownRight, ArrowUpLeft, Lock, Search, Unlock } from "lucide-react";
import { api } from "@/lib/ledger/operations-api";
import type { LotSearchItem } from "@/lib/ledger/operations-types";
import { useLedgerSession } from "@/lib/ledger/platform-access";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { reason } from "@/lib/ledger/platform-schemas";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ledger/ui/tabs";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { TextAreaField } from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader, Section } from "@/components/ledger/kit/page";
import { Badge, Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const blockSchema = z.object({ reason: reason(), publicMessage: z.string().trim().min(10, { error: () => tr("Tối thiểu 10 ký tự") }).max(500, { error: () => tr("Tối đa 500 ký tự") }) });
const unblockSchema = z.object({ reason: reason() });

function LotsPage() {
  return (
    <Guard permission="lots.read">
      <Suspense>
        <Lots />
      </Suspense>
    </Guard>
  );
}

function Lots() {
  const { can } = useLedgerSession();
  const params = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  // URL là nguồn sự thật của từ khóa (Ctrl K cũng điều hướng tới ?q=).
  const q = params.get("q") ?? "";
  const [text, setText] = useState(q);
  const [seenQ, setSeenQ] = useState(q);
  const [selectedId, setSelected] = useState<string | null>(null);
  if (seenQ !== q) {
    setSeenQ(q);
    setText(q);
    setSelected(null);
  }
  const res = useQuery({ queryKey: ["lots", q], queryFn: () => api.trace.lots(q), enabled: q.length > 0 });
  const current = res.data?.find((l) => l.lotId === selectedId) ?? res.data?.[0];

  return (
    <>
      <PageHeader title={tr("Tra cứu lô & QR")} description={tr("Tìm theo mã lô, tên sản phẩm hoặc mã QR (trace token). Nền tảng chỉ đọc lô; thao tác duy nhất là khóa/mở trang QR công khai.")} />
      <PageBody wide>
        <Tabs defaultValue="search" className="gap-4">
          <TabsList>
            <TabsTrigger value="search">{tr("Tra cứu lô")}</TabsTrigger>
            {can("qr.read") && <TabsTrigger value="qr">{tr("Tổng quan QR")}</TabsTrigger>}
          </TabsList>
          <TabsContent value="search" className="flex flex-col gap-4">
            <form
              role="search"
              className="flex max-w-2xl gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                const v = text.trim();
                router.replace(v ? `${pathname}?q=${encodeURIComponent(v)}` : pathname);
              }}
            >
              <Input aria-label={tr("Mã lô, sản phẩm hoặc mã QR")} placeholder={tr("VD: TG-2610-001, Xoài, qr_…")} value={text} onChange={(e) => setText(e.target.value)} className="h-9 bg-card" />
              <Button type="submit">
                <Search /> {tr("Tra cứu")}
              </Button>
            </form>
            {!q ? (
              <div className="rounded-md border border-dashed border-line-strong bg-card">
                <EmptyState title={tr("Nhập từ khóa để tra cứu")}>{tr("Backend yêu cầu tham số q; không có danh sách lô toàn nền tảng. Thử “TG-2610”, “Xoài” hoặc “MK”.")}</EmptyState>
              </div>
            ) : res.error ? (
              <ErrorState error={res.error} onRetry={() => res.refetch()} />
            ) : !res.data ? (
              <LoadingRows />
            ) : !res.data.length ? (
              <div className="rounded-md border border-line bg-card">
                <EmptyState title={tr("Không có lô khớp “{p0}”", { p0: q })} />
              </div>
            ) : (
              <div className="grid items-start gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)]">
                <ul className="divide-y divide-line/70 overflow-hidden rounded-md border border-line bg-card">
                  {res.data.map((l) => (
                    <li key={l.lotId}>
                      <button type="button" onClick={() => setSelected(l.lotId)} className={cn("grid w-full grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 px-4 py-2.5 text-left text-[13px] hover:bg-row-alt", current?.lotId === l.lotId && "bg-brand-weak shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-weak")}>
                        <span className="truncate">
                          <span className="font-mono font-medium">{l.lotCode}</span> · {l.productName}
                        </span>
                        <span className="flex gap-1">
                          {l.qrBlock && <Badge tone="danger" dot={false}>{tr("QR khóa")}</Badge>}
                          <Status group="lot" value={l.currentState} />
                        </span>
                        <span className="truncate text-[12px] text-ink-2">
                          {l.organizationName} · {l.originType === "TRANSFORMATION" ? tr("chế biến {p0}", { p0: l.runCode }) : tr("thu hoạch")}
                        </span>
                        <span className="font-mono text-[12px] text-ink-2">{l.availableQuantity} {l.unit}</span>
                      </button>
                    </li>
                  ))}
                </ul>
                {current && <LotDetail lot={current} />}
              </div>
            )}
          </TabsContent>
          <TabsContent value="qr">
            <QrOverview />
          </TabsContent>
        </Tabs>
      </PageBody>
    </>
  );
}

function LotDetail({ lot }: { lot: LotSearchItem }) {
  const { can } = useLedgerSession();
  const lineage = useQuery({ queryKey: ["lineage", lot.lotId], queryFn: () => api.trace.lineage(lot.lotId) });
  const block = useDialog();
  const unblock = useDialog();
  const invalidate = [["lots"], ["qr"], ["inbox"]];
  return (
    <section aria-label={tr("Lô {p0}", { p0: lot.lotCode })} className="flex min-w-0 flex-col gap-4">
      <div className="flex flex-col gap-3 rounded-md border border-line bg-card p-5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-col">
            <h2 className="font-mono text-[18px] font-semibold">{lot.lotCode}</h2>
            <span className="text-[13px] text-ink-2">{lot.productName} · {lot.organizationName}</span>
          </div>
          <div className="flex gap-2">
            <Button size="sm" variant="outline" asChild>
              <Link href={`/admin/recall?lotId=${lot.lotId}`}>{tr("Diễn tập thu hồi")}</Link>
            </Button>
            {can("qr.write") &&
              (lot.qrBlock ? (
                <Button size="sm" variant="outline" onClick={() => unblock.open(true)}>
                  <Unlock /> {tr("Mở khóa QR")}
                </Button>
              ) : (
                <Button size="sm" variant="destructive" onClick={() => block.open(true)}>
                  <Lock /> {tr("Khóa QR")}
                </Button>
              ))}
          </div>
        </div>
        {lot.qrBlock && (
          <Callout tone="danger" title={tr("QR đang bị khóa từ {p0}", { p0: fmtDateTime(lot.qrBlock.blockedAt) })}>
            {tr("Thông điệp công khai: “")}{lot.qrBlock.publicMessage}”
            <span className="block text-ink-2">{tr("Lý do nội bộ:")} {lot.qrBlock.reason}</span>
          </Callout>
        )}
        <dl className="grid grid-cols-2 gap-x-6 gap-y-2.5 text-[13px] sm:grid-cols-3">
          <div><dt className="text-[12px] text-ink-2">{tr("Trạng thái")}</dt><dd><Status group="lot" value={lot.currentState} /></dd></div>
          <div><dt className="text-[12px] text-ink-2">{tr("Khởi tạo / còn lại")}</dt><dd className="font-mono text-[12px]">{lot.initialQuantity} / {`${lot.availableQuantity} ${lot.unit}`}</dd></div>
          <div><dt className="text-[12px] text-ink-2">{tr("Hạn dùng")}</dt><dd>{fmtDate(lot.expiryDate)}</dd></div>
          <div><dt className="text-[12px] text-ink-2">{tr("Nguồn gốc")}</dt><dd>{lot.originType === "TRANSFORMATION" ? tr("Chế biến ({p0})", { p0: lot.runCode }) : tr("Thu hoạch")}</dd></div>
          <div><dt className="text-[12px] text-ink-2">{tr("Lượt quét QR")}</dt><dd className="font-mono">{fmtNumber(lot.scans)}</dd></div>
          <div><dt className="text-[12px] text-ink-2">Trace token</dt><dd className="truncate font-mono text-[12px]">{lot.traceToken ?? "—"}</dd></div>
        </dl>
      </div>
      <Section title={tr("Đang giữ hàng")} aside={tr("Phân bổ hiện tại theo tổ chức")}>
        <ul className="divide-y divide-line/70">
          {lot.holders.map((h) => (
            <li key={h.organizationId} className="flex items-center justify-between px-4 py-2 text-[13px] sm:px-5">
              <Link className="text-brand hover:underline" href={`/admin/directory/${h.organizationId}`}>{h.organizationName}</Link>
              <span className="font-mono text-[12px]">{`${h.quantity} ${lot.unit}`}</span>
            </li>
          ))}
          {!lot.holders.length && <li className="px-5 py-3 text-[13px] text-ink-2">{tr("Không còn tồn.")}</li>}
        </ul>
      </Section>
      <Section title={tr("Nguồn gốc & thành phẩm")} aside={tr("Lô nguyên liệu (lên) và lô chế biến từ lô này (xuống), tối đa 6 cấp")}>
        {lineage.error ? (
          <ErrorState error={lineage.error} compact />
        ) : !lineage.data ? (
          <LoadingRows rows={3} />
        ) : !lineage.data.upstream.length && !lineage.data.downstream.length ? (
          <p className="px-5 py-3 text-[13px] text-ink-2">{tr("Lô độc lập: không có lô nguyên liệu hay thành phẩm.")}</p>
        ) : (
          <ul className="divide-y divide-line/70">
            {[...lineage.data.upstream.map((n) => ({ n, dir: "up" as const })), ...lineage.data.downstream.map((n) => ({ n, dir: "down" as const }))].map(({ n, dir }) => (
              <li key={`${dir}-${n.lotId}`} className="flex items-center gap-3 px-4 py-2 text-[13px] sm:px-5" style={{ paddingLeft: 20 + (n.level - 1) * 16 }}>
                {dir === "up" ? <ArrowUpLeft className="size-3.5 text-ink-2" aria-label={tr("Nguyên liệu")} /> : <ArrowDownRight className="size-3.5 text-brand" aria-label={tr("Thành phẩm")} />}
                <span className="font-mono">{n.lotCode}</span>
                <span className="min-w-0 flex-1 truncate text-ink-2">{n.productName} · {n.organizationName}</span>
                <Status group="lot" value={n.currentState} />
              </li>
            ))}
          </ul>
        )}
      </Section>

      <CommandDialog
        {...block.props}
        title={tr("Khóa QR lô {p0}", { p0: lot.lotCode })}
        endpoint="POST /platform-admin/qr-blocks"
        description={tr("Trang QR vẫn mở và hiện cảnh báo công khai; không in thêm tem cho lô bị khóa. Khóa QR không thay đổi lô hay thu hồi. Khi ENFORCED phải qua đề xuất QR_BLOCK.")}
        schema={blockSchema}
        defaultValues={{ reason: "", publicMessage: "" }}
        tone="danger"
        submitLabel={tr("Khóa QR")}
        invalidate={invalidate}
        run={(v, cmd) => api.trace.block({ lotId: lot.lotId, ...v }, cmd)}
      >
        {(f) => (
          <>
            <TextAreaField control={f.control} name="publicMessage" label={tr("Thông điệp hiển thị trên trang QR công khai")} max={500} hint={tr("Người tiêu dùng sẽ đọc nội dung này")} />
            <TextAreaField control={f.control} name="reason" label={tr("Lý do nội bộ")} hint={tr("Ghi nhật ký kiểm toán, không công khai")} />
          </>
        )}
      </CommandDialog>
      {lot.qrBlock && (
        <CommandDialog {...unblock.props} title={tr("Mở khóa QR lô {p0}", { p0: lot.lotCode })} endpoint="POST /platform-admin/qr-blocks/:id/unblock" description={tr("Mở khóa là thao tác một người, cần lý do.")} schema={unblockSchema} defaultValues={{ reason: "" }} version={lot.qrBlock.version} submitLabel={tr("Mở khóa")} invalidate={invalidate} run={(v, cmd) => api.trace.unblock(lot.qrBlock!.id, { ...v, version: lot.qrBlock!.version }, cmd)}>
          {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do mở khóa")} />}
        </CommandDialog>
      )}
    </section>
  );
}

export function QrOverview() {
  const {can}=useLedgerSession();const release=useDialog<import("@/lib/ledger/operations-types").QrBlock>();
  const q = useQuery({ queryKey: ["qr"], queryFn: api.trace.qr });
  if (q.error) return <ErrorState error={q.error} onRetry={() => q.refetch()} />;
  if (!q.data) return <LoadingRows />;
  const d = q.data;
  const max = Math.max(...d.scansByDay.map((s) => s.scans), 1);
  const total30 = d.scansByDay.reduce((a, s) => a + s.scans, 0);
  return (
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">
      <div className="flex flex-col gap-5">
        <Section title={tr("Lượt quét 30 ngày")} aside={tr("{p0} lượt · {p1} mã QR", { p0: fmtNumber(total30), p1: fmtNumber(d.totalQr) })}>
          <div className="flex h-32 items-end gap-[3px] px-5 pt-4 pb-2" role="img" aria-label={tr("Biểu đồ lượt quét 30 ngày, cao nhất {p0} lượt một ngày", { p0: max })}>
            {d.scansByDay.map((s) => (
              <div key={s.day} title={tr("{p0}: {p1} lượt", { p0: fmtDate(s.day), p1: s.scans })} className="flex-1 rounded-t-[2px] bg-brand/80 hover:bg-brand" style={{ height: `${(s.scans / max) * 100}%` }} />
            ))}
          </div>
          <div className="flex justify-between px-5 pb-3 font-mono text-[11px] text-ink-2">
            <span>{fmtDate(d.scansByDay[0]?.day)}</span>
            <span>{fmtDate(d.scansByDay.at(-1)?.day)}</span>
          </div>
        </Section>
        <Section title={tr("Lịch sử khóa QR")}>
          {d.blocked.length ? (
            <ul className="divide-y divide-line/70">
              {d.blocked.map((b) => (
                <li key={b.id} className="flex flex-col gap-1 px-4 py-2.5 text-[13px] sm:px-5">
                  <span className="flex items-center justify-between gap-2">
                    <span><span className="font-mono">{b.lotCode}</span> · {b.productName}</span>
                    {b.unblockedAt ? <Badge tone="neutral">{tr("Đã mở")} {fmtDate(b.unblockedAt)}</Badge> : <Badge tone="danger">{tr("Đang khóa")}</Badge>}
                  </span>
                  <span className="text-[12px] text-ink-2">{b.publicMessage} · {fmtDateTime(b.blockedAt)}</span>
{!b.unblockedAt&&can("qr.write")&&<Button size="xs" variant="outline" onClick={()=>release.open(b)}>{tr("Mở khóa QR")}</Button>}
<span className="text-[12px] text-ink-2">{b.reason}{b.unblockReason && tr(" · mở: {p0}", { p0: b.unblockReason })}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title={tr("Chưa khóa QR nào")} />
          )}
        </Section>
      </div>
<CommandDialog {...release.props} title={tr("Mở khóa QR")} endpoint="POST /platform-admin/qr-blocks/:id/unblock" schema={unblockSchema} defaultValues={{reason:""}} version={release.target?.version} submitLabel={tr("Mở khóa")} invalidate={[["qr"],["lots"]]} run={(v,cmd)=>api.trace.unblock(release.target!.id,{...v,version:release.target!.version},cmd)}>{f=><TextAreaField control={f.control} name="reason" label={tr("Lý do mở khóa")}/>}</CommandDialog>
    </div>
  );
}

import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-lots"><LotsPage/></LedgerRouteScreen>;}
