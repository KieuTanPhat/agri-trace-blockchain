"use client";

import Link from "next/link";
import { useEffect, useRef } from "react";
import type { NavItem } from "@/lib/management-routes";

/** Personal pages and sign-out, collapsed under the signed-in user's name. */
export function AccountMenu({
  fullName,
  roleName,
  links,
  pathname,
  onLogout,
}: {
  fullName: string;
  roleName: string;
  links: NavItem[];
  pathname: string;
  onLogout(): void;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  useEffect(() => {
    const close = (event: MouseEvent | KeyboardEvent) => {
      const details = menu.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent) {
        if (event.key !== "Escape") return;
        details.open = false;
        details.querySelector("summary")?.focus();
      } else if (!details.contains(event.target as Node)) details.open = false;
    };
    document.addEventListener("mousedown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("mousedown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  return (
    <details className="account-menu" ref={menu}>
      <summary aria-label={`Tài khoản: ${fullName}`}>
        <span className="workspace-avatar" aria-hidden="true">
          {fullName.slice(0, 2).toUpperCase()}
        </span>
        <span className="account-menu-name">
          {fullName}
          <small>{roleName}</small>
        </span>

      </summary>
      <div className="account-menu-panel">
        <div className="account-menu-user">
          <strong>{fullName}</strong>
          <span>{roleName}</span>
        </div>
        {links.map(({ href, label }) => (
          <Link key={href} href={href}>
            {label}
          </Link>
        ))}
        <button type="button" onClick={onLogout}>
           Đăng xuất
        </button>
      </div>
    </details>
  );
}
