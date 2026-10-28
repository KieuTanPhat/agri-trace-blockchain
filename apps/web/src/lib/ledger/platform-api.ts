import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
import type { LedgerCommandContext } from "./command-context";
type S = components["schemas"];
export type PlatformUser = S["UserListDto"];
export type Amendment = S["ProfileAmendmentListItemDto"];
export type AmendmentDetail = S["ProfileAmendmentDetailDto"];
export type AuditEntry = S["PlatformAuditEntryDto"];
export type AuditVerify = S["PlatformAuditVerificationDto"];
export type DirectoryItem = {
  id: string;
  name: string;
  type: string;
  status: string;
  version: number;
  participationModel: string;
  capabilities: string[];
  pendingCapabilities: string[];
  enrollmentId: string | null;
  stage: string;
  planName: string | null;
  subscriptionStatus: string | null;
  endsAt: string | null;
  province: string | null;
  members: number;
  ownedChains: number;
  chainMemberships: number;
  createdAt: string;
};
export type Setting = {
  key: string;
  value: unknown;
  description: string | null;
  version: number;
  updatedAt: string;
  editable: boolean;
  hint: string | null;
};
function query(input: Record<string, string | number | undefined> = {}) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(input))
    if (v !== undefined && v !== "") p.set(k, String(v));
  return p.size ? "?" + p.toString() : "";
}
export type InboxKind =
  | "ENROLLMENT"
  | "CAPABILITY"
  | "AMENDMENT"
  | "CONNECTION"
  | "TICKET"
  | "CONSUMER_REPORT"
  | "CASE"
  | "INVOICE_OVERDUE";
