import type { components } from "../generated/api";
import { ledgerRequest } from "./request";
import type { LedgerCommandContext } from "./command-context";
import type * as V from "./workspace-types";
import { profileLegalData } from "./workspace-types";
type S = components["schemas"];
const record = async <T>(path: string) => (await ledgerRequest<{ record: T }>(path)).record;
const items = async <T>(path: string) => (await ledgerRequest<{ items: T[] }>(path)).items;
const post = <T = S["WorkspaceRecordDto"]>(path: string, body: unknown, cmd: LedgerCommandContext) => ledgerRequest<T>(path, { method: "POST", headers: { "Idempotency-Key": cmd.idempotencyKey }, body: JSON.stringify(body) });
const root = "/enterprise-workspace";
function nonEmptyRoles(roles: V.RoleGrant[]): [V.RoleGrant, ...V.RoleGrant[]] {
  const first = roles[0];
  if (!first || roles.length > 10) throw new Error("Chọn từ một đến mười nhóm quyền");
  return [first, ...roles.slice(1)];
}
// Nullable string DTO properties are incorrectly emitted as object/null in this baseline OpenAPI.
type MemberUpdate = Omit<S["EnterpriseMemberUpdate"], "phone" | "workSiteId" | "responsibleFarmId" | "contactAddress" | "memberNote"> & {
  phone?: string | null; workSiteId?: string | null; responsibleFarmId?: string | null; contactAddress?: string | null; memberNote?: string | null;
};
export const wapi = {
  overview: () => ledgerRequest<V.Overview>(root),
  access: () => ledgerRequest<S["EnterpriseAccessView"]>("/enterprise-access"),
  members: () => items<V.Member>(root + "/members"),
  roles: () => items<V.EnterpriseRole>(root + "/roles"),
  roleTemplates: () => items<S["EnterpriseRoleTemplateDto"]>(root + "/role-templates"),
  sites: () => items<V.Site>(root + "/sites"),
  chains: () => ledgerRequest<V.SupplyChain[]>("/supply-chains"),
  catalog: () => ledgerRequest<S["CatalogDto"]>("/catalog"),
  createMember: (input: Omit<S["EnterpriseMemberInput"], "roles"> & { roles: V.RoleGrant[] }, cmd: LedgerCommandContext) => post<{ record: Pick<V.Member, "id" | "email" | "memberCode"> }>(root + "/members", { ...input, roles: nonEmptyRoles(input.roles) }, cmd),
  updateMember: (id: string, input: MemberUpdate, cmd: LedgerCommandContext) => post(root + "/members/" + encodeURIComponent(id), input, cmd),
  changeSupervisor: (id: string, input: { version: number; supervisorId: string | null }, cmd: LedgerCommandContext) => post(root + "/members/" + encodeURIComponent(id) + "/supervisor", input, cmd),
  invitations: () => items<V.Invitation>(root + "/member-invitations"),
  invite: (input: Omit<S["MemberInvitationInput"], "roles"> & { roles: V.RoleGrant[] }, cmd: LedgerCommandContext) => post(root + "/member-invitations", { ...input, roles: nonEmptyRoles(input.roles) }, cmd),
  revokeInvitation: (id: string, cmd: LedgerCommandContext) => post(root + "/member-invitations/" + encodeURIComponent(id) + "/revoke", {}, cmd),
  saveRole: (id: string | null, input: S["EnterpriseRoleInput"], cmd: LedgerCommandContext) => post(root + "/roles" + (id ? "/" + encodeURIComponent(id) : ""), input, cmd),
  deleteRole: (id: string, input: { version: number }, cmd: LedgerCommandContext) => post(root + "/roles/" + encodeURIComponent(id) + "/delete", input, cmd),
  profile: async () => {
    const data = await record<S["OwnProfileWorkspaceDto"]>(root + "/profile");
    return { ...data, profile: data.profile ? { ...data.profile, legalData: profileLegalData.parse(data.profile.legalData) } : null };
  },
  addresses: () => ledgerRequest<V.AddressProvince[]>("/reference-data/addresses", undefined, false),
  requestContactChange: (input: Omit<S["ProfileContactInput"], "website"> & { website?: string }, cmd: LedgerCommandContext) => post(root + "/profile/contact", input, cmd),
  submitAmendment: (input: S["SubmitProfileInput"], cmd: LedgerCommandContext) => post(root + "/profile/amendments", input, cmd),
  withdrawAmendment: (id: string, input: S["ProfileVersionInput"], cmd: LedgerCommandContext) => post(root + "/profile/amendments/" + encodeURIComponent(id) + "/withdraw", input, cmd),
  evidence: (subject: { entityType: string; entityId: string; siteId?: string }) => items<V.Evidence>(root + "/evidence?" + new URLSearchParams(Object.entries(subject).filter(([, value]) => !!value))),
  evidenceContent: (id: string) => ledgerRequest<S["EvidenceContentDto"]>(root + "/evidence/" + encodeURIComponent(id) + "/content"),
  uploadEvidence: (input: { file: File; entityType: string; entityId: string; kind: string; description: string; supersedesId?: string }, cmd: LedgerCommandContext) => {
    const body = new FormData();
    body.set("file", input.file);
    for (const [key, value] of Object.entries(input)) if (key !== "file" && typeof value === "string" && value) body.set(key, value);
    return ledgerRequest<S["WorkspaceRecordDto"]>(root + "/evidence", { method: "POST", headers: { "Idempotency-Key": cmd.idempotencyKey }, body });
  },
  withdrawEvidence: (id: string, input: S["EvidenceWithdrawalInput"], cmd: LedgerCommandContext) => post(root + "/evidence/" + encodeURIComponent(id) + "/withdraw", input, cmd),
  revisions: (entityType: string, id: string) => items<V.Revision>(root + "/revisions/" + encodeURIComponent(entityType) + "/" + encodeURIComponent(id)),
  // The API returns the case list as a bare array, not an {items} page.
  cases: () => ledgerRequest<S["EnterpriseCaseDto"][]>("/enterprise-cases"),
  distributionTasks: () => ledgerRequest<S["DistributionTasksDto"]>("/distribution/tasks"),
};
