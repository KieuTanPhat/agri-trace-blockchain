import { request } from './api-client';
import { canonicalJson, distributionKeyStore } from './distribution-signer';
import { signPreparedIntent } from './signing/signer';
import { sha256Hex, type PreparedIntent } from './signing/canonical';
import type { Row } from './workspace';
function fixed(value:unknown){const text=String(value);if(!/^\d+(\.\d{1,3})?$/.test(text))throw new Error('Lượng bàn giao không hợp lệ');const [integer,fraction='']=text.split('.');return BigInt(integer).toString()+'.'+fraction.padEnd(3,'0');}
function snapshot(t:Row){return {id:t.id,chainId:t.chainId,senderId:t.senderId,carrierId:t.carrierId,receiverId:t.receiverId,origin:t.origin,destination:t.destination,vehicleId:t.vehicleId??null,...(t.plannedPickupAt?{plannedPickupAt:t.plannedPickupAt,plannedDeliveryAt:t.plannedDeliveryAt??null,note:t.note??null}:{}),...(t.handoverMode==='DUAL_SIGNED'?{handoverMode:t.handoverMode}:{}),...(t.attestationEpoch?{attestationEpoch:t.attestationEpoch}:{}),...(t.receiptDigest?{receiptDigest:t.receiptDigest}:{}),...(t.senderSiteId||t.carrierSiteId||t.receiverSiteId?{senderSiteId:t.senderSiteId??null,carrierSiteId:t.carrierSiteId??null,receiverSiteId:t.receiverSiteId??null}:{}),lines:(t.lines as Row[]).map(l=>({lotId:l.lotId,quantity:fixed(l.quantity),unit:l.unit})).sort((a,b)=>String(a.lotId).localeCompare(String(b.lotId)))};}
export async function signDistributionC2(t:Row,phase:string,user:{id:string;organizationId:string},r?:Row,resumePreparation?:()=>Promise<{items:PreparedIntent[]}>){
 const context=await request<{chainRef:string;bindingDigest:string;keys:Row[]}>(`/supply-chains/${t.chainId}/signing-keys`),local=await distributionKeyStore.list(String(t.chainId),user.organizationId);
 const key=local.find(k=>context.keys.some(a=>a.keyRef===k.id&&a.status==='ACTIVE'));
 if(!key)throw new Error('Thiết bị chưa có khóa c2 đã được ledger kích hoạt trên chuỗi. Mở quản lý chuỗi để đăng ký hoặc phục hồi thiết bị ký.');
 const prepared=resumePreparation?await resumePreparation():await request<{items:PreparedIntent[]}>(`/distribution/transfers/${t.id}/c2/prepare`,{method:'POST',body:JSON.stringify({phase,version:r?.version??t.version,keyRef:key.id,...(r?{returnId:r.id}:{})})});
 const document=r?{returnId:r.id,transferId:t.id,lines:r.lines,reason:r.reason,digest:r.digest,transferSnapshot:snapshot(t)}:snapshot(t),canonical=canonicalJson(document),digest=await sha256Hex(new TextEncoder().encode(canonical));
 const lines=(r?.lines??t.lines) as Row[],seen=new Set<string>(),signatures=[];
 if(prepared.items.length!==lines.length)throw new Error('Số intent không khớp từng nguồn đang hiển thị');
 for(const p of prepared.items){const line=lines.find(l=>l.lotId===p.payload.lotId);if(!line||seen.has(p.payload.lotId)||p.operation!=='DISTRIBUTION_ATTEST'||p.payload.snapshot!==canonical||p.payload.snapshotDigest!==digest||p.payload.quantity!==fixed(line.quantity)||p.payload.unit!==line.unit||p.payload.phase!==phase||p.payload.documentId!==String(r?.id??t.id)||p.payload.signerUserId!==user.id||p.payload.documentVersion!==String(r?.version??t.version))throw new Error('Nội dung c2 khác lô, lượng, biên bản hoặc bên ký đang hiển thị');
  seen.add(p.payload.lotId);signatures.push({lotId:p.payload.lotId,intentId:p.intentId,signature:await signPreparedIntent(distributionKeyStore,p,{chainId:String(t.chainId),organizationId:user.organizationId,chainRef:context.chainRef,bindingDigest:context.bindingDigest,entityType:'LOT',entityId:p.payload.lotId,operation:'DISTRIBUTION_ATTEST',keyRef:key.id})});
 }
 return {phase,version:r?.version??t.version,...(r?{returnId:r.id}:{}),signatures};
}
