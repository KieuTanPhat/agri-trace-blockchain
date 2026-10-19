"use client";

import Link from "next/link";
import { isActiveRoute, type NavGroup } from "@/lib/management-routes";

export function NavGroups({
  groups,
  pathname,
  pendingTasks,
  onNavigate,
}: {
  groups: NavGroup[];
  pathname: string;
  pendingTasks: number;
  onNavigate?: () => void;
}) {
  return groups.map((group) => (
    <div className="nav-group" key={group.title}>
      <p className="nav-group-title">{group.title}</p>
      {group.items.map(({ href, label }) => (
        <Link
          className="nav-link"
          href={href}
          key={href}
          title={label}
          aria-current={isActiveRoute(pathname, href) ? "page" : undefined}
          onClick={onNavigate}
        >
          <span>{label}</span>
          {href === "/enterprise/inbox" && pendingTasks > 0 && (
            <span
              className="nav-badge"
              aria-label={`${pendingTasks} việc đang chờ`}
            >
              {pendingTasks > 99 ? "99+" : pendingTasks}
            </span>
          )}
        </Link>
      ))}
    </div>
  ));
}
