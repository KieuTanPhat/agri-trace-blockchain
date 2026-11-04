"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { X } from "lucide-react";
import { listPendingCommands, retryPendingCommand } from "@/lib/api-client";
import {
  COMMAND_RECOVERY_CHANGED_EVENT,
  COMMAND_STORAGE_PREFIX,
  type PendingCommand,
} from "@/lib/command-recovery";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { getLedgerError } from "@/lib/ledger/errors";
import { t } from "@/lib/ledger/i18n";
import { useLocale } from "./locale";
import { Button } from "./ui/button";

/** The baseline journal owns all bodies, signatures, keys, locks and inspections. */
export function LedgerRecoveryPanel() {
  useLocale();
  const { user, privateAccessStatus } = useAuth(),
    scope = getAuthorizationScope(user),
    qc = useQueryClient();
  const [state, setState] = useState<{
      scope: string;
      items: PendingCommand[];
      error: string;
    }>({ scope: "", items: [], error: "" }),
    [busy, setBusy] = useState<string | null>(null),
    [dismissed, setDismissed] = useState<string | null>(null);
  const generation = useRef(0),
    inFlight = useRef(false);
  const cancelLoad = useCallback(() => {
    generation.current++;
  }, []);
  const load = useCallback(async () => {
    const ticket = ++generation.current;
    if (!user || privateAccessStatus !== "ready") return;
    try {
      const items = await listPendingCommands();
      if (ticket === generation.current) setState({ scope, items, error: "" });
    } catch (cause) {
      if (ticket === generation.current)
        setState({
          scope,
          items: [],
          error:
            getLedgerError(cause)?.message ??
            t("Chưa đọc được yêu cầu đang chờ"),
        });
    }
  }, [scope, user, privateAccessStatus]);
  useEffect(() => {
    void load();
    const storage = (event: StorageEvent) => {
      if (event.key?.startsWith(COMMAND_STORAGE_PREFIX)) void load();
    };
    window.addEventListener(COMMAND_RECOVERY_CHANGED_EVENT, load);
    window.addEventListener("storage", storage);
    return () => {
      cancelLoad();
      window.removeEventListener(COMMAND_RECOVERY_CHANGED_EVENT, load);
      window.removeEventListener("storage", storage);
    };
  }, [load, cancelLoad]);
  const signature = state.items.map((item) => item.id).join(",") + "|" + state.error;
  if (
    state.scope !== scope ||
    privateAccessStatus !== "ready" ||
    (!state.items.length && !state.error) ||
    dismissed === signature
  )
    return null;
  // Nổi ở góc trên, không đẩy nội dung trang; đóng thì ẩn tới khi danh sách đổi.
  return (
    <div
      data-testid="ledger-recovery-panel"
      className="fixed right-3 top-16 z-40 w-[min(22rem,calc(100vw-1.5rem))] rounded-md border border-warn/30 bg-warn-bg px-3 py-2.5 text-[12.5px] shadow-lg"
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-warn">{t("Yêu cầu cần đối soát")}</div>
          <p className="text-ink-2">{t("Kiểm tra kết quả yêu cầu đã gửi trước khi tạo yêu cầu mới.")}</p>
        </div>
        <button
          type="button"
          aria-label={t("Đóng thông báo")}
          onClick={() => setDismissed(signature)}
          className="-mr-1 grid size-6 shrink-0 place-items-center rounded text-ink-2 hover:bg-black/5 hover:text-ink"
        >
          <X className="size-3.5" />
        </button>
      </div>
      {state.error && (
        <p role="alert" className="mt-1.5 text-danger">
          {state.error}
        </p>
      )}
      <ul className="mt-2 flex flex-col gap-1.5">
        {state.items.map((item) => (
          <li key={item.id} className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate font-mono text-[11.5px]" title={item.operation}>
              {item.operation}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={busy !== null}
              onClick={async () => {
                if (inFlight.current) return;
                inFlight.current = true;
                setBusy(item.id);
                try {
                  await retryPendingCommand(item.id);
                  await qc.invalidateQueries();
                  await load();
                } catch (cause) {
                  setState((current) => ({
                    ...current,
                    error:
                      getLedgerError(cause)?.message ??
                      t("Yêu cầu vẫn cần đối soát"),
                  }));
                } finally {
                  inFlight.current = false;
                  setBusy(null);
                }
              }}
            >
              {busy === item.id ? t("Đang kiểm tra…") : t("Đối soát")}
            </Button>
          </li>
        ))}
      </ul>
      {!state.items.length && state.error && (
        <Button variant="outline" size="xs" type="button" className="mt-2" onClick={() => void load()}>
          {t("Thử lại")}
        </Button>
      )}
    </div>
  );
}
