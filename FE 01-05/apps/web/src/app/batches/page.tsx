import Link from "next/link";
import { IconPackage, IconChevronRight, IconLeaf } from "@/components/icons";
import { StateBadge } from "@/components/state-badge";
import { getBatches } from "@/lib/api-client";

export default async function BatchesPage() {
  const batches = await getBatches();

  return (
    <>
      <section className="page-header">
        <div className="page-header-icon">
          <IconPackage size={22} />
        </div>
        <div>
          <p className="eyebrow">Quản lý lô</p>
          <h1>Danh sách lô nông sản</h1>
          <p className="muted">Theo dõi trạng thái, timeline và thao tác được backend cho phép trên từng lô.</p>
        </div>
      </section>

      <section className="table-list">
        {batches.map((batch) => (
          <Link className="list-row" href={`/batches/${batch.batchId}`} key={batch.batchId}>
            <div className="list-row-content">
              <div className="list-row-icon">
                <IconLeaf size={16} />
              </div>
              <div>
                <h3>{batch.productName}</h3>
                <p className="muted">{batch.batchCode} — {batch.farmOrg.name}</p>
              </div>
            </div>
            <div className="list-row-actions">
              <StateBadge state={batch.currentState} />
              <IconChevronRight size={14} className="list-arrow" />
            </div>
          </Link>
        ))}
      </section>
    </>
  );
}
