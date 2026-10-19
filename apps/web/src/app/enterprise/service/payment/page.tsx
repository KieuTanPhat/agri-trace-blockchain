"use client";
import Link from "next/link";
import type { components } from "@/lib/generated/api";
import { useWorkspaceCommand, useWorkspaceData } from "@/lib/workspace";
import { ServiceProgress, money } from "@/components/workspace/service-context";
import { PERMISSION_SYNC_EVENT } from "@/lib/permission-sync";
import { CommandState, LoadState, PageHeader } from "@/components/manage";
export default function PaymentPage() {
  const state = useWorkspaceData<components["schemas"]["ServiceWorkspaceView"]>(
      "/enterprise-service",
    ),
    command = useWorkspaceCommand(),
    order = state.data?.order;
  async function pay() {
    if (!order) return;
    if (
      await command.run("/enterprise-service/payment-simulation", {
        version: order.version,
        contractDigest: order.contractDigest,
        method: "LOCAL_DEMO",
      })
    ) {
      state.reload();
      window.dispatchEvent(new Event(PERMISSION_SYNC_EVENT));
    }
  }
  return (
    <div className="manage-console">
      <PageHeader
        actionKind="create"
        backLabel="Quay lại danh sách"
        title="Thanh toán dịch vụ"
        description="Đối chiếu hợp đồng đã xác nhận trước khi hoàn tất."
        back="/enterprise/service"
      />
      <ServiceProgress step={order?.status === "PAID_SIMULATED" ? 3 : 2} />
      <LoadState {...state} />
      <CommandState command={command} />
      {order ? (
        <section className="panel grid">
          <h2>
            {order.status === "PAID_SIMULATED"
              ? "Thanh toán mô phỏng hoàn tất"
              : "Tóm tắt thanh toán"}
          </h2>
          <dl className="review-details">
            <dt>Đơn vị</dt>
            <dd>{order.billingName}</dd>
            <dt>Gói</dt>
            <dd>{order.planCode}</dd>
            <dt>Mô hình peer</dt>
            <dd>
              {order.hostingMode === "SELF_MANAGED_ORG"
                ? "Doanh nghiệp tự quản lý"
                : "AgriTrace quản lý"}
            </dd>
            <dt>Tổng tham khảo</dt>
            <dd>{money(order.amount)}</dd>
          </dl>
          <Link className="text-link" href="/enterprise/service/contract">
            Kiểm tra hợp đồng
          </Link>
          {order.status === "PAID_SIMULATED" ? (
            <>
              {state.data?.stage === "ACTIVE" ||
              state.data?.stage === "ACTIVE_LEGACY" ? (
                <>
                  <p className="notice">
                    Không thu tiền thật. Hợp đồng đã được xếp hàng gửi về email
                    doanh nghiệp; quyền nghiệp vụ đã được kích hoạt. Kết nối
                    blockchain vẫn cần kiểm chứng riêng.
                  </p>
                  <Link className="button" href="/enterprise/connections">
                    {order.hostingMode === "SELF_MANAGED_ORG"
                      ? "Cấu hình peer tự quản lý"
                      : "Yêu cầu kết nối do AgriTrace quản lý"}
                  </Link>
                  <Link className="text-link" href="/enterprise">
                    Mở không gian doanh nghiệp
                  </Link>
                </>
              ) : (
                <p className="notice">
                  Thanh toán mô phỏng đã hoàn tất; không có tiền thật được thu.
                  Hồ sơ đang chờ quản trị viên kích hoạt quyền nghiệp vụ. Các
                  chức năng doanh nghiệp sẽ mở sau khi được kích hoạt.
                </p>
              )}
            </>
          ) : (
            <>
              <p className="notice">
                Chỉ mô phỏng trên local. Tích hợp NAPAS và QR thanh toán sẽ thực
                hiện sau; không có mã QR ngân hàng hoặc thông tin nhận tiền
                thật.
              </p>
              <button
                className="button"
                disabled={
                  !state.data?.catalog.simulationEnabled || command.pending
                }
                onClick={() => void pay()}
              >
                {command.pending
                  ? "Đang xử lý…"
                  : command.frozen
                    ? "Thử lại giao dịch cũ"
                    : "Mô phỏng thanh toán thành công"}
              </button>
              {!state.data?.catalog.simulationEnabled && (
                <p>Thanh toán mô phỏng chưa được bật trong môi trường này.</p>
              )}
            </>
          )}
        </section>
      ) : (
        !state.loading && (
          <p className="panel">
            Chưa có hợp đồng.{" "}
            <Link className="text-link" href="/enterprise/service">
              Chọn dịch vụ
            </Link>
          </p>
        )
      )}
    </div>
  );
}
