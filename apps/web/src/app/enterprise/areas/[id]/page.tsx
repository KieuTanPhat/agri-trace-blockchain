"use client";
import { Button } from "@/components/ui/button";

import Link from "next/link";
import { useParams } from "next/navigation";
import { EvidencePanel } from "@/components/workspace/evidence-panel";
import { CommandState, LoadState, PageHeader } from "@/components/manage";
import { useWorkspaceData, useWorkspaceCommand, type Catalog, type EnterpriseSite, type Items, type ProductionMaterial } from "@/lib/workspace";

export default function AreaDetailPage() {
  const { id } = useParams<{ id: string }>();
  const state = useWorkspaceData<Catalog>("/catalog");
  const complete = useWorkspaceCommand();
  const farm = state.data?.farms.find((item) => item.id === id);
  const plots = state.data?.plots.filter((item) => item.farmId === id) ?? [];
  const materials = useWorkspaceData<Items<ProductionMaterial>>("/enterprise-workspace/materials");
  const sites = useWorkspaceData<Items<EnterpriseSite>>("/enterprise-workspace/sites");
  const materialNames = (ids: string[] = []) =>
    ids.map((mid) => materials.data?.items.find((m) => m.id === mid)?.name ?? "Không còn quyền xem").join(", ") || "—";
  return <div className="manage-console">
    <PageHeader title={farm?.name ?? "Vùng sản xuất"} back="/enterprise/areas" description="Hồ sơ vùng sản xuất, thửa đất và chứng cứ thuộc tổ chức của bạn." />
    <LoadState {...state} />
    {state.data && !farm && <p className="notice error" role="alert">Không tìm thấy vùng sản xuất trong phạm vi của bạn.</p>}
    {farm && <>
      <section className="manage-section">
        <div className="manage-section-heading"><div><h2>Thông tin vùng</h2></div></div>
        <dl className="manage-detail-list">
          <div><dt>Tên vùng</dt><dd>{farm.name}</dd></div>
          <div><dt>Mã nội bộ</dt><dd>{farm.internalCode ?? "—"}</dd></div>
          <div><dt>Loại</dt><dd>{farm.kind ?? "—"}</dd></div>
          <div><dt>Khu vực</dt><dd>{farm.region ?? "—"}</dd></div>
          <div><dt>Địa chỉ</dt><dd>{farm.address ?? farm.location ?? "—"}</dd></div>
          <div><dt>Diện tích</dt><dd>{farm.areaM2 ?? "—"} m²</dd></div>
          <div><dt>Sản lượng dự kiến</dt><dd>{farm.expectedOutput ?? "—"} {farm.outputUnit ?? ""}</dd></div>
          <div><dt>Mã vụ trồng</dt><dd>{farm.cropCode ?? "—"}</dd></div>
          <div><dt>Vật tư đầu vào</dt><dd>{materialNames(farm.inputMaterialIds)}</dd></div>
          <div><dt>Loại giống</dt><dd>{materialNames(farm.seedMaterialIds)}</dd></div>
          <div><dt>Nhà xưởng liên kết</dt><dd>{farm.linkedSiteId ? sites.data?.items.find((site) => site.id === farm.linkedSiteId)?.name ?? "—" : "—"}</dd></div>
          <div><dt>Quyền hiển thị</dt><dd>{farm.privacy === "PUBLIC" ? "Công khai" : "Riêng tư"}</dd></div>
          <div><dt>Trạng thái</dt><dd>{farm.evidenceComplete ? "Đã hoàn tất hồ sơ" : "Chờ đủ ảnh/chứng từ"}</dd></div>
        </dl>
      </section>
      {!farm.evidenceComplete && <section className="panel"><p className="notice">Bổ sung ảnh vùng, giấy đất, hợp đồng liên kết, chứng nhận chất lượng và kiểm định rồi hoàn tất hồ sơ.</p><CommandState command={complete}/><Button className="button" disabled={complete.pending || complete.frozen} onClick={async () => { if (await complete.run(`/catalog/farms/${id}/complete`, { version: farm.version })) state.reload(); }}>Hoàn tất và kích hoạt vùng</Button></section>}
      <section className="manage-section">
        <div className="manage-section-heading"><div><h2>Thửa đất</h2><p>Thửa đất thuộc vùng sản xuất này.</p></div><Link className="button secondary" href={`/enterprise/areas/plots/new?farmId=${id}`}>Thêm thửa đất</Link></div>
        {plots.length ? <ul className="manage-area-plots">{plots.map((plot) => <li key={plot.id}><strong>{plot.name}</strong><span>{plot.area ?? "—"} {plot.unit ?? ""} · {plot.location ?? "Chưa có địa chỉ"}</span></li>)}</ul> : <p className="manage-empty">Chưa có thửa đất.</p>}
      </section>
      <EvidencePanel entityType="FARM" entityId={id} />
    </>}
  </div>;
}
