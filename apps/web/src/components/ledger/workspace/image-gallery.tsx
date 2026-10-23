"use client";
import { useEffect, useState } from "react";
import Image from "next/image";
import type { components } from "@/lib/generated/api";
import { verifiedEvidenceBlob } from "@/lib/ledger/workspace-protocol";
import { useLedgerQuery } from "@/lib/ledger/data";
import { wapi } from "@/lib/ledger/workspace-api";
import type { Evidence } from "@/lib/ledger/workspace-types";
import { Callout, LoadingRows } from "@/components/ledger/kit/page";
type Content = components["schemas"]["EvidenceContentDto"];
/** Every authorized content response is hash checked; object URLs end with their owning view. */
export function useEvidenceObjectUrl(file?: Content) {
  const [state, setState] = useState<{ file: Content; url?: string; error?: Error }>();
  useEffect(() => {
    if (!file) return;
    let disposed = false;
    let url: string | undefined;
    void verifiedEvidenceBlob(file).then(blob => {
      const next = URL.createObjectURL(blob);
      if (disposed) URL.revokeObjectURL(next);
      else { url = next; setState({ file, url: next }); }
    }).catch((error: unknown) => { if (!disposed) setState({ file, error: error instanceof Error ? error : new Error(String(error)) }); });
    return () => { disposed = true; if (url) URL.revokeObjectURL(url); };
  }, [file]);
  return state?.file === file ? { url: state?.url, error: state?.error } : {};
}
function EvidenceImage({ row }: { row: Evidence }) {
  const query = useLedgerQuery({ queryKey: ["ws-evidence-content", row.id], queryFn: () => wapi.evidenceContent(row.id), retry: false });
  const content = useEvidenceObjectUrl(query.error ? undefined : query.data);
  if (query.error || content.error) return <Callout tone="warn">{query.error?.message ?? content.error?.message}</Callout>;
  if (!content.url) return <LoadingRows rows={1}/>;
  return <figure className="min-w-0 rounded-md border border-line bg-card p-2"><Image unoptimized width={800} height={600} src={content.url} alt={row.description} className="h-36 w-full rounded border border-line bg-sunken object-contain"/><figcaption className="mt-2 truncate text-[12px] text-ink-2">{row.fileName}</figcaption></figure>;
}
export function ImageGallery({ rows }: { rows: Evidence[] }) {
  return <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">{rows.filter(row => row.mediaType.startsWith("image/")).map(row => <EvidenceImage key={row.id} row={row}/>)}</div>;
}
