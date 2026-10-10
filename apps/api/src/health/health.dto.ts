import { ApiProperty } from '@nestjs/swagger';
export class HealthDto {
  @ApiProperty({ enum: ['ok'] }) status!: string;
  @ApiProperty() service!: string;
  @ApiProperty({ format: 'date-time' }) timestamp!: string;
}
