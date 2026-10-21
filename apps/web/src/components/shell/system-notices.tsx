"use client";

import { useEffect, useState } from "react";
import { request } from "@/lib/api-client";

type Notice = { id: string; title: string; body: string; severity: string; endsAt: string };
const DISMISSED = "agritrace:dismissed-notices:v1";

function readDismissed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(DISMISSED) ?? "[]") as string[];
  } catch {
    return [];
  }
}

/** Platform banners for the signed-in viewer. Purely informational: they never
 * change whether writes are open. A dismissal lasts for the browser session. */
export function SystemNotices({ scope }: { scope: string }) {
  const [notices, setNotices] = useState<Notice[]>([]);
  const [dismissed, setDismissed] = useState<string[]>([]);
  useEffect(() => {
    let active = true;
    setDismissed(readDismissed());
    request<{ items: Notice[] }>("/system-notices/active")
      .then((data) => {
        if (active) setNotices(data.items);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [scope]);
  const visible = notices.filter((n) => !dismissed.includes(n.id));
  if (!visible.length) return null;
  return (
    <div aria-label="Thông báo hệ thống">
      {visible.map((n) => (
        <p key={n.id} className="notice-banner" role="status">
          <strong>{n.severity === "MAINTENANCE" ? "Bảo trì:" : n.severity === "WARNING" ? "Lưu ý:" : "Thông báo:"} {n.title}</strong>
          {n.body}{" "}
          <button
            type="button"
            className="button secondary small"
            onClick={() => {
              const next = [...dismissed, n.id];
              setDismissed(next);
              try {
                sessionStorage.setItem(DISMISSED, JSON.stringify(next));
              } catch {
                /* storage unavailable */
              }
            }}
          >
            Ẩn
          </button>
        </p>
      ))}
    </div>
  );
}
