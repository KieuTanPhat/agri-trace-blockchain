"use client";
import { authStyles } from "@/styles";
import { withFeatureClasses } from "@/shared/utils/feature-classes";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { FormEvent, useEffect, useRef, useState } from "react";
import { LoaderCircle, LogIn, ShieldCheck } from "lucide-react";
import { useAuth } from "@/features/auth/auth-store";

export default function LoginPage() {
  const busy = useRef(false);
  const auth = useAuth();
  const router = useRouter();
  const [nextPath, setNextPath] = useState("/");
  const [nextReady, setNextReady] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [pending, setPending] = useState(false);

  useEffect(() => {
    const requested = new URLSearchParams(window.location.search).get("next");
    setNextPath(
      requested?.startsWith("/") &&
        !requested.startsWith("//") &&
        !requested.includes("\\")
        ? requested
        : "/",
    );
    setNextReady(true);
  }, []);
  useEffect(() => {
    if (nextReady && !auth.isLoading && auth.isAuthenticated)
      router.replace(nextPath);
  }, [auth.isAuthenticated, auth.isLoading, nextPath, nextReady, router]);

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (busy.current) return;
    busy.current = true;
    setPending(true);
    setError("");
    try {
      await auth.login(email, password);
      router.replace(nextPath);
    } catch (cause) {
      setError(
        typeof cause === "object" && cause && "message" in cause
          ? String(cause.message)
          : "Không thể đăng nhập.",
      );
    } finally {
      busy.current = false;
      setPending(false);
    }
  }

  return (
    <div className={withFeatureClasses("login-page", authStyles)}>
      <form
        className={withFeatureClasses("panel login-card", authStyles)}
        onSubmit={submit}
      >
        <Image
          src="/assets/brand/agritrace-logo.svg"
          alt="AgriTrace"
          width={260}
          height={72}
          priority
        />
        <div>
          <p className="eyebrow">Cổng quản trị</p>
          <h1>Đăng nhập</h1>
          <p className="muted">
            Dùng tài khoản được quản trị viên cấp để thao tác theo đúng vai trò
            và tổ chức.
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
            value={password}
            onChange={(event) => setPassword(event.target.value)}
          />
        </div>
        {error && (
          <div className="notice error" role="alert">
            {error}
          </div>
        )}
        <button className="button" type="submit" disabled={pending}>
          {pending ? (
            <LoaderCircle className="spinner" size={18} />
          ) : (
            <LogIn size={18} />
          )}
          {pending ? "Đang đăng nhập..." : "Đăng nhập"}
        </button>
        <a className="button secondary" href="/scan">
          <ShieldCheck size={18} /> Tra cứu công khai
        </a>
      </form>
    </div>
  );
}
