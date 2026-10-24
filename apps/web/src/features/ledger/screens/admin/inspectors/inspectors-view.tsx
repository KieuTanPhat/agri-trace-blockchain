"use client";
import Link from "next/link";
import { useState } from "react";
import { api } from "@/lib/ledger/platform-api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { t } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import { DataTable } from "@/components/ledger/kit/data-table";
import { FilterBar, FilterSelect } from "@/components/ledger/kit/filters";
import { EmptyState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
export function InspectorsView() {
  const users = useLedgerQuery({
      queryKey: ["users"],
      queryFn: api.users.list,
    }),
    orgs = useLedgerQuery({
      queryKey: ["organizations"],
      queryFn: api.enterprises.organizations,
    }),
    assignments = useLedgerQuery({
      queryKey: ["compliance-assignments"],
      queryFn: api.governance.assignments,
    });
  const [search, setSearch] = useState(""),
    [orgId, setOrgId] = useState("");
  return (
    <>
      <PageHeader
        title={t("Người kiểm định")}
        description={t(
          "Tài khoản kiểm định độc lập, tổ chức kiểm định và các vùng trồng được phân công.",
        )}
        actions={
          <Button asChild size="sm">
            <Link href="/admin/compliance-assignments/new">
              {t("Phân công mới")}
            </Link>
          </Button>
        }
      />
      <PageBody>
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder={t("Tên hoặc email")}
          active={!!(search || orgId)}
          onReset={() => {
            setSearch("");
            setOrgId("");
          }}
        >
          <FilterSelect
            label={t("Tổ chức kiểm định")}
            value={orgId}
            onChange={setOrgId}
            options={(orgs.data ?? [])
              .filter((o) => o.type === "AUDITOR")
              .map((o) => ({ value: o.id, label: o.name }))}
          />
        </FilterBar>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <DataTable
            rows={users.data?.filter(
              (u) =>
                ["AUDITOR", "COMPLIANCE_REVIEWER"].includes(u.role.code) &&
                (!orgId || u.organization?.id === orgId) &&
                `${u.fullName} ${u.email}`
                  .toLowerCase()
                  .includes(search.toLowerCase()),
            )}
            loading={users.isLoading || assignments.isLoading || orgs.isLoading}
            error={users.error ?? assignments.error ?? orgs.error}
            onRetry={() => {
              void users.refetch();
              void orgs.refetch();
              void assignments.refetch();
            }}
            rowKey={(u) => u.id}
            href={(u) => `/admin/users/${u.id}`}
            columns={[
              {
                key: "name",
                header: t("Người kiểm định"),
                cell: (u) => (
                  <div className="flex flex-col">
                    <span className="font-medium">{u.fullName}</span>
                    <span className="text-[12px] text-ink-2">{u.email}</span>
                  </div>
                ),
              },
              {
                key: "org",
                header: t("Tổ chức"),
                cell: (u) => u.organization?.name ?? "—",
              },
              {
                key: "role",
                header: t("Vai trò"),
                cell: (u) => (
                  <span className="font-mono text-[12px]">{u.role.code}</span>
                ),
              },
              {
                key: "status",
                header: t("Trạng thái"),
                cell: (u) => <Status group="account" value={u.accountStatus} />,
              },
              {
                key: "assignments",
                header: t("Phân công đang hiệu lực"),
                cell: (u) => (
                  <Link
                    className="text-brand"
                    href="/admin/compliance-assignments"
                  >
                    {assignments.data?.filter(
                      (a) => a.reviewerUserId === u.id && !a.revokedAt,
                    ).length ?? "—"}
                  </Link>
                ),
              },
            ]}
            empty={<EmptyState title={t("Chưa có người kiểm định")} />}
          />
        </div>
      </PageBody>
    </>
  );
}
