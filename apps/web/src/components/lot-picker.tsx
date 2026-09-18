"use client";

import { useRouter } from "next/navigation";
import type { LotTrace } from "@/lib/types";

export function LotPicker({ lots, currentLotId, basePath }: { lots: LotTrace[]; currentLotId: string; basePath: "lots" | "trace" }) {
  const router = useRouter();

  return (
    <div className="field compact-field">
      <label htmlFor={`lot-picker-${basePath}`}>Chọn lô nông sản</label>
      <select
        className="select"
        id={`lot-picker-${basePath}`}
        value={currentLotId}
        onChange={(event) => router.push(`/${basePath}/${event.target.value}`)}
      >
        {lots.map((lot) => (
          <option key={lot.lotId} value={lot.lotId}>
            {lot.productName} - {lot.lotCode}
          </option>
        ))}
      </select>
    </div>
  );
}
