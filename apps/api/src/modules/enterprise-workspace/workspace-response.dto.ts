import { ApiProperty } from '@nestjs/swagger';
import * as Enums from '../../generated/prisma/enums.js';
import { RegistrationProductionDetails } from '../enterprise-onboarding/registration-profile.dto.js';

// JSON projections returned by enterprise workspace reads. Field sets mirror the
// Prisma selects in the services; Date values serialize as ISO date-time strings.

const jsonObject = { type: 'object', additionalProperties: true } as const;

export class EnterpriseProfileRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String }) legalForm!: string;
  @ApiProperty({ type: String }) address!: string;
  @ApiProperty({ type: String }) province!: string;
  @ApiProperty({ type: String, nullable: true }) provinceCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) wardCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) ward!: string | null;
  @ApiProperty({ type: String }) phone!: string;
  @ApiProperty({ type: String }) contactEmail!: string;
  @ApiProperty({ type: String }) representative!: string;
  @ApiProperty({ type: [String] }) activities!: string[];
  @ApiProperty({ type: String, nullable: true }) website!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: String, format: 'date-time' })
  declarationAcceptedAt!: string;
  @ApiProperty(jsonObject) legalData!: Record<string, unknown>;
  @ApiProperty(jsonObject) registrationData!: Record<string, unknown>;
  @ApiProperty({ type: Number }) version!: number;
}

export class WorkspaceOrganizationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, description: 'AGT organization code' })
  code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: Enums.OrganizationType }) type!: Enums.OrganizationType;
  @ApiProperty({ enum: Enums.OrganizationStatus })
  status!: Enums.OrganizationStatus;
  @ApiProperty({ enum: Enums.OrganizationType, isArray: true })
  capabilities!: Enums.OrganizationType[];
  @ApiProperty({ type: String, required: false, description: 'SINGLE or SUPPLY_CHAIN_ENTERPRISE' })
  participationModel?: string;
  @ApiProperty({ type: String, nullable: true, required: false, description: 'Tax identifier from registration' })
  businessId?: string | null;
  @ApiProperty({ type: String, nullable: true, required: false })
  hostingMode?: string | null;
}
export class WorkspaceMemberSummaryDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: Number }) tier!: number;
  @ApiProperty({ type: Boolean }) primary!: boolean;
  @ApiProperty({ type: Boolean }) enrollmentOwner!: boolean;
}
export class WorkspaceCountsDto {
  @ApiProperty({ type: Number }) members!: number;
  @ApiProperty({ type: Number }) sites!: number;
  @ApiProperty({ type: Number }) products!: number;
  @ApiProperty({ type: Number }) transfers!: number;
}
export class WorkspaceOverviewDto {
  @ApiProperty({ type: WorkspaceOrganizationDto })
  organization!: WorkspaceOrganizationDto;
  @ApiProperty({ type: EnterpriseProfileRecordDto, nullable: true })
  profile!: EnterpriseProfileRecordDto | null;
  @ApiProperty({ type: WorkspaceMemberSummaryDto })
  member!: WorkspaceMemberSummaryDto;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({ type: WorkspaceCountsDto }) counts!: WorkspaceCountsDto;
}

export class EnterpriseRoleRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: [String] }) permissions!: string[];
  @ApiProperty({ type: Number }) version!: number;
}
export class EnterpriseRoleListDto {
  @ApiProperty({ type: [EnterpriseRoleRecordDto] })
  items!: EnterpriseRoleRecordDto[];
}
export class EnterpriseRoleTemplateDto {
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: Enums.OrganizationType })
  capability!: Enums.OrganizationType;
  @ApiProperty({ type: [String] }) permissions!: string[];
}
export class EnterpriseRoleTemplateListDto {
  @ApiProperty({ type: [EnterpriseRoleTemplateDto] })
  items!: EnterpriseRoleTemplateDto[];
}

export class EnterpriseMemberRoleDto {
  @ApiProperty({ type: String, format: 'uuid' }) userId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) roleId!: string;
  @ApiProperty({ type: [String], format: 'uuid' }) chainIds!: string[];
  @ApiProperty({ type: [String], format: 'uuid' }) siteIds!: string[];
  @ApiProperty({ type: EnterpriseRoleRecordDto }) role!: EnterpriseRoleRecordDto;
}
export class EnterpriseMemberDto {
  @ApiProperty({ type: String, nullable: true, description: 'Internal code, e.g. NV0001' })
  memberCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) jobTitle!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) workSiteId!: string | null;
  @ApiProperty({ type: String, nullable: true, format: 'uuid' }) responsibleFarmId!: string | null;
  @ApiProperty({ type: String, nullable: true }) contactAddress!: string | null;
  @ApiProperty({ type: String, nullable: true }) memberNote!: string | null;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) fullName!: string;
  @ApiProperty({ type: String }) email!: string;
  @ApiProperty({ type: Number, nullable: true }) enterpriseTier!: number | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  supervisorId!: string | null;
  @ApiProperty({ type: Number }) enterpriseRevision!: number;
  @ApiProperty({ enum: Enums.AccountStatus })
  accountStatus!: Enums.AccountStatus;
  @ApiProperty({ type: [EnterpriseMemberRoleDto] })
  enterpriseRoles!: EnterpriseMemberRoleDto[];
}
export class EnterpriseMemberListDto {
  @ApiProperty({ type: [EnterpriseMemberDto] }) items!: EnterpriseMemberDto[];
}

export class EnterpriseMemberInvitationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, nullable: true }) memberCode!: string | null;
  @ApiProperty({ type: String }) email!: string;
  @ApiProperty({ type: String }) fullName!: string;
  @ApiProperty({ type: Number }) tier!: number;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
export class EnterpriseMemberInvitationListDto {
  @ApiProperty({ type: [EnterpriseMemberInvitationDto] })
  items!: EnterpriseMemberInvitationDto[];
}

export class PartnerOrganizationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ enum: Enums.OrganizationType }) type!: Enums.OrganizationType;
  @ApiProperty({ type: String, description: 'AGT organization code' })
  code!: string;
}
export class EnterprisePartnerDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) inviterId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) inviteeId!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: PartnerOrganizationDto, required: false })
  inviter?: PartnerOrganizationDto;
  @ApiProperty({ type: PartnerOrganizationDto, required: false })
  invitee?: PartnerOrganizationDto;
}
export class EnterprisePartnerListDto {
  @ApiProperty({ type: [EnterprisePartnerDto] }) items!: EnterprisePartnerDto[];
}

export class ExternalPartnerRecordDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty() name!: string;
  @ApiProperty({ enum: ['FARM','TRANSPORTER','DISTRIBUTOR','RETAILER'] }) kind!: string;
  @ApiProperty() address!: string;
  @ApiProperty({ nullable: true }) phone!: string | null;
  @ApiProperty({ nullable: true }) email!: string | null;
  @ApiProperty({ nullable: true }) taxCode!: string | null;
  @ApiProperty({ nullable: true }) representative!: string | null;
  @ApiProperty({ nullable: true }) note!: string | null;
  @ApiProperty() version!: number;
  @ApiProperty({ format: 'date-time' }) createdAt!: string;
}
export class ExternalPartnerListDto {
  @ApiProperty({ type: [ExternalPartnerRecordDto] }) items!: ExternalPartnerRecordDto[];
}
export class PartnerSearchItemDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() businessId!: string;
  @ApiProperty() name!: string;
  @ApiProperty() kind!: string;
  @ApiProperty() registered!: boolean;
  @ApiProperty({ type: String, nullable: true, description: 'Tax identifier' })
  taxCode!: string | null;
  @ApiProperty({ type: String, nullable: true, description: 'AGT code; null for partners outside AgriTrace' })
  agriTraceCode!: string | null;
  @ApiProperty({ enum: ['TAX', 'NAME', 'CODE'], description: 'Which group the query matched' })
  matched!: 'TAX' | 'NAME' | 'CODE';
}
/** Business profile of an approved AgriTrace enterprise, shown before inviting. */
export class PartnerDirectoryProfileDto {
  @ApiProperty({ format: 'uuid' }) organizationId!: string;
  @ApiProperty() agriTraceCode!: string;
  @ApiProperty() name!: string;
  @ApiProperty() kind!: string;
  @ApiProperty({ type: String, nullable: true }) taxCode!: string | null;
  @ApiProperty({ type: [String], description: 'Approved capabilities' }) capabilities!: string[];
  @ApiProperty({ type: String, nullable: true }) legalForm!: string | null;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ type: String, nullable: true }) ward!: string | null;
  @ApiProperty({ type: String, nullable: true }) province!: string | null;
  @ApiProperty({ type: String, nullable: true }) representative!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) contactEmail!: string | null;
  @ApiProperty({ type: String, nullable: true }) website!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty({ type: [String] }) activities!: string[];
  @ApiProperty({ type: String, nullable: true, enum: ['INVITED', 'ACTIVE', 'REJECTED', 'REVOKED'], description: 'Existing link with the viewer, if any' })
  linkStatus!: string | null;
  @ApiProperty({ type: String, nullable: true, enum: ['SENT', 'RECEIVED'] }) linkDirection!: string | null;
}
export class PartnerSearchListDto {
  @ApiProperty({ type: [PartnerSearchItemDto] }) items!: PartnerSearchItemDto[];
}

