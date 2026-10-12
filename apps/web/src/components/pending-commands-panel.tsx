"use client";

import { useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { listPendingCommands, retryPendingCommand } from "@/lib/api-client";
import {
  COMMAND_RECOVERY_CHANGED_EVENT,
  COMMAND_STORAGE_PREFIX,
  type PendingCommand,
} from "@/lib/command-recovery";

const labels: Partial<Record<PendingCommand["operation"], string>> = {
  HYB_CREATE_CHAIN: "Tạo chuỗi cung ứng",
  HYB_ACTIVATE_BUSINESS_PROFILE: "Kích hoạt nghiệp vụ chuỗi",
  SCOPE_APPLY_LEGACY_ROOT: "Chuyển dữ liệu sang chuỗi",
  SCOPE_CONFIRM_LEGACY_ASSIGNMENT: "Xác nhận chuyển dữ liệu",
  SCOPE_FINALIZE_SHIPMENT_PLAN: "Chốt kế hoạch giao hàng",
  SCOPE_ACCEPT_SHIPMENT_PLAN: "Xác nhận kế hoạch giao hàng",
  CREATE_PRODUCTION_CYCLE: "Tạo vụ trồng",
  RECORD_HARVEST: "Ghi nhận thu hoạch",
};

export function PendingCommandsPanel({ onSettled }: { onSettled(): void }) {
  const auth = useAuth();
  const scope = getAuthorizationScope(auth.user);
  const ready = Boolean(
    auth.user &&
    (!auth.privateAccessStatus || auth.privateAccessStatus === "ready"),
  );
  const [loaded, setLoaded] = useState<{
    scope: string;
    items: PendingCommand[];
  }>({
    scope: "",
    items: [],
  });
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);
  useEffect(() => {
    let active = true;
    setLoaded({ scope: "", items: [] });
    setError("");
    if (!ready) return;
    const load = () => {
      void listPendingCommands()
        .then((items) => {
          if (active) setLoaded({ scope, items });
        })
        .catch(() => {
          if (active)
            setError(
              "Chưa đọc được yêu cầu đang chờ. Kiểm tra lại trước khi gửi.",
            );
        });
    };
    const storage = (event: StorageEvent) => {
      if (event.key === null || event.key.startsWith(COMMAND_STORAGE_PREFIX))
        load();
    };
    load();
    window.addEventListener(COMMAND_RECOVERY_CHANGED_EVENT, load);
    window.addEventListener("storage", storage);
    window.addEventListener("focus", load);
    window.addEventListener("pageshow", load);
    return () => {
      active = false;
      window.removeEventListener(COMMAND_RECOVERY_CHANGED_EVENT, load);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", load);
      window.removeEventListener("pageshow", load);
    };
  }, [scope, ready]);
  const items = ready && loaded.scope === scope ? loaded.items : [];
  if (!ready || (!items.length && !error)) return null;
  const recover = async (id: string) => {
    setBusy(id);
    setError("");
    try {
      await retryPendingCommand(id);
      if (alive.current) onSettled();
    } catch (cause) {
      if (alive.current)
        setError(
          cause && typeof cause === "object" && "message" in cause
            ? String(cause.message)
            : "Yêu cầu vẫn cần đối soát. Chưa tạo yêu cầu thay thế.",
        );
    } finally {
      if (alive.current) setBusy("");
    }
  };
  return (
    <section className="panel" aria-label="Yêu cầu cần đối soát">
      <h2>Yêu cầu cần đối soát</h2>
      {items.length > 0 && (
        <>
          <p>Kiểm tra yêu cầu trước đó trước khi gửi nội dung mới.</p>
          <ul>
            {items.map((item, index) => (
              <li key={item.id}>
                <span>
                  {labels[item.operation] ?? `Yêu cầu nghiệp vụ ${index + 1}`}
                </span>{" "}
                <button
                  className="button secondary"
                  disabled={Boolean(busy)}
                  onClick={() => void recover(item.id)}
                >
                  {busy === item.id ? "Đang kiểm tra…" : "Kiểm tra và thử lại"}
                </button>
              </li>
            ))}
          </ul>
        </>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
