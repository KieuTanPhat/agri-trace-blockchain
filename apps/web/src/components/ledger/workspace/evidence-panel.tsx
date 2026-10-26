"use client";

import { useMemo, useState } from "react";
import Image from "next/image";
import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { Controller } from "react-hook-form";
import { z } from "zod";
import { FileText, ImageIcon, Upload } from "lucide-react";
import { wapi } from "@/lib/ledger/workspace-api";
import type { Evidence, EvidenceEntity } from "@/lib/ledger/workspace-types";
import { fmtDateTime, fmtNumber } from "@/lib/ledger/format";
import { localized, t as tr } from "@/lib/ledger/i18n";
import { Button } from "@/components/ledger/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ledger/ui/dialog";
import { Input } from "@/components/ledger/ui/input";
import { Label } from "@/components/ledger/ui/label";
import { CommandDialog, useDialog } from "@/components/ledger/kit/command-dialog";
import { SelectField, TextAreaField } from "@/components/ledger/kit/form-fields";
import { Callout, EmptyState, ErrorState, LoadingRows } from "@/components/ledger/kit/page";
import { Badge } from "@/components/ledger/kit/status";
import { cn } from "@/lib/ledger/utils";
import { useEvidenceObjectUrl } from "./image-gallery";
import { useFilePreviews } from "./photo-picker";

export const EVIDENCE_KIND_LABEL: Record<string, string> = localized({
  OTHER: "Khác",
  PRODUCT_IMAGE: "Ảnh sản phẩm",
  INSPECTION_IMAGE: "Ảnh kiểm tra",
  AREA_IMAGE: "Ảnh vùng sản xuất",
  LAND_CERTIFICATE: "Giấy quyền sử dụng đất",
  PRODUCTION_CONTRACT: "Hợp đồng sản xuất",
  QUALITY_CERTIFICATE: "Chứng nhận chất lượng",
  MATERIAL_IMAGE: "Ảnh vật tư",
  SEED_IMAGE: "Ảnh giống",
  CERTIFICATE_IMAGE: "Ảnh chứng nhận",
  SITE_IMAGE: "Ảnh cơ sở",
  BUSINESS_LICENSE: "Giấy phép kinh doanh",
  MEMBER_AVATAR: "Ảnh đại diện",
  MEMBER_DOCUMENT: "Giấy tờ thành viên",
  PARTNER_LOGO: "Logo đối tác",
  PARTNERSHIP_EVIDENCE: "Bằng chứng hợp tác",
  CYCLE_IMAGE: "Ảnh vụ sản xuất",
  CARE_IMAGE: "Ảnh nhật ký chăm sóc",
  HARVEST_IMAGE: "Ảnh thu hoạch",
  LOT_IMAGE: "Ảnh lô hàng",
  LOT_DOCUMENT: "Chứng từ lô",
});
/** Loại chứng cứ cho phép theo đối tượng — evidenceKinds trong enterprise-resources.service.ts. */
export const EVIDENCE_KINDS: Partial<Record<EvidenceEntity, string[]>> = {
  CHAIN: ["CHAIN_IMAGE", "OTHER"],
  SITE_TRANSFER: ["TRANSFER_IMAGE", "OTHER"],
  TRANSFER: ["TRANSFER_IMAGE", "INSPECTION_IMAGE", "OTHER"],
  QUARANTINE: ["QUARANTINE_IMAGE", "INSPECTION_IMAGE", "CERTIFICATE_IMAGE", "OTHER"],
  CYCLE_DRAFT: ["CYCLE_IMAGE", "CERTIFICATE_IMAGE", "OTHER"],
  PRODUCT: ["PRODUCT_IMAGE", "INSPECTION_IMAGE", "OTHER"],
  FARM: ["LAND_CERTIFICATE", "OTHER"],
  SITE: ["SITE_IMAGE", "BUSINESS_LICENSE", "QUALITY_CERTIFICATE", "INSPECTION_IMAGE", "OTHER"],
  MATERIAL: ["SEED_IMAGE", "MATERIAL_IMAGE", "CERTIFICATE_IMAGE", "INSPECTION_IMAGE", "OTHER"],
  PROFILE: ["BUSINESS_LICENSE", "CERTIFICATE_IMAGE", "OTHER"],
  CYCLE: ["CARE_IMAGE", "HARVEST_IMAGE", "LOT_IMAGE", "CYCLE_IMAGE", "CERTIFICATE_IMAGE", "OTHER"],
  LOT: ["LOT_IMAGE", "LOT_DOCUMENT", "INSPECTION_IMAGE", "OTHER"],
  MEMBER: ["MEMBER_AVATAR", "MEMBER_DOCUMENT", "OTHER"],
  EXTERNAL_PARTNER: ["PARTNER_LOGO", "PARTNERSHIP_EVIDENCE", "BUSINESS_LICENSE", "CERTIFICATE_IMAGE", "INSPECTION_IMAGE", "OTHER"],
};
/** Loại chỉ nhận ảnh (PNG/JPEG) — imageOnlyKinds. */
const IMAGE_ONLY = new Set(["CYCLE_IMAGE", "CARE_IMAGE", "HARVEST_IMAGE", "LOT_IMAGE", "PRODUCT_IMAGE", "INSPECTION_IMAGE", "AREA_IMAGE", "LAND_CERTIFICATE", "PRODUCTION_CONTRACT", "QUALITY_CERTIFICATE", "MATERIAL_IMAGE", "SEED_IMAGE", "CERTIFICATE_IMAGE", "SITE_IMAGE", "PARTNER_LOGO", "PARTNERSHIP_EVIDENCE", "MEMBER_AVATAR", "TRANSFER_IMAGE", "CHAIN_IMAGE", "QUARANTINE_IMAGE"]);
const MAX_BYTES = 5 * 1024 * 1024;

