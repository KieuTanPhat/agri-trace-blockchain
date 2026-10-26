"use client";

import { useState } from "react";
import { Copy, Download, ExternalLink, QrCode } from "lucide-react";
import { toast } from "sonner";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { distApi } from "@/lib/ledger/dist-api";
import type { StockLot } from "@/lib/ledger/dist-types";
import { fmtDate } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { useWorkspaceAccess } from "@/lib/ledger/workspace-context";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ledger/ui/dialog";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterSelect } from "@/components/ledger/kit/filters";
import { EmptyState, ErrorState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { TraceQrImage, downloadTraceQr, useTraceQr } from "@/components/ledger/workspace/trace-qr";

type QrStatus = "ACTIVE" | "BLOCKED" | "NOTICE" | "NONE";
const statusOf = (l: StockLot): QrStatus =>
  !l.traceToken ? "NONE" : l.blocked ? "BLOCKED" : l.notices.length ? "NOTICE" : "ACTIVE";
const STATUS: Record<QrStatus, { label: () => string; tone: "ok" | "danger" | "warn" | "neutral" }> = {
  ACTIVE: { label: () => tr("Đang hoạt động"), tone: "ok" },
  BLOCKED: { label: () => tr("Đang khóa"), tone: "danger" },
  NOTICE: { label: () => tr("Có thông báo"), tone: "warn" },
  NONE: { label: () => tr("Chưa có mã"), tone: "neutral" },
};

/** Kho QR: every lot's public trace QR, to view, copy and download. */
export default function QrStorePage() {
  const { can } = useWorkspaceAccess();
  const q = useQuery({ queryKey: ["dist-qr"], queryFn: distApi.qr, enabled: can("qr.manage") });
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState("");
  const [open, setOpen] = useState<StockLot | null>(null);
  if (!can("qr.manage")) return <ErrorState error={new Error(tr("Bạn chưa có quyền qr.manage"))} />;
  const term = search.trim().toLocaleLowerCase("vi");
  const rows = q.data?.lots.filter(
    (l) =>
      (!status || statusOf(l) === status) &&
      (!term || [l.lotCode, l.productName, l.chainName].join(" ").toLocaleLowerCase("vi").includes(term)),
  );
  const columns: Column<StockLot>[] = [
    { key: "qr", header: <span className="sr-only">QR</span>, cell: (l) => <QrThumb token={l.traceToken} /> },
    {
      key: "lot",
      header: tr("Lô"),
      sort: (l) => l.lotCode,
      cell: (l) => (
        <span className="flex flex-col">
          <span className="font-medium">{l.productName}</span>
          <span className="font-mono text-[11.5px] text-ink-2">{l.lotCode}</span>
        </span>
      ),
    },
    { key: "chain", header: tr("Chuỗi"), hideBelow: "md", cell: (l) => <span className="text-ink-2">{l.chainName ?? "—"}</span> },
    { key: "expiry", header: tr("Hạn dùng"), hideBelow: "lg", cell: (l) => <span className="font-mono text-[12px]">{l.expiryDate ? fmtDate(l.expiryDate) : "—"}</span> },
    {
      key: "status",
      header: tr("Trạng thái QR"),
      cell: (l) => {
        const s = STATUS[statusOf(l)];
        return <Badge tone={s.tone}>{s.label()}</Badge>;
      },
    },
    {
      key: "act",
      header: <span className="sr-only">{tr("Thao tác")}</span>,
      cell: (l) => (
        <Button size="xs" variant="outline" disabled={!l.traceToken} onClick={() => setOpen(l)}>
          <QrCode /> {tr("Xem QR")}
        </Button>
      ),
    },
  ];
  return (
    <>
      <PageHeader
        title={tr("Kho QR")}
        description={tr("Mã QR truy xuất của các lô doanh nghiệp đang giữ hoặc đã sản xuất. Mỗi lô có một mã cố định; tải mã về để in lên bao bì. Mã bị khóa vẫn mở được trang truy xuất nhưng kèm cảnh báo.")}
      />
      <PageBody>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <div className="flex flex-wrap gap-2 p-3">
            <Input aria-label={tr("Tìm lô")} placeholder={tr("Tìm mã lô, sản phẩm, chuỗi")} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-xs" />
            <FilterSelect
              label={tr("Lọc trạng thái")}
              value={status}
              onChange={setStatus}
              options={(Object.keys(STATUS) as QrStatus[]).map((k) => ({ value: k, label: STATUS[k].label() }))}
            />
          </div>
          <DataTable rows={rows} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={columns} rowKey={(l) => l.lotId} empty={<EmptyState title={tr("Chưa có mã QR nào")} />} />
        </div>
      </PageBody>
      {open && <QrDialog lot={open} onClose={() => setOpen(null)} />}
    </>
  );
}

function QrThumb({ token }: { token: string | null }) {
  const qr = useTraceQr(token);
  return qr.ready ? <TraceQrImage qr={qr} className="size-10 rounded-sm border border-line" /> : <span className="text-ink-2">—</span>;
}

function QrDialog({ lot, onClose }: { lot: StockLot; onClose: () => void }) {
  const qr = useTraceQr(lot.traceToken);
  const s = STATUS[statusOf(lot)];
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle>{lot.productName}</DialogTitle>
          <DialogDescription className="font-mono">{lot.lotCode}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-col items-center gap-3">
          <TraceQrImage qr={qr} className="size-56" />
          <Badge tone={s.tone}>{s.label()}</Badge>
          {lot.notices.map((n, i) => (
            <p key={i} className="text-center text-[12.5px] text-warn">{n.message}</p>
          ))}
          <a href={qr.url} target="_blank" rel="noreferrer" className="break-all text-center text-[12.5px] text-brand underline">{qr.url}</a>
        </div>
        <div className="flex flex-wrap justify-end gap-2">
          <Button size="sm" variant="outline" onClick={() => navigator.clipboard.writeText(qr.url).then(() => toast.success(tr("Đã chép liên kết")), () => toast.error(tr("Không chép được liên kết")))}>
            <Copy /> {tr("Chép liên kết")}
          </Button>
          <Button size="sm" variant="outline" asChild>
            <a href={qr.url} target="_blank" rel="noreferrer"><ExternalLink /> {tr("Mở trang truy xuất")}</a>
          </Button>
          <Button size="sm" onClick={() => downloadTraceQr(qr.svg, lot.lotCode)}>
            <Download /> {tr("Tải QR")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
