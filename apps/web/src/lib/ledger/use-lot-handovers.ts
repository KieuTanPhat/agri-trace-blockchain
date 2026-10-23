"use client";
// AST extraction: pinned baseline non-rendering control flow only.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "@/lib/api-client";
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
type Review = {
  prepared: PreparedIntent;
  title: string;
  operation: "HANDOVER_OFFER" | "HANDOVER_CONFIRM";
  keyRef: string;
};

export function useLotHandovers({
  chainId,
  shipmentId,
  status,
  organizationId,
  farmOrgId,
  transporterOrgId,
  retailerOrgId,
  keyStore,
  onChanged,
}: PanelProps){
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
async function resolve(id: string, action: "reject" | "cancel", reason="") {
    if (busy || pending) return;
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
const open = (handovers??[]).find((item) => item.state === "OFFERED");
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
return {store,handovers,setHandovers,review,setReview,note,setNote,offerValidMinutes,setOfferValidMinutes,busy,setBusy,error,setError,revision,setRevision,alive,signingContext,setSigningContext,deviceKeys,setDeviceKeys,keyRef,setKeyRef,access,setAccess,pending,refresh,canRole,roleOf,activeKeys,canSign,prepare,signAndSubmit,resolve,open,offerKind};
}
