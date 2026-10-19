import { assertEntitlement } from '../billing/billing-core.js';
import { Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UseGuards } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiTags, OmitType } from '@nestjs/swagger';
import { IsByteLength, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { hash } from 'bcrypt';
import type { Prisma } from '../../generated/prisma/client.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { enterpriseAuthority } from './enterprise-policy.js';
import { EnterpriseWorkspaceService } from './enterprise-workspace.service.js';
import { EnterpriseMemberInput, WorkspaceRecordDto, type MemberRoleInput } from './dto.js';
import { EnterpriseMemberInvitationListDto } from './workspace-response.dto.js';
export class MemberInvitationInput extends OmitType(EnterpriseMemberInput,['password'] as const) {
 @ApiProperty({format:'uuid'}) @IsUUID() id!:string;
 @ApiProperty({description:'SHA-256 of a 32-byte token generated on the inviting device'}) @Matches(/^[a-f0-9]{64}$/) tokenDigest!:string;
}
export class AcceptInvitationInput {
 @ApiProperty({format:'uuid'}) @IsUUID() invitationId!:string;
 @ApiProperty({format:'uuid',description:'Keep unchanged with the original password when the result is unknown'}) @IsUUID() requestId!:string;
 @ApiProperty({writeOnly:true}) @Matches(/^[A-Za-z0-9_-]{43}$/) token!:string;
 @ApiProperty({writeOnly:true,format:'password',minLength:12,maxLength:72}) @IsString() @MinLength(12) @MaxLength(72) @IsByteLength(12,72) password!:string;
}
@Injectable()
export class MemberInvitationsService {
 constructor(private readonly db:PrismaService,private readonly workspace:EnterpriseWorkspaceService,private readonly config:ConfigService){}
 private async delegationDigest(tx:Prisma.TransactionClient,organizationId:string,roles:MemberRoleInput[]) {
  const roleIds=roles.map(r=>r.roleId),chainIds=roles.flatMap(r=>r.chainIds),siteIds=roles.flatMap(r=>r.siteIds);
  return canonicalSha256({roles:await tx.enterpriseRole.findMany({where:{organizationId,id:{in:roleIds}},orderBy:{id:'asc'},select:{id:true,version:true,permissions:true}}),memberships:await tx.chainMembership.findMany({where:{organizationId,chainId:{in:chainIds}},orderBy:{id:'asc'},select:{id:true,version:true,status:true}}),sites:await tx.enterpriseSite.findMany({where:{organizationId,id:{in:siteIds}},orderBy:{id:'asc'},select:{id:true,version:true,status:true}}),farms:(await tx.farm.findMany({where:{organizationId,id:{in:siteIds}},orderBy:{id:'asc'},select:{id:true,status:true}}))});
 }
 create(actor:CommandActor,input:MemberInvitationInput){return commandTransaction(this.db,async tx=>{
  const auth=await this.workspace.validateDelegation(tx,actor,input.roles);
  await this.workspace.validateMemberProfileReferences(tx,actor,input);
  if(!auth.primary&&input.tier!==3)throw new ForbiddenException('Cấp 2 chỉ mời thành viên cấp 3');
  const email=input.email.trim().toLowerCase();
  if(await tx.user.findFirst({where:{email}}))throw new ConflictException('Email đã có tài khoản');
  const pending=await tx.enterpriseInvitation.findFirst({where:{organizationId:actor.organizationId!,email,status:'PENDING'}});
  if(pending&&pending.expiresAt.getTime()>Date.now())throw new ConflictException('Đã có lời mời đang hiệu lực cho email này');
  if(pending)await tx.enterpriseInvitation.update({where:{id:pending.id},data:{status:'EXPIRED',version:{increment:1}}});
  const delegationDigest=await this.delegationDigest(tx,actor.organizationId!,input.roles);
  const row=await tx.enterpriseInvitation.create({data:{id:input.id,organizationId:actor.organizationId!,creatorId:actor.sub!,fullName:input.fullName.trim(),email,tier:input.tier,roles:input.roles.map(r=>({...r})),tokenDigest:input.tokenDigest,authorityScope:auth.scope,delegationDigest,expiresAt:new Date(Date.now()+72*3600000),jobTitle:input.jobTitle.trim(),phone:input.phone?.trim(),workSiteId:input.workSiteId,responsibleFarmId:input.responsibleFarmId,contactAddress:input.contactAddress?.trim(),memberNote:input.memberNote?.trim()}});
  return {record:{id:row.id,email:row.email,expiresAt:row.expiresAt,status:row.status}};
 });}
 async list(actor:CommandActor){const auth=await enterpriseAuthority(this.db,actor,'members.manage');return {items:await this.db.enterpriseInvitation.findMany({where:{organizationId:actor.organizationId!,...(!auth.primary?{creatorId:actor.sub!}:{})},select:{id:true,email:true,fullName:true,tier:true,status:true,expiresAt:true,version:true,createdAt:true},orderBy:{createdAt:'desc'},take:200})};}
 revoke(actor:CommandActor,id:string){return commandTransaction(this.db,async tx=>{const auth=await enterpriseAuthority(tx,actor,'members.manage',undefined,undefined,true);const row=await tx.enterpriseInvitation.findFirst({where:{id,organizationId:actor.organizationId!,...(!auth.primary?{creatorId:actor.sub!}:{})}});if(!row||row.status!=='PENDING')throw new ConflictException('Lời mời đã kết thúc hoặc ngoài phạm vi');return {record:await tx.enterpriseInvitation.update({where:{id},data:{status:'REVOKED',version:{increment:1}},select:{id:true,status:true,version:true}})};});}
 async accept(input:AcceptInvitationInput){
  const digest=createHash('sha256').update(input.token).digest('hex');
  const receiptDigest=createHmac('sha256',this.config.getOrThrow<string>('JWT_SECRET')).update('agritrace:member-invitation:1\0').update(JSON.stringify(input)).digest('hex');
  const passwordHash=await hash(input.password,12);
  return this.db.$transaction(async tx=>{
   const pre=await tx.enterpriseInvitation.findUnique({where:{id:input.invitationId}});if(!pre)throw new NotFoundException('Lời mời không hợp lệ');
   await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`enterprise:${pre.organizationId}`},0))`;
   await tx.$queryRaw`SELECT id FROM enterprise_invitation WHERE id=${input.invitationId}::uuid FOR UPDATE`;
   const row=await tx.enterpriseInvitation.findUniqueOrThrow({where:{id:input.invitationId}});
   if(!timingSafeEqual(Buffer.from(digest),Buffer.from(row.tokenDigest)))throw new NotFoundException('Lời mời không hợp lệ');
   if(row.status==='ACCEPTED'){
    if(row.acceptanceRequestId!==input.requestId||row.acceptanceDigest!==receiptDigest)throw new ConflictException('Lời mời đã được sử dụng; đăng nhập hoặc đối soát đúng yêu cầu cũ');
    return {record:{activated:true}};
   }
   if(row.status!=='PENDING'||row.expiresAt.getTime()<=Date.now())throw new ConflictException('Lời mời hết hạn hoặc đã thu hồi');
   const creator=await tx.user.findUniqueOrThrow({where:{id:row.creatorId},include:{role:true}});
   const actor={sub:creator.id,organizationId:row.organizationId,role:creator.role.code};
   const auth=await this.workspace.validateDelegation(tx,actor,row.roles as unknown as MemberRoleInput[]);
   await this.workspace.validateMemberProfileReferences(tx,actor,row);
   if(auth.scope!==row.authorityScope || await this.delegationDigest(tx,row.organizationId,row.roles as unknown as MemberRoleInput[])!==row.delegationDigest)throw new ForbiddenException('Quyền, nhóm hoặc phạm vi người mời đã đổi; cần lời mời mới');
   await assertEntitlement(tx,row.organizationId,'members');
   const user=await tx.user.create({data:{organizationId:row.organizationId,roleId:creator.roleId,fullName:row.fullName,email:row.email,passwordHash,enterpriseTier:row.tier,supervisorId:creator.id,jobTitle:row.jobTitle,phone:row.phone,workSiteId:row.workSiteId,responsibleFarmId:row.responsibleFarmId,contactAddress:row.contactAddress,memberNote:row.memberNote}});
   await this.workspace.assign(tx,actor,user.id,row.roles as unknown as MemberRoleInput[]);
   await tx.enterpriseInvitation.update({where:{id:row.id},data:{status:'ACCEPTED',version:{increment:1},acceptedAt:new Date(),acceptedUserId:user.id,acceptanceRequestId:input.requestId,acceptanceDigest:receiptDigest}});
   return {record:{activated:true}};
  },{timeout:20000});
 }
}
@ApiTags('enterprise-members') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('enterprise-workspace/member-invitations')
export class MemberInvitationsController {
 constructor(private readonly service:MemberInvitationsService,private readonly idem:IdempotencyService){}
 @Get() @ApiDataResponse(EnterpriseMemberInvitationListDto) list(@Req() req:AuthenticatedRequest){return this.service.list(req.user);}
 @Post() @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 create(@Req() req:AuthenticatedRequest,@Body() dto:MemberInvitationInput,@IdempotencyKey() key:string){return this.idem.executeCommand({idempotencyKey:key,requesterId:req.user.sub,actor:req.user,responseStatus:201,requestType:'COMMAND',operation:'EW_INVITE_MEMBER',payload:dto},()=>this.service.create(req.user,dto));}
 @Post(':id/revoke') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 revoke(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@IdempotencyKey() key:string){return this.idem.executeCommand({idempotencyKey:key,requesterId:req.user.sub,actor:req.user,responseStatus:201,requestType:'COMMAND',operation:'EW_REVOKE_MEMBER_INVITATION',payload:{id}},()=>this.service.revoke(req.user,id));}
}
@ApiTags('enterprise-members') @Controller('auth/member-invitations')
export class AcceptMemberInvitationController {
 constructor(private readonly service:MemberInvitationsService){}
 @Post('accept') @ApiDataResponse(WorkspaceRecordDto,201) accept(@Body() dto:AcceptInvitationInput){return this.service.accept(dto);}
}
