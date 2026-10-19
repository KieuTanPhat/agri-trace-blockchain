"use client";

import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { request } from "@/lib/api-client";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";
import { NOTIFICATIONS_CHANGED_EVENT, stockKinds, transferActions } from "@/lib/task-labels";

type Row = Record<string, unknown>;
type Tasks = { transfers: Row[]; stock: Row[]; counts: { total?: number } };
type Messages = { items: { id: string; subject: string; preview: string; unread: boolean }[]; counts: { unread: number } };
type Item = { key: string; title: string; detail: string; href: string };

/** Work waiting on this account, collapsed under a text button in the top bar.
 * The list is server-scoped and refreshed on navigation and permission changes. */
export function NotificationsMenu({
  enabled,
  scope,
  pathname,
}: {
  enabled: boolean;
  scope: string;
  pathname: string;
}) {
  const menu = useRef<HTMLDetailsElement>(null);
  const [state, setState] = useState<{ scope: string; items: Item[]; total: number; failed: boolean }>({ scope: "", items: [], total: 0, failed: false });
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const refresh = () => setRevision((n) => n + 1);
    window.addEventListener(PERMISSION_SYNC_EVENT, refresh);
    window.addEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    return () => {
      window.removeEventListener(PERMISSION_SYNC_EVENT, refresh);
      window.removeEventListener(NOTIFICATIONS_CHANGED_EVENT, refresh);
    };
  }, []);
  useEffect(() => {
    if (menu.current) menu.current.open = false;
  }, [pathname]);
  useEffect(() => {
    // Close on a click anywhere outside the panel, or on Escape.
    const close = (event: Event) => {
      const details = menu.current;
      if (!details?.open) return;
      if (event instanceof KeyboardEvent ? event.key === "Escape" : !details.contains(event.target as Node))
        details.open = false;
    };
    document.addEventListener("pointerdown", close);
    document.addEventListener("keydown", close);
    return () => {
      document.removeEventListener("pointerdown", close);
      document.removeEventListener("keydown", close);
    };
  }, []);
  useEffect(() => {
    let active = true;
    if (!enabled) return;
    Promise.all([
      request<Tasks>("/distribution/tasks"),
      request<Messages>("/enterprise-messages").catch(() => ({ items: [], counts: { unread: 0 } }) as Messages),
    ])
      .then(([data, messages]) => {
        if (!active) return;
        const items: Item[] = [
          ...messages.items.filter((m) => m.unread).map((m) => ({
            key: `m-${m.id}`,
            title: m.subject,
            detail: m.preview,
            href: "/enterprise/messages",
          })),
          ...data.transfers.map((t, i) => ({
            key: `t-${String(t.transferId)}-${String(t.action)}-${i}`,
            title: transferActions[String(t.action)] ?? String(t.action),
            detail: `${String(t.origin ?? "")} → ${String(t.destination ?? "")}`,
            href: `/distribution/${String(t.transferId)}`,
          })),
          ...data.stock.map((s) => ({
            key: `s-${String(s.lotId)}-${String(s.kind)}`,
            title: `${String(s.lotCode ?? "")} · ${String(s.productName ?? "")}`,
            detail: stockKinds[String(s.kind)] ?? String(s.kind),
            href: "/enterprise/inventory",
          })),
        ];
        setState({ scope, items, total: (data.counts.total ?? data.transfers.length + data.stock.length) + messages.counts.unread, failed: false });
      })
      .catch(() => {
        if (active) setState({ scope, items: [], total: 0, failed: true });
      });
    return () => {
      active = false;
    };
  }, [enabled, scope, pathname, revision]);
  const current = state.scope === scope ? state : { items: [], total: 0, failed: false };
  return (
    <details className="notify-menu" ref={menu}>
      <summary aria-label={`Thông báo, ${current.total} mục chưa xử lý`} title="Thông báo">
        <Bell size={19} aria-hidden="true" />
        <span className="notify-count">{current.total > 99 ? "99+" : current.total}</span>
      </summary>
      <div className="notify-panel">
        <strong className="notify-heading">Thông báo</strong>
        {!enabled ? (
          <p className="notify-empty">Chưa có thông báo cho tài khoản này.</p>
        ) : current.failed ? (
          <p className="notify-empty">Chưa tải được thông báo. Mở Hộp công việc để xem lại.</p>
        ) : current.items.length ? (
          <ul>
            {current.items.slice(0, 8).map((item) => (
              <li key={item.key}>
                <Link href={item.href}>
                  <span>{item.title}</span>
                  <small>{item.detail}</small>
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="notify-empty">Không có việc nào đang chờ.</p>
        )}
        {enabled && (
          <div className="notify-links">
            <Link className="notify-all" href="/enterprise/messages">Quản lý thông báo</Link>
            <Link className="notify-all" href="/enterprise/inbox">Hộp công việc</Link>
          </div>
        )}
      </div>
    </details>
  );
}
