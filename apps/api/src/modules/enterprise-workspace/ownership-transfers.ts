import { Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiTags } from '@nestjs/swagger';
import { IsBoolean, IsInt, IsString, IsUUID, MaxLength, Min, MinLength } from 'class-validator';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { enterpriseAuthority, lockEnterprise } from './enterprise-policy.js';
import { WorkspaceListDto, WorkspaceRecordDto } from './dto.js';

const TRANSFER_TTL_MS = 7 * 24 * 3600_000;
const BUSINESS_ADMIN_ROLES = ['ORG_ADMIN', 'CREATE_CHAIN'] as const;

export class OwnershipTransferInput {
 @ApiProperty({format:'uuid'}) @IsUUID() toUserId!:string;
 @ApiProperty({description:'Keep the current owner as a level-1 administrator after acceptance'}) @IsBoolean() retainPreviousAdmin!:boolean;
 @ApiProperty({minLength:10,maxLength:1000}) @IsString() @MinLength(10) @MaxLength(1000) reason!:string;
}
export class OwnershipResolveInput {
 @ApiProperty({minimum:0}) @IsInt() @Min(0) version!:number;
 @ApiProperty({minLength:10,maxLength:1000}) @IsString() @MinLength(10) @MaxLength(1000) note!:string;
}

/** Ownership is an explicit, accepted handover. Business history, keys and
 * signatures stay attributed to the accounts that produced them. */
