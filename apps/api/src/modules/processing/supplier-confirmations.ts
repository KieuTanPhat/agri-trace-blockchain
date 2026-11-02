import {
  Body,
  ConflictException,
  Controller,
  Get,
  GoneException,
  NotFoundException,
  Param,
  Post,
} from '@nestjs/common';
import { ApiProperty, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Transform } from 'class-transformer';
import { IsIn, IsString, MaxLength, MinLength } from 'class-validator';
import { createHash, randomBytes } from 'node:crypto';
import type { Prisma } from '../../generated/prisma/client.js';
import { ApiDataResponse } from '../../common/api/openapi.js';
import { commandTransaction } from '../../common/idempotency/command-transaction.js';
import { PrismaService } from '../../prisma/prisma.service.js';

type Tx = Prisma.TransactionClient;
const DAYS = 30;
const TOKEN = /^[A-Za-z0-9_-]{40,60}$/;
export const confirmationHash = (token: string) =>
  createHash('sha256').update(token).digest('hex');

/** Documents accepted as evidence of an external receipt (ADR-005). */
export const RECEIPT_EVIDENCE_KINDS = [
  'INVOICE',
  'PURCHASE_LIST',
  'WEIGHING_SLIP',
  'LAB_TEST',
  'RECEIPT_DOCUMENT',
] as const;

export type TrustLevel = 'DECLARED' | 'EVIDENCED' | 'SUPPLIER_CONFIRMED' | 'SELF_RECORDED';
/** Derived, never stored: a lot recorded in AgriTrace is SELF_RECORDED; an
 * external receipt rises with documents and a supplier confirmation. */
export const trustLevel = (r: { source: string; hasEvidence: boolean; confirmed: boolean }): TrustLevel =>
  r.source === 'AGRITRACE'
    ? 'SELF_RECORDED'
    : r.confirmed
      ? 'SUPPLIER_CONFIRMED'
      : r.hasEvidence
        ? 'EVIDENCED'
        : 'DECLARED';

export async function receiptConfirmed(tx: Tx, receiptId: string) {
  return (await tx.supplierConfirmation.count({ where: { receiptId, status: 'CONFIRMED' } })) > 0;
}

export class SupplierConfirmationView {
  @ApiProperty({ description: 'Link printed as a QR code on the weighing slip or purchase list; shown once' }) link!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
}

/** One open confirmation per receipt; only the token hash is stored. */
export async function createSupplierConfirmation(tx: Tx, receipt: { id: string; source: string }, userId: string) {
  if (receipt.source !== 'EXTERNAL')
    throw new ConflictException('Chỉ phiếu nhập nguyên liệu ngoài cần nhà cung cấp xác nhận');
  if (await receiptConfirmed(tx, receipt.id))
    throw new ConflictException('Nhà cung cấp đã xác nhận phiếu này');
  if (await tx.supplierConfirmation.findFirst({ where: { receiptId: receipt.id, status: 'PENDING', expiresAt: { gt: new Date() } } }))
    throw new ConflictException('Phiếu đã có mã xác nhận còn hiệu lực');
  const token = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + DAYS * 86_400_000);
  await tx.supplierConfirmation.create({
    data: { receiptId: receipt.id, tokenHash: confirmationHash(token), expiresAt, createdBy: userId },
  });
  const link = new URL(`/confirm/${token}`, process.env.ENTERPRISE_WEB_BASE_URL ?? 'http://127.0.0.1:3001');
  return { link: link.href, expiresAt: expiresAt.toISOString() };
}

export class SupplierConfirmationDecision {
  @ApiProperty({ enum: ['CONFIRMED', 'DECLINED'] }) @IsIn(['CONFIRMED', 'DECLINED']) decision!: 'CONFIRMED' | 'DECLINED';
  @ApiProperty({ minLength: 2, maxLength: 120, description: 'Name of the person confirming' })
  @Transform(({ value }) => (typeof value === 'string' ? value.trim() : value))
  @IsString()
  @MinLength(2)
  @MaxLength(120)
  responderName!: string;
}
export class PublicSupplierConfirmationView {
  @ApiProperty() buyerName!: string;
  @ApiProperty() materialName!: string;
  @ApiProperty() supplierName!: string;
  @ApiProperty() quantity!: string;
  @ApiProperty() unit!: string;
  @ApiProperty({ type: String, format: 'date-time' }) receivedAt!: string;
  @ApiProperty({ nullable: true, type: String }) documentNo!: string | null;
  @ApiProperty({ enum: ['PENDING', 'CONFIRMED', 'DECLINED'] }) status!: string;
}

/** Public, account-free: the supplier scans the QR on its slip and confirms
 * or declines the receipt once. Only receipt facts it already knows are shown. */
@ApiTags('public')
@Controller('public/supplier-confirmations')
export class PublicSupplierConfirmationController {
  constructor(private readonly db: PrismaService) {}

  private async find(tx: Tx, token: string) {
    if (!TOKEN.test(token)) throw new NotFoundException('Mã xác nhận không hợp lệ');
    const row = await tx.supplierConfirmation.findUnique({
      where: { tokenHash: confirmationHash(token) },
      include: { receipt: true },
    });
    if (!row) throw new NotFoundException('Mã xác nhận không hợp lệ');
    return row;
  }
  private async view(tx: Tx, row: Awaited<ReturnType<PublicSupplierConfirmationController['find']>>) {
    const buyer = await tx.organization.findUniqueOrThrow({ where: { id: row.receipt.organizationId } });
    return {
      buyerName: buyer.name,
      materialName: row.receipt.materialName,
      supplierName: row.receipt.supplierName,
      quantity: row.receipt.quantity.toFixed(3),
      unit: row.receipt.unit,
      receivedAt: row.receipt.receivedAt.toISOString(),
      documentNo: row.receipt.documentNo,
      status: row.status,
    };
  }

  @Get(':token')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @ApiDataResponse(PublicSupplierConfirmationView)
  async get(@Param('token') token: string) {
    const row = await this.find(this.db as unknown as Tx, token);
    return this.view(this.db as unknown as Tx, row);
  }

  @Post(':token')
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @ApiDataResponse(PublicSupplierConfirmationView, 201)
  respond(@Param('token') token: string, @Body() input: SupplierConfirmationDecision) {
    if (!TOKEN.test(token)) throw new NotFoundException('Mã xác nhận không hợp lệ');
    return commandTransaction(this.db, async (tx) => {
      const row = await this.find(tx, token);
      await tx.$queryRaw`SELECT id FROM supplier_confirmation WHERE id=${row.id}::uuid FOR UPDATE`;
      if (row.status !== 'PENDING') throw new ConflictException('Phiếu đã được trả lời');
      if (row.expiresAt <= new Date()) throw new GoneException('Mã xác nhận đã hết hạn');
      const done = await tx.supplierConfirmation.update({
        where: { id: row.id },
        data: { status: input.decision, respondedAt: new Date(), responderName: input.responderName, version: { increment: 1 } },
        include: { receipt: true },
      });
      return this.view(tx, done);
    });
  }
}
