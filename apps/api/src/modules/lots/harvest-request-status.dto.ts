import { ApiProperty } from '@nestjs/swagger';

class RecoveredLotDto {
  @ApiProperty({ format: 'uuid' }) id!: string;
  @ApiProperty() lotCode!: string;
}
class RecoveredQrDto {
  @ApiProperty() traceToken!: string;
}
export class RecoveredHarvestDto {
  @ApiProperty({ type: RecoveredLotDto }) lot!: RecoveredLotDto;
  @ApiProperty({ type: RecoveredQrDto }) traceQr!: RecoveredQrDto;
}
export class HarvestRequestStatusDto {
  @ApiProperty({
    enum: ['NOT_FOUND', 'COMMITTED', 'REJECTED', 'NEEDS_RECONCILIATION'],
    description:
      'NOT_FOUND is not permission to replace the key. Only an immutable command journal proves COMMITTED.',
  })
  status!: 'NOT_FOUND' | 'COMMITTED' | 'REJECTED' | 'NEEDS_RECONCILIATION';
  @ApiProperty({ type: RecoveredHarvestDto, required: false })
  result?: RecoveredHarvestDto;
}
