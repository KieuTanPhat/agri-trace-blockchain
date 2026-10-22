"use client";
import { useRef, useState } from "react";
import type { components } from "@/lib/generated/api";
import { ledgerRequest } from "@/lib/ledger/request";
import { getLedgerError } from "@/lib/ledger/errors";
import { t } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
type S = components["schemas"];
export function RegistrationDocumentDownload({
  document,
}: {
  document: S["RegistrationDocumentViewDto"];
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    busy = useRef(false);
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <Button
        variant="link"
        type="button"
        className="h-auto justify-start truncate p-0 text-left text-[13px] font-normal"
        aria-label={`${t("Tải tệp")} ${document.fileName}`}
        disabled={pending}
        onClick={async () => {
          if (busy.current) return;
          busy.current = true;
          setPending(true);
          setError("");
          let url: string | undefined;
          try {
            const data = await ledgerRequest<
              S["RegistrationDocumentContentDto"]
            >(
              `/enterprise-registration-documents/${encodeURIComponent(document.id)}`,
            );
            const bytes = Uint8Array.from(atob(data.contentBase64), (char) =>
              char.charCodeAt(0),
            );
            url = URL.createObjectURL(
              new Blob([bytes], { type: data.mediaType }),
            );
            const anchor = window.document.createElement("a");
            anchor.href = url;
            anchor.download = data.fileName;
            anchor.click();
          } catch (cause) {
            setError(
              getLedgerError(cause)?.message ?? t("Không tải được tài liệu."),
            );
          } finally {
            if (url) URL.revokeObjectURL(url);
            busy.current = false;
            setPending(false);
          }
        }}
      >
        {pending ? t("Đang tải…") : document.fileName}
      </Button>
      {error && (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      )}
    </span>
  );
}
