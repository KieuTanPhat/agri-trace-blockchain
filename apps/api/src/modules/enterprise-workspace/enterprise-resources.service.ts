import { ConflictException, ForbiddenException, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { commandTransaction, commandResponseJson } from '../../common/idempotency/command-transaction.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { enterpriseAuthority, profileAuthority } from './enterprise-policy.js';
import { evidenceSubject } from './evidence-policy.js';
import { assertProductRefs, assertSiteStaff } from '../catalog/product-refs.js';
import { ProductInput, type ProductRevisionInput, type MaterialInput, type MaterialRevisionInput, type ProductImportInput, type EvidenceInput } from './resources.dto.js';
import { TraceService } from '../trace/trace.service.js';
import { normalizeExpiryDate } from '../../common/expiry-date.js';
import type { SiteRevisionInput,VehicleRevisionInput } from './resources.dto.js';
export type EvidenceFile = { buffer: Buffer; originalname: string; mimetype: string; size: number };
/** Control characters and path separators never reach stored or downloaded names. */
const safeFileName = (name: string) => [...name].map(c => { const code = c.charCodeAt(0); return code < 32 || code === 127 || c === '/' || c === '\\' ? '_' : c; }).join('').slice(0, 180);
const evidenceKinds: Record<string, readonly string[]> = {
  CHAIN: ['OTHER', 'CHAIN_IMAGE'],
  MATERIAL_RECEIPT: ['OTHER', 'RECEIPT_DOCUMENT', 'INSPECTION_IMAGE', 'CERTIFICATE_IMAGE'],
  PROCESSING_LOG: ['OTHER', 'PROCESSING_IMAGE'],
  SITE_TRANSFER: ['OTHER', 'TRANSFER_IMAGE'],
  QUARANTINE: ['OTHER', 'QUARANTINE_IMAGE', 'INSPECTION_IMAGE', 'CERTIFICATE_IMAGE'],
  PRODUCT: ['OTHER', 'PRODUCT_IMAGE', 'INSPECTION_IMAGE'],
  FARM: ['OTHER', 'LAND_CERTIFICATE'],
  SITE: ['OTHER', 'SITE_IMAGE', 'BUSINESS_LICENSE', 'QUALITY_CERTIFICATE', 'INSPECTION_IMAGE'],
  CYCLE: ['OTHER', 'CYCLE_IMAGE', 'CARE_IMAGE', 'HARVEST_IMAGE', 'LOT_IMAGE', 'CERTIFICATE_IMAGE'],
  CYCLE_DRAFT: ['OTHER', 'CYCLE_IMAGE', 'CERTIFICATE_IMAGE'],
  LOT: ['OTHER', 'LOT_IMAGE', 'LOT_DOCUMENT', 'INSPECTION_IMAGE'],
  TRANSFER: ['OTHER', 'TRANSFER_IMAGE', 'INSPECTION_IMAGE'],
  MATERIAL: ['OTHER', 'MATERIAL_IMAGE', 'SEED_IMAGE', 'CERTIFICATE_IMAGE', 'INSPECTION_IMAGE'],
  PROFILE: ['OTHER', 'BUSINESS_LICENSE', 'CERTIFICATE_IMAGE'],
  MEMBER: ['OTHER', 'MEMBER_AVATAR', 'MEMBER_DOCUMENT'],
  EXTERNAL_PARTNER: ['OTHER', 'PARTNER_LOGO', 'PARTNERSHIP_EVIDENCE', 'BUSINESS_LICENSE', 'CERTIFICATE_IMAGE', 'INSPECTION_IMAGE'],
};
const imageOnlyKinds = new Set([
  'PRODUCT_IMAGE','INSPECTION_IMAGE','AREA_IMAGE','LAND_CERTIFICATE',
  'PRODUCTION_CONTRACT','QUALITY_CERTIFICATE','CYCLE_IMAGE','MATERIAL_IMAGE',
  'SEED_IMAGE','CERTIFICATE_IMAGE','LOT_IMAGE','SITE_IMAGE','TRANSFER_IMAGE',
  'HARVEST_IMAGE','CARE_IMAGE','PARTNER_LOGO','PARTNERSHIP_EVIDENCE',
  'MEMBER_AVATAR',
  'CHAIN_IMAGE',
  'QUARANTINE_IMAGE',
  'PROCESSING_IMAGE',
]);
@Injectable()
export class EnterpriseResourcesService {
 constructor(private readonly db: PrismaService, private readonly trace: TraceService) {}
 private async revision(tx: Prisma.TransactionClient, actor: CommandActor, entityType: string, row: {id?:string;organizationId?:string|null;version:number}, entityId:string, reason:string) {
   await tx.enterpriseRevision.create({data:{organizationId:actor.organizationId!,entityType,entityId,version:row.version,snapshot:commandResponseJson(row),reason,actorId:actor.sub!}});
 }
 updateProduct(actor:CommandActor,id:string,input:ProductRevisionInput) {
   return commandTransaction(this.db,async tx => {
     await enterpriseAuthority(tx,actor,'catalog.manage',undefined,undefined,true);
     const old = await tx.product.findFirst({where:{id,organizationId:actor.organizationId!}});
     if (!old || old.version!==input.version) throw new ConflictException('Danh mục đã đổi hoặc ngoài tổ chức');
     if (!old.evidenceComplete && input.status === 'ACTIVE') throw new ConflictException('Cần hoàn tất ảnh sản phẩm trước khi kích hoạt');
     if (!await tx.farm.findFirst({where:{id:input.product.originFarmId,organizationId:actor.organizationId!,status:'ACTIVE',evidenceComplete:true}})) throw new ConflictException('Vùng xuất xứ chưa hoàn tất hoặc ngoài doanh nghiệp');
     await this.revision(tx,actor,'PRODUCT',old,id,input.reason);
     await assertProductRefs(tx,actor.organizationId!,input.product);
     const record = await tx.product.update({where:{id},data:{...input.product,status:input.status,version:{increment:1}}}); return {record};
   });
 }
 async revisions(actor:CommandActor,entityType:string,id:string) {
   if(!['PRODUCT','MATERIAL','SITE','VEHICLE','PROFILE'].includes(entityType))throw new NotFoundException();
   const permission = entityType==='MATERIAL'?'materials.read':entityType==='SITE'?'sites.read':entityType==='VEHICLE'?'vehicles.read':entityType==='PROFILE'?'profile.read':'catalog.read';
   const auth = await enterpriseAuthority(this.db,actor,permission,undefined,entityType==='SITE'?id:undefined);
   if (!auth.primary && ['SITE','PROFILE','VEHICLE'].includes(entityType)) throw new ForbiddenException('Chỉ chủ quản xem lịch sử hồ sơ có thông tin quản lý');
   return {items:await this.db.enterpriseRevision.findMany({where:{organizationId:actor.organizationId!,entityType,entityId:id},orderBy:{version:'desc'},take:100})};
 }
 updateAsset(actor:CommandActor,id:string,kind:'SITE'|'VEHICLE',input:SiteRevisionInput|VehicleRevisionInput) {
  return commandTransaction(this.db,async tx=>{
   await enterpriseAuthority(tx,actor,kind==='SITE'?'sites.manage':'vehicles.manage',undefined,kind==='SITE'?id:undefined,true);
   const old=kind==='SITE'?await tx.enterpriseSite.findFirst({where:{id,organizationId:actor.organizationId!}}):await tx.enterpriseVehicle.findFirst({where:{id,organizationId:actor.organizationId!}});
   if(!old||old.version!==input.version)throw new ConflictException('Cơ sở hoặc phương tiện đã đổi');
   if(kind==='SITE') {
     const siteInput=(input as SiteRevisionInput).site;
     if(input.status==='ACTIVE' && 'evidenceComplete' in old && !old.evidenceComplete)throw new ConflictException('Cần ảnh cơ sở trước khi kích hoạt');
     if(siteInput.farmId && !await tx.farm.findFirst({where:{id:siteInput.farmId,organizationId:actor.organizationId!,status:'ACTIVE',evidenceComplete:true}}))throw new ConflictException('Vùng liên kết chưa hoàn tất hoặc ngoài doanh nghiệp');
     await assertSiteStaff(tx,actor.organizationId!,siteInput.staffUserId);
   }
   if(input.status==='INACTIVE' && (kind==='SITE'?await tx.lotSiteHolding.count({where:{siteId:id,quantity:{gt:0}}}):await tx.distributionTransfer.count({where:{vehicleId:id,status:{in:['PROPOSED','READY','IN_TRANSIT']}}})))throw new ConflictException('Đối soát tồn hoặc chặng đang mở trước khi ngừng sử dụng');
   await this.revision(tx,actor,kind,old,id,input.reason);
   const record=kind==='SITE'?await tx.enterpriseSite.update({where:{id},data:{...(input as SiteRevisionInput).site,status:input.status,version:{increment:1}}}):await tx.enterpriseVehicle.update({where:{id},data:{...(input as VehicleRevisionInput).vehicle,status:input.status,version:{increment:1}}});
   return {record};
  });
 }
 async materials(actor:CommandActor) {
   await enterpriseAuthority(this.db,actor,'materials.read');
   return {items:await this.db.productionMaterial.findMany({where:{organizationId:actor.organizationId!},orderBy:{code:'asc'},take:1000})};
 }
 saveMaterial(actor:CommandActor,input:MaterialInput,id?:string,revision?:MaterialRevisionInput) {
   return commandTransaction(this.db,async tx => {
     await enterpriseAuthority(tx,actor,'materials.manage',undefined,undefined,true);
     if (!await tx.organizationCapability.findFirst({where:{organizationId:actor.organizationId!,code:'FARM',revokedAt:null}})) throw new ForbiddenException('Danh mục đầu vào chỉ dành cho tổ chức sản xuất');
     const data = {...input,seedType:input.kind==='SEED'?input.seedType:null,expiryDate:input.expiryDate?normalizeExpiryDate(input.expiryDate):undefined};
     if (!id) return {record:await tx.productionMaterial.create({data:{...data,code:input.code?.trim()||`VT-${randomUUID().slice(0,12).toUpperCase()}`,organizationId:actor.organizationId!,status:'INACTIVE',evidenceComplete:false}})};
     const old = await tx.productionMaterial.findFirst({where:{id,organizationId:actor.organizationId!}});
     if (!old || old.version!==revision?.version) throw new ConflictException('Vật tư đã đổi hoặc ngoài tổ chức');
     if (!old.evidenceComplete && revision.status==='ACTIVE') throw new ConflictException('Cần ảnh giống/vật tư trước khi kích hoạt');
     await this.revision(tx,actor,'MATERIAL',old,id,revision.reason);
     const changedKind = old.kind !== data.kind;
     return {record:await tx.productionMaterial.update({where:{id},data:{...data,code:input.code?.trim()||old.code,status:changedKind?'INACTIVE':revision.status,evidenceComplete:changedKind?false:old.evidenceComplete,version:{increment:1}}})};
   });
 }
 completeMaterial(actor:CommandActor,id:string,version:number) {
   return commandTransaction(this.db,async tx=>{
     await enterpriseAuthority(tx,actor,'materials.manage',undefined,undefined,true);
     const row=await tx.productionMaterial.findFirst({where:{id,organizationId:actor.organizationId!}});
     if(!row||row.version!==version||row.evidenceComplete)throw new ConflictException('Giống/vật tư đã thay đổi hoặc hoàn tất');
     const evidence=await tx.traceEvidence.findMany({where:{organizationId:actor.organizationId!,entityType:'MATERIAL',entityId:id},select:{id:true,kind:true,supersedesId:true}});
     const superseded=new Set(evidence.map(item=>item.supersedesId).filter(Boolean));
     const required=row.kind==='SEED'?'SEED_IMAGE':'MATERIAL_IMAGE';
     if(!evidence.some(item=>item.kind===required&&!superseded.has(item.id)))throw new ConflictException('Cần ít nhất một ảnh giống/vật tư hợp lệ');
     const changed=await tx.productionMaterial.updateMany({where:{id,version,evidenceComplete:false},data:{evidenceComplete:true,status:'ACTIVE',version:{increment:1}}});
     if(changed.count!==1)throw new ConflictException('Giống/vật tư đã thay đổi');
     return {record:await tx.productionMaterial.findUniqueOrThrow({where:{id}})};
   });
 }
 completeSite(actor:CommandActor,id:string,version:number) {
   return commandTransaction(this.db,async tx=>{
     await enterpriseAuthority(tx,actor,'sites.manage',undefined,id,true);
     const row=await tx.enterpriseSite.findFirst({where:{id,organizationId:actor.organizationId!}});
     if(!row||row.version!==version||row.evidenceComplete)throw new ConflictException('Cơ sở đã thay đổi hoặc hoàn tất');
     const evidence=await tx.traceEvidence.findMany({where:{organizationId:actor.organizationId!,entityType:'SITE',entityId:id},select:{id:true,kind:true,supersedesId:true}});
     const superseded=new Set(evidence.map(item=>item.supersedesId).filter(Boolean));
     if(!evidence.some(item=>item.kind==='SITE_IMAGE'&&!superseded.has(item.id)))throw new ConflictException('Cần ít nhất một ảnh cơ sở hợp lệ');
     const changed=await tx.enterpriseSite.updateMany({where:{id,version,evidenceComplete:false},data:{evidenceComplete:true,status:'ACTIVE',version:{increment:1}}});
     if(changed.count!==1)throw new ConflictException('Cơ sở đã thay đổi');
     return {record:await tx.enterpriseSite.findUniqueOrThrow({where:{id}})};
   });
 }
 async importPreview(actor:CommandActor,input:ProductImportInput,tx:Prisma.TransactionClient=this.db) {
   await enterpriseAuthority(tx,actor,'catalog.manage');
   const old = await tx.product.findMany({where:{organizationId:actor.organizationId!},select:{sku:true}}), seen = new Set(old.map(r=>r.sku?.trim().toLowerCase()).filter(Boolean));
   const farms = new Set((await tx.farm.findMany({where:{organizationId:actor.organizationId!,status:'ACTIVE',evidenceComplete:true},select:{id:true}})).map(row=>row.id));
   const errors: {row:number;messages:string[]}[]=[];
   input.rows.forEach((row,i)=>{
     const dto=plainToInstance(ProductInput,row), validation=validateSync(dto,{whitelist:true,forbidNonWhitelisted:true});
     const messages=validation.flatMap(e=>Object.values(e.constraints??{}));
     if (!farms.has(row.originFarmId)) messages.push('Vùng xuất xứ chưa hoàn tất hoặc ngoài doanh nghiệp');
     const sku=typeof row.sku==='string'?row.sku.trim().toLocaleLowerCase():'';
     if (seen.has(sku)) messages.push('SKU trùng trong file hoặc đã có trong danh mục');
     seen.add(sku); if(messages.length)errors.push({row:i+1,messages});
   });
   return {record:{digest:canonicalSha256(input.rows),count:input.rows.length,errors,canApply:errors.length===0}};
 }
 importProducts(actor:CommandActor,input:ProductImportInput) {
   return commandTransaction(this.db,async tx=>{
     await enterpriseAuthority(tx,actor,'catalog.manage',undefined,undefined,true);
     const preview=await this.importPreview(actor,input,tx);
     if(!input.digest || preview.record.digest!==input.digest || !preview.record.canApply) throw new ConflictException('Cần xem trước nội dung hợp lệ; danh mục hoặc file đã thay đổi');
     const records=[];
     for(const row of input.rows) records.push(await tx.product.create({data:{...row,sku:row.sku?.trim(),organizationId:actor.organizationId!,status:'INACTIVE',evidenceComplete:false}}));
     return {record:{count:records.length,ids:records.map(r=>r.id),digest:input.digest}};
   });
 }
 async evidence(actor:CommandActor,type:string,id:string,siteId?:string) {
   const context=await evidenceSubject(this.db,actor,type,id,'evidence.read',siteId);
   // Photos taken while the cycle was a draft belong to the same id.
   const types=type==='CYCLE'?['CYCLE','CYCLE_DRAFT']:[type];
   if(type==='PRODUCT'){
     // Product photos follow the owner's chosen order; the first is the main photo.
     const [rows,order]=await Promise.all([
       this.db.traceEvidence.findMany({where:{organizationId:actor.organizationId!,entityType:'PRODUCT',entityId:id,withdrawal:null},select:{id:true,entityType:true,entityId:true,siteId:true,supersedesId:true,fileName:true,mediaType:true,size:true,sha256:true,description:true,kind:true,public:true,createdAt:true},orderBy:{createdAt:'desc'},take:200}),
       this.db.productPhotoOrder.findUnique({where:{productId:id}}),
     ]);
     const rank=new Map((order?.evidenceIds??[]).map((evidenceId,index)=>[evidenceId,index]));
     return {items:rows.map((row,index)=>({row,index})).sort((a,b)=>(rank.get(a.row.id)??1e6+a.index)-(rank.get(b.row.id)??1e6+b.index)).map(({row})=>row)};
   }
   return {items:await this.db.traceEvidence.findMany({where:{organizationId:actor.organizationId!,entityType:{in:types},entityId:id,withdrawal:null,...(context.siteId?{siteId:context.siteId}:{})},select:{id:true,entityType:true,entityId:true,siteId:true,supersedesId:true,fileName:true,mediaType:true,size:true,sha256:true,description:true,kind:true,public:true,createdAt:true},orderBy:{createdAt:'desc'},take:200})};
 }
 uploadEvidence(actor:CommandActor,input:EvidenceInput,file:EvidenceFile) {
   return commandTransaction(this.db,async tx=>{
     if(input.entityType==='PROFILE')await profileAuthority(tx,actor,true);else await enterpriseAuthority(tx,actor,'evidence.manage',undefined,undefined,true);
     const context=await evidenceSubject(tx,actor,input.entityType,input.entityId,'evidence.manage',input.siteId);
     if(input.entityType==='CYCLE_DRAFT'){
       // Lock the draft so linking either sees this photo or runs after it has
       // been refused; linking records EVIDENCE_ATTACHED for the photos it sees.
       const draft=await tx.$queryRaw<Array<{id:string}>>`SELECT id FROM production_cycle_draft WHERE id = ${input.entityId}::uuid AND organization_id = ${actor.organizationId!}::uuid FOR SHARE`;
       if(!draft.length)throw new ConflictException('Vụ đã liên kết chuỗi; tải ảnh trong trang vụ sản xuất');
     }
     const kind=input.kind??'OTHER';
     if (!evidenceKinds[input.entityType]?.includes(kind)) throw new UnprocessableEntityException('Loại ảnh/chứng từ không phù hợp với hồ sơ');
     const content=file.buffer;
     const media=content.subarray(0,8).equals(Buffer.from('89504e470d0a1a0a','hex'))?'image/png':content.subarray(0,3).equals(Buffer.from('ffd8ff','hex'))?'image/jpeg':content.subarray(0,5).toString('ascii')==='%PDF-'?'application/pdf':null;
     if(!media || content.length===0 || content.length>5*1024*1024) throw new UnprocessableEntityException('Chỉ nhận PNG, JPEG hoặc PDF tối đa 5 MB, kiểm tra theo byte file');
     if(imageOnlyKinds.has(kind) && !media.startsWith('image/')) throw new UnprocessableEntityException('Danh mục ảnh chỉ nhận PNG hoặc JPEG');
     if(input.public) {
       const lot=input.entityType==='LOT'?await tx.lot.findUnique({where:{id:input.entityId}}):null;
       if(!input.publicationConfirmed || !lot || lot.farmOrgId!==actor.organizationId) throw new ForbiddenException('Công bố chỉ cho chứng cứ lô nguồn của bên sản xuất, cần xác nhận công bố');
     }
     if(input.supersedesId) {
       const old=await tx.traceEvidence.findFirst({where:{id:input.supersedesId,organizationId:actor.organizationId!,entityType:input.entityType==='CYCLE'?{in:['CYCLE','CYCLE_DRAFT']}:input.entityType,entityId:input.entityId}});
       if(!old || await tx.traceEvidenceWithdrawal.findUnique({where:{evidenceId:old.id}}) || old.kind!==kind || old.siteId!==(context.siteId??null) || await tx.traceEvidence.findFirst({where:{supersedesId:old.id}})) throw new ConflictException('Chọn bản chứng cứ mới nhất cùng loại và phạm vi để đính chính');
     }
     const total=await tx.traceEvidence.aggregate({where:{organizationId:actor.organizationId!},_sum:{size:true},_count:true});
     if(total._count>=1000 || (total._sum.size??0)+content.length>256*1024*1024) throw new ConflictException('Đã đạt giới hạn lưu chứng cứ của tổ chức');
     const row=await tx.traceEvidence.create({data:{organizationId:actor.organizationId!,entityType:input.entityType,entityId:input.entityId,...context,supersedesId:input.supersedesId,fileName:safeFileName(file.originalname),mediaType:media,size:content.length,sha256:createHash('sha256').update(content).digest('hex'),content:Uint8Array.from(content),description:input.description,kind,public:input.public??false,actorId:actor.sub!}});
     if(['LOT','CYCLE'].includes(input.entityType)) await this.trace.createInTransaction(tx,{entityType:input.entityType==='CYCLE'?'PRODUCTION_CYCLE':'LOT',entityId:input.entityId,lotId:input.entityType==='LOT'?input.entityId:undefined,cycleId:input.entityType==='CYCLE'?input.entityId:undefined,eventType:'EVIDENCE_ATTACHED',actor,businessData:{evidenceId:row.id,sha256:row.sha256,supersedesId:row.supersedesId,kind:row.kind,public:row.public}});
     return {record:{id:row.id,sha256:row.sha256,size:row.size,mediaType:row.mediaType}};
   });
 }
 /** Hides a product photo without deleting it. A product on sale keeps at
  * least one current photo, so a replacement is uploaded first. */
 withdrawEvidence(actor:CommandActor,id:string,reason:string) {
   return commandTransaction(this.db,async tx=>{
     await enterpriseAuthority(tx,actor,'evidence.manage',undefined,undefined,true);
     const row=await tx.traceEvidence.findFirst({where:{id,organizationId:actor.organizationId!},select:{id:true,entityType:true,entityId:true,kind:true}});
     if(!row)throw new NotFoundException('Không tìm thấy ảnh');
     if(row.entityType!=='PRODUCT')throw new ConflictException('Chỉ gỡ được ảnh sản phẩm');
     await evidenceSubject(tx,actor,row.entityType,row.entityId,'evidence.manage');
     const [product]=await tx.$queryRaw<Array<{status:string;evidence_complete:boolean}>>`SELECT status::text AS status, evidence_complete FROM product WHERE product_id = ${row.entityId}::uuid AND organization_id = ${actor.organizationId!}::uuid FOR UPDATE`;
     if(!product)throw new NotFoundException('Không tìm thấy sản phẩm');
     if(await tx.traceEvidenceWithdrawal.findUnique({where:{evidenceId:id}}))throw new ConflictException('Ảnh đã được gỡ');
     if(await tx.traceEvidence.findFirst({where:{supersedesId:id}}))throw new ConflictException('Ảnh đã có bản thay thế');
     if(row.kind==='PRODUCT_IMAGE'&&product.status==='ACTIVE'){
       const rows=await tx.traceEvidence.findMany({where:{organizationId:actor.organizationId!,entityType:'PRODUCT',entityId:row.entityId,kind:'PRODUCT_IMAGE',withdrawal:null},select:{id:true,supersedesId:true}});
       const superseded=new Set(rows.map(r=>r.supersedesId).filter(Boolean));
       const remaining=rows.filter(r=>!superseded.has(r.id)&&r.id!==id).length;
       if(remaining<1)throw new ConflictException('Sản phẩm đang hoạt động cần ít nhất một ảnh; tải ảnh mới trước khi gỡ ảnh này');
     }
     await tx.traceEvidenceWithdrawal.create({data:{evidenceId:id,organizationId:actor.organizationId!,actorId:actor.sub!,reason:reason.trim()}});
     return {record:{id,withdrawn:true}};
   });
 }
 /** Saves the display order of a product's current photos. */
 orderProductPhotos(actor:CommandActor,id:string,order:string[]) {
   return commandTransaction(this.db,async tx=>{
     await enterpriseAuthority(tx,actor,'catalog.manage',undefined,undefined,true);
     const product=await tx.product.findFirst({where:{id,organizationId:actor.organizationId!},select:{id:true}});
     if(!product)throw new NotFoundException('Không tìm thấy sản phẩm');
     const rows=await tx.traceEvidence.findMany({where:{organizationId:actor.organizationId!,entityType:'PRODUCT',entityId:id,withdrawal:null},select:{id:true,supersedesId:true}});
     const superseded=new Set(rows.map(r=>r.supersedesId).filter(Boolean));
     const current=new Set(rows.filter(r=>!superseded.has(r.id)).map(r=>r.id));
     const unique=[...new Set(order)];
     if(unique.length!==order.length||unique.some(evidenceId=>!current.has(evidenceId)))throw new ConflictException('Danh sách ảnh đã thay đổi; tải lại trang rồi sắp xếp lại');
     await tx.productPhotoOrder.upsert({where:{productId:id},create:{productId:id,organizationId:actor.organizationId!,evidenceIds:unique,actorId:actor.sub!},update:{evidenceIds:unique,actorId:actor.sub!,updatedAt:new Date()}});
     return {record:{id,order:unique}};
   });
 }
 async evidenceFile(actor:CommandActor,id:string) {
   const row=await this.db.traceEvidence.findFirst({where:{id,organizationId:actor.organizationId!}}); if(!row)throw new NotFoundException();
   await evidenceSubject(this.db,actor,row.entityType,row.entityId,'evidence.read',row.siteId??undefined);
   return row;
 }
 async publicEvidence(token:string,id?:string) {
   const qr=await this.db.traceQr.findUnique({where:{traceToken:token}}); if(!qr)throw new NotFoundException();
   const all=await this.db.traceEvidence.findMany({where:{entityType:'LOT',entityId:qr.lotId},select:{id:true,supersedesId:true,public:true,sha256:true,mediaType:true,size:true,createdAt:true}});
   const visible=all.filter(r=>r.public&&!all.some(c=>c.supersedesId===r.id));
   if(!id)return {items:visible.map(r=>({id:r.id,sha256:r.sha256,mediaType:r.mediaType,size:r.size,createdAt:r.createdAt}))};
   if(!visible.some(r=>r.id===id))throw new NotFoundException();
   return this.db.traceEvidence.findUniqueOrThrow({where:{id}});
 }
}
