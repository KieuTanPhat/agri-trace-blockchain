"use client";

import {useLedgerQuery as useQuery} from "@/lib/ledger/data";
import { procApi } from "@/lib/ledger/proc-api";
import type { LineageLot } from "@/lib/ledger/proc-types";
import { fmtNumber } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { LoadingRows } from "@/components/ledger/kit/page";

/** Truy ngược (lô nguyên liệu) và truy xuôi (lô thành phẩm) qua các lệnh chế biến đã hoàn tất, tối đa 6 cấp. */
export function LineagePanel({ lotId }: { lotId: string }) {
  const q = useQuery({ queryKey: ["lineage", lotId], queryFn: () => procApi.lineage(lotId), retry: false });
  if (q.error) return <p className="text-[12.5px] text-ink-2">{tr("Không tải được chuỗi chế biến: {p0}", { p0: q.error.message })}</p>;
  if (!q.data) return <LoadingRows rows={2} />;
  const { upstream, downstream } = q.data;
  if (!upstream.length && !downstream.length) return <p className="text-[12.5px] text-ink-2">{tr("Lô chưa đi qua lệnh chế biến nào.")}</p>;
  const row = (l: LineageLot, dir: "up" | "down") => (
    <li key={`${dir}-${l.lotId}`} className="flex flex-wrap items-center gap-x-2 gap-y-0.5 px-3 py-2 text-[13px]" style={{ paddingLeft: `${12 + (l.level - 1) * 16}px` }}>
      <span className="font-mono text-[11px] text-ink-2">{dir === "up" ? "↑" : "↓"}{l.level}</span>
      <span className="font-mono text-[12px] font-medium">{l.lotCode}</span>
      <span className="text-ink-2">{l.productName}</span>
      <span className="text-[12px] text-ink-2">· {l.organizationName}</span>
      <span className="ml-auto font-mono text-[11.5px] text-ink-2">
        {l.runCode}
        {dir === "up" && l.usedQuantity ? ` · ${tr("dùng")} ${fmtNumber(l.usedQuantity)} ${l.usedUnit}` : ""}
        {dir === "down" && l.kind === "BY_PRODUCT" ? ` · ${tr("phụ phẩm")}` : ""}
        {l.availableQuantity !== null ? ` · ${tr("còn")} ${fmtNumber(l.availableQuantity)} ${l.unit}` : ""}
      </span>
    </li>
  );
  return (
    <div className="flex flex-col gap-2">
      {upstream.length > 0 && (
        <div>
          <p className="mb-1 text-[12px] font-medium text-ink-2">{tr("Nguyên liệu (truy ngược)")}</p>
          <ul className="divide-y divide-line/70 rounded-md border border-line">{upstream.map((l) => row(l, "up"))}</ul>
        </div>
      )}
      {downstream.length > 0 && (
        <div>
          <p className="mb-1 text-[12px] font-medium text-ink-2">{tr("Sản phẩm chế biến từ lô (truy xuôi)")}</p>
          <ul className="divide-y divide-line/70 rounded-md border border-line">{downstream.map((l) => row(l, "down"))}</ul>
        </div>
      )}
      <p className="text-[11.5px] text-ink-2">{tr("Tồn và trạng thái của lô thuộc doanh nghiệp khác được ẩn.")}</p>
    </div>
  );
}
