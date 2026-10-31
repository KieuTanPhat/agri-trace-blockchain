import type { components } from "../../../src/lib/generated/api";
import type {
  LedgerDashboard,
  LedgerInbox,
  PlatformStatistics,
  OrganizationDetail,
  DirectoryItem,
  Setting,
} from "../../../src/lib/ledger/platform-api";
import { actorSession } from "./actors";
import {
  registerScenario,
  readScenario,
  type FixtureResponse,
  type CapturedRequest,
  type FixtureState,
} from "./scenarios";
type S = components["schemas"];
export const enrollmentId = "11111111-1111-4111-8111-111111111111";
export const pendingEnrollment: S["EnterpriseEnrollmentViewDto"] = {
  paymentsEnabled: true,
  id: enrollmentId,
  organizationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  organizationName: "HTX Hồ sơ kiểm thử",
  organizationType: "FARM",
  businessId: "0123456789",
  representativeName: "Nguyễn An",
  representativeEmail: "owner@example.invalid",
  participationModel: "SINGLE",
  payingParticipant: true,
  hostingMode: "MANAGED_ORG",
  status: "PENDING_REVIEW",
  onboardingStage: "PENDING_REVIEW",
  version: 3,
  createdAt: "2026-10-22T00:00:00.000Z",
  reviewNote: null,
  serviceActivatedAt: null,
  serviceActivationReason: null,
  capabilityRequests: [],
  connections: [],
  documents: [],
  details: null,
};
const proposer = actorSession("platform-admin")!.user;
const farmCapability: S["CapabilityRequestViewDto"] = {
  id: "22222222-2222-4222-8222-222222222222",
  code: "FARM",
  createdAt: pendingEnrollment.createdAt,
  details: { sector: "CROP", productGroups: ["Xoài"] },
  evidenceIds: [],
  reviewedAt: null,
  reviewNote: null,
  status: "PENDING",
  version: 1,
};
pendingEnrollment.capabilityRequests = [farmCapability];
function governance(
  request: CapturedRequest,
  state: FixtureState,
): FixtureResponse | undefined {
  if (request.path === "/platform-admin/inbox" && request.method === "GET")
    return { data: { record: inbox } };
  if (request.path === "/enterprise-enrollments" && request.method === "GET")
    return { data: [pendingEnrollment] };
  if (
    request.path === `/enterprise-enrollments/${enrollmentId}` &&
    request.method === "GET"
  )
    return { data: state.values.get("enrollment") ?? pendingEnrollment };
  if (request.path === "/organizations" && request.method === "GET")
    return { data: [] };
  if (request.path === "/users/roles" && request.method === "GET")
    return {
      data: [
        {
          id: enrollmentId,
          code: "PLATFORM_OPERATOR",
          name: "Vận hành nền tảng",
          description: null,
        } satisfies S["RoleRecordDto"],
      ],
    };
  if (request.path === "/users" && request.method === "GET")
    return { data: [state.values.get("account") ?? governanceAccount] };
  if (
    request.path === `/users/${governanceAccount.id}/status` &&
    request.method === "PATCH"
  ) {
    const input = JSON.parse(request.body ?? "{}") as S["UpdateUserStatusDto"];
    if (
      input.version !== governanceAccount.version ||
      input.reason.length < 10 ||
      !request.idempotencyKey
    )
      throw new Error("Account status version/reason/key missing");
    state.values.set("account", {
      ...governanceAccount,
      accountStatus: input.accountStatus,
      version: governanceAccount.version + 1,
    });
    return { data: state.values.get("account") };
  }
  if (
    request.path === "/platform-admin/organizations" &&
    request.method === "GET"
  )
    return { data: { items: [] } };
  if (
    request.path === "/enterprise-profile-amendments" &&
    request.method === "GET"
  )
    return { data: { items: [] } };
  if (
    request.path ===
      `/platform-admin/organizations/${pendingEnrollment.organizationId}` &&
    request.method === "GET"
  )
    return {
      data: {
        record: {
          id: pendingEnrollment.organizationId,
          name: pendingEnrollment.organizationName,
          type: "FARM",
          status: "ACTIVE",
          version: 1,
          participationModel: "SINGLE",
          createdAt: pendingEnrollment.createdAt,
          billing: { subscription: null },
        },
      } satisfies S["AdminRecordDto"],
    };
  if (request.path === "/catalog" && request.method === "GET")
    return { data: { farms: [], plots: [], products: [] } };
  if (
    request.path === `/enterprise-enrollments/${enrollmentId}/review` &&
    request.method === "POST"
  ) {
    const input: unknown = JSON.parse(request.body ?? "{}");
    if (
      !input ||
      typeof input !== "object" ||
      !("version" in input) ||
      input.version !== 3 ||
      !("decision" in input) ||
      input.decision !== "APPROVE" ||
      !request.idempotencyKey
    )
      throw new Error("Enrollment decision/version/key differs from baseline");
    state.values.set("enrollment", {
      ...pendingEnrollment,
      status: "APPROVED",
      onboardingStage: "AWAITING_ACTIVATION",
      version: 4,
      capabilityRequests: [farmCapability],
    });
    return { data: state.values.get("enrollment") };
  }
  return undefined;
}
const governanceAccount: S["UserListDto"] = {
  id: "55555555-5555-4555-8555-555555555555",
  email: "operator@example.invalid",
  fullName: "Người vận hành kiểm thử",
  role: { code: "PLATFORM_OPERATOR", name: "Vận hành nền tảng" },
  organization: null,
  accountStatus: "ACTIVE",
  mustChangePassword: false,
  lockedUntil: null,
  version: 4,
  createdAt: "2026-10-22T00:00:00Z",
  updatedAt: "2026-10-22T00:00:00Z",
};
registerScenario("governance.accounts", { handle: governance });
registerScenario("governance.pending-enrollment", { handle: governance });
const legalDocument: S["RegistrationDocumentViewDto"] = {
  id: "44444444-4444-4444-8444-444444444444",
  kind: "LEGAL_REGISTRATION",
  fileName: "giay-dang-ky.pdf",
  mediaType: "application/pdf",
  size: 32,
  sha256: "b".repeat(64),
};
registerScenario("governance.document-denied", {
  configure: (state) =>
    state.values.set("enrollment", {
      ...pendingEnrollment,
      documents: [legalDocument],
    }),
  handle: (request, state) =>
    request.method === "GET" &&
    request.path === `/enterprise-registration-documents/${legalDocument.id}`
      ? {
          status: 403,
          error: {
            code: "FORBIDDEN",
            message: "Không còn quyền tải tài liệu này",
          },
        }
      : governance(request, state),
});
const details: S["EnterpriseRegistrationDetails"] = {
  formVersion: 2,
  legalForm: "COOPERATIVE",
  address: "Số 1 đường kiểm thử",
  province: "Thành phố Hồ Chí Minh",
  provinceCode: "79",
  ward: "Phường kiểm thử",
  wardCode: "001",
  phone: "0912345678",
  contactEmail: "contact@example.invalid",
  representative: "Nguyễn An",
  representativeTitle: "Giám đốc",
  registrationNumber: "HTX-001",
  registrantRelationship: "REPRESENTATIVE",
  activities: ["FARM"],
  production: {
    sector: "CROP",
    productGroups: ["Xoài"],
    certifications: [],
    scaleEstimate: "12 ha đất canh tác",
  },
  services: {
    interests: ["TRACEABILITY"],
    expectedProducts: "UP_TO_10",
    partnerIntent: "LATER",
    integrationNotes: "Tích hợp hệ thống kiểm thử",
  },
  documentIds: [],
  declarationAccepted: true,
  termsAccepted: true,
  privacyAcknowledged: true,
  marketingAccepted: false,
};
registerScenario("governance.profile-data", {
  configure: (state) =>
    state.values.set("enrollment", { ...pendingEnrollment, details }),
  handle: governance,
});
const inbox: LedgerInbox = {
  items: [
    {
      kind: "ENROLLMENT",
      id: enrollmentId,
      title: "Hồ sơ đăng ký doanh nghiệp",
      organizationName: pendingEnrollment.organizationName,
      createdAt: pendingEnrollment.createdAt,
      dueAt: "2099-10-23T00:00:00Z",
      ageHours: 24,
      overdue: false,
      href: `/admin/enterprises/${enrollmentId}`,
    },
  ],
  summary: {
    ENROLLMENT: 1,
    CAPABILITY: 0,
    AMENDMENT: 0,
    CONNECTION: 0,
    TICKET: 0,
    CONSUMER_REPORT: 0,
    CASE: 0,
    INVOICE_OVERDUE: 0,
    total: 1,
    overdue: 0,
  },
};
const dashboard: LedgerDashboard = {
  generatedAt: "2026-10-23T00:00:00Z",
  organizations: {
    byType: { FARM: 1 },
    byStatus: { ACTIVE: 1 },
    byModel: { SINGLE: 1 },
    capabilities: { FARM: 1 },
  },
  pending: inbox.summary,
  billing: {
    active: 0,
    grace: 0,
    restricted: 0,
    expiringSoon: [],
    monthRevenue: 0,
    monthSimulated: 0,
    outstanding: 0,
  },
  traceability: {
    lots: 4,
    processedLots: 0,
    processingRuns30Days: 0,
    scans7Days: 6,
    blockedQr: 0,
  },
  ledger: {
    outbox: { CONFIRMED: 2 },
    proofs: { CONFIRMED: 2 },
    unresolvedHolds: 0,
    lastConfirmedAt: "2026-10-22T00:00:00Z",
  },
  security: { lockedAccounts: 0, adminsWithoutMfa: 0, admins: 1 },
  recentActivity: [],
  notices: [],
};
const statistics: PlatformStatistics = {
  months: [],
  totals: { organizations: 1, users: 2, chains: 1, events: 3 },
};
registerScenario("governance.workbench", {
  handle: (request, state) => {
    if (
      request.path === "/platform-admin/dashboard" &&
      request.method === "GET"
    )
      return { data: { record: dashboard } };
    if (request.path === "/platform-admin/inbox" && request.method === "GET")
      return { data: { record: inbox } };
    if (
      request.path === "/platform-admin/statistics" &&
      request.method === "GET"
    )
      return { data: { record: statistics } };
    if (
      request.path === "/platform-operations/admin-summary" &&
      request.method === "GET"
    )
      return {
        data: {
          generatedAt: "2026-10-23T00:00:00Z",
          openCases: 0,
          overdueCases: 0,
          privacyRequests: 0,
          breachReportsDue: 0,
          breachReportsOverdue: 0,
          lockedAccounts: 0,
        } satisfies S["AdminSummaryDto"],
      };
    return governance(request, state);
  },
});
const auditorOrg: S["OrganizationRecordDto"] = {
  id: "99999999-9999-4999-8999-999999999999",
  name: "Tổ chức kiểm định kiểm thử",
  type: "AUDITOR",
  status: "ACTIVE",
  version: 1,
  createdAt: pendingEnrollment.createdAt,
  updatedAt: pendingEnrollment.createdAt,
};
const reviewer: S["UserListDto"] = {
  ...governanceAccount,
  id: "77777777-7777-4777-8777-777777777777",
  fullName: "Người kiểm định kiểm thử",
  role: { code: "COMPLIANCE_REVIEWER", name: "Người kiểm định" },
  organization: { id: auditorOrg.id, name: auditorOrg.name, type: "AUDITOR" },
};
const assignment: S["AssignmentListDto"] = {
  id: enrollmentId,
  reviewerUserId: reviewer.id,
  farmId: enrollmentId,
  farm: { id: enrollmentId, name: "Vùng trồng kiểm thử" },
  grantedAt: pendingEnrollment.createdAt,
  revokedAt: null,
  audits: [],
};
const farm: S["CatalogFarmDto"] = {
  id: enrollmentId,
  name: "Vùng trồng kiểm thử",
  organizationId: pendingEnrollment.organizationId,
  organization: {
    ...auditorOrg,
    id: pendingEnrollment.organizationId,
    type: "FARM",
    name: pendingEnrollment.organizationName,
  },
  status: "ACTIVE",
  privacy: "PUBLIC",
  version: 1,
  address: null,
  areaM2: null,
  createdAt: pendingEnrollment.createdAt,
  updatedAt: pendingEnrollment.createdAt,
  cropCode: null,
  email: null,
  evidenceComplete: false,
  expectedOutput: null,
  inputMaterialIds: [],
  internalCode: null,
  kind: null,
  linkedSiteId: null,
  location: null,
  otherInfo: null,
  outputUnit: null,
  phone: null,
  region: null,
  representative: null,
  seedMaterialIds: [],
};
const organization: OrganizationDetail = {
  id: pendingEnrollment.organizationId,
  name: pendingEnrollment.organizationName,
  type: "FARM",
  status: "ACTIVE",
  version: 1,
  participationModel: "SINGLE",
  createdAt: pendingEnrollment.createdAt,
  profile: null,
  capabilities: [],
  capabilityRequests: [],
  enrollment: {
    id: enrollmentId,
    status: "PENDING_REVIEW",
    stage: "PENDING_REVIEW",
    hostingMode: "MANAGED_ORG",
    createdAt: pendingEnrollment.createdAt,
    connections: [],
  },
  billing: {
    applies: true,
    paying: true,
    status: "NONE",
    limits: null,
    usage: {},
    subscription: null,
    invoices: [],
  },
  chains: { owned: [], memberships: [] },
  sites: [],
  members: [],
  activity: { lots: 0, processingRuns: 0 },
  cases: [],
  tickets: [],
  audit: [],
};
const directory: DirectoryItem = {
  id: organization.id,
  name: organization.name,
  type: organization.type,
  status: organization.status,
  version: 1,
  participationModel: "SINGLE",
  capabilities: [],
  pendingCapabilities: [],
  enrollmentId,
  stage: "PENDING_REVIEW",
  planName: null,
  subscriptionStatus: null,
  endsAt: null,
  province: null,
  members: 0,
  ownedChains: 0,
  chainMemberships: 0,
  createdAt: pendingEnrollment.createdAt,
};
const setting: Setting = {
  key: "enrollment.slaHours",
  value: 48,
  version: 3,
  description: "Thời hạn xem xét hồ sơ",
  editable: true,
  hint: "Số giờ xử lý",
  updatedAt: pendingEnrollment.createdAt,
};
registerScenario("governance.registry", {
  handle: (r, state) => {
    const pathname = r.path.split("?")[0];
    if (r.path === "/users" && r.method === "POST")
      return {
        data: {
          id: enrollmentId,
          accountStatus: "ACTIVE",
          email: "new@example.invalid",
          fullName: "Tài khoản mới",
        } satisfies S["UserCreatedDto"],
      };
    if (
      r.path === `/users/${governanceAccount.id}/unlock` &&
      r.method === "POST"
    ) {
      state.values.set("account", {
        ...governanceAccount,
        accountStatus: "ACTIVE",
        version: 5,
      });
      return { data: state.values.get("account") };
    }
    if (
      r.path === `/users/${governanceAccount.id}/reset-password` &&
      r.method === "POST"
    )
      return { data: { id: governanceAccount.id, mustChangePassword: true } };
    if (
      r.path === `/users/${governanceAccount.id}/revoke-sessions` &&
      r.method === "POST"
    )
      return {
        data: {
          id: governanceAccount.id,
          sessionsRevoked: 2,
        } satisfies S["UserSessionsRevokedDto"],
      };
    if (r.path === "/auth/mfa/recovery-codes" && r.method === "POST")
      return {
        data: {
          enabled: true,
          recoveryCodes: ["fixture-replacement-code"],
        } satisfies S["MfaEnabledDto"],
      };
    if (r.path === "/auth/mfa/disable" && r.method === "POST") {
      state.values.set("mfa", {
        mode: "OPTIONAL",
        status: "NONE",
        enabledAt: null,
        recoveryCodesRemaining: 0,
      } satisfies S["MfaStatusDto"]);
      return { data: { enabled: false } satisfies S["MfaDisabledDto"] };
    }
    if (
      r.path === `/enterprise-enrollments/${enrollmentId}` &&
      r.method === "GET"
    )
      return {
        data: state.values.get("enrollment") ?? {
          ...pendingEnrollment,
          connections: [connection],
        },
      };
    if (r.path === "/enterprise-enrollments" && r.method === "GET")
      return { data: [{ ...pendingEnrollment, connections: [connection] }] };
    if (pathname === "/enterprise-profile-amendments" && r.method === "GET")
      return {
        data: {
          items: [
            { ...amendment.amendment, organizationName: organization.name },
          ] satisfies S["ProfileAmendmentListItemDto"][],
        },
      };
    if (
      r.path === `/enterprise-profile-amendments/${enrollmentId}` &&
      r.method === "GET"
    )
      return { data: { record: state.values.get("amendment") ?? amendment } };
    if (
      r.path === `/enterprise-profile-amendments/${enrollmentId}/review` &&
      r.method === "POST"
    ) {
      const input = JSON.parse(r.body ?? "{}") as {
        decision: string;
        reason: string;
        version: number;
      };
      if (input.version !== 2 || input.reason.length < 10 || !r.idempotencyKey)
        throw new Error("Amendment version/reason/key missing");
      state.values.set("amendment", {
        ...amendment,
        amendment: {
          ...amendment.amendment,
          status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
          version: 3,
          reviewNote: input.reason,
        },
      });
      return { data: { record: state.values.get("amendment") } };
    }
    if (
      r.path === `/enterprise-connections/${connection.id}/review` &&
      r.method === "POST"
    ) {
      const input = JSON.parse(r.body ?? "{}") as S["ReviewEnterpriseDto"];
      if (input.version !== 5 || !r.idempotencyKey)
        throw new Error("Connection version/key missing");
      const changed = {
        ...connection,
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        version: 6,
        reviewNote: input.note,
      };
      state.values.set("enrollment", {
        ...pendingEnrollment,
        connections: [changed],
      });
      return { data: changed };
    }
    if (
      r.path === `/organizations/${organization.id}/scoped-users` &&
      r.method === "GET"
    )
      return {
        data: [
          {
            id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
            fullName: "Thành viên kiểm thử",
          },
        ] satisfies S["ScopedUserDto"][],
      };
    if (
      r.path === `/enterprise-enrollments/${enrollmentId}/activate` &&
      r.method === "POST"
    ) {
      const input = JSON.parse(r.body ?? "{}") as S["ActivateEnterpriseDto"];
      if (input.version !== 4 || input.reason.length < 10 || !r.idempotencyKey)
        throw new Error("Activation version/reason/key missing");
      state.values.set("enrollment", {
        ...pendingEnrollment,
        status: "APPROVED",
        onboardingStage: "ACTIVE",
        version: 5,
        serviceActivatedAt: "2026-10-23T00:00:00Z",
        capabilityRequests: [],
      });
      return { data: state.values.get("enrollment") };
    }
    if (
      r.path === `/capability-requests/${farmCapability.id}/review` &&
      r.method === "POST"
    ) {
      const input = JSON.parse(r.body ?? "{}") as S["ReviewEnterpriseDto"];
      if (input.version !== 1 || !r.idempotencyKey)
        throw new Error("Capability version/key missing");
      const changed = {
        ...farmCapability,
        status: input.decision === "APPROVE" ? "APPROVED" : "REJECTED",
        version: 2,
      };
      state.values.set("enrollment", {
        ...pendingEnrollment,
        capabilityRequests: [changed],
      });
      return { data: changed };
    }
    if (
      r.path ===
        `/enterprise-profile-amendments/${enrollmentId}/evidence/${legalDocument.id}` &&
      r.method === "GET"
    )
      return {
        data: {
          record: {
            contentBase64: "cHJpdmF0ZS1maXh0dXJl",
            fileName: "chung-cu.pdf",
            mediaType: "application/pdf",
            sha256: "b".repeat(64),
          } satisfies S["ProfileEvidenceContentDto"],
        },
      };
    if (
      r.path === `/enterprise-registration-documents/${legalDocument.id}` &&
      r.method === "GET"
    )
      return {
        data: {
          ...legalDocument,
          contentBase64: "cHJpdmF0ZS1maXh0dXJl",
        } satisfies S["RegistrationDocumentContentDto"],
      };
    if (r.path === "/users" && r.method === "GET")
      return {
        data: [state.values.get("account") ?? governanceAccount, reviewer],
      };
    if (r.path === "/organizations" && r.method === "GET")
      return { data: [auditorOrg, farm.organization] };
    if (pathname === "/platform-admin/organizations" && r.method === "GET")
      return { data: { items: [directory] } };
    if (
      r.path === `/platform-admin/organizations/${organization.id}` &&
      r.method === "GET"
    )
      return { data: { record: organization } };
    if (r.path === "/platform-billing/plans" && r.method === "GET")
      return { data: { items: [] } };
    if (r.path === "/catalog" && r.method === "GET")
      return {
        data: {
          farms: [farm],
          plots: [],
          products: [product],
        } satisfies S["CatalogDto"],
      };
    if (r.path === "/compliance/assignments" && r.method === "GET")
      return { data: [state.values.get("assignment") ?? assignment] };
    if (
      r.path === `/compliance/assignments/${enrollmentId}/revoke` &&
      r.method === "POST"
    ) {
      const input = JSON.parse(r.body ?? "{}") as S["AssignmentReasonDto"];
      if (!input.reason || !r.idempotencyKey)
        throw new Error("Assignment reason/key missing");
      state.values.set("assignment", {
        ...assignment,
        revokedAt: "2026-10-23T00:00:00Z",
      });
      return { data: state.values.get("assignment") };
    }
    if (r.path === "/compliance/assignments" && r.method === "POST")
      return { data: assignment };
    if (r.path === "/platform-admin/settings" && r.method === "GET")
      return { data: { items: [state.values.get("setting") ?? setting] } };
    if (
      r.path === "/platform-admin/settings/enrollment.slaHours" &&
      r.method === "POST"
    ) {
      const input = JSON.parse(r.body ?? "{}") as Omit<
        S["SettingChangeInput"],
        "value"
      > & { value: unknown };
      if (input.version !== 3 || input.value !== 24 || !r.idempotencyKey)
        throw new Error("Setting value/version/key differs");
      state.values.set("setting", { ...setting, value: 24, version: 4 });
      return { data: { record: state.values.get("setting") } };
    }
    if (r.path === "/organizations" && r.method === "POST")
      return { data: { ...auditorOrg, ...JSON.parse(r.body ?? "{}") } };
    if (r.path === "/auth/mfa" && r.method === "GET")
      return {
        data:
          state.values.get("mfa") ??
          ({
            mode: "OPTIONAL",
            status: "NONE",
            enabledAt: null,
            recoveryCodesRemaining: 0,
          } satisfies S["MfaStatusDto"]),
      };
    if (r.path === "/auth/mfa/enroll" && r.method === "POST") {
      state.values.set("mfa", {
        mode: "OPTIONAL",
        status: "PENDING",
        enabledAt: null,
        recoveryCodesRemaining: 0,
      } satisfies S["MfaStatusDto"]);
      return {
        data: {
          secret: "JBSWY3DPEHPK3PXP",
          otpauthUri:
            "otpauth://totp/Fixture?secret=JBSWY3DPEHPK3PXP&issuer=Fixture",
        } satisfies S["MfaEnrollmentDto"],
      };
    }
    if (r.path === "/auth/mfa/verify" && r.method === "POST") {
      const input = JSON.parse(r.body ?? "{}") as S["MfaCodeDto"];
      if (input.code !== "123456")
        return {
          status: 422,
          error: { code: "INVALID_MFA", message: "Mã xác thực không đúng" },
        };
      state.values.set("mfa", {
        mode: "OPTIONAL",
        status: "ENABLED",
        enabledAt: "2026-10-23T00:00:00Z",
        recoveryCodesRemaining: 2,
      } satisfies S["MfaStatusDto"]);
      return {
        data: {
          enabled: true,
          recoveryCodes: ["fixture-recovery-one", "fixture-recovery-two"],
        } satisfies S["MfaEnabledDto"],
      };
    }
    if (r.path === "/platform-audit/actions" && r.method === "GET")
      return { data: ["USER_STATUS_CHANGED"] };
    if (pathname === "/platform-audit" && r.method === "GET")
      return {
        data: {
          items: [],
          nextCursor: null,
        } satisfies S["PlatformAuditPageDto"],
      };
    if (r.path === "/platform-audit/verify" && r.method === "GET")
      return {
        data: {
          ok: true,
          checked: 0,
          firstInvalid: null,
          headHash: null,
          headSequence: null,
        } satisfies S["PlatformAuditVerificationDto"],
      };
    if (pathname === "/platform-audit/export" && r.method === "GET")
      return {
        data: {
          csv: "sequence,action\n",
          filename: "fixture-audit.csv",
          limit: 5000,
          rowCount: 0,
          truncated: false,
        } satisfies S["PlatformAuditExportDto"],
      };
    if (
      r.path === "/platform-admin/dashboard" ||
      r.path === "/platform-admin/statistics" ||
      r.path === "/platform-operations/admin-summary"
    )
      return readScenario("governance.workbench").handle(r, state);
    return governance(r, state);
  },
});
const connection: S["EnterpriseConnectionViewDto"] = {
  id: "88888888-8888-4888-8888-888888888888",
  chainId: enrollmentId,
  hostingMode: "ORG_PEER",
  publicConfig: { mspId: "FixtureMSP", peer: "peer.example.invalid" },
  status: "PENDING_REVIEW",
  version: 5,
  createdAt: pendingEnrollment.createdAt,
  checkedAt: null,
  errorCode: null,
  evidence: null,
  txId: null,
  reviewNote: null,
};
const amendment: S["ProfileAmendmentDetailDto"] = {
  organization: { id: organization.id, name: organization.name, version: 1 },
  profile: null,
  enrollment: null,
  stale: false,
  evidence: [
    {
      ...legalDocument,
      fileName: "chung-cu.pdf",
      description: "Xác minh thay đổi hồ sơ",
      createdAt: pendingEnrollment.createdAt,
    },
  ],
  amendment: {
    id: enrollmentId,
    organizationId: organization.id,
    organizationVersion: 1,
    profileVersion: 0,
    creatorId: proposer.id,
    evidenceIds: [legalDocument.id],
    reason: "Cập nhật thông tin pháp lý",
    status: "PENDING",
    version: 2,
    createdAt: pendingEnrollment.createdAt,
    reviewedAt: null,
    reviewedBy: null,
    reviewNote: null,
    target: {
      name: "HTX Tên đề nghị",
      legalForm: "COOPERATIVE",
      representative: "Nguyễn An",
      address: "Số 1 đường mới",
      province: "Thành phố Hồ Chí Minh",
      provinceCode: "79",
      ward: "Phường mới",
      wardCode: "001",
      activities: ["FARM"],
      legalData: {
        registrationNumber: "HTX-002",
        businessId: "0123456789",
        representativeTitle: "Giám đốc",
        production: null,
      },
    },
  },
};
const product: S["ProductRecordDto"] = {
  id: enrollmentId,
  productName: "Xoài kiểm thử đầy đủ",
  organizationId: organization.id,
  originFarmId: enrollmentId,
  status: "ACTIVE",
  version: 2,
  category: "Trái cây",
  createdAt: pendingEnrollment.createdAt,
  updatedAt: pendingEnrollment.createdAt,
  defaultUnit: "kg",
  description: "Sản phẩm hồ sơ tổ chức",
  evidenceComplete: false,
  ingredients: null,
  price: null,
  storageConditions: null,
  usageInstructions: null,
  variety: null,
  sku: "XOAI-001",
};
registerScenario("governance.ready-activation", {
  configure: (state) =>
    state.values.set("enrollment", {
      ...pendingEnrollment,
      status: "APPROVED",
      onboardingStage: "AWAITING_ACTIVATION",
      version: 4,
      payingParticipant: true,
      capabilityRequests: [],
    }),
  handle: (r, state) => readScenario("governance.registry").handle(r, state),
});
registerScenario("governance.mfa-unknown", {
  handle: async (r, state) => {
    const response = await readScenario("governance.registry").handle(r, state);
    return r.path === "/auth/mfa/enroll" && r.method === "POST"
      ? {
          status: 500,
          error: {
            code: "UNKNOWN_RESULT",
            message: "Chưa nhận được kết quả đăng ký",
          },
        }
      : response;
  },
});
registerScenario("governance.mfa-enabled", {
  configure: (state) =>
    state.values.set("mfa", {
      mode: "OPTIONAL",
      status: "ENABLED",
      enabledAt: "2026-10-23T00:00:00Z",
      recoveryCodesRemaining: 2,
    } satisfies S["MfaStatusDto"]),
  handle: (r, state) => readScenario("governance.registry").handle(r, state),
});
registerScenario("governance.locked-account", {
  configure: (state) =>
    state.values.set("account", {
      ...governanceAccount,
      accountStatus: "LOCKED",
    }),
  handle: (r, state) => readScenario("governance.registry").handle(r, state),
});
