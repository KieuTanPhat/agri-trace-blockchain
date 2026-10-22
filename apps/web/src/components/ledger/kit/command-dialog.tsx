"use client";

import { useEffect, useRef, useState } from "react";
import { useForm, type DefaultValues, type UseFormReturn, type FieldValues, type Resolver } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import { toast } from "sonner";
import type { z } from "zod";
import { Loader2, ShieldCheck } from "lucide-react";
import { ledgerCommandError, newLedgerCommandKey as newIdempotencyKey } from "@/lib/ledger/command-context";
import { ledgerApprovalProposal, type LedgerCommandContext as Cmd } from "@/lib/ledger/command-context";
import type { ApprovalOperation } from "@/lib/ledger/command-context";
import { Button } from "@/components/ledger/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ledger/ui/dialog";
import { Input } from "@/components/ledger/ui/input";
import { Label } from "@/components/ledger/ui/label";
import { cn } from "@/lib/ledger/utils";
import { Callout } from "./page";

import { t as tr } from "@/lib/ledger/i18n";
export interface CommandDialogProps<S extends z.ZodType<FieldValues>> {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Endpoint Backend tương ứng, hiển thị để người dùng biết lệnh nào sẽ chạy. */
  endpoint: string;
  description?: React.ReactNode;
  schema: S;
  defaultValues: DefaultValues<z.infer<S>>;
  children: (form: UseFormReturn<z.infer<S>>) => React.ReactNode;
  run: (values: z.infer<S>, cmd: Cmd) => Promise<unknown>;
  /** Lệnh rủi ro cao: gửi kèm X-MFA-Code. */
  stepUp?: boolean;
  submitLabel: string;
  tone?: "default" | "danger";
  invalidate?: QueryKey[];
  success?: string | ((result: unknown) => string);
  onDone?: (result: unknown) => void;
  version?: number;
  wide?: boolean;
  /** Hiển thị trong trang (panel quyết định) thay vì dialog. */
  inline?: boolean;
  /** Khi Backend bật ENFORCED và trả 409, cho phép gửi đề xuất maker–checker thay thế. */
  proposal?: { operation: ApprovalOperation; params: (values: z.infer<S>) => Record<string, unknown>; reason: (values: z.infer<S>) => string };
}

export function CommandDialog<S extends z.ZodType<FieldValues>>(props: CommandDialogProps<S>) {
  const { open, onOpenChange } = props;
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn("max-h-[92vh] overflow-y-auto sm:max-w-lg", props.wide && "sm:max-w-2xl")}>{open && <Body {...props} />}</DialogContent>
    </Dialog>
  );
}

/** Form lệnh dùng trực tiếp trong trang (panel quyết định). */
export function CommandForm<S extends z.ZodType<FieldValues>>(props: Omit<CommandDialogProps<S>, "open" | "onOpenChange"> & { onOpenChange?: (o: boolean) => void }) {
  return <Body {...props} open onOpenChange={props.onOpenChange ?? (() => {})} inline />;
}

