"use client";

import { useEffect, useState } from "react";
import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import { publicTraceUrl } from "@/lib/site-origins";
import QRCode from "qrcode";
import { z } from "zod";
import { Printer } from "lucide-react";
import { distApi } from "@/lib/ledger/dist-api";
import type { StockLot } from "@/lib/ledger/dist-types";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ledger/ui/dialog";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { SelectField, TextAreaField, TextField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";

type Printed = Awaited<ReturnType<typeof distApi.printLabels>>;
const traceUrl = (token: string) => publicTraceUrl(token, typeof window === "undefined" ? "" : window.location.origin);

export default function QrLabelsPage() {
  const { can } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["dist-qr"], queryFn: distApi.qr, enabled: can("qr.manage") });
  const print = useDialog<StockLot>();
  const history = useDialog<StockLot>();
  const [printed, setPrinted] = useState<Printed | null>(null);
  if (!can("qr.manage")) return <ErrorState error={new Error(tr("Bạn chưa có quyền qr.manage"))} />;
  const cols: Column<StockLot>[] = [
    { key: "lot", header: tr("Lô"), cell: (l) => <span className="flex flex-col"><span className="font-mono text-[12px] font-medium">{l.lotCode}</span><span className="text-[12px] text-ink-2">{l.productName}</span></span> },
    { key: "held", header: tr("Đang giữ"), cell: (l) => <span className="font-mono text-[12.5px]">{fmtNumber(l.held)} {l.unit}</span> },
    { key: "exp", header: tr("Hạn dùng"), hideBelow: "md", cell: (l) => <span className="font-mono text-[12px]">{l.expiryDate ? fmtDate(l.expiryDate) : "—"}</span> },
    { key: "flags", header: tr("Tình trạng"), cell: (l) => (l.blocked || l.notices.some((n) => n.kind === "RECALL") ? <Badge tone="danger" dot={false}>{tr("Không phát hành tem")}</Badge> : l.traceToken ? <Badge tone="ok" dot={false}>{tr("Có mã truy xuất")}</Badge> : <Badge tone="neutral" dot={false}>{tr("Chưa có mã")}</Badge>) },
    { key: "act", header: <span className="sr-only">{tr("Thao tác")}</span>, cell: (l) => (
      <span className="flex flex-wrap gap-1">
        <Button size="xs" onClick={() => print.open(l)} disabled={!l.traceToken||l.blocked||l.notices.some(n=>n.kind==="RECALL")}><Printer /> {tr("In tem")}</Button>
        <Button size="xs" variant="outline" onClick={() => history.open(l)}>{tr("Lịch sử in")}</Button>
      </span>
    ) },
  ];
  return (
    <>
      <PageHeader title={tr("Tem QR")} description={tr("In tem QR cho lô doanh nghiệp đang giữ hoặc đã sản xuất. Mỗi lần in được ghi nhận; in lại phải ghi lý do. Lô bị thu hồi, hết hạn, bị chặn hoặc mã QR bị nền tảng khóa không được phát hành tem mới. Tổ chức trả phí bị giới hạn theo hạn mức tem của gói.")} />
      <PageBody>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable rows={q.data?.lots} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={cols} rowKey={(l) => l.lotId} empty={<EmptyState title={tr("Không có lô để in tem")} />} />
        </div>
      </PageBody>
      {print.target && <PrintDialog lot={print.target} props={print.props} onPrinted={setPrinted} />}
      {history.target && <HistoryDialog lot={history.target} onClose={() => history.props.onOpenChange(false)} />}
      {printed && <LabelSheet printed={printed} onClose={() => setPrinted(null)} />}
    </>
  );
}

function PrintDialog({ lot, props, onPrinted }: { lot: StockLot; props: { open: boolean; onOpenChange: (o: boolean) => void }; onPrinted: (p: Printed) => void }) {
  const h = useQuery({ queryKey: ["dist-qr-history", lot.lotId], queryFn: () => distApi.labelHistory(lot.lotId) });
  if (!h.data) return null;
  const reprint = h.data.length > 0;
  const schema = z.object({
    template: z.enum(["COMPACT", "STANDARD"]),
    copies: z.string().regex(/^\d{1,3}$/, { error: () => tr("Số nguyên 1–500") }).refine((v) => Number(v) >= 1 && Number(v) <= 500, { error: () => tr("Số nguyên 1–500") }),
    reason: reprint ? z.string().trim().min(10, { error: () => tr("Tối thiểu {p0} ký tự", { p0: 10 }) }).max(1000) : z.string().optional(),
  });
  return (
    <CommandDialog
      {...props}
      title={reprint ? tr("In lại tem {p0}", { p0: lot.lotCode }) : tr("In tem {p0}", { p0: lot.lotCode })}
      endpoint="POST /distribution/qr/prints"
      description={reprint ? tr("Lô đã được in {p0} lần; ghi lý do in lại (ví dụ tem hỏng, thiếu tem).", { p0: h.data.length }) : tr("Lần in đầu tiên của doanh nghiệp cho lô này.")}
      schema={schema}
      defaultValues={{ template: "STANDARD", copies: "10", reason: "" }}
      submitLabel={tr("Phát hành tem")}
      invalidate={[["dist-qr-history", lot.lotId]]}
      onDone={(r) => onPrinted(r as Printed)}
      run={(v, cmd) => distApi.printLabels({ lotId: lot.lotId, template: v.template, copies: Number(v.copies), reason: v.reason || undefined }, cmd)}
    >
      {(f) => (
        <>
          <div className="grid gap-3 sm:grid-cols-2">
            <SelectField control={f.control} name="template" label={tr("Mẫu tem")} options={[{ value: "STANDARD", label: tr("Tiêu chuẩn (có thông tin lô)") }, { value: "COMPACT", label: tr("Thu gọn (chỉ mã QR)") }]} />
            <TextField control={f.control} name="copies" label={tr("Số tem")} inputMode="numeric" />
          </div>
          {reprint && <TextAreaField control={f.control} name="reason" label={tr("Lý do in lại")} max={1000} />}
        </>
      )}
    </CommandDialog>
  );
}

