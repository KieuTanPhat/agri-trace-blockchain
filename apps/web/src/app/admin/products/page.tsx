"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

import Link from "next/link";
import { useState } from "react";
import {
  organizationTypeLabels,
  productSearchText,
  sharedCatalogId,
  sharedCatalogName,
  useAdminProducts,
} from "@/components/workspace/admin-products";

import {
  EmptyState,
  LoadState,
  PageHeader,
  ReloadButton,
} from "@/components/manage";

const filters = [
  { value: "", label: "Tất cả" },
  { value: "HAS", label: "Đã có sản phẩm" },
  { value: "NONE", label: "Chưa có sản phẩm" },
];

export default function AdminProductsPage() {
  const data = useAdminProducts();
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("");
  const needle = query.trim().toLocaleLowerCase("vi");

  const entries = data.organizations.map((organization) => {
    const products = data.products.filter(
      (product) => product.organizationId === organization.id,
    );
    return {
      organization,
      total: products.length,
      active: products.filter((product) => product.status === "ACTIVE").length,
      matches: needle
        ? products.filter((product) =>
            productSearchText(product).includes(needle),
          )
        : [],
    };
  });
  const sharedProducts = data.products.filter(
    (product) => !product.organizationId,
  );
  const rows = entries
    .filter(
      (entry) =>
        (filter === "HAS"
          ? entry.total > 0
          : filter === "NONE"
            ? entry.total === 0
            : true) &&
        (!needle ||
          entry.organization.name.toLocaleLowerCase("vi").includes(needle) ||
          entry.matches.length > 0),
    )
    .sort(
      (a, b) =>
        b.total - a.total ||
        a.organization.name.localeCompare(b.organization.name, "vi"),
    );
  const showShared =
    filter !== "NONE" &&
    (!needle ||
      sharedCatalogName.toLocaleLowerCase("vi").includes(needle) ||
      sharedProducts.some((product) =>
        productSearchText(product).includes(needle),
      ));
  const withProducts = entries.filter((entry) => entry.total > 0).length;
  const enterpriseProducts = data.products.length - sharedProducts.length;
  const metrics = [
    {
      label: "Doanh nghiệp",
      value: entries.length,
      hint: "Không gồm đơn vị kiểm định",
    },
    {
      label: "Đã có sản phẩm",
      value: withProducts,
      hint: `${entries.length - withProducts} doanh nghiệp chưa tạo sản phẩm`,
    },
    {
      label: "Sản phẩm doanh nghiệp",
      value: enterpriseProducts,
      hint: "Do doanh nghiệp tự tạo",
    },
    {
      label: "Danh mục dùng chung",
      value: sharedProducts.length,
      hint: "Không thuộc riêng doanh nghiệp nào",
    },
  ];
  const resultCount = rows.length + (showShared ? 1 : 0);

  return (
    <div className="manage-console">
      <PageHeader
        title="Sản phẩm doanh nghiệp"
        description="Chọn một doanh nghiệp để xem danh sách sản phẩm của họ. Admin chỉ xem; việc tạo và quản lý sản phẩm do doanh nghiệp thực hiện."
        back="/admin"
      />
      <LoadState loading={data.loading} error={data.error} />
      {!data.loading && !data.error && (
        <div className="manage-metrics" aria-label="Thống kê sản phẩm">
          {metrics.map((metric) => (
            <div className="manage-metric" key={metric.label}>
              <span>{metric.label}</span>
              <strong>{metric.value}</strong>
              <small>{metric.hint}</small>
            </div>
          ))}
        </div>
      )}
      <section className="manage-section" aria-label="Doanh nghiệp và sản phẩm">
        <div className="manage-filter-bar">
          <div className="manage-search-field">

            <Input
              aria-label="Tìm doanh nghiệp hoặc sản phẩm"
              placeholder="Tìm tên doanh nghiệp, sản phẩm, SKU hoặc GTIN"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
            {query && (
              <Button
                type="button"
                aria-label="Xóa từ khóa tìm kiếm"
                onClick={() => setQuery("")}
              >

              </Button>
            )}
          </div>
          <ReloadButton onClick={data.reload} />
        </div>
        <div
          className="manage-filter-tabs"
          role="group"
          aria-label="Lọc doanh nghiệp theo sản phẩm"
        >
          {filters.map((entry) => (
            <Button
              type="button"
              key={entry.value}
              aria-pressed={filter === entry.value}
              onClick={() => setFilter(entry.value)}
            >
              {entry.label}
            </Button>
          ))}
        </div>
        <div className="manage-results-summary" role="status">
          {data.loading ? "Đang tải…" : `${resultCount} mục phù hợp · Chỉ xem`}
        </div>
        {!data.loading &&
          !data.error &&
          (resultCount ? (
            <div className="manage-table-scroll">
              <Table className="manage-table">
                <TableHeader>
                  <TableRow>
                    <TableHead scope="col">Doanh nghiệp</TableHead>
                    <TableHead scope="col">Lĩnh vực</TableHead>
                    <TableHead scope="col">Sản phẩm</TableHead>
                    <TableHead scope="col">Đang hoạt động</TableHead>
                    <TableHead scope="col">
                      <span className="sr-only">Thao tác</span>
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map(({ organization, total, active, matches }) => (
                    <TableRow key={organization.id}>
                      <TableCell data-label="Doanh nghiệp">
                        <strong>{organization.name}</strong>
                        {matches.length > 0 && (
                          <small>
                            Khớp:{" "}
                            {matches
                              .slice(0, 3)
                              .map((product) => product.productName)
                              .join(", ")}
                            {matches.length > 3 &&
                              ` và ${matches.length - 3} sản phẩm khác`}
                          </small>
                        )}
                      </TableCell>
                      <TableCell data-label="Lĩnh vực">
                        {organizationTypeLabels[organization.type] ??
                          organization.type}
                      </TableCell>
                      <TableCell data-label="Sản phẩm">
                        {total || <span className="manage-muted">Chưa có</span>}
                      </TableCell>
                      <TableCell data-label="Đang hoạt động">
                        {total ? active : "—"}
                      </TableCell>
                      <TableCell data-label="Thao tác">
                        <Link
                          className="manage-row-link"
                          href={`/admin/products/${organization.id}`}
                        >
                          Xem sản phẩm
                        </Link>
                      </TableCell>
                    </TableRow>
                  ))}
                  {showShared && (
                    <TableRow>
                      <TableCell data-label="Doanh nghiệp">
                        <strong>{sharedCatalogName}</strong>
                        <small>
                          Sản phẩm tham chiếu, không thuộc doanh nghiệp nào
                        </small>
                      </TableCell>
                      <TableCell data-label="Lĩnh vực">—</TableCell>
                      <TableCell data-label="Sản phẩm">
                        {sharedProducts.length || (
                          <span className="manage-muted">Chưa có</span>
                        )}
                      </TableCell>
                      <TableCell data-label="Đang hoạt động">
                        {sharedProducts.length
                          ? sharedProducts.filter(
                              (product) => product.status === "ACTIVE",
                            ).length
                          : "—"}
                      </TableCell>
                      <TableCell data-label="Thao tác">
                        <Link
                          className="manage-row-link"
                          href={`/admin/products/${sharedCatalogId}`}
                        >
                          Xem sản phẩm
                        </Link>
                      </TableCell>
                    </TableRow>
                  )}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState
              title="Không tìm thấy kết quả"
              description="Thử tên doanh nghiệp, tên sản phẩm hoặc bộ lọc khác."
            />
          ))}
      </section>
    </div>
  );
}
