"use client";

import { useRouter } from "next/navigation";
import { FormEvent, useRef, useState } from "react";
import { request } from "@/lib/api-client";
import { useAuth } from "@/lib/auth-store";
import { errorMessage } from "@/lib/workspace";

export default function ChangePasswordPage() {
  const router = useRouter();
  const auth = useAuth();
  const busy = useRef(false);
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [again, setAgain] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const forced = Boolean(auth.user?.mustChangePassword);
  const mismatch = again !== "" && next !== again;

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current || mismatch) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await request("/auth/change-password", {
        method: "POST",
        body: JSON.stringify({ currentPassword: current, newPassword: next }),
      });
      // Other sessions are revoked server-side; sign in again with the new one.
      await auth.logout();
      router.replace("/login");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="manage-console manage-console--form">
      <header className="manage-page-header">
        <div>
          <h1>Đổi mật khẩu</h1>
          <p className="manage-description">
            {forced
              ? "Bạn đang dùng mật khẩu tạm do quản trị viên đặt. Hãy đặt mật khẩu mới để tiếp tục."
              : "Mật khẩu mới ít nhất 12 ký tự và phải khác mật khẩu hiện tại. Mọi thiết bị khác sẽ bị đăng xuất."}
          </p>
        </div>
      </header>
      <form className="panel" onSubmit={submit}>
        <fieldset disabled={pending} className="management-fields">
          <div className="form-grid">
            <label className="field">
              <span>Mật khẩu hiện tại *</span>
              <input
                className="input"
                type="password"
                autoComplete="current-password"
                required
                value={current}
                onChange={(event) => setCurrent(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Mật khẩu mới (ít nhất 12 ký tự) *</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={next}
                onChange={(event) => setNext(event.target.value)}
              />
            </label>
            <label className="field">
              <span>Nhập lại mật khẩu mới *</span>
              <input
                className="input"
                type="password"
                autoComplete="new-password"
                required
                minLength={12}
                value={again}
                onChange={(event) => setAgain(event.target.value)}
              />
            </label>
          </div>
        </fieldset>
        {mismatch && (
          <p className="notice error" role="alert">
            Hai mật khẩu mới chưa khớp.
          </p>
        )}
        {error && (
          <p className="notice error" role="alert">
            {error}
          </p>
        )}
        <button className="button" disabled={pending || mismatch}>
          {pending ? "Đang lưu…" : "Đổi mật khẩu"}
        </button>
      </form>
    </div>
  );
}
