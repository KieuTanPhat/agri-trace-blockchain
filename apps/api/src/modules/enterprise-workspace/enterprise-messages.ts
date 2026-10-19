import { Body, Controller, ForbiddenException, Get, Injectable, NotFoundException, Param, ParseUUIDPipe, Post, Req, UnprocessableEntityException, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiHeader, ApiProperty, ApiTags } from '@nestjs/swagger';
import { ArrayMaxSize, ArrayUnique, IsArray, IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../../prisma/prisma.service.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { IdempotencyService } from '../../common/idempotency/idempotency.service.js';
import { IdempotencyKey } from '../../common/idempotency/idempotency-key.decorator.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import type { AuthenticatedRequest } from '../auth/auth.types.js';
import { enterpriseAuthority } from './enterprise-policy.js';
import { WorkspaceListDto, WorkspaceRecordDto } from './dto.js';

export class MessageThreadInput {
  @ApiProperty({ minLength: 3, maxLength: 200 }) @IsString() @MinLength(3) @MaxLength(200) subject!: string;
  @ApiProperty({ minLength: 1, maxLength: 4000 }) @IsString() @MinLength(1) @MaxLength(4000) body!: string;
  @ApiProperty({ required: false, description: 'Send to every active member of the organization' }) @IsOptional() @IsBoolean() allMembers?: boolean;
  @ApiProperty({ required: false, type: [String], format: 'uuid', maxItems: 200 })
  @IsOptional() @IsArray() @ArrayMaxSize(200) @ArrayUnique() @IsUUID('4', { each: true }) recipientIds?: string[];
}
export class MessageReplyInput {
  @ApiProperty({ minLength: 1, maxLength: 4000 }) @IsString() @MinLength(1) @MaxLength(4000) body!: string;
}

/** Notifications between members of one organization. Administrators with
 * `members.manage` start threads; every participant may reply and messages
 * stay immutable. Nothing here touches trace, custody or Fabric. */
@Injectable()
export class EnterpriseMessagesService {
  constructor(private readonly db: PrismaService) {}

  private async participant(db: Pick<PrismaService, 'enterpriseMessageThread' | 'enterpriseMessageParticipant'>, actor: CommandActor, threadId: string) {
    const thread = await db.enterpriseMessageThread.findFirst({ where: { id: threadId, organizationId: actor.organizationId! } });
    const me = thread && await db.enterpriseMessageParticipant.findUnique({ where: { threadId_userId: { threadId, userId: actor.sub! } } });
    if (!thread || !me) throw new NotFoundException('Không tìm thấy thông báo');
    return thread;
  }

  create(actor: CommandActor, input: MessageThreadInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'members.manage', undefined, undefined, true);
      const members = await tx.user.findMany({
        where: { organizationId: actor.organizationId!, accountStatus: 'ACTIVE', ...(input.allMembers ? {} : { id: { in: input.recipientIds ?? [] } }) },
        select: { id: true },
      });
      const recipients = members.map((m) => m.id).filter((id) => id !== actor.sub);
      if (!input.allMembers && recipients.length !== (input.recipientIds ?? []).filter((id) => id !== actor.sub).length)
        throw new UnprocessableEntityException('Người nhận phải là thành viên đang hoạt động của doanh nghiệp');
      if (!recipients.length) throw new UnprocessableEntityException('Chọn ít nhất một người nhận');
      const now = new Date();
      const thread = await tx.enterpriseMessageThread.create({
        data: { organizationId: actor.organizationId!, subject: input.subject.trim(), createdBy: actor.sub!, createdAt: now, lastMessageAt: now },
      });
      await tx.enterpriseMessage.create({ data: { threadId: thread.id, authorId: actor.sub!, body: input.body.trim(), createdAt: now } });
      await tx.enterpriseMessageParticipant.createMany({
        data: [{ threadId: thread.id, userId: actor.sub!, readAt: now }, ...recipients.map((userId) => ({ threadId: thread.id, userId }))],
      });
      return { record: { id: thread.id, subject: thread.subject, recipients: recipients.length } };
    });
  }

  reply(actor: CommandActor, threadId: string, input: MessageReplyInput) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'profile.read', undefined, undefined, true);
      await this.participant(tx, actor, threadId);
      const now = new Date();
      const message = await tx.enterpriseMessage.create({ data: { threadId, authorId: actor.sub!, body: input.body.trim(), createdAt: now } });
      await tx.enterpriseMessageThread.update({ where: { id: threadId }, data: { lastMessageAt: now } });
      await tx.enterpriseMessageParticipant.update({ where: { threadId_userId: { threadId, userId: actor.sub! } }, data: { readAt: now } });
      return { record: message };
    });
  }

  async markRead(actor: CommandActor, threadId: string) {
    return commandTransaction(this.db, async (tx) => {
      await enterpriseAuthority(tx, actor, 'profile.read', undefined, undefined, true);
      await this.participant(tx, actor, threadId);
      await tx.enterpriseMessageParticipant.update({
        where: { threadId_userId: { threadId, userId: actor.sub! } },
        data: { readAt: new Date() },
      });
      return { record: { id: threadId, read: true } };
    });
  }

  async list(actor: CommandActor) {
    const auth = await enterpriseAuthority(this.db, actor, 'profile.read');
    const mine = await this.db.enterpriseMessageParticipant.findMany({
      where: { userId: actor.sub!, thread: { organizationId: actor.organizationId! } },
      include: { thread: { include: { messages: { orderBy: { createdAt: 'desc' }, take: 1 }, _count: { select: { participants: true, messages: true } } } } },
      orderBy: { thread: { lastMessageAt: 'desc' } },
      take: 200,
    });
    const people = await this.names(mine.flatMap((p) => [p.thread.createdBy, p.thread.messages[0]?.authorId].filter((x): x is string => !!x)));
    const items = mine.map((p) => {
      const last = p.thread.messages[0];
      return {
        id: p.thread.id, subject: p.thread.subject, createdBy: p.thread.createdBy, createdByName: people.get(p.thread.createdBy) ?? null,
        lastMessageAt: p.thread.lastMessageAt, preview: last?.body.slice(0, 160) ?? '', lastAuthorName: last ? people.get(last.authorId) ?? null : null,
        participants: p.thread._count.participants, messages: p.thread._count.messages,
        unread: !p.readAt || p.readAt < p.thread.lastMessageAt,
      };
    });
    return { items, counts: { unread: items.filter((i) => i.unread).length }, canSend: auth.primary || auth.user.enterpriseRoles.some((r) => r.role.permissions.includes('members.manage')) };
  }

  async detail(actor: CommandActor, threadId: string) {
    await enterpriseAuthority(this.db, actor, 'profile.read');
    const thread = await this.participant(this.db, actor, threadId);
    const [messages, participants] = await Promise.all([
      this.db.enterpriseMessage.findMany({ where: { threadId }, orderBy: { createdAt: 'asc' }, take: 500 }),
      this.db.enterpriseMessageParticipant.findMany({ where: { threadId } }),
    ]);
    const people = await this.names([...messages.map((m) => m.authorId), ...participants.map((p) => p.userId)]);
    return {
      record: {
        id: thread.id, subject: thread.subject, createdBy: thread.createdBy, createdAt: thread.createdAt,
        participants: participants.map((p) => ({ userId: p.userId, fullName: people.get(p.userId) ?? null })),
        messages: messages.map((m) => ({ id: m.id, authorId: m.authorId, authorName: people.get(m.authorId) ?? null, body: m.body, createdAt: m.createdAt, mine: m.authorId === actor.sub })),
      },
    };
  }

  private async names(ids: string[]) {
    const rows = await this.db.user.findMany({ where: { id: { in: [...new Set(ids)] } }, select: { id: true, fullName: true } });
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }
}

