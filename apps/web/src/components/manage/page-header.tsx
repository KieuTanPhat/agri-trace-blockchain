"use client";

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
        {description && <p className="manage-description">{description}</p>}
      </div>
      {(action || actions) && (
        <div className="manage-header-actions">
          {actions}
          {action && (
            <Link className="button manage-primary-action" href={action.href}>
              {action.label}
            </Link>
          )}
        </div>
      )}
    </header>
  );
}
