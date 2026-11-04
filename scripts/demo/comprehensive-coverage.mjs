import assert from 'node:assert/strict';
import { randomUUID, sign, createHash } from 'node:crypto';
import { canonicalize } from 'json-canonicalize';
import { setTimeout as delay } from 'node:timers/promises';

/** Append supported exception workflows; never manufacture states or extra lots. */
export async function coverOperationalExceptions(c) {
  const {db,command,load,save,actors,resources,production,chains,signing,signedAction,attest,transfer,distributionKeys,pilot}=c;
  const unwrap=x=>x?.record??x;
  const orgKey=id=>Object.keys(actors).find(k=>actors[k].organizationId===id&&actors[k].tier===1);
  const row=id=>db.shipment.findUniqueOrThrow({where:{id}});
  const lot=id=>db.lot.findUniqueOrThrow({where:{id}});
  const now=async()=>{const [r]=await db.$queryRaw`SELECT clock_timestamp() AS stamp`;return r.stamp.toISOString();};
  async function unusedShipment(label,exclude=[]) {
    const candidates=await db.shipment.findMany({where:{lot:{harvest:{cycle:{chainId:chains.C05.id}}},status:'CREATED',id:{notIn:exclude},handovers:{none:{state:'OFFERED'}}},orderBy:{id:'asc'}});
    if(candidates.length)return candidates[0].id;
    for(const candidate of production.lots.filter(l=>l.chainKey==='C05')) {
      if(await db.shipment.findUnique({where:{lotId:candidate.id}}))continue;
      const existing=await lot(candidate.id);if(existing.expiryDate<new Date(new Date().toISOString().slice(0,10)))continue;
      const route=`/supply-chains/${chains.C05.id}/shipment-plans`;
      const owner=orgKey(existing.farmOrgId),carrier='O03',retailer='O07';
      const plan=await command(owner,route,{lotId:existing.id,transporterOrgId:actors[carrier].organizationId,retailerOrgId:actors[retailer].organizationId,
        quantity:String(existing.availableQuantity),unit:existing.unit,origin:resources.sites[owner][0].name,destination:resources.sites[retailer][0].name,
        vehicleRef:resources.vehicles.find(v=>v.owner===carrier).registration},`${label}:plan:${existing.id}`);
      for(const [party,key]of [['PRODUCER',owner],['TRANSPORTER',carrier],['RETAILER',retailer]])await command(key,`${route}/${plan.id}/accept`,
        {party,revision:plan.currentRevision,payloadDigest:plan.current.payloadDigest},`${label}:accept:${plan.id}:${party}`);
      const finalized=await command(owner,`${route}/${plan.id}/finalize`,{version:plan.version},`${label}:finalize:${plan.id}`);
      return finalized.shipmentId;
    }
    throw new Error('No unused shipment lot for the planned exception workflow');
  }
  let intent=await load('coverage-intent');
  if(!intent) {
    const failure=await unusedShipment('coverage-failure');
    const arrived=await db.shipment.findFirst({where:{lot:{harvest:{cycle:{chainId:chains.C05.id}}},status:'ARRIVED',id:{not:failure}},orderBy:{id:'asc'}});
    const rejection=arrived?.id??(pilot?null:await unusedShipment('coverage-rejection',[failure]));
    const source=[];
    for(const candidate of production.lots.filter(l=>l.chainKey==='C04')) {
      const current=await lot(candidate.id);
      if(current.expiryDate<new Date(new Date().toISOString().slice(0,10))||await db.traceNotice.findFirst({where:{lotId:current.id,kind:'RECALL'}}))continue;
      const holding=await db.lotSiteHolding.findUnique({where:{lotId_organizationId_siteId:{lotId:current.id,organizationId:actors.O01.organizationId,siteId:resources.sites.O01[0].id}}});
      if(holding&&holding.quantity.sub(holding.reserved).sub(holding.quarantined).gte(100))source.push(current.id);
      if(source.length===2)break;
    }
    assert.equal(source.length,2);
    intent={failure,rejection,source,reportRequests:Array.from({length:pilot?1:3},()=>randomUUID())};
    await save('coverage-intent',intent);
  }
  const a=await row(intent.failure),aLot=await lot(a.lotId),owner=orgKey(aLot.farmOrgId),carrier=orgKey(a.transporterOrgId);
  async function offer(shipmentId,kind,label,minutes=15) {
    const current=await row(shipmentId),source=await lot(current.lotId);
    const giver=kind==='PICKUP'?orgKey(source.farmOrgId):orgKey(current.transporterOrgId);
    const offered=await signedAction(giver,`/shipments/${shipmentId}/handover-offers/intent`,{
      kind,keyRef:signing.keys[giver].keyRef,offerValidMinutes:minutes,signingWindowMinutes:15},label,signing);
    return offered.handoverId??offered.id;
  }
  async function confirm(shipmentId,handoverId,kind,label) {
    const current=await row(shipmentId),receiver=orgKey(kind==='PICKUP'?current.transporterOrgId:current.retailerOrgId);
    return signedAction(receiver,`/handovers/${handoverId}/confirmation/intent`,{keyRef:signing.keys[receiver].keyRef,signingWindowMinutes:15},label,signing);
  }
  // Cancellation and refusal leave the original physical custodian unchanged.
  if(!intent.cancellationHandover) {
    const open=await db.shipmentHandover.findFirst({where:{shipmentId:a.id,state:'OFFERED',kind:'PICKUP'}});
    intent.cancellationHandover=open?.id??await offer(a.id,'PICKUP',`coverage-cancel-offer:${a.id}`);
    await save('coverage-intent',intent);
  }
  const cancelled=intent.cancellationHandover;
  await command(owner,`/handovers/${cancelled}/cancel`,{reason:'Điều chỉnh giờ giao theo lịch xe trước khi nhận hàng.'},`coverage-cancel:${cancelled}`);
  const refused=await offer(a.id,'PICKUP',`coverage-refuse-offer:${a.id}`);
  await command(carrier,`/handovers/${refused}/reject`,{reason:'Chưa đáp ứng lịch tiếp nhận; đề nghị đơn vị gửi bố trí lại thời điểm.'},`coverage-refuse:${refused}`);
  // Minimum supported validity is 15 minutes. Wait for the real expiry Worker;
  // never backdate expiresAt or change ledger history to shorten this scenario.
  const expiring=await offer(a.id,'PICKUP',`coverage-expiring-offer:${a.id}`);
  console.log('Exception coverage: a real 15-minute handover expiry is pending while other scenarios run.');

  const b=intent.rejection?await row(intent.rejection):null;
  if(b) {
  if(b.status==='CREATED') {
    const pickup=await offer(b.id,'PICKUP',`coverage-reject-pickup:${b.id}`);await confirm(b.id,pickup,'PICKUP',`coverage-reject-pickup-confirm:${b.id}`);
    const arrival=await offer(b.id,'ARRIVAL',`coverage-reject-arrival:${b.id}`);await confirm(b.id,arrival,'ARRIVAL',`coverage-reject-arrival-confirm:${b.id}`);
  }
  const rejection=await row(b.id),rejectedLot=await lot(b.lotId);
  await command(orgKey(b.retailerOrgId),`/shipments/${b.id}/reject`,{version:rejection.version,lotVersion:rejectedLot.version,
    reason:'Từ chối tiếp nhận để đối chiếu tình trạng nhãn và bao gói tại điểm giao.'},`coverage-shipment-reject:${b.id}`);
  }

  const first=production.lots.find(l=>l.id===intent.source[0]);assert.ok(first);
  const cancelledTransfer=await transfer(resources,first,'O01','O02','O03','10.000','coverage-cancel-transfer','PROPOSED');
  const cancelRow=await db.distributionTransfer.findUniqueOrThrow({where:{id:cancelledTransfer.id}});
  await command('O01',`/distribution/transfers/${cancelRow.id}/cancel`,{version:cancelRow.version},`coverage-transfer-cancel:${cancelRow.id}`);

  const multi=unwrap(await command('O01','/distribution/transfers',{chainId:chains.C04.id,receiverId:actors.O02.organizationId,carrierId:actors.O03.organizationId,
    senderSiteId:resources.sites.O01[0].id,receiverSiteId:resources.sites.O02[0].id,carrierSiteId:resources.sites.O03[0].id,
    vehicleId:resources.vehicles.find(v=>v.owner==='O03').id,origin:resources.sites.O01[0].name,destination:resources.sites.O02[0].name,
    plannedPickupAt:new Date(Date.now()+86400000).toISOString(),plannedDeliveryAt:new Date(Date.now()+172800000).toISOString(),
    lines:intent.source.map(lotId=>({lotId,quantity:'20.000',unit:'kg'})),note:'Giao hai dòng lô; kiểm đếm riêng lượng thực nhận và phần chờ trả.'},'coverage-multiline-transfer'));
  for(const party of ['O01','O03','O02'])await attest(multi.id,party,'CONSENT');
  for(const party of ['O01','O03'])await attest(multi.id,party,'PICKUP');
  let multiRow=await db.distributionTransfer.findUniqueOrThrow({where:{id:multi.id}});
  await command('O02',`/distribution/transfers/${multi.id}/receipt`,{version:multiRow.version,lines:intent.source.map(lotId=>({lotId,received:'16.000',rejected:'4.000',quarantined:'2.000'})),
    reason:'Đã nhận 16 kg mỗi dòng; 4 kg chờ trả, trong lượng nhận có 2 kg chờ kiểm tra.'},`coverage-partial-receipt:${multi.id}`);
  for(const party of ['O03','O02'])await attest(multi.id,party,'DELIVERY');
  multiRow=await db.distributionTransfer.findUniqueOrThrow({where:{id:multi.id}});
  const returned=unwrap(await command('O03',`/distribution/transfers/${multi.id}/returns`,{version:multiRow.version,
    lines:intent.source.map(lotId=>({lotId,quantity:'4.000',unit:'kg'})),reason:'Trả lại phần hàng chưa được bên nhận chấp thuận, giữ nguyên mã lô nguồn.'},`coverage-return:${multi.id}`));
  for(const party of ['O03','O01']) {
    const label=`coverage-return-sign:${returned.id}:${party}`,name='coverage-return-signatures/'+createHash('sha256').update(label).digest('hex'),complete=await load(name);
    let body=complete;
    if(!body) {
      const current=await db.distributionReturn.findUniqueOrThrow({where:{id:returned.id}}),key=distributionKeys[party];assert.ok(key);
      const expiresAt=new Date(Date.now()+15*60000).toISOString();
      const message={returnId:returned.id,transferId:multi.id,digest:current.digest,organizationId:actors[party].organizationId,
        userId:actors[party].id,keyRef:key.id,version:String(current.version),expiresAt};
      body={version:current.version,keyRef:key.id,expiresAt,signature:sign(null,Buffer.from(`agritrace:distribution-return:1\0${canonicalize(message)}`),key.privateKey).toString('base64url')};
      await save(name,body);
    }
    await command(party,`/distribution/transfers/${multi.id}/returns/${returned.id}/sign`,body,label);
  }

  // Keep one open quarantine case and resolve another through release/disposal.
  const quarantineCases=await db.quarantineCase.findMany({where:{organizationId:actors.O02.organizationId,lotId:{in:intent.source}},orderBy:{id:'asc'}});
  if(quarantineCases.length) {
    const q=quarantineCases[0],current=await lot(q.lotId);
    await command('O02','/distribution/quarantine',{lotId:q.lotId,siteId:q.siteId,quantity:'1.000',unit:q.unit,version:current.version,
      action:'RELEASE',quarantineCaseId:q.id,reason:'Đã kiểm tra bao gói và chấp thuận giải phóng một phần hàng.'},`coverage-quarantine-release:${q.id}`);
    const after=await lot(q.lotId);
    await command('O02','/distribution/quantities',{lotId:q.lotId,siteId:q.siteId,quantity:'1.000',unit:q.unit,version:after.version,
      kind:'DAMAGE',fromQuarantine:true,quarantineCaseId:q.id,reason:'Loại bỏ phần hàng có bao gói không đáp ứng điều kiện tiếp nhận.'},`coverage-quarantine-dispose:${q.id}`);
  }
  if(!pilot) {
    const current=await lot(intent.source[0]);
    const slip=unwrap(await command('O01','/distribution/site-transfers',{lotId:current.id,fromSiteId:resources.sites.O01[0].id,toSiteId:resources.sites.O01[1].id,
      quantity:'12.000',unit:'kg',version:current.version,reason:'Điều chuyển hàng từ cơ sở tiếp nhận sang khu bảo quản.'},'coverage-site-transfer'));
    let fresh=await db.siteTransfer.findUniqueOrThrow({where:{id:slip.id}});
    await command('O01',`/distribution/site-transfers/${slip.id}/dispatch`,{version:fresh.version},`coverage-site-dispatch:${slip.id}`);
    fresh=await db.siteTransfer.findUniqueOrThrow({where:{id:slip.id}});
    await command('O01',`/distribution/site-transfers/${slip.id}/receive`,{version:fresh.version,receivedQuantity:'10.000',note:'Nhận 10 kg; 2 kg còn chờ đối chiếu tại cơ sở nguồn.'},`coverage-site-receive:${slip.id}`);
    fresh=await db.siteTransfer.findUniqueOrThrow({where:{id:slip.id}});
    await command('O01',`/distribution/site-transfers/${slip.id}/resolve`,{version:fresh.version,resolution:'RETURNED',note:'Đã đối chiếu và xác nhận 2 kg chênh lệch còn tại cơ sở nguồn.'},`coverage-site-resolve:${slip.id}`);
    for(const processor of ['O06','O09','O19']) {
      const run=await db.processingRun.findFirstOrThrow({where:{organizationId:actors[processor].organizationId,status:'IN_PROGRESS'},orderBy:{id:'asc'}});
      const log=unwrap(await command(processor,`/processing-runs/${run.id}/logs`,{step:'QUALITY_CHECK',occurredAt:await now(),note:'Kiểm tra ngoại quan tại khu chuẩn bị trước khi chạy công đoạn chính.'},`coverage-process-log:${run.id}`));
      await command(processor,`/processing-runs/${run.id}/logs`,{step:'CORRECTION',correctsId:log.id,occurredAt:await now(),
        note:'Đính chính mô tả: đây là kiểm tra tiếp nhận nguyên liệu; kiểm tra thành phẩm sẽ được ghi ở công đoạn sau.'},`coverage-process-correction:${run.id}`);
    }
    if(intent.saleShipmentId===undefined){
      const candidate=await db.shipment.findFirst({where:{status:'DELIVERED',lot:{currentState:{in:['RETAIL_RECEIVED','FOR_SALE']}}},orderBy:{id:'asc'}});
      intent.saleShipmentId=candidate?.id??null;await save('coverage-intent',intent);
    }
    const sale=intent.saleShipmentId?await db.shipment.findUniqueOrThrow({where:{id:intent.saleShipmentId}}):null;
    if(sale) {
      let current=await lot(sale.lotId),shipment=await row(sale.id);
      if(current.currentState!=='FOR_SALE')await command(orgKey(sale.retailerOrgId),`/lots/${current.id}/mark-for-sale`,{version:current.version,shipmentVersion:shipment.version},`coverage-for-sale:${current.id}`);
      current=await lot(sale.lotId);shipment=await row(sale.id);
      await command(orgKey(sale.retailerOrgId),`/lots/${current.id}/mark-sold`,{version:current.version,shipmentVersion:shipment.version},`coverage-sold:${current.id}`);
    }
  }
  for(const [i,requestId]of intent.reportRequests.entries()) {
    const qr=await db.traceQr.findUniqueOrThrow({where:{lotId:intent.source[i%2]}});
    const report=unwrap(await command('consumer'+(i+1),`/public/trace/${qr.traceToken}/reports`,{requestId,category:'WRONG_INFORMATION',
      description:'Đề nghị hướng dẫn đối chiếu ngày thu hoạch, nhãn bao gói và hạn sử dụng theo mã truy xuất này.',consent:false,truthful:true},`coverage-consumer-report:${requestId}`));
    assert.equal(report.received,true);
    const record=await db.consumerReport.findFirstOrThrow({where:{requestId:report.requestId}});
    await command('cases',`/platform-admin/consumer-reports/${record.id}/triage`,{version:record.version,decision:['ESCALATE','DISMISS','DUPLICATE'][i%3],severity:'LOW',
      note:'Đã tiếp nhận yêu cầu đối chiếu nhãn lô và phân loại theo quy trình hỗ trợ người tiêu dùng.'},`coverage-consumer-triage:${record.id}`);
  }
  for(let i=0;i<1200;i++) {
    const current=await db.shipmentHandover.findUniqueOrThrow({where:{id:expiring}});
    if(current.state==='EXPIRED')break;
    assert.equal(current.state,'OFFERED');if(i%60===0)console.log(`Waiting for actual handover expiry; expires ${current.expiresAt.toISOString()}`);
    if(i===1199)throw new Error('Real handover expiry did not settle; preserve the original generation');
    await delay(1000);
  }
  const pickup=await offer(a.id,'PICKUP',`coverage-final-pickup:${a.id}`);await confirm(a.id,pickup,'PICKUP',`coverage-final-confirm:${a.id}`);
  const active=await row(a.id),damaged=await lot(a.lotId);
  await command(carrier,`/shipments/${a.id}/damage`,{version:active.version,lotVersion:damaged.version,quantity:Number(damaged.availableQuantity),
    reason:'Toàn bộ lượng đang vận chuyển không đáp ứng điều kiện bảo quản, ghi nhận tổn thất tại bên đang giữ hàng.'},`coverage-shipment-failure:${a.id}`);
  assert.equal((await row(a.id)).status,'FAILED');assert.equal((await lot(a.lotId)).availableQuantity.toString(),'0');
  return {failure:a.id,rejection:b?.id??null,expiredHandover:expiring,cancelledHandover:cancelled,rejectedHandover:refused,multiLineTransfer:multi.id,returnId:returned.id};
}
