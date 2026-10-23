"use client";

import { useState } from "react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { api } from "@/lib/ledger/platform-api";
import type { Amendment } from "@/lib/ledger/platform-api";
import { fmtAgo, fmtDateTime } from "@/lib/ledger/format";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { Guard } from "@/components/ledger/kit/guard";
import { EmptyState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";

import { t as tr } from "@/lib/ledger/i18n";
function PreviewScreen() {
  return (
    <Guard permission="amendment.read">
      <List />
    </Guard>
  );
}

function List() {
  const q = useQuery({
    queryKey: ["amendments"],
    queryFn: api.enterprises.amendments,
  });
  const [tab, setTab] = useState<"PENDING" | "ALL">("PENDING");
  const rows = q.data?.filter((a) => tab === "ALL" || a.status === "PENDING");
  const columns: Column<Amendment>[] = [
    {
      key: "org",
      header: tr("Tổ chức"),
      sort: (a) => a.organizationName ?? "",
      cell: (a) => <span className="font-medium">{a.organizationName}</span>,
    },
    {
      key: "reason",
      header: tr("Lý do doanh nghiệp nêu"),
      cell: (a) => <span className="line-clamp-1 text-ink-2">{a.reason}</span>,
    },
    {
      key: "ver",
      header: tr("Hồ sơ gốc"),
      hideBelow: "md",
      cell: (a) => (
        <span className="font-mono text-[12px]">
          profile v{a.profileVersion} · org v{a.organizationVersion}
        </span>
      ),
    },
    {
      key: "created",
      header: tr("Gửi lúc"),
      sort: (a) => a.createdAt,
      cell: (a) => (
        <span className="flex flex-col">
          <span className="font-mono text-[12px]">
            {fmtDateTime(a.createdAt)}
          </span>
          <span className="text-[11.5px] text-ink-2">
            {fmtAgo(a.createdAt)}
          </span>
        </span>
      ),
    },
    {
      key: "status",
      header: tr("Trạng thái"),
      cell: (a) => <Status group="request" value={a.status} />,
    },
  ];
  return (
    <>
      <PageHeader
        title={tr("Điều chỉnh hồ sơ doanh nghiệp")}
        description={tr(
          "Doanh nghiệp đề nghị đổi thông tin pháp lý; nền tảng so sánh với hồ sơ hiện hành và duyệt hoặc từ chối kèm lý do.",
        )}
      />
      <PageBody>
        <div className="flex gap-1">
          {(["PENDING", "ALL"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onClick={() => setTab(t)}
              className={cn(
                "h-8 rounded-md border px-3 text-[12.5px] font-medium",
                tab === t
                  ? "border-ink bg-ink text-canvas"
                  : "border-line bg-card",
              )}
            >
              {t === "PENDING" ? tr("Chờ xét") : tr("Tất cả")}
            </button>
          ))}
        </div>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={rows}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            columns={columns}
            rowKey={(a) => a.id}
            href={(a) => `/admin/enterprises/amendments/${a.id}`}
            empty={<EmptyState title={tr("Không có đề nghị chờ xét")} />}
          />
        </div>
      </PageBody>
    </>
  );
}

import type { LedgerScreenProps } from "@/lib/ledger/route-input";
import { LedgerRouteScreen } from "@/components/ledger/route-screen";
import { useLocale as useLedgerLocale } from "@/components/ledger/locale";
export default function LedgerScreen({ route }: LedgerScreenProps) {
  useLedgerLocale();
  return (
    <LedgerRouteScreen route={route} name="admin-enterprises-amendments">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
