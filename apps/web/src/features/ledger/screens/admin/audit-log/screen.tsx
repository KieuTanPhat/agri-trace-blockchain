"use client";

import { Suspense, useState } from "react";
import { useLedgerSearchParams as useSearchParams } from "@/components/ledger/route-screen";

import {
  useLedgerInfiniteQuery as useInfiniteQuery,
  useMutation,
  useLedgerQuery as useQuery,
} from "@/lib/ledger/data";
import { toast } from "sonner";
import { Download, Link2, Loader2, ShieldCheck } from "lucide-react";
import { api } from "@/lib/ledger/platform-api";
import type { AuditEntry, AuditVerify } from "@/lib/ledger/platform-api";
import { fmtDateTime, shortHash } from "@/lib/ledger/format";
import { Button } from "@/components/ledger/ui/button";
import { Input } from "@/components/ledger/ui/input";
import { Label } from "@/components/ledger/ui/label";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ledger/ui/sheet";
import { FilterBar, FilterSelect } from "@/components/ledger/kit/filters";
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
function PreviewScreen() {
  return (
    <Guard permission="audit.read">
      <Suspense>
        <Audit />
      </Suspense>
    </Guard>
  );
}

function Audit() {
  const params = useSearchParams();
  const [action, setAction] = useState("");
  const [organizationId, setOrg] = useState(params.get("organizationId") ?? "");
  const [subjectType, setSubjectType] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [selected, setSelected] = useState<AuditEntry | null>(null);
  const [verify, setVerify] = useState<AuditVerify | null>(null);
  const filters = {
    action: action || undefined,
    organizationId: organizationId || undefined,
    subjectType: subjectType || undefined,
    from: from ? new Date(from).toISOString() : undefined,
    to: to ? new Date(`${to}T23:59:59`).toISOString() : undefined,
  };
  const actions = useQuery({
    queryKey: ["audit-actions"],
    queryFn: api.audit.actions,
  });
  const orgs = useQuery({
    queryKey: ["organizations"],
    queryFn: api.enterprises.organizations,
  });
  const q = useInfiniteQuery({
    queryKey: ["audit", filters],
    queryFn: ({ pageParam }) =>
      api.audit.list({ ...filters, cursor: pageParam, limit: 50 }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items) ?? [];
  const verifyM = useMutation({
    mutationFn: api.audit.verify,
    onSuccess: setVerify,
    onError: (e) => toast.error(String((e as Error).message)),
  });
  const exportM = useMutation({
    mutationFn: () => api.audit.exportCsv({ ...filters, limit: 5000 }),
    onError: (error) => toast.error(error.message),
    onSuccess: (r) => {
      const url = URL.createObjectURL(
        new Blob(["﻿" + r.csv], { type: "text/csv;charset=utf-8" }),
      );
      const a = document.createElement("a");
      a.href = url;
      a.download = r.filename;
      a.click();
      URL.revokeObjectURL(url);
      toast.success(
        tr("Đã xuất {p0} dòng{p1}", {
          p0: r.rowCount,
          p1: r.truncated ? tr(" (đã cắt theo giới hạn)") : "",
        }),
      );
    },
  });
  const active = !!(action || organizationId || subjectType || from || to);
  const subjectTypes = [...new Set(rows.map((r) => r.subjectType))].sort();

  return (
    <>
      <PageHeader
        title={tr("Nhật ký kiểm toán nền tảng")}
        description={tr(
          "Append-only, nối băm: mỗi bản ghi chứa prev_hash của bản trước và được ghi trong cùng giao dịch với thao tác. Chỉ đọc.",
        )}
        actions={
          <>
            <Button
              variant="outline"
              size="sm"
              onClick={() => verifyM.mutate()}
              disabled={verifyM.isPending}
            >
              {verifyM.isPending ? (
                <Loader2 className="animate-spin" />
              ) : (
                <ShieldCheck />
              )}{" "}
              {tr("Kiểm chuỗi băm")}
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => exportM.mutate()}
              disabled={exportM.isPending}
            >
              <Download /> {tr("Xuất CSV")}
            </Button>
          </>
        }
      />
      <PageBody wide>
        {verify && (
          <Callout
            tone={verify.ok ? "ok" : "danger"}
            title={
              verify.ok
                ? tr("Chuỗi toàn vẹn · đã kiểm {p0} bản ghi", {
                    p0: verify.checked,
                  })
                : tr("Phát hiện lệch tại seq {p0}", {
                    p0: verify.firstInvalid?.sequence,
                  })
            }
          >
            {verify.ok ? (
              <>
                {tr("Đầu chuỗi")}{" "}
                <span className="font-mono">#{verify.headSequence}</span> ·{" "}
                <span className="font-mono break-all">{verify.headHash}</span>
                <span className="mt-1 block text-ink-2">
                  {tr(
                    "Giới hạn: chuỗi băm lưu trong cùng DB; muốn chống chủ DB cần neo đầu chuỗi ra ngoài (Backend chưa làm).",
                  )}
                </span>
              </>
            ) : (
              verify.firstInvalid?.reason
            )}
          </Callout>
        )}
        <FilterBar
          active={active}
          onReset={() => (
            setAction(""),
            setOrg(""),
            setSubjectType(""),
            setFrom(""),
            setTo("")
          )}
        >
          <FilterSelect
            label={tr("Hành động")}
            value={action}
            onChange={setAction}
            options={(actions.data ?? []).map((a) => ({ value: a, label: a }))}
            className="min-w-[210px]"
          />
          <FilterSelect
            label={tr("Tổ chức")}
            value={organizationId}
            onChange={setOrg}
            options={(orgs.data ?? []).map((o) => ({
              value: o.id,
              label: o.name,
            }))}
            className="min-w-[200px]"
          />
          <FilterSelect
            label={tr("Đối tượng")}
            value={subjectType}
            onChange={setSubjectType}
            options={subjectTypes.map((s) => ({ value: s, label: s }))}
          />
          <div className="flex items-center gap-1.5">
            <Label htmlFor="from" className="text-[12px] text-ink-2">
              {tr("Từ")}
            </Label>
            <Input
              id="from"
              type="date"
              value={from}
              onChange={(e) => setFrom(e.target.value)}
              className="h-8 w-[150px] bg-card"
            />
            <Label htmlFor="to" className="text-[12px] text-ink-2">
              {tr("đến")}
            </Label>
            <Input
              id="to"
              type="date"
              value={to}
              onChange={(e) => setTo(e.target.value)}
              className="h-8 w-[150px] bg-card"
            />
          </div>
        </FilterBar>

        <div className="overflow-hidden rounded-md border border-line bg-card">
          {q.error ? (
            <ErrorState error={q.error} onRetry={() => q.refetch()} />
          ) : q.isLoading ? (
            <LoadingRows rows={10} />
          ) : rows.length === 0 ? (
            <EmptyState title={tr("Không có bản ghi")}>
              {tr("Thử nới khoảng thời gian hoặc bỏ bớt bộ lọc.")}
            </EmptyState>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[980px] text-[13px]">
                <caption className="sr-only">{tr("Nhật ký kiểm toán")}</caption>
                <thead>
                  <tr className="border-b border-line bg-sunken text-left text-[12px] text-ink-2">
                    <th className="h-9 w-[80px] pl-4 font-semibold">Seq</th>
                    <th className="w-[130px] px-3 font-semibold">
                      {tr("Thời điểm")}
                    </th>
                    <th className="px-3 font-semibold">{tr("Hành động")}</th>
                    <th className="px-3 font-semibold">
                      {tr("Người thực hiện")}
                    </th>
                    <th className="px-3 font-semibold">{tr("Đối tượng")}</th>
                    <th className="px-3 font-semibold">{tr("Lý do")}</th>
                    <th className="w-[110px] px-3 font-semibold">
                      {tr("Kết quả")}
                    </th>
                    <th className="w-[120px] pr-4 font-semibold">
                      {tr("Băm")}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => {
                    const next = rows[i - 1];
                    const linked = !next || next.prevHash === r.entryHash;
                    return (
                      <tr
                        key={r.id}
                        tabIndex={0}
                        onClick={() => setSelected(r)}
                        onKeyDown={(e) => e.key === "Enter" && setSelected(r)}
                        className={cn(
                          "cursor-pointer border-b border-line/60 outline-none hover:bg-row-alt focus-visible:bg-brand-weak/60",
                          i % 2 === 1 && "bg-row-alt/50",
                          r.outcome !== "SUCCESS" && "bg-danger-bg/30",
                        )}
                      >
                        <td className="h-9 pl-4 font-mono text-[12px]">
                          {r.sequence}
                        </td>
                        <td className="px-3 font-mono text-[12px] whitespace-nowrap">
                          {fmtDateTime(r.occurredAt)}
                        </td>
                        <td className="px-3 font-mono text-[12px]">
                          {r.action}
                        </td>
                        <td className="px-3">
                          <span className="block max-w-[180px] truncate">
                            {r.actor?.fullName ?? tr("Hệ thống")}
                          </span>
                          <span className="font-mono text-[11px] text-ink-2">
                            {r.actorRole}
                          </span>
                        </td>
                        <td className="px-3">
                          <span className="font-mono text-[12px]">
                            {r.subjectType}
                          </span>
                          {r.organization && (
                            <span className="block max-w-[180px] truncate text-[11.5px] text-ink-2">
                              {r.organization.name}
                            </span>
                          )}
                        </td>
                        <td className="max-w-[260px] px-3">
                          <span className="line-clamp-1 text-ink-2">
                            {r.reason ?? "—"}
                          </span>
                        </td>
                        <td className="px-3">
                          <Status group="outcome" value={r.outcome} />
                        </td>
                        <td
                          className="pr-4 font-mono text-[11.5px] text-ink-2"
                          title={
                            linked
                              ? tr("prev_hash khớp bản ghi kế tiếp")
                              : tr(
                                  "Không khớp bản ghi liền kề trong trang (có thể do bộ lọc)",
                                )
                          }
                        >
                          <span className="inline-flex items-center gap-1">
                            <Link2
                              className={cn(
                                "size-3",
                                linked ? "text-ok" : "text-ink-2/50",
                              )}
                              aria-hidden
                            />
                            {r.entryHash.slice(0, 8)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          {rows.length > 0 && (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2 text-[12px] text-ink-2">
              <span>
                {rows.length} {tr("bản ghi · phân trang cursor (50/lần)")}
              </span>
              {q.hasNextPage ? (
                <Button
                  variant="outline"
                  size="xs"
                  onClick={() => q.fetchNextPage()}
                  disabled={q.isFetchingNextPage}
                >
                  {q.isFetchingNextPage && <Loader2 className="animate-spin" />}{" "}
                  {tr("Tải thêm")}
                </Button>
              ) : (
                <span>{tr("Đã tới đầu chuỗi theo bộ lọc")}</span>
              )}
            </div>
          )}
        </div>
      </PageBody>

      <Sheet open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle className="font-mono">
                  #{selected.sequence} · {selected.action}
                </SheetTitle>
                <SheetDescription>
                  {fmtDateTime(selected.occurredAt)}
                </SheetDescription>
              </SheetHeader>
              <dl className="grid grid-cols-[130px_minmax(0,1fr)] gap-x-3 gap-y-2.5 px-4 pb-6 text-[13px]">
                <dt className="text-ink-2">{tr("Kết quả")}</dt>
                <dd>
                  <Status group="outcome" value={selected.outcome} />
                </dd>
                <dt className="text-ink-2">{tr("Người thực hiện")}</dt>
                <dd>
                  {selected.actor
                    ? `${selected.actor.fullName} · ${selected.actor.email}`
                    : tr("Hệ thống")}
                </dd>
                <dt className="text-ink-2">Vai</dt>
                <dd className="font-mono text-[12px]">{selected.actorRole}</dd>
                <dt className="text-ink-2">{tr("Đối tượng")}</dt>
                <dd className="font-mono text-[12px] break-all">
                  {selected.subjectType} · {selected.subjectId}
                </dd>
                <dt className="text-ink-2">{tr("Tổ chức")}</dt>
                <dd>{selected.organization?.name ?? "—"}</dd>
                <dt className="text-ink-2">{tr("Lý do")}</dt>
                <dd>{selected.reason ?? "—"}</dd>
                <dt className="text-ink-2">{tr("Chi tiết")}</dt>
                <dd>
                  <pre className="overflow-x-auto rounded-md bg-sunken p-2 font-mono text-[11.5px] whitespace-pre-wrap">
                    {JSON.stringify(selected.details, null, 2)}
                  </pre>
                </dd>
                <dt className="text-ink-2">entry_hash</dt>
                <dd className="font-mono text-[11.5px] break-all">
                  {selected.entryHash}
                </dd>
                <dt className="text-ink-2">prev_hash</dt>
                <dd className="font-mono text-[11.5px] break-all">
                  {selected.prevHash}
                </dd>
                <dt className="text-ink-2">Idempotency-Key</dt>
                <dd className="font-mono text-[11.5px] break-all">
                  {selected.idempotencyKey ?? "—"}
                </dd>
                <dt className="text-ink-2">requestId</dt>
                <dd className="font-mono text-[11.5px]">
                  {selected.requestId ?? "—"}
                </dd>
              </dl>
              <p className="px-4 pb-6 text-[12px] text-ink-2">
                {tr(
                  "Khóa kiểu password/secret/token/OTP trong chi tiết đã được Backend che; mật khẩu, OTP, seed MFA không bao giờ vào nhật ký. Băm hiển thị:",
                )}{" "}
                {shortHash(selected.entryHash)}.
              </p>
            </>
          )}
        </SheetContent>
      </Sheet>
    </>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale as useLedgerLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLedgerLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-audit-log">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
