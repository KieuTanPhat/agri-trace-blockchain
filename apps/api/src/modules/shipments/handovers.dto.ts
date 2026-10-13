import { ApiProperty } from '@nestjs/swagger';
import {
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { PrepareIntentOptionsDto } from '../signing/dto.js';

export class PrepareHandoverOfferDto extends PrepareIntentOptionsDto {
  @ApiProperty({
    enum: ['PICKUP', 'ARRIVAL'],
    description:
      'PICKUP: nông trại giao cho đơn vị vận chuyển. ARRIVAL: vận chuyển giao cho bán lẻ.',
  })
  @IsIn(['PICKUP', 'ARRIVAL'])
  kind!: 'PICKUP' | 'ARRIVAL';

  @ApiProperty({ type: String, required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  note?: string;

  @ApiProperty({
    type: Number,
    required: false,
    minimum: 15,
    maximum: 10080,
    description: 'Thời hạn bên nhận phải xác nhận, mặc định 1440 phút',
  })
  @IsOptional()
  @IsInt()
  @Min(15)
  @Max(10080)
  offerValidMinutes?: number;
}

export class RejectHandoverDto {
  @ApiProperty({ type: String, maxLength: 500 })
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  reason!: string;
}

export class CancelHandoverDto {
  @ApiProperty({ type: String, required: false, maxLength: 500 })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}

export class HandoverDto {
  @ApiProperty({ type: String, format: 'uuid' }) id!: string;
  @ApiProperty({ type: String, format: 'uuid' }) shipmentId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) chainId!: string;
  @ApiProperty({ enum: ['PICKUP', 'ARRIVAL'] }) kind!: string;
  @ApiProperty({
    enum: ['OFFERED', 'CONFIRMED', 'REJECTED', 'EXPIRED', 'CANCELLED'],
  })
  state!: string;
  @ApiProperty({ type: String, format: 'uuid' }) giverOrgId!: string;
  @ApiProperty({ type: String, format: 'uuid' }) receiverOrgId!: string;
  @ApiProperty({
    enum: ['CROSS_ORG', 'INTERNAL_SAME_ORG'],
    description:
      'INTERNAL_SAME_ORG: bên giao và bên nhận là cùng một tổ chức (bàn giao nội bộ)',
  })
  custodyLabel!: string;
  @ApiProperty({ type: String }) quantity!: string;
  @ApiProperty({ type: String }) unit!: string;
  @ApiProperty({ type: Number }) shipmentVersion!: number;
  @ApiProperty({ type: Number }) lotVersion!: number;
  @ApiProperty({ type: String, nullable: true }) note!: string | null;
  @ApiProperty({ type: String, nullable: true }) reason!: string | null;
  @ApiProperty({ type: String, format: 'uuid' }) offerEventId!: string;
  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  resolveEventId!: string | null;
  @ApiProperty({ type: String, format: 'date-time' }) offeredAt!: string;
  @ApiProperty({ type: String, format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  resolvedAt!: string | null;
}
