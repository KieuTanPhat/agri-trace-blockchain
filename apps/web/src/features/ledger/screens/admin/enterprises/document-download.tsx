"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import type { components } from "@/lib/generated/api";
import { ledgerRequest } from "@/lib/ledger/request";
import { getLedgerError } from "@/lib/ledger/errors";
import { t } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ledger/ui/dialog";
type S = components["schemas"];
export function RegistrationDocumentDownload({
  document,
}: {
  document: S["RegistrationDocumentViewDto"];
}) {
  return (
    <PrivateDocumentDownload
      fileName={document.fileName}
      load={() =>
        ledgerRequest<S["RegistrationDocumentContentDto"]>(
          `/enterprise-registration-documents/${encodeURIComponent(document.id)}`,
        )
      }
    />
  );
}
export function AmendmentEvidenceDownload({
  amendmentId,
  document,
}: {
  amendmentId: string;
  document: S["ProfileAmendmentEvidenceDto"];
}) {
  return (
    <PrivateDocumentDownload
      fileName={document.fileName}
      load={async () =>
        (
          await ledgerRequest<S["ProfileEvidenceContentRecordDto"]>(
            `/enterprise-profile-amendments/${encodeURIComponent(amendmentId)}/evidence/${encodeURIComponent(document.id)}`,
          )
        ).record
      }
    />
  );
}
/** Opens the private file in a preview (images and PDF in place) with a
 * download button; the object URL lives only while the preview is open. */
function PrivateDocumentDownload({
  fileName,
  load,
}: {
  fileName: string;
  load: () => Promise<{
    contentBase64: string;
    fileName: string;
    mediaType: string;
  }>;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [preview, setPreview] = useState<{ url: string; name: string; mediaType: string } | null>(null),
    busy = useRef(false);
  const close = () => {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
  };
  const image = preview?.mediaType.startsWith("image/");
  const pdf = preview?.mediaType === "application/pdf";
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <Button
        variant="link"
        type="button"
        className="h-auto justify-start truncate p-0 text-left text-[13px] font-normal"
        aria-label={`${t("Xem tệp")} ${fileName}`}
        disabled={pending}
        onClick={async () => {
          if (busy.current) return;
          busy.current = true;
          setPending(true);
          setError("");
          try {
            const data = await load();
            const bytes = Uint8Array.from(atob(data.contentBase64), (char) =>
              char.charCodeAt(0),
            );
            setPreview({
              url: URL.createObjectURL(new Blob([bytes], { type: data.mediaType })),
              name: data.fileName,
              mediaType: data.mediaType,
            });
          } catch (cause) {
            setError(
              getLedgerError(cause)?.message ?? t("Không tải được tài liệu."),
            );
          } finally {
            busy.current = false;
            setPending(false);
          }
        }}
      >
        {pending ? t("Đang tải…") : fileName}
      </Button>
      {error && (
        <span role="alert" className="text-[12px] text-danger">
          {error}
        </span>
      )}
      <Dialog open={!!preview} onOpenChange={(open) => !open && close()}>
        <DialogContent className="sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle className="truncate">{preview?.name}</DialogTitle>
          </DialogHeader>
          {preview && image ? (
            <Image unoptimized src={preview.url} alt={preview.name} width={1200} height={900} className="h-auto max-h-[70vh] w-full rounded border border-line bg-sunken object-contain" />
          ) : preview && pdf ? (
            <iframe src={preview.url} title={preview.name} className="h-[70vh] w-full rounded border border-line" />
          ) : (
            <p className="text-[13px] text-ink-2">{t("Không xem trước được loại tệp này; hãy tải về để mở.")}</p>
          )}
          {preview && (
            <div className="flex justify-end">
              <Button asChild size="sm" variant="outline">
                <a href={preview.url} download={preview.name}>{t("Tải về")}</a>
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </span>
  );
}
