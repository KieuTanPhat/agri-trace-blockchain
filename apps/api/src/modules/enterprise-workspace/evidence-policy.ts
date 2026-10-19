import { NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { enterpriseAuthority, enterpriseTransferWhere, profileAuthority, type EnterprisePermission } from './enterprise-policy.js';
export async function evidenceSubject(tx: Prisma.TransactionClient, actor: CommandActor, entityType: string, entityId: string, permission: EnterprisePermission, requestedSite?: string) {
 if(entityType==='PROFILE'){if(entityId!==actor.organizationId)throw new NotFoundException();await profileAuthority(tx,actor);return {};}
 const auth = await enterpriseAuthority(tx,actor,permission);
 let chainId: string | undefined, siteId: string | undefined, farmScopeId: string | undefined;
 const own = { id: entityId, organizationId: actor.organizationId! };
 if (entityType === 'PRODUCT') { if (!await tx.product.findFirst({where:own})) throw new NotFoundException(); }
 else if (entityType === 'CHAIN') {
   if (!await tx.supplyChain.findFirst({where:{id:entityId,ownerOrganizationId:actor.organizationId!}})) throw new NotFoundException();
   chainId=entityId;
 }
 else if (entityType === 'FARM') { if (!await tx.farm.findFirst({where:own})) throw new NotFoundException(); farmScopeId=entityId; }
 else if (entityType === 'MATERIAL') { if (!await tx.productionMaterial.findFirst({where:own})) throw new NotFoundException(); }
 else if (entityType === 'MEMBER') {
   await enterpriseAuthority(tx,actor,permission==='evidence.read'?'members.read':'members.manage');
   const member=await tx.user.findFirst({where:{id:entityId,organizationId:actor.organizationId!}});
   if(!member || (!auth.primary && member.supervisorId!==actor.sub)) throw new NotFoundException();
 }
 else if (entityType === 'EXTERNAL_PARTNER') { if (!await tx.enterpriseExternalPartner.findFirst({where:own})) throw new NotFoundException(); }
 else if (entityType === 'SITE') { if (!await tx.enterpriseSite.findFirst({where:own})) throw new NotFoundException(); siteId=entityId; }
 else if (entityType === 'CYCLE') {
   const cycle = await tx.productionCycle.findFirst({where:{id:entityId,farmOrgId:actor.organizationId!}}); if (!cycle) throw new NotFoundException(); chainId=cycle.chainId; farmScopeId=cycle.farmId;
 } else if (entityType === 'CYCLE_DRAFT') {
   // A linked cycle keeps its draft id, so draft photos stay readable (and old
   // uploads replayable) from the cycle. New uploads are refused in uploadEvidence.
   const draft = await tx.productionCycleDraft.findFirst({where:own,select:{farmId:true}});
   if (draft) farmScopeId = draft.farmId;
   else {
     const cycle = await tx.productionCycle.findFirst({where:{id:entityId,farmOrgId:actor.organizationId!}}); if (!cycle) throw new NotFoundException(); chainId=cycle.chainId; farmScopeId=cycle.farmId;
   }
 } else if (entityType === 'LOT') {
   const lot = await tx.lot.findUnique({where:{id:entityId},include:{harvest:{include:{cycle:true}}}}); if (!lot) throw new NotFoundException(); chainId=lot.harvest.cycle.chainId;
   if (requestedSite) {
     if (!await tx.lotSiteHolding.findFirst({where:{lotId:entityId,organizationId:actor.organizationId!,siteId:requestedSite}})) throw new NotFoundException(); siteId=requestedSite;
   } else if (lot.farmOrgId === actor.organizationId) farmScopeId=lot.harvest.cycle.farmId;
   else if (!auth.primary || !await tx.lotHolding.findUnique({where:{lotId_organizationId:{lotId:entityId,organizationId:actor.organizationId!}}})) throw new NotFoundException();
 } else if (entityType === 'TRANSFER') {
   const t = await tx.distributionTransfer.findFirst({where:{id:entityId,...enterpriseTransferWhere(actor,auth,permission)}}); if (!t) throw new NotFoundException(); chainId=t.chainId; siteId=(t.senderId===actor.organizationId?t.senderSiteId:t.carrierId===actor.organizationId?t.carrierSiteId:t.receiverSiteId)??undefined;
 } else if (entityType === 'SITE_TRANSFER') {
   const slip = await tx.siteTransfer.findFirst({where:own}); if (!slip) throw new NotFoundException();
   const lot = await tx.lot.findUnique({where:{id:slip.lotId},include:{harvest:{include:{cycle:true}}}}); chainId=lot?.harvest.cycle.chainId;
   siteId = requestedSite && [slip.fromSiteId,slip.toSiteId].includes(requestedSite) ? requestedSite : slip.fromSiteId;
 } else if (entityType === 'QUARANTINE') {
   const slip = await tx.quarantineCase.findFirst({where:own}); if (!slip) throw new NotFoundException();
   const lot = await tx.lot.findUnique({where:{id:slip.lotId},include:{harvest:{include:{cycle:true}}}}); chainId=lot?.harvest.cycle.chainId; siteId=slip.siteId;
 } else throw new UnprocessableEntityException('Loại chứng cứ không được hỗ trợ');
 await enterpriseAuthority(tx,actor,permission,entityType==='CHAIN'?undefined:chainId,farmScopeId ?? siteId);
 return {chainId,siteId};
}
