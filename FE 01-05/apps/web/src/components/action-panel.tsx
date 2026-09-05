"use client";

import { useRef, useState } from "react";
import { ArrowRight, ClipboardCheck, LoaderCircle, X } from "lucide-react";
import { submitCommand } from "@/lib/api-client";
import type { AllowedCommand } from "@/lib/types";
import { IconZap } from "./icons";
import { ErrorState } from "./error-state";

const labels: Record<AllowedCommand, string> = {
  createBatch: "Tạo lô",
  recordPlanting: "Ghi gieo trồng",
  recordCare: "Ghi chăm sóc",
  recordHarvest: "Ghi thu hoạch",
  createShipment: "Tạo chuyến vận chuyển",
  reportDamage: "Báo hỏng",
  startTransport: "Bắt đầu vận chuyển",
  completeTransport: "Hoàn tất vận chuyển",
  receiveRetail: "Nhận lô",
  rejectRetail: "Từ chối lô",
  markForSale: "Đưa lên kệ"
};

export function ActionPanel({ allowedCommands, batchId }: { allowedCommands: AllowedCommand[]; batchId: string }) {
  const [pending, setPending] = useState<AllowedCommand | null>(null);
  const [selected, setSelected] = useState<AllowedCommand | null>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<string>("");

  async function runCommand(command: AllowedCommand) {
    setPending(command);
    try {
      const response = await submitCommand(batchId, command);
      setResult(response.message);
      dialog.current?.close();
    } catch {
      setResult("Chưa gửi được thao tác. Vui lòng thử lại.");
      dialog.current?.close();
    } finally {
      setPending(null);
    }
  }

  return (
    <aside className="panel">
      <div className="panel-title">
        <div className="panel-title-left">
          <span className="panel-icon accent"><IconZap size={18} /></span>
          <div>
            <p className="eyebrow">Cổng thao tác</p>
            <h2>Thao tác khả dụng</h2>
          </div>
        </div>
      </div>
      {allowedCommands.length === 0 ? (
        <ErrorState status={403} title="Không có thao tác phù hợp" message="Người dùng hoặc trạng thái hiện tại chưa được máy chủ cho phép thực hiện thao tác nào." />
      ) : (
        <div className="actions">
          {allowedCommands.map((command) => (
            <button
              className={command.includes("reject") || command.includes("Damage") ? "button danger" : "button"}
              disabled={pending !== null}
              key={command}
              onClick={() => { setSelected(command); dialog.current?.showModal(); }}
            >
              <ClipboardCheck size={18} />
              {pending === command ? "Đang gửi..." : labels[command]}
              <ArrowRight size={16} />
            </button>
          ))}
        </div>
      )}
      <div role="status" aria-live="polite">{result && <div className="notice">{result}</div>}</div>
      <dialog className="command-dialog" ref={dialog} aria-labelledby="command-title" onCancel={(event) => { if (pending) event.preventDefault(); }}>
        <form onSubmit={(event) => { event.preventDefault(); if (selected && !pending) void runCommand(selected); }}>
          <div className="panel-title">
            <h2 id="command-title">{selected ? labels[selected] : "Xác nhận thao tác"}</h2>
            <button className="icon-button" type="button" title="Đóng" aria-label="Đóng" disabled={pending !== null} onClick={() => dialog.current?.close()}><X size={18} /></button>
          </div>
          <p className="muted">Kiểm tra lô nông sản trước khi gửi yêu cầu.</p>
          <dl className="dialog-summary"><dt>Mã lô</dt><dd>{batchId}</dd><dt>Thao tác</dt><dd>{selected && labels[selected]}</dd></dl>
          <div className="dialog-actions">
            <button className="button secondary" type="button" disabled={pending !== null} onClick={() => dialog.current?.close()}>Hủy</button>
            <button className="button" type="submit" disabled={pending !== null}>{pending ? <LoaderCircle size={18} className="spinner" /> : <ClipboardCheck size={18} />}{pending ? "Đang gửi..." : "Xác nhận"}</button>
          </div>
        </form>
      </dialog>
    </aside>
  );
}
