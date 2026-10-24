import type { components } from "../generated/api";
import { z } from "zod";
type S = components["schemas"];
export type Overview = S["WorkspaceOverviewDto"];
export type Member = S["EnterpriseMemberDto"];
export type EnterpriseRole = S["EnterpriseRoleRecordDto"];
export type RoleGrant = S["MemberRoleInput"];
export type Site = S["EnterpriseSiteRecordDto"];
export type SupplyChain = { id: string; name: string };
export type Invitation = S["EnterpriseMemberInvitationDto"];
export type Evidence = S["TraceEvidenceRecordDto"];
export type EvidenceEntity = S["EvidenceUploadDocumentation"]["entityType"];
export type Revision = S["EnterpriseRevisionDto"];
export const profileLegalData = z.object({
  businessId: z.string().nullish(), registrationNumber: z.string().nullish(), representativeTitle: z.string().nullish(),
  production: z.object({ sector: z.literal("CROP").optional(), productGroups: z.array(z.string()).default([]), certifications: z.array(z.string()).default([]), growingAreaCode: z.string().optional(), packingFacilityCode: z.string().optional(), scaleEstimate: z.string().optional(), facilityCount: z.number().optional() }).nullish(),
}).passthrough();
export type EnterpriseProfile = Omit<S["EnterpriseProfileRecordDto"], "legalData"> & { legalData: z.infer<typeof profileLegalData> };
export type ProfileAmendment = S["ProfileAmendmentDto"];
export type ProductionDetails = S["RegistrationProductionDetails"];
export type AddressProvince = S["AddressProvinceView"];
export type OwnershipTransfer = {
  id: string; organizationId: string; fromUserId: string; toUserId: string;
  from: { fullName: string; email: string } | null; to: { fullName: string; email: string } | null;
  status: string; expired: boolean; retainPreviousAdmin: boolean; reason: string;
  createdAt: string; expiresAt: string; resolvedAt: string | null; resolutionNote: string | null; version: number;
};
