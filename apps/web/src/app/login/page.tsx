"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import { BrandLogo } from "@/components/ui/brand-logo";
import { useAuth } from "@/lib/auth-store";
import { canAccessManagementRoute, platformAdminHome } from "@/lib/permissions";

const MFA_REQUIRED_MESSAGE = "Cần mã xác thực hai yếu tố";

export default function LoginPage() {
  const busy = useRef(false);
  const auth = useAuth();
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/dashboard");
  const [nextReady, setNextReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [mfaCode, setMfaCode] = useState("");
  const [needsMfa, setNeedsMfa] = useState(false);
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);
  const ready = nextReady && !auth.isLoading;

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("next");
    setNextPath(
      requested?.startsWith("/") &&
        !requested.startsWith("//") &&
        !requested.includes("\\") &&
        requested !== "/" &&
        !/^\/login(?:[/?#]|$)/.test(requested)
        ? requested
        : "/dashboard",
    );
    setNextReady(true);
  }, []);
  useEffect(() => {
    if (nextReady && !auth.isLoading && auth.isAuthenticated) {
      const role = auth.user?.role.code;
      if (auth.user?.mustChangePassword) {
        // A temporary password only unlocks the page that replaces it.
        router.replace("/account/password");
        return;
      }
      router.replace(
        platformAdminHome(role) &&
          role &&
          (nextPath === "/dashboard" ||
            !canAccessManagementRoute(nextPath, role))
          ? platformAdminHome(role)!
          : nextPath === "/dashboard" && role === "DISTRIBUTOR"
            ? "/enterprise"
            : nextPath,
      );
    }
  }, [
    auth.isAuthenticated,
    auth.isLoading,
    auth.user?.role.code,
    auth.user?.mustChangePassword,
    nextPath,
    nextReady,
    router,
  ]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (!ready || busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      if (needsMfa) await auth.login(email, password, mfaCode.trim());
      else await auth.login(email, password);
    } catch (cause) {
      const message =
        typeof cause === "object" && cause && "message" in cause
          ? String(cause.message)
          : "Không thể đăng nhập.";
      // The API asks for the second factor only after the password was right.
      if (message === MFA_REQUIRED_MESSAGE) {
        setNeedsMfa(true);
        setError(
          "Nhập mã từ ứng dụng xác thực (hoặc mã khôi phục) để tiếp tục.",
        );
      } else setError(message);
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className="login-page">
      <div className="login-story enter">
        <p className="eyebrow">KHÔNG GIAN LÀM VIỆC</p>
        <h2>
          Ghi nhận hôm nay.
          <br />
          Minh bạch cả hành trình.
        </h2>
        <p>
          Quản lý nguồn gốc, theo dõi giao nhận và đối chiếu bằng chứng trong
          cùng một hệ thống.
        </p>
      </div>
      <form
        className="panel login-card enter"
        style={{ "--d": "120ms" } as React.CSSProperties}
        onSubmit={submit}
      >
        <BrandLogo height={52} priority />
        <div>
          <p className="eyebrow">Cổng quản trị</p>
          <h1>Đăng nhập</h1>
          <p className="muted">
            Đăng nhập bằng tài khoản doanh nghiệp hoặc tài khoản được cấp để
            thao tác theo quyền của bạn.
          </p>
        </div>
        <div className="field">
          <label htmlFor="email">Email</label>
          <input
            className="input"
            id="email"
            type="email"
            autoComplete="username"
            required
            disabled={!ready}
            value={email}
            onChange={(event) => setEmail(event.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="password">Mật khẩu</label>
          <input
            className="input"
            id="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={!ready}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {needsMfa && (
          <div className="field">
            <label htmlFor="mfa-code">Mã xác thực hai yếu tố</label>
            <input
              className="input"
              id="mfa-code"
              inputMode="numeric"
              autoComplete="one-time-code"
              required
              minLength={6}
              maxLength={20}
              value={mfaCode}
              onChange={(event) => setMfaCode(event.target.value)}
            />
          </div>
        )}
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="button" type="submit" disabled={!ready || pending}>
          {pending ? (
            <LoaderCircle className="spinner" size={18} />
          ) : (
            <LogIn size={18} />
          )}
          {pending ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
        <Link className="button secondary" href="/scan">
          <ShieldCheck size={18} /> Tra cứu công khai
        </Link>
        <Link className="text-link" href="/register">
          Đăng ký doanh nghiệp mới
        </Link>
      </form>
    </div>
  );
}
