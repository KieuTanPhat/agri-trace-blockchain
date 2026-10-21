import {
  mergeDirectoryItems,
  type ProductDetail,
  type EnterpriseDetail,
  type Page,
} from "../api/directory";
export type DetailSection =
  "enterprises" | "lots" | "products" | "certificates";
export type DirectoryDetail = ProductDetail | EnterpriseDetail;
function append<T extends { id: string }>(
  before: Page<T>,
  after: Page<T>,
): Page<T> {
  if (after.hasMore && before.nextCursor === after.nextCursor)
    throw new Error("Trang tiếp theo chưa hợp lệ.");
  return { ...after, items: mergeDirectoryItems(before.items, after.items) };
}
/** Network pages are capped at 50, but an explicitly expanded UI can hold more. */
export function mergeDirectoryDetail(
  before: DirectoryDetail,
  after: DirectoryDetail,
  section: DetailSection,
): DirectoryDetail {
  if (before.id !== after.id)
    throw new Error("Thông tin trả về không khớp mục đang xem.");
  if ("productName" in before && "productName" in after) {
    if (section === "enterprises")
      return {
        ...before,
        enterprises: append(before.enterprises, after.enterprises),
      };
    if (section === "lots")
      return { ...before, lots: append(before.lots, after.lots) };
  }
  if ("name" in before && "name" in after) {
    if (section === "products")
      return { ...before, products: append(before.products, after.products) };
    if (section === "certificates")
      return {
        ...before,
        certificates: append(before.certificates, after.certificates),
      };
  }
  throw new Error("Mục danh sách chưa hợp lệ.");
}
