import { useCallback, useEffect, useRef, useState } from "react";
import { request } from "./api-client";
import { useAuth } from "./auth-store";
import { getAuthorizationScope } from "./auth-scope";
import { importantAction, useConfirm } from "./confirm";
import { PERMISSION_SYNC_EVENT } from "./permission-sync";
import type { components } from "./generated/api";
export type Row = Record<string, unknown>;
type Schemas = components["schemas"];
/** Enterprise workspace reads typed from the generated NestJS contract. */
export type Overview = Schemas["WorkspaceOverviewDto"];
export type EnterpriseMember = Schemas["EnterpriseMemberDto"];
export type EnterpriseRole = Schemas["EnterpriseRoleRecordDto"];
export type EnterpriseRoleTemplate = Schemas["EnterpriseRoleTemplateDto"];
export type EnterprisePartner = Schemas["EnterprisePartnerDto"];
export type EnterpriseSite = Schemas["EnterpriseSiteRecordDto"];
export type EnterpriseVehicle = Schemas["EnterpriseVehicleRecordDto"];
export type ProductionMaterial = Schemas["ProductionMaterialRecordDto"];
export type MemberInvitation = Schemas["EnterpriseMemberInvitationDto"];
export type EnterpriseRevision = Schemas["EnterpriseRevisionDto"];
export type TraceEvidence = Schemas["TraceEvidenceRecordDto"];
export type EnterpriseProfile = Schemas["EnterpriseProfileRecordDto"];
export type Catalog = Schemas["CatalogDto"];
export type OwnProfileWorkspace = Schemas["OwnProfileWorkspaceDto"];
export type ProfileAmendment = Schemas["ProfileAmendmentDto"];
export type ProfileAmendmentListItem = Schemas["ProfileAmendmentListItemDto"];
export type ProfileAmendmentDetail = Schemas["ProfileAmendmentDetailDto"];
export type ProfileEvidenceContent = Schemas["ProfileEvidenceContentDto"];
export type Items<T> = { items: T[] };
export type RecordOf<T> = { record: T };
export const textValue = (value: unknown) =>
  value === undefined || value === null ? "—" : String(value);
export const errorMessage = (error: unknown) =>
  error && typeof error === "object" && "message" in error
    ? String(error.message)
    : "Chưa kết nối được. Giữ nguyên yêu cầu và thử lại.";
