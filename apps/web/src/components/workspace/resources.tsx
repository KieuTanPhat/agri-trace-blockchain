"use client";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { useConfirm } from "@/lib/confirm";
import {
  useWorkspaceData,
  useWorkspaceCommand,
  textValue,
  labels,
  type Catalog,
  type EnterprisePartner,
  type EnterpriseMember,
  type EnterpriseSite,
  type EnterpriseVehicle,
  type Items,
  type ProductionMaterial,
  type Overview,
} from "@/lib/workspace";
import {
  CommandState,
  EmptyState,
  LoadState,
  PageHeader,
  StatusBadge,
} from "@/components/manage";
import { EntityThumb, ProductThumb } from "./entity-thumb";
import { PartnerInviteDialog } from "./partner-invite-dialog";
import { EvidenceInputs, checkEvidenceInputs, completeEvidence, createdId, createdVersion, uploadEvidenceFiles } from "./evidence-panel";
type Kind = "sites" | "vehicles" | "partners" | "products" | "areas";
type ExternalPartner = { id: string; businessId: string; name: string; kind: string; address: string; status?: string };
type PartnerSuggestion = { id: string; businessId: string; name: string; kind: string; registered: boolean };
const config = {
  sites: {
    title: "Cơ sở",
    description:
      "Các địa điểm tham gia sản xuất, lưu giữ và phân phối trong doanh nghiệp.",
    action: "Thêm cơ sở",
    path: "/enterprise-workspace/sites",
    columns: [
      ["image", "Hình ảnh"],
      ["name", "Tên cơ sở"],
      ["kind", "Loại cơ sở"],
      ["address", "Địa chỉ"],
      ["status", "Trạng thái"],
    ],
  },
  vehicles: {
    title: "Phương tiện",
    description: "Phương tiện phục vụ truy xuất từng chặng giao nhận.",
    action: "Thêm phương tiện",
    path: "/enterprise-workspace/vehicles",
    columns: [
      ["registration", "Biển số / mã phương tiện"],
      ["kind", "Loại phương tiện"],
      ["status", "Trạng thái"],
    ],
  },
  partners: {
    title: "Doanh nghiệp liên kết",
    description:
      "Mời đối tác AgriTrace hoặc lưu hồ sơ doanh nghiệp ngoài hệ thống để tham chiếu.",
    action: "Thêm doanh nghiệp",
    path: "/enterprise-workspace/partners",
    columns: [
      ["image", "Logo"],
      ["partnerName", "Doanh nghiệp"],
      ["direction", "Lời mời"],
      ["status", "Trạng thái"],
    ],
  },
  products: {
    title: "Sản phẩm",
    description:
      "Danh mục riêng của doanh nghiệp và các sản phẩm dùng chung đã có.",
    action: "Thêm sản phẩm",
    path: "/catalog",
    columns: [
      ["sku", "Mã sản phẩm"],
      ["productName", "Tên sản phẩm"],
      ["variety", "Giống / phân loại"],
      ["originFarm", "Vùng xuất xứ"],
      ["defaultUnit", "Đơn vị tính"],
      ["image", "Hình ảnh"],
      ["status", "Trạng thái"],
    ],
  },
  areas: {
    title: "Vùng sản xuất",
    description: "Nông trại và thửa đất gắn với từng vụ sản xuất.",
    action: "Thêm vùng sản xuất",
    path: "/catalog",
    columns: [
      ["image", "Hình ảnh"],
      ["name", "Nông trại"],
      ["location", "Vị trí"],
      ["status", "Trạng thái"],
    ],
  },
};
type Cell = string | number | null | undefined;
/** One table row normalized from the typed list responses. */
type ListRow = {
  id: string;
  version?: number;
  status: string;
  evidenceComplete?: boolean;
  cells: Record<string, Cell>;
  organizationId?: string | null;
  sku?: string | null;
  gtin?: string | null;
  inviterId?: string;
  inviteeId?: string;
};
function siteRow(r: EnterpriseSite): ListRow {
  return { ...r, cells: { name: r.name, kind: r.kind, address: r.address } };
}
function vehicleRow(r: EnterpriseVehicle): ListRow {
  return { ...r, cells: { registration: r.registration, kind: r.kind } };
}
function partnerRow(r: EnterprisePartner, ownId?: string): ListRow {
  const sent = r.inviterId === ownId;
  return {
    ...r,
    cells: {
      partnerName: (sent ? r.invitee : r.inviter)?.name,
      direction: sent ? "Đã gửi" : "Được mời",
    },
  };
}
export function ResourceList({ kind }: { kind: Kind }) {
  const c = config[kind],
    usesCatalog = kind === "products" || kind === "areas",
    catalog = useWorkspaceData<Catalog>(usesCatalog ? c.path : null),
    sites = useWorkspaceData<Items<EnterpriseSite>>(
      kind === "sites" ? c.path : null,
    ),
    vehicles = useWorkspaceData<Items<EnterpriseVehicle>>(
      kind === "vehicles" ? c.path : null,
    ),
    partners = useWorkspaceData<Items<EnterprisePartner>>(
      kind === "partners" ? c.path : null,
    ),
    external = useWorkspaceData<Items<ExternalPartner>>(
      kind === "partners" ? `${c.path}/external` : null,
    ),
    overview = useWorkspaceData<Overview>("/enterprise-workspace"),
    command = useWorkspaceCommand(),
    confirm = useConfirm();
  const [inviteOpen, setInviteOpen] = useState(false);
  const state = usesCatalog
    ? catalog
    : kind === "sites"
      ? sites
      : kind === "vehicles"
        ? vehicles
        : partners;
  const ownId = overview.data?.organization.id;
  const rows: ListRow[] =
    kind === "products"
      ? (catalog.data?.products ?? []).map((r) => ({
          ...r,
          cells: {
            sku: r.sku ?? "—",
            productName: r.productName,
            variety: r.variety || "—",
            originFarm:
              catalog.data?.farms.find((f) => f.id === r.originFarmId)?.name ?? "—",
            defaultUnit: r.defaultUnit,
          },
        }))
      : kind === "areas"
        ? (catalog.data?.farms ?? []).map((r) => ({
            ...r,
            cells: { name: r.name, location: r.location },
          }))
        : kind === "sites"
          ? (sites.data?.items ?? []).map(siteRow)
          : kind === "vehicles"
            ? (vehicles.data?.items ?? []).map(vehicleRow)
            : [
                ...(partners.data?.items ?? []).map((r) => partnerRow(r, ownId)),
                ...(external.data?.items ?? []).map((r) => ({
                  id: r.id,
                  status: "REFERENCE_ONLY",
                  cells: { partnerName: r.name, direction: "Hồ sơ tham chiếu" },
                })),
              ];
  const managePermission =
    kind === "partners"
      ? "partners.manage"
      : kind === "sites"
        ? "sites.manage"
        : kind === "vehicles"
          ? "vehicles.manage"
          : "catalog.manage";
  const canManage = overview.data?.permissions.includes(managePermission);
  async function change(row: ListRow, decision: string) {
    const name = textValue(
      row.cells.name ?? row.cells.partnerName ?? row.cells.registration ?? "",
    );
    const message =
      kind === "partners"
        ? {
            ACCEPT: `Chấp nhận liên kết với ${name}?`,
            REJECT: `Từ chối lời mời liên kết của ${name}?`,
            REVOKE: `Thu hồi liên kết với ${name}? Đối tác không còn được chọn trong chuỗi mới.`,
          }[decision] ?? "Xác nhận thao tác?"
        : row.status === "ACTIVE"
          ? `Ngừng sử dụng (xóa khỏi danh sách hoạt động) ${name}? Lịch sử đã ghi vẫn được giữ; có thể kích hoạt lại.`
          : `Kích hoạt lại ${name}?`;
    if (!(await confirm(message, "Xác nhận thao tác"))) return;
    const path =
      kind === "partners"
        ? `/enterprise-workspace/partners/${row.id}`
        : `/enterprise-workspace/${kind}/${row.id}/status`;
    if (
      await command.run(
        path,
        kind === "partners"
          ? { version: row.version, decision }
          : {
              version: row.version,
              status: row.status === "ACTIVE" ? "INACTIVE" : "ACTIVE",
            },
        "POST",
        { confirmed: true },
      )
    )
      state.reload();
  }
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        back="/enterprise"
        backLabel="Doanh nghiệp"
        title={c.title}
        description={c.description}
        action={
          canManage && kind !== "partners"
            ? { href: `/enterprise/${kind}/new`, label: c.action }
            : undefined
        }
        actions={
          canManage && kind === "partners" ? (
            <button type="button" className="button manage-primary-action" onClick={() => setInviteOpen(true)}>
              {c.action}
            </button>
          ) : undefined
        }
      />
      {kind === "partners" && (
        <PartnerInviteDialog open={inviteOpen} onClose={() => setInviteOpen(false)} onInvited={() => state.reload()} />
      )}
      <LoadState {...state} />
      {kind === "partners" && <LoadState {...external} />}
      {kind === "products" && canManage && (
        <Link className="button secondary" href="/enterprise/products/import">
          Nhập danh mục CSV
        </Link>
      )}
      <CommandState command={command} />
      <div className="manage-section manage-table-scroll">
        {rows.length ? (
          <table className="manage-table">
            <thead>
              <tr>
                {c.columns.map(([key, label]) => (
                  <th key={key}>{label}</th>
                ))}
                {(canManage || kind === "products") && <th>Thao tác</th>}
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const item: Record<string, Cell> = { ...row.cells, status: row.status };
                return (
                  <tr key={row.id}>
                    {c.columns.map(([key, label]) => (
                      <td key={key} data-label={label}>
                        {key === "image" ? (
                          kind === "products" ? (
                            <ProductThumb productId={row.id} name={textValue(item.productName)} />
                          ) : kind === "sites" ? (
                            <EntityThumb entityType="SITE" entityId={row.id} kinds={["SITE_IMAGE"]} name={textValue(item.name)} />
                          ) : kind === "areas" ? (
                            <EntityThumb entityType="FARM" entityId={row.id} kinds={["AREA_IMAGE"]} name={textValue(item.name)} />
                          ) : kind === "partners" && row.status === "REFERENCE_ONLY" ? (
                            <EntityThumb entityType="EXTERNAL_PARTNER" entityId={row.id} kinds={["PARTNER_LOGO"]} name={textValue(item.partnerName)} />
                          ) : (
                            <span className="product-thumb"><span>—</span></span>
                          )
                        ) : key === "status" ? (
                          <StatusBadge value={textValue(item[key])} label={row.evidenceComplete === false ? "Chưa đủ ảnh" : undefined} />
                        ) : key === "kind" ? (
                          (labels[textValue(item[key])] ?? textValue(item[key]))
                        ) : ["products", "sites", "vehicles", "areas"].includes(kind) &&
                          ["productName", "name", "registration"].includes(
                            key,
                          ) ? (
                          <Link
                            className="text-link"
                            href={`/enterprise/${kind}/${row.id}`}
                          >
                            {textValue(item[key])}
                          </Link>
                        ) : (
                          textValue(item[key])
                        )}
                        {key === "partnerName" && row.status === "REFERENCE_ONLY" && <small><Link className="text-link" href={`/enterprise/partners/external/${row.id}`}>Xem hồ sơ và tài liệu →</Link></small>}
                        {key === "productName" && (
                          <small>
                            {row.organizationId
                              ? "Danh mục doanh nghiệp"
                              : "Danh mục dùng chung"}
                          </small>
                        )}
                        {key === "productName" && Boolean(row.gtin) && (
                          <small>GTIN: {textValue(row.gtin)}</small>
                        )}
                        {key === "name" && kind === "areas" && (
                          <small>
                            {catalog.data?.plots
                              .filter((p) => p.farmId === row.id)
                              .map((p) => p.name)
                              .join(" · ") || "Chưa có thửa đất"}
                          </small>
                        )}
                      </td>
                    ))}
                    {(canManage || kind === "products") && (
                      <td data-label="Thao tác">
                        {kind === "partners" ? (
                          <div className="workspace-actions">
                            {row.status === "INVITED" &&
                              row.inviteeId === ownId && (
                                <>
                                  <button
                                    className="text-link"
                                    disabled={command.pending}
                                    onClick={() => void change(row, "ACCEPT")}
                                  >
                                    Chấp nhận
                                  </button>
                                  <button
                                    className="text-link"
                                    disabled={command.pending}
                                    onClick={() => void change(row, "REJECT")}
                                  >
                                    Từ chối
                                  </button>
                                </>
                              )}
                            {["INVITED", "ACTIVE"].includes(row.status) && (
                              <button
                                className="text-link"
                                disabled={command.pending}
                                onClick={() => void change(row, "REVOKE")}
                              >
                                Thu hồi
                              </button>
                            )}
                          </div>
                        ) : ["sites", "vehicles"].includes(kind) ? (
                          <span className="row-actions">
                            <Link
                              className="button secondary small"
                              href={`/enterprise/${kind}/${row.id}`}
                            >
                              Sửa
                            </Link>
                            <button
                              className={`button small ${row.status === "ACTIVE" ? "danger" : "secondary"}`}
                              disabled={command.pending}
                              onClick={() => void change(row, "")}
                            >
                              {row.status === "ACTIVE"
                                ? "Ngừng sử dụng"
                                : "Kích hoạt"}
                            </button>
                          </span>
                        ) : kind === "areas" ? (
                          <span className="row-actions">
                            <Link
                              className="button secondary small"
                              href={`/enterprise/areas/${row.id}`}
                            >
                              Chi tiết
                            </Link>
                            <Link
                              className="button secondary small"
                              href={`/enterprise/areas/plots/new?farmId=${row.id}`}
                            >
                              Thêm thửa đất
                            </Link>
                          </span>
                        ) : (
                          <span className="row-actions">
                            <Link
                              className="button secondary small"
                              href={`/enterprise/${kind}/${row.id}`}
                            >
                              Xem chi tiết
                            </Link>
                          </span>
                        )}
                      </td>
                    )}
                  </tr>
                );
              })}
            </tbody>
          </table>
        ) : (
          !state.loading && !state.error && <EmptyState />
        )}
      </div>
    </div>
  );
}
export function ResourceCreate({
  kind,
  plot = false,
}: {
  kind: Kind;
  plot?: boolean;
}) {
  const router = useRouter(),
    command = useWorkspaceCommand(),
    c = config[kind],
    overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const catalog = useWorkspaceData<Catalog>("/catalog");
  const productSites = useWorkspaceData<Items<EnterpriseSite>>(kind === "products" || (kind === "areas" && !plot) ? "/enterprise-workspace/sites" : null);
  const productMembers = useWorkspaceData<Items<EnterpriseMember>>(kind === "products" || kind === "sites" ? "/enterprise-workspace/members" : null);
  const areaMaterials = useWorkspaceData<Items<ProductionMaterial>>(kind === "areas" && !plot ? "/enterprise-workspace/materials" : null);
  const [done, setDone] = useState(false);
  const [partnerMode, setPartnerMode] = useState<"registered" | "external">("registered");
  const [searchTerm, setSearchTerm] = useState("");
  const suggestions = useWorkspaceData<Items<PartnerSuggestion>>(
    kind === "partners" && searchTerm.trim().length >= 2
      ? `/enterprise-workspace/partners/search?q=${encodeURIComponent(searchTerm.trim())}`
      : null,
  );
  const evidenceType =
    kind === "products"
      ? "PRODUCT"
      : kind === "sites"
        ? "SITE"
        : kind === "areas" && !plot
          ? "FARM"
          : kind === "partners" && partnerMode === "external"
            ? "EXTERNAL_PARTNER"
            : null;
  const [uploadNote, setUploadNote] = useState("");
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = e.currentTarget;
    const problem = evidenceType ? checkEvidenceInputs(form) : "";
    setUploadNote(problem);
    if (problem) return;
    const data = Object.fromEntries(
      [...new FormData(form)].filter(([key]) => !key.startsWith("evidence:") && key !== "evidenceDescription"),
    );
    let payload: Record<string, unknown> = { ...data };
    let path = c.path;
    if (kind === "sites") {
      payload = {
        name: data.name, kind: data.kind, address: data.address,
        region: data.region, ward: data.ward, areaM2: Number(data.areaM2),
        farmId: data.farmId || undefined,
        coldAreaM2: data.coldAreaM2 ? Number(data.coldAreaM2) : undefined,
        capacityKg: data.capacityKg ? Number(data.capacityKg) : undefined,
        expectedOutputTons: data.expectedOutputTons ? Number(data.expectedOutputTons) : undefined,
        manager: data.manager || undefined, representative: data.representative || undefined,
        phone: data.phone || undefined, email: data.email || undefined, otherInfo: data.otherInfo || undefined,
        staffUserId: data.staffUserId || undefined,
      };
    }
    if (kind === "partners" && partnerMode === "external") {
      path = "/enterprise-workspace/partners/external";
      payload = {
        businessId: data.businessId,
        name: data.name,
        kind: data.kind,
        address: data.address,
        phone: String(data.phone ?? "").replace(/[ .()-]/g, ""),
        email: String(data.email ?? "").trim(),
        taxCode: String(data.taxCode ?? "").trim(),
        representative: String(data.representative ?? "").trim(),
        note: String(data.note ?? "").trim(),
      };
    }
    if (kind === "products") {
      path = "/catalog/products";
      payload = {
        productName: data.productName,
        category: data.category,
        originFarmId: data.originFarmId,
        variety: data.variety,
        defaultUnit: data.defaultUnit,
        sku: data.sku || undefined,
        gtin: data.gtin || undefined,
        price: data.price ? Number(data.price) : undefined,
        storageConditions: data.storageConditions,
        ingredients: data.ingredients,
        usageInstructions: data.usageInstructions,
        description: data.description || undefined,
        rawMaterials: data.rawMaterials || undefined,
        manufacturingSiteId: data.manufacturingSiteId || undefined,
        exporter: data.exporter || undefined,
        importer: data.importer || undefined,
        distributor: data.distributor || undefined,
        carrier: data.carrier || undefined,
        managerUserId: data.managerUserId || undefined,
      };
    }
    if (kind === "areas") {
      path = plot ? "/catalog/plots" : "/catalog/farms";
      payload = plot
        ? { ...data, area: data.area ? Number(data.area) : undefined }
        : {
            ...data,
            organizationId: overview.data?.organization.id,
            areaM2: Number(data.areaM2),
            expectedOutput: Number(data.expectedOutput),
            location: data.address,
            cropCode: data.cropCode || undefined,
            linkedSiteId: data.linkedSiteId || undefined,
            inputMaterialIds: new FormData(form).getAll("inputMaterialIds").map(String),
            seedMaterialIds: new FormData(form).getAll("seedMaterialIds").map(String),
          };
    }
    const result = await command.run(path, payload);
    if (!result) return;
    setDone(true);
    const id = createdId(result);
    if (evidenceType && id) {
      setUploadNote("Đang tải ảnh và giấy tờ…");
      const failed = await uploadEvidenceFiles(form, evidenceType, id, String(new FormData(form).get("evidenceDescription") ?? ""));
      const detail = evidenceType === "EXTERNAL_PARTNER" ? `/enterprise/partners/external/${id}` : `/enterprise/${kind}/${id}`;
      if (failed.length) {
        // The record exists; its detail page is where the missing files go.
        setUploadNote(`Đã lưu, nhưng chưa tải được: ${failed.join(", ")}. Bổ sung trong trang chi tiết.`);
        window.setTimeout(() => router.push(detail), 2500);
        return;
      }
      const completePath =
        evidenceType === "PRODUCT"
          ? `/catalog/products/${id}/complete`
          : evidenceType === "SITE"
            ? `/enterprise-workspace/sites/${id}/complete`
            : evidenceType === "FARM"
              ? `/catalog/farms/${id}/complete`
              : null;
      if (completePath) {
        setUploadNote("Đang hoàn tất hồ sơ ảnh và kích hoạt…");
        const refused = await completeEvidence(completePath, createdVersion(result));
        if (refused) {
          setUploadNote(`Đã lưu và tải ảnh, nhưng chưa kích hoạt: ${refused}. Hoàn tất trong trang chi tiết.`);
          window.setTimeout(() => router.push(detail), 2500);
          return;
        }
      }
    }
    router.push(`/enterprise/${kind}`);
  }
  const field = (
    name: string,
    label: string,
    required = true,
    type = "text",
  ) => (
    <label>
      {label}
      <input
        className="input"
        name={name}
        required={required}
        type={type}
        maxLength={
          name === "address"
            ? 500
            : ["storageConditions", "ingredients", "usageInstructions", "otherInfo"].includes(name)
              ? 2000
            : name === "sku"
              ? 100
              : name === "gtin"
                ? 14
                : name === "unit" || name === "defaultUnit"
                  ? 30
                  : 255
        }
        step={type === "number" ? "0.01" : undefined}
        min={type === "number" ? "0.01" : undefined}
      />
    </label>
  );
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title={plot ? "Thêm thửa đất" : c.action}
        description="Thông tin được lưu trong phạm vi doanh nghiệp của bạn."
        back={`/enterprise/${kind}`}
      />
      <form className="panel workspace-form" onSubmit={submit}>
        <CommandState command={command} />
        {kind === "products" && (
          <>
            <EvidenceInputs entityType="PRODUCT" title="Hình ảnh sản phẩm" disabled={command.pending || command.frozen || done} />
            <label>
              Mô tả hình ảnh (không bắt buộc)
              <textarea className="input" name="evidenceDescription" maxLength={900} rows={2} disabled={command.pending || command.frozen || done} />
            </label>
          </>
        )}
        <fieldset
          className="enterprise-fields"
          disabled={command.pending || command.frozen || done}
        >
          {kind === "sites" && (
            <>
              {field("name", "Tên cơ sở")}
              <label>
                Loại cơ sở
                <select className="input" name="kind">
                  {[
                    "PRODUCTION",
                    "PACKING",
                    "WAREHOUSE",
                    "COLD_STORAGE",
                    "PROCESSING",
                    "DISTRIBUTION",
                    "RETAIL",
                    "OTHER",
                  ].map((k) => (
                    <option key={k} value={k}>
                      {labels[k]}
                    </option>
                  ))}
                </select>
              </label>
              {field("address", "Địa chỉ")}
              {field("region", "Tỉnh / thành phố")}
              {field("ward", "Phường / xã")}
              {field("areaM2", "Diện tích cơ sở (m²)", true, "number")}
              {field("coldAreaM2", "Diện tích kho lạnh (m²)", false, "number")}
              {field("capacityKg", "Sức chứa tối đa (kg)", false, "number")}
              {field("expectedOutputTons", "Sản lượng dự kiến (tấn/năm)", false, "number")}
              <label>Vùng sản xuất liên kết (nếu có)<select className="input" name="farmId"><option value="">Không liên kết</option>{catalog.data?.farms.filter((farm) => farm.status === "ACTIVE" && farm.evidenceComplete).map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></label>
              {field("manager", "Người quản lý cơ sở", false)}
              <label>Nhân viên phụ trách (nếu có)<select className="input" name="staffUserId"><option value="">Chưa chọn</option>{(productMembers.data?.items ?? []).filter((member) => member.accountStatus === "ACTIVE").map((member) => <option key={member.id} value={member.id}>{member.fullName}{member.jobTitle ? ` · ${member.jobTitle}` : ""}</option>)}</select></label>
              {field("representative", "Người đại diện", false)}
              {field("phone", "Điện thoại", false)}
              {field("email", "Email", false, "email")}
              {field("otherInfo", "Thông tin khác", false)}
            </>
          )}
          {kind === "vehicles" && (
            <>
              {field("registration", "Biển số / mã phương tiện")}
              {field("kind", "Loại phương tiện")}
            </>
          )}
          {kind === "partners" && (
            <>
              <label>Loại hồ sơ<select className="input" value={partnerMode} onChange={(event) => { setPartnerMode(event.target.value as "registered" | "external"); setSearchTerm(""); }}><option value="registered">Mời doanh nghiệp AgriTrace</option><option value="external">Ghi nhận doanh nghiệp ngoài hệ thống</option></select></label>
              <label>Mã doanh nghiệp / từ khóa tìm kiếm<input className="input" name="businessId" required value={searchTerm} onChange={(event) => setSearchTerm(event.target.value)} maxLength={40} /></label>
              {suggestions.data?.items.length ? <div className="partner-suggestions"><strong>Kết quả tìm kiếm</strong>{suggestions.data.items.map((item) => <button key={item.id} type="button" className="text-link" onClick={() => { setSearchTerm(item.businessId); setPartnerMode(item.registered ? "registered" : "external"); }}>{item.name} · {item.businessId} · {item.registered ? "AgriTrace" : "Hồ sơ ngoài hệ thống"}</button>)}</div> : null}
              {partnerMode === "registered" ? <>
                {field("note", "Lời nhắn (không bắt buộc)", false)}
                <p className="notice">Doanh nghiệp AgriTrace cần chấp nhận lời mời. Quan hệ liên kết không tự cấp quyền vào chuỗi.</p>
              </> : <>
                {field("name", "Tên doanh nghiệp")}
                <label>Loại hình<select className="input" name="kind"><option value="FARM">Nhà sản xuất</option><option value="TRANSPORTER">Nhà vận chuyển</option><option value="DISTRIBUTOR">Nhà phân phối</option><option value="RETAILER">Nhà bán lẻ</option></select></label>
                {field("address", "Địa chỉ doanh nghiệp")}
                {field("phone", "Số điện thoại", true, "tel")}
                {field("email", "Email", true, "email")}
                {field("taxCode", "Mã số thuế", true)}
                {field("representative", "Người đại diện", true)}
                {field("note", "Ghi chú hợp tác", true)}
                <p className="notice">Hồ sơ ngoài hệ thống chỉ để tham chiếu; không có quyền nhận hàng, ký hoặc xem dữ liệu chuỗi.</p>
              </>}
            </>
          )}
          {kind === "products" && (
            <>
              {field("productName", "Tên sản phẩm")}
              {field("sku", "Mã sản phẩm (tự sinh nếu trống)", false)}
              {field("category", "Danh mục sản phẩm")}
              <label>Vùng sản xuất xuất xứ<select className="input" name="originFarmId" required><option value="">Chọn vùng đã hoàn tất hồ sơ</option>{catalog.data?.farms.filter((farm) => farm.status === "ACTIVE" && farm.evidenceComplete).map((farm) => <option key={farm.id} value={farm.id}>{farm.name}</option>)}</select></label>
              {field("gtin", "Mã vạch GTIN (nếu có)", false)}
              {field("price", "Giá sản phẩm (nếu có)", false, "number")}
              {field("storageConditions", "Điều kiện bảo quản")}
              {field("ingredients", "Thành phần")}
              {field("usageInstructions", "Hướng dẫn sử dụng")}
              <label>
                Mô tả sản phẩm
                <textarea
                  className="input"
                  name="description"
                  maxLength={2000}
                  rows={4}
                />
              </label>
              {field("variety", "Giống / phân loại", false)}
              {field("defaultUnit", "Đơn vị mặc định (ví dụ: kg)")}
              {field("rawMaterials", "Nguyên liệu (nếu có)", false)}
              <label>Nhà xưởng sản xuất (nếu có)<select className="input" name="manufacturingSiteId"><option value="">Chưa chọn</option>{productSites.data?.items.filter((site) => site.status === "ACTIVE").map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
              {field("exporter", "Nhà xuất khẩu (nếu có)", false)}
              {field("importer", "Nhà nhập khẩu (nếu có)", false)}
              {field("distributor", "Nhà phân phối (nếu có)", false)}
              {field("carrier", "Nhà vận chuyển (nếu có)", false)}
              <label>Người quản lí (nếu có)<select className="input" name="managerUserId"><option value="">Chưa chọn</option>{productMembers.data?.items.filter((member) => member.accountStatus === "ACTIVE").map((member) => <option key={member.id} value={member.id}>{member.fullName}</option>)}</select></label>
            </>
          )}
          {kind === "areas" && (
            <>
              {plot && (
                <label>
                  Nông trại
                  <select className="input" name="farmId" required>
                    <option value="">Chọn nông trại</option>
                    {catalog.data?.farms.map((f) => (
                      <option key={f.id} value={f.id}>
                        {f.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {field("name", plot ? "Tên thửa đất" : "Tên vùng / nông trại")}
              {plot ? field("location", "Vị trí / địa chỉ") : <>
                {field("kind", "Loại vùng sản xuất")}
                {field("region", "Khu vực")}
                {field("address", "Địa chỉ cụ thể")}
                {field("areaM2", "Diện tích vùng (m²)", true, "number")}
                {field("expectedOutput", "Sản lượng dự kiến", true, "number")}
                {field("outputUnit", "Đơn vị sản lượng")}
                {field("cropCode", "Mã vụ trồng (nếu có)", false)}
                <label>Vật tư đầu vào (nếu có, giữ Ctrl để chọn nhiều)<select className="input" name="inputMaterialIds" multiple>{(areaMaterials.data?.items ?? []).filter((m) => m.kind !== "SEED").map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}</option>)}</select></label>
                <label>Loại giống (nếu có, giữ Ctrl để chọn nhiều)<select className="input" name="seedMaterialIds" multiple>{(areaMaterials.data?.items ?? []).filter((m) => m.kind === "SEED").map((m) => <option key={m.id} value={m.id}>{m.code} · {m.name}{m.seedType ? ` (${m.seedType})` : ""}</option>)}</select></label>
                <label>Nhà xưởng liên kết (nếu có)<select className="input" name="linkedSiteId"><option value="">Không liên kết</option>{(productSites.data?.items ?? []).filter((site) => site.status === "ACTIVE").map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
                <fieldset className="tick-group"><legend>Quyền hiển thị thông tin <span aria-hidden="true">*</span></legend><label className="tick-choice"><input type="radio" name="privacy" value="PRIVATE" defaultChecked required /> Riêng tư</label><label className="tick-choice"><input type="radio" name="privacy" value="PUBLIC" /> Công khai</label></fieldset>
                {field("representative", "Người đại diện", false)}
                {field("phone", "Điện thoại liên hệ", false)}
                {field("email", "Email liên hệ", false, "email")}
                {field("otherInfo", "Thông tin khác", false)}
              </>}
              {plot && (
                <>
                  {field("area", "Diện tích", true, "number")}
                  {field("unit", "Đơn vị diện tích (m² / ha)")}
                </>
              )}
            </>
          )}
        </fieldset>
        {evidenceType && evidenceType !== "PRODUCT" && (
          <EvidenceInputs entityType={evidenceType} disabled={command.pending || command.frozen || done} />
        )}
        {uploadNote && <p className="notice" role="status">{uploadNote}</p>}
        <button
          className="button"
          disabled={command.pending || done}
          type="submit"
        >
          {command.pending
            ? "Đang lưu…"
            : "Lưu thông tin"}
        </button>
      </form>
    </div>
  );
}
