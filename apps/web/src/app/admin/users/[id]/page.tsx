"use client";

import { useParams } from "next/navigation";
import type { components } from "@/lib/generated/api";
import { DataForm, type Field } from "@/components/data-form";
import { useAuth } from "@/lib/auth-store";
import { formatDateTime } from "@/lib/platform-governance";
import { useWorkspaceData } from "@/lib/workspace";
import { LoadState, PageHeader, StatusBadge } from "@/components/manage";

type Account = components["schemas"]["UserListDto"];

const reason: Field = {
  name: "reason",
  label: "Lý do (ghi vào nhật ký kiểm toán, tối thiểu 10 ký tự)",
  required: true,
  minLength: 10,
  maxLength: 1000,
};

export default function PlatformUserPage() {
  const { id } = useParams<{ id: string }>();
  const auth = useAuth();
  const state = useWorkspaceData<Account[]>("/users");
  const account = state.data?.find((item) => item.id === id);
  const managed =
    account &&
    ["SYSTEM_ADMIN", "COMPLIANCE_REVIEWER"].includes(account.role.code);
  const self = account?.id === auth.user?.id;
  const locked =
    !!account?.lockedUntil && new Date(account.lockedUntil) > new Date();
  const nextStatus = account?.accountStatus === "ACTIVE" ? "LOCKED" : "ACTIVE";
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title={managed ? account.fullName : "Chi tiết tài khoản"}
        description="Kiểm tra vai trò và trạng thái trước khi thay đổi quyền truy cập. Mỗi thay đổi cần lý do và được ghi vào nhật ký kiểm toán."
        back="/admin/users"
      />
      <LoadState {...state} />
      {!state.loading && !state.error && !managed && (
        <p className="notice error" role="alert">
          Tài khoản này do doanh nghiệp quản lý hoặc không tồn tại.
        </p>
      )}
      {managed && (
        <>
          <section className="manage-section manage-detail-section">
            <h2>Thông tin tài khoản</h2>
            <dl className="manage-detail-list">
              <div>
                <dt>Họ và tên</dt>
                <dd>{account.fullName}</dd>
              </div>
              <div>
                <dt>Email</dt>
                <dd>{account.email}</dd>
              </div>
              <div>
                <dt>Vai trò</dt>
                <dd>
                  {account.role.code === "SYSTEM_ADMIN"
                    ? "Quản trị viên"
                    : "Người kiểm định"}
                </dd>
              </div>
              <div>
                <dt>Tổ chức</dt>
                <dd>{account.organization?.name ?? "AgriTrace"}</dd>
              </div>
              <div>
                <dt>Trạng thái</dt>
                <dd>
                  <StatusBadge value={account.accountStatus} />
                </dd>
              </div>
              <div>
                <dt>Đăng nhập</dt>
                <dd>
                  {locked
                    ? `Đang bị khóa tạm đến ${formatDateTime(account.lockedUntil as string)}`
                    : account.mustChangePassword
                      ? "Chờ đổi mật khẩu tạm"
                      : "Bình thường"}
                </dd>
              </div>
            </dl>
          </section>
          {self ? (
            <p className="notice" role="status">
              Đây là tài khoản của bạn. Quản trị viên không thể tự khóa; đổi mật
              khẩu và MFA tại mục Bảo mật tài khoản.
            </p>
          ) : (
            <>
              <section className="manage-section manage-detail-section">
                <h2>
                  {nextStatus === "LOCKED"
                    ? "Khóa tài khoản"
                    : "Kích hoạt tài khoản"}
                </h2>
                <p className="manage-section-help">
                  {nextStatus === "LOCKED"
                    ? "Mọi phiên đăng nhập của tài khoản bị thu hồi ngay."
                    : "Tài khoản có thể đăng nhập lại bằng quyền hiện có và được xóa khóa tạm thời."}
                </p>
                <DataForm
                  key={`status-${account.version}`}
                  title={
                    nextStatus === "LOCKED"
                      ? "Xác nhận khóa tài khoản"
                      : "Xác nhận kích hoạt"
                  }
                  method="PATCH"
                  path={`/users/${account.id}/status`}
                  extra={{
                    accountStatus: nextStatus,
                    version: account.version,
                  }}
                  fields={[reason]}
                  onSaved={() => state.reload()}
                />
              </section>
              {locked && (
                <section className="manage-section manage-detail-section">
                  <h2>Mở khóa đăng nhập tạm thời</h2>
                  <p className="manage-section-help">
                    Tài khoản bị khóa tự động do đăng nhập sai nhiều lần.
                  </p>
                  <DataForm
                    key={`unlock-${account.version}`}
                    title="Mở khóa đăng nhập"
                    path={`/users/${account.id}/unlock`}
                    extra={{ version: account.version }}
                    fields={[reason]}
                    onSaved={() => state.reload()}
                  />
                </section>
              )}
              <section className="manage-section manage-detail-section">
                <h2>Buộc đăng xuất mọi phiên</h2>
                <p className="manage-section-help">
                  Thu hồi toàn bộ phiên đăng nhập mà không khóa tài khoản.
                </p>
                <DataForm
                  title="Thu hồi mọi phiên"
                  path={`/users/${account.id}/revoke-sessions`}
                  fields={[reason]}
                  onSaved={() => state.reload()}
                />
              </section>
              <section className="manage-section manage-detail-section">
                <h2>Đặt lại mật khẩu</h2>
                <p className="manage-section-help">
                  Đặt mật khẩu tạm; người dùng buộc đổi ở lần đăng nhập đầu và
                  mọi phiên cũ bị thu hồi. Hãy gửi mật khẩu qua kênh an toàn
                  khác, không ghi vào hệ thống.
                </p>
                <DataForm
                  key={`reset-${account.version}`}
                  title="Đặt lại mật khẩu"
                  path={`/users/${account.id}/reset-password`}
                  extra={{ version: account.version }}
                  fields={[
                    {
                      name: "temporaryPassword",
                      label: "Mật khẩu tạm (ít nhất 12 ký tự)",
                      type: "password",
                      required: true,
                    },
                    reason,
                  ]}
                  onSaved={() => state.reload()}
                />
              </section>
            </>
          )}
        </>
      )}
    </div>
  );
}
