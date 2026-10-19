"use client";

import { useMemo } from "react";
import type { Catalog } from "@/lib/catalog";
import { useWorkspaceData } from "@/lib/workspace";
import { StatusBadge } from "@/components/manage";

export type AdminProduct = Catalog["products"][number];
export type AdminOrganization = { id: string; name: string; type: string };

export const sharedCatalogId = "shared";
export const sharedCatalogName = "Danh mục dùng chung";

export const organizationTypeLabels: Record<string, string> = {
  FARM: "Sản xuất",
  TRANSPORTER: "Vận chuyển",
  DISTRIBUTOR: "Phân phối",
  RETAILER: "Bán lẻ",
  AUDITOR: "Kiểm định",
};

export function productSearchText(product: AdminProduct) {
  return `${product.productName} ${product.sku ?? ""} ${product.gtin ?? ""} ${product.variety ?? ""}`.toLocaleLowerCase(
    "vi",
  );
}

export function useAdminProducts() {
  const catalog = useWorkspaceData<Catalog>("/catalog");
  const organizations = useWorkspaceData<AdminOrganization[]>("/organizations");
  const sortedOrganizations = useMemo(
    () =>
      (organizations.data ?? [])
        .filter((organization) => organization.type !== "AUDITOR")
        .sort((a, b) => a.name.localeCompare(b.name, "vi")),
    [organizations.data],
  );
  return {
    products: catalog.data?.products ?? [],
    organizations: sortedOrganizations,
    loading: catalog.loading || organizations.loading,
    error: catalog.error || organizations.error,
    reload() {
      catalog.reload();
      organizations.reload();
    },
  };
}

export function ProductTable({ products }: { products: AdminProduct[] }) {
  return (
    <div className="manage-table-scroll">
      <table className="manage-table">
        <thead>
          <tr>
            <th scope="col">Sản phẩm</th>
            <th scope="col">Mã sản phẩm</th>
            <th scope="col">Giống / phân loại</th>
            <th scope="col">Đơn vị</th>
            <th scope="col">Cập nhật</th>
            <th scope="col">Trạng thái</th>
          </tr>
        </thead>
        <tbody>
          {products.map((product) => (
            <tr key={product.id}>
              <td data-label="Sản phẩm">
                <strong>{product.productName}</strong>
                {product.description && <small>{product.description}</small>}
              </td>
              <td data-label="Mã sản phẩm">
                {product.sku || product.gtin ? (
                  <>
                    {product.sku && <span>SKU: {product.sku}</span>}
                    {product.gtin && <small>GTIN: {product.gtin}</small>}
                  </>
                ) : (
                  "—"
                )}
              </td>
              <td data-label="Giống / phân loại">{product.variety || "—"}</td>
              <td data-label="Đơn vị">{product.defaultUnit || "—"}</td>
              <td data-label="Cập nhật">
                {new Intl.DateTimeFormat("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                }).format(new Date(product.updatedAt))}
              </td>
              <td data-label="Trạng thái">
                <StatusBadge value={product.status} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
