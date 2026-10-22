"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { components } from "@/lib/generated/api";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import {
  useServiceDraft,
  ServiceProgress,
  money,
} from "@/components/workspace/service-context";
import { CommandState, LoadState, PageHeader } from "@/components/manage";
export default function ContractPage() {
  const state = useWorkspaceData<components["schemas"]["ServiceWorkspaceView"]>(
      "/enterprise-service",
    ),
    { draft, setDraft } = useServiceDraft(),
    command = useWorkspaceCommand(),
    router = useRouter(),
    [accepted, setAccepted] = useState(false);
  const order = state.data?.order,
    preview = order ?? draft?.preview;
  async function confirm() {
    if (!draft || !accepted) return;
    if (
      await command.run("/enterprise-service/orders", {
        ...draft.input,
        accepted: true,
        contractDigest: draft.preview.contractDigest,
      })
    ) {
      setDraft(null);
      router.push("/enterprise/service/payment");
    }
  }
  function download() {
    if (!preview) return;
    const html =
      '<!doctype html><html lang="vi"><meta charset="utf-8"><title>Hợp đồng AgriTrace — mô phỏng</title><body><pre style="white-space:pre-wrap;font:16px/1.8 sans-serif">' +
      preview.contractText
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;") +
      "</pre></body></html>";
    const url = URL.createObjectURL(
      new Blob([html], { type: "text/html;charset=utf-8" }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = "hop-dong-agritrace-mo-phong.html";
    link.click();
    URL.revokeObjectURL(url);
  }
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title="Hợp đồng điện tử"
        description="Xem kỹ nội dung, mô hình peer và số tiền trước khi xác nhận."
        back="/enterprise/service"
      />
      <ServiceProgress step={1} />
      <LoadState {...state} />
      <CommandState command={command} />
      {preview ? (
        <>
          <section className="panel grid">
            <p className="notice">
              Bản mô phỏng local. Xác nhận này chưa phải chữ ký số có chứng thư;
              chưa thu tiền thật.
            </p>
            <strong>
              Tổng gói tham khảo:{" "}
              {money(
                order?.amount ?? Number(draft?.preview.quotation.total ?? 0),
              )}
            </strong>
            <pre className="service-contract">{preview.contractText}</pre>
            <p className="muted">
              Mã đối chiếu:{" "}
              <code style={{ overflowWrap: "anywhere" }}>
                {preview.contractDigest}
              </code>
            </p>
            <div className="workspace-actions">
              <Button className="button secondary" onClick={download}>
                Tải bản hợp đồng
              </Button>
              <Button
                className="button secondary"
                onClick={() => window.print()}
              >
                In / lưu PDF
              </Button>
            </div>
          </section>
          {!order && (
            <section className="panel grid">
              <label className="permission-choice">
                <Input
                  type="checkbox"
                  checked={accepted}
                  disabled={command.frozen}
                  onChange={(e) => setAccepted(e.target.checked)}
                />
                <span>
                  Tôi đã đọc và đồng ý dùng hợp đồng thử nghiệm với thông tin
                  trên.
                </span>
              </label>
              <Button
                className="button"
                disabled={!accepted || command.pending}
                onClick={() => void confirm()}
              >
                {command.frozen
                  ? "Thử lại xác nhận cũ"
                  : "Xác nhận và đến thanh toán"}
              </Button>
              {!command.frozen && (
                <Link className="text-link" href="/enterprise/service">
                  Chỉnh thông tin trước khi xác nhận
                </Link>
              )}
            </section>
          )}
          {order && (
            <Link
              className="button"
              href={
                order.status === "PAID_SIMULATED"
                  ? "/enterprise/connections"
                  : "/enterprise/service/payment"
              }
            >
              {order.status === "PAID_SIMULATED"
                ? "Tiếp tục thiết lập kết nối"
                : "Đến thanh toán"}
            </Link>
          )}
        </>
      ) : (
        !state.loading && (
          <section className="panel">
            <p>
              Chọn dịch vụ và thông tin thanh toán để tạo bản xem trước. Nội
              dung chưa xác nhận chỉ được giữ trong phiên trang hiện tại.
            </p>
            <Link className="button" href="/enterprise/service">
              Chọn dịch vụ
            </Link>
          </section>
        )
      )}
    </div>
  );
}
