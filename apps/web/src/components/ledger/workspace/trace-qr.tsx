"use client";

import { useMemo } from "react";
import { createQrMatrix, createQrSvgPath } from "@/lib/qr-code";
import { publicTraceUrl } from "@/lib/site-origins";
import { getTracePath } from "@/lib/trace-input";
import { t as tr } from "@/lib/ledger/i18n";
import { cn } from "@/lib/ledger/utils";

/** Public trace URL and QR path for a lot's trace token. */
export function useTraceQr(token: string | null) {
  const path = token ? getTracePath(token) : null;
  const url = path && token ? publicTraceUrl(token, typeof window === "undefined" ? "" : window.location.origin) : "";
  const matrix = useMemo(() => (url ? createQrMatrix(url) : []), [url]);
  const size = matrix.length + 8;
  const d = createQrSvgPath(matrix);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${size} ${size}"><rect width="100%" height="100%" fill="white"/><path d="${d}" transform="translate(4 4)" fill="black"/></svg>`;
  return { url, d, size, svg, ready: !!url };
}

export function TraceQrImage({ qr, className }: { qr: ReturnType<typeof useTraceQr>; className?: string }) {
  if (!qr.ready) return null;
  return (
    <svg role="img" aria-label={tr("Mã QR truy xuất")} viewBox={`0 0 ${qr.size} ${qr.size}`} className={cn("bg-white", className)}>
      <rect width="100%" height="100%" fill="white" />
      <path fill="black" d={qr.d} transform="translate(4 4)" />
    </svg>
  );
}

/** Saves the QR as an SVG file named after the lot. */
export function downloadTraceQr(svg: string, name: string) {
  const blob = new Blob([svg], { type: "image/svg+xml" });
  const local = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = local;
  a.download = `qr-${name.replace(/[^\p{L}\p{N}_-]+/gu, "-")}.svg`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(local), 1000);
}
