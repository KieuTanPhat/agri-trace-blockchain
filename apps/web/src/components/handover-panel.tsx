"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { request } from "@/lib/api-client";
import type { components } from "@/lib/generated/api";
import type { PreparedIntent } from "@/lib/signing/canonical";
import { IndexedDbKeyStore, type KeyStore } from "@/lib/signing/key-store";
import { signPreparedIntent } from "@/lib/signing/signer";

type Handover = components["schemas"]["HandoverDto"];

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
};

/** Two-party handover of a shipment. Custody changes only after the giver has
 * signed an offer and the receiver confirmed that exact offer with its own
 * signature. The user always reviews what is derived from the signed payload,
 * and the device re-derives the digests before it signs. */
export function HandoverPanel({
  shipmentId,
  status,
  organizationId,
  farmOrgId,
  transporterOrgId,
  keyStore,
  onChanged,
}: {
  shipmentId: string;
  status: string;
  organizationId: string | null;
  farmOrgId: string;
  transporterOrgId: string;
  keyStore?: KeyStore;
  onChanged?: () => void;
}) {
  const store = useMemo(() => keyStore ?? new IndexedDbKeyStore(), [keyStore]);
  const [handovers, setHandovers] = useState<Handover[] | null>(null);
  const [review, setReview] = useState<Review | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [revision, setRevision] = useState(0);
  const keys = useRef(new Map<string, string>());

  useEffect(() => {
    let active = true;
    setHandovers(null);
    request<Handover[]>(`/shipments/${shipmentId}/handovers`)
      .then((value) => {
        if (active) setHandovers(value);
      })
      .catch((cause: Error) => {
        if (active) setError(cause.message);
      });
    return () => {
      active = false;
    };
  }, [shipmentId, status, revision]);

  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
    onChanged?.();
  }, [onChanged]);

  async function prepare(path: string, body: object, title: string) {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const prepared = await request<PreparedIntent>(path, {
        method: "POST",
        headers: { "idempotency-key": crypto.randomUUID() },
        body: JSON.stringify(body),
      });
      setReview({ prepared, title });
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không chuẩn bị được yêu cầu ký.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function signAndSubmit() {
    if (!review || busy) return;
    setBusy(true);
    setError("");
    try {
      const signature = await signPreparedIntent(store, review.prepared);
      // A retry of the same submission reuses its key, so a lost response is
      // replayed by the server instead of failing as "already used".
      const id = review.prepared.intentId;
      const key = keys.current.get(id) ?? crypto.randomUUID();
      keys.current.set(id, key);
      await request(`/signing-intents/${id}/submit`, {
        method: "POST",
        headers: { "idempotency-key": key },
        body: JSON.stringify({ signature }),
      });
      setReview(null);
      setNote("");
      refresh();
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Không ký và gửi được.",
      );
    } finally {
      setBusy(false);
    }
  }

  async function resolve(id: string, action: "reject" | "cancel") {
    if (busy) return;
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
      refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Không xử lý được.");
    } finally {
      setBusy(false);
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
      ? status === "CREATED" && organizationId === farmOrgId
        ? "PICKUP"
        : status === "IN_TRANSIT" && organizationId === transporterOrgId
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
                {organizationId === item.receiverOrgId && (
                  <>
                    {" "}
                    <button
                      type="button"
                      disabled={busy}
                      onClick={() =>
                        prepare(
                          `/handovers/${item.id}/confirmation/intent`,
                          {},
                          "Xác nhận đã nhận hàng",
                        )
                      }
                    >
                      Xác nhận nhận hàng
                    </button>{" "}
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
                      onClick={() => resolve(item.id, "reject")}
                    >
                      Từ chối
                    </button>
                  </>
                )}
                {organizationId === item.giverOrgId && (
                  <>
                    {" "}
                    <button
                      type="button"
                      className="secondary"
                      disabled={busy}
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
          onSubmit={(event) => {
            event.preventDefault();
            void prepare(
              `/shipments/${shipmentId}/handover-offers/intent`,
              { kind: offerKind, ...(note ? { note } : {}) },
              kindLabels[offerKind],
            );
          }}
        >
          <label>
            Ghi chú (không bắt buộc)
            <input
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={500}
            />
          </label>
          <button type="submit" disabled={busy}>
            Đề nghị bàn giao: {kindLabels[offerKind].toLowerCase()}
          </button>
        </form>
      )}
      {review && (
        <section aria-label="Xem lại trước khi ký" className="notice">
          <h4>{review.title}</h4>
          <p>Bạn sắp ký và gửi nội dung sau bằng khóa của tổ chức:</p>
          <dl>
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
            <dd>{new Date(review.prepared.expiresAt).toLocaleString("vi-VN")}</dd>
          </dl>
          <button type="button" disabled={busy} onClick={signAndSubmit}>
            Ký và gửi
          </button>{" "}
          <button type="button" onClick={() => setReview(null)}>
            Không ký
          </button>
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
