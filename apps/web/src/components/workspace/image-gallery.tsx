"use client";

import Image from "next/image";
import { useEffect, useId, useMemo, useRef, useState, type FormEvent, type ReactNode } from "react";
import { request } from "@/lib/api-client";
import {
  errorMessage,
  useWorkspaceCommand,
  useWorkspaceData,
  type Items,
  type Overview,
  type TraceEvidence,
} from "@/lib/workspace";
import { CommandState, LoadState } from "@/components/manage";
import { evidenceOptions } from "./evidence-panel";

/** Any stored file that can be fetched as base64 content. */
type ThumbRow = { id: string; fileName: string; mediaType: string; description?: string | null };
type LoadedOf<T extends ThumbRow> = { id: string; url: string | null; row: T };
type Loaded = LoadedOf<TraceEvidence>;
const evidenceContent = (id: string) => `/enterprise-workspace/evidence/${id}/content`;

/** Current files of a record (newest first, corrections hidden) as small
 * thumbnails. A click opens the photo large; PDFs download instead. */
export function ImageGallery({
  entityType,
  entityId,
  kinds,
  canRemove = false,
  reloadKey = 0,
  onChanged,
  emptyText = "Chưa có hình ảnh.",
  trailing,
  orderPath,
}: {
  entityType: string;
  entityId: string;
  kinds?: string[];
  canRemove?: boolean;
  reloadKey?: number;
  onChanged?: () => void;
  emptyText?: string;
  /** Rendered as the last tile of the grid, e.g. the "add photo" picker. */
  trailing?: ReactNode;
  /** When set, tiles are numbered and can be dragged; the new order is saved
   * here. Tile 1 is the main photo. */
  orderPath?: string;
}) {
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const scope = new URLSearchParams({ entityType, entityId });
  const state = useWorkspaceData<Items<TraceEvidence>>(
    `/enterprise-workspace/evidence?${scope}`,
  );
  const [open, setOpen] = useState<Loaded | null>(null);
  const [removing, setRemoving] = useState<Loaded | null>(null);
  const [error, setError] = useState("");
  const labels = Object.fromEntries(
    evidenceOptions(entityType).map((o) => [o.value, o.label]),
  );
  const kindKey = (kinds ?? []).join(",");
  const seenKey = useRef(reloadKey);
  const reload = useRef(state.reload);
  reload.current = state.reload;
  useEffect(() => {
    if (seenKey.current === reloadKey) return;
    seenKey.current = reloadKey;
    reload.current();
  }, [reloadKey]);
  const items = state.data?.items;
  const current = useMemo(() => {
    const rows = items ?? [];
    const wanted = kindKey ? kindKey.split(",") : null;
    return rows.filter(
      (row) =>
        (!wanted || wanted.includes(row.kind)) &&
        !rows.some((newer) => newer.supersedesId === row.id),
    );
  }, [items, kindKey]);
  const loaded = useEvidenceThumbs(current);
  const orderCmd = useWorkspaceCommand();
  const [order, setOrder] = useState<string[] | null>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [over, setOver] = useState<string | null>(null);
  // A local order only lasts until the list is loaded again.
  useEffect(() => setOrder(null), [items]);
  const files = order
    ? order.map((id) => loaded.find((f) => f.id === id)).filter((f): f is Loaded => !!f)
    : loaded;
  const canOrder = !!orderPath && files.length > 1;
  async function move(from: string, to: string) {
    if (!orderPath || from === to) return;
    const ids = files.map((f) => f.id);
    const next = ids.filter((id) => id !== from);
    next.splice(next.indexOf(to) + (ids.indexOf(from) < ids.indexOf(to) ? 1 : 0), 0, from);
    setOrder(next);
    // Keep the local order on success; reloading would only redraw the tiles.
    if (!(await orderCmd.run(orderPath, { order: next }, "POST", { confirmed: true }))) setOrder(null);
  }

  async function download(row: TraceEvidence) {
    setError("");
    try {
      const file = await request<{ fileName: string; mediaType: string; contentBase64: string }>(
        `/enterprise-workspace/evidence/${row.id}/content`,
      );
      const bytes = Uint8Array.from(atob(file.contentBase64), (c) => c.charCodeAt(0));
      const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = file.fileName;
      anchor.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    } catch (cause) {
      setError(errorMessage(cause));
    }
  }

  if (!overview.data?.permissions.includes("evidence.read")) return null;
  const removable =
    canRemove && overview.data.permissions.includes("evidence.manage");
  return (
    <div className="image-gallery">
      {!state.data && <LoadState {...state} />}
      {error && <p className="notice error" role="alert">{error}</p>}
      {orderCmd.error && <p className="notice error" role="alert">{orderCmd.error}</p>}
      {state.data && !files.length && !trailing && <p className="muted">{emptyText}</p>}
      {canOrder && <p className="muted image-gallery-hint">Kéo ảnh sang ô khác để đổi thứ tự. Ô 1 là ảnh chính.</p>}
      <ul className="image-gallery-grid">
        {files.map((file, index) => (
          <li
            key={file.id}
            className={`image-gallery-item${canOrder ? " is-orderable" : ""}${over === file.id && dragging !== file.id ? " is-drop-target" : ""}${dragging === file.id ? " is-dragging" : ""}`}
            draggable={canOrder && !orderCmd.pending}
            onDragStart={(event) => {
              event.dataTransfer.effectAllowed = "move";
              event.dataTransfer.setData("text/plain", file.id);
              setDragging(file.id);
            }}
            onDragEnd={() => {
              setDragging(null);
              setOver(null);
            }}
            onDragOver={(event) => {
              if (!canOrder || !dragging) return;
              event.preventDefault();
              setOver(file.id);
            }}
            onDrop={(event) => {
              event.preventDefault();
              const from = dragging ?? event.dataTransfer.getData("text/plain");
              setDragging(null);
              setOver(null);
              if (from) void move(from, file.id);
            }}
          >
            {orderPath && (
              <span className={`image-gallery-index${index === 0 ? " is-main" : ""}`} title={index === 0 ? "Ảnh chính" : `Ô ${index + 1}`}>
                {index + 1}
              </span>
            )}
            <button
              type="button"
              className="image-gallery-thumb"
              title={file.row.fileName}
              onClick={() => (file.url ? setOpen(file) : void download(file.row))}
            >
              {file.url ? (
                <Image src={file.url} alt={file.row.fileName} width={96} height={96} unoptimized />
              ) : (
                <span>{file.row.mediaType === "application/pdf" ? "PDF" : "…"}</span>
              )}
            </button>
            <small>{orderPath && index === 0 ? "Ảnh chính" : (labels[file.row.kind] ?? "Tệp khác")}</small>
            {removable && (
              <button
                type="button"
                className="image-gallery-remove"
                aria-label={`Gỡ ảnh ${file.row.fileName}`}
                title="Gỡ ảnh"
                onClick={() => setRemoving(file)}
              >
                ×
              </button>
            )}
          </li>
        ))}
        {trailing && <li className="image-gallery-item image-gallery-trailing">{trailing}</li>}
      </ul>
      <Lightbox file={open} onClose={() => setOpen(null)} label={open ? labels[open.row.kind] : ""} />
      <RemoveDialog
        file={removing}
        onClose={() => setRemoving(null)}
        onRemoved={() => {
          setRemoving(null);
          state.reload();
          onChanged?.();
        }}
      />
    </div>
  );
}

