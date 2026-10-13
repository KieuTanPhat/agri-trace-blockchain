"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import { usePendingCommands } from "@/lib/use-pending-commands";
import type { components } from "@/lib/generated/api";
import type { PreparedIntent } from "@/lib/signing/canonical";
import { IndexedDbKeyStore, type KeyStore } from "@/lib/signing/key-store";
import { signPreparedIntent } from "@/lib/signing/signer";

type Handover = components["schemas"]["HandoverDto"];
type SigningContext = components["schemas"]["SigningContextDto"];
type AccessContext = components["schemas"]["ChainContextDto"];
const handoverOperations = [
  "PREPARE_HANDOVER_OFFER",
  "PREPARE_HANDOVER_CONFIRM",
  "SUBMIT_SIGNED_INTENT",
  "REJECT_HANDOVER",
  "CANCEL_HANDOVER",
] as const;
function messageOf(cause: unknown, fallback: string) {
  return cause && typeof cause === "object" && "message" in cause
    ? String(cause.message)
    : fallback;
}
type PanelProps = {
  chainId: string;
  shipmentId: string;
  status: string;
  organizationId: string | null;
  farmOrgId: string;
  transporterOrgId: string;
  retailerOrgId: string;
  keyStore?: KeyStore;
  onChanged?: () => void;
};

const stateLabels: Record<string, string> = {
  OFFERED: "Đang chờ bên nhận xác nhận",
  CONFIRMED: "Đã bàn giao",
  REJECTED: "Bên nhận từ chối",
  EXPIRED: "Hết hạn",
  CANCELLED: "Bên giao đã hủy",
};
const kindLabels: Record<string, string> = {
  PICKUP: "Giao hàng cho đơn vị vận chuyển",
  ARRIVAL: "Giao hàng cho đơn vị bán lẻ",
};

type Review = {
  prepared: PreparedIntent;
  title: string;
  operation: "HANDOVER_OFFER" | "HANDOVER_CONFIRM";
  keyRef: string;
};

export function HandoverPanel(props: PanelProps) {
  const auth = useAuth();
  if (
    !auth.user ||
    auth.user.accountStatus !== "ACTIVE" ||
    auth.user.organizationId !== props.organizationId ||
    (auth.privateAccessStatus && auth.privateAccessStatus !== "ready")
  )
    return <p role="status">Đang kiểm tra quyền bàn giao…</p>;
  return (
    <HandoverWorkspace
      key={JSON.stringify([
        getAuthorizationScope(auth.user),
        props.chainId,
        props.shipmentId,
      ])}
      {...props}
    />
  );
}

/** Two-party handover of a shipment. Custody changes only after the giver has
 * signed an offer and the receiver confirmed that exact offer with its own
 * signature. The user always reviews what is derived from the signed payload,
 * and the device re-derives the digests before it signs. */
