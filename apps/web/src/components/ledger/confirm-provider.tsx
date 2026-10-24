"use client";

import { createContext, useCallback, useContext, useEffect, useRef, useState } from "react";
import { Button } from "./ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "./ui/dialog";
import { t } from "@/lib/ledger/i18n";
export type LedgerConfirmation = { title: string; description?: string; confirmLabel?: string; danger?: boolean };
type Confirm = (input: LedgerConfirmation) => Promise<boolean>;
const ConfirmContext = createContext<Confirm | null>(null);
export function LedgerConfirmProvider({ children }: { children: React.ReactNode }) {
  const [input, setInput] = useState<LedgerConfirmation | null>(null);
  const resolve = useRef<((value: boolean) => void) | null>(null);
  const finish = useCallback((value: boolean) => { resolve.current?.(value); resolve.current = null; setInput(null); }, []);
  const confirm = useCallback<Confirm>((next) => {
    if (resolve.current) return Promise.resolve(false);
    setInput(next); return new Promise<boolean>(done => { resolve.current = done; });
  }, []);
  useEffect(() => () => { resolve.current?.(false); }, []);
  return <ConfirmContext.Provider value={confirm}>{children}<Dialog open={input !== null} onOpenChange={open => { if (!open) finish(false); }}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{input?.title}</DialogTitle><DialogDescription>{input?.description ?? t("Xác nhận thực hiện thao tác này.")}</DialogDescription></DialogHeader><DialogFooter><Button type="button" variant="ghost" onClick={() => finish(false)}>{t("Hủy")}</Button><Button type="button" variant={input?.danger ? "destructive" : "default"} onClick={() => finish(true)}>{input?.confirmLabel ?? t("Xác nhận")}</Button></DialogFooter></DialogContent></Dialog></ConfirmContext.Provider>;
}
export function useLedgerConfirm(): Confirm {
  const confirm = useContext(ConfirmContext); if (!confirm) throw new Error("Ledger confirmation provider is missing"); return confirm;
}
