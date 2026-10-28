import {
  Body,
  ConflictException,
  Controller,
  Get,
  Headers,
  Injectable,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  ServiceUnavailableException,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiTags } from '@nestjs/swagger';
import { randomUUID } from 'node:crypto';
import { ApiDataResponse } from '../../common/api/openapi.js';
import {
  openSecret,
  platformSecretKey,
  sealSecret,
} from '../../common/crypto/secret-box.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import type { PlatformPrivacyTicket } from '../../generated/prisma/client.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { appendPlatformAudit } from './platform-audit.js';
import { PlatformMfaService } from './platform-mfa.service.js';
import {
  CreatePrivacyBreachDto,
  CreatePrivacyRequestDto,
  PrivacyDetailDto,
  PrivacyPageDto,
  PrivacyQueryDto,
  PrivacyTicketDto,
  UpdatePrivacyTicketDto,
} from './privacy.dto.js';

export const privacyAad = (id: string) => `platform-privacy:${id}`;
export const privacyEventAad = (id: string) => `platform-privacy-event:${id}`;
function encryptionKey() {
  try {
    return platformSecretKey();
  } catch {
    throw new ServiceUnavailableException('Hộp thư chưa được cấu hình mã hóa');
  }
}
function view(row: PlatformPrivacyTicket) {
  return {
    id: row.id,
    kind: row.kind,
    requestType: row.requestType,
    status: row.status,
    reporting: row.reporting,
    detectedAt: row.detectedAt,
    deadlineAt: row.deadlineAt,
    reportedAt: row.reportedAt,
    overdue:
      row.kind === 'BREACH' &&
      row.reporting !== 'NOT_REQUIRED' &&
      !row.reportedAt &&
      !!row.deadlineAt &&
      row.deadlineAt.getTime() < Date.now(),
    version: row.version,
    createdAt: row.createdAt,
  };
}

/** Encryption at rest; private text never reaches audit or command responses.
 * Rights requests are a human review queue, never an automatic data eraser. */
