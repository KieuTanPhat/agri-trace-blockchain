import type { components } from "../../../src/lib/generated/api";
import { actorSession } from "./actors";
import { registerScenario } from "./scenarios";
type S = components["schemas"];
export const memberId = "11111111-1111-4111-8111-111111111111";
export const roleId = "22222222-2222-4222-8222-222222222222";
export const siteId = "33333333-3333-4333-8333-333333333333";
export const chainId = "44444444-4444-4444-8444-444444444444";
export const organizationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const owner = actorSession("org-owner")!.user.id;
const allPermissions: S["EnterpriseRoleInput"]["permissions"] = ["profile.read", "profile.manage", "members.read", "members.manage", "roles.manage", "sites.read", "catalog.read", "evidence.read", "evidence.manage", "production.read", "distribution.read", "reports.read"];
const role: S["EnterpriseRoleRecordDto"] = { id: roleId, name: "Nhân viên trong phạm vi", organizationId, permissions: ["profile.read", "production.read"], version: 2 };
const member: S["EnterpriseMemberDto"] = { id: memberId, fullName: "Nguyễn Thành Viên", email: "member@example.invalid", accountStatus: "ACTIVE", contactAddress: "Địa chỉ liên hệ ban đầu", enterpriseRevision: 7, enterpriseRoles: [], enterpriseTier: 3, jobTitle: "Nhân viên", memberCode: "NV0017", memberNote: null, phone: "0901234567", responsibleFarmId: null, supervisorId: owner, workSiteId: siteId };
const site: S["EnterpriseSiteRecordDto"] = { id: siteId, name: "Cơ sở trong phạm vi", organizationId, address: "Địa chỉ cơ sở", kind: "PRODUCTION", status: "ACTIVE", version: 1, areaM2: "100.00", capacityKg: null, coldAreaM2: null, email: null, evidenceComplete: true, expectedOutputTons: null, farmId: null, manager: null, otherInfo: null, phone: null, region: null, representative: null, staffUserId: null, ward: null };
const profile: S["EnterpriseProfileRecordDto"] = { organizationId, activities: ["FARM"], address: "PRIVATE_ORG_A_ADDRESS", contactEmail: "contact@example.invalid", declarationAcceptedAt: "2026-10-22T00:00:00.000Z", description: "Hồ sơ có hiệu lực", legalData: { businessId: "1234567890", registrationNumber: "REG-17", production: { sector: "CROP", productGroups: ["Rau"], certifications: [] } }, legalForm: "ENTERPRISE", phone: "0901234567", province: "Hồ Chí Minh", provinceCode: "79", registrationData: {}, representative: "Đại diện doanh nghiệp", version: 7, ward: "Phường", wardCode: "00001", website: null };
const overview: S["WorkspaceOverviewDto"] = { counts: { members: 1, sites: 1, products: 2, transfers: 0 }, member: { id: owner, primary: true, enrollmentOwner: true, tier: 1 }, organization: { id: organizationId, name: "DOANH_NGHIEP_A", businessId: "1234567890", capabilities: ["FARM"], code: "AGT-0017", participationModel: "SINGLE", status: "ACTIVE", type: "FARM" }, permissions: allPermissions, profile };
const evidence: S["TraceEvidenceRecordDto"] = { id: "55555555-5555-4555-8555-555555555555", entityId: organizationId, entityType: "PROFILE", description: "Hồ sơ riêng có kiểm soát", fileName: "private-license.pdf", kind: "BUSINESS_LICENSE", mediaType: "application/pdf", public: false, sha256: "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad", size: 3, siteId: null, supersedesId: null, createdAt: "2026-10-22T00:00:00.000Z" };
const amendment: S["ProfileAmendmentDto"] = { id: memberId, organizationId, creatorId: owner, createdAt: "2026-10-23T00:00:00.000Z", evidenceIds: [], organizationVersion: 1, profileVersion: 7, reason: "Đổi thông tin liên hệ đã đối chiếu", reviewedAt: null, reviewedBy: null, reviewNote: null, status: "PENDING", target: { activities: ["FARM"], address: profile.address, legalData: { businessId: "1234567890", production: null, registrationNumber: "REG-17", representativeTitle: null }, legalForm: profile.legalForm, name: "DOANH_NGHIEP_A", representative: profile.representative, province: "Hồ Chí Minh", ward: "Phường", provinceCode: "79", wardCode: "00001" }, version: 0 };
for (const name of ["membership.baseline", "membership.identity"]) registerScenario(name, { handle(request, state) {
  const url = new URL("http://fixture" + request.path), path = url.pathname;
  const isManager = state.actor === "org-manager";
  const permissions = state.actor === "org-staff" ? ["profile.read", "members.read"] : isManager ? allPermissions.filter(permission => permission !== "roles.manage") : allPermissions;
  if (request.method === "GET") {
    if (path === "/enterprise-access") return { data: { stage: "ACTIVE", owner: !isManager && state.actor !== "org-staff", primary: state.actor === "org-owner", tier: state.actor === "org-staff" ? 3 : isManager ? 2 : 1, capabilities: ["FARM"], permissions } };
    if (path === "/enterprise-workspace") {
      if (name === "membership.identity" && isManager && !state.values.has("force-refresh")) { state.values.set("force-refresh", true); return { status: 401, error: { code: "UNAUTHORIZED", message: "Session must refresh" } }; }
      return { delayMs: name === "membership.identity" && isManager ? 1500 : 0, data: { ...overview, permissions, member: { ...overview.member, id: state.session!.user.id, primary: state.actor === "org-owner", tier: isManager ? 2 : 1 }, organization: { ...overview.organization, name: isManager ? "DOANH_NGHIEP_B" : "DOANH_NGHIEP_A" }, profile: { ...profile, address: isManager ? "PRIVATE_ORG_B_ADDRESS" : profile.address } } };
    }
    if (path === "/enterprise-workspace/members") return { data: { items: [state.values.has("member-updated") ? { ...member, contactAddress: "Địa chỉ đã cập nhật", enterpriseRevision: 8 } : member] } };
    if (path === "/enterprise-workspace/roles") return { data: { items: [role] } };
    if (path === "/enterprise-workspace/role-templates") return { data: { items: [] } };
    if (path === "/enterprise-workspace/sites") return { data: { items: [site] } };
    if (path === "/catalog") return { data: { products: [], farms: [], plots: [] } satisfies S["CatalogDto"] };
    if (path === "/supply-chains") return { data: [{ id: chainId, name: "Chuỗi trong phạm vi" }] };
    if (path === "/enterprise-workspace/member-invitations" || path === "/enterprise-workspace/ownership-transfers") return { data: { items: [] } };
    if (path === "/enterprise-workspace/profile") return { data: { record: { organization: overview.organization, enrollment: { businessId: "1234567890", ownerId: owner, status: "ACTIVE" }, profile, amendments: state.values.has("amendment") ? [amendment] : [], history: [] } satisfies S["OwnProfileWorkspaceDto"] } };
    if (path === "/enterprise-workspace/evidence") return { data: { items: url.searchParams.get("entityType") === "PROFILE" ? [evidence] : [] } };
    if (path === `/enterprise-workspace/evidence/${evidence.id}/content`) return { status: 403, error: { code: "FORBIDDEN", message: "Không được tải nội dung chứng cứ này" } };
    if (path.startsWith("/enterprise-workspace/revisions/")) return { data: { items: [] } };
    if (path === "/reference-data/addresses") return { data: [{ code: "79", name: "Hồ Chí Minh", wards: [{ code: "00001", name: "Phường" }] }] satisfies S["AddressProvinceView"][] };
    if (path === "/enterprise-cases") return { data: { items: [] } };
    if (path === "/distribution/tasks") return { data: { counts: { transfers: 0, stock: 0, ownership: 0, total: 0 }, transfers: [], stock: [] } satisfies S["DistributionTasksDto"] };
  }
  if (request.method === "POST") {
    if (path === "/enterprise-workspace/members") return { data: { record: member } };
    if (path === `/enterprise-workspace/members/${memberId}`) { state.values.set("member-updated", true); return { data: { record: member } }; }
    if (path === "/enterprise-workspace/evidence") return { data: { record: { id: evidence.id } } };
    if (path === "/enterprise-workspace/profile/contact") { state.values.set("amendment", true); return { data: { record: amendment } }; }
  }
} });
