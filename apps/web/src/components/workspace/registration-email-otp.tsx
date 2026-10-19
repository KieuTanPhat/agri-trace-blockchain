"use client";
import { useEffect, useId, useRef, useState } from "react";
import { request } from "@/lib/api-client";
import { errorMessage } from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
type S = components["schemas"];
export function RegistrationEmailOtp({
  email,
  label,
  registrationId,
  proof,
  onVerified,
}: {
  email: string;
  label: string;
  registrationId: string;
  proof?: S["RegistrationOtpVerifiedView"];
  onVerified: (proof: S["RegistrationOtpVerifiedView"]) => void;
}) {
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
  const verified = !!proof && Date.parse(proof.expiresAt) > now;
  const cooldown = receipt
    ? Math.max(0, Math.ceil((Date.parse(receipt.resendAfter) - now) / 1000))
    : 0;
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);
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
      setReceipt(data);
      setCode("");
      originalSend.current = null;
      originalVerify.current = null;
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
    <section
      className="registration-otp"
      aria-label={`Xác thực ${label.toLowerCase()}`}
    >
      <div className="reg-account-verification">
        <div>
          <span>{label}</span>
          <strong>{email}</strong>
        </div>
        {verified ? (
          <span className="reg-verified" role="status">
            Đã xác thực
          </span>
        ) : (
          <button
            className="button secondary"
            type="button"
            disabled={pending || cooldown > 0 || !!originalVerify.current}
            onClick={() => void send()}
          >
            {pending
              ? "Đang xử lý…"
              : cooldown
                ? `Gửi lại sau ${cooldown}s`
                : receipt
                  ? "Gửi lại mã"
                  : "Xác thực tài khoản"}
          </button>
        )}
      </div>
      {sendError && (
        <p className="reg-field-error" role="alert">
          {sendError}
        </p>
      )}
      {!verified && receipt && (
        <div className="reg-verification-entry">
          <label className="reg-field" htmlFor={inputId}>
            <span id={`${inputId}-label`}>Mã xác thực</span>
            <input
              id={inputId}
              aria-labelledby={`${inputId}-label`}
              className="input"
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              disabled={pending || !!originalVerify.current}
              aria-invalid={verifyError ? true : undefined}
              aria-describedby={verifyError ? `${inputId}-error` : undefined}
              onChange={(e) => {
                setCode(e.target.value.replace(/\D/g, ""));
                setVerifyError("");
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void verify();
                }
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
          <button
            type="button"
            className="button"
            disabled={pending || code.length !== 6}
            onClick={() => void verify()}
          >
            {originalVerify.current ? "Thử lại xác thực cũ" : "Xác nhận"}
          </button>
        </div>
      )}
    </section>
  );
}