@ApiTags('enterprise-messages') @ApiBearerAuth() @UseGuards(JwtAuthGuard) @Controller('enterprise-messages')
export class EnterpriseMessagesController {
  constructor(private readonly service: EnterpriseMessagesService, private readonly idem: IdempotencyService) {}
  private run(req: AuthenticatedRequest, key: string, operation: string, payload: unknown, fn: () => Promise<unknown>) {
    if (!req.user.organizationId) throw new ForbiddenException('Chức năng dành cho thành viên doanh nghiệp');
    return this.idem.executeCommand({ idempotencyKey: key, requesterId: req.user.sub, actor: req.user, responseStatus: 201, operation, payload, requestType: 'COMMAND' }, fn);
  }
  @Get() @ApiDataResponse(WorkspaceListDto) list(@Req() req: AuthenticatedRequest) { return this.service.list(req.user); }
  @Get(':id') @ApiDataResponse(WorkspaceRecordDto) detail(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string) { return this.service.detail(req.user, id); }
  @Post() @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  create(@Req() req: AuthenticatedRequest, @Body() dto: MessageThreadInput, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_MESSAGE_SEND', dto, () => this.service.create(req.user, dto));
  }
  @Post(':id/replies') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  reply(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @Body() dto: MessageReplyInput, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_MESSAGE_REPLY', { id, ...dto }, () => this.service.reply(req.user, id, dto));
  }
  @Post(':id/read') @ApiHeader({ name: 'Idempotency-Key', required: true }) @ApiDataResponse(WorkspaceRecordDto, 201)
  read(@Req() req: AuthenticatedRequest, @Param('id', ParseUUIDPipe) id: string, @IdempotencyKey() key: string) {
    return this.run(req, key, 'EW_MESSAGE_READ', { id }, () => this.service.markRead(req.user, id));
  }
}
