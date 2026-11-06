import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Provider payload is validated by parseSepayTransaction, independently of
 * user DTO transforms: money/identifiers must remain integer JSON numbers. */
export class SepayWebhookInput {
  @ApiProperty({ type: Number, minimum: 1 }) id!: number;
  @ApiProperty() gateway!: string;
  @ApiProperty() transactionDate!: string;
  @ApiProperty() accountNumber!: string;
  @ApiPropertyOptional({ type: String, nullable: true }) subAccount?:
    string | null;
  @ApiPropertyOptional({ type: String, nullable: true }) code?: string | null;
  @ApiProperty() content!: string;
  @ApiProperty({ enum: ['in', 'out'] }) transferType!: string;
  @ApiProperty({ type: Number, minimum: 1 }) transferAmount!: number;
  @ApiPropertyOptional() description?: string;
  @ApiPropertyOptional({ type: Number }) accumulated?: number;
  @ApiPropertyOptional() referenceCode?: string;
}

export class SepayWebhookAcknowledgement {
  @ApiProperty({ enum: [true] }) success!: true;
}

export class SepayCheckoutView {
  @ApiProperty() enabled!: boolean;
  @ApiProperty({ enum: ['test', 'live'], nullable: true }) mode!:
    'test' | 'live' | null;
  @ApiProperty({ type: String, nullable: true }) invoiceId!: string | null;
  @ApiProperty({ type: String, nullable: true }) invoiceNumber!: string | null;
  @ApiProperty({ type: Number, nullable: true }) amount!: number | null;
  @ApiProperty({ enum: ['ISSUED', 'PAID', 'VOID'], nullable: true }) status!:
    string | null;
  @ApiProperty({ type: String, nullable: true }) dueAt!: string | null;
  @ApiProperty({ type: String, nullable: true }) paidAt!: string | null;
  @ApiProperty() simulated!: boolean;
  @ApiProperty() serviceActive!: boolean;
  @ApiProperty({ type: String, nullable: true }) bank!: string | null;
  @ApiProperty({ type: String, nullable: true }) accountNumber!: string | null;
  @ApiProperty({ type: String, nullable: true }) accountHolder!: string | null;
  @ApiProperty({ type: String, nullable: true }) paymentCode!: string | null;
  @ApiProperty({ type: String, nullable: true }) qrUrl!: string | null;
  @ApiProperty({ type: String, nullable: true }) reviewMessage!: string | null;
}