export type InboxItem = {
  kind: InboxKind;
  id: string;
  title: string;
  organizationName: string | null;
  createdAt: string;
  dueAt: string | null;
  ageHours: number;
  overdue: boolean;
  href: string;
};
export type LedgerInbox = {
  items: InboxItem[];
  summary: Record<InboxKind | "total" | "overdue", number>;
};
export type LedgerDashboard = {
  generatedAt: string;
  organizations: {
    byType: Record<string, number>;
    byStatus: Record<string, number>;
    byModel: Record<string, number>;
    capabilities: Record<string, number>;
  };
  pending: LedgerInbox["summary"];
  billing: {
    active: number;
    grace: number;
    restricted: number;
    expiringSoon: {
      organizationId: string;
      organizationName: string;
      planName: string;
      endsAt: string | null;
    }[];
    monthRevenue: number;
    monthSimulated: number;
    outstanding: number;
  };
  traceability: {
    lots: number;
    processedLots: number;
    processingRuns30Days: number;
    scans7Days: number;
    blockedQr: number;
  };
  ledger: {
    outbox: Record<string, number>;
    proofs: Record<string, number>;
    unresolvedHolds: number;
    lastConfirmedAt: string | null;
  };
  security: {
    lockedAccounts: number;
    adminsWithoutMfa: number;
    admins: number;
  };
  recentActivity: {
    sequence: number;
    occurredAt: string;
    action: string;
    actorRole: string;
    subjectType: string;
    subjectId: string;
    organizationId: string | null;
    outcome: string;
    reason: string | null;
  }[];
  notices: {
    id: string;
    title: string;
    severity: string;
    audience: string;
    endsAt: string | null;
  }[];
};
export type PlatformStatistics = {
  months: {
    month: string;
    organizations: number;
    lots: number;
    processingRuns: number;
    scans: number;
    tickets: number;
    revenue: number;
  }[];
  totals: {
    organizations: number;
    users: number;
    chains: number;
    events: number;
  };
};
export type PlanVersion = {
  id: string;
  planCode: string;
  version: number;
  setupFee: number;
  annualFee: number;
  termMonths: number;
  limits: Record<string, number>;
  status: string;
  note: string | null;
  publishedAt: string | null;
  createdAt: string;
};
export type ServicePlan = {
  code: string;
  name: string;
  audience: string;
  description: string | null;
  status: string;
  sortOrder: number;
  versions: PlanVersion[];
};
export type Subscription = {
  id: string;
  organizationId: string;
  organizationName: string | null;
  planCode: string;
  planName: string;
  planVersion: PlanVersion;
  status: string;
  effectiveStatus: string;
  startsAt: string | null;
  endsAt: string | null;
  graceEndsAt: string | null;
  daysRemaining: number | null;
  cancelledAt: string | null;
  version: number;
};
export type Invoice = {
  id: string;
  number: string;
  organizationId: string;
  organizationName: string | null;
  subscriptionId: string | null;
  planVersionId: string | null;
  kind: string;
  lines: unknown;
  amount: number;
  currency: string;
  status: string;
  issuedAt: string;
  dueAt: string;
  paidAt: string | null;
  provider: string | null;
  providerReference: string | null;
  simulated: boolean;
  voidReason: string | null;
  overdue: boolean;
  version: number;
};
export type Enrollment = S["EnterpriseEnrollmentViewDto"];
export type CapabilityRequest = S["CapabilityRequestViewDto"];
export type EnterpriseConnection = S["EnterpriseConnectionViewDto"];
/** Aggregate fields supplied by AdminInsightsService.organization at the pinned baseline. */
export type PlatformOrganization = {
  id: string;
  name: string;
  type: string;
  status: "ACTIVE" | "INACTIVE";
  version: number;
  participationModel: string;
  createdAt: string;
  profile: S["EnterpriseProfileRecordDto"] | null;
  capabilities: {
    code: string;
    revokedAt: string | null;
    revision: number;
    createdAt: string;
  }[];
  capabilityRequests: CapabilityRequest[];
  enrollment: {
    id: string;
    status: string;
    stage: string;
    hostingMode: string;
    createdAt: string;
    connections: {
      id: string;
      chainId: string;
      status: string;
      createdAt: string;
    }[];
  } | null;
  billing: {
    applies: boolean;
    paying: boolean;
    status: string;
    limits: Record<string, number> | null;
    usage: Record<string, number>;
    subscription: Subscription | null;
    invoices: Invoice[];
  };
  chains: {
    owned: { id: string; name: string; code: string; state: string | null }[];
    memberships: {
      chainId: string;
      name: string;
      code: string;
      status: string;
    }[];
  };
  sites: { id: string; name: string; kind: string }[];
  members: {
    id: string;
    fullName: string;
    email: string;
    accountStatus: string;
    enterpriseTier: number | null;
    createdAt: string;
    role: string;
  }[];
  activity: { lots: number; processingRuns: number };
  cases: {
    id: string;
    caseNumber: number;
    title: string;
    severity: string;
    status: string;
  }[];
  tickets: { id: string; code: string; subject: string; status: string }[];
  audit: {
    sequence: number;
    action: string;
    reason: string | null;
    occurredAt: string;
  }[];
};
export type OrganizationDetail = PlatformOrganization;
function write<T>(
  path: string,
  payload: unknown,
  cmd: LedgerCommandContext,
  method = "POST",
) {
  return ledgerRequest<T>(path, {
    method,
    headers: {
      "Idempotency-Key": cmd.idempotencyKey,
      ...(cmd.mfaCode ? { "X-MFA-Code": cmd.mfaCode } : {}),
    },
    body: JSON.stringify(payload),
  });
}
export const api = {
  workbench: {
    dashboard: async () =>
      (
        await ledgerRequest<{ record: LedgerDashboard }>(
          "/platform-admin/dashboard",
        )
      ).record,
    inbox: async () =>
      (await ledgerRequest<{ record: LedgerInbox }>("/platform-admin/inbox"))
        .record,
  },
  ops: {
    statistics: async () =>
      (
        await ledgerRequest<{ record: PlatformStatistics }>(
          "/platform-admin/statistics",
        )
      ).record,
    adminSummary: () =>
      ledgerRequest<S["AdminSummaryDto"]>("/platform-operations/admin-summary"),
  },
  enterprises: {
    createOrganization: (
      input: S["CreateOrganizationDto"],
      cmd: LedgerCommandContext,
    ) => write<S["OrganizationRecordDto"]>("/organizations", input, cmd),
    scopedUsers: (id: string) =>
      ledgerRequest<S["ScopedUserDto"][]>(
        `/organizations/${encodeURIComponent(id)}/scoped-users`,
      ),
    organizations: () =>
      ledgerRequest<S["OrganizationRecordDto"][]>("/organizations"),
    directory: async (filters: Record<string, string | undefined>) =>
      (
        await ledgerRequest<{ items: DirectoryItem[] }>(
          "/platform-admin/organizations" + query(filters),
        )
      ).items,
    updateOrganization: (
      id: string,
      input: S["UpdateOrganizationDto"],
      cmd: LedgerCommandContext,
    ) => write(`/organizations/${encodeURIComponent(id)}`, input, cmd, "PATCH"),
    amendments: async () =>
      (
        await ledgerRequest<S["ProfileAmendmentListDto"]>(
          "/enterprise-profile-amendments",
        )
      ).items,
    amendment: async (id: string) =>
      (
        await ledgerRequest<S["ProfileAmendmentDetailRecordDto"]>(
          `/enterprise-profile-amendments/${encodeURIComponent(id)}`,
        )
      ).record,
    reviewAmendment: (
      id: string,
      input: {
        decision: "APPROVE" | "REJECT";
        reason: string;
        version: number;
      },
      cmd: LedgerCommandContext,
    ) =>
      write(
        `/enterprise-profile-amendments/${encodeURIComponent(id)}/review`,
        input,
        cmd,
      ),
    enrollments: () => ledgerRequest<Enrollment[]>("/enterprise-enrollments"),
    enrollment: (id: string) =>
      ledgerRequest<Enrollment>(
        `/enterprise-enrollments/${encodeURIComponent(id)}`,
      ),
    organization: async (id: string) =>
      (
        await ledgerRequest<{ record: PlatformOrganization }>(
          `/platform-admin/organizations/${encodeURIComponent(id)}`,
        )
      ).record,
    review: (
      id: string,
      input: S["ReviewEnterpriseDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<Enrollment>(
        `/enterprise-enrollments/${encodeURIComponent(id)}/review`,
        input,
        cmd,
      ),
    reviewCapability: (
      id: string,
      input: S["ReviewEnterpriseDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<CapabilityRequest>(
        `/capability-requests/${encodeURIComponent(id)}/review`,
        input,
        cmd,
      ),
    reviewConnection: (
      id: string,
      input: S["ReviewEnterpriseDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<EnterpriseConnection>(
        `/enterprise-connections/${encodeURIComponent(id)}/review`,
        input,
        cmd,
      ),
    activate: (
      id: string,
      input: S["ActivateEnterpriseDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<Enrollment>(
        `/enterprise-enrollments/${encodeURIComponent(id)}/activate`,
        input,
        cmd,
      ),
  },
  users: {
    list: () => ledgerRequest<PlatformUser[]>("/users"),
    roles: () => ledgerRequest<S["RoleRecordDto"][]>("/users/roles"),
    create: (input: S["CreateUserDto"], cmd: LedgerCommandContext) =>
      write<S["UserCreatedDto"]>("/users", input, cmd),
    setStatus: (
      id: string,
      input: S["UpdateUserStatusDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<S["UserStatusDto"]>(
        `/users/${encodeURIComponent(id)}/status`,
        input,
        cmd,
        "PATCH",
      ),
    unlock: (
      id: string,
      input: S["UnlockUserDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<S["UserStatusDto"]>(
        `/users/${encodeURIComponent(id)}/unlock`,
        input,
        cmd,
      ),
    resetPassword: (
      id: string,
      input: S["ResetUserPasswordDto"],
      cmd: LedgerCommandContext,
    ) => write(`/users/${encodeURIComponent(id)}/reset-password`, input, cmd),
    revokeSessions: (
      id: string,
      input: S["RevokeUserSessionsDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<S["UserSessionsRevokedDto"]>(
        `/users/${encodeURIComponent(id)}/revoke-sessions`,
        input,
        cmd,
      ),
  },
  audit: {
    actions: () => ledgerRequest<string[]>("/platform-audit/actions"),
    list: (filters: Record<string, string | number | undefined>) =>
      ledgerRequest<S["PlatformAuditPageDto"]>(
        "/platform-audit" + query(filters),
      ),
    verify: () => ledgerRequest<AuditVerify>("/platform-audit/verify"),
    exportCsv: (filters: Record<string, string | number | undefined>) =>
      ledgerRequest<S["PlatformAuditExportDto"]>(
        "/platform-audit/export" + query(filters),
      ),
  },
  billing: {
    plans: async () =>
      (await ledgerRequest<{ items: ServicePlan[] }>("/platform-billing/plans"))
        .items,
    renewal: (
      id: string,
      input: S["IssueRenewalInput"],
      cmd: LedgerCommandContext,
    ) =>
      write(
        `/platform-billing/organizations/${encodeURIComponent(id)}/renewal-invoices`,
        input,
        cmd,
      ),
  },
  governance: {
    settings: async () =>
      (await ledgerRequest<{ items: Setting[] }>("/platform-admin/settings"))
        .items,
    changeSetting: (
      key: string,
      input: Omit<S["SettingChangeInput"], "value"> & { value: unknown },
      cmd: LedgerCommandContext,
    ) =>
      write(`/platform-admin/settings/${encodeURIComponent(key)}`, input, cmd),
    assignments: () =>
      ledgerRequest<S["AssignmentListDto"][]>("/compliance/assignments"),
    catalog: () => ledgerRequest<S["CatalogDto"]>("/catalog"),
    grantAssignment: (
      input: S["GrantAssignmentDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<S["ComplianceAssignmentRecordDto"]>(
        "/compliance/assignments",
        input,
        cmd,
      ),
    revokeAssignment: (
      id: string,
      input: S["AssignmentReasonDto"],
      cmd: LedgerCommandContext,
    ) =>
      write<S["ComplianceAssignmentRecordDto"]>(
        `/compliance/assignments/${encodeURIComponent(id)}/revoke`,
        input,
        cmd,
      ),
  },
};
