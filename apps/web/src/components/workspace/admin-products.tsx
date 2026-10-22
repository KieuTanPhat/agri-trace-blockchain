"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";

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
      <Table className="manage-table">
        <TableHeader>
          <TableRow>
            <TableHead scope="col">Sản phẩm</TableHead>
            <TableHead scope="col">Mã sản phẩm</TableHead>
            <TableHead scope="col">Giống / phân loại</TableHead>
            <TableHead scope="col">Đơn vị</TableHead>
            <TableHead scope="col">Cập nhật</TableHead>
            <TableHead scope="col">Trạng thái</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {products.map((product) => (
            <TableRow key={product.id}>
              <TableCell data-label="Sản phẩm">
                <strong>{product.productName}</strong>
                {product.description && <small>{product.description}</small>}
              </TableCell>
              <TableCell data-label="Mã sản phẩm">
                {product.sku || product.gtin ? (
                  <>
                    {product.sku && <span>SKU: {product.sku}</span>}
                    {product.gtin && <small>GTIN: {product.gtin}</small>}
                  </>
                ) : (
                  "—"
                )}
              </TableCell>
              <TableCell data-label="Giống / phân loại">{product.variety || "—"}</TableCell>
              <TableCell data-label="Đơn vị">{product.defaultUnit || "—"}</TableCell>
              <TableCell data-label="Cập nhật">
                {new Intl.DateTimeFormat("vi-VN", {
                  timeZone: "Asia/Ho_Chi_Minh",
                  day: "2-digit",
                  month: "2-digit",
                  year: "numeric",
                }).format(new Date(product.updatedAt))}
              </TableCell>
              <TableCell data-label="Trạng thái">
                <StatusBadge value={product.status} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </Table>
    </div>
  );
}
