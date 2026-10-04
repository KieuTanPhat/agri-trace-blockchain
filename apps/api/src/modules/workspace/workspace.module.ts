import {
  Body,
  Controller,
  Delete,
  Get,
  Module,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { HistoryQuery, MediaTarget, MediaVisibility } from './dto.js';
import { WorkspaceService } from './workspace.service.js';
import { createHash } from 'node:crypto';
import { IdempotencyModule } from '../../common/idempotency/idempotency.module.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';

function sendFile(
  res: Response,
  file: { content: Uint8Array; mime: string; name: string },
) {
  res.setHeader('Content-Type', file.mime);
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Content-Security-Policy', "default-src 'none'; sandbox");
  res.setHeader('Cache-Control', 'private, no-store');
  res.setHeader(
    'Content-Disposition',
    `inline; filename*=UTF-8''${encodeURIComponent(file.name)}`,
  );
  res.send(Buffer.from(file.content));
}
@Controller()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN', 'FARM_STAFF', 'TRANSPORTER', 'RETAILER', 'AUDITOR')
class WorkspaceController {
  constructor(
    private readonly service: WorkspaceService,
    private readonly idem: IdempotencyService,
  ) {}
  @Get('reports') reports(
    @Query() q: HistoryQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.reports(q, req.user);
  }
  @Get('reports/options') options(@Req() req: AuthenticatedRequest) {
    return this.service.reportOptions(req.user);
  }
  @Get('notifications') notifications(
    @Query() q: HistoryQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.notifications(q, req.user);
  }
  @Post('notifications/:id/read') read(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.readNotification(id, req.user);
  }
  @Get('notifications/:id/target') target(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.notificationTarget(id, req.user);
  }
  @Get('iot/history') history(
    @Query() q: HistoryQuery,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.sensorHistory(q, req.user);
  }
  @Get('iot/history/options') sensorOptions(@Req() req: AuthenticatedRequest) {
    return this.service.sensorOptions(req.user);
  }
  @Get('media') media(
    @Query() q: MediaTarget,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.mediaList(q, req.user);
  }
  @Post('media')
  @UseInterceptors(
    FileInterceptor('file', {
      limits: { fileSize: 5 * 1024 * 1024, files: 1, fields: 2 },
    }),
  )
  async upload(
    @Body() q: MediaTarget,
    @Req() req: AuthenticatedRequest,
    @IdempotencyKey() key: string,
    @UploadedFile()
    file: {
      buffer: Buffer;
      originalname: string;
      mimetype: string;
      size: number;
    },
  ) {
    await this.service.authorizeMedia(q, req.user, true);
    return this.idem.execute(
      {
        idempotencyKey: key,
        requesterId: req.user.sub,
        operation: 'UPLOAD_MEDIA',
        requestType: 'COMMAND',
        payload: {
          ...q,
          name: file?.originalname,
          mime: file?.mimetype,
          hash: createHash('sha256')
            .update(file?.buffer ?? '')
            .digest('hex'),
        },
      },
      () => this.service.upload(q, req.user, file),
    );
  }
  @Get('media/:id/content') async content(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
    @Res() res: Response,
  ) {
    sendFile(res, await this.service.mediaById(id, req.user));
  }
  @Patch('media/:id') visibility(
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: MediaVisibility,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.visibility(id, dto.isPublic, req.user);
  }
  @Delete('media/:id') remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Req() req: AuthenticatedRequest,
  ) {
    return this.service.removeMedia(id, req.user);
  }
}
@Controller('public/trace/:token/media')
class PublicMediaController {
  constructor(private readonly service: WorkspaceService) {}
  @Get() list(@Param('token') token: string) {
    return this.service.publicMedia(token);
  }
  @Get(':id/content') async content(
    @Param('token') token: string,
    @Param('id', ParseUUIDPipe) id: string,
    @Res() res: Response,
  ) {
    const file = await this.service.publicMedia(token, id);
    if (!Array.isArray(file)) sendFile(res, file);
  }
}
@Module({
  imports: [PrismaModule, AuthModule, IdempotencyModule],
  controllers: [WorkspaceController, PublicMediaController],
  providers: [WorkspaceService],
})
export class WorkspaceModule {}
