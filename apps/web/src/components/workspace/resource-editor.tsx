"use client";
import { Button } from "@/components/ui/button";

import { DataForm, type Field } from "@/components/data-form";
import { CommandState, LoadState, PageHeader } from "@/components/manage";
import {
  useWorkspaceCommand,
  useWorkspaceData,
  textValue,
  type Catalog,
  type EnterpriseRevision,
  type EnterpriseMember,
  type EnterpriseSite,
  type EnterpriseVehicle,
  type Items,
  type Overview,
  type ProductionMaterial,
} from "@/lib/workspace";
import { EvidencePanel } from "./evidence-panel";
import { ImageGallery, ImageUpload } from "./image-gallery";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Kind = "products" | "sites" | "vehicles" | "materials";
type Editable = Catalog["products"][number] | EnterpriseSite | EnterpriseVehicle | ProductionMaterial;
const fieldValue = (row: Editable, name: string) =>
  (row as Partial<Record<string, string | number | null>>)[name];

export function ResourceEditor({ id, kind }: { id: string; kind: Kind }) {
  const state = useWorkspaceData<Partial<Catalog> & Partial<Items<EnterpriseSite | EnterpriseVehicle | ProductionMaterial>>>(
    kind === "products" ? "/catalog" : `/enterprise-workspace/${kind}`,
  );
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const complete = useWorkspaceCommand();
  const row: Editable | undefined = (state.data?.items ?? state.data?.products)?.find((item) => item.id === id);
  const type = kind === "products" ? "PRODUCT" : kind === "sites" ? "SITE" : kind === "vehicles" ? "VEHICLE" : "MATERIAL";
  const history = useWorkspaceData<Items<EnterpriseRevision>>(`/enterprise-workspace/revisions/${type}/${id}`);
  const productSites = useWorkspaceData<Items<EnterpriseSite>>(kind === "products" ? "/enterprise-workspace/sites" : null);
  const productMembers = useWorkspaceData<Items<EnterpriseMember>>(kind === "products" || kind === "sites" ? "/enterprise-workspace/members" : null);
  const permission = kind === "products" ? "catalog.manage" : kind === "sites" ? "sites.manage" : kind === "vehicles" ? "vehicles.manage" : "materials.manage";
  const router = useRouter();
  const [imagesChanged, setImagesChanged] = useState(0);
  const products = kind === "products";
  const nest = kind === "products" ? "product" : kind === "sites" ? "site" : kind === "vehicles" ? "vehicle" : "material";

  const productFields: Field[] = [
    { name: "productName", label: "Tên sản phẩm", required: true, maxLength: 255 },
    { name: "description", label: "Mô tả sản phẩm", type: "textarea", className: "product-description-field", maxLength: 2000 },
    { name: "sku", label: "Mã SKU", required: true, maxLength: 100 },
    { name: "variety", label: "Giống / phân loại", maxLength: 255 },
    { name: "category", label: "Danh mục", required: true, maxLength: 100 },
    { name: "rawMaterials", label: "Nguyên liệu", maxLength: 2000 },
    { name: "originFarmId", label: "Vùng xuất xứ", required: true, options: (state.data?.farms ?? []).filter((farm) => farm.status === "ACTIVE" && farm.evidenceComplete).map((farm) => ({ value: farm.id, label: farm.name })) },
    { name: "manufacturingSiteId", label: "Nhà xưởng sản xuất", options: (productSites.data?.items ?? []).filter((site) => site.status === "ACTIVE").map((site) => ({ value: site.id, label: site.name })) },
    { name: "defaultUnit", label: "Đơn vị", required: true, maxLength: 30 },
    { name: "exporter", label: "Nhà xuất khẩu", maxLength: 255 },
    { name: "storageConditions", label: "Điều kiện bảo quản", required: true, maxLength: 2000 },
    { name: "importer", label: "Nhà nhập khẩu", maxLength: 255 },
    { name: "ingredients", label: "Thành phần", required: true, maxLength: 2000 },
    { name: "distributor", label: "Nhà phân phối", maxLength: 255 },
    { name: "usageInstructions", label: "Hướng dẫn sử dụng", required: true, maxLength: 2000 },
    { name: "carrier", label: "Nhà vận chuyển", maxLength: 255 },
    { name: "price", label: "Giá (nếu có)", type: "number", min: 0 },
    { name: "managerUserId", label: "Người quản lí", options: (productMembers.data?.items ?? []).filter((member) => member.accountStatus === "ACTIVE").map((member) => ({ value: member.id, label: member.fullName })) },
    { name: "gtin", label: "GTIN (nếu có)" },
  ];
  const siteFields: Field[] = [
    { name: "name", label: "Tên cơ sở", required: true, maxLength: 255 },
    { name: "kind", label: "Loại cơ sở", required: true, options: ["PRODUCTION", "PACKING", "WAREHOUSE", "COLD_STORAGE", "PROCESSING", "DISTRIBUTION", "RETAIL", "OTHER"].map((value) => ({ value, label: value })) },
    { name: "address", label: "Địa chỉ", required: true, minLength: 5, maxLength: 500 },
    { name: "region", label: "Tỉnh / thành phố", required: true, maxLength: 255 },
    { name: "ward", label: "Phường / xã", required: true, maxLength: 255 },
    { name: "areaM2", label: "Diện tích cơ sở (m²)", required: true, type: "number", min: 0.01 },
    { name: "coldAreaM2", label: "Diện tích kho lạnh (m²)", type: "number", min: 0.01 },
    { name: "capacityKg", label: "Sức chứa tối đa (kg)", type: "number", min: 0.001 },
    { name: "expectedOutputTons", label: "Sản lượng dự kiến (tấn/năm)", type: "number", min: 0.001 },
    { name: "manager", label: "Người quản lý", maxLength: 255 },
    { name: "staffUserId", label: "Nhân viên phụ trách", options: (productMembers.data?.items ?? []).filter((member) => member.accountStatus === "ACTIVE").map((member) => ({ value: member.id, label: member.fullName })) },
    { name: "representative", label: "Người đại diện", maxLength: 255 },
    { name: "phone", label: "Điện thoại", maxLength: 30 },
    { name: "email", label: "Email", type: "email", maxLength: 255 },
    { name: "otherInfo", label: "Thông tin khác", maxLength: 2000 },
  ];
  const vehicleFields: Field[] = [
    { name: "registration", label: "Biển số / mã phương tiện", required: true, maxLength: 40 },
    { name: "kind", label: "Loại phương tiện", required: true, maxLength: 100 },
  ];
  const materialFields: Field[] = [
    { name: "code", label: "Mã đầu vào", required: true, maxLength: 100 },
    { name: "name", label: "Tên", required: true, maxLength: 255 },
    { name: "kind", label: "Loại", required: true, options: ["SEED", "FERTILIZER", "PROTECTION", "OTHER"].map((value) => ({ value, label: value })) },
    { name: "seedType", label: "Loại giống", requiredWhen: { field: "kind", value: "SEED" }, maxLength: 100 },
    { name: "unit", label: "Đơn vị", required: true, options: ["kg", "lít", "gói", "chai", "khác"].map((value) => ({ value, label: value })) },
    { name: "price", label: "Giá (nếu có)", type: "number", min: 0 },
    { name: "origin", label: "Xuất xứ", maxLength: 255 },
    { name: "manufacturer", label: "Nhà sản xuất", maxLength: 255 },
    { name: "supplier", label: "Nhà cung cấp", maxLength: 255 },
    { name: "description", label: "Mô tả", maxLength: 2000 },
    { name: "batchCode", label: "Lô đầu vào", maxLength: 100 },
    { name: "activeIngredient", label: "Thành phần / hoạt chất", maxLength: 255 },
    { name: "withdrawalDays", label: "Cách ly khai báo (ngày)", type: "number", min: 0 },
    { name: "expiryDate", label: "Hạn dùng", type: "date" },
  ];
  const fields = kind === "products" ? productFields : kind === "sites" ? siteFields : kind === "vehicles" ? vehicleFields : materialFields;
  const incomplete = row && "evidenceComplete" in row && row.evidenceComplete === false;
  const completePath = kind === "products" ? `/catalog/products/${id}/complete` : kind === "sites" ? `/enterprise-workspace/sites/${id}/complete` : `/enterprise-workspace/materials/${id}/complete`;

  return <div className="manage-console">
    <PageHeader actionKind="create" title={`${products ? "Sửa sản phẩm" : "Thông tin"} ${textValue(row && ("productName" in row ? row.productName : "registration" in row ? row.registration : row.name))}`} description="Mỗi lần sửa tạo revision; bản trước được giữ để đối chiếu với lịch sử truy xuất." back={products ? `/enterprise/products/${id}` : `/enterprise/${kind}`} backLabel={products ? "Quay lại chi tiết" : "Quay lại danh sách"} />
    <LoadState {...state} />
    {row && <>
      {incomplete && (kind === "products" || kind === "materials" || kind === "sites") && <section className="panel">
        <p className="notice">{kind === "products" ? "Tải ít nhất ba ảnh sản phẩm" : kind === "sites" ? "Tải ít nhất một ảnh cơ sở" : "Tải ít nhất một ảnh giống hoặc vật tư"} rồi hoàn tất để kích hoạt.</p>
        <CommandState command={complete} />
        <Button className="button" disabled={complete.pending || complete.frozen} onClick={async () => { if (await complete.run(completePath, { version: row.version })) state.reload(); }}>Hoàn tất ảnh và kích hoạt</Button>
      </section>}
      {products && overview.data && !overview.data.permissions.includes(permission) && <section className="panel">
        <h2>Hình ảnh sản phẩm</h2>
        <p className="muted">Bấm vào ảnh để xem lớn, dấu × để gỡ ảnh. Sản phẩm đang bán cần ít nhất ba ảnh sản phẩm.</p>
        <ImageGallery entityType="PRODUCT" entityId={id} canRemove reloadKey={imagesChanged} onChanged={state.reload} />
        <ImageUpload entityType="PRODUCT" entityId={id} onUploaded={() => { setImagesChanged((n) => n + 1); state.reload(); }} />
      </section>}
      {overview.data?.permissions.includes(permission) ? <DataForm
        key={String(row.version)} title={products ? "Cập nhật sản phẩm" : "Cập nhật có lý do"}
        path={`/enterprise-workspace/${kind}/${id}${kind === "sites" || kind === "vehicles" ? "/revisions" : ""}`}
        className={products ? "product-edit-form" : undefined}
        showTitle={!products}
        submitLabel={products ? "Lưu thay đổi" : undefined}
        beforeFieldContent={products ? { field: "reason", children: <section className="product-edit-images">
          <span>Hình ảnh sản phẩm</span>
          <div className="product-edit-image-content">
            <ImageGallery entityType="PRODUCT" entityId={id} canRemove reloadKey={imagesChanged} onChanged={state.reload}
              orderPath={`/enterprise-workspace/products/${id}/photo-order`}
              trailing={<ImageUpload entityType="PRODUCT" entityId={id} compact onUploaded={() => { setImagesChanged((n) => n + 1); state.reload(); }} />} />
          </div>
        </section> } : undefined}
        extra={{ version: row.version, ...("farmId" in row && row.farmId ? { site: { farmId: row.farmId } } : {}) }}
        initialValues={Object.fromEntries([...fields.map((field) => [field.name, String(fieldValue(row, field.name) ?? "").slice(0, field.type === "date" ? 10 : undefined)]), ["status", row.status]])}
        fields={[...fields.map((field) => ({ ...field, nest })), { name: "status", label: "Trạng thái", required: true, options: [{ value: "ACTIVE", label: "Hoạt động" }, { value: "INACTIVE", label: "Ngừng sử dụng" }] }, { name: "reason", label: "Lý do sửa", type: "textarea", className: products ? "product-reason-field" : undefined, required: true, minLength: 10, maxLength: 1000, placeholder: "Nhập lý do sửa (tối thiểu 10 ký tự)" }]}
        onSaved={() => { if (products) { router.replace(`/enterprise/products/${id}`); return; } state.reload(); history.reload(); }}
      /> : <section className="panel">{fields.map((field) => <p key={field.name}>{field.label}: {textValue(fieldValue(row, field.name))}</p>)}</section>}
      {!products && <section className="panel"><h2>Lịch sử revision</h2>{history.data?.items.map((revision) => <p key={revision.id}>Phiên bản {revision.version} · {revision.reason} · {new Date(revision.createdAt).toLocaleString("vi-VN")}</p>)}{history.data?.items.length === 0 && <p>Chưa có lần sửa.</p>}</section>}
      {kind !== "vehicles" && !products && <EvidencePanel entityType={type} entityId={id} materialKind={kind === "materials" && "kind" in row ? row.kind : undefined} />}
    </>}
  </div>;
}
