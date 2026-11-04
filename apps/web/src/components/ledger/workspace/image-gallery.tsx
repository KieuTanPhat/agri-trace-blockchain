"use client";
import { useEffect, useState } from "react";
import type { components } from "@/lib/generated/api";
import { verifiedEvidenceBlob } from "@/lib/ledger/workspace-protocol";
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