export class EnterpriseSiteRecordDto {
  @ApiProperty({ type: String, nullable: true }) region!: string | null;
  @ApiProperty({ type: String, nullable: true }) ward!: string | null;
  @ApiProperty({ type: String, nullable: true }) areaM2!: string | null;
  @ApiProperty({ type: String, nullable: true }) coldAreaM2!: string | null;
  @ApiProperty({ type: String, nullable: true }) capacityKg!: string | null;
  @ApiProperty({ type: String, nullable: true }) expectedOutputTons!: string | null;
  @ApiProperty({ type: String, nullable: true }) manager!: string | null;
  @ApiProperty({ type: String, nullable: true }) representative!: string | null;
  @ApiProperty({ type: String, nullable: true }) phone!: string | null;
  @ApiProperty({ type: String, nullable: true }) email!: string | null;
  @ApiProperty({ type: String, nullable: true }) otherInfo!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true }) staffUserId!: string | null;
  @ApiProperty() evidenceComplete!: boolean;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  farmId!: string | null;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) kind!: string;
  @ApiProperty({ type: String }) address!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: Number }) version!: number;
}
export class EnterpriseSiteListDto {
  @ApiProperty({ type: [EnterpriseSiteRecordDto] })
  items!: EnterpriseSiteRecordDto[];
}
export class EnterpriseVehicleRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String }) registration!: string;
  @ApiProperty({ type: String }) kind!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: Number }) version!: number;
}
export class EnterpriseVehicleListDto {
  @ApiProperty({ type: [EnterpriseVehicleRecordDto] })
  items!: EnterpriseVehicleRecordDto[];
}

export class ProductionMaterialRecordDto {
  @ApiProperty({ type: String, nullable: true }) seedType!: string | null;
  @ApiProperty({ type: String, nullable: true }) price!: string | null;
  @ApiProperty({ type: String, nullable: true }) origin!: string | null;
  @ApiProperty({ type: String, nullable: true }) manufacturer!: string | null;
  @ApiProperty({ type: String, nullable: true }) description!: string | null;
  @ApiProperty() evidenceComplete!: boolean;
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String }) code!: string;
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) kind!: string;
  @ApiProperty({ type: String, nullable: true }) supplier!: string | null;
  @ApiProperty({ type: String, nullable: true }) batchCode!: string | null;
  @ApiProperty({ type: String, nullable: true })
  activeIngredient!: string | null;
  @ApiProperty({ type: String }) unit!: string;
  @ApiProperty({ type: Number, nullable: true }) withdrawalDays!: number | null;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  expiryDate!: string | null;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: Number }) version!: number;
}
export class ProductionMaterialListDto {
  @ApiProperty({ type: [ProductionMaterialRecordDto] })
  items!: ProductionMaterialRecordDto[];
}

export class EnterpriseRevisionDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String }) entityType!: string;
  @ApiProperty({ type: String, format: 'uuid' }) entityId!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ ...jsonObject, description: 'Record before the revision' })
  snapshot!: Record<string, unknown>;
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String, format: 'uuid' }) actorId!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
export class EnterpriseRevisionListDto {
  @ApiProperty({ type: [EnterpriseRevisionDto] })
  items!: EnterpriseRevisionDto[];
}

export class TraceEvidenceRecordDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) entityType!: string;
  @ApiProperty({ type: String, format: 'uuid' }) entityId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  siteId!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  supersedesId!: string | null;
  @ApiProperty({ type: String }) fileName!: string;
  @ApiProperty({ type: String }) mediaType!: string;
  @ApiProperty({ type: Number }) size!: number;
  @ApiProperty({ type: String }) sha256!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: String }) kind!: string;
  @ApiProperty({ type: Boolean }) public!: boolean;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
export class TraceEvidenceListDto {
  @ApiProperty({ type: [TraceEvidenceRecordDto] })
  items!: TraceEvidenceRecordDto[];
}

