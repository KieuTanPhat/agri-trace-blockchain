"use client";

import { useEffect, useState } from "react";
import { FileText, Loader2 } from "lucide-react";
import { useLedgerQuery } from "@/lib/ledger/data";
import { ledgerRequest } from "@/lib/ledger/request";
import type { components } from "@/lib/generated/api";
import { Callout, ErrorState, Section } from "@/components/ledger/kit/page";
import { Button } from "@/components/ledger/ui/button";
import { fmtDateTime } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";

type File = components["schemas"]["ServiceContractFileView"];
export function ContractPdf({
  kind,
  id,
  expectedSha256,
  onReady,
}: {
  kind: "preview" | "order";
  id: string;
  expectedSha256: string;
  onReady?: (ready: boolean) => void;
}) {
  const q = useLedgerQuery({
    queryKey: ["service-pdf", kind, id],
    queryFn: () =>
      ledgerRequest<File>(
        `/enterprise-service/documents/${kind}/${encodeURIComponent(id)}`,
      ),
    staleTime: Infinity,
    gcTime: 0,
  });
  const [file, setFile] = useState<{ id: string; url: string } | null>(null),
    [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    let active = true,
      url: string | undefined;
    onReady?.(false);
    if (q.data)
      void (async () => {
        const bytes = Uint8Array.from(atob(q.data.contentBase64), (c) =>
          c.charCodeAt(0),
        );
        // WebCrypto is unavailable on plain HTTP LAN development origins.
        // The server/SQL always verifies stored bytes; HTTPS also verifies them here.
        const digest = globalThis.crypto?.subtle
          ? Array.from(
              new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)),
              (b) => b.toString(16).padStart(2, "0"),
            ).join("")
          : expectedSha256;
        if (
          q.data.sha256 !== expectedSha256 ||
          digest !== q.data.sha256 ||
          new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-"
        )
          throw Error(tr("Không xác minh được bản PDF. Vui lòng tải lại."));
        if (!active) return;
        url = URL.createObjectURL(
          new Blob([bytes], { type: "application/pdf" }),
        );
        setFile({ id, url });
        setError(null);
        onReady?.(true);
      })().catch((e) => {
        if (active) {
          setError(e instanceof Error ? e : Error(tr("Không mở được PDF")));
          onReady?.(false);
        }
      });
    return () => {
      active = false;
      if (url) URL.revokeObjectURL(url);
    };
  }, [q.data, id, expectedSha256, onReady]);
  if (q.error || error)
    return (
      <ErrorState error={q.error ?? error} onRetry={() => void q.refetch()} />
    );
  const url = file?.id === id ? file.url : null;
  if (!url)
    return (
      <div
        role="status"
        className="flex min-h-72 items-center justify-center gap-2 text-ink-2"
      >
        <Loader2 className="size-5 animate-spin" />
        {tr("Đang chuẩn bị bản PDF…")}
      </div>
    );
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-sm">
          <FileText className="size-4" />
          {tr("Hợp đồng đã điền thông tin")}
        </p>
        <Button asChild variant="outline" size="sm">
          <a href={url} download="hop-dong-agritrace.pdf">
            {tr("Tải PDF")}
          </a>
        </Button>
      </div>
      <iframe
        title={tr("Xem hợp đồng dịch vụ PDF")}
        src={url + "#toolbar=1"}
        className="h-[65vh] min-h-96 w-full rounded-md border border-line bg-surface"
      />
      <p className="text-xs text-ink-2">
        {tr(
          "Nếu trình duyệt không hiển thị PDF, tải tệp để xem trước khi xác nhận.",
        )}
      </p>
    </div>
  );
}
const labels: Record<string, string> = {
  SERVICE_PLAN_SELECTED: "Đã chọn gói dịch vụ",
  SERVICE_CONTRACT_PREVIEWED: "Đã lập bản PDF để kiểm tra",
  SERVICE_CONTRACT_ACCEPTED: "Đã xác nhận hợp đồng",
  SERVICE_PAYMENT_CONFIRMED: "Đã xác nhận thanh toán",
  SERVICE_PAYMENT_SIMULATED: "Đã thanh toán mô phỏng",
  ENTERPRISE_SERVICE_ACTIVATED: "Đã kích hoạt dịch vụ",
};
export function ContractHistory({
  history,
}: {
  history: components["schemas"]["ServiceContractHistoryView"][];
}) {
  return (
    <Section title={tr("Lịch sử giao dịch")} bodyClassName="p-4">
      {history.length ? (
        <ol className="space-y-4">
          {history.map((h) => (
            <li key={h.id} className="flex items-start gap-3 text-sm">
              <span className="mt-1.5 size-2 shrink-0 rounded-full bg-brand" />
              <div>
                <p className="font-medium">
                  {tr(labels[h.action] ?? h.action)}
                </p>
                <time className="text-xs text-ink-2" dateTime={h.occurredAt}>
                  {fmtDateTime(h.occurredAt)}
                </time>
              </div>
            </li>
          ))}
        </ol>
      ) : (
        <Callout>
          {tr(
            "Chưa có giao dịch. Lịch sử được ghi khi bạn lập và xác nhận hợp đồng.",
          )}
        </Callout>
      )}
    </Section>
  );
}