@Injectable()
export class PlatformPrivacyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly mfa: PlatformMfaService,
  ) {}

  async list(actor: CommandActor, admin: boolean, query: PrivacyQueryDto) {
    const rows = await this.prisma.platformPrivacyTicket.findMany({
      where: admin ? {} : { kind: 'REQUEST', requesterId: actor.sub! },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 51,
      ...(query.cursor ? { cursor: { id: query.cursor }, skip: 1 } : {}),
    });
    return {
      items: rows.slice(0, 50).map(view),
      nextCursor: rows.length > 50 ? rows[49].id : null,
    };
  }

  async detail(actor: CommandActor, id: string, admin: boolean) {
    const row = await this.prisma.platformPrivacyTicket.findFirst({
      where: {
        id,
        ...(admin ? {} : { kind: 'REQUEST', requesterId: actor.sub! }),
      },
      include: {
        events: {
          where: admin ? {} : { visibility: 'SHARED' },
          orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (!row)
      throw new NotFoundException('Không tìm thấy hồ sơ dữ liệu cá nhân');
    const key = encryptionKey();
    try {
      return {
        ...view(row),
        message: openSecret(row.payloadCiphertext, privacyAad(row.id), key),
        events: row.events.map((event) => {
          const payload = JSON.parse(
            openSecret(event.payloadCiphertext, privacyEventAad(event.id), key),
          ) as { note: string; notificationReference?: string };
          return {
            id: event.id,
            action: event.action,
            visibility: event.visibility,
            createdAt: event.createdAt,
            note: payload.note,
            notificationReference: admin
              ? (payload.notificationReference ?? null)
              : null,
          };
        }),
      };
    } catch {
      throw new ServiceUnavailableException(
        'Không giải mã được hồ sơ; cần operator đối soát khóa',
      );
    }
  }

  create(
    actor: CommandActor,
    input: CreatePrivacyRequestDto | CreatePrivacyBreachDto,
    breach: boolean,
    mfaCode?: string,
  ) {
    const key = encryptionKey();
    const id = randomUUID();
    const detectedAt = breach
      ? new Date((input as CreatePrivacyBreachDto).detectedAt)
      : null;
    if (detectedAt && detectedAt.getTime() > Date.now())
      throw new UnprocessableEntityException(
        'Thời điểm phát hiện không được ở tương lai',
      );
    return commandTransaction(this.prisma, async (tx) => {
      if (breach)
        await this.mfa.assertStepUp(
          tx,
          { sub: actor.sub!, role: actor.role },
          mfaCode,
        );
      const row = await tx.platformPrivacyTicket.create({
        data: {
          id,
          kind: breach ? 'BREACH' : 'REQUEST',
          requestType: breach
            ? 'INCIDENT'
            : (input as CreatePrivacyRequestDto).requestType,
          requesterId: breach ? null : actor.sub!,
          createdBy: actor.sub!,
          payloadCiphertext: sealSecret(
            input.message.trim(),
            privacyAad(id),
            key,
          ),
          detectedAt,
          deadlineAt: detectedAt
            ? new Date(detectedAt.getTime() + 72 * 3_600_000)
            : null,
        },
      });
      await appendPlatformAudit(tx, {
        actor: breach ? actor : null,
        action: breach ? 'PRIVACY_BREACH_CREATED' : 'PRIVACY_REQUEST_CREATED',
        subjectType: 'PRIVACY_TICKET',
        subjectId: id,
        details: {
          kind: row.kind,
          deadlineAt: row.deadlineAt?.toISOString() ?? null,
        },
      });
      return view(row);
    });
  }

  update(
    actor: CommandActor,
    id: string,
    input: UpdatePrivacyTicketDto,
    mfaCode?: string,
  ) {
    const key = encryptionKey();
    return commandTransaction(this.prisma, async (tx) => {
      await this.mfa.assertStepUp(
        tx,
        { sub: actor.sub!, role: actor.role },
        mfaCode,
      );
      await tx.$queryRaw`SELECT id FROM platform_privacy_ticket WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.platformPrivacyTicket.findUnique({ where: { id } });
      if (!row)
        throw new NotFoundException('Không tìm thấy hồ sơ dữ liệu cá nhân');
      if (
        row.version !== input.version ||
        ['CLOSED', 'REJECTED'].includes(row.status)
      )
        throw new ConflictException(
          'Hồ sơ đã đổi hoặc đã đóng; tải lại trạng thái',
        );
      const reporting = input.reporting ?? row.reporting;
      if (input.reporting === 'NOT_REQUIRED' && input.note.trim().length < 20)
        throw new UnprocessableEntityException(
          'Cần căn cứ ít nhất 20 ký tự khi đánh giá không phải báo cáo',
        );
      if (
        row.kind === 'REQUEST' &&
        input.status === 'RESPONDED' &&
        input.visibility !== 'SHARED'
      )
        throw new UnprocessableEntityException(
          'Phản hồi phải được chia sẻ cho người yêu cầu',
        );
      let reportedAt = row.reportedAt;
      if (
        row.kind === 'REQUEST' &&
        (input.reporting || input.reportedAt || input.notificationReference)
      )
        throw new UnprocessableEntityException(
          'Đồng hồ báo cáo chỉ áp dụng cho sự cố',
        );
      if (input.reportedAt) {
        const value = new Date(input.reportedAt);
        if (
          row.reportedAt ||
          !input.notificationReference?.trim() ||
          value > new Date() ||
          value < row.detectedAt!
        )
          throw new UnprocessableEntityException(
            'Cần thời điểm thông báo hợp lệ và tham chiếu bằng chứng',
          );
        reportedAt = value;
      } else if (input.notificationReference)
        throw new UnprocessableEntityException('Thiếu thời điểm đã thông báo');
      if (
        row.kind === 'BREACH' &&
        ['CLOSED', 'REJECTED'].includes(input.status) &&
        !(
          reporting === 'NOT_REQUIRED' ||
          (reporting === 'REQUIRED' && reportedAt)
        )
      )
        throw new UnprocessableEntityException(
          'Phải đánh giá nghĩa vụ báo cáo và lưu bằng chứng trước khi đóng',
        );
      const eventId = randomUUID();
      await tx.platformPrivacyEvent.create({
        data: {
          id: eventId,
          ticketId: id,
          actorId: actor.sub!,
          action: input.reportedAt ? 'REPORTED' : input.status,
          visibility:
            row.kind === 'BREACH'
              ? 'INTERNAL'
              : (input.visibility ?? 'INTERNAL'),
          payloadCiphertext: sealSecret(
            JSON.stringify({
              note: input.note.trim(),
              notificationReference: input.notificationReference?.trim(),
            }),
            privacyEventAad(eventId),
            key,
          ),
        },
      });
      const next = await tx.platformPrivacyTicket.update({
        where: { id },
        data: {
          status: input.status,
          reporting,
          reportedAt,
          version: { increment: 1 },
        },
      });
      await appendPlatformAudit(tx, {
        actor,
        action: 'PRIVACY_TICKET_UPDATED',
        subjectType: 'PRIVACY_TICKET',
        subjectId: id,
        details: {
          status: next.status,
          reporting: next.reporting,
          reportedAt: next.reportedAt?.toISOString() ?? null,
          version: next.version,
        },
      });
      return view(next);
    });
  }
}

function execute(
  idem: IdempotencyService,
  req: AuthenticatedRequest,
  key: string,
  operation: string,
  payload: object,
  work: () => Promise<unknown>,
) {
  return idem.executeCommand(
    {
      actor: req.user,
      requesterId: req.user.sub,
      idempotencyKey: key,
      responseStatus: 201,
      requestType: 'COMMAND',
      operation,
      payload,
    },
    work,
  );
}

@ApiTags('privacy-requests')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Controller('privacy-requests')
export class PrivacyRequestsController {
  constructor(
    private readonly service: PlatformPrivacyService,
    private readonly idem: IdempotencyService,
  ) {}
  @ApiDataResponse(PrivacyPageDto)
  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: PrivacyQueryDto) {
    return this.service.list(req.user, false, query);
  }
  @ApiDataResponse(PrivacyDetailDto)
  @Get(':id')
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(req.user, id, false);
  }
  @ApiDataResponse(PrivacyTicketDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post()
  create(
    @Req() req: AuthenticatedRequest,
    @Body() input: CreatePrivacyRequestDto,
    @IdempotencyKey() key: string,
  ) {
    return execute(this.idem, req, key, 'PRIVACY_REQUEST_CREATE', input, () =>
      this.service.create(req.user, input, false),
    );
  }
}

@ApiTags('platform-privacy')
@ApiBearerAuth()
@UseGuards(JwtAuthGuard, RolesGuard)
@Roles('SYSTEM_ADMIN', 'PLATFORM_PRIVACY_OFFICER')
@Controller('platform-privacy')
export class PlatformPrivacyController {
  constructor(
    private readonly service: PlatformPrivacyService,
    private readonly idem: IdempotencyService,
  ) {}
  @ApiDataResponse(PrivacyPageDto)
  @Get()
  list(@Req() req: AuthenticatedRequest, @Query() query: PrivacyQueryDto) {
    return this.service.list(req.user, true, query);
  }
  @ApiDataResponse(PrivacyDetailDto)
  @Get(':id')
  detail(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.service.detail(req.user, id, true);
  }
  @ApiDataResponse(PrivacyTicketDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post('breaches')
  @ApiHeader({
    name: 'X-MFA-Code',
    required: false,
    description: 'Bắt buộc khi đã bật MFA hoặc policy REQUIRED',
  })
  breach(
    @Req() req: AuthenticatedRequest,
    @Body() input: CreatePrivacyBreachDto,
    @IdempotencyKey() key: string,
    @Headers('x-mfa-code') code?: string,
  ) {
    return execute(
      this.idem,
      req,
      key,
      'PLATFORM_PRIVACY_BREACH_CREATE',
      input,
      () => this.service.create(req.user, input, true, code),
    );
  }
  @ApiDataResponse(PrivacyTicketDto, 201)
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @Post(':id/review')
  @ApiHeader({
    name: 'X-MFA-Code',
    required: false,
    description: 'Bắt buộc khi đã bật MFA hoặc policy REQUIRED',
  })
  review(
    @Req() req: AuthenticatedRequest,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() input: UpdatePrivacyTicketDto,
    @IdempotencyKey() key: string,
    @Headers('x-mfa-code') code?: string,
  ) {
    return execute(
      this.idem,
      req,
      key,
      'PLATFORM_PRIVACY_UPDATE',
      { ...input, id },
      () => this.service.update(req.user, id, input, code),
    );
  }
}
