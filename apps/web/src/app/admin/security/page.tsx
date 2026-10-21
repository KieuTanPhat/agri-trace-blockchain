"use client";

import Link from "next/link";
import { useState } from "react";
import { DataForm } from "@/components/data-form";
import { request } from "@/lib/api-client";
import { formatDateTime, type MfaStatus } from "@/lib/platform-governance";
import { errorMessage, useWorkspaceData } from "@/lib/workspace";
import { LoadState, PageHeader } from "@/components/manage";

type Enrollment = { secret: string; otpauthUri: string };
const modeLabels: Record<string, string> = {
  OFF: "Tắt theo cấu hình triển khai",
  OPTIONAL: "Tùy chọn (đã bật thì bắt buộc khi đăng nhập)",
  REQUIRED: "Bắt buộc cho quản trị viên",
};

export default function SecurityPage() {
  const state = useWorkspaceData<MfaStatus>("/auth/mfa");
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [recoveryCodes, setRecoveryCodes] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const [password, setPassword] = useState("");
  const status = state.data;

  async function start() {
    setPending(true);
    setError("");
    try {
      setEnrollment(
        await request<Enrollment>("/auth/mfa/enroll", {
          method: "POST",
          body: JSON.stringify({ currentPassword: password }),
        }),
      );
      setPassword("");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title="Bảo mật tài khoản quản trị"
        description="Xác thực hai yếu tố (TOTP) bảo vệ đăng nhập và các thao tác rủi ro cao như phê duyệt hai bước."
        back="/admin"
      />
      <LoadState {...state} />
      {status && (
        <section className="manage-section manage-detail-section">
          <h2>Xác thực hai yếu tố</h2>
          <dl className="manage-detail-list">
            <div>
              <dt>Chính sách triển khai</dt>
              <dd>{modeLabels[status.mode] ?? status.mode}</dd>
            </div>
            <div>
              <dt>Trạng thái</dt>
              <dd>
                {status.status === "ENABLED"
                  ? `Đã bật${status.enabledAt ? ` từ ${formatDateTime(status.enabledAt)}` : ""}`
                  : status.status === "PENDING"
                    ? "Đang chờ xác nhận"
                    : "Chưa bật"}
              </dd>
            </div>
            {status.status === "ENABLED" && (
              <div>
                <dt>Mã khôi phục còn lại</dt>
                <dd>{status.recoveryCodesRemaining}</dd>
              </div>
            )}
          </dl>
          {error && (
            <p className="notice error" role="alert">
              {error}
            </p>
          )}
          {recoveryCodes.length > 0 && (
            <div className="notice" role="status">
              <strong>Lưu ngay các mã khôi phục này.</strong> Mỗi mã chỉ dùng
              một lần và sẽ không hiển thị lại.
              <pre className="manage-json">{recoveryCodes.join("\n")}</pre>
            </div>
          )}
          {status.mode !== "OFF" &&
            status.status !== "ENABLED" &&
            !enrollment && (
              <div className="manage-detail-actions">
                <label className="field">
                  <span>Mật khẩu hiện tại (để xác nhận đăng ký)</span>
                  <input
                    className="input"
                    type="password"
                    autoComplete="current-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                  />
                </label>
                <button
                  className="button"
                  type="button"
                  disabled={pending || !password}
                  onClick={() => void start()}
                >
                  {pending ? "Đang tạo…" : "Bắt đầu đăng ký MFA"}
                </button>
              </div>
            )}
          {enrollment && status.status !== "ENABLED" && (
            <>
              <p className="manage-section-help">
                Thêm khóa vào ứng dụng xác thực (Google Authenticator, Authy,
                1Password…) bằng khóa bên dưới hoặc liên kết otpauth, rồi nhập
                mã 6 số hiện tại để xác nhận.
              </p>
              <pre className="manage-json" aria-label="Khóa thiết lập MFA">
                {enrollment.secret}
              </pre>
              <p className="manage-section-help">
                <a href={enrollment.otpauthUri}>Mở trong ứng dụng xác thực</a>
              </p>
              <DataForm
                title="Xác nhận và bật MFA"
                path="/auth/mfa/verify"
                fields={[
                  {
                    name: "code",
                    label: "Mã 6 số",
                    required: true,
                    minLength: 6,
                    maxLength: 6,
                    pattern: "[0-9]{6}",
                  },
                ]}
                onSaved={(result) => {
                  setRecoveryCodes(
                    (result as { recoveryCodes: string[] }).recoveryCodes,
                  );
                  setEnrollment(null);
                  state.reload();
                }}
              />
            </>
          )}
          {status.status === "ENABLED" && status.mode !== "REQUIRED" && (
            <DataForm
              title="Tắt MFA"
              path="/auth/mfa/disable"
              fields={[
                {
                  name: "code",
                  label: "Mã 6 số hiện tại hoặc mã khôi phục",
                  required: true,
                  minLength: 6,
                  maxLength: 20,
                },
              ]}
              onSaved={() => {
                setRecoveryCodes([]);
                state.reload();
              }}
            />
          )}
          {status.status === "ENABLED" && (
            <DataForm
              title="Cấp lại mã khôi phục"
              path="/auth/mfa/recovery-codes"
              fields={[
                {
                  name: "code",
                  label: "Mã 6 số hiện tại hoặc mã khôi phục chưa dùng",
                  required: true,
                  minLength: 6,
                  maxLength: 20,
                },
              ]}
              onSaved={(result) => {
                setRecoveryCodes(
                  (result as { recoveryCodes: string[] }).recoveryCodes,
                );
                state.reload();
              }}
            />
          )}
        </section>
      )}
      <section className="manage-section manage-detail-section">
        <h2>Mật khẩu</h2>
        <p className="manage-section-help">
          Đổi mật khẩu sẽ đăng xuất mọi thiết bị khác của bạn.
        </p>
        <Link className="button secondary" href="/account/password">
          Đổi mật khẩu
        </Link>
      </section>
    </div>
  );
}