/** Object URLs for the image rows (PDFs get none), revoked when rows change. */
export function useEvidenceThumbs<T extends ThumbRow>(
  rows: T[],
  contentPath: (id: string) => string = evidenceContent,
) {
  const [urls, setUrls] = useState<Map<string, string | null>>(new Map());
  // Keyed by the set of ids: reordering the same rows reuses loaded images.
  const setKey = rows.map((row) => row.id).sort().join(",");
  const latest = useRef({ rows, contentPath });
  latest.current = { rows, contentPath };
  useEffect(() => {
    let active = true;
    const created: string[] = [];
    Promise.all(
      latest.current.rows.map(async (row): Promise<[string, string | null]> => {
        if (!row.mediaType.startsWith("image/")) return [row.id, null];
        try {
          type Content = { mediaType: string; contentBase64: string };
          // Some endpoints wrap the file as { record }.
          const body = await request<Content | { record: Content }>(latest.current.contentPath(row.id));
          const file = "record" in body ? body.record : body;
          const bytes = Uint8Array.from(atob(file.contentBase64), (c) => c.charCodeAt(0));
          const url = URL.createObjectURL(new Blob([bytes], { type: file.mediaType }));
          created.push(url);
          return [row.id, url];
        } catch {
          return [row.id, null];
        }
      }),
    ).then((pairs) => {
      if (active) setUrls(new Map(pairs));
      else created.forEach((url) => URL.revokeObjectURL(url));
    });
    return () => {
      active = false;
      created.forEach((url) => URL.revokeObjectURL(url));
    };
  }, [setKey]);
  return useMemo(
    () =>
      urls.size || !rows.length
        ? rows.map((row) => ({ id: row.id, url: urls.get(row.id) ?? null, row }))
        : [],
    [rows, urls],
  );
}

