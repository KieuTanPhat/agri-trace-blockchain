"use client";
import { useRef, useState } from "react";
import Image from "next/image";
import type { components } from "@/lib/generated/api";
import { ledgerRequest } from "@/lib/ledger/request";
import { getLedgerError } from "@/lib/ledger/errors";
import { t } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ledger/ui/dialog";
import { useEvidenceObjectUrl } from "@/components/ledger/workspace/image-gallery";
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
function PrivateDocumentDownload({
  fileName,
  load,
}: {
  fileName: string;
  load: () => Promise<{
    contentBase64: string;
    fileName: string;
    mediaType: string;
    sha256: string;
  }>;
}) {
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    busy = useRef(false);
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState<S["EvidenceContentDto"]>();
  const verified = useEvidenceObjectUrl(open ? content : undefined);
  return (
    <span className="flex min-w-0 flex-col gap-1">
      <Button
        variant="link"
        type="button"
        className="h-auto justify-start truncate p-0 text-left text-[13px] font-normal"
        aria-label={`${t("Xem")} ${fileName}`}
        disabled={pending}
        onClick={async () => {
          if (busy.current) return;
          busy.current = true;
          setPending(true);
          setError("");
          setOpen(true);
          setContent(undefined);
          try {
            const data = await load();
            if (
              !["image/png", "image/jpeg", "application/pdf"].includes(
                data.mediaType,
              )
            )
              throw new Error(t("Định dạng tài liệu không được hỗ trợ"));
            setContent(data);
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
      <Dialog
        open={open}
        onOpenChange={(value) => {
          setOpen(value);
          if (!value) setContent(undefined);
        }}
      >
        <DialogContent className="max-h-[90dvh] w-[95vw] overflow-y-auto sm:max-w-4xl">
          <DialogHeader>
            <DialogTitle>{t("Xem tài liệu")}</DialogTitle>
            <DialogDescription className="break-all">
              {fileName}
            </DialogDescription>
          </DialogHeader>
          {error || verified.error ? (
            <p role="alert" className="text-danger">
              {error || verified.error?.message}
            </p>
          ) : !verified.url || !content ? (
            <p role="status">{t("Đang tải…")}</p>
          ) : (
            <>
              {content.mediaType === "application/pdf" ? (
                <iframe
                  title={fileName}
                  src={verified.url}
                  className="h-[65vh] w-full rounded border border-line"
                />
              ) : (
                <Image
                  unoptimized
                  src={verified.url}
                  width={1200}
                  height={900}
                  alt={fileName}
                  className="max-h-[70vh] w-full object-contain"
                />
              )}
              <a
                href={verified.url}
                download={content.fileName}
                className="text-sm text-brand-ink underline"
              >
                {t("Tải tệp")}
              </a>
            </>
          )}
        </DialogContent>
      </Dialog>
    </span>
  );
}
