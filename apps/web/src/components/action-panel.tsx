"use client";

import { FormEvent, useId, useRef, useState } from "react";
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
  markForSale: "Đưa ra bán",
  markSold: "Bán toàn bộ lượng còn lại",
  recall: "Thu hồi lô",
  expire: "Ghi nhận hết hạn",
};

export function ActionPanel({
  lot,
  onCompleted,
}: {
  lot: LotTrace;
  onCompleted?: () => void;
}) {
  const fieldId = useId();
  const [pending, setPending] = useState(false);
  const [selected, setSelected] = useState<AllowedCommand | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [input, setInput] = useState<CommandInput>({});
  const [result, setResult] = useState("");
  const attempt = useRef({ payload: "", key: "" });
  const busy = useRef(false);
  const [error, setError] = useState("");
  const dialog = useRef<HTMLDialogElement>(null);

  function open(command: AllowedCommand) {
    setError("");
    setSelected(command);
    if (command === "createShipment")
      getOrganizations()
        .then(setOrganizations)
        .catch(() => setError("Không tải được tổ chức. Vui lòng thử lại."));
    setInput(
      command === "receiveRetail"
        ? { receivedQuantity: lot.availableQuantity, damagedQuantity: 0 }
        : {},
    );
    dialog.current?.showModal();
  }

  async function runCommand(event: FormEvent) {
    event.preventDefault();
    if (!selected || busy.current) return;
    busy.current = true;
    setError("");
    const payload = JSON.stringify({
      lotId: lot.lotId,
      selected,
      input,
      version: lot.version,
      shipmentVersion: lot.shipment?.version,
    });
    if (attempt.current.payload !== payload)
      attempt.current = { payload, key: crypto.randomUUID() };
    setPending(true);
    try {
      const response = await submitCommand(
        lot,
        selected,
        input,
        attempt.current.key,
      );
      setResult(response.message);
      attempt.current = { payload: "", key: "" };
      dialog.current?.close();
      onCompleted?.();
    } catch (cause) {
      setError(
        typeof cause === "object" && cause && "message" in cause
          ? String(cause.message)
          : "Chưa gửi được thao tác. Vui lòng thử lại.",
      );
    } finally {
      busy.current = false;
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
                ["rejectRetail", "reportDamage", "recall", "expire"].includes(
                  command,
                )
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
        aria-labelledby={`${fieldId}-title`}
        onCancel={(event) => {
          if (pending) event.preventDefault();
        }}
      >
        <form onSubmit={runCommand}>
          <div className="panel-title">
            <h2 id={`${fieldId}-title`}>
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
                <label htmlFor={`${fieldId}-transporter`}>Đơn vị vận chuyển</label>
                <select
                  id={`${fieldId}-transporter`}
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
                <label htmlFor={`${fieldId}-retailer`}>Điểm bán nhận hàng</label>
                <select
                  id={`${fieldId}-retailer`}
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
                <label htmlFor={`${fieldId}-origin`}>Điểm đi</label>
                <input
                  id={`${fieldId}-origin`}
                  className="input"
                  required
                  value={input.origin ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, origin: event.target.value })
                  }
                />
              </div>
              <div className="field">
                <label htmlFor={`${fieldId}-destination`}>Điểm đến</label>
                <input
                  id={`${fieldId}-destination`}
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
                <label htmlFor={`${fieldId}-quantity`}>Số lượng hư hỏng ({lot.unit})</label>
                <input
                  id={`${fieldId}-quantity`}
                  className="input"
                  type="number"
                  min="0.001"
                  max={lot.availableQuantity}
                  step="0.001"
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
                <label htmlFor={`${fieldId}-received`}>Số lượng nhận ({lot.unit})</label>
                <input
                  id={`${fieldId}-received`}
                  className="input"
                  type="number"
                  min="0.001"
                  step="0.001"
                  max={lot.availableQuantity}
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
                <label htmlFor={`${fieldId}-damaged`}>Số lượng hư hỏng ({lot.unit})</label>
                <input
                  id={`${fieldId}-damaged`}
                  className="input"
                  type="number"
                  min="0"
                  step="0.001"
                  max={lot.availableQuantity}
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
                <label htmlFor={`${fieldId}-note`}>Ghi chú</label>
                <input
                  id={`${fieldId}-note`}
                  className="input"
                  value={input.note ?? ""}
                  onChange={(event) =>
                    setInput({ ...input, note: event.target.value })
                  }
                />
              </div>
            </div>
          )}
          {(selected === "rejectRetail" ||
            selected === "recall" ||
            selected === "expire") && (
            <ReasonField
              value={input.reason}
              onChange={(reason) => setInput({ ...input, reason })}
            />
          )}
          {selected === "markSold" && (
            <p className="notice">
              Xác nhận bán toàn bộ {lot.availableQuantity} {lot.unit}. Tồn sau
              thao tác là 0.
            </p>
          )}
          {selected === "recall" && (
            <p className="notice">
              Lô sẽ được ghi nhận thu hồi và dừng các thao tác tiếp theo. Chuyến
              đang mở sẽ kết thúc ở trạng thái thất bại.
            </p>
          )}
          {error && (
            <div className="notice error" role="alert">
              {error}
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
  const fieldId = useId();
  return (
    <div className="field">
      <label htmlFor={fieldId}>Lý do</label>
      <textarea
        id={fieldId}
        className="input"
        required
        maxLength={1000}
        value={value ?? ""}
        onChange={(event) => onChange(event.target.value)}
      />
    </div>
  );
}
