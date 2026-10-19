"use client";

import { useParams, useRouter } from "next/navigation";
import { DataForm } from "@/components/data-form";
import { LoadState, PageHeader } from "@/components/manage";
import { useWorkspaceData } from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
import { EvidencePanel } from "@/components/workspace/evidence-panel";

type Draft = { id: string; name: string; cycleCode: string; version: number; farmId: string; plotId: string; productId: string };

export default function DraftPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const drafts = useWorkspaceData<{ items: Draft[] }>("/production-cycles/drafts");
  const chains = useWorkspaceData<components["schemas"]["ChainContextDto"]>("/chain-permissions");
  const draft = drafts.data?.items.find((item) => item.id === id);
  return <div className="manage-console">
    <PageHeader title={draft ? `Liên kết ${draft.name}` : "Liên kết vụ nháp"} description="Chỉ sau khi liên kết chuỗi đang hoạt động và binding Fabric hợp lệ, vụ mới nhận nhật ký và thu hoạch." back="/production-cycles" backLabel="Vụ sản xuất" />
    <LoadState {...drafts} />
    <LoadState {...chains} />
    {draft && <section className="panel"><p><strong>Mã vụ:</strong> {draft.cycleCode}</p><p className="muted">Dữ liệu vụ được giữ nguyên khi liên kết. Mã hồ sơ vẫn là mã đã tạo.</p></section>}
    {draft && chains.data?.productionChains?.length ? <DataForm
      title="Liên kết chuỗi"
      path={`/production-cycles/drafts/${draft.id}/link`}
      extra={{ version: draft.version }}
      onSaved={() => router.push(`/production-cycles/${draft.id}`)}
      fields={[{ name: "chainId", label: "Chuỗi được cấp quyền", required: true, options: chains.data.productionChains.map((chain) => ({ value: chain.id, label: chain.name })) }]}
      freezeOnUnknown
    /> : draft && !chains.loading && <p className="notice">Chưa có chuỗi sản xuất được cấp quyền. Chủ chuỗi cần cấp quyền và kích hoạt binding trước khi liên kết.</p>}
    {draft && <>
      <p className="notice">Ảnh tải ở bước nháp được lưu ngay. Khi liên kết chuỗi, mỗi ảnh được ghi sự kiện “đính kèm chứng cứ” lên sổ cái cùng lúc với vụ.</p>
      <EvidencePanel entityType="CYCLE_DRAFT" entityId={draft.id} />
    </>}
    {!draft && !drafts.loading && !drafts.error && <p className="notice">Vụ nháp không còn trong danh sách của doanh nghiệp.</p>}
  </div>;
}
