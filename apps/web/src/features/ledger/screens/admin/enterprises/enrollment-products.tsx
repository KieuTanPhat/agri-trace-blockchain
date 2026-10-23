"use client";
import { useState } from "react";
import type { components } from "@/lib/generated/api";
import { api } from "@/lib/ledger/platform-api";
import { useLedgerQuery } from "@/lib/ledger/data";
import { t } from "@/lib/ledger/i18n";
import { DataTable } from "@/components/ledger/kit/data-table";
import { FilterBar } from "@/components/ledger/kit/filters";
import {
  EmptyState,
  Field,
  Fields,
  Section,
} from "@/components/ledger/kit/page";
import { Status } from "@/components/ledger/kit/status";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ledger/ui/sheet";
type Product = components["schemas"]["ProductRecordDto"];
export function EnrollmentProducts({
  organizationId,
}: {
  organizationId: string;
}) {
  const q = useLedgerQuery({
      queryKey: ["catalog"],
      queryFn: api.governance.catalog,
    }),
    orgs = useLedgerQuery({
      queryKey: ["organizations"],
      queryFn: api.enterprises.organizations,
    });
  const [search, setSearch] = useState(""),
    [selected, setSelected] = useState<Product | null>(null);
  const rows = q.data?.products.filter(
    (p) =>
      (p.organizationId === organizationId ||
        (!p.organizationId &&
          q.data.farms.some(
            (f) =>
              f.id === p.originFarmId && f.organizationId === organizationId,
          ))) &&
      `${p.productName} ${p.sku ?? ""} ${p.gtin ?? ""}`
        .toLowerCase()
        .includes(search.toLowerCase()),
  );
  const organization = orgs.data?.find((o) => o.id === organizationId)?.name;
  const more: [keyof Product, string][] = [
    ["sku", "SKU"],
    ["gtin", "GTIN"],
    ["category", "Nhóm sản phẩm"],
    ["defaultUnit", "Đơn vị"],
    ["description", "Mô tả"],
    ["ingredients", "Thành phần"],
    ["rawMaterials", "Nguyên liệu"],
    ["variety", "Giống"],
    ["price", "Giá khai báo"],
    ["storageConditions", "Bảo quản"],
    ["usageInstructions", "Hướng dẫn sử dụng"],
    ["carrier", "Đơn vị vận chuyển"],
    ["distributor", "Đơn vị phân phối"],
    ["exporter", "Đơn vị xuất khẩu"],
    ["importer", "Đơn vị nhập khẩu"],
    ["manufacturingSiteId", "Cơ sở sản xuất"],
    ["managerUserId", "Người quản lý"],
    ["originFarmId", "Vùng trồng gốc"],
    ["createdAt", "Tạo lúc"],
    ["updatedAt", "Cập nhật lúc"],
    ["version", "Phiên bản"],
  ];
  return (
    <Section title={t("Sản phẩm của tổ chức")} aside={organization}>
      <div className="p-4">
        <FilterBar
          search={search}
          onSearch={setSearch}
          placeholder={t("Tìm sản phẩm, SKU hoặc GTIN")}
          active={!!search}
          onReset={() => setSearch("")}
        />
      </div>
      <DataTable
        rows={rows}
        loading={q.isLoading || orgs.isLoading}
        error={q.error ?? orgs.error}
        onRetry={() => {
          void q.refetch();
          void orgs.refetch();
        }}
        rowKey={(p) => p.id}
        onRowClick={setSelected}
        minWidth={560}
        columns={[
          {
            key: "name",
            header: t("Sản phẩm"),
            sort: (p) => p.productName,
            cell: (p) => (
              <div className="flex flex-col gap-1">
                <span className="font-medium">{p.productName}</span>
                <span className="text-[12px] text-ink-2">{p.description}</span>
              </div>
            ),
          },
          {
            key: "code",
            header: "SKU / GTIN",
            cell: (p) => (
              <span className="font-mono text-[12px]">
                {p.sku ?? p.gtin ?? "—"}
              </span>
            ),
          },
          {
            key: "unit",
            header: t("Đơn vị"),
            cell: (p) => p.defaultUnit ?? "—",
          },
          {
            key: "status",
            header: t("Trạng thái"),
            cell: (p) => <Status group="product" value={p.status} />,
          },
        ]}
        empty={<EmptyState title={t("Chưa có sản phẩm")} />}
      />
      <Sheet
        open={!!selected}
        onOpenChange={(open) => {
          if (!open) setSelected(null);
        }}
      >
        <SheetContent className="w-full overflow-y-auto sm:max-w-xl">
          {selected && (
            <>
              <SheetHeader>
                <SheetTitle>{selected.productName}</SheetTitle>
                <SheetDescription>
                  {organization ?? t("Thông tin sản phẩm được phép truy cập")}
                </SheetDescription>
              </SheetHeader>
              <Fields>
                {more.map(([key, label]) => (
                  <Field key={key} label={t(label)}>
                    {selected[key] === undefined || selected[key] === null
                      ? "—"
                      : String(selected[key])}
                  </Field>
                ))}
              </Fields>
            </>
          )}
        </SheetContent>
      </Sheet>
    </Section>
  );
}