function HistoryDialog({ lot, onClose }: { lot: StockLot; onClose: () => void }) {
  const h = useQuery({ queryKey: ["dist-qr-history", lot.lotId], queryFn: () => distApi.labelHistory(lot.lotId) });
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{tr("Lịch sử in tem {p0}", { p0: lot.lotCode })}</DialogTitle>
          <DialogDescription>{tr("Chỉ gồm các lần in của doanh nghiệp bạn.")}</DialogDescription>
        </DialogHeader>
        {!h.data ? (
          <LoadingRows rows={3} />
        ) : h.data.length ? (
          <ol className="flex flex-col divide-y divide-line/70 text-[13px]">
            {h.data.map((p) => (
              <li key={p.id} className="flex flex-wrap items-center gap-2 py-2">
                <Badge tone={p.reprint ? "warn" : "ok"} dot={false}>{p.reprint ? tr("In lại") : tr("In lần đầu")}</Badge>
                <span>{tr("{p0} tem · mẫu {p1}", { p0: p.copies, p1: p.template === "STANDARD" ? tr("tiêu chuẩn") : tr("thu gọn") })}</span>
                <span className="text-ink-2">{p.actorName}</span>
                <span className="ml-auto font-mono text-[12px] text-ink-2">{fmtDateTime(p.createdAt)}</span>
                {p.reason && <span className="w-full text-[12.5px] text-ink-2">{p.reason}</span>}
              </li>
            ))}
          </ol>
        ) : (
          <EmptyState title={tr("Chưa in tem lần nào")} />
        )}
      </DialogContent>
    </Dialog>
  );
}

/** Bản xem trước để in: mã QR dẫn tới trang truy xuất công khai của lô. */
function LabelSheet({ printed, onClose }: { printed: Printed; onClose: () => void }) {
  const [svg, setSvg] = useState("");
  const url = traceUrl(printed.traceToken);
  useEffect(() => {
    QRCode.toString(url, { type: "svg", margin: 1, errorCorrectionLevel: "M" }).then(setSvg);
  }, [url]);
  const shown = printed.copies;
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-3xl">
        <DialogHeader>
          <DialogTitle>{tr("Tem đã phát hành · lần in {p0}", { p0: printed.sequence })}</DialogTitle>
          <DialogDescription>{tr("{p0} tem, mẫu {p1}. Mã QR mở trang truy xuất công khai của lô.", { p0: printed.copies, p1: printed.template === "STANDARD" ? tr("tiêu chuẩn") : tr("thu gọn") })}</DialogDescription>
        </DialogHeader>
        {printed.reprint && <Callout tone="warn">{tr("Đây là lần in lại; lý do đã được ghi vào lịch sử in.")}</Callout>}
        <div id="label-print" className="grid max-h-[55vh] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
          {Array.from({ length: shown }, (_, i) => (
            <figure key={i} className="flex flex-col items-center gap-1 rounded-sm border border-line bg-white p-2 text-center text-black" aria-label={tr("Tem {p0}", { p0: i + 1 })}>
              {/* SVG do thư viện qrcode sinh từ chuỗi URL, không chứa dữ liệu người dùng nhập */}
              <div className="size-24 [&>svg]:size-full" dangerouslySetInnerHTML={{ __html: svg }} />
              {printed.template === "STANDARD" && (
                <figcaption className="flex flex-col text-[10px] leading-tight">
                  <span className="font-semibold">{printed.productName}</span>
                  <span className="font-mono">{printed.lotCode}</span>
                  <span>{printed.producerName}</span>
                  <span>{tr("Thu hoạch")} {fmtDate(printed.harvestTime)}{printed.expiryDate ? ` · HSD ${fmtDate(printed.expiryDate)}` : ""}</span>
                </figcaption>
              )}
            </figure>
          ))}
        </div>
        {printed.copies > shown && <p className="text-[12px] text-ink-2">{tr("Xem trước {p0}/{p1} tem; lệnh in của trình duyệt in toàn bộ khung này.", { p0: shown, p1: printed.copies })}</p>}
        <p className="break-all font-mono text-[11.5px] text-ink-2">{url}</p>
        <Button className="self-end" onClick={() => window.print()}><Printer /> {tr("In")}</Button>
      </DialogContent>
    </Dialog>
  );
}
