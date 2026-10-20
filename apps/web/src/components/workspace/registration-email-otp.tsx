"use client";
import { useEffect, useId, useRef, useState } from "react";
import { MailCheck } from "lucide-react";
import { request } from "@/lib/api-client";
import { errorMessage } from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
type S = components["schemas"];

/**
 * Opened by "Gửi hồ sơ xét duyệt": sends an OTP to the login email and
 * hands the verified proof back so the form can upload documents and submit.
 */
export function RegistrationOtpDialog({
  open,
  email,
  registrationId,
  onVerified,
  onCancel,
}: {
  open: boolean;
  email: string;
  registrationId: string;
  onVerified: (proof: S["RegistrationOtpVerifiedView"]) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [receipt, setReceipt] = useState<S["RegistrationOtpReceipt"] | null>(
      null,
    ),
    [code, setCode] = useState(""),
    [pending, setPending] = useState(false),
    [sendError, setSendError] = useState(""),
    [verifyError, setVerifyError] = useState(""),
    [now, setNow] = useState(Date.now());
  const originalSend = useRef<S["RegistrationOtpRequest"] | null>(null),
    originalVerify = useRef<S["RegistrationOtpVerify"] | null>(null);
  const inputId = useId();
  const live = !!receipt && Date.parse(receipt.expiresAt) > now;
  const cooldown = receipt
    ? Math.max(0, Math.ceil((Date.parse(receipt.resendAfter) - now) / 1000))
    : 0;
  useEffect(() => {
    if (!open) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [open]);
  // A changed login email invalidates the code sent to the previous one.
  useEffect(() => {
    setReceipt(null);
    setCode("");
    originalSend.current = null;
    originalVerify.current = null;
  }, [email]);
  useEffect(() => {
    const node = dialog.current;
    if (open && node && !node.open) {
      if (typeof node.showModal === "function") node.showModal();
      else node.setAttribute("open", "");
    }
    if (!open && node?.open) {
      if (typeof node.close === "function") node.close();
      else node.removeAttribute("open");
    }
    if (open && !live) void send();
    // send() reads the latest state; only opening should trigger it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);
  async function send() {
    if (pending || cooldown) return;
    originalSend.current ??= {
      registrationId,
      requestId: crypto.randomUUID(),
      email,
    };
    setPending(true);
    setSendError("");
    setVerifyError("");
    try {
      const data = await request<S["RegistrationOtpReceipt"]>(
        "/auth/registration-otp/request",
        {
          method: "POST",
          headers: { "idempotency-key": originalSend.current.requestId },
          body: JSON.stringify(originalSend.current),
        },
        false,
      );
      originalSend.current = null;
      originalVerify.current = null;
      setReceipt(data);
      setCode("");
      setNow(Date.now());
    } catch (cause) {
      setSendError(errorMessage(cause));
      const status = (cause as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 429)
        originalSend.current = null;
    } finally {
      setPending(false);
    }
  }
  async function verify() {
    if (pending || !receipt || !/^\d{6}$/.test(code)) return;
    originalVerify.current ??= {
      registrationId,
      verificationId: receipt.verificationId,
      attemptId: crypto.randomUUID(),
      code,
    };
    setPending(true);
    setVerifyError("");
    try {
      const data = await request<S["RegistrationOtpVerifiedView"]>(
        "/auth/registration-otp/verify",
        {
          method: "POST",
          headers: { "idempotency-key": originalVerify.current.attemptId },
          body: JSON.stringify(originalVerify.current),
        },
        false,
      );
      originalVerify.current = null;
      setCode("");
      onVerified(data);
    } catch (cause) {
      setVerifyError(errorMessage(cause));
      const status = (cause as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 429)
        originalVerify.current = null;
    } finally {
      setPending(false);
    }
  }
  return (
    <dialog
      ref={dialog}
      className="command-dialog reg-otp-dialog"
      aria-labelledby={`${inputId}-title`}
      onCancel={(event) => {
        event.preventDefault();
        if (!pending) onCancel();
      }}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void verify();
        }}
      >
        <div className="reg-otp-dialog-head">
          <MailCheck size={30} aria-hidden="true" />
          <h2 id={`${inputId}-title`}>Xác thực email đăng nhập</h2>
          <p>
            {receipt
              ? "Nhập mã 6 số AgriTrace vừa gửi tới"
              : pending
                ? "Đang gửi mã xác thực tới"
                : "Mã xác thực sẽ được gửi tới"}{" "}
            <strong>{email}</strong>. Sau khi xác thực, hồ sơ được gửi xét
            duyệt và mật khẩu đăng nhập tạm được gửi về email này.
          </p>
        </div>
        {sendError && (
          <p className="reg-field-error" role="alert">
            {sendError}
          </p>
        )}
        <label className="reg-field" htmlFor={inputId}>
          <span id={`${inputId}-label`}>Mã OTP</span>
          <input
            id={inputId}
            aria-labelledby={`${inputId}-label`}
            className="input reg-otp-input"
            inputMode="numeric"
            autoComplete="one-time-code"
            pattern="[0-9]{6}"
            maxLength={6}
            placeholder="••••••"
            autoFocus
            value={code}
            disabled={!receipt || pending || !!originalVerify.current}
            aria-invalid={verifyError ? true : undefined}
            aria-describedby={verifyError ? `${inputId}-error` : undefined}
            onChange={(e) => {
              setCode(e.target.value.replace(/\D/g, ""));
              setVerifyError("");
            }}
          />
          {verifyError && (
            <span
              className="reg-field-error"
              id={`${inputId}-error`}
              role="alert"
            >
              {verifyError}
            </span>
          )}
        </label>
        <p className="reg-help">
          Mã có hiệu lực 10 phút, tối đa 5 lần nhập sai.{" "}
          <button
            type="button"
            className="text-link"
            disabled={pending || cooldown > 0 || !!originalVerify.current}
            onClick={() => void send()}
          >
            {cooldown ? `Gửi lại mã sau ${cooldown}s` : "Gửi lại mã"}
          </button>
        </p>
        <div className="dialog-actions">
          <button
            type="button"
            className="button secondary"
            disabled={pending}
            onClick={onCancel}
          >
            Hủy
          </button>
          <button
            type="submit"
            className="button"
            disabled={pending || !receipt || code.length !== 6}
          >
            {pending
              ? "Đang xử lý…"
              : originalVerify.current
                ? "Thử lại xác thực"
                : "Xác nhận và gửi hồ sơ"}
          </button>
        </div>
      </form>
    </dialog>
  );
}
