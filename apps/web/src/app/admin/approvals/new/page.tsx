"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { platformAdminLabels } from "@/lib/permissions";
import { DataForm, type Field } from "@/components/data-form";
import type { Enrollment } from "@/lib/enterprise-onboarding";
import {
  approvalOperationLabels,
  type Approval,
} from "@/lib/platform-governance";
import { useWorkspaceData } from "@/lib/workspace";
import { LoadState, PageHeader } from "@/components/manage";

type Operation =
  | "CAPABILITY_GRANT"
  | "CREATE_CHAIN_GRANT"
  | "SYSTEM_ADMIN_CREATE"
  | "CONNECTION_APPROVE"
  | "ADMIN_PASSWORD_RESET"
  | "CAPABILITY_REQUEST_APPROVE"
  | "PLAN_VERSION_PUBLISH"
  | "INVOICE_CONFIRM_PAYMENT"
  | "SETTING_CHANGE"
  | "QR_BLOCK";
const operations = Object.keys(approvalOperationLabels) as Operation[];
type Org = { id: string; name: string; type: string };
const param = (name: string, label: string, extra: Partial<Field> = {}): Field => ({ name, label, required: true, nest: "params", ...extra });
/** Operations proposed from IDs shown on their own pages (capability request,
 * plan version, invoice, setting, lot). */
const GENERIC_FORMS: Partial<Record<Operation, Field[]>> = {
  CAPABILITY_REQUEST_APPROVE: [param("requestId", "Mã yêu cầu năng lực"), param("version", "Phiên bản yêu cầu", { type: "number", min: 0 }), param("note", "Căn cứ duyệt (tối thiểu 10 ký tự)", { minLength: 10 })],
  PLAN_VERSION_PUBLISH: [param("versionId", "Mã phiên bản bảng giá nháp")],
  INVOICE_CONFIRM_PAYMENT: [param("invoiceId", "Mã hóa đơn"), param("version", "Phiên bản hóa đơn", { type: "number", min: 0 }), param("reference", "Mã giao dịch ngân hàng", { minLength: 4 })],
  SETTING_CHANGE: [param("key", "Mã tham số"), param("value", "Giá trị mới (số)", { type: "number", min: 0 }), param("version", "Phiên bản tham số", { type: "number", min: 0 })],
  QR_BLOCK: [param("lotId", "Mã lô"), param("publicMessage", "Cảnh báo hiển thị cho người quét", { minLength: 10 })],
};

const reason: Field = {
  name: "reason",
  label: "Lý do đề xuất (tối thiểu 10 ký tự, ghi vào nhật ký kiểm toán)",
  required: true,
  minLength: 10,
  maxLength: 1000,
};
const mfa: Field = {
  name: "mfaCode",
  header: "X-MFA-Code",
  label: "Mã xác thực MFA (bắt buộc nếu tài khoản đã bật MFA)",
  maxLength: 20,
};

function OrganizationSelect({
  orgs,
  value,
  onChange,
  label,
}: {
  orgs: Org[];
  value: string;
  onChange(value: string): void;
  label: string;
}) {
  return (
    <label className="field">
      <span>{label}</span>
      <select
        className="select"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Chọn…</option>
        {orgs.map((org) => (
          <option key={org.id} value={org.id}>
            {org.name}
          </option>
        ))}
      </select>
    </label>
  );
}

function ChainGrantForm({
  organizationId,
  onSaved,
}: {
  organizationId: string;
  onSaved(value: unknown): void;
}) {
  const users = useWorkspaceData<{ id: string; fullName: string }[]>(
    `/organizations/${organizationId}/scoped-users`,
  );
  return (
    <>
      <LoadState {...users} />
      <DataForm
        key={organizationId}
        title="Gửi đề xuất cấp quyền tạo chuỗi"
        path="/platform-approvals"
        extra={{
          operation: "CREATE_CHAIN_GRANT",
          params: { organizationId },
        }}
        fields={[
          {
            name: "userId",
            label: "Tài khoản được cấp quyền",
            required: true,
            nest: "params",
            options: (users.data ?? []).map((user) => ({
              value: user.id,
              label: user.fullName,
            })),
          },
          reason,
          mfa,
        ]}
        onSaved={onSaved}
      />
    </>
  );
}

