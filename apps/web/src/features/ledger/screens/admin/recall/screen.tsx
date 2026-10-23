"use client";

import { Suspense, useState } from "react";
import { useLedgerSearchParams as useSearchParams } from "@/components/ledger/route-screen";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { useForm } from "react-hook-form";
import { api } from "@/lib/ledger/coordination-api";
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
  ReadOnlyNote,
  Section,
  Stat,
  StatRow,
} from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
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
    defaultValues: { lotId: params.get("lotId") || "" },
  });
  const [lotId, setLotId] = useState(params.get("lotId") || "");
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
              {tr("Tải snapshot JSON")}
            </Button>
          )
        }
        description={tr(
          "Snapshot chỉ đọc: lô nguồn, lô con (qua chế biến), phân bổ hiện tại và các chặng giao nhận. Không ghi gì, không gửi thông báo.",
        )}
      />
      <PageBody>
        <ReadOnlyNote>
          <span className="font-mono">GET /platform-recall/:lotId</span>{" "}
          {tr(
            "— mỗi phần tối đa 500 dòng, cây lô tối đa 20 cấp. Thu hồi thật là lệnh lô của doanh nghiệp; nền tảng không có quyền thu hồi.",
          )}
        </ReadOnlyNote>
        <form
          onSubmit={form.handleSubmit((v) => setLotId(v.lotId.trim()))}
          className="max-w-xl rounded-md border border-line bg-card p-4"
        >
          <TextField
            control={form.control}
            name="lotId"
            label={tr("Lô gốc để diễn tập")}
            hint={tr("Nhập mã định danh lô để tạo snapshot")}
          />
          <Button
            type="submit"
            size="sm"
            className="mt-3"
            disabled={q.isFetching}
          >
            {tr("Tạo bản diễn tập")}
          </Button>
        </form>
        {!lotId ? (
          <div className="rounded-md border border-dashed border-line-strong bg-card">
            <EmptyState title={tr("Chọn một lô để xem phạm vi ảnh hưởng")} />
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
            <StatRow>
              <Stat label={tr("Lô trong phạm vi")} value={d.lots.length} />
              <Stat
                label={tr("Tổ chức đang giữ")}
                value={new Set(d.holdings.map((h) => h.organizationId)).size}
              />
              <Stat label={tr("Chặng giao nhận")} value={d.movements.length} />
              <Stat
                label={tr("Snapshot lúc")}
                value={
                  <span className="text-[15px]">
                    {fmtDateTime(d.generatedAt)}
                  </span>
                }
              />
            </StatRow>
            <div className="grid min-w-0 grid-cols-1 gap-5 lg:grid-cols-2">
              <Section title={tr("Cây lô")} className="min-w-0">
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
                title={tr("Đang giữ hàng")}
                aside={tr("Lượng giữ chỗ đã nằm trong lượng phân bổ")}
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
                          {tr("(giữ chỗ")} {h.reserved})
                        </span>
                      </span>
                    </li>
                  ))}
                </ul>
              </Section>
            </div>
            <Section
              title={tr("Chặng giao nhận")}
              aside={tr("Không cộng các chặng thành tồn kho")}
            >
              {d.movements.length ? (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-[13px]">
                    <thead>
                      <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-2">
                        <th className="h-9 px-4 font-semibold">{tr("Lô")}</th>
                        <th className="px-3 font-semibold">{tr("Loại")}</th>
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
                      {d.movements.map((m) => (
                        <tr
                          key={m.id}
                          className="border-b border-line/70 last:border-0"
                        >
                          <td className="h-10 px-4 font-mono">
                            {code(m.lotId)}
                          </td>
                          <td className="px-3 font-mono text-[12px]">
                            {m.kind}
                          </td>
                          <td className="px-3">
                            {orgName(m.senderId)} → {orgName(m.receiverId)}
                          </td>
                          <td className="px-3 font-mono text-[12px]">
                            {m.quantity} {m.unit}
                          </td>
                          <td className="px-4 font-mono text-[12px]">
                            {m.status}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <EmptyState title={tr("Không có chặng giao nhận")} />
              )}
            </Section>
            <Section title={tr("Giới hạn của báo cáo")}>
              <ul className="list-disc px-9 py-3 text-[13px] text-ink-2">
                {d.limitations.map((l) => (
                  <li key={l}>{l}</li>
                ))}
              </ul>
            </Section>
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
