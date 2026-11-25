"use client";

import { Suspense, useState } from "react";
import { useLedgerSearchParams as useSearchParams } from "@/components/ledger/route-screen";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { useForm } from "react-hook-form";
import { api } from "@/lib/ledger/coordination-api";
import { api as ops } from "@/lib/ledger/operations-api";
import { fmtDateTime } from "@/lib/ledger/format";
import { Guard } from "@/components/ledger/kit/guard";
import { TextField } from "@/components/ledger/kit/form-fields";
import { Button } from "@/components/ledger/ui/button";
import { downloadText } from "@/lib/platform-governance";
import {
  Callout,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageBody,
  PageHeader,
  Section,
  Stat,
  StatRow,
} from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
/** Handover kinds and statuses in plain words. */
const KIND_LABEL: Record<string, string> = {
  get DISTRIBUTION() { return tr("Giao nhận"); },
  get SHIPMENT() { return tr("Chuyến vận chuyển"); },
};
const MOVE_STATUS: Record<string, string> = {
  get PROPOSED() { return tr("Mới lập phiếu"); },
  get READY() { return tr("Đã đồng thuận, chờ lấy hàng"); },
  get IN_TRANSIT() { return tr("Đang chở"); },
  get DELIVERED() { return tr("Đã giao"); },
  get CANCELLED() { return tr("Đã hủy"); },
  get REJECTED() { return tr("Bị từ chối"); },
  get RETURNED() { return tr("Đã trả hàng"); },
  get RECEIVED() { return tr("Đã nhận"); },
  get CREATED() { return tr("Mới tạo"); },
};
function RecallPage() {
  return (
    <Guard permission="recall.read">
      <Suspense>
        <Recall />
      </Suspense>
    </Guard>
  );
}

