"use client";

import { CapabilityReview } from "./capability-review";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "@/lib/auth-store";
import { EnterpriseProductsPanel } from "./enterprise-products-panel";
import { RegistrationProfileDetails } from "./registration-profile-details";
import { DataForm } from '@/components/data-form';
import { request } from "@/lib/api-client";
import {
  hostingLabels,
  onboardingError,
  reviewEnterprise,
  statusLabels,
  type Enrollment,
} from "@/lib/enterprise-onboarding";

import { EmptyState, PageHeader, ReloadButton, StatusBadge } from "@/components/manage";

type Decision = "APPROVE" | "REJECT";
type ReviewKind = "enterprise-enrollments" | "enterprise-connections";

export function ReviewDecision({
  kind,
  id,
  version,
  onDone,
}: {
  kind: ReviewKind;
  id: string;
  version: number;
  onDone: () => Promise<void>;
}) {
  const [note, setNote] = useState("");
  const [choice, setChoice] = useState<Decision | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  const original = useRef<{
    key: string;
    input: { version: number; note: string; decision: Decision };
  } | null>(null);

  async function send(decision: Decision) {
    if (pending || (!original.current && !note.trim())) return;
    original.current ??= {
      key: crypto.randomUUID(),
      input: { version, note: note.trim(), decision },
    };
    setPending(true);
    setError("");
    try {
      await reviewEnterprise(
        kind,
        id,
        original.current.input,
        original.current.key,
      );
      original.current = null;
      setChoice(null);
      await onDone();
    } catch (cause) {
      setError(onboardingError(cause));
      if ((cause as { canRestart?: boolean }).canRestart) {
        original.current = null;
        setChoice(null);
        await onDone();
      }
    } finally {
      setPending(false);
    }
  }
  return (
    <div className="manage-review-form">
      <label className="field">
        Ghi chú xét duyệt
        <textarea
          className="input"
          value={note}
          onChange={(event) => setNote(event.target.value)}
          maxLength={1000}
          disabled={pending || !!original.current}
          placeholder="Ghi căn cứ phê duyệt hoặc lý do từ chối"
          required
        />
      </label>
      {error && (
        <p className="notice error" role="alert">
          {error} Giữ nguyên yêu cầu để đối soát.
        </p>
      )}
      {original.current ? (
        <button
          className="button"
          type="button"
          disabled={pending}
          onClick={() => void send(original.current!.input.decision)}
        >
          {pending ? "Đang đối soát…" : "Thử lại quyết định ban đầu"}
        </button>
      ) : choice ? (
        <div
          className="manage-confirmation"
          role="group"
          aria-label="Xác nhận quyết định"
        >
          <strong>
            {choice === "APPROVE" ? "Xác nhận phê duyệt?" : "Xác nhận từ chối?"}
          </strong>
          <p>
            {choice === "APPROVE"
              ? "Doanh nghiệp sẽ nhận email hướng dẫn chọn dịch vụ. Quyền nghiệp vụ chỉ được kích hoạt sau bước thanh toán mô phỏng."
              : "Hồ sơ sẽ được trả lại kèm ghi chú của bạn."}
          </p>
          <div className="manage-confirmation-actions">
            <button
              className="button"
              type="button"
              disabled={pending || !note.trim()}
              onClick={() => void send(choice)}
            >
              {pending
                ? "Đang xử lý…"
                : choice === "APPROVE"
                  ? "Xác nhận phê duyệt"
                  : "Xác nhận từ chối"}
            </button>
            <button
              className="button secondary"
              type="button"
              disabled={pending}
              onClick={() => setChoice(null)}
            >
              Hủy
            </button>
          </div>
        </div>
      ) : (
        <div className="manage-review-actions">
          <button
            className="button"
            type="button"
            disabled={pending || !note.trim()}
            onClick={() => setChoice("APPROVE")}
          >
            Phê duyệt
          </button>
          <button
            className="button secondary"
            type="button"
            disabled={pending || !note.trim()}
            onClick={() => setChoice("REJECT")}
          >
            Từ chối
          </button>
        </div>
      )}
    </div>
  );
}

