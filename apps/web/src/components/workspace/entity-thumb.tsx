"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { request } from "@/lib/api-client";
import type { Items, TraceEvidence } from "@/lib/workspace";

/** First current photo of a record (one of `kinds` in its evidence) as a table
 * thumbnail. Loads lazily per row; shows a placeholder when the record has no
 * photo or the viewer may not read its evidence. */
export function EntityThumb({
  entityType,
  entityId,
  kinds,
  name,
}: {
  entityType: string;
  entityId: string;
  kinds: string[];
  name: string;
}) {
  const [src, setSrc] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const kindKey = kinds.join(",");
  useEffect(() => {
    let active = true;
    let url: string | null = null;
    const wanted = kindKey.split(",");
    const scope = new URLSearchParams({ entityType, entityId });
    request<Items<TraceEvidence>>(`/enterprise-workspace/evidence?${scope}`)
      .then((list) => {
        const photo = list.items.find(
          (row) =>
            wanted.includes(row.kind) &&
            !list.items.some((newer) => newer.supersedesId === row.id),
        );
        if (!photo) return null;
        return request<{ mediaType: string; contentBase64: string }>(
          `/enterprise-workspace/evidence/${photo.id}/content`,
        );
      })
      .then((file) => {
        if (!active || !file || !file.mediaType.startsWith("image/")) return;
        const bytes = Uint8Array.from(atob(file.contentBase64), (char) => char.charCodeAt(0));
        url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
        setSrc(url);
      })
      .catch(() => undefined)
      .finally(() => {
        if (active) setDone(true);
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [entityType, entityId, kindKey]);
  return (
    <span className="product-thumb">
      {src ? (
        <Image src={src} alt={`Ảnh ${name}`} width={56} height={56} unoptimized />
      ) : (
        <span>{done ? "Chưa có ảnh" : "…"}</span>
      )}
    </span>
  );
}

export function ProductThumb({ productId, name }: { productId: string; name: string }) {
  return <EntityThumb entityType="PRODUCT" entityId={productId} kinds={["PRODUCT_IMAGE"]} name={name} />;
}
