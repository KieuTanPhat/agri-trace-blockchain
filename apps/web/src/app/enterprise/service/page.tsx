"use client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import Link from "next/link";
import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { request } from "@/lib/api-client";
import { useWorkspaceData, errorMessage } from "@/lib/workspace";
import type { components } from "@/lib/generated/api";
import {
  money,
  ServiceProgress,
  useServiceDraft,
} from "@/components/workspace/service-context";
import { LoadState, PageHeader } from "@/components/manage";
type S = components["schemas"];
export default function ServicePage() {
  const state = useWorkspaceData<S["ServiceWorkspaceView"]>(
    "/enterprise-service",
  );
  const enrollment = useWorkspaceData<S["EnterpriseEnrollmentViewDto"]>(
    "/enterprise-enrollments/mine",
  );
  const router = useRouter(),
    { setDraft } = useServiceDraft();
  const [pending, setPending] = useState(false),
    [error, setError] = useState("");
  async function preview(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending || !state.data) return;
    const form = new FormData(e.currentTarget);
    const input: S["ServiceQuoteInput"] = {
      planCode: String(
        form.get("planCode"),
      ) as S["ServiceQuoteInput"]["planCode"],
      hostingMode: String(
        form.get("hostingMode"),
      ) as S["ServiceQuoteInput"]["hostingMode"],
      billingName: String(form.get("billingName")).trim(),
      billingEmail: String(form.get("billingEmail")).trim().toLowerCase(),
      billingAddress: String(form.get("billingAddress")).trim(),
      catalogVersion: state.data.catalog.version,
    };
    setPending(true);
    setError("");
    try {
      const result = await request<S["ServicePreviewView"]>(
        "/enterprise-service/preview",
        {
          method: "POST",
          headers: { "idempotency-key": crypto.randomUUID() },
          body: JSON.stringify(input),
        },
      );
      setDraft({ input, preview: result });
      router.push("/enterprise/service/contract");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      setPending(false);
    }
  }
  const data = state.data,
    details = enrollment.data?.details as Record<string, unknown> | undefined;
  if (data?.stage === 'AWAITING_ACTIVATION' || data?.stage === 'ACTIVE' || data?.stage === 'ACTIVE_LEGACY') return <div className="manage-console"><PageHeader actionKind="create" back="/enterprise" backLabel="Doanh nghiệp" title="Dịch vụ AgriTrace" description="Quyền sử dụng được admin kích hoạt sau khi hồ sơ đã duyệt; trạng thái peer được kiểm chứng riêng." /><LoadState {...state}/><section className="panel"><h2>{data.stage === 'AWAITING_ACTIVATION' ? 'Chờ admin kích hoạt' : 'Dịch vụ đang hoạt động'}</h2><p>{enrollment.data?.serviceActivationReason ?? 'Hồ sơ đã duyệt. Admin kiểm tra điều kiện sử dụng và ghi căn cứ trước khi cấp quyền.'}</p>{data.stage !== 'AWAITING_ACTIVATION' && <Link href="/enterprise" className="button">Vào không gian doanh nghiệp</Link>}</section>{data.order && <section className="panel"><h2>Hợp đồng mô phỏng đã lưu</h2><p>Giữ nguyên lịch sử bản mô phỏng; trạng thái này không chứng minh thanh toán thật và không tự cấp quyền sử dụng.</p><Link className="text-link" href="/enterprise/service/contract">Xem bản đã lưu →</Link></section>}</div>;
  return (
    <div className="manage-console">
      <PageHeader actionKind="create" back="/enterprise" backLabel="Doanh nghiệp"
        title="Dịch vụ & hợp đồng"
        description="Chọn mô hình peer và gói tham khảo sau khi hồ sơ được duyệt."
      />
      <ServiceProgress
        step={
          data?.order ? (data.order.status === "PAID_SIMULATED" ? 3 : 2) : 0
        }
      />
      <LoadState {...state} />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {data && ["PENDING_REVIEW", "REJECTED"].includes(data.stage) && (
        <section className="panel">
          <h2>
            {data.stage === "PENDING_REVIEW"
              ? "Hồ sơ đang chờ admin xét duyệt"
              : "Hồ sơ chưa được phê duyệt"}
          </h2>
          <p>
            Chỉ hồ sơ được duyệt mới được chọn dịch vụ. Kết quả gửi về email
            doanh nghiệp.
          </p>
          <Link className="button secondary" href="/enterprise/onboarding">
            Xem hồ sơ
          </Link>
        </section>
      )}
      {data?.stage === "ACTIVE_LEGACY" && !data.order && (
        <section className="panel">
          <h2>Doanh nghiệp đã được kích hoạt</h2>
          <p>
            Hồ sơ này được cấp quyền trước khi bổ sung luồng dịch vụ. Lịch sử
            được giữ nguyên.
          </p>
          <Link className="button secondary" href="/enterprise/connections">
            Xem kết nối
          </Link>
        </section>
      )}
      {data?.order && (
        <section className="panel grid">
          <h2>
            {data.order.status === "PAID_SIMULATED"
              ? "Đã hoàn tất thanh toán mô phỏng"
              : "Hợp đồng chờ thanh toán"}
          </h2>
          <p>
            {data.order.planCode} · {money(data.order.amount)} ·{" "}
            {data.order.hostingMode === "SELF_MANAGED_ORG"
              ? "Tự quản lý peer"
              : "AgriTrace quản lý peer"}
          </p>
          <div className="workspace-actions">
            <Link
              className="button secondary"
              href="/enterprise/service/contract"
            >
              Xem hợp đồng
            </Link>
            <Link
              className="button"
              href={
                data.order.status === "PAID_SIMULATED"
                  ? "/enterprise/connections"
                  : "/enterprise/service/payment"
              }
            >
              {data.order.status === "PAID_SIMULATED"
                ? "Thiết lập kết nối"
                : "Đến thanh toán"}
            </Link>
          </div>
        </section>
      )}
      {data?.stage === "SELECT_SERVICE" && !data.order && (
        <form className="grid" onSubmit={preview}>
          <fieldset disabled={pending} className="enterprise-fields">
            <section className="panel grid">
              <h2>1. Mô hình quản lý peer</h2>
              <label className="field">
                Mô hình vận hành
                <NativeSelect
                  className="input"
                  name="hostingMode"
                  required
                  defaultValue="MANAGED_ORG"
                >
                  <option value="MANAGED_ORG">AgriTrace quản lý peer</option>
                  <option value="SELF_MANAGED_ORG">
                    Doanh nghiệp tự quản lý peer
                  </option>
                </NativeSelect>
              </label>
              <p className="muted">
                Chi phí máy chủ và vận hành peer cần báo giá riêng. Chỉ cấu hình
                peer tự quản lý sau khi hoàn tất hợp đồng và thanh toán; kết nối
                vẫn cần kiểm chứng kỹ thuật.
              </p>
            </section>
            <section className="panel grid">
              <h2>2. Gói truy xuất tham khảo · 12 tháng</h2>
              <p className="muted">{data.catalog.disclaimer}</p>
              <div className="service-plans">
                {data.catalog.plans.map((plan, i) => (
                  <label className="service-plan" key={plan.code}>
                    <span>
                      <Input
                        type="radio"
                        name="planCode"
                        value={plan.code}
                        required
                        defaultChecked={i === 0}
                      />{" "}
                      {plan.name}
                    </span>
                    <strong className="service-price">
                      {money(plan.setup + plan.annual)}
                    </strong>
                    <span>Khởi tạo: {money(plan.setup)}</span>
                    <span>Duy trì / năm: {money(plan.annual)}</span>
                    <small>Chưa gồm thuế, phí QR và hạ tầng peer.</small>
                  </label>
                ))}
              </div>
              <a
                className="text-link"
                href={data.catalog.sourceUrl}
                target="_blank"
                rel="noreferrer"
              >
                Nguồn giá iCheck ngày 07/08/2026 · đối chiếu 17/10/2026
              </a>
              <details>
                <summary>Phí QR tham khảo theo sản lượng</summary>
                <p>
                  10.000–49.999 mã: 300đ/mã; 50.000–199.999: 200đ/mã;
                  200.000–999.999: 150đ/mã; từ 1.000.000: 90đ/mã. Báo giá riêng,
                  chưa cộng vào tổng gói.
                </p>
              </details>
            </section>
            <section className="panel grid">
              <h2>3. Thông tin thanh toán</h2>
              <p className="muted">
                Dùng thông tin doanh nghiệp. Không nhập số thẻ hoặc tài khoản
                ngân hàng.
              </p>
              <label className="field">
                Tên đơn vị thanh toán
                <Input
                  className="input"
                  name="billingName"
                  required
                  minLength={2}
                  maxLength={255}
                  defaultValue={enrollment.data?.organizationName ?? ""}
                />
              </label>
              <label className="field">
                Email thanh toán
                <Input
                  className="input"
                  name="billingEmail"
                  type="email"
                  required
                  maxLength={255}
                  defaultValue={String(
                    details?.contactEmail ??
                      enrollment.data?.representativeEmail ??
                      "",
                  )}
                />
              </label>
              <label className="field">
                Địa chỉ thanh toán
                <Textarea
                  className="input"
                  name="billingAddress"
                  required
                  minLength={5}
                  maxLength={500}
                  defaultValue={[
                    details?.address,
                    details?.ward,
                    details?.province,
                  ]
                    .filter(Boolean)
                    .join(", ")}
                />
              </label>
              <Button className="button" disabled={pending}>
                {pending ? "Đang chuẩn bị…" : "Xem trước hợp đồng"}
              </Button>
            </section>
          </fieldset>
        </form>
      )}
      {!!data?.emails.length && (
        <section className="panel">
          <h2>Email doanh nghiệp</h2>
          {data.emails.map((email, i) => (
            <p key={i}>
              {String(email.kind) === "CONTRACT"
                ? "Hợp đồng điện tử"
                : "Kết quả xét duyệt"}{" "}
              · {String(email.recipient)} ·{" "}
              {email.status === "SENT"
                ? "Đã gửi vào hộp thư local"
                : "Đang chờ Worker gửi"}
            </p>
          ))}
        </section>
      )}
    </div>
  );
}