function HandoverWorkspace({
  chainId,
  shipmentId,
  status,
  organizationId,
  farmOrgId,
  transporterOrgId,
  retailerOrgId,
  keyStore,
  onChanged,
}: PanelProps) {
  const store = useMemo(() => keyStore ?? new IndexedDbKeyStore(), [keyStore]);
  const [handovers, setHandovers] = useState<Handover[] | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const [offerValidMinutes, setOfferValidMinutes] = useState("1440");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);
  const [signingContext, setSigningContext] = useState<SigningContext | null>(
    null,
  );
  const [deviceKeys, setDeviceKeys] = useState<Set<string>>(new Set());
  const [keyRef, setKeyRef] = useState("");
  const [access, setAccess] = useState<AccessContext | null>(null);
  const pending = usePendingCommands(handoverOperations);
  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    setHandovers(null);
    setReview(null);
    setError("");
    Promise.all([
      request<Handover[]>(`/shipments/${shipmentId}/handovers`),
      request<SigningContext>(`/supply-chains/${chainId}/signing-keys`),
      store.list(chainId, organizationId!),
      request<AccessContext>("/chain-permissions"),
    ])
      .then(([value, context, local, permissions]) => {
        if (!active) return;
        if (
          context.chainId !== chainId ||
          context.organizationId !== organizationId
        )
          throw new Error("Khóa ký không thuộc chuỗi hoặc tổ chức đang xem.");
        setHandovers(value);
        setSigningContext(context);
        setDeviceKeys(new Set(local.map((key) => key.id)));
        setAccess(permissions);
        const available = context.keys.filter(
          (key) =>
            key.status === "ACTIVE" &&
            local.some((stored) => stored.id === key.keyRef),
        );
        setKeyRef((selected) =>
          available.some((key) => key.keyRef === selected)
            ? selected
            : context.keys.filter((key) => key.status === "ACTIVE").length ===
                  1 && available.length === 1
              ? available[0].keyRef
              : "",
        );
      })
      .catch((cause: unknown) => {
        if (active)
          setError(messageOf(cause, "Không tải được bàn giao hoặc khóa ký."));
      });
    return () => {
      active = false;
    };
  }, [chainId, shipmentId, status, organizationId, store, revision]);

  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
    onChanged?.();
  }, [onChanged]);
  const canRole = (role: "FARM_STAFF" | "TRANSPORTER" | "RETAILER") =>
    Boolean(
      access?.businessChains?.includes(chainId) &&
      access.memberships.some(
        (member) =>
          member.chainId === chainId &&
          member.organizationId === organizationId &&
          member.status === "ACTIVE",
      ) &&
      access.capabilities.some(
        (capability) =>
          capability.organizationId === organizationId &&
          capability.code === (role === "FARM_STAFF" ? "FARM" : role) &&
          capability.revokedAt === null,
      ) &&
      access.grants.some(
        (grant) =>
          grant.chainId === chainId &&
          grant.organizationId === organizationId &&
          grant.role === role &&
          grant.scope === "CHAIN" &&
          grant.revokedAt === null,
      ),
    );
  const roleOf = (kind: string, side: "giver" | "receiver") =>
    kind === "PICKUP"
      ? side === "giver"
        ? "FARM_STAFF"
        : "TRANSPORTER"
      : side === "giver"
        ? "TRANSPORTER"
        : "RETAILER";
  const activeKeys =
    signingContext?.keys.filter((key) => key.status === "ACTIVE") ?? [];
  const canSign = Boolean(
    keyRef &&
    deviceKeys.has(keyRef) &&
    activeKeys.some((key) => key.keyRef === keyRef) &&
    signingContext?.bindingDigest &&
    signingContext.chainRef &&
    signingContext.handoverMode === "DUAL_SIGNED",
  );

  async function prepare(path: string, body: object, title: string) {
    if (
      busy ||
      pending ||
      !canSign ||
      !signingContext?.bindingDigest ||
      !signingContext.chainRef
    )
      return;
    const duration = (body as { offerValidMinutes?: number }).offerValidMinutes;
    if (
      duration !== undefined &&
      (!Number.isInteger(duration) || duration < 15 || duration > 10080)
    ) {
      setError("Hiệu lực đề nghị phải từ 15 đến 10080 phút.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      const prepared = await request<PreparedIntent>(path, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({
          ...body,
          keyRef,
          preparationRef: crypto.randomUUID(),
        }),
      });
      if (!alive.current) return;
      const operation = path.endsWith("/confirmation/intent")
        ? "HANDOVER_CONFIRM"
        : "HANDOVER_OFFER";
      if (
        prepared.intent.entityId !== shipmentId ||
        prepared.intent.entityType !== "SHIPMENT" ||
        prepared.intent.bindingDigest !== signingContext.bindingDigest ||
        prepared.intent.chainRef !== signingContext.chainRef ||
        prepared.intent.signerOrgRef !== organizationId ||
        prepared.keyRef !== keyRef ||
        prepared.operation !== operation ||
        prepared.payload.shipmentId !== shipmentId
      )
        throw new Error(
          "Yêu cầu ký không khớp chuỗi, chuyến hàng hoặc khóa đã chọn.",
        );
      const kind = prepared.payload.kind;
      if (
        !["PICKUP", "ARRIVAL"].includes(kind) ||
        prepared.payload.giverOrgId !==
          (kind === "PICKUP" ? farmOrgId : transporterOrgId) ||
        prepared.payload.receiverOrgId !==
          (kind === "PICKUP" ? transporterOrgId : retailerOrgId) ||
        (operation === "HANDOVER_OFFER" &&
          kind !== (body as { kind?: string }).kind) ||
        (operation === "HANDOVER_CONFIRM" &&
          prepared.payload.handoverId !== path.split("/")[2])
      )
        throw new Error(
          "Nội dung bàn giao không khớp bên giao, bên nhận hoặc đề nghị đã chọn.",
        );
      setReview({ prepared, title, operation, keyRef });
    } catch (cause) {
      if (alive.current)
        setError(messageOf(cause, "Không chuẩn bị được yêu cầu ký."));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function signAndSubmit() {
    if (
      !review ||
      busy ||
      pending ||
      !signingContext?.chainRef ||
      !signingContext.bindingDigest ||
      !organizationId
    )
      return;
    setBusy(true);
    setError("");
    try {
      const signature = await signPreparedIntent(store, review.prepared, {
        chainId,
        organizationId,
        chainRef: signingContext.chainRef,
        bindingDigest: signingContext.bindingDigest,
        entityId: shipmentId,
        operation: review.operation,
        keyRef: review.keyRef,
      });
      if (!alive.current) return;
      // request persists this exact signature and key before its first write.
      // Recovery reads the original journal and never signs a replacement.
      const id = review.prepared.intentId;
      await request(`/signing-intents/${id}/submit`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify({ signature }),
      });
      if (!alive.current) return;
      setReview(null);
      setNote("");
      refresh();
    } catch (cause) {
      if (alive.current) setError(messageOf(cause, "Không ký và gửi được."));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  async function resolve(id: string, action: "reject" | "cancel") {
    if (busy || pending) return;
    const reason =
      action === "reject"
        ? (window.prompt("Lý do từ chối nhận hàng") ?? "").trim()
        : "";
    if (action === "reject" && reason.length < 3) return;
    setBusy(true);
    setError("");
    try {
      await request(`/handovers/${id}/${action}`, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(action === "reject" ? { reason } : {}),
      });
      if (!alive.current) return;
      refresh();
    } catch (cause) {
      if (alive.current) setError(messageOf(cause, "Không xử lý được."));
    } finally {
      if (alive.current) setBusy(false);
    }
  }

  if (error && !handovers)
    return (
      <p className="notice error" role="alert">
        {error}
      </p>
    );
  if (!handovers) return <p role="status">Đang tải bàn giao…</p>;
  const open = handovers.find((item) => item.state === "OFFERED");
  const offerKind =
    !open && organizationId
      ? status === "CREATED" &&
        organizationId === farmOrgId &&
        canRole("FARM_STAFF")
        ? "PICKUP"
        : status === "IN_TRANSIT" &&
            organizationId === transporterOrgId &&
            canRole("TRANSPORTER")
          ? "ARRIVAL"
          : null
      : null;
  return (
    <section className="panel" aria-label="Bàn giao hai bên">
      <h3>Bàn giao có chữ ký hai bên</h3>
      <p className="muted">
        Hàng chỉ đổi người giữ sau khi bên giao ký đề nghị và bên nhận ký xác
        nhận đúng đề nghị đó.
      </p>
      {pending && (
        <p className="notice" role="status">
          Có yêu cầu bàn giao chưa rõ kết quả. Kiểm tra mục “Yêu cầu cần đối
          soát” trước khi gửi nội dung mới.
        </p>
      )}
      {(offerKind ||
        handovers.some(
          (item) =>
            item.state === "OFFERED" &&
            item.receiverOrgId === organizationId &&
            canRole(roleOf(item.kind, "receiver")),
        )) &&
        !review && (
          <label className="field">
            <span>Khóa ký cho bàn giao</span>
            <select
              className="input"
              value={keyRef}
              disabled={busy || pending}
              onChange={(event) => setKeyRef(event.target.value)}
            >
              <option value="">
                Chọn khóa đang hoạt động trên thiết bị này
              </option>
              {activeKeys.map((key) => (
                <option
                  key={key.keyRef}
                  value={key.keyRef}
                  disabled={!deviceKeys.has(key.keyRef)}
                >
                  {key.label}
                  {deviceKeys.has(key.keyRef)
                    ? ""
                    : " — không có khóa riêng trên thiết bị này"}
                </option>
              ))}
            </select>
          </label>
        )}
      {!canSign &&
        (offerKind ||
          handovers.some(
            (item) =>
              item.state === "OFFERED" && item.receiverOrgId === organizationId,
          )) && (
          <p className="notice">
            Chọn khóa đang hoạt động có trên thiết bị này để ký. Khi thiếu khóa
            hoặc dịch vụ ký lỗi, bàn giao vẫn chờ xác nhận có chữ ký.
          </p>
        )}
      {handovers.length === 0 && <p>Chưa có đề nghị bàn giao.</p>}
      <ul>
        {handovers.map((item) => (
          <li key={item.id}>
            <strong>{kindLabels[item.kind] ?? item.kind}</strong> —{" "}
            {stateLabels[item.state] ?? item.state}: {item.quantity} {item.unit}
            {item.custodyLabel === "INTERNAL_SAME_ORG" && (
              <> · bàn giao nội bộ (cùng tổ chức)</>
            )}
            {item.state === "OFFERED" && (
              <>
                {" · hết hạn "}
                {new Date(item.expiresAt).toLocaleString("vi-VN")}
                {organizationId === item.receiverOrgId &&
                  canRole(roleOf(item.kind, "receiver")) && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="button"
                        disabled={busy || pending || !canSign}
                        onClick={() =>
                          prepare(
                            `/handovers/${item.id}/confirmation/intent`,
                            {},
                            item.custodyLabel === "INTERNAL_SAME_ORG"
                              ? "Xác nhận đã nhận hàng nội bộ"
                              : "Xác nhận đã nhận hàng",
                          )
                        }
                      >
                        {item.custodyLabel === "INTERNAL_SAME_ORG"
                          ? "Xác nhận nhận hàng nội bộ"
                          : "Xác nhận nhận hàng"}
                      </button>{" "}
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy || pending}
                        onClick={() => resolve(item.id, "reject")}
                      >
                        Từ chối
                      </button>
                    </>
                  )}
                {organizationId === item.giverOrgId &&
                  canRole(roleOf(item.kind, "giver")) && (
                    <>
                      {" "}
                      <button
                        type="button"
                        className="button secondary"
                        disabled={busy || pending}
                        onClick={() => resolve(item.id, "cancel")}
                      >
                        Hủy đề nghị
                      </button>
                    </>
                  )}
              </>
            )}
            {item.reason && <> · {item.reason}</>}
          </li>
        ))}
      </ul>
      {offerKind && !review && (
        <form
          aria-label="Đề nghị bàn giao"
          className="form-grid"
          onSubmit={(event) => {
            event.preventDefault();
            void prepare(
              `/shipments/${shipmentId}/handover-offers/intent`,
              {
                kind: offerKind,
                ...(note ? { note } : {}),
                ...(offerValidMinutes !== "1440"
                  ? { offerValidMinutes: Number(offerValidMinutes) }
                  : {}),
              },
              kindLabels[offerKind],
            );
          }}
        >
          <label className="field">
            <span>Ghi chú (không bắt buộc)</span>
            <input
              className="input"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
            />
          </label>
          <label className="field">
            <span>Hiệu lực đề nghị (phút)</span>
            <input
              className="input"
              type="number"
              min={15}
              max={10080}
              step={1}
              required
              value={offerValidMinutes}
              onChange={(event) => setOfferValidMinutes(event.target.value)}
            />
          </label>
          <div className="actions">
            <button
              type="submit"
              className="button"
              disabled={busy || pending || !canSign}
            >
              Đề nghị bàn giao: {kindLabels[offerKind].toLowerCase()}
            </button>
          </div>
        </form>
      )}
      {review && (
        <section aria-label="Xem lại trước khi ký" className="notice">
          <h4>{review.title}</h4>
          <p>Bạn sắp ký và gửi nội dung sau bằng khóa của tổ chức:</p>
          {review.prepared.payload.giverOrgId ===
            review.prepared.payload.receiverOrgId && (
            <p className="notice">
              Đây là xác nhận bàn giao nội bộ trong cùng tổ chức; hai ý định
              giao và nhận vẫn phải được ký riêng.
            </p>
          )}
          <dl>
            <dt>Khóa ký</dt>
            <dd>
              {activeKeys.find((key) => key.keyRef === review.keyRef)?.label ??
                review.keyRef}
            </dd>
            <dt>Số lượng</dt>
            <dd>
              {review.prepared.payload.quantity} {review.prepared.payload.unit}
            </dd>
            <dt>Phiên bản chuyến hàng</dt>
            <dd>{review.prepared.payload.shipmentVersion}</dd>
            {review.prepared.payload.offerExpiresAt && (
              <>
                <dt>Bên nhận phải xác nhận trước</dt>
                <dd>
                  {new Date(
                    review.prepared.payload.offerExpiresAt,
                  ).toLocaleString("vi-VN")}
                </dd>
              </>
            )}
            {review.prepared.payload.note && (
              <>
                <dt>Ghi chú</dt>
                <dd>{review.prepared.payload.note}</dd>
              </>
            )}
            <dt>Hết hạn yêu cầu ký</dt>
            <dd>
              {new Date(review.prepared.expiresAt).toLocaleString("vi-VN")}
            </dd>
          </dl>
          <div className="actions">
            <button
              type="button"
              className="button"
              disabled={busy || pending || !canSign}
              onClick={signAndSubmit}
            >
              Ký và gửi
            </button>
            <button
              type="button"
              className="button secondary"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              Không ký
            </button>
          </div>
        </section>
      )}
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
    </section>
  );
}