const detailLabels: Record<string, string> = {
  legalForm: "Loại hình pháp lý",
  address: "Địa chỉ chi tiết",
  province: "Tỉnh / thành phố",
  ward: "Xã / phường",
  phone: "Số điện thoại",
  contactEmail: "Email doanh nghiệp",
  representative: "Người đại diện",
  activities: "Hoạt động đăng ký",
  description: "Giới thiệu",
};
const activityLabels: Record<string, string> = {
  FARM: "Nhà sản xuất/HTX",
  PROCESSOR: "Chế biến",
  TRANSPORTER: "Vận chuyển",
  DISTRIBUTOR: "Phân phối",
  RETAILER: "Bán lẻ",
};

function detailText(key: string, value: unknown) {
  if (Array.isArray(value))
    return value
      .map((entry) => activityLabels[String(entry)] ?? String(entry))
      .join(", ");
  if (key === "legalForm") {
    const legalForms: Record<string, string> = {
      COOPERATIVE: "Hợp tác xã",
      ENTERPRISE: "Doanh nghiệp",
      HOUSEHOLD_BUSINESS: "Hộ kinh doanh",
      PRODUCER_HOUSEHOLD: "Hộ nông dân sản xuất",
      INDIVIDUAL_PRODUCER: "Cá nhân sản xuất",
    };
    return legalForms[String(value)] ?? String(value ?? "—");
  }
  return String(value ?? "—");
}

