"use client";
import { useRef, useState } from "react";
import type { components } from "@/lib/generated/api";
import type {
  RegistrationDraft,
  RegistrationFiles,
  DocumentKind,
} from "@/lib/registration-form";
import { ledgerRequest } from "@/lib/ledger/request";
import { buildLedgerRegistration } from "@/lib/ledger/registration";
import { getLedgerError } from "@/lib/ledger/errors";
type S = components["schemas"];
type Input = {
  draft: RegistrationDraft;
  files: RegistrationFiles;
  onComplete: (
    receipt: S["EnterpriseRegistrationReceiptDto"],
    email: string,
  ) => void;
  onFileError: (kind: DocumentKind, message: string) => void;
};
const uncertain = (cause: unknown) => {
  const status = getLedgerError(cause)?.status;
  return !status || status >= 500 || status === 408 || status === 429;
};
export function useRegistrationProtocol({
  draft,
  files,
  onComplete,
  onFileError,
}: Input) {
  const registrationId = useRef(crypto.randomUUID()),
    sendAttempt = useRef<S["RegistrationOtpRequest"] | null>(null),
    verifyAttempt = useRef<S["RegistrationOtpVerify"] | null>(null),
    original = useRef<S["RegisterDto"] | null>(null),
    proof = useRef<S["RegistrationOtpVerifiedView"] | null>(null);
  const uploaded = useRef(new Map<string, S["RegistrationDocumentViewDto"]>()),
    busy = useRef(false),
    email = useRef(draft.email.trim().toLowerCase());
  const [receipt, setReceipt] = useState<S["RegistrationOtpReceipt"] | null>(
      null,
    ),
    [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [frozen, setFrozen] = useState(false),
    [phase, setPhase] = useState("");
  const fail = (cause: unknown) => {
    setError(
      getLedgerError(cause)?.message ??
        "Chưa nhận được kết quả. Giữ nguyên yêu cầu để đối soát.",
    );
    setFrozen(uncertain(cause));
  };
  async function finishRegistration(
    ownerProof: S["RegistrationOtpVerifiedView"],
  ) {
    let active: DocumentKind | null = null;
    try {
      if (!original.current) {
        const documentIds: string[] = [];
        for (const kind of [
          "LOGO",
          "LEGAL_REGISTRATION",
          "AUTHORIZATION",
          "CERTIFICATE",
        ] as const) {
          const selected = files[kind];
          if (
            !selected ||
            (kind === "AUTHORIZATION" &&
              draft.registrantRelationship !== "AUTHORIZED") ||
            (kind === "CERTIFICATE" &&
              !draft.activities.includes("FARM") &&
              !draft.activities.includes("PROCESSOR"))
          )
            continue;
          if (!uploaded.current.has(selected.id)) {
            active = kind;
            setPhase("Đang tải tài liệu riêng tư…");
            const body = new FormData();
            body.set("id", selected.id);
            body.set("registrationId", registrationId.current);
            body.set("verificationId", ownerProof.verificationId);
            body.set("token", ownerProof.token);
            body.set("kind", kind);
            body.set("file", selected.file);
            uploaded.current.set(
              selected.id,
              await ledgerRequest<S["RegistrationDocumentViewDto"]>(
                "/auth/registration-documents",
                { method: "POST", body },
                false,
              ),
            );
            active = null;
          }
          documentIds.push(selected.id);
        }
        original.current = buildLedgerRegistration(
          draft,
          registrationId.current,
          ownerProof,
          documentIds,
        );
      }
      setPhase("Đang gửi hồ sơ…");
      const data = await ledgerRequest<S["EnterpriseRegistrationReceiptDto"]>(
        "/auth/register",
        { method: "POST", body: JSON.stringify(original.current) },
        false,
      );
      const sentTo = original.current.email;
      original.current = null;
      uploaded.current.clear();
      proof.current = null;
      setFrozen(false);
      onComplete(data, sentTo);
    } catch (cause) {
      fail(cause);
      if (active && !uncertain(cause))
        onFileError(
          active,
          getLedgerError(cause)?.message ?? "Không tải được tài liệu",
        );
      if (original.current && !uncertain(cause)) original.current = null;
      throw cause;
    }
  }
  async function send() {
    if (
      busy.current ||
      original.current ||
      verifyAttempt.current ||
      (frozen && !sendAttempt.current)
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    setPhase("Đang gửi mã xác thực…");
    const currentEmail = draft.email.trim().toLowerCase();
    if (
      email.current !== currentEmail &&
      !sendAttempt.current &&
      !verifyAttempt.current &&
      !original.current
    ) {
      registrationId.current = crypto.randomUUID();
      email.current = currentEmail;
      uploaded.current.clear();
      proof.current = null;
    }
    if (!sendAttempt.current) {
      proof.current = null;
      sendAttempt.current = {
        registrationId: registrationId.current,
        requestId: crypto.randomUUID(),
        email: currentEmail,
      };
    }
    try {
      const data = await ledgerRequest<S["RegistrationOtpReceipt"]>(
        "/auth/registration-otp/request",
        {
          method: "POST",
          headers: { "Idempotency-Key": sendAttempt.current.requestId },
          body: JSON.stringify(sendAttempt.current),
        },
        false,
      );
      sendAttempt.current = null;
      verifyAttempt.current = null;
      setReceipt(data);
      setFrozen(false);
    } catch (cause) {
      fail(cause);
      if (!uncertain(cause)) sendAttempt.current = null;
    } finally {
      busy.current = false;
      setPending(false);
      setPhase("");
    }
  }
  async function verify(code: string) {
    if (
      busy.current ||
      !receipt ||
      sendAttempt.current ||
      (!verifyAttempt.current &&
        !proof.current &&
        !original.current &&
        !/^\d{6}$/.test(code))
    )
      return;
    busy.current = true;
    setPending(true);
    setError("");
    setPhase("Đang xác thực…");
    try {
      if (!proof.current && !original.current) {
        verifyAttempt.current ??= {
          registrationId: registrationId.current,
          verificationId: receipt.verificationId,
          attemptId: crypto.randomUUID(),
          code,
        };
        proof.current = await ledgerRequest<S["RegistrationOtpVerifiedView"]>(
          "/auth/registration-otp/verify",
          {
            method: "POST",
            headers: { "Idempotency-Key": verifyAttempt.current.attemptId },
            body: JSON.stringify(verifyAttempt.current),
          },
          false,
        );
        verifyAttempt.current = null;
      }
      if (proof.current) await finishRegistration(proof.current);
    } catch (cause) {
      fail(cause);
      if (!uncertain(cause)) verifyAttempt.current = null;
    } finally {
      busy.current = false;
      setPending(false);
      setPhase("");
    }
  }
  const retry = (code: string) => (sendAttempt.current ? send() : verify(code));
  return {
    send,
    verify,
    retry,
    receipt,
    pending,
    error,
    frozen,
    phase,
    hasOriginal: () => original.current !== null,
  };
}
