"use client";
import { Table, TableHeader, TableBody, TableRow, TableHead, TableCell } from "@/components/ui/table";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { DataForm } from "@/components/data-form";
import { useAuth } from "@/lib/auth-store";
import {
  useWorkspaceData,
  type Items,
  type ProductionMaterial,
  type EnterpriseMember,
  type EnterpriseSite,
  type TraceEvidence,
} from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
import type { Catalog } from "@/lib/catalog";
import { sumQuantities } from "@/lib/quantity-display";
import { useRef, useState } from "react";
import {
  EvidenceInputs,
  EvidencePanel,
  createdId,
  uploadEvidenceFiles,
} from "./evidence-panel";
import { EmptyState, LoadState, PageHeader } from "@/components/manage";
export const cycleStates: Record<string, string> = {
  CREATED: "Mới tạo",
  PLANTED: "Đã gieo trồng",
  GROWING: "Đang phát triển",
  COMPLETED: "Đã kết thúc",
  CANCELLED: "Đã hủy",
};
export function CycleCreate() {
  const catalog = useWorkspaceData<Catalog>("/catalog");
  const images = useRef<HTMLFormElement>(null);
  const [imageNote, setImageNote] = useState("");
  const [created, setCreated] = useState<{ code: string; note: string } | null>(
    null,
  );
  async function saved(result: unknown) {
    const id = createdId(result);
    const row = result as { cycleCode?: string; record?: { cycleCode?: string } };
    const code = row?.record?.cycleCode ?? row?.cycleCode ?? "";
    let note = "";
    if (id && images.current) {
      setImageNote("Đang tải ảnh vụ…");
      const failed = await uploadEvidenceFiles(images.current, "CYCLE_DRAFT", id);
      if (failed.length)
        note = `Chưa tải được: ${failed.join(", ")}. Bổ sung trong trang chi tiết vụ.`;
      setImageNote("");
    }
    setCreated({ code, note });
  }
  const materials = useWorkspaceData<Items<ProductionMaterial>>("/enterprise-workspace/materials");
  const members = useWorkspaceData<Items<EnterpriseMember>>("/enterprise-workspace/members");
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title="Tạo vụ sản xuất"
        description="Lập hồ sơ vụ trước. Sau khi liên kết chuỗi hợp lệ, bạn mới có thể ghi nhật ký và thu hoạch."
        back="/production-cycles"
      />
      <LoadState {...catalog} />
      {created && (
        <section className="panel" role="status">
          <h2>Đã tạo vụ sản xuất</h2>
          <p>
            Mã vụ do hệ thống cấp: <strong>{created.code || "—"}</strong>
          </p>
          {created.note && <p className="notice">{created.note}</p>}
          <Link className="button" href="/production-cycles">
            Về danh sách vụ
          </Link>
        </section>
      )}
      {catalog.data && !created && (
        <form
          ref={images}
          className="panel workspace-form"
          onSubmit={(event) => event.preventDefault()}
        >
          <EvidenceInputs
            entityType="CYCLE_DRAFT"
            title="Hình ảnh vụ trồng (không bắt buộc)"
          />
          {imageNote && (
            <p className="notice" role="status">
              {imageNote}
            </p>
          )}
        </form>
      )}
      {catalog.data && !created && (
        <DataForm
          title="Thông tin vụ nháp"
          path="/production-cycles/drafts"
          freezeOnUnknown
          onSaved={(result) => void saved(result)}
          fields={[
            { name: "name", label: "Tên vụ trồng", required: true },
            {
              name: "farmId",
              label: "Nông trại",
              required: true,
              options: catalog.data.farms.map((f) => ({
                value: f.id,
                label: f.name,
              })),
            },
            {
              name: "plotId",
              label: "Thửa đất",
              required: true,
              dependsOn: "farmId",
              options: catalog.data.plots.map((p) => ({
                value: p.id,
                label: p.name,
                parentValue: p.farmId,
              })),
            },
            {
              name: "productId",
              label: "Sản phẩm",
              required: true,
              options: catalog.data.products
                .filter((p) => p.status === "ACTIVE")
                .map((p) => ({ value: p.id, label: p.productName })),
            },
            {
              name: "seedMaterialId", label: "Loại giống (nếu có)",
              options: materials.data?.items.filter((m) => m.kind === "SEED" && m.status === "ACTIVE")
                .map((m) => ({ value: m.id, label: m.name })),
            },
            {
              name: "responsibleUserId", label: "Người phụ trách (nếu có)",
              options: members.data?.items.filter((m) => m.accountStatus === "ACTIVE")
                .map((m) => ({ value: m.id, label: m.fullName })),
            },
            { name: "cultivationMethod", label: "Phương pháp canh tác", maxLength: 255 },
            { name: "startDate", label: "Ngày bắt đầu", type: "date", required: true },
            {
              name: "plannedHarvest",
              label: "Dự kiến thu hoạch",
              type: "date",
              required: true,
            },
            { name: "cultivatedArea", label: "Diện tích canh tác (m²)", type: "number", min: 0.01, required: true },
            {
              name: "maxHarvestQuantity",
              label: "Sản lượng dự kiến tối đa (nếu có)",
              type: "number",
              min: 0.001,
            },
            { name: "harvestUnit", label: "Đơn vị thu hoạch", required: true },
            { name: "note", label: "Ghi chú" },
          ]}
        />
      )}
    </div>
  );
}
export function CycleDetail({
  id,
  view = "overview",
}: {
  id: string;
  view?:
    "overview" | "journal" | "harvest" | "care-new" | "harvest-new" | "plant";
}) {
  const { user } = useAuth();
  const state = useWorkspaceData<components["schemas"]["CycleDetailDto"]>(
      `/production-cycles/${id}`,
    ),
    router = useRouter(),
    c = state.data;
  const materials = useWorkspaceData<Items<ProductionMaterial>>(
    view === "care-new" ? "/enterprise-workspace/materials" : null,
  );
  const sites = useWorkspaceData<Items<EnterpriseSite>>(
    view === "harvest-new" ? "/enterprise-workspace/sites" : null,
  );
  const members = useWorkspaceData<Items<EnterpriseMember>>(
    view === "harvest-new" ? "/enterprise-workspace/members" : null,
  );
  const evidence = useWorkspaceData<Items<TraceEvidence>>(
    view === "care-new" || view === "harvest-new"
      ? `/enterprise-workspace/evidence?entityType=CYCLE&entityId=${id}`
      : null,
  );
  const currentEvidence = (evidence.data?.items ?? []).filter(
    (row) => !evidence.data?.items.some((newer) => newer.supersedesId === row.id),
  );
  const active = c && ["PLANTED", "GROWING"].includes(c.currentState);
  const canWrite = c?.canWriteProduction;
  const title =
    view === "journal"
      ? "Nhật ký sản xuất"
      : view === "harvest"
        ? "Các lần thu hoạch"
        : view === "care-new"
          ? "Ghi nhật ký chăm sóc"
          : view === "harvest-new"
            ? "Ghi nhận thu hoạch"
            : view === "plant"
              ? "Ghi nhận gieo trồng"
              : `Vụ ${c?.cycleCode ?? ""}`;
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title={title}
        description={
          c
            ? `${c.farm.name} · ${c.product.productName} · ${c.plot?.name ?? "Chưa chọn thửa đất"}`
            : "Đang tải thông tin vụ sản xuất…"
        }
        back={
          view === "overview"
            ? "/production-cycles"
            : `/production-cycles/${id}`
        }
        action={
          canWrite && active && (view === "journal" || view === "harvest")
            ? {
                href: `/production-cycles/${id}/${view}/new`,
                label:
                  view === "journal" ? "Ghi nhật ký" : "Ghi nhận thu hoạch",
              }
            : undefined
        }
      />
      <LoadState {...state} />
      {c && (
        <>
          {view === "overview" && (
            <>
              <section className="panel">
                <dl className="review-details">
                  <dt>Mã vụ</dt>
                  <dd>{c.cycleCode}</dd>
                  <dt>Trạng thái</dt>
                  <dd>{cycleStates[c.currentState]}</dd>
                  <dt>Đã thu hoạch</dt>
                  <dd>
                    {sumQuantities(c.harvestEvents.map((h) => h.quantity))} /{" "}
                    {c.maxHarvestQuantity ?? "—"} {c.harvestUnit}
                  </dd>
                  <dt>Bắt đầu</dt>
                  <dd>
                    {c.startDate
                      ? new Date(c.startDate).toLocaleDateString("vi-VN")
                      : "Chưa khai báo"}
                  </dd>
                  <dt>Phương pháp canh tác</dt><dd>{c.cultivationMethod || "—"}</dd>
                </dl>
              </section>
              <div className="workspace-grid">
                <Link
                  className="workspace-tile"
                  href={`/production-cycles/${id}/journal`}
                >
                  <h2>Nhật ký sản xuất</h2>
                  <p>{c.careRecords.length} hoạt động chăm sóc đã ghi nhận.</p>
                  <span className="text-link">Xem nhật ký →</span>
                </Link>
                <Link
                  className="workspace-tile"
                  href={`/production-cycles/${id}/harvest`}
                >
                  <h2>Thu hoạch & lô nguồn</h2>
                  <p>
                    {c.harvestEvents.length} lần thu hoạch và hồ sơ lô liên
                    quan.
                  </p>
                  <span className="text-link">Xem thu hoạch →</span>
                </Link>
                {canWrite && c.currentState === "CREATED" && (
                  <Link
                    className="workspace-tile"
                    href={`/production-cycles/${id}/plant`}
                  >
                    <h2>Ghi nhận gieo trồng</h2>
                    <p>Bắt đầu theo dõi hoạt động sản xuất của vụ.</p>
                  </Link>
                )}
              </div>
            </>
          )}
          {view === "journal" && (
            <section className="panel">
              <div className="workspace-journey">
                {c.careRecords.map((r) => (
                  <article key={r.id}>
                    <h3>{r.name ?? r.careType}</h3>
                    {r.journalCode && <p>{r.journalCode} · {r.careType}</p>}
                    <p>{new Date(r.eventTime).toLocaleString("vi-VN")}</p>
                    <p>
                      {[
                        r.materialName,
                        r.quantity && `${r.quantity} ${r.unit ?? ""}`,
                        r.method,
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </p>
                    {r.cropCondition && <p>Tình trạng cây trồng: {r.cropCondition}</p>}
                    <p>{r.note}</p>
                  </article>
                ))}
              </div>
              {!c.careRecords.length && (
                <EmptyState
                  title="Chưa có nhật ký chăm sóc"
                  description="Các hoạt động được ghi nối tiếp và giữ nguyên lịch sử."
                />
              )}
            </section>
          )}
          {view === "harvest" && (
            <div className="manage-section manage-table-scroll">
              <Table className="manage-table">
                <TableHeader>
                  <TableRow>
                    <TableHead>Thu hoạch</TableHead>
                    <TableHead>Số lượng</TableHead>
                    <TableHead>Lô nguồn</TableHead>
                    <TableHead>Dữ liệu cảm biến</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {c.harvestEvents.map((h) => (
                    <TableRow key={h.id}>
                      <TableCell data-label="Thu hoạch">{h.harvestCode ?? h.id.slice(0, 8)} · {new Date(h.harvestTime).toLocaleString("vi-VN")}</TableCell>
                      <TableCell data-label="Số lượng">
                        {h.quantity} {h.unit}
                      </TableCell>
                      <TableCell data-label="Lô nguồn">
                        {h.lot ? (
                          <Link
                            className="text-link"
                            href={`/lots/${h.lot.id}`}
                          >
                            {h.lot.lotCode}
                          </Link>
                        ) : (
                          "—"
                        )}
                      </TableCell>
                      <TableCell data-label="Dữ liệu cảm biến">
                        {h.sensorWindow
                          ? `${h.sensorWindow.readingCount} mẫu · ${h.sensorWindow.status === "NO_DATA" ? "Chưa có dữ liệu" : "Đã chốt"}`
                          : "Chưa đối soát"}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
          {view === "plant" && canWrite && c.currentState === "CREATED" && (
            <DataForm
              title="Thời điểm gieo trồng"
              path={`/production-cycles/${id}/plant`}
              extra={{ version: c.version }}
              fields={[
                {
                  name: "plantedAt",
                  label: "Thời điểm gieo trồng",
                  type: "datetime-local",
                  required: true,
                },
              ]}
              onSaved={() => router.push(`/production-cycles/${id}`)}
            />
          )}
          {view === "care-new" && canWrite && active && (
            <>
            <DataForm
              title="Hoạt động chăm sóc"
              path={`/production-cycles/${id}/care`}
              extra={{ version: c.version }}
              fields={[
                { name: "name", label: "Tên nhật ký", required: true },
                { name: "careType", label: "Loại công việc", required: true, options: ["Tưới nước", "Bón phân", "Phun thuốc", "Làm cỏ", "Theo dõi sâu bệnh", "Khác"].map((value) => ({ value, label: value })) },
                {
                  name: "eventTime",
                  label: "Thời điểm",
                  type: "datetime-local",
                  required: true,
                },
                {
                  name: "materialId",
                  label: "Giống / vật tư từ danh mục",
                  options: materials.data?.items.map((m) => ({
                    value: m.id,
                    label: `${m.name} · ${m.batchCode ?? ""}`,
                  })),
                },
                {
                  name: "materialName",
                  label: "Tên đầu vào nếu chưa có danh mục",
                },
                {
                  name: "activeIngredient",
                  label: "Hoạt chất (nếu nhập tay)",
                  maxLength: 255,
                },
                {
                  name: "withdrawalPeriod",
                  label: "Cách ly khai báo (ngày)",
                  type: "number",
                  min: 0,
                },
                {
                  name: "applicationArea",
                  label: "Vùng áp dụng",
                  maxLength: 255,
                },
                { name: "evidenceRef", label: "Ảnh minh chứng nhật ký", required: true, options: currentEvidence.filter((row) => row.kind === "CARE_IMAGE").map((row) => ({ value: row.id, label: row.fileName })) },
                { name: "additionalEvidenceRefs", label: "Ảnh bổ sung (chọn tối đa 4)", type: "multiselect", maxItems: 4, excludes: "evidenceRef", options: currentEvidence.filter((row) => row.kind === "CARE_IMAGE").map((row) => ({ value: row.id, label: row.fileName })) },
                {
                  name: "quantity",
                  label: "Số lượng",
                  type: "number",
                  min: 0.001,
                },
                { name: "unit", label: "Đơn vị" },
                { name: "method", label: "Phương pháp" },
                {
                  name: "performerUserId",
                  label: "Người thực hiện",
                  options: [
                    { value: user?.id ?? "", label: `${user?.fullName ?? "Tài khoản đang ghi"} (tài khoản đang ghi)` },
                    ...(c.responsibleUserId && c.responsibleUserId !== user?.id
                      ? [{ value: c.responsibleUserId, label: `${members.data?.items.find((member) => member.id === c.responsibleUserId)?.fullName ?? "Thành viên được phân công"} (phụ trách vụ)` }]
                      : []),
                  ].filter((option) => option.value),
                },
                { name: "cropCondition", label: "Tình trạng cây trồng", maxLength: 500 },
                { name: "note", label: "Ghi chú" },
              ]}
              onSaved={() => router.push(`/production-cycles/${id}/journal`)}
            />
            <EvidencePanel entityType="CYCLE" entityId={id} onUploaded={evidence.reload} />
            </>
          )}
          {view === "harvest-new" && canWrite && active && (
            <>
            <DataForm
              title="Thông tin thu hoạch"
              path={`/production-cycles/${id}/harvests`}
              extra={{ unit: c.harvestUnit || c.product.defaultUnit || "kg", version: c.version }}
              initialValues={{ representativeUserId: c.responsibleUserId ?? user?.id ?? "" }}
              fields={[
                { name: "lotName", label: "Tên lô nông sản", required: true },
                { name: "representativeUserId", label: "Người đại diện thu hoạch", required: true, options: [{
                  value: c.responsibleUserId ?? user?.id ?? "",
                  label: members.data?.items.find((member) => member.id === (c.responsibleUserId ?? user?.id))?.fullName ?? (c.responsibleUserId ? "Thành viên được phân công cho vụ" : user?.fullName ?? "Tài khoản đang ghi"),
                }] },
                {
                  name: "harvestTime",
                  label: "Thời điểm thu hoạch",
                  type: "datetime-local",
                  required: true,
                },
                {
                  name: "quantity",
                  label: `Sản lượng (${c.harvestUnit || "kg"})`,
                  type: "number",
                  min: 0.001,
                  required: true,
                },
                { name: "lotCode", label: "Mã lô nguồn (tự sinh nếu để trống)" },
                { name: "evidenceRef", label: "Ảnh thu hoạch", required: true, options: currentEvidence.filter((row) => row.kind === "HARVEST_IMAGE").map((row) => ({ value: row.id, label: row.fileName })) },
                { name: "additionalEvidenceRefs", label: "Ảnh thu hoạch bổ sung (tối đa 4)", type: "multiselect", maxItems: 4, excludes: "evidenceRef", options: currentEvidence.filter((row) => row.kind === "HARVEST_IMAGE").map((row) => ({ value: row.id, label: row.fileName })) },
                { name: "lotImageEvidenceRef", label: "Ảnh lô nông sản", required: true, options: currentEvidence.filter((row) => row.kind === "LOT_IMAGE").map((row) => ({ value: row.id, label: row.fileName })) },
                { name: "grade", label: "Phân hạng" },
                { name: "harvestMethod", label: "Phương pháp thu hoạch", options: ["Thủ công", "Máy móc", "Khác"].map((value) => ({ value, label: value })) },
                { name: "harvestArea", label: "Khu vực thu hoạch" },
                { name: "qualityNote", label: "Ghi chú chất lượng" },
                { name: "packageCount", label: "Số kiện / thùng", type: "number", min: 1 },
                { name: "packaging", label: "Quy cách đóng gói" },
                { name: "packedAt", label: "Ngày đóng gói", type: "date" },
                { name: "expiryDate", label: "Ngày hết hạn", type: "date" },
                { name: "initialStorageSiteId", label: "Cơ sở lưu giữ ban đầu", options: sites.data?.items.filter((site) => site.status === "ACTIVE").map((site) => ({ value: site.id, label: site.name })) },
                { name: "note", label: "Ghi chú khác" },
              ]}
              onSaved={() => router.push(`/production-cycles/${id}/harvest`)}
            />
            <EvidencePanel entityType="CYCLE" entityId={id} onUploaded={evidence.reload} />
            </>
          )}
          {view === "journal" && (
            <EvidencePanel entityType="CYCLE" entityId={id} />
          )}
          {["care-new", "harvest-new", "plant"].includes(view) && !canWrite && (
            <p className="notice error" role="alert">
              Bạn không có quyền ghi nghiệp vụ cho vụ này.
            </p>
          )}
        </>
      )}
    </div>
  );
}
