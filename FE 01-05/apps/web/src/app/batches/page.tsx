import Link from "next/link";
import { StateBadge } from "@/components/state-badge";
import { getBatches } from "@/lib/api-client";

export default async function BatchesPage() {
  const batches = await getBatches();

  return (
    <>
      <section className="page-header">
        <div>
          <p className="eyebrow">Quản lý lô</p>
          <h1>Danh sách lô</h1>
          <p className="muted">Theo dõi trạng thái, timeline và thao tác được backend cho phép trên từng lô.</p>
        </div>
      </section>

      <section className="table-list">
        {batches.map((batch) => (
          <Link className="list-row" href={`/batches/${batch.batchId}`} key={batch.batchId}>
            <div>
              <h3>{batch.productName}</h3>
              <p className="muted">{batch.batchCode} - {batch.farmOrg.name}</p>
            </div>
            <StateBadge state={batch.currentState} />
          </Link>
        ))}
      </section>
    </>
  );
}