export default function NewApprovalPage() {
  const router = useRouter();
  const [operation, setOperation] = useState<Operation>("CAPABILITY_GRANT");
  const [organizationId, setOrganizationId] = useState("");
  const [connectionId, setConnectionId] = useState("");
  const organizations = useWorkspaceData<Org[]>("/organizations");
  const enrollments = useWorkspaceData<Enrollment[]>("/enterprise-enrollments");
  const accounts =
    useWorkspaceData<
      { id: string; fullName: string; email: string; role: { code: string } }[]
    >("/users");
  const admins = (accounts.data ?? []).filter(
    (account) => account.role.code in platformAdminLabels,
  );
  const orgs = (organizations.data ?? []).filter(
    (org) => org.type !== "AUDITOR",
  );
  const pending = (enrollments.data ?? []).flatMap((enrollment) =>
    enrollment.connections
      .filter((connection) => connection.status === "PENDING_REVIEW")
      .map((connection) => ({
        enrollment,
        connection,
      })),
  );
  const selected = pending.find((item) => item.connection.id === connectionId);

  useEffect(() => {
    // Deep link from the connection review page.
    const params = new URLSearchParams(window.location.search);
    const requested = params.get("operation");
    if (operations.includes(requested as Operation))
      setOperation(requested as Operation);
    const connection = params.get("connectionId");
    if (connection) setConnectionId(connection);
  }, []);

  const saved = (value: unknown) =>
    router.push(`/admin/approvals/${(value as Approval).id}`);
  return (
    <div className="manage-console manage-console--form">
      <PageHeader
        title="Tạo đề xuất phê duyệt"
        description="Đề xuất chỉ có hiệu lực sau khi một quản trị viên khác phê duyệt trước hạn. Nội dung được chuẩn hóa và băm khi gửi."
        back="/admin/approvals"
      />
      <LoadState
        loading={
          organizations.loading || enrollments.loading || accounts.loading
        }
        error={organizations.error || enrollments.error || accounts.error}
      />
      <div
        className="manage-choice"
        role="group"
        aria-label="Loại thao tác cần phê duyệt"
      >
        {operations.map((item) => (
          <button
            key={item}
            type="button"
            aria-pressed={operation === item}
            onClick={() => setOperation(item)}
          >
            {approvalOperationLabels[item]}
          </button>
        ))}
      </div>
      <div className="manage-form-shell">
        {operation === "CAPABILITY_GRANT" && (
          <DataForm
            key={operation}
            title="Gửi đề xuất cấp năng lực"
            path="/platform-approvals"
            extra={{ operation }}
            fields={[
              {
                name: "organizationId",
                label: "Tổ chức",
                required: true,
                nest: "params",
                options: orgs.map((org) => ({
                  value: org.id,
                  label: org.name,
                })),
              },
              {
                name: "code",
                label: "Năng lực",
                required: true,
                nest: "params",
                options: [
                  { value: "FARM", label: "Sản xuất" },
                  { value: "TRANSPORTER", label: "Vận chuyển" },
                  { value: "DISTRIBUTOR", label: "Phân phối" },
                  { value: "RETAILER", label: "Bán lẻ" },
                ],
              },
              reason,
              mfa,
            ]}
            onSaved={saved}
          />
        )}
        {operation === "CREATE_CHAIN_GRANT" && (
          <>
            <OrganizationSelect
              label="Tổ chức"
              orgs={orgs}
              value={organizationId}
              onChange={setOrganizationId}
            />
            {organizationId && (
              <ChainGrantForm organizationId={organizationId} onSaved={saved} />
            )}
          </>
        )}
        {operation === "SYSTEM_ADMIN_CREATE" && (
          <DataForm
            key={operation}
            title="Gửi đề xuất tạo quản trị viên"
            path="/platform-approvals"
            extra={{ operation }}
            fields={[
              {
                name: "roleCode",
                label: "Phạm vi quản trị",
                nest: "params",
                required: true,
                options: Object.entries(platformAdminLabels).map(
                  ([value, label]) => ({ value, label }),
                ),
              },
              {
                name: "fullName",
                label: "Họ và tên",
                required: true,
                nest: "params",
                maxLength: 255,
              },
              {
                name: "email",
                label: "Email đăng nhập",
                type: "email",
                required: true,
                nest: "params",
              },
              {
                name: "temporaryPassword",
                label:
                  "Mật khẩu tạm (ít nhất 12 ký tự; không được lưu dạng rõ)",
                type: "password",
                required: true,
                nest: "params",
              },
              reason,
              mfa,
            ]}
            onSaved={saved}
          />
        )}
        {operation === "ADMIN_PASSWORD_RESET" && (
          <DataForm
            key={operation}
            title="Gửi đề xuất đặt lại mật khẩu quản trị viên"
            path="/platform-approvals"
            extra={{ operation }}
            fields={[
              {
                name: "userId",
                label: "Quản trị viên",
                required: true,
                nest: "params",
                options: admins.map((account) => ({
                  value: account.id,
                  label: `${account.fullName} (${account.email})`,
                })),
              },
              {
                name: "temporaryPassword",
                label:
                  "Mật khẩu tạm (ít nhất 12 ký tự; không được lưu dạng rõ)",
                type: "password",
                required: true,
                nest: "params",
              },
              reason,
              mfa,
            ]}
            onSaved={saved}
          />
        )}
        {GENERIC_FORMS[operation] && (
          <DataForm
            key={operation}
            title={`Gửi đề xuất: ${approvalOperationLabels[operation]}`}
            path="/platform-approvals"
            extra={{ operation }}
            fields={[...GENERIC_FORMS[operation]!, reason, mfa]}
            onSaved={saved}
          />
        )}
        {operation === "CONNECTION_APPROVE" && (
          <>
            <label className="field">
              <span>Yêu cầu kết nối chờ duyệt</span>
              <select
                className="select"
                value={connectionId}
                onChange={(event) => setConnectionId(event.target.value)}
              >
                <option value="">Chọn…</option>
                {pending.map(({ enrollment, connection }) => (
                  <option key={connection.id} value={connection.id}>
                    {enrollment.organizationName} · {connection.id.slice(0, 8)}
                  </option>
                ))}
              </select>
            </label>
            {!pending.length && !enrollments.loading && (
              <p className="notice" role="status">
                Chưa có yêu cầu kết nối nào chờ duyệt.
              </p>
            )}
            {selected && (
              <DataForm
                key={selected.connection.id}
                title="Gửi đề xuất chấp nhận kết nối"
                path="/platform-approvals"
                extra={{
                  operation,
                  params: {
                    connectionId: selected.connection.id,
                    version: selected.connection.version,
                  },
                }}
                fields={[
                  {
                    name: "note",
                    label: "Căn cứ duyệt (tối thiểu 10 ký tự)",
                    required: true,
                    nest: "params",
                    minLength: 10,
                    maxLength: 1000,
                  },
                  reason,
                  mfa,
                ]}
                onSaved={saved}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}
