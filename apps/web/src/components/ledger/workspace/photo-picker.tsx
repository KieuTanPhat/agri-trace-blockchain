"use client";

import { useEffect, useId, useState } from "react";
import Image from "next/image";
import { ImagePlus, X } from "lucide-react";
import { t as tr } from "@/lib/ledger/i18n";
import { cn } from "@/lib/ledger/utils";
import { Label } from "@/components/ledger/ui/label";

/** Object URLs for local files, revoked when the list changes or unmounts. */
export function useFilePreviews(files: File[]) {
  const [urls, setUrls] = useState<string[]>([]);
  useEffect(() => {
    const next = files.map((f) => URL.createObjectURL(f));
    setUrls(next);
    return () => next.forEach((u) => URL.revokeObjectURL(u));
  }, [files]);
  return urls;
}

/** Chọn nhiều ảnh và xem trước trước khi gửi; ảnh đầu tiên là ảnh chính. */
export function PhotoPicker({
  label,
  files,
  onChange,
  error,
  hint,
  required,
  mainBadge = true,
}: {
  label: string;
  files: File[];
  onChange: (files: File[]) => void;
  error?: string;
  hint?: string;
  required?: boolean;
  /** Label the first photo as the main one (product photos). */
  mainBadge?: boolean;
}) {
  const id = useId();
  const urls = useFilePreviews(files);
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} className="gap-0.5">{label}{required && <span aria-hidden className="text-danger after:content-['*']" />}</Label>
      <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
        {files.map((file, i) => (
          <figure
            key={`${file.name}-${file.lastModified}-${i}`}
            className="relative aspect-square overflow-hidden rounded-md border border-line bg-sunken"
          >
            {urls[i] && (
              <Image
                unoptimized
                fill
                src={urls[i]}
                alt={file.name}
                className="object-cover"
              />
            )}
            {mainBadge && i === 0 && (
              <span className="absolute bottom-1 left-1 rounded bg-card/90 px-1.5 text-[10.5px] font-semibold text-brand-ink">
                {tr("Ảnh chính")}
              </span>
            )}
            <button
              type="button"
              aria-label={tr("Bỏ ảnh {p0}", { p0: file.name })}
              onClick={() => onChange(files.filter((_, j) => j !== i))}
              className="absolute top-1 right-1 inline-flex size-6 items-center justify-center rounded-full bg-card/90 text-ink hover:bg-card"
            >
              <X className="size-3.5" />
            </button>
          </figure>
        ))}
        <label
          htmlFor={id}
          className={cn(
            "flex aspect-square cursor-pointer flex-col items-center justify-center gap-1 rounded-md border border-dashed text-[12px] text-ink-2 hover:border-brand hover:text-brand-ink",
            error ? "border-danger" : "border-line-strong",
          )}
        >
          <ImagePlus className="size-5" aria-hidden />
          {tr("Thêm ảnh")}
        </label>
      </div>
      <input
        id={id}
        type="file"
        multiple
        accept="image/png,image/jpeg"
        className="sr-only"
        aria-invalid={!!error}
        onChange={(e) => {
          const picked = Array.from(e.target.files ?? []);
          if (picked.length) onChange([...files, ...picked]);
          e.target.value = "";
        }}
      />
      <span className={cn("text-[12px]", error ? "text-danger" : "text-ink-2")}>
        {error ?? hint}
      </span>
    </div>
  );
}
