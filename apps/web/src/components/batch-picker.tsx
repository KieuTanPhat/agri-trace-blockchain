"use client";

import { useRouter } from "next/navigation";
import type { Batch } from "@/lib/types";

export function BatchPicker({ batches, currentBatchId, basePath }: { batches: Batch[]; currentBatchId: string; basePath: "batches" | "trace" }) {
  const router = useRouter();

  return (
    <div className="field compact-field">
      <label htmlFor={`batch-picker-${basePath}`}>Chọn lô nông sản</label>
      <select
        className="select"
        id={`batch-picker-${basePath}`}
        value={currentBatchId}
        onChange={(event) => router.push(`/${basePath}/${event.target.value}`)}
      >
        {batches.map((batch) => (
          <option key={batch.batchId} value={batch.batchId}>
            {batch.productName} - {batch.batchCode}
          </option>
        ))}
      </select>
    </div>
  );
}
