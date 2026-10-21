import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { WeatherController } from './weather.controller.js';
import {
  WEATHER_CLOCK,
  WEATHER_FETCH,
  WeatherService,
} from './weather.service.js';
@Module({
  imports: [ConfigModule],
  controllers: [WeatherController],
  providers: [
    WeatherService,
    {
      provide: WEATHER_FETCH,
      useValue: (...args: Parameters<typeof fetch>) => fetch(...args),
    },
    { provide: WEATHER_CLOCK, useValue: () => Date.now() },
  ],
})
export class WeatherModule {}
