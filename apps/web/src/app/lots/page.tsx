import { IconPackage } from "@/components/icons";
import { LotTable } from "@/components/lot-table";
import { getLots } from "@/lib/api-client";
import { Plus } from "lucide-react";

export default async function LotsPage() {
  const lots = await getLots();
  return <div className="design-page batches-page">
    <section className="page-header">
      <div className="page-header-icon"><IconPackage size={32} /></div>
      <div>
        <p className="eyebrow">Quản lý lô</p>
        <h1>Danh sách lô nông sản</h1>
        <p className="muted">Theo dõi trạng thái, timeline và thao tác được backend cho phép trên từng lô.</p>
      </div>
      <div className="header-actions">
        <button className="button"><Plus size={18} /> Ghi nhận thu hoạch</button>
      </div>
    </section>
    <LotTable lots={lots} />
  </div>;
}