export class ProfileAmendmentLegalDataDto {
  @ApiProperty({ type: String, nullable: true }) businessId!: string | null;
  @ApiProperty({ type: String, nullable: true })
  registrationNumber!: string | null;
  @ApiProperty({ type: String, nullable: true })
  representativeTitle!: string | null;
  @ApiProperty({ type: RegistrationProductionDetails, nullable: true })
  production!: RegistrationProductionDetails | null;
}
/** Immutable requested profile snapshot written by submit(). */
export class ProfileAmendmentTargetDto {
  @ApiProperty({ type: String }) name!: string;
  @ApiProperty({ type: String }) legalForm!: string;
  @ApiProperty({ type: String }) address!: string;
  @ApiProperty({ type: String }) province!: string;
  @ApiProperty({ type: String }) provinceCode!: string;
  @ApiProperty({ type: String }) ward!: string;
  @ApiProperty({ type: String }) wardCode!: string;
  @ApiProperty({ type: String }) representative!: string;
  @ApiProperty({ type: [String] }) activities!: string[];
  @ApiProperty({ type: ProfileAmendmentLegalDataDto })
  legalData!: ProfileAmendmentLegalDataDto;
}
export class ProfileAmendmentDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) organizationId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) creatorId!: string;
  @ApiProperty({ type: Number }) profileVersion!: number;
  @ApiProperty({ type: Number }) organizationVersion!: number;
  @ApiProperty({ type: ProfileAmendmentTargetDto })
  target!: ProfileAmendmentTargetDto;
  @ApiProperty({ type: [String], format: 'uuid' }) evidenceIds!: string[];
  @ApiProperty({ type: String }) reason!: string;
  @ApiProperty({ type: String }) status!: string;
  @ApiProperty({ type: Number }) version!: number;
  @ApiProperty({ type: String, nullable: true }) reviewNote!: string | null;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  reviewedBy!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  reviewedAt!: string | null;
}
export class ProfileAmendmentListItemDto extends ProfileAmendmentDto {
  @ApiProperty({ type: String, nullable: true })
  organizationName!: string | null;
}
export class ProfileAmendmentListDto {
  @ApiProperty({ type: [ProfileAmendmentListItemDto] })
  items!: ProfileAmendmentListItemDto[];
}

class NamedOrganizationDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) name!: string;
}
class VersionedOrganizationDto extends NamedOrganizationDto {
  @ApiProperty({ type: Number }) version!: number;
}
class ProfileEnrollmentDto {
  @ApiProperty({ type: String, nullable: true }) businessId!: string | null;
  @ApiProperty({ type: String }) status!: string;
}
class OwnProfileEnrollmentDto extends ProfileEnrollmentDto {
  @ApiProperty({ type: String, format: 'uuid' }) ownerId!: string;
}
export class OwnProfileWorkspaceDto {
  @ApiProperty({ type: NamedOrganizationDto })
  organization!: NamedOrganizationDto;
  @ApiProperty({ type: EnterpriseProfileRecordDto, nullable: true })
  profile!: EnterpriseProfileRecordDto | null;
  @ApiProperty({ type: OwnProfileEnrollmentDto, nullable: true })
  enrollment!: OwnProfileEnrollmentDto | null;
  @ApiProperty({ type: [EnterpriseRevisionDto] })
  history!: EnterpriseRevisionDto[];
  @ApiProperty({ type: [ProfileAmendmentDto] })
  amendments!: ProfileAmendmentDto[];
}
export class OwnProfileWorkspaceRecordDto {
  @ApiProperty({ type: OwnProfileWorkspaceDto }) record!: OwnProfileWorkspaceDto;
}
export class ProfileAmendmentEvidenceDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String }) fileName!: string;
  @ApiProperty({ type: String }) mediaType!: string;
  @ApiProperty({ type: Number }) size!: number;
  @ApiProperty({ type: String }) sha256!: string;
  @ApiProperty({ type: String }) description!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}
export class ProfileAmendmentDetailDto {
  @ApiProperty({ type: ProfileAmendmentDto }) amendment!: ProfileAmendmentDto;
  @ApiProperty({ type: VersionedOrganizationDto })
  organization!: VersionedOrganizationDto;
  @ApiProperty({ type: EnterpriseProfileRecordDto, nullable: true })
  profile!: EnterpriseProfileRecordDto | null;
  @ApiProperty({ type: ProfileEnrollmentDto, nullable: true })
  enrollment!: ProfileEnrollmentDto | null;
  @ApiProperty({ type: [ProfileAmendmentEvidenceDto] })
  evidence!: ProfileAmendmentEvidenceDto[];
  @ApiProperty({
    type: Boolean,
    description: 'Effective profile or organization changed since submission',
  })
  stale!: boolean;
}
export class ProfileAmendmentDetailRecordDto {
  @ApiProperty({ type: ProfileAmendmentDetailDto })
  record!: ProfileAmendmentDetailDto;
}
export class ProfileEvidenceContentDto {
  @ApiProperty({ type: String }) fileName!: string;
  @ApiProperty({ type: String }) mediaType!: string;
  @ApiProperty({ type: String }) sha256!: string;
  @ApiProperty({ type: String, format: 'byte' }) contentBase64!: string;
}
export class ProfileEvidenceContentRecordDto {
  @ApiProperty({ type: ProfileEvidenceContentDto })
  record!: ProfileEvidenceContentDto;
}