/** Given evidence rows as photo thumbnails with a large view; PDFs and files
 * that cannot be shown open `onOpenFile` (a download) instead. */
export function EvidenceThumbnails<T extends ThumbRow>({
  rows,
  caption,
  onOpenFile,
  contentPath,
}: {
  rows: T[];
  caption: (row: T) => string;
  onOpenFile: (row: T) => void;
  /** Where a row's base64 content is read; evidence files by default. */
  contentPath?: (id: string) => string;
}) {
  const files = useEvidenceThumbs(rows, contentPath);
  const [open, setOpen] = useState<LoadedOf<T> | null>(null);
  return (
    <>
      <ul className="image-gallery-grid">
        {files.map((file) => (
          <li key={file.id} className="image-gallery-item">
            <button
              type="button"
              className="image-gallery-thumb"
              title={file.row.description ? `${file.row.fileName} — ${file.row.description}` : file.row.fileName}
              onClick={() => (file.url ? setOpen(file) : onOpenFile(file.row))}
            >
              {file.url ? (
                <Image src={file.url} alt={file.row.fileName} width={96} height={96} unoptimized />
              ) : (
                <span>{file.row.mediaType === "application/pdf" ? "PDF" : "…"}</span>
              )}
            </button>
            <small title={caption(file.row)}>{caption(file.row)}</small>
          </li>
        ))}
      </ul>
      <Lightbox file={open} onClose={() => setOpen(null)} label={open ? caption(open.row) : ""} />
    </>
  );
}

function useModal(open: boolean) {
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) {
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");
    }
    if (!open && node.open) {
      if (typeof node.close === "function") node.close();
      else node.removeAttribute("open");
    }
  }, [open]);
  return dialog;
}

export function Lightbox({ file, label, onClose }: { file: LoadedOf<ThumbRow> | null; label?: string; onClose: () => void }) {
  const dialog = useModal(!!file);
  const titleId = useId();
  return (
    <dialog
      ref={dialog}
      className="image-lightbox"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <button type="button" className="image-lightbox-close" aria-label="Đóng ảnh" onClick={onClose}>
        ×
      </button>
      {file?.url && (
        <figure>
          <Image src={file.url} alt={file.row.fileName} width={1600} height={1200} unoptimized />
          <figcaption id={titleId}>
            <strong>{label || file.row.fileName}</strong>
            {file.row.description && <span>{file.row.description}</span>}
          </figcaption>
        </figure>
      )}
    </dialog>
  );
}

function RemoveDialog({ file, onClose, onRemoved }: { file: Loaded | null; onClose: () => void; onRemoved: () => void }) {
  const dialog = useModal(!!file);
  const cmd = useWorkspaceCommand();
  const [reason, setReason] = useState("");
  // No <form> here: the gallery sits inside the product edit form, and a
  // nested form would submit (and be blocked by) the outer one.
  async function submit() {
    if (!file || reason.trim().length < 5) return;
    if (
      await cmd.run(
        `/enterprise-workspace/evidence/${file.id}/withdraw`,
        { reason: reason.trim() },
        "POST",
        { confirmed: true },
      )
    ) {
      setReason("");
      onRemoved();
    }
  }
  return (
    <dialog
      ref={dialog}
      className="command-dialog"
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <div className="workspace-form">
        <h2>Gỡ ảnh khỏi sản phẩm</h2>
        <p className="muted">
          Ảnh &quot;{file?.row.fileName}&quot; không còn hiển thị. File gốc vẫn được lưu để đối soát.
          Sản phẩm đang bán cần còn ít nhất ba ảnh.
        </p>
        <CommandState command={cmd} />
        <label>
          Lý do gỡ ảnh
          <textarea
            className="input"
            minLength={5}
            maxLength={500}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </label>
        <div className="dialog-actions">
          <button type="button" className="button secondary" disabled={cmd.pending} onClick={onClose}>
            Hủy
          </button>
          <button type="button" className="button danger" disabled={cmd.pending || reason.trim().length < 5} onClick={() => void submit()}>
            {cmd.pending ? "Đang gỡ…" : "Gỡ ảnh"}
          </button>
        </div>
      </div>
    </dialog>
  );
}

