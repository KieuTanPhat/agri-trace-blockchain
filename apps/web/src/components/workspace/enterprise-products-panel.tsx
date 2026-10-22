"use client";
import { Input } from "@/components/ui/input";
import { useState } from "react";
import {
  ProductTable,
  productSearchText,
  useAdminProducts,
} from "./admin-products";

import { EmptyState, LoadState, ReloadButton } from "@/components/manage";

export function EnterpriseProductsPanel({
  organizationId,
}: {
  organizationId: string;
}) {
  const data = useAdminProducts();
  const [query, setQuery] = useState("");
  const owned = data.products.filter(
    (row) => row.organizationId === organizationId,
  );
  const rows = owned.filter((row) =>
    productSearchText(row).includes(query.trim().toLocaleLowerCase("vi")),
  );
  return (
    <section className="manage-section">
      <h2>Sản phẩm doanh nghiệp</h2>
      <p>Danh mục do doanh nghiệp quản lý. Quản trị viên chỉ xem.</p>
      <LoadState {...data} />
      <div className="manage-filter-bar">
        <label className="field">
          Tìm sản phẩm
          <Input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Tên, SKU, GTIN hoặc giống"
          />
        </label>
        <ReloadButton onClick={data.reload} />
      </div>
      {!data.loading &&
        !data.error &&
        (rows.length ? (
          <ProductTable products={rows} />
        ) : (
          <EmptyState
            title="Chưa tìm thấy sản phẩm"
            description={
              owned.length
                ? "Thử từ khóa khác."
                : "Doanh nghiệp chưa tạo sản phẩm trong danh mục riêng."
            }
          />
        ))}
    </section>
  );
}
