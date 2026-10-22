import type {components} from '../generated/api';
import type {Registration} from '../enterprise-onboarding';
import {registrationDefaults,type RegistrationDraft} from '../registration-form';
type S=components['schemas'];
/** Baseline v2 request assembly extracted with AST, without renderer/labels/styles. */
export function buildLedgerRegistration(draft:RegistrationDraft,registrationId:string,ownerProof:S['RegistrationOtpVerifiedView'],documentIds:string[]):Registration{
 if(!draft.declaration||!draft.termsAccepted||!draft.privacyAcknowledged)throw new Error('Cần xác nhận tính chính xác, điều khoản và quyền riêng tư');
 const producer=draft.activities.includes('FARM');
 return {
          requestId: registrationId,
          email: draft.email.trim(),
          fullName: draft.fullName.trim(),
          organizationName: draft.organizationName.trim(),
          businessId: draft.businessId.trim() || undefined,
          organizationType:
            draft.organizationType as Registration["organizationType"],
          participationModel:
            draft.participationModel as Registration["participationModel"],
          hostingMode: draft.hostingMode as Registration["hostingMode"],
          emailVerifications: [
            {
              verificationId: ownerProof.verificationId,
              token: ownerProof.token,
            },
          ],
          details: {
            formVersion: 2,
            legalForm:
              draft.legalForm as S["EnterpriseRegistrationDetails"]["legalForm"],
            address: draft.address.trim(),
            province: draft.province,
            provinceCode: draft.provinceCode,
            ward: draft.ward,
            wardCode: draft.wardCode,
            phone: draft.phone,
            contactEmail: draft.contactEmail.trim(),
            representative: draft.representative.trim(),
            representativeTitle: draft.representativeTitle.trim() || undefined,
            registrationNumber: draft.registrationNumber.trim() || undefined,
            establishedDate: draft.establishedDate || undefined,
            registrantRelationship: draft.registrantRelationship as
              "REPRESENTATIVE" | "AUTHORIZED",
            activities:
              draft.activities as S["EnterpriseRegistrationDetails"]["activities"],
            website: draft.website.trim() || undefined,
            description: draft.description.trim() || undefined,
            production: producer
              ? {
                  sector: "CROP",
                  productGroups: [
                    ...new Set(
                      draft.productGroups
                        .split(",")
                        .map((s) => s.trim())
                        .filter(Boolean),
                    ),
                  ],
                  growingAreaCode: draft.growingAreaCode.trim() || undefined,
                  packingFacilityCode:
                    draft.packingFacilityCode.trim() || undefined,
                  scaleEstimate: draft.scaleEstimate.trim() || undefined,
                  facilityCount: draft.facilityCount
                    ? Number(draft.facilityCount)
                    : undefined,
                  certifications:
                    draft.certifications as S["RegistrationProductionDetails"]["certifications"],
                }
              : undefined,
            processing: draft.activities.includes("PROCESSOR")
              ? {
                  processingTypes:
                    draft.processingTypes as S["RegistrationProcessingDetails"]["processingTypes"],
                  foodSafetyCertificateNumber:
                    draft.foodSafetyCertificateNumber.trim(),
                  foodSafetyCertificateExpiry: draft.foodSafetyCertificateExpiry,
                  facilityCode: draft.processingFacilityCode.trim() || undefined,
                  dailyCapacityKg: draft.dailyCapacityKg
                    ? Number(draft.dailyCapacityKg)
                    : undefined,
                  certifications:
                    draft.processingCertifications as S["RegistrationProcessingDetails"]["certifications"],
                }
              : undefined,
            services: {
              interests:
                draft.interests as S["RegistrationServicePreferences"]["interests"],
              planCode: (draft.planCode ||
                undefined) as S["RegistrationServicePreferences"]["planCode"],
              expectedProducts:
                draft.expectedProducts as S["RegistrationServicePreferences"]["expectedProducts"],
              expectedLotsPerMonth: draft.expectedLotsPerMonth
                ? Number(draft.expectedLotsPerMonth)
                : undefined,
              partnerIntent: draft.partnerIntent as "YES" | "LATER",
              integrationNotes: draft.integrationNotes.trim() || undefined,
            },
            documentIds,
            declarationAccepted: true,
            termsAccepted: true,
            privacyAcknowledged: true,
            marketingAccepted: draft.marketingAccepted,
          },
        };
}
function isDraft(value:Record<string,unknown>):value is RegistrationDraft{
 return Object.entries(registrationDefaults).every(([key,sample])=>Array.isArray(sample)?Array.isArray(value[key])&&value[key].every((item:unknown)=>typeof item==='string'):typeof value[key]===typeof sample);
}
/** Only the business draft is persistable; proofs, files, attempts and acknowledgements stay in memory. */
export function sanitizeLedgerRegistrationDraft(input:unknown):RegistrationDraft{
 const source=input&&typeof input==='object'&&!Array.isArray(input)?Object.fromEntries(Object.entries(input)):{};
 const clean:Record<string,unknown>={};
 for(const [key,sample]of Object.entries(registrationDefaults)){
  const candidate=source[key];
  clean[key]=Array.isArray(sample)?Array.isArray(candidate)&&candidate.every((item:unknown)=>typeof item==='string')?[...candidate]:[...sample]:typeof candidate===typeof sample?candidate:sample;
 }
 for(const key of ['declaration','termsAccepted','privacyAcknowledged','marketingAccepted'])clean[key]=false;
 if(!isDraft(clean))throw new Error('Invalid registration draft shape');
 return clean;
}