const uploadSchema = z
  .object({
    file: z.instanceof(File, { error: () => tr("Chọn tệp") }).refine((f) => f.size > 0 && f.size <= MAX_BYTES, { error: () => tr("Tệp từ 1 byte đến 5 MB") }),
    kind: z.string().min(1, { error: () => tr("Chọn loại") }),
    description: z.string().trim().min(10, { error: () => tr("Tối thiểu 10 ký tự") }).max(1000),
    supersedesId: z.string().optional(),
  })
  .refine((v) => !IMAGE_ONLY.has(v.kind) || /^image\/(png|jpeg)$/.test(v.file.type), { path: ["file"], error: () => tr("Loại này chỉ nhận ảnh PNG hoặc JPEG") });
const withdrawSchema = z.object({ reason: z.string().trim().min(5, { error: () => tr("Tối thiểu 5 ký tự") }).max(500) });

/** Danh sách chứng cứ hiện hành của một đối tượng; bản đã bị đính chính hoặc gỡ không hiển thị. */
export function EvidencePanel({
  entityType,
  entityId,
  canManage,
  required,
  title = tr("Ảnh & chứng từ"),
  onChanged,
}: {
  entityType: EvidenceEntity;
  entityId: string;
  canManage: boolean;
  /** Loại bắt buộc để hoàn tất hồ sơ: hiển thị đã có/thiếu. */
  required?: { kind: string; min: number }[];
  title?: string;
  onChanged?: () => void;
}) {
  const key = ["ws-evidence", entityType, entityId];
  const q = useQuery({ queryKey: key, queryFn: () => wapi.evidence({ entityType, entityId }) });
  const upload = useDialog<{ supersedes?: Evidence }>();
  const withdraw = useDialog<Evidence>();
  const [view, setView] = useState<Evidence | null>(null);
  const kinds = EVIDENCE_KINDS[entityType] ?? ["OTHER"];
  const superseded = new Set((q.data ?? []).map((e) => e.supersedesId).filter(Boolean));
  const rows = (q.data ?? []).filter((e) => !superseded.has(e.id));
  const count = (kind: string) => rows.filter((e) => e.kind === kind).length;

  return (
    <section className="flex flex-col gap-3" aria-label={title}>
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="text-[13px] font-semibold">{title}</h3>
        <span className="font-mono text-[11.5px] text-ink-2">{rows.length}</span>
        {canManage && (
          <Button size="xs" variant="outline" className="ml-auto" onClick={() => upload.open({})}>
            <Upload /> {tr("Tải lên")}
          </Button>
        )}
      </div>
      {required && required.length > 0 && (
        <ul className="flex flex-wrap gap-1.5" aria-label={tr("Yêu cầu để hoàn tất")}>
          {required.map((r) => {
            const ok = count(r.kind) >= r.min;
            return (
              <li key={r.kind}>
                <Badge tone={ok ? "ok" : "warn"} dot>
                  {EVIDENCE_KIND_LABEL[r.kind] ?? r.kind} {count(r.kind)}/{r.min}
                </Badge>
              </li>
            );
          })}
        </ul>
      )}
      {q.error ? (
        <ErrorState error={q.error} onRetry={() => q.refetch()} />
      ) : q.isLoading ? (
        <LoadingRows rows={2} />
      ) : !rows.length ? (
        <EmptyState title={tr("Chưa có ảnh hoặc chứng từ")} />
      ) : (
        <ul className="divide-y divide-line/70 rounded-md border border-line">
          {rows.map((e, i) => (
            <li key={e.id} className="flex items-start gap-3 px-3 py-2.5">
              <button type="button" onClick={() => setView(e)} aria-label={tr("Xem {p0}", { p0: e.fileName })} className="shrink-0">
                <EvidenceThumb evidence={e} />
              </button>
              <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                <span className="flex flex-wrap items-center gap-1.5">
                  <Badge tone="neutral" dot={false}>{EVIDENCE_KIND_LABEL[e.kind] ?? e.kind}</Badge>
                  {entityType === "PRODUCT" && i === 0 && e.kind === "PRODUCT_IMAGE" && <Badge tone="brand" dot={false}>{tr("Ảnh chính")}</Badge>}
                  {e.supersedesId && <Badge tone="info" dot={false}>{tr("Bản đính chính")}</Badge>}
                </span>
                <span className="text-[13px]">{e.description}</span>
                <span className="truncate font-mono text-[11px] text-ink-2">
                  {e.fileName} · {fmtNumber(e.size)} B · sha256 {e.sha256.slice(0, 12)}… · {fmtDateTime(e.createdAt)}
                </span>
              </div>
              <span className="flex shrink-0 flex-col items-end gap-1">
                <Button size="xs" variant="ghost" onClick={() => setView(e)}>{tr("Xem")}</Button>
                {canManage && <Button size="xs" variant="ghost" onClick={() => upload.open({ supersedes: e })}>{tr("Đính chính")}</Button>}
                {canManage && entityType === "PRODUCT" && <Button size="xs" variant="ghost" className="text-danger" onClick={() => withdraw.open(e)}>{tr("Gỡ")}</Button>}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="text-[11.5px] text-ink-2">{tr("PNG, JPEG hoặc PDF tối đa 5 MB; Backend kiểm tra loại tệp theo byte đầu. Chứng cứ không bị xóa: muốn thay bản cũ thì tải bản đính chính cùng loại.")}</p>

      {upload.target && (
        <CommandDialog
          {...upload.props}
          title={upload.target.supersedes ? tr("Đính chính chứng cứ") : tr("Tải ảnh/chứng từ")}
          endpoint="POST /enterprise-workspace/evidence"
          description={upload.target.supersedes ? tr("Bản mới thay cho “{p0}”; bản cũ vẫn lưu trong lịch sử.", { p0: upload.target.supersedes.description }) : undefined}
          schema={uploadSchema}
          defaultValues={{ kind: upload.target.supersedes?.kind ?? kinds[0], description: "", supersedesId: upload.target.supersedes?.id }}
          submitLabel={tr("Tải lên")}
          invalidate={[key]}
          onDone={onChanged}
          run={(v, cmd) => wapi.uploadEvidence({ file: v.file, entityType, entityId, kind: v.kind, description: v.description, supersedesId: v.supersedesId || undefined }, cmd)}
        >
          {(f) => (
            <>
              <Controller
                control={f.control}
                name="file"
                render={({ field, fieldState }) => (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="evidence-file">{tr("Tệp")}</Label>
                    <Input id="evidence-file" type="file" accept="image/png,image/jpeg,application/pdf" onChange={(e) => field.onChange(e.target.files?.[0])} aria-invalid={!!fieldState.error} />
                    {field.value instanceof File && <LocalPreview file={field.value} />}
                    <span className={cn("text-[12px]", fieldState.error ? "text-danger" : "text-ink-2")}>{fieldState.error?.message ?? tr("PNG, JPEG hoặc PDF · tối đa 5 MB")}</span>
                  </div>
                )}
              />
              {upload.target?.supersedes ? (
                <p className="text-[13px]">
                  {tr("Loại")}: <strong>{EVIDENCE_KIND_LABEL[upload.target.supersedes.kind] ?? upload.target.supersedes.kind}</strong>
                </p>
              ) : (
                <SelectField control={f.control} name="kind" label={tr("Loại")} options={kinds.map((k) => ({ value: k, label: EVIDENCE_KIND_LABEL[k] ?? k }))} />
              )}
              <TextAreaField control={f.control} name="description" label={tr("Mô tả")} max={1000} />
            </>
          )}
        </CommandDialog>
      )}
      {withdraw.target && (
        <CommandDialog
          {...withdraw.props}
          title={tr("Gỡ ảnh sản phẩm")}
          endpoint="POST /enterprise-workspace/evidence/:id/withdraw"
          description={tr("Ảnh không bị xóa mà chỉ thôi hiển thị. Sản phẩm đang bán cần giữ ít nhất một ảnh sản phẩm.")}
          schema={withdrawSchema}
          defaultValues={{ reason: "" }}
          tone="danger"
          submitLabel={tr("Gỡ")}
          invalidate={[key]}
          onDone={onChanged}
          run={(v, cmd) => wapi.withdrawEvidence(withdraw.target!.id, v, cmd)}
        >
          {(f) => <TextAreaField control={f.control} name="reason" label={tr("Lý do")} max={500} />}
        </CommandDialog>
      )}
      <EvidenceViewer evidence={view} onClose={() => setView(null)} />
    </section>
  );
}

/** Ảnh thu nhỏ đã kiểm sha256; PDF hiện biểu tượng. */
export function EvidenceThumb({ evidence }: { evidence: Evidence }) {
  const image = evidence.mediaType.startsWith("image/");
  const q = useQuery({ queryKey: ["ws-evidence-content", evidence.id], queryFn: () => wapi.evidenceContent(evidence.id), enabled: image, retry: false });
  const verified = useEvidenceObjectUrl(image && !q.error ? q.data : undefined);
  return (
    <span className="relative inline-flex size-14 items-center justify-center overflow-hidden rounded border border-line bg-sunken text-ink-2">
      {verified.url ? <Image unoptimized fill src={verified.url} alt={evidence.description} className="object-cover" /> : image ? <ImageIcon className="size-4" aria-hidden /> : <FileText className="size-4" aria-hidden />}
    </span>
  );
}

function LocalPreview({ file }: { file: File }) {
  const [url] = useFilePreviews(useStableFiles(file));
  if (!file.type.startsWith("image/")) return <span className="text-[12px] text-ink-2">{file.name}</span>;
  return url ? <Image unoptimized width={320} height={240} src={url} alt={file.name} className="max-h-48 w-auto rounded border border-line bg-sunken object-contain" /> : null;
}
function useStableFiles(file: File) {
  return useMemo(() => [file], [file]);
}

function EvidenceViewer({ evidence, onClose }: { evidence: Evidence | null; onClose: () => void }) {
  const q = useQuery({ queryKey: ["ws-evidence-content", evidence?.id], queryFn: () => wapi.evidenceContent(evidence!.id), enabled: !!evidence, retry: false });
  const verified = useEvidenceObjectUrl(evidence && !q.error ? q.data : undefined);
  const src = verified.url ?? null;
  return (
    <Dialog open={!!evidence} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>{evidence ? EVIDENCE_KIND_LABEL[evidence.kind] ?? evidence.kind : ""}</DialogTitle>
          <DialogDescription>{evidence?.description}</DialogDescription>
        </DialogHeader>
        {q.error || verified.error ? (
          <Callout tone="info">{q.error?.message ?? verified.error?.message}</Callout>
        ) : !q.data || !src ? (
          <LoadingRows rows={2} />
        ) : q.data.mediaType === "application/pdf" ? (
          <a className="text-brand-ink underline underline-offset-2" href={src!} download={q.data.fileName}>
            {tr("Tải tệp PDF")} · {q.data.fileName}
          </a>
        ) : (
          <Image unoptimized width={800} height={600} src={src!} alt={evidence?.description ?? ""} className="max-h-[60vh] w-full rounded border border-line bg-sunken object-contain [image-rendering:pixelated]" />
        )}
        {q.data && <p className="font-mono text-[11px] break-all text-ink-2">sha256 {q.data.sha256}</p>}
      </DialogContent>
    </Dialog>
  );
}
