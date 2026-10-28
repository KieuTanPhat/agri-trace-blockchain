import { ApiProperty } from '@nestjs/swagger';
import { PublicDirectoryEnterpriseDto } from '../public-directory/dto.js';
export class JourneyFactDto {
  @ApiProperty() label!: string;
  @ApiProperty() value!: string;
}
export class JourneyPhotoDto {
  @ApiProperty() id!: string;
  @ApiProperty() url!: string;
  @ApiProperty() caption!: string;
}
export class JourneyEntryDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty({ format: 'date-time' }) time!: string;
  @ApiProperty({ type: [JourneyFactDto] }) facts!: JourneyFactDto[];
}
export class JourneyCertificateDto {
  @ApiProperty() type!: string;
  @ApiProperty() issuer!: string;
  @ApiProperty({ format: 'date-time' }) issueDate!: string;
  @ApiProperty({ type: String, nullable: true, format: 'date-time' })
  expiryDate!: string | null;
}
export class PublicJourneyGroupDto {
  @ApiProperty() id!: string;
  @ApiProperty() title!: string;
  @ApiProperty() stage!: string;
  @ApiProperty({ type: String, nullable: true }) address!: string | null;
  @ApiProperty({ type: PublicDirectoryEnterpriseDto, nullable: true })
  company!: PublicDirectoryEnterpriseDto | null;
  @ApiProperty({ type: [JourneyEntryDto] }) entries!: JourneyEntryDto[];
  @ApiProperty({ type: [JourneyPhotoDto] }) photos!: JourneyPhotoDto[];
  @ApiProperty({ type: [JourneyFactDto] }) facts!: JourneyFactDto[];
  @ApiProperty({ type: [JourneyCertificateDto] })
  certificates!: JourneyCertificateDto[];
}
