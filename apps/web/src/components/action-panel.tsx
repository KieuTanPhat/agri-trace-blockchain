"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { ArrowRight, ClipboardCheck, LoaderCircle, X } from "lucide-react";
import { getOrganizations, submitCommand } from "@/lib/api-client";
import type {
  AllowedCommand,
  CommandInput,
  LotTrace,
  Organization,
} from "@/lib/types";
import { IconZap } from "./icons";
import { ErrorState } from "./error-state";

const labels: Record<AllowedCommand, string> = {
  createShipment: "Tạo chuyến vận chuyển",
  reportDamage: "Báo hỏng",
  startTransport: "Bắt đầu vận chuyển",
  reportArrival: "Báo đã đến điểm nhận",
  receiveRetail: "Nhận lô",
  rejectRetail: "Từ chối lô",
};

export function ActionPanel({
  lot,
  onCompleted,
}: {
  lot: LotTrace;
  onCompleted?: () => void;
}) {
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<AllowedCommand | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [input, setInput] = useState<CommandInput>({});
  const [result, setResult] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (selected === "createShipment")
      getOrganizations()
        .then(setOrganizations)
        .catch(() => setOrganizations([]));
  }, [selected]);

  function open(command: AllowedCommand) {
    setSelected(command);
    setInput(
      command === "receiveRetail"
        ? { receivedQuantity: lot.availableQuantity, damagedQuantity: 0 }
        : {},
    );
    dialog.current?.showModal();
  }

  async function runCommand(event: FormEvent) {
    event.preventDefault();
    if (!selected) return;
    setPending(true);
    try {
      const response = await submitCommand(lot, selected, input);
      setResult(response.message);
      dialog.current?.close();
      onCompleted?.();
    } catch (cause) {
      setResult(
        typeof cause === "object" && cause && "message" in cause
          ? String(cause.message)
          : "Chưa gửi được thao tác. Vui lòng thử lại.",
      );
      dialog.current?.close();
    } finally {
      setPending(false);
    }
  }

  return (
    <aside className="panel">
      <div className="panel-title">
        <div className="panel-title-left">
          <span className="panel-icon accent">
            <IconZap size={18} />
          </span>
          <div>
            <p className="eyebrow">Cổng thao tác</p>
            <h2>Thao tác khả dụng</h2>
          </div>
        </div>
      </div>
      {lot.allowedCommands.length === 0 ? (
        <ErrorState
          status={403}
          title="Không có thao tác phù hợp"
          message="Người dùng hoặc trạng thái hiện tại chưa được máy chủ cho phép thực hiện thao tác nào."
        />
      ) : (
        <div className="actions">
          {lot.allowedCommands.map((command) => (
            <button
              className={
                command === "rejectRetail" || command === "reportDamage"
                  ? "button danger"
                  : "button"
              }
              disabled={pending}
              key={command}
              onClick={() => open(command)}
            >
              <ClipboardCheck size={18} />
              {labels[command]}
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      )}
      <div role="status" aria-live="polite">
        {result && <div className="notice">{result}</div>}
      </div>
      <dialog
        className="command-dialog"
        ref={dialog}
        aria-labelledby="command-title"
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form onSubmit={runCommand}>
          <div className="panel-title">
            <h2 id="command-title">
              {selected ? labels[selected] : "Xác nhận thao tác"}
            </h2>
            <button
              className="icon-button"
              type="button"
              title="Đóng"
              aria-label="Đóng"
              disabled={pending}
              onClick={() => dialog.current?.close()}
            >
              <X size={18} />
            </button>
          </div>
          <dl className="dialog-summary">
            <dt>Mã lô</dt>
            <dd>{lot.lotCode}</dd>
            <dt>Phiên bản</dt>
            <dd>{lot.version ?? 0}</dd>
          </dl>
          {selected === "createShipment" && (
            <div className="form-grid">
              <div className="field">
                <label>Đơn vị vận chuyển</label>
                <select
                  className="select"
                  required
                  value={input.transporterOrgId ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, transporterOrgId: event.target.value })
                  }
                >
                  <option value="">Chọn đơn vị</option>
                  {organizations
                    .filter((item) => item.type === "TRANSPORTER")
                    .map((item) => (
                      <option
                        key={item.organizationId}
                        value={item.organizationId}
                      >
                        {item.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Điểm bán nhận hàng</label>
                <select
                  className="select"
                  required
                  value={input.retailerOrgId ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, retailerOrgId: event.target.value })
                  }
                >
                  <option value="">Chọn điểm bán</option>
                  {organizations
                    .filter((item) => item.type === "RETAILER")
                    .map((item) => (
                      <option
                        key={item.organizationId}
                        value={item.organizationId}
                      >
                        {item.name}
                      </option>
                    ))}
                </select>
              </div>
              <div className="field">
                <label>Điểm đi</label>
                <input
                  className="input"
                  required
                  value={input.origin ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, origin: event.target.value })
                  }
                />
              </div>
              <div className="field">
                <label>Điểm đến</label>
                <input
                  className="input"
                  required
                  value={input.destination ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, destination: event.target.value })
                  }
                />
              </div>
            </div>
          )}
          {selected === "reportDamage" && (
            <>
              <div className="field">
                <label>Số lượng hư hỏng ({lot.unit})</label>
                <input
                  className="input"
                  type="number"
                  min="0.001"
                  max={lot.availableQuantity}
                  step="any"
                  required
                  value={input.quantity ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, quantity: Number(event.target.value) })
                  }
                />
              </div>
              <ReasonField
                value={input.reason}
                onChange={(reason) => setInput({ ...input, reason })}
              />
            </>
          )}
          {selected === "receiveRetail" && (
            <div className="form-grid">
              <div className="field">
                <label>Số lượng nhận ({lot.unit})</label>
                <input
                  className="input"
                  type="number"
                  min="0.001"
                  step="any"
                  required
                  value={input.receivedQuantity ?? ""}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      receivedQuantity: Number(event.target.value),
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Số lượng hư hỏng ({lot.unit})</label>
                <input
                  className="input"
                  type="number"
                  min="0"
                  step="any"
                  value={input.damagedQuantity ?? 0}
                  onChange={(event) =>
                    setInput({
                      ...input,
                      damagedQuantity: Number(event.target.value),
                    })
                  }
                />
              </div>
              <div className="field">
                <label>Ghi chú</label>
                <input
                  className="input"
                  value={input.note ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, note: event.target.value })
                  }
                />
              </div>
            </div>
          )}
          {selected === "rejectRetail" && (
            <ReasonField
              value={input.reason}
              onChange={(reason) => setInput({ ...input, reason })}
            />
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
            <button className="button" type="submit" disabled={pending}>
              {pending ? (
                <LoaderCircle size={18} className="spinner" />
              ) : (
                <ClipboardCheck size={18} />
              )}
              {pending ? "Đang gửi..." : "Xác nhận"}
            </button>
          </div>
        </form>
      </dialog>
    </aside>
  );
}

function ReasonField({
  value,
  onChange,
}: {
  value?: string;
  onChange(value: string): void;
}) {
  return (
    <div className="field">
      <label>Lý do</label>
      <textarea
        className="input"
        required
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
