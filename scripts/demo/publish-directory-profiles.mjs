/** Explicit publication snapshot for the owner-authorized local fruit dataset. */
import {seedContentId} from './seed-recovery.mjs';
export async function publishDirectoryProfiles(db) {
  const profiles=await db.enterpriseProfile.findMany({where:{organization:{status:'ACTIVE'}}});
  let count=0;
  for(const profile of profiles) {
    const logo=await db.traceEvidence.findFirst({where:{organizationId:profile.organizationId,entityType:'PROFILE',entityId:profile.organizationId,kind:'OTHER',fileName:{startsWith:'logo-'},withdrawal:null},orderBy:{createdAt:'desc'},select:{id:true}});
    if(!logo)continue;
    const presentation={publicDirectory:{published:true,catalogDetailsPublished:true,
      phone:profile.phone,address:profile.address,province:profile.province,ward:profile.ward,
      // Reserved test domains are not presented as real company websites.
      website:null,introduction:profile.description,logoEvidenceId:logo.id}};
    const id=seedContentId('directory-publication',profile.organizationId+JSON.stringify(presentation));
    await db.publicDirectoryPublication.upsert({where:{id},update:{},create:{id,organizationId:profile.organizationId,presentation}});
    count++;
  }
  return count;
}
