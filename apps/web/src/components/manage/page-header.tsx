"use client";

import { Button } from "@/components/ui/button";
import { Plus } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

export type PageAction = {
  href: string;
  label: string;
  /** Kept for callers; the header shows text-only actions. */
  kind?: "create" | "open";
};

/** Title block shared by platform and enterprise management pages. */
export function PageHeader({
  title,
  description,
  back,
  backLabel = "Quay lại",
  action,
  actions,
}: {
  /** Kept for callers; page headers no longer show an overline. */
  eyebrow?: string;
  title: string;
  /** Accepted for existing page calls; page descriptions are not displayed. */
  description?: ReactNode;
  back?: string;
  backLabel?: string;
  action?: PageAction;
  /** Kept for callers; the header shows text-only actions. */
  actionKind?: "create" | "open";
  actions?: ReactNode;
}) {
  return (
    <header className="manage-page-header">
      <div>
        {back && (
          <Link className="manage-back" href={back}>
            ← {backLabel}
          </Link>
        )}
        <h1>{title}</h1>
        {description && <div className="manage-page-description">{description}</div>}
      </div>
      {(action || actions) && (
        <div className="manage-header-actions">
          {actions}
          {action && (
            <Button asChild><Link href={action.href}>
              {action.kind === "create" && <Plus size={16} aria-hidden="true" />}
              {action.label}
            </Link></Button>
          )}
        </div>
      )}
    </header>
  );
}
