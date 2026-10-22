"use client";
import { useId, type ReactNode } from "react";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
/** Escape/backdrop closes the review; submission stays with the caller. */
export function InfoDialog({ open, title, description, rows, children, actions, onClose }: {
  open: boolean; title: string; description?: string; rows: [string, ReactNode][];
  children?: ReactNode; actions: ReactNode; onClose(): void;
}) {
  const descriptionId = useId();
  return <Dialog open={open} onOpenChange={value => { if (!value) onClose(); }}>
    <DialogContent showCloseButton={false} aria-describedby={description ? descriptionId : undefined}>
      <DialogHeader><DialogTitle>{title}</DialogTitle>{description && <DialogDescription id={descriptionId}>{description}</DialogDescription>}</DialogHeader>
      <dl className="dialog-summary">{rows.filter(([, value]) => value !== undefined && value !== null && value !== "").map(([label, value]) => <div key={label} className="info-dialog-row"><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
      {children}
      <DialogFooter>{actions}</DialogFooter>
    </DialogContent>
  </Dialog>;
}
