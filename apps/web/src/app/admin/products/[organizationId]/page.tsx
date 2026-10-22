"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useParams } from "next/navigation";
import { useState } from "react";
import {
  ProductTable,
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
  { value: "ACTIVE", label: "Đang hoạt động" },
  { value: "INACTIVE", label: "Ngừng hoạt động" },
];

export default function AdminOrganizationProductsPage() {
  const { organizationId } = useParams<{ organizationId: string }>();
  const data = useAdminProducts();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const shared = organizationId === sharedCatalogId;
  const organization = data.organizations.find(
    (entry) => entry.id === organizationId,
  );
  const known = shared || !!organization;
  const owned = data.products.filter((product) =>
    shared
      ? !product.organizationId
      : product.organizationId === organizationId,
  );
  const needle = query.trim().toLocaleLowerCase("vi");
  const rows = owned.filter(
    (product) =>
      (!status || product.status === status) &&
      productSearchText(product).includes(needle),
  );
  const title = shared
    ? sharedCatalogName
    : (organization?.name ?? "Doanh nghiệp");
  const active = owned.filter((product) => product.status === "ACTIVE").length;
  const metrics = [
    {
      label: "Tổng sản phẩm",
      value: owned.length,
      hint: "Đã ghi trong hệ thống",
    },
    {
      label: "Đang hoạt động",
      value: active,
      hint: "Có thể dùng cho vụ và lô",
    },
    {
      label: "Ngừng hoạt động",
      value: owned.length - active,
      hint: "Giữ lại để tra cứu lịch sử",
    },
  ];

  return (
    <div className="manage-console">
      <PageHeader
        title={data.loading ? "Sản phẩm doanh nghiệp" : title}
        description={
          shared
            ? "Sản phẩm không thuộc riêng doanh nghiệp nào, dùng làm danh mục tham chiếu. Chỉ xem."
            : `${organization ? (organizationTypeLabels[organization.type] ?? organization.type) : "Doanh nghiệp"} · Sản phẩm do doanh nghiệp tự tạo và quản lý. Admin chỉ xem.`
        }
        back="/admin/products"
      />
      <LoadState loading={data.loading} error={data.error} />
      {!data.loading && !data.error && !known && (
        <EmptyState
          title="Không tìm thấy doanh nghiệp"
          description="Doanh nghiệp không tồn tại hoặc không còn trong danh sách. Quay lại để chọn doanh nghiệp khác."
        />
      )}
      {!data.loading && !data.error && known && (
        <>
          <div
            className="manage-metrics manage-metrics--three"
            aria-label="Thống kê sản phẩm"
          >
            {metrics.map((metric) => (
              <div className="manage-metric" key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
                <small>{metric.hint}</small>
              </div>
            ))}
          </div>
          <section
            className="manage-section"
            aria-label={`Sản phẩm của ${title}`}
          >
            <div className="manage-filter-bar">
              <div className="manage-search-field">

                <Input
                  aria-label="Tìm sản phẩm theo tên, mã hoặc giống"
                  placeholder="Tìm tên, SKU, GTIN hoặc giống"
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
              aria-label="Lọc trạng thái sản phẩm"
            >
              {filters.map((filter) => (
                <Button
                  type="button"
                  key={filter.value}
                  aria-pressed={status === filter.value}
                  onClick={() => setStatus(filter.value)}
                >
                  {filter.label}
                </Button>
              ))}
            </div>
            <div className="manage-results-summary" role="status">
              {rows.length} / {owned.length} sản phẩm · Chỉ xem
            </div>
            {rows.length ? (
              <ProductTable products={rows} />
            ) : (
              <EmptyState
                title={
                  owned.length ? "Không tìm thấy sản phẩm" : "Chưa có sản phẩm"
                }
                description={
                  owned.length
                    ? "Thử từ khóa khác hoặc chọn lại trạng thái."
                    : "Doanh nghiệp này chưa tạo sản phẩm nào. Sản phẩm xuất hiện tại đây sau khi doanh nghiệp tạo trong không gian quản lý của họ."
                }
              />
            )}
          </section>
        </>
      )}
    </div>
  );
}
