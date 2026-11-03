"use client";

import { useRef, useState } from "react";
import { Input } from "@/components/ledger/ui/input";
import { newLedgerCommandKey } from "@/lib/ledger/command-context";
import { t as tr } from "@/lib/ledger/i18n";
import { wapi } from "@/lib/ledger/workspace-api";

type Subject = { entityType: "TRANSFER" | "LOT"; entityId: string; kind: "TRANSFER_IMAGE" | "DAMAGE_IMAGE"; siteId?: string; description: string };

/**
 * Up to six photos picked for one command. Each file is uploaded once as
 * private evidence and its id is reused when the command is resent, so a
 * retry never duplicates photos or changes the hashes the command commits to.
 */
export function usePhotoUploads(subject: Subject) {
  const [files, setFiles] = useState<File[]>([]);
  const uploaded = useRef(new Map<File, string>());
  async function upload(siteId = subject.siteId) {
    const ids: string[] = [];
    for (const [i, file] of files.entries()) {
      let id = uploaded.current.get(file);
      if (!id) {
        const result = await wapi.uploadEvidence({ file, entityType: subject.entityType, entityId: subject.entityId, kind: subject.kind, siteId, description: `${subject.description} (${i + 1})` }, { idempotencyKey: newLedgerCommandKey() });
        id = (result as { record: { id: string } }).record.id;
        uploaded.current.set(file, id);
      }
      ids.push(id);
    }
    return ids;
  }
  return { files, setFiles, upload };
}

export function PhotoInput({ label, required, photos }: { label: string; required?: boolean; photos: ReturnType<typeof usePhotoUploads> }) {
  return (
    <label className="flex flex-col gap-1.5 text-sm">
      <span>{label}{required ? " *" : ""}</span>
      <Input type="file" accept="image/png,image/jpeg" capture="environment" multiple onChange={(e) => photos.setFiles(Array.from(e.target.files ?? []).slice(0, 6))} />
      <span className="text-[12.5px] text-muted-foreground">
        {photos.files.length ? tr("Đã chọn {p0} ảnh", { p0: photos.files.length }) : tr("Tối đa 6 ảnh PNG/JPEG, mỗi ảnh tối đa 5 MB")}
      </span>
    </label>
  );
}
