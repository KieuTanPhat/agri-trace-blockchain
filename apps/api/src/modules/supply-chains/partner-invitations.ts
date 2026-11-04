import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsString, MaxLength, MinLength } from 'class-validator';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import type { CommandActor } from '../../common/idempotency/command-authorization.js';

const trim = ({ value }: { value: unknown }) =>
  typeof value === 'string' ? value.trim() : value;
const DAYS = 14;

export class PartnerInvitationInput {
  @ApiProperty({ maxLength: 255 })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(255)
  email!: string;
  @ApiProperty({ minLength: 2, maxLength: 255 })
  @Transform(trim)
  @IsString()
  @MinLength(2)
  @MaxLength(255)
  organizationName!: string;
}
export class PartnerInvitationView {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty({ description: 'Registration link; shown once, only its hash is stored' }) link!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
}

export class PartnerInvitationRecord {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() email!: string;
  @ApiProperty() organizationName!: string;
  @ApiProperty({ enum: ['PENDING', 'ACCEPTED', 'EXPIRED'] }) status!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) createdAt!: string;
}

/** Email invitations of a chain, for its owner; the token never leaves the server. */
export async function listPartnerInvitations(db: Prisma.TransactionClient, actor: CommandActor, chainId: string) {
  const chain = await db.supplyChain.findUnique({ where: { id: chainId }, select: { ownerOrganizationId: true } });
  if (!chain || chain.ownerOrganizationId !== actor.organizationId) throw new NotFoundException('Không tìm thấy chuỗi');
  const rows = await db.partnerInvitation.findMany({ where: { chainId }, orderBy: { createdAt: 'desc' }, take: 100 });
  const now = new Date();
  return rows.map((r) => ({
    id: r.id,
    email: r.email,
    organizationName: r.organizationName,
    status: r.status === 'PENDING' && r.expiresAt <= now ? 'EXPIRED' : r.status,
    expiresAt: r.expiresAt.toISOString(),
    createdAt: r.createdAt.toISOString(),
  }));
}

export const invitationHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** An owner invites an organization that has no account yet (ADR-005). The
 * token travels only in the link; acceptance happens at activation, and the
 * partner still accepts the membership itself. */
export async function createPartnerInvitation(
  tx: Prisma.TransactionClient,
  actor: CommandActor,
  chainId: string,
  input: PartnerInvitationInput,
) {
  const chain = await tx.supplyChain.findUniqueOrThrow({ where: { id: chainId } });
  if (chain.personal)
    throw new ForbiddenException('Sổ ghi nông trại không mời đối tác; tạo chuỗi chủ chuỗi để mời');
  if (chain.ownerOrganizationId !== actor.organizationId)
    throw new ForbiddenException('Chỉ chủ chuỗi được mời đối tác');
  if (
    await tx.partnerInvitation.findFirst({
      where: { chainId, email: input.email, status: 'PENDING', expiresAt: { gt: new Date() } },
    })
  )
    throw new ConflictException('Đã có lời mời còn hiệu lực cho email này');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DAYS * 86_400_000);
  const row = await tx.partnerInvitation.create({
    data: {
      chainId,
      inviterOrganizationId: chain.ownerOrganizationId,
      email: input.email,
      organizationName: input.organizationName,
      tokenHash: invitationHash(token),
      expiresAt,
      createdBy: actor.sub!,
    },
  });
  const link = new URL('/register', process.env.ENTERPRISE_WEB_BASE_URL ?? 'http://127.0.0.1:3001');
  link.searchParams.set('invitation', token);
  const owner = await tx.organization.findUniqueOrThrow({ where: { id: chain.ownerOrganizationId } });
  await tx.enterpriseMail.create({
    data: {
      kind: 'PARTNER_INVITE',
      recipient: input.email,
      subject: `AgriTrace — ${owner.name} mời tham gia chuỗi ${chain.name}`.slice(0, 255),
      text: `${owner.name} mời ${input.organizationName} tham gia chuỗi "${chain.name}" trên AgriTrace với tư cách thành viên (miễn phí). Đăng ký tổ chức tại ${link.href} trước ${expiresAt.toISOString().slice(0, 10)}. Sau khi hồ sơ được duyệt và kích hoạt, lời mời vào chuỗi sẽ hiện trong tài khoản của bạn.`,
    },
  });
  return { id: row.id, link: link.href, expiresAt: expiresAt.toISOString() };
}

/** Called in the activation transaction: the invitation hash kept at
 * registration becomes an INVITED membership of the inviting chain. */
export async function acceptPartnerInvitation(
  tx: Prisma.TransactionClient,
  organizationId: string,
  tokenHash: string | null | undefined,
) {
  if (!tokenHash) return;
  const row = await tx.partnerInvitation.findUnique({ where: { tokenHash } });
  if (!row || row.status !== 'PENDING' || row.expiresAt <= new Date()) return;
  if (
    !(await tx.chainMembership.findUnique({
      where: { chainId_organizationId: { chainId: row.chainId, organizationId } },
    }))
  )
    await tx.chainMembership.create({ data: { chainId: row.chainId, organizationId } });
  await tx.partnerInvitation.update({
    where: { id: row.id },
    data: { status: 'ACCEPTED', acceptedOrganizationId: organizationId, acceptedAt: new Date(), version: { increment: 1 } },
  });
}
