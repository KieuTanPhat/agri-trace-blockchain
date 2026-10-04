"use client";
import Link from "next/link";
import { Bell } from "lucide-react";
import { useEffect, useState } from "react";
import { useRemote } from "@/lib/workspace-api";
export function NotificationBell() {
  const [revision, setRevision] = useState(0);
  const { data, error, loading } = useRemote<{ unread: number }>(
    "/notifications",
    revision,
  );
  useEffect(() => {
    const refresh = () => setRevision((v) => v + 1);
    const timer = setInterval(refresh, 60000);
    window.addEventListener("notifications-changed", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("notifications-changed", refresh);
    };
  }, []);
  return (
    <Link
      className="icon-button notification-btn"
      href="/notifications"
      aria-label={
        error
          ? "Thông báo: không tải được"
          : `Thông báo${data ? `: ${data.unread} chưa đọc` : ""}`
      }
      title={error ? "Không tải được thông báo. Mở để thử lại." : "Thông báo"}
    >
      <Bell size={20} />
      <span className="notification-count">
        {loading ? "…" : error ? "!" : (data?.unread ?? 0)}
      </span>
    </Link>
  );
}
