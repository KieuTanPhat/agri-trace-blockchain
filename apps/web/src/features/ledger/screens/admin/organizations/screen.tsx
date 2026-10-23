"use client";

import Link from "next/link";
import { Button } from "@/components/ledger/ui/button";
import { useLedgerSearchParams } from "@/components/ledger/route-screen";
import { OrganizationDetailView } from "./organization-detail";
import { AuditorOrganizations } from "./auditor-organizations";
import { useState } from "react";
import {
  keepPreviousData,
  useLedgerQuery as useQuery,
} from "@/lib/ledger/data";
import { api } from "@/lib/ledger/platform-api";
import type { DirectoryItem } from "@/lib/ledger/platform-api";
import { fmtDate } from "@/lib/ledger/format";
import { CAPABILITY_LABEL, MODEL_LABEL } from "@/lib/ledger/labels";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import {
  FilterBar,
  FilterSelect,
  useDebounced,
} from "@/components/ledger/kit/filters";
import { Guard } from "@/components/ledger/kit/guard";
import { EmptyState, PageBody, PageHeader } from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
function PreviewScreen() {
  const id = useLedgerSearchParams().get("organizationId");
  return (
    <Guard permission="directory.read">
      {id ? <OrganizationDetailView id={id} /> : <Directory />}
    </Guard>
  );
}

