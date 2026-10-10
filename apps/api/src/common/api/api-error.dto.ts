import { ApiProperty } from '@nestjs/swagger';
import { ErrorCode } from '../constants/error-code.js';

class ApiErrorDto {
  @ApiProperty({ enum: Object.values(ErrorCode) }) code!: string;
  @ApiProperty({
    oneOf: [{ type: 'string' }, { type: 'array', items: { type: 'string' } }],
  })
  message!: string | string[];
}
export class ApiErrorEnvelopeDto {
  @ApiProperty({ enum: [false] }) success!: boolean;
  @ApiProperty({ type: ApiErrorDto }) error!: ApiErrorDto;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
  @ApiProperty() path!: string;
  @ApiProperty() requestId!: string;
}