function Recall() {
  const params = useSearchParams();
  const form = useForm<{ lotId: string }>({
    defaultValues: { lotId: "" },
  });
  const [lotId, setLotId] = useState(params.get("lotId") || "");
  // Find the lot by its familiar code or product name, not its internal id.
  const [term, setTerm] = useState("");
  const found = useQuery({
    queryKey: ["recall-lot-search", term],
    queryFn: () => ops.trace.lots(term),
    enabled: term.length > 0,
  });
  const q = useQuery({
    queryKey: ["recall", lotId],
    queryFn: () => api.trace.recall(lotId),
    enabled: !!lotId,
  });
  const d = q.data;
  const code = (id: string) =>
    d?.lots.find((l) => l.id === id)?.lotCode ?? id.slice(-8);
  const orgName = (id: string) =>
    d?.holdings.find((h) => h.organizationId === id)?.organizationName ??
    id.slice(-8);

  return (
    <>
      <PageHeader
        title={tr("Diễn tập thu hồi")}
        actions={
          d && (
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                downloadText(
                  "recall-" + d.rootLotId + ".json",
                  JSON.stringify(d, null, 2),
                  "application/json",
                )
              }
            >
              {tr("Tải báo cáo")}
            </Button>
          )
        }
        description={tr(
          "Giả sử một lô có vấn đề: xem hàng của lô đó đang ở đâu, ai đang giữ, đã chế biến ra lô nào và đang được chở đi đâu. Trang này chỉ để xem trước, không thu hồi thật và không gửi thông báo. Thu hồi thật do doanh nghiệp chủ lô thực hiện ở trang lô.",
        )}
      />
      <PageBody>
        <form
          role="search"
          onSubmit={form.handleSubmit((v) => setTerm(v.lotId.trim()))}
          className="max-w-xl rounded-md border border-line bg-card p-4"
        >
          <TextField
            control={form.control}
            name="lotId"
            label={tr("Chọn lô cần xem")}
            hint={tr("Gõ mã lô (ví dụ LOT-20261125-…), tên sản phẩm hoặc mã QR rồi bấm Tìm lô")}
          />
          <Button
            type="submit"
            size="sm"
            className="mt-3"
            disabled={found.isFetching}
          >
            {tr("Tìm lô")}
          </Button>
          {term && (
            <div className="mt-3">
              {found.error ? (
                <ErrorState error={found.error} onRetry={() => found.refetch()} />
              ) : !found.data ? (
                <LoadingRows rows={2} />
              ) : !found.data.length ? (
                <p className="text-[12.5px] text-ink-2">{tr("Không tìm thấy lô phù hợp")}</p>
              ) : (
                <ul className="divide-y divide-line/70 rounded-md border border-line">
                  {found.data.slice(0, 8).map((l) => (
                    <li key={l.lotId}>
                      <button
                        type="button"
                        onClick={() => setLotId(l.lotId)}
                        className={
                          "flex w-full flex-wrap items-center gap-2 px-3 py-2 text-left text-[13px] hover:bg-row-alt" +
                          (l.lotId === lotId ? " bg-brand-weak" : "")
                        }
                      >
                        <span className="font-mono">{l.lotCode}</span>
                        <span className="min-w-0 flex-1 truncate">{l.productName} · {l.organizationName}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </form>
        {!lotId ? (
          <div className="rounded-md border border-dashed border-line-strong bg-card">
            <EmptyState title={tr("Tìm và chọn một lô để xem phạm vi ảnh hưởng")} />
          </div>
        ) : q.error ? (
          <ErrorState error={q.error} onRetry={() => q.refetch()} />
        ) : !d ? (
          <LoadingRows />
        ) : (
          <>
            {d.truncated && (
              <Callout tone="warn" title={tr("Kết quả bị cắt")}>
                {tr("Danh sách chưa đầy đủ — cần đối soát bổ sung.")}
              </Callout>
            )}
            <Callout tone="info">
              {tr(
                "Nếu thu hồi lô {p0}: ảnh hưởng {p1} lô, {p2} doanh nghiệp đang giữ hàng, {p3} chuyến đang chở.",
                {
                  p0: d.lots.find((l) => l.id === d.rootLotId)?.lotCode ?? code(d.rootLotId),
                  p1: d.lots.length,
                  p2: new Set(d.holdings.map((h) => h.organizationId)).size,
                  p3: d.movements.filter((m) => m.status === "IN_TRANSIT").length,
                },
              )}
            </Callout>
            <StatRow>
              <Stat label={tr("Lô bị ảnh hưởng")} value={d.lots.length} />
              <Stat
                label={tr("Doanh nghiệp đang giữ")}
                value={new Set(d.holdings.map((h) => h.organizationId)).size}
              />
              <Stat label={tr("Lượt giao nhận")} value={d.movements.length} />
              <Stat
                label={tr("Thời điểm xem")}
                value={
                  <span className="text-[15px]">
                    {fmtDateTime(d.generatedAt)}
                  </span>
                }
              />
            </StatRow>
            <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
              <Section title={tr("Lô này và các lô sinh ra từ nó")} aside={tr("còn lại / ban đầu")} className="min-w-0">
                <ul className="divide-y divide-line/70">
                  {d.lots.map((l) => (
                    <li
                      key={l.id}
                      className="flex flex-wrap items-center gap-3 px-4 py-2 text-[13px] sm:px-5"
                      style={{ paddingLeft: l.parentLotId ? 36 : 20 }}
                    >
                      <span className="break-all font-mono">{l.lotCode}</span>
                      <span className="min-w-0 flex-1 break-words font-mono text-[12px] text-ink-2">
                        {l.availableQuantity}/{l.initialQuantity} {l.unit}
                      </span>
                      <Status group="lot" value={l.state} />
                    </li>
                  ))}
                </ul>
              </Section>
              <Section
                className="min-w-0"
                title={tr("Ai đang giữ hàng, bao nhiêu")}
                aside={tr("Phần đã hẹn giao nằm trong số đang giữ")}
              >
                <ul className="divide-y divide-line/70">
                  {d.holdings.map((h, i) => (
                    <li
                      key={i}
                      className="flex flex-wrap items-center justify-between gap-3 px-4 py-2 text-[13px] sm:px-5"
                    >
                      <span className="min-w-0 truncate">
                        {h.organizationName}{" "}
                        <span className="font-mono text-[12px] text-ink-2">
                          {code(h.lotId)}
                        </span>
                      </span>
                      <span className="min-w-0 break-words font-mono text-[12px]">
                        {h.quantity}{" "}
                        <span className="text-ink-2">
                          {tr("(đã hẹn giao")} {h.reserved})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
            <Section
              title={tr("Hàng đã và đang được chở đi đâu")}
              aside={tr("Mỗi dòng là một lượt giao, không phải tồn kho")}
            >
              {d.movements.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[13px]">
                    <thead>
                      <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-2">
                        <th className="h-9 w-12 pl-4 pr-1 text-right font-semibold">{tr("STT")}</th>
                        <th className="h-9 px-4 font-semibold">{tr("Lô")}</th>
                        <th className="px-3 font-semibold">{tr("Hình thức")}</th>
                        <th className="px-3 font-semibold">
                          {tr("Gửi → Nhận")}
                        </th>
                        <th className="px-3 font-semibold">{tr("Lượng")}</th>
                        <th className="px-4 font-semibold">
                          {tr("Trạng thái")}
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {d.movements.map((m, i) => (
                        <tr
                          key={m.id}
                          className="border-b border-line/70 last:border-0"
                        >
                          <td className="w-12 pl-4 pr-1 text-right font-mono text-[12px] text-ink-2">{i + 1}</td>
                          <td className="h-10 px-4 font-mono">
                            {code(m.lotId)}
                          </td>
                          <td className="px-3 text-[12px]">
                            {KIND_LABEL[m.kind] ?? m.kind}
                          </td>
                          <td className="px-3">
                            {orgName(m.senderId)} → {orgName(m.receiverId)}
                          </td>
                          <td className="px-3 font-mono text-[12px]">
                            {m.quantity} {m.unit}
                          </td>
                          <td className="px-4 text-[12px]">
                            {MOVE_STATUS[m.status] ?? m.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title={tr("Lô này chưa được giao cho ai")} />
              )}
            </Section>
            <details className="rounded-md border border-line bg-card px-4 py-2 text-[13px]">
              <summary className="cursor-pointer text-ink-2">{tr("Giới hạn của báo cáo")}</summary>
              <ul className="list-disc px-5 py-2 text-ink-2">
                {d.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </details>
          </>
        )}
      </PageBody>
    </>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-recall">
      <div
        data-testid="ledger-recall-workspace"
        className="flex min-w-0 flex-1 flex-col"
      >
        <RecallPage />
      </div>
    </LedgerRouteScreen>
  );
}
