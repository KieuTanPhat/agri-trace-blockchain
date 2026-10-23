"use client";

import { Suspense, useState } from "react";
import Link from "next/link";
import { useLedgerSearchParams as useSearchParams } from "@/components/ledger/route-screen";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { z } from "zod";
import { api } from "@/lib/ledger/coordination-api";
import type {
  ConsumerReport,
  ReportStatus,
} from "@/lib/ledger/coordination-api";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtAgo, fmtDateTime } from "@/lib/ledger/format";
import { CASE_CATEGORY_LABEL } from "@/lib/ledger/labels";
import { note } from "@/lib/ledger/platform-schemas";
import { CommandForm } from "@/components/ledger/kit/command-dialog";
import {
  ChoiceField,
  SelectField,
  TextAreaField,
} from "@/components/ledger/kit/form-fields";
import { Guard } from "@/components/ledger/kit/guard";
import {
  Callout,
  EmptyState,
  ErrorState,
  LoadingRows,
  PageBody,
  PageHeader,
} from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
const schema = z.object({
  decision: z.enum(["ESCALATE", "DISMISS", "DUPLICATE"]),
  severity: z.enum(["LOW", "MEDIUM", "HIGH", "CRITICAL"]),
  note: note(10, 1000),
});

function ReportsPage() {
  return (
    <Guard permission="reports.read">
      <Suspense>
        <Reports />
      </Suspense>
    </Guard>
  );
}

