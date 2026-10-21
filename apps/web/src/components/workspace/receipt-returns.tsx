"use client";
import { useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth-store';
import { request } from '@/lib/api-client';
import { distributionKeyStore, signDistributionReturn } from '@/lib/distribution-signer';
import { useWorkspaceCommand, textValue, errorMessage, type Row } from '@/lib/workspace';
import { EvidencePanel } from './evidence-panel';
import { signDistributionC2 } from '@/lib/distribution-c2';
import { CommandState } from "@/components/manage";
export function ReceiptAndReturns({ transfer: t, reload }: { transfer: Row; reload: () => void }) {
 const cmd = useWorkspaceCommand(), auth = useAuth(), [error,setError] = useState(''), [signing,setSigning] = useState(false);
 const lines = t.lines as Row[], actions = t.allowedActions as string[];
 const receipt = t.receipt as Row | null, remainders = (t.remainders ?? []) as Row[], returns = (t.returns ?? []) as Row[];
 async function receiptSubmit(e: FormEvent<HTMLFormElement>) {
   e.preventDefault(); const form = new FormData(e.currentTarget);
   if (await cmd.run(`/distribution/transfers/${t.id}/receipt`, { version: t.version, reason: form.get('reason'), lines: lines.map(l => ({ lotId: l.lotId, received: String(form.get(`received-${l.lotId}`)), rejected: String(form.get(`rejected-${l.lotId}`)), quarantined: String(form.get(`quarantined-${l.lotId}`)) })) })) reload();
 }
 async function returnSubmit(e: FormEvent<HTMLFormElement>) {
   e.preventDefault(); const form = new FormData(e.currentTarget);
   const selected = remainders.filter(l => Number(form.get(`return-${l.lotId}`)) > 0).map(l => ({ lotId: l.lotId, quantity: String(form.get(`return-${l.lotId}`)), unit: lines.find(x => x.lotId === l.lotId)?.unit }));
   if (!selected.length) { setError('Nhập ít nhất một lượng trả lớn hơn 0'); return; }
   if (await cmd.run(`/distribution/transfers/${t.id}/returns`,{ version: t.version, lines: selected, reason: form.get('reason') })) reload();
 }
 async function signReturn(r: Row) {
   if (!auth.user?.organizationId) return; setSigning(true); setError('');
   try {
     if(t.handoverMode==='DUAL_SIGNED') {
       const body=cmd.frozen?{}:await signDistributionC2(t,'RETURN',{id:auth.user.id,organizationId:auth.user.organizationId},r);
       if(await cmd.run(`/distribution/transfers/${t.id}/c2/submit`,body))reload();return;
     }
     const keys = await distributionKeyStore.list('distribution',auth.user.organizationId), active = await request<{items: Row[]}>('/distribution/keys');
     const key = keys.find(k => active.items.some(a => a.id === k.id && a.status === 'ACTIVE'));
     if (!key) throw new Error('Mở Khóa ký bàn giao để đăng ký khóa trên thiết bị');
     const expiresAt = new Date(Date.now()+15*60_000).toISOString();
     const body = { returnId: String(r.id), transferId: String(t.id), digest: String(r.digest), organizationId: auth.user.organizationId, userId: auth.user.id, keyRef: key.id, version: String(r.version), expiresAt };
     const signature = await signDistributionReturn({ transferId: r.transferId, lines: r.lines, reason: r.reason, digest: r.digest },body);
     if (await cmd.run(`/distribution/transfers/${t.id}/returns/${r.id}/sign`,{ version: r.version, keyRef: key.id, expiresAt, signature })) reload();
   } catch (e) { setError(errorMessage(e)); } finally { setSigning(false); }
 }
 return <section className="panel"><h2>Thực nhận và đối soát</h2><CommandState command={cmd} />{error && <p className="notice error" role="alert">{error}</p>}
 <p>Phần chưa nhận vẫn thuộc trách nhiệm vận chuyển. Chữ ký tiếp nhận không tự xác nhận phần thiếu đã hỏng. Hàng có thu hồi hoặc hết hạn được tiếp nhận vào cách ly.</p>
 {receipt && <><p>{textValue(receipt.reason)}</p><ul>{(receipt.lines as Row[]).map(l => <li key={String(l.lotId)}>{textValue(lines.find(x => x.lotId === l.lotId)?.lotCode)}: thực nhận {textValue(l.received)}, từ chối {textValue(l.rejected)}, chưa xác định {textValue(l.missing)}, cách ly {textValue(l.quarantined)}</li>)}</ul></>}
 {actions.includes('ACTUAL_RECEIPT') && <form onSubmit={receiptSubmit} className="workspace-form"><fieldset disabled={cmd.pending || cmd.frozen} className="enterprise-fields">{lines.map(l => <div key={String(l.lotId)} className="panel"><h3>{textValue(l.lotCode)} · dự kiến {textValue(l.quantity)} {textValue(l.unit)}</h3>{[['received','Thực nhận',l.quantity],['rejected','Từ chối (còn với vận chuyển)','0'],['quarantined','Phần thực nhận cần cách ly','0']].map(([field,label,value]) => <label key={String(field)}>{String(label)}<input className="input" required name={`${field}-${l.lotId}`} defaultValue={String(value)} inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,3})?" /></label>)}</div>)}<label>Biên bản và lý do<textarea className="input" name="reason" required minLength={10} maxLength={1000} /></label></fieldset><button className="button" disabled={cmd.pending}>{'Lưu biên bản trước khi ký'}</button></form>}
 {remainders.some(r => Number(r.quantity)>0) && <><h3>Lượng còn chờ đối soát với vận chuyển</h3><ul>{remainders.map(r => <li key={String(r.lotId)}>{textValue(lines.find(l => l.lotId === r.lotId)?.lotCode)}: {textValue(r.quantity)}</li>)}</ul>{actions.includes('RETURN') && <form onSubmit={returnSubmit}><fieldset disabled={cmd.pending || cmd.frozen} className="enterprise-fields">{remainders.filter(r => Number(r.quantity)>0).map(r => <label key={String(r.lotId)}>Lượng trả {textValue(lines.find(l => l.lotId === r.lotId)?.lotCode)}<input className="input" name={`return-${r.lotId}`} defaultValue="0" required inputMode="decimal" pattern="[0-9]+(\.[0-9]{1,3})?" /></label>)}<label>Lý do và mô tả hàng trả<textarea className="input" name="reason" required minLength={10} maxLength={1000} /></label></fieldset><button className="button" disabled={cmd.pending}>{'Lập chặng trả về bên giao'}</button></form>}</>}
 {returns.map(r => <article key={String(r.id)} className="panel"><h3>Chặng trả {String(r.id).slice(0,8)} · {r.status === 'RETURNED' ? 'Đã nhận trả' : 'Chờ hai bên ký'}</h3><p>{textValue(r.reason)}</p><ul>{(r.lines as Row[]).map(l => <li key={String(l.lotId)}>{textValue(lines.find(x => x.lotId === l.lotId)?.lotCode)}: {textValue(l.quantity)} {textValue(l.unit)}</li>)}</ul>{(r.allowedActions as string[]).includes('SIGN_RETURN') && <button className="button" disabled={signing || cmd.pending} onClick={() => void signReturn(r)}>{'Ký bàn giao trả đúng nội dung trên'}</button>}</article>)}
 <EvidencePanel entityType="TRANSFER" entityId={String(t.id)}/></section>;
}
