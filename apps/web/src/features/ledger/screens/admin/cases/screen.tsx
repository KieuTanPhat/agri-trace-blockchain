"use client";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale } from "@/components/ledger/locale";

import { useState } from "react";
import Link from "next/link";
import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { useLedgerInfiniteQuery as useInfiniteQuery } from "@/lib/ledger/data";
import { ledgerRequest } from "@/lib/ledger/request";
import { Loader2, Plus } from "lucide-react";

import type { PlatformCase, PlatformCasePage } from "@/lib/platform-governance";
import { useLedgerSession as useSession } from "@/lib/ledger/platform-access";
import { fmtDateTime, fmtDue } from "@/lib/ledger/format";
import { CASE_CATEGORY_LABEL, CASE_SOURCE_LABEL } from "@/lib/ledger/labels";
import { Button } from "@/components/ledger/ui/button";
import { Checkbox } from "@/components/ledger/ui/checkbox";
import { Label } from "@/components/ledger/ui/label";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterBar, FilterSelect } from "@/components/ledger/kit/filters";
import { Guard } from "@/components/ledger/kit/guard";
import { EmptyState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Due, Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-cases">
      <Guard permission="cases.read">
        <Cases />
      </Guard>
    </LedgerRouteScreen>
  );
}

function Cases() {
  const { can } = useSession();
  const [status, setStatus] = useState("");
  const [severity, setSeverity] = useState("");
  const [overdue, setOverdue] = useState(false);
  const filters = { status, severity, overdue };
  const q = useInfiniteQuery({
    queryKey: ["cases", filters],
    queryFn: ({ pageParam }) => {
      const params = new URLSearchParams();
      if (status) params.set("status", status);
      if (severity) params.set("severity", severity);
      if (overdue) params.set("overdue", "true");
      if (pageParam) params.set("cursor", pageParam);
      return ledgerRequest<PlatformCasePage>(
        `/platform-cases${params.size ? `?${params}` : ""}`,
      );
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (l) => l.nextCursor ?? undefined,
  });
  const rows = q.data?.pages.flatMap((p) => p.items);

  const columns: Column<PlatformCase>[] = [
    {
      key: "no",
      header: tr("Số"),
      className: "w-[70px]",
      sort: (c) => c.caseNumber,
      cell: (c) => (
        <span className="font-mono text-[12px]">#{c.caseNumber}</span>
      ),
    },
    {
      key: "title",
      header: tr("Hồ sơ"),
      cell: (c) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{c.title}</span>
          <span className="text-[11.5px] text-ink-2">
            {CASE_CATEGORY_LABEL[c.category]} · {CASE_SOURCE_LABEL[c.source]}
            {c.lot && (
              <>
                {" "}
                {tr("· lô")} <span className="font-mono">{c.lot.lotCode}</span>
              </>
            )}
          </span>
        </div>
      ),
    },
    {
      key: "owner",
      header: tr("Tổ chức phụ trách"),
      hideBelow: "md",
      cell: (c) => (
        <span className="text-ink-2">{c.owner?.name ?? tr("Chưa giao")}</span>
      ),
    },
    {
      key: "sev",
      header: tr("Mức độ"),
      sort: (c) => ["LOW", "MEDIUM", "HIGH", "CRITICAL"].indexOf(c.severity),
      cell: (c) => <Status group="severity" value={c.severity} />,
    },
    {
      key: "due",
      header: tr("Hạn phản hồi"),
      sort: (c) => c.responseDueAt ?? "9",
      cell: (c) => {
        if (!c.responseDueAt) return <span className="text-ink-2">—</span>;
        const d = fmtDue(c.responseDueAt);
        return c.status === "CLOSED" ? (
          <span className="font-mono text-[12px] text-ink-2">
            {fmtDateTime(c.responseDueAt)}
          </span>
        ) : (
          <Due overdue={c.overdue}>{d.text}</Due>
        );
      },
    },
    {
      key: "status",
      header: tr("Trạng thái"),
      cell: (c) => <Status group="case" value={c.status} />,
    },
  ];

  return (
    <div data-testid="ledger-case-list">
      <PageHeader
        title={tr("Hồ sơ sự cố")}
        description={tr(
          "Hồ sơ là yêu cầu và thông báo gửi tổ chức sở hữu; không có đường nào đổi trạng thái lô, số lượng, quyền giữ hàng hay thu hồi. Quá hạn chỉ được tính, không tự leo thang.",
        )}
        actions={
          can("cases.write") && (
            <Button asChild size="sm">
              <Link href="/admin/cases/new">
                <Plus /> {tr("Tạo hồ sơ sự cố")}
              </Link>
            </Button>
          )
        }
      />
      <PageBody>
        <FilterBar
          active={!!(status || severity || overdue)}
          onReset={() => (setStatus(""), setSeverity(""), setOverdue(false))}
        >
          <FilterSelect
            label={tr("Trạng thái")}
            value={status}
            onChange={setStatus}
            options={[
              "OPEN",
              "ASSIGNED",
              "ACKNOWLEDGED",
              "RESPONDED",
              "ESCALATED",
              "CLOSED",
            ].map((v) => ({
              value: v,
              label: {
                OPEN: tr("Mới tiếp nhận"),
                ASSIGNED: tr("Đã giao"),
                ACKNOWLEDGED: tr("DN đã nhận"),
                RESPONDED: tr("DN đã phản hồi"),
                ESCALATED: "Leo thang",
                CLOSED: tr("Đã đóng"),
              }[v]!,
            }))}
          />
          <FilterSelect
            label={tr("Mức độ")}
            value={severity}
            onChange={setSeverity}
            options={[
              { value: "LOW", label: tr("Thấp") },
              { value: "MEDIUM", label: tr("Trung bình") },
              { value: "HIGH", label: "Cao" },
              { value: "CRITICAL", label: tr("Nghiêm trọng") },
            ]}
          />
          <div className="flex h-8 items-center gap-2 rounded-md border border-line bg-card px-2.5">
            <Checkbox
              id="overdue"
              checked={overdue}
              onCheckedChange={(v) => setOverdue(v === true)}
            />
            <Label htmlFor="overdue" className="text-[13px] font-normal">
              {tr("Chỉ quá hạn")}
            </Label>
          </div>
        </FilterBar>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={rows}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            columns={columns}
            rowKey={(c) => c.id}
            href={(c) => `/admin/cases/${c.id}`}
            pageSize={null}
            empty={<EmptyState title={tr("Không có hồ sơ phù hợp")} />}
            footer={
              q.hasNextPage ? (
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
                <span>{tr("Hết danh sách")}</span>
              )
            }
          />
        </div>
      </PageBody>
    </div>
  );
}