function Directory() {
  const [auditors, setAuditors] = useState(false);
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [model, setModel] = useState("");
  const [capability, setCapability] = useState("");
  const [plan, setPlan] = useState("");
  const dq = useDebounced(q);
  const filters = {
    q: dq || undefined,
    status: status || undefined,
    model: model || undefined,
    capability: capability || undefined,
    plan: plan || undefined,
  };
  const query = useQuery({
    queryKey: ["directory", filters],
    queryFn: () => api.enterprises.directory(filters),
    enabled: !auditors,
    placeholderData: keepPreviousData,
  });
  const active = !!(q || status || model || capability || plan);

  const columns: Column<DirectoryItem>[] = [
    {
      key: "name",
      header: tr("Tổ chức"),
      sort: (o) => o.name,
      cell: (o) => (
        <div className="flex min-w-0 flex-col">
          <span className="truncate font-medium">{o.name}</span>
          <span className="text-[11.5px] text-ink-2">
            {o.province ?? "—"} ·{" "}
            {o.participationModel ? MODEL_LABEL[o.participationModel] : "—"}
          </span>
        </div>
      ),
    },
    {
      key: "caps",
      header: tr("Năng lực"),
      cell: (o) => (
        <div className="flex flex-wrap gap-1 text-[11.5px]">
          {o.capabilities.map((c) => (
            <span key={c} className="rounded-sm bg-sunken px-1.5 py-0.5">
              {CAPABILITY_LABEL[c] ?? c}
            </span>
          ))}
          {o.pendingCapabilities.map((c) => (
            <span
              key={`p-${c}`}
              className="rounded-sm bg-info-bg px-1.5 py-0.5 text-info"
              title={tr("Đang chờ xét")}
            >
              +{CAPABILITY_LABEL[c] ?? c}
            </span>
          ))}
          {!o.capabilities.length && !o.pendingCapabilities.length && (
            <span className="text-ink-2">—</span>
          )}
        </div>
      ),
    },
    {
      key: "stage",
      header: tr("Giai đoạn"),
      hideBelow: "md",
      cell: (o) => <Status group="enrollment" value={o.stage} />,
    },
    {
      key: "plan",
      header: tr("Gói"),
      hideBelow: "lg",
      sort: (o) => o.endsAt ?? "",
      cell: (o) =>
        o.subscriptionStatus ? (
          <div className="flex flex-col gap-0.5">
            <Status group="subscription" value={o.subscriptionStatus} />
            <span className="text-[11.5px] text-ink-2">
              {o.planName} {tr("· đến")} {fmtDate(o.endsAt)}
            </span>
          </div>
        ) : (
          <span className="text-ink-2">—</span>
        ),
    },
    {
      key: "members",
      header: tr("Thành viên"),
      hideBelow: "lg",
      sort: (o) => o.members,
      cell: (o) => <span className="font-mono text-[12px]">{o.members}</span>,
    },
    {
      key: "chains",
      header: tr("Chuỗi"),
      hideBelow: "lg",
      cell: (o) => (
        <span className="font-mono text-[12px]">
          {o.ownedChains} {tr("sở hữu")}
        </span>
      ),
    },
    {
      key: "status",
      header: tr("Trạng thái"),
      cell: (o) => <Status group="org" value={o.status} />,
    },
  ];

  return (
    <>
      <PageHeader
        title={tr("Danh bạ tổ chức")}
        description={tr("Danh bạ tổ chức, năng lực và trạng thái dịch vụ.")}
        actions={
          <Button asChild size="sm">
            <Link href="/admin/organizations/new">
              {tr("Tạo tổ chức kiểm định")}
            </Link>
          </Button>
        }
      />
      <PageBody>
        <div className="flex gap-2">
          <Button
            variant={auditors ? "outline" : "default"}
            onClick={() => setAuditors(false)}
          >
            {tr("Doanh nghiệp")}
          </Button>
          <Button
            variant={auditors ? "default" : "outline"}
            onClick={() => setAuditors(true)}
          >
            {tr("Tổ chức kiểm định")}
          </Button>
        </div>
        {auditors ? (
          <AuditorOrganizations />
        ) : (
          <>
            <FilterBar
              search={q}
              onSearch={setQ}
              placeholder={tr("Tìm theo tên tổ chức")}
              active={active}
              onReset={() => {
                setQ("");
                setStatus("");
                setModel("");
                setCapability("");
                setPlan("");
              }}
            >
              <FilterSelect
                label={tr("Trạng thái")}
                value={status}
                onChange={setStatus}
                options={[
                  { value: "ACTIVE", label: tr("Hoạt động") },
                  { value: "INACTIVE", label: tr("Ngừng hoạt động") },
                ]}
              />
              <FilterSelect
                label={tr("Mô hình")}
                value={model}
                onChange={setModel}
                options={Object.entries(MODEL_LABEL)
                  .filter(([k]) => k !== "NONE")
                  .map(([value, label]) => ({ value, label }))}
              />
              <FilterSelect
                label={tr("Năng lực")}
                value={capability}
                onChange={setCapability}
                options={[
                  "FARM",
                  "TRANSPORTER",
                  "PROCESSOR",
                  "DISTRIBUTOR",
                  "RETAILER",
                ].map((v) => ({ value: v, label: CAPABILITY_LABEL[v] }))}
              />
              <FilterSelect
                label={tr("Gói")}
                value={plan}
                onChange={setPlan}
                options={[
                  { value: "ACTIVE", label: tr("Hiệu lực") },
                  { value: "GRACE", label: tr("Ân hạn") },
                  { value: "RESTRICTED", label: tr("Bị hạn chế") },
                  { value: "PENDING_PAYMENT", label: tr("Chờ thanh toán") },
                ]}
              />
            </FilterBar>
            <div className="overflow-hidden rounded-md border border-line bg-card">
              <DataTable
                rows={query.data}
                loading={query.isLoading}
                error={query.error}
                onRetry={() => query.refetch()}
                columns={columns}
                rowKey={(o) => o.id}
                href={(o) => `/admin/organizations?organizationId=${o.id}`}
                empty={
                  <EmptyState title={tr("Không có tổ chức phù hợp")}>
                    {tr("Thử bỏ bớt điều kiện lọc.")}
                  </EmptyState>
                }
              />
            </div>
          </>
        )}
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
    <LedgerRouteScreen route={route} name="admin-organizations">
      <PreviewScreen />
    </LedgerRouteScreen>
  );
}