/** Adds photos to an existing record: type, one or more files and a note. */
export function ImageUpload({
  entityType,
  entityId,
  onUploaded,
  title = "Bổ sung hình ảnh",
  compact = false,
}: {
  entityType: string;
  entityId: string;
  onUploaded?: () => void;
  title?: string;
  compact?: boolean;
}) {
  const overview = useWorkspaceData<Overview>("/enterprise-workspace");
  const options = evidenceOptions(entityType);
  const [kind, setKind] = useState(options[0]?.value ?? "OTHER");
  const [pending, setPending] = useState(false);
  const [note, setNote] = useState("");
  const [error, setError] = useState("");
  const compactFileInput = useRef<HTMLInputElement>(null);
  if (!overview.data?.permissions.includes("evidence.manage")) return null;
  async function uploadFiles(files: File[], typed: string, reset?: () => void) {
    if (!files.length) return setError("Chọn ít nhất một ảnh.");
    if (compact && files.length > 5) return setError("Mỗi lần chọn tối đa 5 ảnh.");
    if (files.some((f) => f.size > 5 * 1024 * 1024)) return setError("Mỗi ảnh tối đa 5 MB.");
    const label = options.find((o) => o.value === kind)?.label ?? "Hình ảnh";
    const trimmed = typed.trim();
    const imageDescription = trimmed.length >= 10 ? trimmed : `${label} — bổ sung ngày ${new Date().toLocaleDateString("vi-VN")}${trimmed ? ` · ${trimmed}` : ""}`;
    setPending(true);
    setError("");
    setNote("");
    const failed: string[] = [];
    for (const file of files) {
      const body = new FormData();
      body.set("entityType", entityType);
      body.set("entityId", entityId);
      body.set("kind", kind);
      body.set("file", file);
      body.set("description", imageDescription.slice(0, 1000));
      try {
        await request("/enterprise-workspace/evidence", {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body,
        });
      } catch (cause) {
        failed.push(`${file.name} (${errorMessage(cause)})`);
      }
    }
    setPending(false);
    if (failed.length) setError(`Chưa tải được: ${failed.join(", ")}`);
    else {
      setNote(`Đã tải ${files.length} ảnh.`);
      reset?.();
    }
    onUploaded?.();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const files = data.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
    await uploadFiles(files, String(data.get("description") ?? ""), () => form.reset());
  }

  if (compact) {
    return (
      <div className="product-image-upload">
        <label className="product-image-picker" title="Tối đa 5 ảnh mỗi lần, PNG/JPG, ≤ 5 MB mỗi ảnh">
          <span className="product-image-picker-icon" aria-hidden="true">+</span>
          <strong>Thêm ảnh</strong>
          <small>PNG/JPG ≤ 5 MB</small>
          <input
            ref={compactFileInput}
            className="product-image-picker-input"
            aria-label="Chọn ảnh sản phẩm"
            type="file"
            multiple
            accept="image/png,image/jpeg"
            disabled={pending}
            onChange={(event) => {
              const selected = Array.from(event.target.files ?? []);
              if (selected.length > 5) {
                setError("Mỗi lần chọn tối đa 5 ảnh.");
                event.target.value = "";
                return;
              }
              setError("");
              setNote("");
              const input = event.target;
              void uploadFiles(selected, "", () => {
                input.value = "";
              });
            }}
          />
        </label>
        {pending && <small role="status">Đang tải ảnh…</small>}
        {error && <p className="notice error" role="alert">{error}</p>}
        {note && <p className="notice" role="status">{note}</p>}
      </div>
    );
  }

  return (
    <form className="workspace-form image-upload" onSubmit={submit}>
      <fieldset className="enterprise-fields" disabled={pending}>
        <legend>{title}</legend>
        <label>
          Loại ảnh
          <select className="input" value={kind} onChange={(e) => setKind(e.target.value)}>
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Tải ảnh (PNG/JPEG, tối đa 5 MB mỗi ảnh)
          <input className="input" type="file" name="files" multiple accept="image/png,image/jpeg" required />
        </label>
        <label>
          Mô tả ảnh (không bắt buộc)
          <textarea className="input" name="description" maxLength={900} rows={2} />
        </label>
      </fieldset>
      {error && <p className="notice error" role="alert">{error}</p>}
      {note && <p className="notice" role="status">{note}</p>}
      <button className="button" disabled={pending}>
        {pending ? "Đang tải…" : "Bổ sung hình ảnh"}
      </button>
    </form>
  );
}
