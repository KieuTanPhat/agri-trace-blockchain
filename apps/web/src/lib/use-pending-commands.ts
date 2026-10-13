"use client";

import { useEffect, useState } from "react";
import { listPendingCommands } from "./api-client";
import {
  COMMAND_RECOVERY_CHANGED_EVENT,
  COMMAND_STORAGE_PREFIX,
  type PendingCommand,
} from "./command-recovery";

/** Read metadata from the existing recovery ledger. An unreadable queue holds
 * new commands; it never authorizes a replacement body or idempotency key. */
export function usePendingCommands(
  operations: readonly PendingCommand["operation"][],
) {
  const [pending, setPending] = useState(true);
  useEffect(() => {
    let active = true;
    let revision = 0;
    const load = () => {
      const requestRevision = ++revision;
      void listPendingCommands()
        .then((items) => {
          if (active && revision === requestRevision)
            setPending(
              items.some((item) => operations.includes(item.operation)),
            );
        })
        .catch(() => {
          if (active && revision === requestRevision) setPending(true);
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
      revision += 1;
      window.removeEventListener(COMMAND_RECOVERY_CHANGED_EVENT, load);
      window.removeEventListener("storage", storage);
      window.removeEventListener("focus", load);
      window.removeEventListener("pageshow", load);
    };
  }, [operations]);
  return pending;
}
