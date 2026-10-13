"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { usePendingCommands } from "@/lib/use-pending-commands";
import type { components } from "@/lib/generated/api";
import { IndexedDbKeyStore, type KeyStore } from "@/lib/signing/key-store";
import { createSigningKey, ed25519Supported } from "@/lib/signing/signer";

type Context = components["schemas"]["SigningContextDto"];
type PanelProps = {
  chainId: string;
  organizationId: string;
  orgAdmin: boolean;
  keyStore?: KeyStore;
};
const keyOperations = [
  "HYB_REGISTER_SIGNING_KEY",
  "HYB_REVOKE_SIGNING_KEY",
] as const;
function messageOf(cause: unknown, fallback: string) {
  return cause && typeof cause === "object" && "message" in cause
    ? String(cause.message)
    : fallback;
}

export function SigningKeysPanel(props: PanelProps) {
  const auth = useAuth();
  if (
    !auth.user ||
    auth.user.organizationId !== props.organizationId ||
    auth.user.accountStatus !== "ACTIVE" ||
    (auth.privateAccessStatus && auth.privateAccessStatus !== "ready")
  )
    return <p role="status">Đang kiểm tra quyền khóa ký…</p>;
  return (
    <SigningKeysWorkspace
      key={JSON.stringify([
        getAuthorizationScope(auth.user),
        props.chainId,
        props.organizationId,
        props.orgAdmin,
      ])}
      {...props}
    />
  );
}

const statuses: Record<string, string> = {
  PENDING_LEDGER: "Chờ kích hoạt trên ledger",
  ACTIVE: "Đang hoạt động",
  REVOKED: "Đã thu hồi",
};

/** Organization signing keys for independent confirmation. The private key is
 * created on this device and never sent; the API receives the public key and a
 * proof that this device holds it. Activation on the ledger is an operator
 * step that needs the owner's approval, so a new key shows as pending. */
function SigningKeysWorkspace({
  chainId,
  organizationId,
  orgAdmin,
  keyStore,
}: PanelProps) {
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
  const pending = usePendingCommands(keyOperations);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

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
        if (
          value.chainId !== chainId ||
          value.organizationId !== organizationId
        )
          throw new Error("Khóa ký không thuộc chuỗi hoặc tổ chức đang xem.");
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
    if (
      !context?.bindingDigest ||
      busy ||
      pending ||
      !orgAdmin ||
      !label.trim()
    )
      return;
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
      if (!alive.current) {
        await store.remove(created.keyRef);
        return;
      }
      await request(`/supply-chains/${chainId}/signing-keys`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(created),
      });
      if (!alive.current) return;
      setLabel("");
      setNotice(
        "Đã tạo khóa trên thiết bị này. Khóa dùng được sau khi vận hành viên kích hoạt trên ledger.",
      );
      refresh();
    } catch (cause) {
      // A lost response may follow an accepted registration. Preserve the
      // non-extractable private key until the original journal is reconciled.
      if (
        created &&
        cause &&
        typeof cause === "object" &&
        "code" in cause &&
        cause.code === "REQUEST_REJECTED"
      )
        await store.remove(created.keyRef).catch(() => undefined);
      if (alive.current) {
        setError(
          messageOf(
            cause,
            "Chưa đọc được kết quả đăng ký khóa. Kiểm tra yêu cầu đang chờ trước khi tạo khóa khác.",
          ),
        );
        if (
          created &&
          !(
            cause &&
            typeof cause === "object" &&
            "code" in cause &&
            cause.code === "REQUEST_REJECTED"
          )
        )
          setLocal((keys) => new Set([...keys, created!.keyRef]));
      }
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function revoke(event: FormEvent) {
    event.preventDefault();
    if (!revoking || busy || pending || !orgAdmin) return;
    setBusy(true);
    setError("");
    try {
      await request(
        `/supply-chains/${chainId}/signing-keys/${revoking}/revoke`,
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify({ reason: reason.trim() }),
        },
      );
      if (!alive.current) return;
      setRevoking("");
      setReason("");
      refresh();
    } catch (cause) {
      if (alive.current) setError(messageOf(cause, "Không thu hồi được khóa."));
    } finally {
      if (alive.current) setBusy(false);
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
        chủ. Chế độ bàn giao:{" "}
        {context.handoverMode === "DUAL_SIGNED"
          ? "hai bên có chữ ký"
          : "tiêu chuẩn"}
        .
      </p>
      {pending && (
        <p className="notice" role="status">
          Có yêu cầu khóa ký chưa rõ kết quả. Kiểm tra mục “Yêu cầu cần đối
          soát” trước khi tạo hoặc thu hồi khóa khác.
        </p>
      )}
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
                  className="button secondary"
                  disabled={busy || pending}
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
        <form onSubmit={revoke} aria-label="Thu hồi khóa" className="form-grid">
          <label className="field">
            <span>Lý do thu hồi</span>
            <input
              className="input"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              minLength={3}
              maxLength={500}
              required
            />
          </label>
          <div className="actions">
            <button
              type="submit"
              className="button danger"
              disabled={busy || pending}
            >
              Xác nhận thu hồi
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setRevoking("")}
            >
              Hủy
            </button>
          </div>
        </form>
      )}
      {orgAdmin && context.bindingDigest && supported === true && (
        <form onSubmit={enroll} aria-label="Tạo khóa ký" className="form-grid">
          <label className="field">
            <span>Tên khóa</span>
            <input
              className="input"
              value={label}
              onChange={(event) => setLabel(event.target.value)}
              maxLength={100}
              required
            />
          </label>
          <div className="actions">
            <button type="submit" className="button" disabled={busy || pending}>
              Tạo khóa ký trên thiết bị này
            </button>
          </div>
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
      {notice && (
        <p className="notice" role="status">
          {notice}
        </p>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
