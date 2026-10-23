"use client";

import { useLedgerQuery as useQuery } from "@/lib/ledger/data";
import { Controller, type Control, type FieldValues, type Path } from "react-hook-form";
import { wapi } from "@/lib/ledger/workspace-api";
import type { EvidenceEntity } from "@/lib/ledger/workspace-types";
import { fmtDateTime } from "@/lib/ledger/format";
import { t as tr } from "@/lib/ledger/i18n";
import { Checkbox } from "@/components/ledger/ui/checkbox";

/**
 * Chọn ảnh hiện hành (chưa bị đính chính) của một đối tượng theo loại — dùng khi lệnh nghiệp vụ
 * tham chiếu chứng cứ (evidenceRef + additionalEvidenceRefs). Ảnh đầu tiên được chọn là ảnh chính.
 */
export function EvidencePick<T extends FieldValues>({ control, name, label, entityType, entityId, kind, min = 1, max = 5 }: { control: Control<T>; name: Path<T>; label: string; entityType: EvidenceEntity; entityId: string; kind: string; min?: number; max?: number }) {
  const q = useQuery({ queryKey: ["ws-evidence", entityType, entityId], queryFn: () => wapi.evidence({ entityType, entityId }) });
  const superseded = new Set((q.data ?? []).map((e) => e.supersedesId).filter(Boolean));
  const rows = (q.data ?? []).filter((e) => e.kind === kind && !superseded.has(e.id) && e.mediaType.startsWith("image/"));
  return (
    <Controller
      control={control}
      name={name}
      render={({ field, fieldState }) => {
        const value = (field.value ?? []) as string[];
        return (
          <fieldset className="flex flex-col gap-1.5">
            <legend className="mb-1 text-[13px] font-medium">
              {label} <span className="font-normal text-ink-2">({min === max ? min : `${min}–${max}`})</span>
            </legend>
            {q.isLoading ? (
              <span className="text-[12.5px] text-ink-2">{tr("Đang tải…")}</span>
            ) : rows.length ? (
              rows.map((e) => {
                const i = value.indexOf(e.id);
                return (
                  <label key={e.id} className="flex items-start gap-2 text-[13px]">
                    <Checkbox
                      className="mt-0.5"
                      checked={i >= 0}
                      onCheckedChange={(c) => field.onChange(c ? (max === 1 ? [e.id] : [...value, e.id].slice(0, max)) : value.filter((x) => x !== e.id))}
                    />
                    <span className="flex flex-col">
                      <span>
                        {e.description} {i === 0 && max > 1 && <span className="text-[11.5px] text-brand-ink">· {tr("Ảnh chính")}</span>}
                      </span>
                      <span className="font-mono text-[11px] text-ink-2">{e.fileName} · {fmtDateTime(e.createdAt)}</span>
                    </span>
                  </label>
                );
              })
            ) : (
              <span className="text-[12.5px] text-ink-2">{tr("Chưa có ảnh phù hợp — tải ảnh ở khối Ảnh & chứng từ trước.")}</span>
            )}
            {fieldState.error && <span className="text-[12px] text-danger">{fieldState.error.message}</span>}
          </fieldset>
        );
      }}
    />
  );
}