function Reports() {
  const params = useSearchParams();
  const [lockedReport, setLockedReport] = useState<ConsumerReport | null>(null);
  const [status, setStatus] = useState<ReportStatus | "">("NEW");
  const [selectedId, setSelected] = useState<string | null>(params.get("id"));
  const q = useQuery({
    queryKey: ["reports", status],
    queryFn: () => api.support.reports(status || undefined),
  });
  const current =
    lockedReport ?? q.data?.find((r) => r.id === selectedId) ?? q.data?.[0];
  return (
    <>
      <PageHeader
        title={tr("Báo cáo người tiêu dùng")}
        description={tr(
          "Gửi từ trang QR công khai, không cần đăng nhập, giới hạn theo nguồn mạng. Phân loại: chuyển thành hồ sơ sự cố, bác bỏ hoặc đánh dấu trùng.",
        )}
      />
      <PageBody wide>
        <div className="flex gap-1 overflow-x-auto">
          {(["NEW", "ESCALATED", "DISMISSED", "DUPLICATE", ""] as const).map(
            (s) => (
              <button
                disabled={lockedReport !== null}
                key={s || "all"}
                type="button"
                onClick={() => (setStatus(s), setSelected(null))}
                className={cn(
                  "h-8 shrink-0 rounded-md border px-3 text-[12.5px] font-medium",
                  status === s
                    ? "border-ink bg-ink text-canvas"
                    : "border-line bg-card",
                )}
              >
                {s
                  ? {
                      NEW: tr("Chưa phân loại"),
                      ESCALATED: tr("Đã chuyển sự cố"),
                      DISMISSED: tr("Bác bỏ"),
                      DUPLICATE: tr("Trùng"),
                    }[s]
                  : tr("Tất cả")}
              </button>
            ),
          )}
        </div>
        <div className="flex flex-wrap items-start gap-5">
          <div className="min-w-0 flex-[3_1_480px] overflow-hidden rounded-md border border-line bg-card">
            {q.error ? (
              <ErrorState error={q.error} onRetry={() => q.refetch()} />
            ) : !q.data ? (
              <LoadingRows />
            ) : !q.data.length ? (
              <EmptyState title={tr("Không có báo cáo")} />
            ) : (
              <ul className="divide-y divide-line/70">
                {q.data.map((r) => (
                  <li key={r.id}>
                    <button
                      disabled={lockedReport !== null}
                      type="button"
                      onClick={() => setSelected(r.id)}
                      className={cn(
                        "flex w-full flex-col gap-1 px-4 py-3 text-left hover:bg-row-alt",
                        current?.id === r.id &&
                          "bg-brand-weak shadow-[inset_3px_0_0_var(--brand)] hover:bg-brand-weak",
                      )}
                    >
                      <span className="flex items-center justify-between gap-2">
                        <span className="text-[11px] font-semibold tracking-wide text-ink-2 uppercase">
                          {CASE_CATEGORY_LABEL[r.category] ?? r.category}
                        </span>
                        <span className="text-[12px] text-ink-2">
                          {fmtAgo(r.createdAt)}
                        </span>
                      </span>
                      <span className="line-clamp-2 text-[13px]">
                        {r.description}
                      </span>
                      <span className="flex items-center justify-between gap-2 text-[12px] text-ink-2">
                        <span className="truncate">
                          <span className="font-mono">{r.lotCode}</span> ·{" "}
                          {r.productName} · {r.organizationName}
                        </span>
                        <Status group="report" value={r.status} />
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          {current && (
            <Detail
              r={current}
              onLockChange={(v) => setLockedReport(v ? current : null)}
            />
          )}
        </div>
      </PageBody>
    </>
  );
}

function Detail({
  r,
  onLockChange,
}: {
  r: ConsumerReport;
  onLockChange: (v: boolean) => void;
}) {
  const { can } = useSession();
  return (
    <aside className="flex min-w-0 flex-[2_1_360px] flex-col gap-4 lg:sticky lg:top-[68px]">
      <div className="flex flex-col gap-3 rounded-md border border-line bg-card p-5">
        <div className="flex items-center justify-between gap-2">
          <span className="label-caps">
            {tr("Báo cáo ·")} {fmtDateTime(r.createdAt)}
          </span>
          <Status group="report" value={r.status} />
        </div>
        <p className="text-[14px] leading-relaxed">{r.description}</p>
        <dl className="grid grid-cols-[110px_minmax(0,1fr)] gap-y-1.5 text-[13px]">
          <dt className="text-ink-2">{tr("Lô")}</dt>
          <dd>
            <Link
              className="font-mono text-brand hover:underline"
              href="/admin/lots"
            >
              {r.lotCode}
            </Link>{" "}
            · {r.productName}
          </dd>
          <dt className="text-ink-2">{tr("Doanh nghiệp")}</dt>
          <dd>{r.organizationName}</dd>
          <dt className="text-ink-2">{tr("Liên hệ")}</dt>
          <dd>
            {r.contactEmail || r.contactPhone ? (
              <span className="font-mono text-[12px]">
                {[r.contactEmail, r.contactPhone].filter(Boolean).join(" · ")}
              </span>
            ) : r.hasContact ? (
              <span className="text-ink-2">
                {tr("Có liên hệ — vai hiện tại không được xem")}
              </span>
            ) : (
              <span className="text-ink-2">
                {tr("Người báo không để lại liên hệ")}
              </span>
            )}
          </dd>
          {r.triageNote && (
            <>
              <dt className="text-ink-2">{tr("Phân loại")}</dt>
              <dd>{r.triageNote}</dd>
            </>
          )}
        </dl>
      </div>
      {r.caseId && (
        <Callout>
          <Link
            className="text-brand hover:underline"
            href={"/admin/cases/" + r.caseId}
          >
            {tr("Xem hồ sơ sự cố")}
          </Link>
        </Callout>
      )}
      {r.status === "NEW" && can("reports.triage") ? (
        <div className="rounded-md border border-line-strong bg-card p-5">
          <CommandForm
            key={r.id}
            onLockChange={onLockChange}
            title={tr("Phân loại báo cáo")}
            endpoint="POST /platform-admin/consumer-reports/:id/triage"
            schema={schema}
            defaultValues={{
              decision: "ESCALATE",
              severity: "MEDIUM",
              note: "",
            }}
            version={r.version}
            submitLabel={tr("Ghi phân loại")}
            invalidate={[["reports"], ["cases"], ["inbox"]]}
            run={(v, cmd) =>
              api.support.triage(r.id, { ...v, version: r.version }, cmd)
            }
          >
            {(f) => (
              <>
                <ChoiceField
                  control={f.control}
                  name="decision"
                  label={tr("Quyết định")}
                  options={[
                    {
                      value: "ESCALATE",
                      label: tr("Chuyển thành hồ sơ sự cố"),
                      help: tr(
                        "Tạo hồ sơ nguồn CONSUMER, giao cho chủ lô — không kèm thông tin liên hệ.",
                      ),
                    },
                    { value: "DUPLICATE", label: tr("Trùng báo cáo khác") },
                    { value: "DISMISS", label: tr("Bác bỏ"), tone: "danger" },
                  ]}
                />
                {f.watch("decision") === "ESCALATE" && (
                  <SelectField
                    control={f.control}
                    name="severity"
                    label={tr("Mức độ hồ sơ")}
                    options={[
                      { value: "LOW", label: tr("Thấp") },
                      { value: "MEDIUM", label: tr("Trung bình") },
                      { value: "HIGH", label: "Cao" },
                      { value: "CRITICAL", label: tr("Nghiêm trọng") },
                    ]}
                  />
                )}
                <TextAreaField
                  control={f.control}
                  name="note"
                  label={tr("Ghi chú phân loại")}
                  hint={tr("10–1000 ký tự")}
                />
              </>
            )}
          </CommandForm>
        </div>
      ) : r.status === "NEW" ? (
        <Callout>{tr("Vai hiện tại chỉ được xem báo cáo.")}</Callout>
      ) : null}
    </aside>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-reports">
      <div
        data-testid="ledger-reports-workspace"
        className="flex min-w-0 flex-1 flex-col"
      >
        <ReportsPage />
      </div>
    </LedgerRouteScreen>
  );
}
