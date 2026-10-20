"use client";
import { useEffect, useId, useRef, type ReactNode } from "react";

/**
 * Modal summary of label/value rows, used to confirm a record before it is
 * created and to show what was created. Escape or the backdrop never submits.
 */
export function InfoDialog({
  open,
  title,
  description,
  rows,
  children,
  actions,
  onClose,
}: {
  open: boolean;
  title: string;
  description?: string;
  rows: [string, ReactNode][];
  children?: ReactNode;
  actions: ReactNode;
  onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const titleId = useId();
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
  return (
    <dialog
      ref={dialog}
      className="command-dialog info-dialog"
      aria-labelledby={titleId}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
    >
      <h2 id={titleId}>{title}</h2>
      {description && <p className="muted">{description}</p>}
      <dl className="dialog-summary">
        {rows
          .filter(([, value]) => value !== undefined && value !== null && value !== "")
          .map(([label, value]) => (
            <div key={label} className="info-dialog-row">
              <dt>{label}</dt>
              <dd>{value}</dd>
            </div>
          ))}
      </dl>
      {children}
      <div className="dialog-actions">{actions}</div>
    </dialog>
  );
}
