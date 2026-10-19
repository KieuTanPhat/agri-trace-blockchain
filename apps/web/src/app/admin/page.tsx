"use client";

import Link from "next/link";
import type { Enrollment } from "@/lib/enterprise-onboarding";
import type { components } from "@/lib/generated/api";
import { useWorkspaceData } from "@/lib/workspace";
import {
  EmptyState,
  LoadState,
  OverviewChart,
  PageHeader,
  ReloadButton,
  StatusBadge,
} from "@/components/manage";

export default function AdminPage() {
  const state = useWorkspaceData<Enrollment[]>("/enterprise-enrollments");
  const operations = useWorkspaceData<components["schemas"]["AdminSummaryDto"]>(
    "/platform-operations/admin-summary",
  );
  const all = state.data ?? [];
  const pending = all
    .filter((entry) => entry.status === "PENDING_REVIEW")
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const queueItems = operations.data && state.data ? [
    { label: "Hồ sơ doanh nghiệp", value: pending.length },
    { label: "Phê duyệt hai bước", value: operations.data.pendingApprovals },
    { label: "Hồ sơ sự cố", value: operations.data.openCases },
    { label: "Yêu cầu quyền dữ liệu", value: operations.data.privacyRequests },
  ] : null;
  return (
    <div className="manage-console">
      <PageHeader
        title="Tổng quan nền tảng"
        description="Theo dõi công việc cần xử lý và tình trạng quản trị AgriTrace."
        action={{ href: "/admin/enterprises", label: "Mở danh sách hồ sơ" }}
      />
      <LoadState {...state} />
      <LoadState loading={false} error={operations.error} />
      <div className="manage-metrics" aria-label="Công việc vận hành cần xử lý">
        {[
          {
            label: "Hồ sơ chờ duyệt",
            value: state.loading ? undefined : pending.length,
            href: "/admin/enterprises",
          },
          {
            label: "Phê duyệt hai bước",
            value: operations.data?.pendingApprovals,
            href: "/admin/approvals",
          },
          {
            label: "Hồ sơ sự cố đang mở",
            value: operations.data?.openCases,
            href: "/admin/cases",
          },
          {
            label: "Yêu cầu quyền dữ liệu",
            value: operations.data?.privacyRequests,
            href: "/admin/privacy",
          },
        ].map((metric) => (
          <Link className="manage-metric" key={metric.label} href={metric.href}>
            <span>{metric.label}</span>
            <strong>{metric.value ?? "—"}</strong>
            <small>Mở hàng đợi xử lý</small>
          </Link>
        ))}
      </div>
      {queueItems && <OverviewChart title="Công việc đang chờ" description="Số lượng hiện tại theo từng hàng đợi" items={queueItems} />}
      <section className="manage-section" aria-labelledby="admin-queue-title">
        <div className="manage-section-heading">
          <div>
            <p className="manage-overline">Ưu tiên xử lý</p>
            <h2 id="admin-queue-title">Hồ sơ chờ duyệt</h2>
            <p>Xem thông tin pháp lý trước khi đưa ra quyết định.</p>
          </div>
          <ReloadButton onClick={state.reload} />
        </div>
        {!state.loading &&
          !state.error &&
          (pending.length ? (
            <div className="manage-table-scroll">
              <table className="manage-table">
                <thead>
                  <tr>
                    <th scope="col">Doanh nghiệp</th>
                    <th scope="col">Mã số</th>
                    <th scope="col">Ngày gửi</th>
                    <th scope="col">Trạng thái</th>
                    <th scope="col">
                      <span className="sr-only">Thao tác</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {pending.slice(0, 5).map((entry) => (
                    <tr key={entry.id}>
                      <td data-label="Doanh nghiệp">
                        <strong>{entry.organizationName}</strong>
                        <small>{entry.representativeEmail}</small>
                      </td>
                      <td data-label="Mã số">{entry.businessId}</td>
                      <td data-label="Ngày gửi">
                        {new Intl.DateTimeFormat("vi-VN", {
                          timeZone: "Asia/Ho_Chi_Minh",
                          day: "2-digit",
                          month: "2-digit",
                          year: "numeric",
                        }).format(new Date(entry.createdAt))}
                      </td>
                      <td data-label="Trạng thái">
                        <StatusBadge value={entry.status} />
                      </td>
                      <td data-label="Thao tác">
                        <Link
                          className="manage-row-link"
                          href={`/admin/enterprises/${entry.id}`}
                        >
                          Xem hồ sơ
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="Không có hồ sơ chờ duyệt"
              description="Hồ sơ mới sẽ xuất hiện tại đây khi doanh nghiệp hoàn tất đăng ký."
            />
          ))}
        {pending.length > 5 && (
          <Link className="manage-section-footer" href="/admin/enterprises">
            Xem toàn bộ {pending.length} hồ sơ chờ duyệt{" "}

          </Link>
        )}
      </section>
      <section className="manage-section" aria-labelledby="admin-tools-title">
        <div className="manage-section-heading">
          <div>
            <p className="manage-overline">Quản trị nền tảng</p>
            <h2 id="admin-tools-title">Công việc khác</h2>
          </div>
        </div>
        <div className="manage-tool-grid">
          {[
            {
              href: "/admin/enterprises",
              title: "Sản phẩm doanh nghiệp",
              description: "Mở hồ sơ doanh nghiệp, chọn tab Sản phẩm.",
            },
            {
              href: "/admin/organizations",
              title: "Tổ chức tham gia",
              description: "Tra cứu doanh nghiệp và quản lý tổ chức kiểm định.",
            },
            {
              href: "/admin/users",
              title: "Tài khoản nền tảng",
              description: "Quản trị viên nội bộ và người kiểm định độc lập.",
            },
            {
              href: "/admin/inspectors",
              title: "Kiểm định viên",
              description: "Gán người kiểm định theo nông trại và xem lịch sử.",
            },
          ].map(({ href, title, description }) => (
            <Link className="manage-tool" href={href} key={href}>
              <strong>{title}</strong>
              <span>{description}</span>
              <span className="manage-tool-open">
                Mở chức năng
              </span>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
