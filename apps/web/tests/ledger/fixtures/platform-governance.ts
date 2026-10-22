import type { components } from "../../../src/lib/generated/api";
import { actorSession } from "./actors";
import {
  registerScenario,
  type FixtureResponse,
  type CapturedRequest,
  type FixtureState,
} from "./scenarios";
type S = components["schemas"];
export const enrollmentId = "11111111-1111-4111-8111-111111111111";
export const pendingEnrollment: S["EnterpriseEnrollmentViewDto"] = {
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
export const ownProposal: S["PlatformApprovalDto"] = {
  id: enrollmentId,
  operation: "CAPABILITY_GRANT",
  organizationId: pendingEnrollment.organizationId,
  subjectId: pendingEnrollment.organizationId,
  subjectType: "ORGANIZATION",
  payload: { organizationId: pendingEnrollment.organizationId, code: "FARM" },
  payloadHash: "a".repeat(64),
  proposer: {
    id: proposer.id,
    email: proposer.email,
    fullName: proposer.fullName,
  },
  proposerReason: "Xác minh năng lực theo hồ sơ",
  status: "PENDING",
  effectiveStatus: "PENDING",
  version: 2,
  createdAt: "2026-10-22T00:00:00.000Z",
  expiresAt: "2099-10-22T00:00:00.000Z",
  decidedAt: null,
  decidedBy: null,
  decisionNote: null,
};
function governance(
  request: CapturedRequest,
  state: FixtureState,
): FixtureResponse | undefined {
  if (request.path === "/enterprise-enrollments" && request.method === "GET")
    return { data: [pendingEnrollment] };
  if (
    request.path === `/enterprise-enrollments/${enrollmentId}` &&
    request.method === "GET"
  )
    return { data: state.values.get("enrollment") ?? pendingEnrollment };
  if (
    request.path === `/platform-approvals/${enrollmentId}` &&
    request.method === "GET"
  )
    return { data: ownProposal };
  if (request.path === "/organizations" && request.method === "GET")
    return { data: [] };
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
      capabilityRequests: [
        { ...farmCapability, status: "APPROVED", version: 2 },
      ],
    });
    return { data: state.values.get("enrollment") };
  }
  return undefined;
}
registerScenario("governance.pending-enrollment", { handle: governance });
registerScenario("governance.own-proposal", { handle: governance });
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