export { labels } from "./status-labels";
export const permissionLabels: Record<string, string> = {
  "profile.manage": "Sửa hồ sơ và gửi lại xét duyệt",
  "cases.read": "Xem hồ sơ được giao",
  "cases.respond": "Tiếp nhận và phản hồi hồ sơ",
  "inventory.manage": "Phân bổ tồn theo cơ sở",
  "quarantine.manage": "Cách ly / giải phóng hàng tại cơ sở",
  "evidence.read": "Xem chứng cứ đính kèm",
  "evidence.manage": "Bổ sung / đính chính chứng cứ",
  "materials.read": "Xem giống và vật tư truy xuất",
  "materials.manage": "Quản lý giống và vật tư truy xuất",
  "quantity.adjust": "Ghi lượng bán ra / hao hụt theo lô trong chuỗi",
  "profile.read": "Xem hồ sơ doanh nghiệp",
  "members.read": "Xem thành viên / nhóm quyền",
  "members.manage": "Tạo và quản lý nhân viên",
  "roles.manage": "Tạo nhóm quyền",
  "partners.read": "Xem đối tác",
  "partners.manage": "Mời và quản lý liên kết",
  "catalog.read": "Xem sản phẩm / vùng sản xuất",
  "catalog.manage": "Tạo sản phẩm / vùng sản xuất",
  "sites.read": "Xem cơ sở",
  "sites.manage": "Quản lý cơ sở",
  "vehicles.read": "Xem phương tiện",
  "vehicles.manage": "Quản lý phương tiện",
  "production.read": "Xem vụ và nhật ký",
  "production.write": "Ghi nhật ký sản xuất / thu hoạch",
  "distribution.read": "Xem giao nhận",
  "distribution.write": "Tạo giao nhận / phân bổ",
  "distribution.sign": "Ký đồng thuận và bàn giao",
  "trace.read": "Xem hành trình truy xuất",
  "qr.manage": "Tải / in tem QR",
  "reports.read": "Xem báo cáo đối soát",
  "processing.read": "Xem lệnh chế biến",
  "processing.write": "Lập và hoàn tất lệnh chế biến",
};
/** Permissions shown in business groups so a role is easy to read. */
export const permissionGroups: { title: string; codes: string[] }[] = [
  {
    title: "Hồ sơ & thành viên",
    codes: ["profile.read", "profile.manage", "members.read", "members.manage", "roles.manage"],
  },
  { title: "Đối tác", codes: ["partners.read", "partners.manage"] },
  {
    title: "Danh mục, cơ sở & vật tư",
    codes: ["catalog.read", "catalog.manage", "sites.read", "sites.manage", "vehicles.read", "vehicles.manage", "materials.read", "materials.manage"],
  },
  {
    title: "Sản xuất & chế biến",
    codes: ["production.read", "production.write", "processing.read", "processing.write"],
  },
  {
    title: "Kho & phân phối",
    codes: ["inventory.manage", "quarantine.manage", "quantity.adjust", "distribution.read", "distribution.write", "distribution.sign"],
  },
  {
    title: "Truy xuất, chứng cứ & báo cáo",
    codes: ["trace.read", "qr.manage", "evidence.read", "evidence.manage", "reports.read"],
  },
  { title: "Phản ánh & sự cố", codes: ["cases.read", "cases.respond"] },
];
/** Groups holding the given codes; codes outside every group go last. */
export function groupPermissions(codes: string[]) {
  const grouped = permissionGroups
    .map((g) => ({ title: g.title, codes: g.codes.filter((c) => codes.includes(c)) }))
    .filter((g) => g.codes.length);
  const known = new Set(permissionGroups.flatMap((g) => g.codes));
  const rest = codes.filter((c) => !known.has(c));
  return rest.length ? [...grouped, { title: "Khác", codes: rest }] : grouped;
}
export function useWorkspaceData<T>(path: string | null) {
  const auth = useAuth(),
    scope = getAuthorizationScope(auth.user),
    userId = auth.user?.id;
  const [state, setState] = useState<{
    scope: string;
    data: T | null;
    error: string;
    loading: boolean;
  }>({ scope: "", data: null, error: "", loading: true });
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((r) => r + 1), []);
  useEffect(() => {
    let active = true;
    if (!path) { setState({scope,data:null,error:'',loading:false}); return; }
    setState({ scope, data: null, error: "", loading: true });
    if (!userId) return;
    request<T>(path)
      .then((data) => {
        if (active) setState({ scope, data, error: "", loading: false });
      })
      .catch((e) => {
        if (active)
          setState({
            scope,
            data: null,
            error: errorMessage(e),
            loading: false,
          });
      });
    return () => {
      active = false;
    };
  }, [path, scope, revision, userId]);
  useEffect(() => {
    window.addEventListener(PERMISSION_SYNC_EVENT, reload);
    return () => window.removeEventListener(PERMISSION_SYNC_EVENT, reload);
  }, [reload]);
  return {
    ...(state.scope === scope
      ? state
      : { data: null, error: "", loading: true }),
    reload,
  };
}
/** Retain exact body and key after unknown outcomes. Credentials stay in memory. */
export function useWorkspaceCommand() {
  const auth = useAuth();
  const scope = getAuthorizationScope(auth.user);
  const pendingRequest = useRef<{
    scope: string;
    path: string;
    body: string;
    key: string;
    method: "POST" | "PATCH";
  } | null>(null);
  const [pending, setPending] = useState(false),
    [error, setError] = useState(""),
    [frozen, setFrozen] = useState(false),
    [retrying, setRetrying] = useState(false);
  const confirm = useConfirm();
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  /** Resolves to the response body (truthy) on success, or false. */
  async function run<T = Row>(
    path: string,
    payload: unknown,
    method: "POST" | "PATCH" = "POST",
    options: { confirmed?: boolean } = {},
  ): Promise<T | false> {
    if (pending) return false;
    if (pendingRequest.current?.scope !== scope) pendingRequest.current = null;
    // Every write is confirmed once; screens with their own summary dialog
    // pass `confirmed`. Reconciling an uncertain request needs no new prompt.
    if (!pendingRequest.current && !options.confirmed) {
      const warning = importantAction(path) ?? defaultWriteWarning;
      if (!(await confirm(warning))) return false;
    }
    if (!pendingRequest.current)
      pendingRequest.current = {
        scope,
        path,
        body: JSON.stringify(payload),
        key: crypto.randomUUID(),
        method,
      };
    const saved = pendingRequest.current;
    setPending(true);
    setFrozen(true);
    setError("");
    try {
      // An unknown outcome is reconciled by resending the same body and key,
      // so the user never needs a separate retry action.
      for (let attempt = 0; ; attempt++) {
        try {
          const result = await request<T>(saved.path, {
            method: saved.method,
            headers: { "idempotency-key": saved.key },
            body: saved.body,
          });
          pendingRequest.current = null;
          setFrozen(false);
          setError("");
          return (result ?? ({} as T)) as T;
        } catch (e) {
          const status = (e as { status?: number }).status;
          const outcome = e as { recoveryId?: string; canRestart?: boolean };
          if (
            outcome.canRestart ||
            (!outcome.recoveryId &&
              status &&
              status >= 400 &&
              status < 500 &&
              status !== 408 &&
              status !== 429)
          ) {
            pendingRequest.current = null;
            setFrozen(false);
            setError(errorMessage(e));
            return false;
          }
          if (attempt >= AUTO_RETRY_DELAYS.length || !mounted.current) {
            setError(errorMessage(e));
            return false;
          }
          setRetrying(true);
          await new Promise((r) => setTimeout(r, AUTO_RETRY_DELAYS[attempt]));
        }
      }
    } finally {
      setRetrying(false);
      setPending(false);
    }
  }
  return { run, pending, error, frozen, retrying };
}
const defaultWriteWarning =
  "Xác nhận lưu thông tin này? Dữ liệu sẽ được ghi vào hệ thống và lưu lịch sử thay đổi.";
/** Backoff for resending an uncertain command with its original key. */
const AUTO_RETRY_DELAYS = [1000, 3000, 7000];