@Injectable()
export class OwnershipTransfersService {
 constructor(private readonly db:PrismaService){}
 async list(actor:CommandActor){
  const user=await this.member(this.db,actor);
  const admin=await this.isPrimary(this.db,user);
  const rows=await this.db.enterpriseOwnershipTransfer.findMany({where:{organizationId:actor.organizationId!,...(admin?{}:{toUserId:actor.sub!})},orderBy:{createdAt:'desc'},take:100});
  const people=await this.db.user.findMany({where:{id:{in:[...new Set(rows.flatMap(r=>[r.fromUserId,r.toUserId]))]}},select:{id:true,fullName:true,email:true}});
  const name=(id:string)=>people.find(p=>p.id===id)??null;
  return {items:rows.map(r=>({...r,expired:r.status==='PENDING'&&r.expiresAt.getTime()<=Date.now(),from:name(r.fromUserId),to:name(r.toUserId)}))};
 }
 propose(actor:CommandActor,input:OwnershipTransferInput){return commandTransaction(this.db,async tx=>{
  const auth=await enterpriseAuthority(tx,actor,'members.manage',undefined,undefined,true);
  if(!auth.primary)throw new ForbiddenException('Chỉ quản trị cấp 1 được chuyển quyền chủ quản');
  const enrollment=await tx.enterpriseEnrollment.findUnique({where:{organizationId:actor.organizationId!}});
  if(enrollment&&enrollment.ownerId!==actor.sub)throw new ForbiddenException('Chỉ chủ quản đăng ký được chuyển quyền');
  const target=await tx.user.findFirst({where:{id:input.toUserId,organizationId:actor.organizationId!},include:{role:true}});
  if(!target||target.id===actor.sub||target.accountStatus!=='ACTIVE')throw new ConflictException('Chọn thành viên khác đang hoạt động trong tổ chức');
  await tx.enterpriseOwnershipTransfer.updateMany({where:{organizationId:actor.organizationId!,status:'PENDING',expiresAt:{lte:new Date()}},data:{status:'EXPIRED',version:{increment:1},resolutionNote:'Hết hạn trước khi người nhận chấp nhận'}});
  if(await tx.enterpriseOwnershipTransfer.findFirst({where:{organizationId:actor.organizationId!,status:'PENDING'}}))throw new ConflictException('Đã có yêu cầu chuyển chủ quản đang chờ; hủy yêu cầu đó trước');
  return {record:await tx.enterpriseOwnershipTransfer.create({data:{organizationId:actor.organizationId!,fromUserId:actor.sub!,toUserId:target.id,enrollmentVersion:enrollment?.version??null,retainPreviousAdmin:input.retainPreviousAdmin,reason:input.reason.trim(),expiresAt:new Date(Date.now()+TRANSFER_TTL_MS)}})};
 });}
 accept(actor:CommandActor,id:string,input:OwnershipResolveInput){return commandTransaction(this.db,async tx=>{
  const row=await this.pending(tx,actor,id,input,'to');
  if(row.expiresAt.getTime()<=Date.now())throw new ConflictException('Yêu cầu đã hết hạn; chủ quản cần tạo yêu cầu mới');
  // The previous owner must still hold full level-1 authority at acceptance time.
  const owner=await tx.user.findUniqueOrThrow({where:{id:row.fromUserId},include:{role:true}});
  const auth=await enterpriseAuthority(tx,{sub:owner.id,organizationId:row.organizationId,role:owner.role.code},'members.manage');
  if(!auth.primary)throw new ConflictException('Người chuyển không còn quyền cấp 1; yêu cầu không còn hiệu lực');
  const enrollment=await tx.enterpriseEnrollment.findUnique({where:{organizationId:row.organizationId}});
  if(enrollment&&(enrollment.ownerId!==row.fromUserId||enrollment.version!==row.enrollmentVersion))throw new ConflictException('Hồ sơ doanh nghiệp đã đổi; chủ quản cần tạo yêu cầu mới');
  const record=await tx.enterpriseOwnershipTransfer.update({where:{id},data:{status:'ACCEPTED',version:{increment:1},resolutionNote:input.note.trim()}});
  if(enrollment)await tx.enterpriseEnrollment.update({where:{id:enrollment.id},data:{ownerId:row.toUserId,version:{increment:1}}});
  const target=await tx.user.findUniqueOrThrow({where:{id:row.toUserId}});
  await tx.user.update({where:{id:target.id},data:{enterpriseRevision:{increment:1},...(target.enterpriseTier!==1||target.supervisorId?{enterpriseTier:1,supervisorId:null}:{})}});
  for(const role of BUSINESS_ADMIN_ROLES)
   if(!await tx.scopedRoleGrant.findFirst({where:{userId:target.id,organizationId:row.organizationId,scope:'ORGANIZATION',role,revokedAt:null}}))
    await tx.scopedRoleGrant.create({data:{userId:target.id,organizationId:row.organizationId,scope:'ORGANIZATION',role}});
  if(!row.retainPreviousAdmin){
   for(const grant of await tx.scopedRoleGrant.findMany({where:{userId:row.fromUserId,organizationId:row.organizationId,scope:'ORGANIZATION',role:{in:[...BUSINESS_ADMIN_ROLES]},revokedAt:null}}))
    await tx.scopedRoleGrant.update({where:{id:grant.id},data:{revokedAt:new Date(),revision:{increment:1}}});
   const children=await tx.user.findMany({where:{organizationId:row.organizationId,supervisorId:row.fromUserId,id:{not:row.toUserId}},select:{id:true}});
   for(const child of children)await tx.user.update({where:{id:child.id},data:{supervisorId:row.toUserId,enterpriseRevision:{increment:1}}});
   await tx.user.update({where:{id:row.fromUserId},data:{enterpriseRevision:{increment:1}}});
   await tx.refreshSession.updateMany({where:{userId:row.fromUserId,revokedAt:null},data:{revokedAt:new Date()}});
  }
  return {record};
 });}
 decline(actor:CommandActor,id:string,input:OwnershipResolveInput){return commandTransaction(this.db,async tx=>{
  await this.pending(tx,actor,id,input,'to');
  return {record:await tx.enterpriseOwnershipTransfer.update({where:{id},data:{status:'DECLINED',version:{increment:1},resolutionNote:input.note.trim()}})};
 });}
 cancel(actor:CommandActor,id:string,input:OwnershipResolveInput){return commandTransaction(this.db,async tx=>{
  await this.pending(tx,actor,id,input,'from');
  return {record:await tx.enterpriseOwnershipTransfer.update({where:{id},data:{status:'CANCELLED',version:{increment:1},resolutionNote:input.note.trim()}})};
 });}
 private async pending(tx:Prisma.TransactionClient,actor:CommandActor,id:string,input:OwnershipResolveInput,party:'from'|'to'){
  await lockEnterprise(tx,actor.organizationId!);
  await this.member(tx,actor);
  const row=await tx.enterpriseOwnershipTransfer.findFirst({where:{id,organizationId:actor.organizationId!}});
  if(!row)throw new NotFoundException();
  if((party==='to'?row.toUserId:row.fromUserId)!==actor.sub)throw new ForbiddenException(party==='to'?'Chỉ người được chỉ định chấp nhận hoặc từ chối':'Chỉ người tạo yêu cầu được hủy');
  if(row.status!=='PENDING'||row.version!==input.version)throw new ConflictException('Yêu cầu đã được xử lý hoặc đã đổi');
  return row;
 }
 private async member(db:Prisma.TransactionClient,actor:CommandActor){
  if(!actor.organizationId||!actor.sub)throw new ForbiddenException('Chức năng dành cho thành viên doanh nghiệp');
  const user=await db.user.findUnique({where:{id:actor.sub},include:{organization:true}});
  if(!user||user.organizationId!==actor.organizationId||user.accountStatus!=='ACTIVE'||user.organization?.status!=='ACTIVE')throw new ForbiddenException('Tài khoản hoặc tổ chức không còn hoạt động');
  return user;
 }
 private async isPrimary(db:Prisma.TransactionClient,user:{id:string;organizationId:string|null;enterpriseTier:number|null}){
  return (user.enterpriseTier===null||user.enterpriseTier===1)&&!!await db.scopedRoleGrant.findFirst({where:{userId:user.id,organizationId:user.organizationId!,scope:'ORGANIZATION',role:'ORG_ADMIN',revokedAt:null}});
 }
}
@ApiTags('enterprise-members') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('enterprise-workspace/ownership-transfers')
export class OwnershipTransfersController {
 constructor(private readonly service:OwnershipTransfersService,private readonly idem:IdempotencyService){}
 private command(req:AuthenticatedRequest,key:string,operation:string,payload:unknown,run:()=>Promise<unknown>){return this.idem.executeCommand({idempotencyKey:key,requesterId:req.user.sub,actor:req.user,responseStatus:201,requestType:'COMMAND',operation,payload},run);}
 @Get() @ApiDataResponse(WorkspaceListDto) list(@Req() req:AuthenticatedRequest){return this.service.list(req.user);}
 @Post() @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201) propose(@Req() req:AuthenticatedRequest,@Body() dto:OwnershipTransferInput,@IdempotencyKey() key:string){return this.command(req,key,'EW_OWNERSHIP_PROPOSE',dto,()=>this.service.propose(req.user,dto));}
 @Post(':id/accept') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201) accept(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:OwnershipResolveInput,@IdempotencyKey() key:string){return this.command(req,key,'EW_OWNERSHIP_ACCEPT',{id,...dto},()=>this.service.accept(req.user,id,dto));}
 @Post(':id/decline') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201) decline(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:OwnershipResolveInput,@IdempotencyKey() key:string){return this.command(req,key,'EW_OWNERSHIP_DECLINE',{id,...dto},()=>this.service.decline(req.user,id,dto));}
 @Post(':id/cancel') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201) cancel(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:OwnershipResolveInput,@IdempotencyKey() key:string){return this.command(req,key,'EW_OWNERSHIP_CANCEL',{id,...dto},()=>this.service.cancel(req.user,id,dto));}
}
