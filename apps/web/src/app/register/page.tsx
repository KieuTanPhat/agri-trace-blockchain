"use client";
import Link from "next/link";
import { useRef, useState, type FormEvent } from "react";
import { BrandLogo } from "@/components/ui/brand-logo";
import {
  hostingLabels,
  onboardingError,
  registerEnterprise,
  type Registration,
} from "@/lib/enterprise-onboarding";

export default function RegisterPage() {
  const original = useRef<Registration | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [complete, setComplete] = useState(false),
    [frozen, setFrozen] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (pending) return;
    const data = new FormData(event.currentTarget);
    if (!original.current)
      original.current = {
        requestId: crypto.randomUUID(),
        email: String(data.get("email")),
        password: String(data.get("password")),
        fullName: String(data.get("fullName")),
        organizationName: String(data.get("organizationName")),
        businessId: String(data.get("businessId")),
        organizationType: String(
          data.get("organizationType"),
        ) as Registration["organizationType"],
        hostingMode: String(
          data.get("hostingMode"),
        ) as Registration["hostingMode"],
      };
    setPending(true);
    setError("");
    setFrozen(true);
    try {
      await registerEnterprise(original.current);
      original.current = null;
      setComplete(true);
    } catch (cause) {
      setError(onboardingError(cause));
      const status = (cause as { status?: number }).status;
      if (status && status >= 400 && status < 500 && status !== 429) {
        original.current = null;
        setFrozen(false);
      }
    } finally {
      setPending(false);
    }
  }
  if (complete)
    return (
      <section className="panel">
        <h1>Đã tiếp nhận đăng ký</h1>
        <p>
          Bạn có thể đăng nhập để theo dõi hồ sơ. AgriTrace sẽ duyệt doanh
          nghiệp trước khi cấp quyền tạo chuỗi và kết nối mạng.
        </p>
        <Link className="button" href="/login?next=/enterprise">
          Đăng nhập và theo dõi hồ sơ
        </Link>
      </section>
    );
  return (
    <div className="login-page">
      <section className="login-story">
        <p className="eyebrow">DÀNH CHO DOANH NGHIỆP</p>
        <h1>Bắt đầu cùng AgriTrace</h1>
        <p>
          Đăng ký tổ chức, chọn cách vận hành peer và theo dõi kết nối của bạn
          trong cùng một nơi.
        </p>
        <p>Với peer tự quản, doanh nghiệp giữ khóa riêng trên VPS của mình.</p>
      </section>
      <form className="panel login-card" onSubmit={submit}>
        <BrandLogo height={48} />
        <h2>Đăng ký doanh nghiệp</h2>
        <fieldset disabled={pending || frozen} className="enterprise-fields">
          <label className="field">
            Tên doanh nghiệp
            <input
              className="input"
              name="organizationName"
              required
              minLength={2}
              maxLength={255}
              autoComplete="organization"
            />
          </label>
          <label className="field">
            Mã số doanh nghiệp / mã số thuế
            <input
              className="input"
              name="businessId"
              required
              pattern="[A-Za-z0-9][A-Za-z0-9-]{4,39}"
              maxLength={40}
            />
          </label>
          <label className="field">
            Hoạt động chính
            <select className="input" name="organizationType">
              <option value="FARM">Sản xuất nông nghiệp</option>
              <option value="TRANSPORTER">Vận chuyển</option>
              <option value="RETAILER">Bán lẻ</option>
            </select>
          </label>
          <label className="field">
            Người đại diện
            <input
              className="input"
              name="fullName"
              required
              maxLength={255}
              autoComplete="name"
            />
          </label>
          <label className="field">
            Email
            <input
              className="input"
              name="email"
              required
              type="email"
              maxLength={255}
              autoComplete="email"
            />
          </label>
          <label className="field">
            Mật khẩu
            <input
              className="input"
              name="password"
              type="password"
              required
              minLength={12}
              autoComplete="new-password"
            />
            <small>Ít nhất 12 ký tự, tối đa 72 byte UTF-8.</small>
          </label>
          <fieldset>
            <legend>Vận hành peer Fabric</legend>
            {Object.entries(hostingLabels).map(([value, label]) => (
              <label className="enterprise-choice" key={value}>
                <input
                  type="radio"
                  name="hostingMode"
                  value={value}
                  defaultChecked={value === "MANAGED_ORG"}
                />
                <span>
                  {label}
                  <small>
                    {value === "MANAGED_ORG"
                      ? "AgriTrace chuẩn bị hạ tầng sau khi duyệt."
                      : "Bạn chuẩn bị VPS; AgriTrace hướng dẫn cấu hình và kiểm chứng kết nối."}
                  </small>
                </span>
              </label>
            ))}
          </fieldset>
        </fieldset>
        {error && (
          <div className="notice error" role="alert">
            {error}
            {frozen && (
              <p>
                Giữ nguyên trang và dùng nút thử lại để đối soát đúng đăng ký
                ban đầu.
              </p>
            )}
          </div>
        )}
        <button className="button" disabled={pending} type="submit">
          {pending
            ? "Đang gửi…"
            : frozen
              ? "Thử lại đăng ký ban đầu"
              : "Gửi đăng ký"}
        </button>
        <Link className="text-link" href="/login?next=/enterprise">
          Đã có tài khoản? Đăng nhập
        </Link>
      </form>
    </div>
  );
}
