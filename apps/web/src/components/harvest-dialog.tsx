"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { LoaderCircle, Plus, X } from "lucide-react";
import { getProductionCycles, recordHarvest } from "@/lib/api-client";
import type { ProductionCycleOption } from "@/lib/types";

export function HarvestDialog({ onCreated }: { onCreated(): void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [cycles, setCycles] = useState<ProductionCycleOption[]>([]);
  const [cycleId, setCycleId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unit, setUnit] = useState("kg");
  const [lotCode, setLotCode] = useState("");
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    getProductionCycles()
      .then((items) =>
        setCycles(
          items.filter((item) =>
            ["PLANTED", "GROWING"].includes(item.currentState),
          ),
        ),
      )
      .catch(() => setMessage("Không tải được chu kỳ sản xuất."));
  }, []);

  function selectCycle(id: string) {
    setCycleId(id);
    const cycle = cycles.find((item) => item.id === id);
    setUnit(cycle?.harvestUnit || cycle?.product.defaultUnit || "kg");
  }

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setMessage("");
    try {
      await recordHarvest(cycleId, {
        harvestTime: new Date().toISOString(),
        quantity: Number(quantity),
        unit,
        lotCode: lotCode.trim() || undefined,
      });
      dialog.current?.close();
      setQuantity("");
      setLotCode("");
      onCreated();
    } catch (cause) {
      setMessage(
        typeof cause === "object" && cause && "message" in cause
          ? String(cause.message)
          : "Không ghi nhận được thu hoạch.",
      );
    } finally {
      setPending(false);
    }
  }

  return (
    <>
      <button className="button" onClick={() => dialog.current?.showModal()}>
        <Plus size={18} /> Ghi nhận thu hoạch
      </button>
      <dialog className="command-dialog" ref={dialog}>
        <form onSubmit={submit}>
          <div className="panel-title">
            <h2>Ghi nhận thu hoạch</h2>
            <button
              className="icon-button"
              type="button"
              aria-label="Đóng"
              onClick={() => dialog.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
          <div className="field">
            <label>Chu kỳ sản xuất</label>
            <select
              className="select"
              required
              value={cycleId}
              onChange={(event) => selectCycle(event.target.value)}
            >
              <option value="">Chọn chu kỳ</option>
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
              <label>Số lượng</label>
              <input
                className="input"
                type="number"
                min="0.001"
                step="any"
                required
                value={quantity}
                onChange={(event) => setQuantity(event.target.value)}
              />
            </div>
            <div className="field">
              <label>Đơn vị</label>
              <input
                className="input"
                required
                value={unit}
                onChange={(event) => setUnit(event.target.value)}
              />
            </div>
          </div>
          <div className="field">
            <label>Mã lô (để trống để tự sinh)</label>
            <input
              className="input"
              maxLength={120}
              value={lotCode}
              onChange={(event) => setLotCode(event.target.value)}
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
              onClick={() => dialog.current?.close()}
            >
              Hủy
            </button>
            <button className="button" disabled={pending}>
              {pending ? (
                <LoaderCircle className="spinner" size={18} />
              ) : (
                <Plus size={18} />
              )}
              {pending ? "Đang ghi nhận..." : "Tạo lô từ thu hoạch"}
            </button>
          </div>
        </form>
      </dialog>
    </>
  );
}
