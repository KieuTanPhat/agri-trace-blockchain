import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query, Req, Res, UnprocessableEntityException, UploadedFile, UseGuards, UseInterceptors } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import { ApiBearerAuth, ApiBody, ApiConsumes, ApiHeader, ApiTags, ApiResponse } from '@nestjs/swagger';
import type { Response } from 'express';
import { createHash } from 'node:crypto';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { WorkspaceListDto, WorkspaceRecordDto } from './dto.js';
import { EnterpriseResourcesService, type EvidenceFile } from './enterprise-resources.service.js';
import { EvidenceCompletionInput, EvidenceInput, EvidenceWithdrawalInput, ProductPhotoOrderInput, EvidenceSubjectQuery, EvidenceUploadDocumentation, MaterialInput, MaterialRevisionInput, ProductImportInput, ProductRevisionInput } from './resources.dto.js';
import { SiteRevisionInput,VehicleRevisionInput,EvidenceContentDto } from './resources.dto.js';
import { EnterpriseRevisionListDto, ProductionMaterialListDto, TraceEvidenceListDto } from './workspace-response.dto.js';
@ApiTags('enterprise-resources') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('enterprise-workspace')
export class EnterpriseResourcesController {
 constructor(private readonly service:EnterpriseResourcesService,private readonly idem:IdempotencyService){}
 private run(req:AuthenticatedRequest,key:string,operation:string,payload:unknown,fn:()=>Promise<unknown>) {
   return this.idem.executeCommand({idempotencyKey:key,requesterId:req.user.sub,actor:req.user,responseStatus:201,operation,payload,requestType:'COMMAND'},fn);
 }
 @Post('products/:id') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 product(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ProductRevisionInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_UPDATE_PRODUCT',{id,...dto},()=>this.service.updateProduct(req.user,id,dto));}
 @Post('products/:id/photo-order') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 photoOrder(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:ProductPhotoOrderInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_ORDER_PRODUCT_PHOTOS',{id,...dto},()=>this.service.orderProductPhotos(req.user,id,dto.order));}
 @Get('revisions/:entityType/:id') @ApiDataResponse(EnterpriseRevisionListDto)
 revisions(@Req() req:AuthenticatedRequest,@Param('entityType') type:string,@Param('id',ParseUUIDPipe) id:string){return this.service.revisions(req.user,type,id);}
 @Post('sites/:id/revisions') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 site(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:SiteRevisionInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_REVISE_SITE',{id,...dto},()=>this.service.updateAsset(req.user,id,'SITE',dto));}
 @Post('sites/:id/complete') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 completeSite(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:EvidenceCompletionInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_COMPLETE_SITE',{id,...dto},()=>this.service.completeSite(req.user,id,dto.version));}
 @Post('vehicles/:id/revisions') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 vehicle(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:VehicleRevisionInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_REVISE_VEHICLE',{id,...dto},()=>this.service.updateAsset(req.user,id,'VEHICLE',dto));}
 @Get('materials') @ApiDataResponse(ProductionMaterialListDto)
 materials(@Req() req:AuthenticatedRequest){return this.service.materials(req.user);}
 @Post('materials') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 material(@Req() req:AuthenticatedRequest,@Body() dto:MaterialInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_CREATE_MATERIAL',dto,()=>this.service.saveMaterial(req.user,dto));}
 @Post('materials/:id') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 updateMaterial(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:MaterialRevisionInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_UPDATE_MATERIAL',{id,...dto},()=>this.service.saveMaterial(req.user,dto.material,id,dto));}
 @Post('materials/:id/complete') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 completeMaterial(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:EvidenceCompletionInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_COMPLETE_MATERIAL',{id,...dto},()=>this.service.completeMaterial(req.user,id,dto.version));}
 @Post('products-import/preview') @ApiDataResponse(WorkspaceRecordDto,201)
 @ApiHeader({name:'Idempotency-Key',required:true,description:'Preview request identifier; pure operation, no import is applied'})
 preview(@Req() req:AuthenticatedRequest,@Body() dto:ProductImportInput){return this.service.importPreview(req.user,dto);}
 @Post('products-import/apply') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 import(@Req() req:AuthenticatedRequest,@Body() dto:ProductImportInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_IMPORT_PRODUCTS',dto,()=>this.service.importProducts(req.user,dto));}
 @Get('evidence') @ApiDataResponse(TraceEvidenceListDto)
 evidence(@Req() req:AuthenticatedRequest,@Query() query:EvidenceSubjectQuery){return this.service.evidence(req.user,query.entityType,query.entityId,query.siteId);}
 @Post('evidence') @UseInterceptors(FileInterceptor('file',{limits:{fileSize:5*1024*1024,files:1,fields:8}})) @ApiConsumes('multipart/form-data') @ApiBody({type:EvidenceUploadDocumentation}) @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 upload(@Req() req:AuthenticatedRequest,@Body() dto:EvidenceInput,@UploadedFile() file:EvidenceFile|undefined,@IdempotencyKey() key:string){
  if(!file)throw new UnprocessableEntityException('Chọn file chứng cứ');
  const digest=createHash('sha256').update(file.buffer).digest('hex');
  return this.run(req,key,'EW_UPLOAD_EVIDENCE',{...dto,fileName:file.originalname,sha256:digest},()=>this.service.uploadEvidence(req.user,dto,file));
 }
 @Post('evidence/:id/withdraw') @ApiHeader({name:'Idempotency-Key',required:true}) @ApiDataResponse(WorkspaceRecordDto,201)
 withdraw(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Body() dto:EvidenceWithdrawalInput,@IdempotencyKey() key:string){return this.run(req,key,'EW_WITHDRAW_EVIDENCE',{id,...dto},()=>this.service.withdrawEvidence(req.user,id,dto.reason));}
 @Get('evidence/:id/file')
 @ApiResponse({status:200,description:'Private attachment, no-store',content:Object.fromEntries(['application/pdf','image/png','image/jpeg'].map(media=>[media,{schema:{type:'string',format:'binary'}}]))})
 async file(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string,@Res() res:Response){const row=await this.service.evidenceFile(req.user,id);sendFile(res,row);}
 @Get('evidence/:id/content') @ApiDataResponse(EvidenceContentDto)
 async content(@Req() req:AuthenticatedRequest,@Param('id',ParseUUIDPipe) id:string){const row=await this.service.evidenceFile(req.user,id);return {fileName:row.fileName,mediaType:row.mediaType,sha256:row.sha256,contentBase64:Buffer.from(row.content).toString('base64')};}
}
function sendFile(res:Response,row:{content:Uint8Array;mediaType:string;sha256:string}) {
 res.setHeader('Content-Type',row.mediaType);res.setHeader('Content-Disposition','attachment; filename="trace-evidence.'+(row.mediaType==='application/pdf'?'pdf':row.mediaType==='image/png'?'png':'jpg')+'"');
 res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Content-Security-Policy',"sandbox; default-src 'none'");res.setHeader('ETag','"'+row.sha256+'"');res.send(Buffer.from(row.content));
}
@ApiTags('public-trace') @Controller('trace/:token/evidence')
export class PublicEvidenceController {
 constructor(private readonly service:EnterpriseResourcesService){}
 @Get() @ApiDataResponse(WorkspaceListDto)
 list(@Param('token') token:string){return this.service.publicEvidence(token);}
 @Get(':id')
 @ApiResponse({status:200,description:'Explicitly published current source-lot attachment, no-store',content:Object.fromEntries(['application/pdf','image/png','image/jpeg'].map(media=>[media,{schema:{type:'string',format:'binary'}}]))})
 async file(@Param('token') token:string,@Param('id',ParseUUIDPipe) id:string,@Res() res:Response){const row=await this.service.publicEvidence(token,id);if(!('content'in row))throw new UnprocessableEntityException();sendFile(res,row);}
}
