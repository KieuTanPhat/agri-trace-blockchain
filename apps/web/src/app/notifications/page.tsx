"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useRemote } from "@/lib/workspace-api";
import { request } from "@/lib/api-client";
import { Pager, RemoteState } from "@/components/workspace-controls";
import { labelForEvent } from "@/lib/display-labels";
type Item = {
  id: string;
  eventType: string;
  createdAt: string;
  isRead: boolean;
};
export default function NotificationsPage() {
  const router = useRouter();
  const [page, setPage] = useState(1),
    [revision, setRevision] = useState(0),
    [actionError, setError] = useState(""),
    [busy, setBusy] = useState("");
  const { data, error, loading } = useRemote<{
    items: Item[];
    total: number;
    unread: number;
    pageSize: number;
  }>("/notifications?page=" + page, revision);
  async function act(id: string, open: boolean) {
    setBusy(id);
    setError("");
    try {
      const target = open
        ? await request<{ href: string }>("/notifications/" + id + "/target")
        : null;
      await request("/notifications/" + id + "/read", { method: "POST" });
      setRevision((v) => v + 1);
      window.dispatchEvent(new Event("notifications-changed"));
      if (target) router.push(target.href);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy("");
    }
  }
  return (
    <div className="workspace-page">
      <header className="page-header">
        <div>
          <h1>Trung tâm thông báo</h1>
          <p>
            Sự kiện nghiệp vụ trong phạm vi quyền truy cập ·{" "}
            {data?.unread ?? "…"} chưa đọc
          </p>
        </div>
      </header>
      <section className="panel">
        <RemoteState
          loading={loading}
          error={error}
          empty={data?.items.length === 0}
          retry={() => setRevision((v) => v + 1)}
        />
        {actionError && (
          <p role="alert" className="notice error">
            {actionError}
          </p>
        )}
        {data?.items.map((n) => (
          <article
            className={"notification-item " + (n.isRead ? "" : "unread")}
            key={n.id}
          >
            <div>
              <strong>{labelForEvent(n.eventType)}</strong>
              <p>
                {new Date(n.createdAt).toLocaleString("vi-VN")} ·{" "}
                {n.isRead ? "Đã đọc" : "Chưa đọc"}
              </p>
            </div>
            <div className="workspace-toolbar">
              <button
                className="button"
                disabled={!!busy}
                onClick={() => act(n.id, true)}
              >
                Mở đối tượng
              </button>
              {!n.isRead && (
                <button
                  className="button secondary"
                  disabled={!!busy}
                  onClick={() => act(n.id, false)}
                >
                  {busy === n.id ? "Đang xử lý…" : "Đánh dấu đã đọc"}
                </button>
              )}
            </div>
          </article>
        ))}
        {data && (
          <Pager page={page} total={data.total} size={20} onChange={setPage} />
        )}
      </section>
    </div>
  );
}
