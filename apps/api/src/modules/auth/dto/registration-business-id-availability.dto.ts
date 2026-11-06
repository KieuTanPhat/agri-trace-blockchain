import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { Matches } from 'class-validator';

export class RegistrationBusinessIdAvailabilityDto {
  @ApiProperty({
    pattern: '^[0-9]{10}(?:-?[0-9]{3})?$',
    description:
      'Advisory availability only; final registration checks uniqueness atomically.',
  })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim() : value,
  )
  @Matches(/^\d{10}(?:-?\d{3})?$/)
  businessId!: string;
}

export class RegistrationBusinessIdAvailabilityViewDto {
  @ApiProperty({
    description:
      'Advisory availability only. Final registration still enforces unique business identifiers atomically.',
  })
  available!: boolean;
}