function Body<S extends z.ZodType<FieldValues>>({ onOpenChange, title, endpoint, description, schema, defaultValues, children, run, stepUp, submitLabel, tone = "default", invalidate = [], success, onDone, version, inline, proposal }: CommandDialogProps<S>) {
  const qc = useQueryClient();
  const form = useForm<z.infer<S>>({ resolver: zodResolver(schema as never) as unknown as Resolver<z.infer<S>>, defaultValues, mode: "onTouched" });
  // Khóa idempotency giữ nguyên khi thử lại cùng nội dung; đổi khi nội dung đổi hoặc lỗi nghiệp vụ.
  const [idemKey, setIdemKey] = useState(newIdempotencyKey);
  const [lastBody, setLastBody] = useState<string | null>(null);
  const [mfa, setMfa] = useState("");
  const [mfaError, setMfaError] = useState<string | null>(null);
  const [error, setError] = useState<ReturnType<typeof ledgerCommandError> | null>(null);
  const [busy, setBusy] = useState(false);
  const mfaRef = useRef<HTMLInputElement>(null);
  const [needsApproval, setNeedsApproval] = useState(false);
  const showMfa = stepUp || needsApproval;

  const sendProposal = form.handleSubmit(async (values) => {
    if (!proposal) return;
    if (!/^\d{6}$/.test(mfa.replace(/\s/g, ""))) {
      setMfaError(tr("Nhập mã 6 số để gửi đề xuất"));
      return;
    }
    setBusy(true);
    try {
      await ledgerApprovalProposal({ operation: proposal.operation, params: proposal.params(values), reason: proposal.reason(values) }, { idempotencyKey: newIdempotencyKey(), mfaCode: mfa.replace(/\s/g, "") });
      await Promise.all([["approvals"], ["inbox"], ...invalidate].map((k) => qc.invalidateQueries({ queryKey: k })));
      toast.success(tr("Đã gửi đề xuất phê duyệt hai bước"));
      onOpenChange(false);
    } catch (e) {
      const err = ledgerCommandError(e);
      if (err.isStepUp) setMfaError(err.message);
      else setError(err);
    } finally {
      setBusy(false);
    }
  });

  useEffect(() => {
    if (mfaError) mfaRef.current?.focus();
  }, [mfaError]);

  const submit = form.handleSubmit(async (values) => {
    setError(null);
    setMfaError(null);
    if (stepUp && !/^\d{6}$/.test(mfa.replace(/\s/g, ""))) {
      setMfaError(tr("Nhập mã 6 số từ ứng dụng xác thực"));
      return;
    }
    const body = JSON.stringify(values);
    // Cùng khóa chỉ dùng lại cho đúng cùng nội dung (Backend trả lỗi nếu khóa trùng mà body khác).
    let key = idemKey;
    if (lastBody !== null && lastBody !== body) {
      key = newIdempotencyKey();
      setIdemKey(key);
    }
    setLastBody(body);
    setBusy(true);
    try {
      const result = await run(values, { idempotencyKey: key, mfaCode: stepUp ? mfa.replace(/\s/g, "") : undefined });
      await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
      toast.success(typeof success === "function" ? success(result) : (success ?? tr("Đã ghi nhận")));
      onDone?.(result);
      onOpenChange(false);
      if (inline) {
        form.reset(defaultValues);
        setMfa("");
        setIdemKey(newIdempotencyKey());
        setLastBody(null);
      }
    } catch (e) {
      const err = ledgerCommandError(e);
      if (err.isStepUp) {
        setMfaError(err.message);
      } else {
        setError(err);
        if (err.isConflict && /phê duyệt hai bước/i.test(err.message) && proposal) setNeedsApproval(true);
        // Lỗi nghiệp vụ (4xx): lần gửi sau là một yêu cầu mới. Lỗi mạng/5xx: giữ khóa để thử lại an toàn.
        if (err.status >= 400 && err.status < 500) {
          setIdemKey(newIdempotencyKey());
          setLastBody(null);
        }
      }
    } finally {
      setBusy(false);
    }
  });

  return (
    <form onSubmit={submit} noValidate className="flex flex-col gap-4">
      {inline ? (
        <div className="flex flex-col gap-1">
          <h2 className="text-[16px] font-semibold">{title}</h2>
          <span className="font-mono text-[11.5px] text-ink-2">{endpoint}</span>
          {description && <span className="text-[13px] text-ink-2">{description}</span>}
        </div>
      ) : (
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription asChild>
            <div className="flex flex-col gap-1.5">
              <span className="font-mono text-[11.5px] text-ink-2">{endpoint}</span>
              {description && <span className="text-[13px] text-ink-2">{description}</span>}
            </div>
          </DialogDescription>
        </DialogHeader>
      )}

      <div className="flex flex-col gap-4">{children(form)}</div>

      {showMfa && (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="mfa-code" className="flex items-center gap-1.5 text-[13px] font-medium">
            <ShieldCheck className="size-3.5 text-brand" /> {tr("Mã xác thực hai yếu tố")}
          </Label>
          <Input
            ref={mfaRef}
            id="mfa-code"
            inputMode="numeric"
            autoComplete="one-time-code"
            maxLength={7}
            value={mfa}
            onChange={(e) => setMfa(e.target.value)}
            aria-invalid={!!mfaError}
            className="h-11 max-w-[200px] font-mono text-[18px] tracking-[0.25em]"
            placeholder="••••••"
          />
          <span className={cn("text-[12px]", mfaError ? "text-danger" : "text-ink-2")}>
            {mfaError ?? (
              <>
                {tr("Gửi trong header")} <span className="font-mono">X-MFA-Code</span>{tr(". Sai mã không làm mất phiên.")}
              </>
            )}
          </span>
        </div>
      )}

      {error && (
        <Callout tone={error.isConflict ? "warn" : "danger"} title={error.isConflict ? tr("Dữ liệu đã thay đổi hoặc không còn hợp lệ") : tr("Không thực hiện được ({p0})", { p0: error.status || tr("mạng") })}>
          <ul className="list-disc pl-4">
            {error.messages.map((m, i) => (
              <li key={i}>{m}</li>
            ))}
          </ul>
          {error.isConflict && (
            <Button
              type="button"
              variant="outline"
              size="xs"
              className="mt-2"
              onClick={async () => {
                await Promise.all(invalidate.map((k) => qc.invalidateQueries({ queryKey: k })));
                onOpenChange(false);
              }}
            >
              {tr("Đóng và tải lại dữ liệu")}
            </Button>
          )}
          {needsApproval && proposal && (
            <Button type="button" size="xs" className="mt-2 ml-2" disabled={busy} onClick={() => sendProposal()}>
              {tr("Gửi đề xuất")} {proposal.operation} {tr("thay thế")}
            </Button>
          )}
        </Callout>
      )}

      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 rounded-md bg-sunken px-3 py-2 font-mono text-[11px] text-ink-2">
        <span>Idempotency-Key {idemKey.slice(0, 8)}…</span>
        {version !== undefined && <span>version {version}</span>}
        <span>{tr("ghi nhật ký kiểm toán")}</span>
      </div>

      {inline ? (
        <Button type="submit" size="lg" disabled={busy} variant={tone === "danger" ? "destructive" : "default"}>
          {busy && <Loader2 className="animate-spin" />}
          {submitLabel}
        </Button>
      ) : (
        <DialogFooter>
          <Button type="button" variant="ghost" onClick={() => onOpenChange(false)}>
            {tr("Hủy")}
          </Button>
          <Button type="submit" disabled={busy} variant={tone === "danger" ? "destructive" : "default"}>
            {busy && <Loader2 className="animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      )}
    </form>
  );
}

/** Tiện ích: state mở/đóng cho một lệnh theo đối tượng. */
export function useDialog<T = true>() {
  const [target, setTarget] = useState<T | null>(null);
  return { target, open: (t: T) => setTarget(t), close: () => setTarget(null), props: { open: target !== null, onOpenChange: (o: boolean) => !o && setTarget(null) } };
}
