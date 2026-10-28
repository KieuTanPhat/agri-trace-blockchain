import { ConflictException, ForbiddenException } from '@nestjs/common';
import { canonicalize } from 'json-canonicalize';
import type { Prisma, DistributionTransfer, DistributionLine, DistributionReturn } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { prepareSigningIntent, resolveSigningKey, consumeSigningIntent } from '../signing/signing-intents.js';
import type { DistributionC2Submit } from './dto.js';
type Transfer = DistributionTransfer & {lines:DistributionLine[]};
export function c2Payload(t:Transfer,actor:CommandActor,scope:string,phase:string,snapshot:unknown,line:{lotId:string;quantity:{toFixed:(n:number)=>string}|string;unit:string},r?:DistributionReturn) {
 const document = r ? {returnId:r.id,transferId:t.id,lines:r.lines,reason:r.reason,digest:r.digest,transferSnapshot:snapshot} : snapshot;
 return {transferRef:t.id,documentId:r?.id??t.id,phase,snapshot:canonicalize(document),snapshotDigest:canonicalSha256(document),lotId:line.lotId,quantity:typeof line.quantity==='string'?line.quantity:line.quantity.toFixed(3),unit:line.unit,signerOrganizationId:actor.organizationId!,signerUserId:actor.sub!,authorityScope:scope,documentVersion:String(r?.version??t.version),epoch:String(t.attestationEpoch)};
}
export async function prepareC2(tx:Prisma.TransactionClient,t:Transfer,actor:CommandActor,scope:string,phase:string,snapshot:unknown,keyRef?:string,r?:DistributionReturn) {
 const profile=await tx.chainLedgerProfile.findUniqueOrThrow({where:{chainId:t.chainId}});
 if(t.handoverMode!=='DUAL_SIGNED' || !profile.activeBindingDigest)throw new ConflictException('Giao nhận không có binding c2 hoạt động');
 const binding=await tx.fabricNetworkBinding.findUniqueOrThrow({where:{digest:profile.activeBindingDigest}});
 const key=await resolveSigningKey(tx,binding.digest,actor.organizationId!,keyRef);
 const lines=r?r.lines as {lotId:string;quantity:string;unit:string}[]:t.lines;
 const items=[];
 for(const line of [...lines].sort((a,b)=>a.lotId.localeCompare(b.lotId)))items.push(await prepareSigningIntent(tx,{chainId:t.chainId,chainRef:binding.chainRef,bindingDigest:binding.digest,organizationId:actor.organizationId!,userId:actor.sub!,key,operation:'DISTRIBUTION_ATTEST',entityType:'LOT',entityId:line.lotId,expectedVersion:r?.version??t.version,payload:c2Payload(t,actor,scope,phase,snapshot,line,r),windowMinutes:15}));
 return {items};
}
export async function consumeC2(tx:Prisma.TransactionClient,t:Transfer,actor:CommandActor,scope:string,input:DistributionC2Submit,snapshot:unknown,r?:DistributionReturn) {
 const lines=r?r.lines as {lotId:string;quantity:string;unit:string}[]:t.lines;
 if(t.handoverMode!=='DUAL_SIGNED' || input.signatures.length!==lines.length || new Set(input.signatures.map(s=>s.lotId)).size!==lines.length)throw new ConflictException('Phải ký đúng một intent c2 cho từng nguồn trong chặng');
 const profile=await tx.chainLedgerProfile.findUniqueOrThrow({where:{chainId:t.chainId}}),result=[];
 for(const line of [...lines].sort((a,b)=>a.lotId.localeCompare(b.lotId))) {
  const signature=input.signatures.find(s=>s.lotId===line.lotId);if(!signature)throw new ConflictException('Thiếu chữ ký lô nguồn');
  const intent=await consumeSigningIntent(tx,signature.intentId,actor,signature.signature);
  const payload=c2Payload(t,actor,scope,input.phase,snapshot,line,r);
  if(intent.operation!=='DISTRIBUTION_ATTEST'||intent.chainId!==t.chainId||intent.bindingDigest!==profile.activeBindingDigest||intent.entityType!=='LOT'||intent.entityId!==line.lotId||intent.expectedVersion!==(r?.version??t.version)||canonicalize(intent.payload)!==canonicalize(payload))throw new ForbiddenException('Intent khác nguồn, binding, phiên bản, quyền hoặc nội dung đang bàn giao');
  await tx.distributionSignedIntent.create({data:{documentId:r?.id??t.id,documentType:r?'RETURN':'TRANSFER',transferId:t.id,organizationId:actor.organizationId!,phase:input.phase,epoch:t.attestationEpoch,lotId:line.lotId,intentId:intent.id}});
  result.push({intent,lotId:line.lotId,payload});
 }
 if(new Set(result.map(r=>r.intent.keyRef)).size!==1)throw new ConflictException('Cùng bước bàn giao phải dùng một khóa tổ chức');
 return result;
}
