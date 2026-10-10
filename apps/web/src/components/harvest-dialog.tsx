"use client";

import Link from "next/link";
import { QrCodeCard } from "./qr-code-card";
import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import { getProductionCycles } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { getAuthorizationScope } from "@/lib/auth-scope";
import {
  beginNewHarvest,
  recoverHarvest,
  sendHarvest,
  type HarvestRecovery,
} from "@/lib/harvest-recovery";
import type { ProductionCycleOption } from "@/lib/types";

export function HarvestDialog({ onCreated }: { onCreated(): void }) {
  const { user } = useAuth();
  if (!user || user.role.code !== "FARM_STAFF") return null;
  const scope = getAuthorizationScope(user);
  return (
    <ScopedHarvestDialog key={scope} scope={scope} onCreated={onCreated} />
  );
}

function ScopedHarvestDialog({
  scope,
  onCreated,
}: {
  scope: string;
  onCreated(): void;
}) {
  const busy = useRef(false);
  const mounted = useRef(false);
  const [recovery, setRecovery] = useState<HarvestRecovery | null>(null);
  const [created, setCreated] = useState<{
    lot: { id: string; lotCode: string };
    traceQr: { traceToken: string };
  } | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [cycles, setCycles] = useState<ProductionCycleOption[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("kg");
  const [lotCode, setLotCode] = useState("");
  const [expiryDate, setExpiryDate] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  const showError = useCallback((cause: unknown) => {
    if (!mounted.current) return;
    setMessage(
      cause && typeof cause === "object" && "message" in cause
        ? String(cause.message)
        : "Không xác định được kết quả thu hoạch. Vui lòng kiểm tra lại.",
    );
  }, []);

  const applyRecovery = useCallback((next: HarvestRecovery) => {
    if (!mounted.current) return;
    setRecovery(next);
    if (next.state.intent) setCycleId(next.state.intent.cycleId);
    if (next.status?.status === "COMMITTED" && next.status.result) {
      setCreated(next.status.result);
      setMessage(
        "Đã tìm thấy lô của yêu cầu trước. Chọn ghi nhận lần thu hoạch mới nếu bạn muốn thu hoạch thêm.",
      );
      dialog.current?.close();
    } else if (next.status?.status === "REJECTED") {
      setMessage(
        "Yêu cầu trước đã bị từ chối và chưa tạo lô. Bạn có thể bắt đầu lần ghi nhận mới để sửa nội dung.",
      );
    } else if (next.state.intent) {
      setMessage(
        next.status?.status === "NOT_FOUND"
          ? "Chưa tìm thấy kết quả. Nhập lại đúng nội dung trước đó để thử lại cùng yêu cầu."
          : "Yêu cầu trước chưa rõ kết quả. Kiểm tra lại hoặc liên hệ hỗ trợ trước khi thu hoạch thêm.",
      );
    } else setMessage("");
  }, []);

  useEffect(() => {
    mounted.current = true;
    getProductionCycles()
      .then((items) => {
        if (mounted.current)
          setCycles(
            items.filter((item) =>
              ["PLANTED", "GROWING"].includes(item.currentState),
            ),
          );
      })
      .catch(() => {
        if (mounted.current) setMessage("Không tải được chu kỳ sản xuất.");
      });
    void recoverHarvest(scope).then(applyRecovery).catch(showError);
    return () => {
      mounted.current = false;
    };
  }, [scope, applyRecovery, showError]);

  async function checkPrevious() {
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    try {
      applyRecovery(await recoverHarvest(scope));
    } catch (cause) {
      showError(cause);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  async function startNew() {
    if (busy.current || !recovery) return;
    busy.current = true;
    setPending(true);
    try {
      const state = await beginNewHarvest(scope, recovery.state.revision);
      if (!mounted.current) return;
      applyRecovery({ state });
      setCreated(null);
      setCycleId("");
      setQuantity("");
      setLotCode("");
      setExpiryDate("");
      dialog.current?.showModal();
    } catch (cause) {
      showError(cause);
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  function selectCycle(id: string) {
    setCycleId(id);
    const cycle = cycles.find((item) => item.id === id);
    setUnit(cycle?.harvestUnit || cycle?.product.defaultUnit || "kg");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || !recovery) return;
    busy.current = true;
    setPending(true);
    setMessage("");
    try {
      const result = await sendHarvest(
        scope,
        recovery.state.revision,
        cycleId,
        {
          quantity: Number(quantity),
          unit: unit.trim(),
          lotCode: lotCode.trim() || undefined,
          expiryDate: expiryDate || undefined,
        },
      );
      applyRecovery(result);
      if (mounted.current && result.status?.status === "COMMITTED") onCreated();
    } catch (cause) {
      showError(cause);
      // The request may have committed even when its response was lost.
      try {
        applyRecovery(await recoverHarvest(scope));
      } catch {
        /* Keep the original error and durable intent. */
      }
    } finally {
      busy.current = false;
      if (mounted.current) setPending(false);
    }
  }

  return (
    <>
      <button
        className="button"
        disabled={pending}
        onClick={() => dialog.current?.showModal()}
      >
        <Plus size={18} /> Ghi nhận thu hoạch
      </button>
      {created && (
        <section className="panel" role="status">
          <h2>Đã tạo lô {created.lot.lotCode}</h2>
          <button className="button" disabled={pending} onClick={startNew}>
            Ghi nhận lần thu hoạch mới
          </button>
          <Link href={"/lots/" + created.lot.id}>Xem lô vừa tạo</Link>
          <QrCodeCard
            value={
              (process.env.NEXT_PUBLIC_TRACE_BASE_URL ??
                window.location.origin + "/trace") +
              "/" +
              created.traceQr.traceToken
            }
          />
        </section>
      )}
      <dialog
        className="command-dialog"
        ref={dialog}
        onCancel={(e) => {
          if (pending) e.preventDefault();
        }}
      >
        <form onSubmit={submit}>
          <div className="panel-title">
            <h2>Ghi nhận thu hoạch</h2>
            <button
              className="icon-button"
              type="button"
              aria-label="Đóng"
              disabled={pending}
              onClick={() => dialog.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
          <fieldset
            disabled={
              pending ||
              !recovery ||
              Boolean(recovery.status && recovery.status.status !== "NOT_FOUND")
            }
            style={{ border: 0, padding: 0, margin: 0 }}
          >
            <div className="field">
              <label htmlFor="harvest-cycle">Chu kỳ sản xuất</label>
              <select
                id="harvest-cycle"
                className="select"
                required
                value={cycleId}
                disabled={Boolean(recovery?.state.intent)}
                onChange={(event) => selectCycle(event.target.value)}
              >
                <option value="">Chọn chu kỳ</option>
                {recovery?.state.intent &&
                  !cycles.some(
                    (cycle) => cycle.id === recovery.state.intent?.cycleId,
                  ) && (
                    <option value={recovery.state.intent.cycleId}>
                      Chu kỳ của yêu cầu trước
                    </option>
                  )}
                {cycles.map((cycle) => (
                  <option key={cycle.id} value={cycle.id}>
                    {cycle.cycleCode} — {cycle.product.productName} —{" "}
                    {cycle.farm.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="form-row">
              <div className="field">
                <label htmlFor="harvest-quantity">Số lượng</label>
                <input
                  id="harvest-quantity"
                  className="input"
                  type="number"
                  min="0.001"
                  step="0.001"
                  required
                  value={quantity}
                  onChange={(event) => setQuantity(event.target.value)}
                />
              </div>
              <div className="field">
                <label htmlFor="harvest-unit">Đơn vị</label>
                <input
                  id="harvest-unit"
                  className="input"
                  maxLength={30}
                  required
                  value={unit}
                  onChange={(event) => setUnit(event.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label htmlFor="harvest-code">Mã lô (để trống để tự sinh)</label>
              <input
                id="harvest-code"
                className="input"
                maxLength={120}
                value={lotCode}
                onChange={(event) => setLotCode(event.target.value)}
              />
            </div>
          </fieldset>
          <div className="field">
            <label htmlFor="harvest-expiry">Ngày hết hạn (nếu có)</label>
            <input
              id="harvest-expiry"
              className="input"
              type="date"
              value={expiryDate}
              onChange={(event) => setExpiryDate(event.target.value)}
            />
          </div>
          {message && (
            <div className="notice error" role="alert">
              {message}
            </div>
          )}
          <div className="dialog-actions">
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={() => dialog.current?.close()}
            >
              Hủy
            </button>
            {(!recovery?.status || recovery.status.status === "NOT_FOUND") && (
              <button className="button" disabled={pending || !recovery}>
                {pending ? (
                  <LoaderCircle className="spinner" size={18} />
                ) : (
                  <Plus size={18} />
                )}
                {pending ? "Đang ghi nhận..." : "Tạo lô từ thu hoạch"}
              </button>
            )}
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={checkPrevious}
            >
              Kiểm tra yêu cầu trước
            </button>
            {recovery?.status?.status === "REJECTED" && (
              <button
                className="button"
                type="button"
                disabled={pending}
                onClick={startNew}
              >
                Ghi nhận lần thu hoạch mới
              </button>
            )}
          </div>
        </form>
      </dialog>
    </>
  );
}
