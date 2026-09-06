import Link from "next/link";
import { IconPackage } from "@/components/icons";
import { BatchTable } from "@/components/batch-table";
import { getBatches } from "@/lib/api-client";
import { Plus } from "lucide-react";

export default async function BatchesPage() {
  const batches = await getBatches();
  return <div className="design-page batches-page">
    <section className="page-header">
      <div className="page-header-icon"><IconPackage size={32} /></div>
      <div>
        <p className="eyebrow">Quản lý lô</p>
        <h1>Danh sách lô nông sản</h1>
        <p className="muted">Theo dõi trạng thái, timeline và thao tác được backend cho phép trên từng lô.</p>
      </div>
      <div className="header-actions">
        <button className="button"><Plus size={18} /> Tạo lô mới</button>
      </div>
    </section>
    <BatchTable batches={batches} />
  </div>;
}
