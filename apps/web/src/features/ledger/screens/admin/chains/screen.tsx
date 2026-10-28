"use client";

import Link from "next/link";
import { useState } from "react";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { api } from "@/lib/ledger/operations-api";
import type { ChainItem } from "@/lib/ledger/operations-types";
import { fmtDate } from "@/lib/ledger/format";
import { CAPABILITY_LABEL } from "@/lib/ledger/labels";
import { DataTable, type Column } from "@/components/ledger/kit/data-table";
import { FilterBar } from "@/components/ledger/kit/filters";
import { Guard } from "@/components/ledger/kit/guard";
import { PageBody, PageHeader, ReadOnlyNote } from "@/components/ledger/kit/page";
import { Badge, Status } from "@/components/ledger/kit/status";

import { t as tr } from "@/lib/ledger/i18n";
function ChainsPage() {
  return (
    <Guard permission="chains.read">
      <Chains />
    </Guard>
  );
}

function Chains() {
  const q = useQuery({ queryKey: ["platform-chains"], queryFn: api.chains });
  const [search, setSearch] = useState("");
  const needle = search.toLowerCase();
  const rows = q.data?.filter(c => !needle || `${c.name} ${c.code} ${c.ownerName}`.toLowerCase().includes(needle));
  const columns: Column<ChainItem>[] = [
    {
      key: "name",
      header: tr("Chuỗi"),
      sort: (c) => c.name,
      cell: (c) => (
        <div className="flex flex-col">
          <span className="font-medium">{c.name}</span>
          <span className="font-mono text-[11.5px] text-ink-2">{c.code}</span>
        </div>
      ),
    },
    {
      key: "owner",
      header: tr("Chủ chuỗi"),
      cell: (c) => (
        <Link className="text-brand hover:underline" href={`/admin/directory/${c.ownerId}`} onClick={(e) => e.stopPropagation()}>
          {c.ownerName}
        </Link>
      ),
    },
    { key: "roles", header: tr("Vai trong chuỗi"), hideBelow: "lg", cell: (c) => <span className="text-[12px] text-ink-2">{c.roles.map((r) => CAPABILITY_LABEL[r] ?? r).join(" · ")}</span> },
    { key: "members", header: tr("Thành viên"), sort: (c) => c.members, cell: (c) => <span className="font-mono text-[12px]">{c.members}{c.invited ? <span className="text-ink-2"> +{c.invited} {tr("mời")}</span> : null}</span> },
    { key: "act", header: tr("Vụ / Chế biến / Đang chuyển"), hideBelow: "md", cell: (c) => <span className="font-mono text-[12px]">{c.cycles} / {c.processingRuns} / {c.openTransfers}</span> },
    { key: "ledger", header: tr("Sổ cái"), cell: (c) => (c.ledgerBound ? <Badge tone="ok">{tr("Đã gắn binding")}</Badge> : <Badge tone="warn">{tr("Chưa gắn")}</Badge>) },
    { key: "state", header: tr("Hồ sơ nghiệp vụ"), cell: (c) => <Status group="chain" value={c.state} /> },
    { key: "created", header: tr("Tạo"), hideBelow: "lg", sort: (c) => c.createdAt, cell: (c) => <span className="font-mono text-[12px]">{fmtDate(c.createdAt)}</span> },
  ];
  return (
    <>
      <PageHeader title={tr("Chuỗi cung ứng")} description={tr("Toàn cảnh các chuỗi do doanh nghiệp vận hành. Nền tảng điều phối, không ghi vụ, lô hay giao nhận thay doanh nghiệp.")} />
      <PageBody>
        <ReadOnlyNote>
          <span className="font-mono">GET /platform-admin/chains</span> {tr("chỉ đọc. Kích hoạt/tạm dừng hồ sơ nghiệp vụ chuỗi là quyền của doanh nghiệp chủ chuỗi (supply-chains), không thuộc khu quản trị nền tảng.")}
        </ReadOnlyNote>
        <div className="overflow-hidden rounded-md border border-line bg-card">
          <div className="border-b border-line/70 px-4 py-2.5 sm:px-5">
            <FilterBar search={search} onSearch={setSearch} placeholder={tr("Tìm tên chuỗi, mã hoặc chủ chuỗi")} active={!!search} onReset={() => setSearch("")} />
          </div>
          <DataTable rows={rows} loading={q.isLoading} error={q.error} onRetry={() => q.refetch()} columns={columns} rowKey={(c) => c.id} minWidth={900} />
        </div>
      </PageBody>
    </>
  );
}

import type{LedgerScreenProps}from"@/lib/ledger/route-input";
import{LedgerRouteScreen}from"@/components/ledger/route-screen";
import{useLocale}from"@/components/ledger/locale";
export default function LedgerScreen({route}:LedgerScreenProps){useLocale();return <LedgerRouteScreen route={route} name="admin-chains"><ChainsPage/></LedgerRouteScreen>;}
