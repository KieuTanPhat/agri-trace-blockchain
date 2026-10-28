"use client";

import { useId, useState } from "react";
import { useLedgerQuery as useQuery, useLedgerQueryClient as useQueryClient } from "@/lib/ledger/data";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { ImagePlus, Loader2 } from "lucide-react";
import { wapi } from "@/lib/ledger/workspace-api";
import type { EvidenceEntity } from "@/lib/ledger/workspace-types";
import { newLedgerCommandKey } from "@/lib/ledger/command-context";
import { ledgerCommandError } from "@/lib/ledger/command-context";
import { t as tr } from "@/lib/ledger/i18n";
import { cn } from "@/lib/ledger/utils";
import { EvidenceThumb } from "./evidence-panel";

const MAX_BYTES = 5 * 1024 * 1024;

/**
 * Chọn ảnh hiện hành (chưa bị đính chính) của một đối tượng theo loại — dùng khi lệnh nghiệp vụ
 * tham chiếu chứng cứ (evidenceRef + additionalEvidenceRefs). Ảnh đầu tiên được chọn là ảnh chính.
 * Ảnh mới tải ngay tại đây được lưu thành chứng cứ của đối tượng rồi tự được chọn.
 */
export function EvidencePick<T extends FieldValues>({ control, name, label, entityType, entityId, kind, min = 1, max = 5 }: { control: Control<T>; name: Path<T>; label: string; entityType: EvidenceEntity; entityId: string; kind: string; min?: number; max?: number }) {
  const key = ["ws-evidence", entityType, entityId];
  const qc = useQueryClient();
  const inputId = useId();
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);
  const q = useQuery({ queryKey: key, queryFn: () => wapi.evidence({ entityType, entityId }) });
  const superseded = new Set((q.data ?? []).map((e) => e.supersedesId).filter(Boolean));
  const rows = (q.data ?? []).filter((e) => e.kind === kind && !superseded.has(e.id) && e.mediaType.startsWith("image/"));
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value = (field.value ?? []) as string[];
        const toggle = (id: string) => field.onChange(value.includes(id) ? value.filter((x) => x !== id) : max === 1 ? [id] : [...value, id].slice(0, max));
        const upload = async (files: File[]) => {
          setUploadError(null);
          const bad = files.find((f) => !/^image\/(png|jpeg)$/.test(f.type) || f.size <= 0 || f.size > MAX_BYTES);
          if (bad) return setUploadError(tr("Ảnh PNG hoặc JPEG, tối đa 5 MB"));
          setUploading(true);
          const added: string[] = [];
          try {
            for (const file of files.slice(0, Math.max(1, max - value.length))) {
              // Each photo is its own evidence command with a fresh key.
              const result = await wapi.uploadEvidence({ file, entityType, entityId, kind, description: tr("{p0} · {p1}", { p0: label, p1: file.name }).slice(0, 1000).padEnd(10, ".") }, { idempotencyKey: newLedgerCommandKey() });
              added.push(String(result.record.id));
            }
          } catch (cause) {
            setUploadError(ledgerCommandError(cause).message);
          } finally {
            setUploading(false);
            await qc.invalidateQueries({ queryKey: key });
            if (added.length) field.onChange(max === 1 ? [added[added.length - 1]] : [...value, ...added].slice(0, max));
          }
        };
        return (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-medium">
              {label}{min > 0 && <span aria-hidden className="text-danger after:content-['*']" />} <span className="font-normal text-ink-2">({min === max ? min : `${min}–${max}`})</span>
            </legend>
            {q.isLoading ? (
              <span className="text-[12.5px] text-ink-2">{tr("Đang tải…")}</span>
            ) : (
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                {rows.map((e) => {
                  const i = value.indexOf(e.id);
                  return (
                    <button
                      key={e.id}
                      type="button"
                      aria-pressed={i >= 0}
                      aria-label={e.description}
                      onClick={() => toggle(e.id)}
                      className={cn("relative flex flex-col items-start gap-1 rounded-md border p-1 text-left", i >= 0 ? "border-brand ring-2 ring-brand/40" : "border-line hover:border-line-strong")}
                    >
                      <EvidenceThumb evidence={e} />
                      {i >= 0 && (
                        <span className="absolute top-1.5 left-1.5 rounded bg-brand px-1.5 font-mono text-[10.5px] font-semibold text-white">
                          {i === 0 && max > 1 ? tr("Ảnh chính") : i + 1}
                        </span>
                      )}
                      <span className="line-clamp-1 w-full text-[11px] text-ink-2">{e.fileName}</span>
                    </button>
                  );
                })}
                {value.length < max && (
                  <label htmlFor={inputId} className={cn("flex min-h-20 cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed border-line-strong text-[12px] text-ink-2 hover:border-brand hover:text-brand-ink", uploading && "pointer-events-none opacity-60")}>
                    {uploading ? <Loader2 className="size-5 animate-spin" aria-hidden /> : <ImagePlus className="size-5" aria-hidden />}
                    {uploading ? tr("Đang tải ảnh…") : tr("Tải / chụp ảnh")}
                  </label>
                )}
              </div>
            )}
            <input
              id={inputId}
              type="file"
              accept="image/png,image/jpeg"
              multiple={max > 1}
              className="sr-only"
              disabled={uploading}
              onChange={(e) => {
                const files = Array.from(e.target.files ?? []);
                e.target.value = "";
                if (files.length) void upload(files);
              }}
            />
            <span className={cn("text-[12px]", uploadError || fieldState.error ? "text-danger" : "text-ink-2")}>
              {uploadError ?? fieldState.error?.message ?? tr("Bấm ảnh để chọn/bỏ chọn. Ảnh mới tải lên được lưu vào hồ sơ ảnh của vụ.")}
            </span>
          </fieldset>
        );
      }}
    />
  );
}
