"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
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
import { Callout } from "./kit/page";
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
    [busy, setBusy] = useState<string | null>(null);
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
  if (
    state.scope !== scope ||
    privateAccessStatus !== "ready" ||
    (!state.items.length && !state.error)
  )
    return null;
  return (
    <div data-testid="ledger-recovery-panel" className="px-4 py-3 sm:px-6">
      <Callout tone="warn" title={t("Yêu cầu cần đối soát")}>
        <p>{t("Kiểm tra kết quả yêu cầu đã gửi trước khi tạo yêu cầu mới.")}</p>
        {state.error && (
          <p role="alert" className="mt-2">
            {state.error}
          </p>
        )}
        <ul className="mt-3 flex flex-col gap-2">
          {state.items.map((item) => (
            <li
              key={item.id}
              className="flex flex-wrap items-center justify-between gap-2"
            >
              <span className="break-words font-mono text-[12px]">
                {item.operation}
              </span>
              <Button
                type="button"
                variant="outline"
                size="sm"
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
          <Button
            variant="outline"
            size="sm"
            type="button"
            className="mt-3"
            onClick={() => void load()}
          >
            {t("Thử lại")}
          </Button>
        )}
      </Callout>
    </div>
  );
}
