import { Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsEmail, IsIn, IsInt, IsOptional, IsString, IsUUID, IsUrl, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { Prisma, OrganizationType } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandResponseJson, commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { enterpriseAuthority, profileAuthority } from './enterprise-policy.js';
import { WorkspaceRecordDto } from './dto.js';
import { OwnProfileWorkspaceRecordDto, ProfileAmendmentDetailRecordDto, ProfileAmendmentListDto, ProfileEvidenceContentRecordDto } from './workspace-response.dto.js';
import { VIETNAM_ADDRESSES } from '../enterprise-onboarding/address-catalog.js';
import { LEGAL_FORMS, REGISTERED_FORMS, RegistrationProductionDetails } from '../enterprise-onboarding/registration-profile.dto.js';
import { appendPlatformAudit, lockPlatformAudit } from '../platform-governance/platform-audit.js';

import { registrationEmailInUse } from '../enterprise-onboarding/registration-email.js';
export class ProfileVersionInput {
 @ApiProperty({minimum:0}) @IsInt() @Min(0) version!:number;
 @ApiProperty({minLength:10,maxLength:1000}) @IsString() @MinLength(10) @MaxLength(1000) reason!:string;
}
export class ProfileContactInput extends ProfileVersionInput {
 @ApiProperty({maxLength:30}) @IsString() @MinLength(5) @MaxLength(30) phone!:string;
 @ApiProperty() @IsEmail() @MaxLength(255) contactEmail!:string;
 @ApiProperty({maxLength:255}) @IsString() @MaxLength(255) @IsUrl({protocols:['https','http'],require_protocol:true},{each:false, message:'Website cần URL http(s) hợp lệ'}) @IsOptional() website?:string;
 @ApiProperty({maxLength:2000}) @IsString() @MaxLength(2000) description!:string;
}
export class LegalProfileInput {
 @ApiProperty({maxLength:255}) @IsString() @MinLength(2) @MaxLength(255) name!:string;
 @ApiProperty({enum:LEGAL_FORMS}) @IsIn(LEGAL_FORMS) legalForm!:string;
 @ApiProperty({required:false,maxLength:40}) @IsOptional() @IsString() @MaxLength(40) businessId?:string;
 @ApiProperty({maxLength:500}) @IsString() @MinLength(5) @MaxLength(500) address!:string;
 @ApiProperty() @IsString() @MaxLength(2) provinceCode!:string;
 @ApiProperty() @IsString() @MaxLength(5) wardCode!:string;
 @ApiProperty({maxLength:255}) @IsString() @MinLength(2) @MaxLength(255) representative!:string;
 @ApiProperty({type:[String],enum:['FARM','TRANSPORTER','DISTRIBUTOR','RETAILER']}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(4) @ArrayUnique() @IsIn(['FARM','TRANSPORTER','DISTRIBUTOR','RETAILER'],{each:true}) activities!:string[];
 @ApiProperty({required:false,maxLength:100}) @IsOptional() @IsString() @MaxLength(100) registrationNumber?:string;
 @ApiProperty({required:false,maxLength:100}) @IsOptional() @IsString() @MaxLength(100) representativeTitle?:string;
 @ApiProperty({required:false,type:RegistrationProductionDetails}) @IsOptional() @ValidateNested() @Type(()=>RegistrationProductionDetails) production?:RegistrationProductionDetails;
}
export class SubmitProfileInput extends ProfileVersionInput {
 @ApiProperty({type:LegalProfileInput}) @ValidateNested() @Type(()=>LegalProfileInput) profile!:LegalProfileInput;
 @ApiProperty({type:[String],format:'uuid'}) @IsArray() @ArrayMinSize(1) @ArrayMaxSize(8) @ArrayUnique() @IsUUID(undefined,{each:true}) evidenceIds!:string[];
}
export class ReviewProfileInput extends ProfileVersionInput {
 @ApiProperty({enum:['APPROVE','REJECT']}) @IsIn(['APPROVE','REJECT']) decision!:'APPROVE'|'REJECT';
}
@Injectable()
export class ProfileAmendmentsService {
 constructor(private readonly db:PrismaService){}
 async mine(actor:CommandActor) {
  await profileAuthority(this.db,actor);
  const org=await this.db.organization.findUniqueOrThrow({where:{id:actor.organizationId!},include:{profile:true,enterpriseEnrollment:{select:{businessId:true,status:true,ownerId:true}}}});
  const history=await this.db.enterpriseRevision.findMany({where:{organizationId:org.id,entityType:'PROFILE',entityId:org.id},orderBy:{version:'desc'},take:100});
  const amendments=await this.db.enterpriseProfileAmendment.findMany({where:{organizationId:org.id},orderBy:{createdAt:'desc'},take:100});
  return {record:{organization:{id:org.id,name:org.name},profile:org.profile,enrollment:org.enterpriseEnrollment,history,amendments}};
 }
 private async archive(tx:Prisma.TransactionClient,actor:CommandActor,reason:string) {
  const org=await tx.organization.findUniqueOrThrow({where:{id:actor.organizationId!},include:{profile:true}});
  if(!org.profile)throw new NotFoundException('Tổ chức chưa có hồ sơ');
  await tx.enterpriseRevision.create({data:{organizationId:org.id,entityType:'PROFILE',entityId:org.id,version:org.profile.version,snapshot:commandResponseJson({name:org.name,...org.profile}),reason,actorId:actor.sub!}});
  return org;
 }
 contact(actor:CommandActor,input:ProfileContactInput) {return commandTransaction(this.db,async tx=>{
  await profileAuthority(tx,actor,true);
  const profile=await tx.enterpriseProfile.findUnique({where:{organizationId:actor.organizationId!}});
  if(!profile||profile.version!==input.version)throw new ConflictException('Hồ sơ đã đổi; tải lại phiên bản');
  if(await tx.enterpriseProfileAmendment.findFirst({where:{organizationId:actor.organizationId!,status:'PENDING'}}))throw new ConflictException('Rút hồ sơ đang chờ duyệt trước khi thay đổi thông tin liên hệ');
  const contactEmail=input.contactEmail.trim().toLowerCase();
  if(contactEmail!==profile.contactEmail.toLowerCase()&&await registrationEmailInUse(tx,contactEmail))throw new ConflictException('Email liên hệ đã được sử dụng trong hệ thống; dùng email khác');
  const org=await tx.organization.findUniqueOrThrow({where:{id:actor.organizationId!}});
  // Contact changes are reviewed like legal ones: the request keeps every
  // effective legal field and only replaces the contact block.
  const target={name:org.name,legalForm:profile.legalForm,address:profile.address,province:profile.province,provinceCode:profile.provinceCode,ward:profile.ward,wardCode:profile.wardCode,representative:profile.representative,activities:[...profile.activities].sort(),legalData:profile.legalData,phone:input.phone.trim(),contactEmail,website:input.website?.trim()||null,description:input.description.trim()||null};
  return {record:await tx.enterpriseProfileAmendment.create({data:{organizationId:org.id,creatorId:actor.sub!,profileVersion:input.version,organizationVersion:org.version,target:commandResponseJson(target),evidenceIds:[],reason:input.reason}})};
 });}
 submit(actor:CommandActor,input:SubmitProfileInput){return commandTransaction(this.db,async tx=>{
  await profileAuthority(tx,actor,true);
  const org=await tx.organization.findUniqueOrThrow({where:{id:actor.organizationId!},include:{profile:true,enterpriseEnrollment:true}});
  if(org.enterpriseEnrollment?.ownerId!==actor.sub && !(await enterpriseAuthority(tx,actor,'profile.manage')).primary)throw new ForbiddenException('Chủ quản gửi hồ sơ pháp lý');
  if(!org.profile||org.profile.version!==input.version)throw new ConflictException('Phiên bản hồ sơ đã đổi');
  if(await tx.enterpriseProfileAmendment.findFirst({where:{organizationId:org.id,status:'PENDING'}}))throw new ConflictException('Đã có hồ sơ điều chỉnh đang chờ duyệt; rút hồ sơ đó trước khi gửi bản mới');
  const p=input.profile, province=VIETNAM_ADDRESSES.find(v=>v.code===p.provinceCode),ward=province?.wards.find(v=>v.code===p.wardCode);
  const businessId=p.businessId?.trim().replace(/[-\s]/g,'')||null;
  if(!province||!ward)throw new ConflictException('Chọn tỉnh/thành và xã/phường từ danh mục');
  if(businessId&&!/^(?:\d{10}|\d{12}|\d{13})$/.test(businessId))throw new ConflictException('Mã pháp lý không hợp lệ');
  if(REGISTERED_FORMS.includes(p.legalForm)&&(!businessId||!p.registrationNumber?.trim()||!p.representativeTitle?.trim()))throw new ConflictException('Bổ sung mã pháp lý, giấy đăng ký và chức vụ đại diện');
  if(['ENTERPRISE','COOPERATIVE'].includes(p.legalForm)&&businessId?.length===12)throw new ConflictException('Mã số 12 chữ số chỉ dành cho hộ kinh doanh');
  if(['PRODUCER_HOUSEHOLD','INDIVIDUAL_PRODUCER'].includes(p.legalForm)&&!p.activities.includes('FARM'))throw new ConflictException('Hộ/cá nhân sản xuất cần năng lực sản xuất');
  if(p.activities.includes('FARM')!==!!p.production)throw new ConflictException('Khai báo sản xuất CROP khi chọn năng lực sản xuất');
  if(await tx.traceEvidence.count({where:{id:{in:input.evidenceIds},organizationId:org.id,entityType:'PROFILE',entityId:org.id}})!==input.evidenceIds.length)throw new ForbiddenException('Chọn chứng cứ pháp lý riêng tư của tổ chức');
  const target={name:p.name.trim(),legalForm:p.legalForm,address:p.address.trim(),province:province.name,provinceCode:province.code,ward:ward.name,wardCode:ward.code,representative:p.representative.trim(),activities:[...p.activities].sort(),legalData:{businessId,registrationNumber:p.registrationNumber?.trim()||null,representativeTitle:p.representativeTitle?.trim()||null,production:p.production??null}};
  return {record:await tx.enterpriseProfileAmendment.create({data:{organizationId:org.id,creatorId:actor.sub!,profileVersion:input.version,organizationVersion:org.version,target:commandResponseJson(target),evidenceIds:input.evidenceIds,reason:input.reason}})};
 });}
 withdraw(actor:CommandActor,id:string,input:ProfileVersionInput){return commandTransaction(this.db,async tx=>{
  await profileAuthority(tx,actor,true);
  const row=await tx.enterpriseProfileAmendment.findFirst({where:{id,organizationId:actor.organizationId!,creatorId:actor.sub!}});
  if(!row||row.status!=='PENDING'||row.version!==input.version)throw new ConflictException('Hồ sơ đã xử lý hoặc không thuộc người gửi');
  return {record:await tx.enterpriseProfileAmendment.update({where:{id},data:{status:'WITHDRAWN',version:{increment:1}}})};
 });}
 async list(actor:CommandActor){
  if(actor.role!=='SYSTEM_ADMIN')throw new ForbiddenException();
  const rows=await this.db.enterpriseProfileAmendment.findMany({orderBy:[{status:'desc'},{createdAt:'desc'}],take:200});
  const orgs=await this.db.organization.findMany({where:{id:{in:[...new Set(rows.map(r=>r.organizationId))]}},select:{id:true,name:true}});
  return {items:rows.map(r=>({...r,organizationName:orgs.find(o=>o.id===r.organizationId)?.name??null}))};
 }
 /** Admin compares the effective profile with the immutable requested snapshot. */
 async detail(actor:CommandActor,id:string){
  if(actor.role!=='SYSTEM_ADMIN')throw new ForbiddenException();
  const row=await this.db.enterpriseProfileAmendment.findUnique({where:{id}});if(!row)throw new NotFoundException();
  const org=await this.db.organization.findUniqueOrThrow({where:{id:row.organizationId},include:{profile:true,enterpriseEnrollment:{select:{status:true,businessId:true}}}});
  const evidence=await this.db.traceEvidence.findMany({where:{id:{in:row.evidenceIds},organizationId:row.organizationId,entityType:'PROFILE'},select:{id:true,fileName:true,mediaType:true,size:true,sha256:true,description:true,createdAt:true}});
  return {record:{amendment:row,organization:{id:org.id,name:org.name,version:org.version},profile:org.profile,enrollment:org.enterpriseEnrollment,evidence,stale:!org.profile||org.profile.version!==row.profileVersion||org.version!==row.organizationVersion}};
 }
 async evidence(actor:CommandActor,id:string,evidenceId:string){
  if(actor.role!=='SYSTEM_ADMIN')throw new ForbiddenException();
  const row=await this.db.enterpriseProfileAmendment.findUnique({where:{id}});
  if(!row?.evidenceIds.includes(evidenceId))throw new NotFoundException();
  const file=await this.db.traceEvidence.findFirst({where:{id:evidenceId,organizationId:row.organizationId,entityType:'PROFILE'}});if(!file)throw new NotFoundException();
  return {record:{fileName:file.fileName,mediaType:file.mediaType,sha256:file.sha256,contentBase64:Buffer.from(file.content).toString('base64')}};
 }
 review(actor:CommandActor,id:string,input:ReviewProfileInput){return commandTransaction(this.db,async tx=>{
  if(actor.role!=='SYSTEM_ADMIN')throw new ForbiddenException();
  await lockPlatformAudit(tx);
  const pre=await tx.enterpriseProfileAmendment.findUnique({where:{id}});if(!pre)throw new NotFoundException();
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enterprise:${pre.organizationId}`},0))`;
  const row=await tx.enterpriseProfileAmendment.findUniqueOrThrow({where:{id}}), org=await tx.organization.findUniqueOrThrow({where:{id:row.organizationId},include:{profile:true,enterpriseEnrollment:true}});
  if(row.status!=='PENDING'||row.version!==input.version)throw new ConflictException('Hồ sơ đã được xử lý');
  const p=row.target as Record<string,Prisma.JsonValue>;
  if(input.decision==='APPROVE') {
   if(!org.profile||org.profile.version!==row.profileVersion||org.version!==row.organizationVersion)throw new ConflictException('Dữ liệu hiệu lực đã đổi; tổ chức cần gửi lại hồ sơ');
   const codes=p.activities as OrganizationType[], removed=org.profile.activities.filter(c=>!codes.includes(c as OrganizationType));
   const carrierTransfers=removed.length?await tx.distributionTransfer.findMany({where:{carrierId:org.id},select:{id:true}}):[];
   if(removed.length && (await tx.chainMembership.count({where:{organizationId:org.id,status:'ACTIVE'}})||await tx.lotHolding.count({where:{organizationId:org.id,quantity:{gt:0}}})||await tx.distributionTransfer.count({where:{OR:[{senderId:org.id},{carrierId:org.id},{receiverId:org.id}],status:{in:['PROPOSED','READY','IN_TRANSIT']}}})||await tx.distributionRemainder.count({where:{quantity:{gt:0},transferId:{in:carrierTransfers.map(t=>t.id)}}})))throw new ConflictException('Đóng nghiệp vụ, tồn và phạm vi chuỗi trước khi bỏ năng lực');
   const businessId=(p.legalData as Record<string,Prisma.JsonValue>).businessId;
   if(businessId && (await tx.enterpriseEnrollment.findFirst({where:{organizationId:{not:org.id},businessId:String(businessId)}})||await tx.enterpriseProfile.findFirst({where:{organizationId:{not:org.id},legalData:{path:['businessId'],equals:businessId}}})))throw new ConflictException('Mã pháp lý đã thuộc tổ chức khác');
  }
  const updated=await tx.enterpriseProfileAmendment.update({where:{id},data:{status:input.decision==='APPROVE'?'APPROVED':'REJECTED',version:{increment:1},reviewedBy:actor.sub!,reviewNote:input.reason,reviewedAt:new Date()}});
  if(input.decision==='APPROVE') {
   const ownerActor={...actor,organizationId:org.id};await this.archive(tx,ownerActor,`Duyệt ${id}: ${input.reason}`.slice(0,1000));
   const {name,...profile}=p;
   await tx.enterpriseProfile.update({where:{organizationId:org.id},data:{...profile,version:{increment:1}} as Prisma.EnterpriseProfileUpdateInput});
   await tx.organization.update({where:{id:org.id},data:{name:String(name),version:{increment:1}}});
   // Rejected initial registrations use a new reviewable snapshot; initial evidence remains immutable.
   if(org.enterpriseEnrollment?.status==='REJECTED')await tx.enterpriseEnrollment.update({where:{id:org.enterpriseEnrollment.id},data:{status:'PENDING_REVIEW',reviewedBy:null,reviewNote:null,version:{increment:1}}});
   const enabled=!org.enterpriseEnrollment || (org.enterpriseEnrollment.status==='APPROVED'&&!!org.enterpriseEnrollment.serviceActivatedAt);
   if(enabled){
    for(const cap of await tx.organizationCapability.findMany({where:{organizationId:org.id,revokedAt:null}}))if(!(p.activities as string[]).includes(cap.code))await tx.organizationCapability.update({where:{organizationId_code:{organizationId:org.id,code:cap.code}},data:{revokedAt:new Date(),revision:{increment:1}}});
    for(const code of p.activities as OrganizationType[]){const old=await tx.organizationCapability.findUnique({where:{organizationId_code:{organizationId:org.id,code}}});if(!old)await tx.organizationCapability.create({data:{organizationId:org.id,code}});else if(old.revokedAt)await tx.organizationCapability.update({where:{organizationId_code:{organizationId:org.id,code}},data:{revokedAt:null,revision:{increment:1}}});}
   }
  }
  await appendPlatformAudit(tx,{actor,action:'ENTERPRISE_PROFILE_REVIEWED',subjectType:'PROFILE_AMENDMENT',subjectId:id,organizationId:org.id,reason:input.reason,details:{decision:input.decision,profileVersion:row.profileVersion}});
  return {record:updated};
 });}
}
@ApiTags('enterprise-profile') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('enterprise-workspace/profile')
export class ProfileAmendmentsController {
 constructor(private readonly service:ProfileAmendmentsService,private readonly idem:IdempotencyService){}
 private command(req:AuthenticatedRequest,key:string,operation:string,payload:unknown,run:()=>Promise<unknown>){return this.idem.executeCommand({idempotencyKey:key,requesterId:req.user.sub,actor:req.user,responseStatus:201,requestType:'COMMAND',operation,payload},run);}
 @Get() @ApiDataResponse(OwnProfileWorkspaceRecordDto) mine(@Req() req:AuthenticatedRequest){return this.service.mine(req.user);}
 @Post('contact') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201) contact(@Req() req:AuthenticatedRequest,@Body() dto:ProfileContactInput,@IdempotencyKey() key:string){return this.command(req,key,'EW_PROFILE_CONTACT',dto,()=>this.service.contact(req.user,dto));}
 @Post('amendments') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201) submit(@Req() req:AuthenticatedRequest,@Body() dto:SubmitProfileInput,@IdempotencyKey() key:string){return this.command(req,key,'EW_PROFILE_SUBMIT',dto,()=>this.service.submit(req.user,dto));}
 @Post('amendments/:id/withdraw') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201) withdraw(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ProfileVersionInput,@IdempotencyKey() key:string){return this.command(req,key,'EW_PROFILE_WITHDRAW',{id,...dto},()=>this.service.withdraw(req.user,id,dto));}
}
@ApiTags('enterprise-profile-review') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('enterprise-profile-amendments')
export class ProfileReviewController {
 constructor(private readonly service:ProfileAmendmentsService,private readonly idem:IdempotencyService){}
 @Get() @ApiDataResponse(ProfileAmendmentListDto) list(@Req() req:AuthenticatedRequest){return this.service.list(req.user);}
 @Get(':id') @ApiDataResponse(ProfileAmendmentDetailRecordDto) detail(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string){return this.service.detail(req.user,id);}
 @Get(':id/evidence/:evidenceId') @ApiDataResponse(ProfileEvidenceContentRecordDto) evidence(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Param('evidenceId',ParseUUIDPipe) evidenceId:string){return this.service.evidence(req.user,id,evidenceId);}
 @Post(':id/review') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201) review(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ReviewProfileInput,@IdempotencyKey() key:string){return this.idem.executeCommand({idempotencyKey:key,requesterId:req.user.sub,actor:req.user,responseStatus:201,requestType:'COMMAND',operation:'ENTERPRISE_PROFILE_REVIEW',payload:{id,...dto}},()=>this.service.review(req.user,id,dto));}
}
