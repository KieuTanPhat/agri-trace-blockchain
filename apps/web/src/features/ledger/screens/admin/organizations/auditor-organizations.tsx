"use client";
import { api } from "@/lib/ledger/platform-api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { DataTable } from "@/components/ledger/kit/data-table";
import { EmptyState } from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
import { t } from "@/lib/ledger/i18n";
export function AuditorOrganizations() {
  const q = useLedgerQuery({
    queryKey: ["organizations"],
    queryFn: api.enterprises.organizations,
  });
  return (
    <div className="overflow-hidden rounded-md border border-line bg-card">
      <DataTable
        rows={q.data?.filter((o) => o.type === "AUDITOR")}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => q.refetch()}
        rowKey={(o) => o.id}
        href={(o) => `/admin/organizations?organizationId=${o.id}`}
        columns={[
          {
            key: "name",
            header: t("Tên tổ chức"),
            sort: (o) => o.name,
            cell: (o) => <span className="font-medium">{o.name}</span>,
          },
          {
            key: "status",
            header: t("Trạng thái"),
            cell: (o) => <Status group="org" value={o.status} />,
          },
          {
            key: "version",
            header: t("Phiên bản"),
            cell: (o) => (
              <span className="font-mono text-[12px]">{o.version ?? "—"}</span>
            ),
          },
        ]}
        empty={<EmptyState title={t("Chưa có tổ chức kiểm định")} />}
      />
    </div>
  );
}
