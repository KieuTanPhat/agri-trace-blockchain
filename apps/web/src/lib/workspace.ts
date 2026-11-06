import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./api-client";
import { useAuth } from "./auth-store";
import { getAuthorizationScope } from "./auth-scope";
import { importantAction, useConfirm } from "./ledger/confirmation";
import { PERMISSION_SYNC_EVENT } from "./permission-sync";
import type { components } from "./generated/api";
export type Row = Record<string, unknown>;
type Schemas = components["schemas"];
/** Enterprise workspace reads typed from the generated NestJS contract. */
export type TraceEvidence = Schemas["TraceEvidenceRecordDto"];
export type Items<T> = { items: T[] };
const errorMessage = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Chưa kết nối được. Giữ nguyên yêu cầu và thử lại.";
export {} from "./status-labels";
/** Groups holding the given codes; codes outside every group go last. */
export function useWorkspaceData<T>(path: string | null) {
  const auth = useAuth(),
    scope = getAuthorizationScope(auth.user),
    userId = auth.user?.id;
  const [state, setState] = useState<{
    scope: string;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ scope: "", data: null, error: "", loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    let active = true;
    if (!path) { setState({scope,data:null,error:'',loading:false}); return; }
    setState({ scope, data: null, error: "", loading: true });
    if (!userId) return;
    request<T>(path)
      .then((data) => {
        if (active) setState({ scope, data, error: "", loading: false });
      })
      .catch((e) => {
        if (active)
          setState({
            scope,
            data: null,
            error: errorMessage(e),
            loading: false,
          });
      });
    return () => {
      active = false;
    };
  }, [path, scope, revision, userId]);
  useEffect(() => {
    window.addEventListener(PERMISSION_SYNC_EVENT, reload);
    return () => window.removeEventListener(PERMISSION_SYNC_EVENT, reload);
  }, [reload]);
  return {
    ...(state.scope === scope
      ? state
      : { data: null, error: "", loading: true }),
    reload,
  };
}
/** Retain exact body and key after unknown outcomes. Credentials stay in memory. */
export function useWorkspaceCommand() {
  const auth = useAuth();
  const scope = getAuthorizationScope(auth.user&&{...auth.user,accessRevision:undefined});
  const pendingRequest = useRef<{
    scope: string;
    path: string;
    body: string;
    key: string;
    method: "POST" | "PATCH";
  } | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [frozen, setFrozen] = useState(false),
    [retrying, setRetrying] = useState(false);
  const confirm = useConfirm();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /** Resolves to the response body (truthy) on success, or false. */
  async function run<T = Row>(
    path: string,
    payload: unknown,
    method: "POST" | "PATCH" = "POST",
    options: { confirmed?: boolean } = {},
  ): Promise<T | false> {
    if (pending) return false;
    if (pendingRequest.current?.scope !== scope) pendingRequest.current = null;
    // Every write is confirmed once; screens with their own summary dialog
    // pass `confirmed`. Reconciling an uncertain request needs no new prompt.
    if (!pendingRequest.current && !options.confirmed) {
      const warning = importantAction(path) ?? defaultWriteWarning;
      if (!(await confirm(warning))) return false;
    }
    if (!pendingRequest.current)
      pendingRequest.current = {
        scope,
        path,
        body: JSON.stringify(payload),
        key: crypto.randomUUID(),
        method,
      };
    const saved = pendingRequest.current;
    setPending(true);
    setFrozen(true);
    setError("");
    try {
      // An unknown outcome is reconciled by resending the same body and key,
      // so the user never needs a separate retry action.
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await request<T>(saved.path, {
            method: saved.method,
            headers: { "idempotency-key": saved.key },
            body: saved.body,
          });
          pendingRequest.current = null;
          setFrozen(false);
          setError("");
          return (result ?? ({} as T)) as T;
        } catch (e) {
          const status = (e as { status?: number }).status;
          const outcome = e as { recoveryId?: string; canRestart?: boolean };
          if (
            outcome.canRestart ||
            (!outcome.recoveryId &&
              status &&
              status >= 400 &&
              status < 500 &&
              status !== 408 &&
              status !== 429)
          ) {
            pendingRequest.current = null;
            setFrozen(false);
            setError(errorMessage(e));
            return false;
          }
          if (attempt >= AUTO_RETRY_DELAYS.length || !mounted.current) {
            setError(errorMessage(e));
            return false;
          }
          setRetrying(true);
          await new Promise((r) => setTimeout(r, AUTO_RETRY_DELAYS[attempt]));
        }
      }
    } finally {
      setRetrying(false);
      setPending(false);
    }
  }
  return { run, pending, error, frozen, retrying };
}
const defaultWriteWarning =
  "Xác nhận lưu thông tin này? Dữ liệu sẽ được ghi vào hệ thống và lưu lịch sử thay đổi.";
/** Backoff for resending an uncertain command with its original key. */
const AUTO_RETRY_DELAYS = [1000, 3000, 7000];