export default function PlatformEnrollment({ id }: { id: string }) {
  const [tab, setTab] = useState<"profile" | "products">("profile");
  const auth = useAuth();
  const [row, setRow] = useState<Enrollment | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRow(await request<Enrollment>(`/enterprise-enrollments/${id}`));
      setError("");
    } catch (cause) {
      setRow(null);
      setError(onboardingError(cause));
    } finally {
      setLoading(false);
    }
  }, [id]);
  useEffect(() => {
    if (auth.user?.role.code === "SYSTEM_ADMIN") void refresh();
  }, [auth.user?.role.code, refresh]);
  if (auth.user?.role.code !== "SYSTEM_ADMIN")
    return (
      <p className="notice error" role="alert">
        Bạn không có quyền xét duyệt doanh nghiệp.
      </p>
    );
  return (
    <div className="manage-console">
      <PageHeader
        title={row?.organizationName ?? "Chi tiết hồ sơ"}
        description="Kiểm tra thông tin đăng ký, quyết định xét duyệt và theo dõi yêu cầu kết nối peer."
        back="/admin/enterprises"
      />
      {error && (
        <p className="notice error" role="alert">
          {error}
        </p>
      )}
      {loading && (
        <p className="manage-loading" role="status">
          Đang tải hồ sơ…
        </p>
      )}
      {!loading && !error && !row && (
        <EmptyState
          title="Không tìm thấy hồ sơ"
          description="Kiểm tra lại đường dẫn hoặc danh sách doanh nghiệp."
        />
      )}
      {row && !loading && (
        <>
          <div
            className="manage-filter-tabs"
            role="group"
            aria-label="Nội dung hồ sơ doanh nghiệp"
          >
            <button
              type="button"
              aria-pressed={tab === "profile"}
              onClick={() => setTab("profile")}
            >
              Hồ sơ và kết nối
            </button>
            <button
              type="button"
              aria-pressed={tab === "products"}
              onClick={() => setTab("products")}
            >
              Sản phẩm
            </button>
          </div>
          {tab === "products" && (
            <EnterpriseProductsPanel
              key={row.organizationId}
              organizationId={row.organizationId}
            />
          )}
          <div hidden={tab !== "profile"}>
            <section className="manage-section manage-detail-section">
              <div className="manage-detail-title">
                <div>
                  <p className="manage-overline">Hồ sơ đăng ký</p>
                  <h2>{row.organizationName}</h2>
                  <p>Mã hồ sơ: {row.id}</p>
                </div>
                <StatusBadge value={row.status} />
              </div>
              <dl className="manage-detail-list">
                <div>
                  <dt>Mã số</dt>
                  <dd>{row.businessId ?? "Chưa khai báo"}</dd>
                </div>
                <div>
                  <dt>Lĩnh vực</dt>
                  <dd>
                    {activityLabels[row.organizationType] ??
                      row.organizationType}
                  </dd>
                </div>
                <div>
                  <dt>Đại diện</dt>
                  <dd>{row.representativeName}</dd>
                </div>
                <div>
                  <dt>Email</dt>
                  <dd>{row.representativeEmail}</dd>
                </div>
                <div>
                  <dt>Mô hình peer</dt>
                  <dd>{hostingLabels[row.hostingMode] ?? row.hostingMode}</dd>
                </div>
                <div>
                  <dt>Gửi lúc</dt>
                  <dd>
                    {new Intl.DateTimeFormat("vi-VN", {
                      timeZone: "Asia/Ho_Chi_Minh",
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(row.createdAt))}
                  </dd>
                </div>
              </dl>
              <div className="manage-detail-actions">
                <ReloadButton onClick={() => void refresh()} />
              </div>
            </section>
            <section className="manage-section manage-detail-section">
              <h2>Thông tin pháp lý và liên hệ</h2>
              {row.details ? (
                <dl className="manage-detail-list">
                  {Object.entries(detailLabels).map(([key, label]) => (
                    <div key={key}>
                      <dt>{label}</dt>
                      <dd>{detailText(key, row.details?.[key])}</dd>
                    </div>
                  ))}
                </dl>
              ) : (
                <p className="notice">
                  Hồ sơ cũ chưa có đầy đủ thông tin; cần đối chiếu bổ sung.
                </p>
              )}
            </section>
            <RegistrationProfileDetails
              details={row.details}
              documents={row.documents}
            />
            {row.reviewNote && (
              <section className="manage-section manage-detail-section">
                <h2>Ghi chú xét duyệt</h2>
                <p>{row.reviewNote}</p>
              </section>
            )}
            <CapabilityReview enrollment={row} onDone={() => void refresh()} />
            {row.status === "PENDING_REVIEW" && (
              <section className="manage-section manage-detail-section">
                <h2>Quyết định xét duyệt</h2>
                <p className="manage-section-help">
                  Đối chiếu thông tin và ghi căn cứ trước khi phê duyệt hoặc từ
                  chối.
                </p>
                <ReviewDecision
                  kind="enterprise-enrollments"
                  id={row.id}
                  version={row.version}
                  onDone={refresh}
                />
              </section>
            )}
            {row.status === "APPROVED" && (
              <section className="manage-section manage-detail-section">
                <h2>Kích hoạt dịch vụ</h2>
                {row.serviceActivatedAt ? <p className="notice">Đã kích hoạt: {new Date(row.serviceActivatedAt).toLocaleString('vi-VN')}. {row.serviceActivationReason}</p> : row.onboardingStage === 'ACTIVE_LEGACY' ? <p>Quyền đã được cấp theo hồ sơ legacy.</p> : <DataForm key={`activation-${row.version}`} title="Cấp quyền sử dụng sau xét duyệt" path={`/enterprise-enrollments/${row.id}/activate`} extra={{version:row.version}} fields={[{name:'reason',label:'Căn cứ kích hoạt (tối thiểu 10 ký tự)',required:true,minLength:10,maxLength:1000}]} onSaved={()=>void refresh()} />}
                <p className="muted">Kích hoạt không xác nhận thanh toán thật hoặc kết nối Fabric. Kết nối peer có quy trình kiểm chứng riêng.</p>
                <h2>Sản phẩm của doanh nghiệp</h2>
                <p className="manage-section-help">
                  Xem danh sách sản phẩm doanh nghiệp đã tạo. Admin chỉ xem,
                  không chỉnh sửa.
                </p>
                <button
                  type="button"
                  onClick={() => setTab("products")}
                  className="manage-row-link"
                >
                  Xem sản phẩm
                </button>
              </section>
            )}
            <section className="manage-section manage-detail-section">
              <h2>Yêu cầu kết nối peer</h2>
              {row.connections.length ? (
                <div className="manage-connection-list">
                  {row.connections.map((connection) => (
                    <Link
                      key={connection.id}
                      href={`/admin/enterprises/${row.id}/connections/${connection.id}`}
                    >
                      <span>
                        <strong>
                          {statusLabels[connection.status] ?? connection.status}
                        </strong>
                        <small>Mã yêu cầu: {connection.id}</small>
                      </span>

                    </Link>
                  ))}
                </div>
              ) : (
                <p className="manage-section-help">
                  Doanh nghiệp chưa gửi yêu cầu kết nối.
                </p>
              )}
            </section>
          </div>
        </>
      )}
    </div>
  );
}
