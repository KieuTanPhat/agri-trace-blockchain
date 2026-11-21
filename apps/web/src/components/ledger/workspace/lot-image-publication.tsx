"use client";

import Image from "next/image";
import { z } from "zod";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { wapi } from "@/lib/ledger/workspace-api";
import type { Evidence } from "@/lib/ledger/workspace-types";
import { verifiedEvidenceBlob } from "@/lib/ledger/workspace-protocol";
import { t as tr } from "@/lib/ledger/i18n";
import { CommandDialog } from "@/components/ledger/kit/command-dialog";
import { Callout, ErrorState, LoadingRows } from "@/components/ledger/kit/page";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ledger/ui/dialog";
import { useEvidenceObjectUrl } from "./image-gallery";

const confirmationSchema = z.object({
  publicationConfirmed: z.boolean().refine(value => value, { error: () => tr("Xác nhận đồng ý công khai ảnh trước khi tiếp tục") }),
});

/** Publish a verified copy through the existing append-only evidence command. */
export function LotImagePublication({ open, onOpenChange, evidence, onDone }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  evidence: Evidence;
  onDone?: () => void;
}) {
  const q = useQuery({ queryKey: ["ws-evidence-content", evidence.id], queryFn: () => wapi.evidenceContent(evidence.id), enabled: open, retry: false });
  const content = q.data;
  const matches = content?.sha256 === evidence.sha256 && content?.mediaType === evidence.mediaType;
  const preview = useEvidenceObjectUrl(matches && !q.error ? content : undefined);
  const error = q.error ?? preview.error ?? (content && !matches ? new Error(tr("Ảnh không khớp chứng cứ đã chọn. Đóng và tải lại dữ liệu.")) : undefined);
  const title = tr("Công khai ảnh lô");
  if (error || !content || !preview.url) return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader><DialogTitle>{title}</DialogTitle><DialogDescription>{tr("Kiểm tra ảnh trước khi công khai.")}</DialogDescription></DialogHeader>
        {error ? <ErrorState error={error} onRetry={() => q.refetch()} /> : <LoadingRows rows={3} />}
      </DialogContent>
    </Dialog>
  );
  return (
    <CommandDialog
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={tr("Ảnh này sẽ hiển thị cho mọi người qua mã QR, danh mục sản phẩm và ứng dụng. Bản riêng tư và lịch sử vẫn được lưu.")}
      endpoint="POST /enterprise-workspace/evidence"
      schema={confirmationSchema}
      defaultValues={{ publicationConfirmed: false }}
      submitLabel={tr("Xác nhận công khai")}
      success={tr("Đã công khai ảnh lô. Bạn có thể tải lại ảnh trên ứng dụng nhân viên.")}
      invalidate={[["ws-evidence", "LOT", evidence.entityId]]}
      onDone={onDone}
      run={async (values, cmd) => {
        const blob = await verifiedEvidenceBlob(content);
        const file = new File([blob], content.fileName, { type: content.mediaType, lastModified: new Date(evidence.createdAt).getTime() });
        return wapi.uploadEvidence({ file, entityType: "LOT", entityId: evidence.entityId, kind: "LOT_IMAGE", description: evidence.description, supersedesId: evidence.id, siteId: evidence.siteId ?? undefined, public: true, publicationConfirmed: values.publicationConfirmed }, cmd);
      }}
    >
      {form => <>
        <Image unoptimized width={640} height={480} src={preview.url!} alt={evidence.description} className="max-h-[35vh] w-full rounded border border-line bg-sunken object-contain" />
        <p className="break-all text-sm text-ink-2">{evidence.description}</p>
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1 shrink-0" {...form.register("publicationConfirmed")} aria-invalid={!!form.formState.errors.publicationConfirmed} aria-describedby="publication-confirmation-error" />
          {tr("Tôi đồng ý công khai ảnh này cho mọi người xem qua QR và danh mục sản phẩm.")}
        </label>
        {form.formState.errors.publicationConfirmed && <Callout tone="warn"><span id="publication-confirmation-error">{form.formState.errors.publicationConfirmed.message}</span></Callout>}
      </>}
    </CommandDialog>
  );
}
