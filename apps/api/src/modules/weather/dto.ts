import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';
import locations from '../../common/locations/vietnam.json' with { type: 'json' };
export class WeatherQueryDto {
  @ApiProperty({
    enum: locations.provinces.map((p) => p.code),
    description: 'Whitelisted province code; no GPS or arbitrary coordinates.',
  })
  @IsString()
  @IsIn(locations.provinces.map((p) => p.code))
  province!: string;
}
export class WeatherPointDto {
  @ApiProperty() name!: string;
  @ApiProperty() latitude!: number;
  @ApiProperty() longitude!: number;
}
export class CurrentWeatherDto {
  @ApiProperty({ format: 'date-time' }) time!: string;
  @ApiProperty({ type: Number, nullable: true }) temperatureC!: number | null;
  @ApiProperty({ type: Number, nullable: true }) humidityPercent!:
    number | null;
  @ApiProperty({ type: Number, nullable: true }) windKmh!: number | null;
  @ApiProperty({ type: Number, nullable: true }) weatherCode!: number | null;
}
export class DailyWeatherDto {
  @ApiProperty({ format: 'date' }) date!: string;
  @ApiProperty({ type: Number, nullable: true }) minimumC!: number | null;
  @ApiProperty({ type: Number, nullable: true }) maximumC!: number | null;
  @ApiProperty({ type: Number, nullable: true })
  precipitationProbabilityPercent!: number | null;
  @ApiProperty({ type: Number, nullable: true }) weatherCode!: number | null;
}
export class PublicWeatherDto {
  @ApiProperty() provinceCode!: string;
  @ApiProperty() provinceName!: string;
  @ApiProperty({ enum: ['Asia/Ho_Chi_Minh'] }) timezone!: string;
  @ApiProperty({ enum: ['Open-Meteo'] }) provider!: string;
  @ApiProperty({ enum: ['https://open-meteo.com/'] }) attributionUrl!: string;
  @ApiProperty({ format: 'date-time' }) fetchedAt!: string;
  @ApiProperty({ format: 'date-time' }) expiresAt!: string;
  @ApiProperty({ type: () => WeatherPointDto }) point!: WeatherPointDto;
  @ApiProperty({ type: () => CurrentWeatherDto }) current!: CurrentWeatherDto;
  @ApiProperty({
    type: () => DailyWeatherDto,
    isArray: true,
    minItems: 3,
    maxItems: 3,
  })
  daily!: DailyWeatherDto[];
}
