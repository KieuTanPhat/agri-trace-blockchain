import { ApiProperty } from '@nestjs/swagger';

class ApiErrorDto {
  @ApiProperty() code!: string;
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
