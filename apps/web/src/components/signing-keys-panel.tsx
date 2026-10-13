"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { request } from "@/lib/api-client";
import type { components } from "@/lib/generated/api";
import { IndexedDbKeyStore, type KeyStore } from "@/lib/signing/key-store";
import { createSigningKey, ed25519Supported } from "@/lib/signing/signer";

type Context = components["schemas"]["SigningContextDto"];

const statuses: Record<string, string> = {
  PENDING_LEDGER: "Chờ kích hoạt trên ledger",
  ACTIVE: "Đang hoạt động",
  REVOKED: "Đã thu hồi",
};

/** Organization signing keys for independent confirmation. The private key is
 * created on this device and never sent; the API receives the public key and a
 * proof that this device holds it. Activation on the ledger is an operator
 * step that needs the owner's approval, so a new key shows as pending. */
export function SigningKeysPanel({
  chainId,
  organizationId,
  orgAdmin,
  keyStore,
}: {
  chainId: string;
  organizationId: string;
  orgAdmin: boolean;
  keyStore?: KeyStore;
}) {
  const store = useMemo(() => keyStore ?? new IndexedDbKeyStore(), [keyStore]);
  const [context, setContext] = useState<Context | null>(null);
  const [local, setLocal] = useState<Set<string>>(new Set());
  const [supported, setSupported] = useState<boolean | null>(null);
  const [label, setLabel] = useState("");
  const [revoking, setRevoking] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [revision, setRevision] = useState(0);

  useEffect(() => {
    let active = true;
    setContext(null);
    setError("");
    Promise.all([
      request<Context>(`/supply-chains/${chainId}/signing-keys`),
      store.list(chainId, organizationId).catch(() => []),
      ed25519Supported(),
    ])
      .then(([value, stored, ok]) => {
        if (!active) return;
        setContext(value);
        setLocal(new Set(stored.map((key) => key.id)));
        setSupported(ok);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [chainId, organizationId, store, revision]);

  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  async function enroll(event: FormEvent) {
    event.preventDefault();
    if (!context?.bindingDigest || busy) return;
    setBusy(true);
    setError("");
    setNotice("");
    let created: Awaited<ReturnType<typeof createSigningKey>> | null = null;
    try {
      created = await createSigningKey(store, {
        chainId,
        organizationId,
        bindingDigest: context.bindingDigest,
        label: label.trim(),
      });
      await request(`/supply-chains/${chainId}/signing-keys`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(created),
      });
      setLabel("");
      setNotice(
        "Đã tạo khóa trên thiết bị này. Khóa dùng được sau khi vận hành viên kích hoạt trên ledger.",
      );
      refresh();
    } catch (cause) {
      // Never keep a private key that the API did not accept.
      if (created) await store.remove(created.keyRef).catch(() => undefined);
      setError(
        cause instanceof Error ? cause.message : "Không tạo được khóa ký.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function revoke(event: FormEvent) {
    event.preventDefault();
    if (!revoking || busy) return;
    setBusy(true);
    setError("");
    try {
      await request(`/supply-chains/${chainId}/signing-keys/${revoking}/revoke`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ reason: reason.trim() }),
      });
      setRevoking("");
      setReason("");
      refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không thu hồi được khóa.",
      );
    } finally {
      setBusy(false);
    }
  }

  if (error && !context)
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  if (!context) return <p role="status">Đang tải khóa ký…</p>;
  return (
    <section className="panel" aria-label="Khóa ký tổ chức">
      <h2>Khóa ký của tổ chức</h2>
      <p className="muted">
        Khóa riêng nằm trên thiết bị của bạn và không bao giờ được gửi lên máy
        chủ. Chế độ bàn giao: {context.handoverMode === "DUAL_SIGNED"
          ? "hai bên có chữ ký"
          : "tiêu chuẩn"}
        .
      </p>
      {context.keys.length === 0 && <p>Chưa có khóa ký nào.</p>}
      <ul>
        {context.keys.map((key) => (
          <li key={key.keyRef}>
            <strong>{key.label}</strong> — {statuses[key.status] ?? key.status}
            {" · "}
            {local.has(key.keyRef)
              ? "khóa riêng có trên thiết bị này"
              : "khóa riêng không có trên thiết bị này"}
            {orgAdmin && key.status !== "REVOKED" && (
              <>
                {" "}
                <button
                  type="button"
                  className="secondary"
                  onClick={() => setRevoking(key.keyRef)}
                >
                  Thu hồi
                </button>
              </>
            )}
          </li>
        ))}
      </ul>
      {revoking && (
        <form onSubmit={revoke} aria-label="Thu hồi khóa">
          <label>
            Lý do thu hồi
            <input
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            Xác nhận thu hồi
          </button>{" "}
          <button type="button" onClick={() => setRevoking("")}>
            Hủy
          </button>
        </form>
      )}
      {orgAdmin && context.bindingDigest && supported === true && (
        <form onSubmit={enroll} aria-label="Tạo khóa ký">
          <label>
            Tên khóa
            <input
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={100}
              required
            />
          </label>
          <button type="submit" disabled={busy}>
            Tạo khóa ký trên thiết bị này
          </button>
        </form>
      )}
      {orgAdmin && context.bindingDigest && supported === false && (
        <p className="notice">
          Trình duyệt này chưa hỗ trợ khóa Ed25519. Dùng trình duyệt mới hơn
          hoặc dịch vụ ký từ xa của doanh nghiệp.
        </p>
      )}
      {!context.bindingDigest && (
        <p className="muted">
          Chuỗi chưa có kết nối ledger riêng nên chưa dùng chữ ký tổ chức.
        </p>
      )}
      {notice && <p role="status">{notice}</p>}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
