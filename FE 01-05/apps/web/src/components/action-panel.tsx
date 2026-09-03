"use client";

import { useState } from "react";
import { submitCommand } from "@/lib/api-client";
import type { AllowedCommand } from "@/lib/types";
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
  const [result, setResult] = useState<string>("Các thao tác bên dưới được lấy trực tiếp từ danh sách quyền thao tác do API mô phỏng trả về.");

  async function runCommand(command: AllowedCommand) {
    setPending(command);
    const response = await submitCommand(batchId, command);
    setResult(response.message);
    setPending(null);
  }

  return (
    <aside className="panel">
      <div className="panel-title">
        <div>
          <p className="eyebrow">Cổng thao tác</p>
          <h2>Thao tác khả dụng</h2>
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
              onClick={() => runCommand(command)}
            >
              {pending === command ? "Đang gửi..." : labels[command]}
            </button>
          ))}
        </div>
      )}
      <div className="notice">
        <strong>Phản hồi:</strong> {result}
      </div>
    </aside>
  );
}
