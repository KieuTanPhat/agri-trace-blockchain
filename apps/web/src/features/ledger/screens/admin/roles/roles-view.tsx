"use client";
import { api } from "@/lib/ledger/platform-api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { t } from "@/lib/ledger/i18n";
import { DataTable } from "@/components/ledger/kit/data-table";
import {
  Callout,
  EmptyState,
  PageBody,
  PageHeader,
} from "@/components/ledger/kit/page";
export function RolesView() {
  const q = useLedgerQuery({ queryKey: ["roles"], queryFn: api.users.roles });
  return (
    <>
      <PageHeader
        title={t("Vai trò nền tảng")}
        description={t(
          "Vai trò được cấp khi tạo tài khoản. Quyền và phạm vi của doanh nghiệp được quản lý trong không gian doanh nghiệp.",
        )}
      />
      <PageBody>
        <Callout>
          {t(
            "Tài khoản quản trị nền tảng không có quyền ghi nghiệp vụ doanh nghiệp. Tài khoản hiện hữu không có thao tác đổi vai trò.",
          )}
        </Callout>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={q.data}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => q.refetch()}
            rowKey={(r) => r.id}
            columns={[
              {
                key: "name",
                header: t("Vai trò"),
                cell: (r) => <span className="font-medium">{r.name}</span>,
              },
              {
                key: "code",
                header: t("Mã vai trò"),
                cell: (r) => (
                  <span className="font-mono text-[12px]">{r.code}</span>
                ),
              },
              {
                key: "description",
                header: t("Mô tả"),
                cell: (r) => (
                  <span className="text-ink-2">{r.description ?? "—"}</span>
                ),
              },
            ]}
            empty={<EmptyState title={t("Không có vai trò")} />}
          />
        </div>
      </PageBody>
    </>
  );
}
