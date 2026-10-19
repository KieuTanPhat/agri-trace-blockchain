import { LOT_ORIGIN_INCLUDE, lotChainId } from '../lots/lot-origin.js';
import { assertEntitlement } from '../billing/billing-core.js';
import { Body, ConflictException, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { isPastExpiry } from '../../common/expiry-date.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { enterpriseAuthority } from '../enterprise-workspace/enterprise-policy.js';
import { WorkspaceListDto, WorkspaceRecordDto } from '../enterprise-workspace/dto.js';

export class LabelPrintInput {
 @ApiProperty({format:'uuid'}) @IsUUID() lotId!:string;
 @ApiProperty({enum:['COMPACT','STANDARD']}) @IsIn(['COMPACT','STANDARD']) template!:'COMPACT'|'STANDARD';
 @ApiProperty({minimum:1,maximum:500}) @IsInt() @Min(1) @Max(500) copies!:number;
 @ApiPropertyOptional({minLength:10,maxLength:1000,description:'Required when the organization already printed labels for this lot'}) @IsOptional() @IsString() @MinLength(10) @MaxLength(1000) reason?:string;
}

/** Labels always resolve to the stable source-lot QR; printing never creates goods. */
@Injectable()
export class QrLabelsService {
 constructor(private readonly db:PrismaService){}
 print(actor:CommandActor,input:LabelPrintInput){return commandTransaction(this.db,async tx=>{
  const lot=await tx.lot.findUnique({where:{id:input.lotId},include:{product:true,organization:{select:{name:true}},harvest:{include:{cycle:true}},processingRun:true,traceQr:true}});
  if(!lot)throw new NotFoundException('Không tìm thấy lô');
  await enterpriseAuthority(tx,actor,'qr.manage',lotChainId(lot),undefined,true);
  if(lot.farmOrgId!==actor.organizationId&&!await tx.lotHolding.findUnique({where:{lotId_organizationId:{lotId:lot.id,organizationId:actor.organizationId!}}}))throw new ForbiddenException('Lô nằm ngoài phạm vi doanh nghiệp');
  if(!lot.traceQr)throw new ConflictException('Lô chưa có mã truy xuất');
  const recalled=await tx.traceNotice.findFirst({where:{lotId:lot.id,kind:'RECALL'}});
  if(recalled||isPastExpiry(lot.expiryDate)||['RECALLED','EXPIRED','DAMAGED','REJECTED'].includes(lot.currentState))throw new ConflictException('Lô đang bị thu hồi, hết hạn hoặc bị chặn; không phát hành tem mới');
  if(await tx.traceQrBlock.findFirst({where:{lotId:lot.id,unblockedAt:null}}))throw new ConflictException('Mã QR của lô đang bị nền tảng khóa; không phát hành tem mới');
  await assertEntitlement(tx,actor.organizationId!,'qrLabels',input.copies);
  const previous=await tx.traceLabelPrint.count({where:{organizationId:actor.organizationId!,lotId:lot.id}});
  if(previous&&!input.reason?.trim())throw new UnprocessableEntityException('Lô đã được in tem; ghi lý do in lại');
  const row=await tx.traceLabelPrint.create({data:{organizationId:actor.organizationId!,lotId:lot.id,actorId:actor.sub!,template:input.template,copies:input.copies,reprint:previous>0,reason:input.reason?.trim()||null}});
  return {record:{id:row.id,template:row.template,copies:row.copies,reprint:row.reprint,printedAt:row.createdAt,sequence:previous+1,lotId:lot.id,lotCode:lot.lotCode,productName:lot.product.productName,producerName:lot.organization.name,harvestTime:lot.harvest?.harvestTime??lot.processingRun?.completedAt??lot.createdAt,expiryDate:lot.expiryDate,traceToken:lot.traceQr.traceToken}};
 });}
 async history(actor:CommandActor,lotId:string){
  const lot=await this.db.lot.findUnique({where:{id:lotId},include: LOT_ORIGIN_INCLUDE});
  if(!lot)throw new NotFoundException();
  await enterpriseAuthority(this.db,actor,'qr.manage',lotChainId(lot));
  const rows=await this.db.traceLabelPrint.findMany({where:{organizationId:actor.organizationId!,lotId},orderBy:{createdAt:'desc'},take:100});
  const people=await this.db.user.findMany({where:{id:{in:[...new Set(rows.map(r=>r.actorId))]}},select:{id:true,fullName:true}});
  return {items:rows.map(r=>({...r,actorName:people.find(p=>p.id===r.actorId)?.fullName??null}))};
 }
}
@ApiTags('distribution') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('distribution/qr')
export class QrLabelsController {
 constructor(private readonly service:QrLabelsService,private readonly idem:IdempotencyService){}
 @Post('prints') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 print(@Req() req:AuthenticatedRequest,@Body() dto:LabelPrintInput,@IdempotencyKey() key:string){return this.idem.executeCommand({idempotencyKey:key,requesterId:req.user.sub,actor:req.user,responseStatus:201,requestType:'COMMAND',operation:'EW_QR_PRINT',payload:dto},()=>this.service.print(req.user,dto));}
 @Get('prints/:lotId') @ApiDataResponse(WorkspaceListDto) history(@Req() req:AuthenticatedRequest,@Param('lotId',ParseUUIDPipe) lotId:string){return this.service.history(req.user,lotId);}
}
