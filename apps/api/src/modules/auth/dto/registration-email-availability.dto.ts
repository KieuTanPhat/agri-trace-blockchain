import { ApiProperty } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, MaxLength } from 'class-validator';

export class RegistrationEmailAvailabilityDto {
  @ApiProperty({ format: 'email', maxLength: 255 })
  @Transform(({ value }) =>
    typeof value === 'string' ? value.trim().toLowerCase() : value,
  )
  @IsEmail()
  @MaxLength(255)
  email!: string;
}

export class RegistrationEmailAvailabilityViewDto {
  @ApiProperty({
    description:
      'Advisory availability only. Final registration still enforces unique email atomically.',
  })
  available!: boolean;
}
