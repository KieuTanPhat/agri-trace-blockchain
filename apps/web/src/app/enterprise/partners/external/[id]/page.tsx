"use client";

import { useParams } from "next/navigation";
import { EvidencePanel } from "@/components/workspace/evidence-panel";
import { LoadState, PageHeader } from "@/components/manage";
import { useWorkspaceData, type Items } from "@/lib/workspace";

type ExternalPartner = { id: string; name: string; businessId: string; kind: string; address: string; phone: string | null; email: string | null; taxCode: string | null; representative: string | null; note: string | null };
const kinds: Record<string, string> = { FARM: "Nhà sản xuất", TRANSPORTER: "Nhà vận chuyển", DISTRIBUTOR: "Nhà phân phối", RETAILER: "Nhà bán lẻ" };

export default function Page() {
  const { id } = useParams<{ id: string }>();
  const state = useWorkspaceData<Items<ExternalPartner>>("/enterprise-workspace/partners/external");
  const partner = state.data?.items.find((item) => item.id === id);
  return <div className="manage-console">
    <PageHeader title={partner?.name ?? "Hồ sơ đối tác"} description="Doanh nghiệp ngoài hệ thống được lưu để tham chiếu; hồ sơ này không cấp quyền ký hoặc nhận hàng." back="/enterprise/partners" backLabel="Doanh nghiệp liên kết" />
    <LoadState {...state} />
    {partner ? <>
      <section className="panel manage-detail-grid">
        <p><strong>Mã doanh nghiệp:</strong> {partner.businessId}</p>
        <p><strong>Loại hình:</strong> {kinds[partner.kind] ?? partner.kind}</p>
        <p><strong>Địa chỉ:</strong> {partner.address}</p>
        <p><strong>Điện thoại:</strong> {partner.phone ?? "—"}</p>
        <p><strong>Email:</strong> {partner.email ?? "—"}</p>
        <p><strong>Mã số thuế:</strong> {partner.taxCode ?? "—"}</p>
        <p><strong>Người đại diện:</strong> {partner.representative ?? "—"}</p>
        <p><strong>Ghi chú:</strong> {partner.note ?? "—"}</p>
      </section>
      <EvidencePanel entityType="EXTERNAL_PARTNER" entityId={partner.id} />
    </> : !state.loading && !state.error && <p className="notice">Không tìm thấy hồ sơ trong doanh nghiệp của bạn.</p>}
  </div>;
}
