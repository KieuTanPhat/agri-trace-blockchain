import {
  BadGatewayException,
  BadRequestException,
  Inject,
  Injectable,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import data from '../../common/locations/weather-points.json' with { type: 'json' };
import type { PublicWeatherDto } from './dto.js';
import { projectWeather } from './weather-projection.js';
export const WEATHER_FETCH = Symbol('WEATHER_FETCH');
export const WEATHER_CLOCK = Symbol('WEATHER_CLOCK');
@Injectable()
export class WeatherService {
  private readonly cache = new Map<
    string,
    { until: number; value: PublicWeatherDto }
  >();
  private readonly pending = new Map<string, Promise<PublicWeatherDto>>();
  private readonly failedUntil = new Map<string, number>();
  constructor(
    @Inject(ConfigService) private readonly config: ConfigService,
    @Inject(WEATHER_FETCH) private readonly http: typeof fetch,
    @Inject(WEATHER_CLOCK) private readonly now: () => number,
  ) {}
  async get(province: string): Promise<PublicWeatherDto> {
    const point = data.points.find((p) => p.provinceCode === province);
    if (!point) throw new BadRequestException('Mã tỉnh/thành chưa hợp lệ.');
    const mode = this.config.get<string>('WEATHER_LICENSE_MODE');
    const production = this.config.get<string>('NODE_ENV') === 'production';
    const key = this.config.get<string>('WEATHER_API_KEY')?.trim();
    if (
      this.config.get('WEATHER_PROVIDER') !== 'OPEN_METEO' ||
      !(
        (mode === 'DEV_NONCOMMERCIAL' && !production) ||
        (mode === 'COMMERCIAL' &&
          key &&
          this.config.get('WEATHER_PROVIDER_APPROVED') === 'true')
      )
    )
      throw new ServiceUnavailableException(
        'Tính năng thời tiết chưa được cấu hình hoặc phê duyệt.',
      );
    const time = this.now(),
      cached = this.cache.get(province);
    if (cached && cached.until > time) return structuredClone(cached.value);
    if (cached) this.cache.delete(province);
    if ((this.failedUntil.get(province) ?? 0) > time)
      throw new ServiceUnavailableException(
        'Thời tiết tạm chưa sẵn sàng. Vui lòng thử lại sau.',
      );
    const current = this.pending.get(province);
    if (current) return structuredClone(await current);
    if (this.pending.size >= 3)
      throw new ServiceUnavailableException(
        'Thời tiết đang bận. Vui lòng thử lại sau.',
      );
    const url = new URL(
      mode === 'COMMERCIAL'
        ? 'https://customer-api.open-meteo.com/v1/forecast'
        : 'https://api.open-meteo.com/v1/forecast',
    );
    url.search = new URLSearchParams({
      latitude: String(point.latitude),
      longitude: String(point.longitude),
      current:
        'temperature_2m,relative_humidity_2m,weather_code,wind_speed_10m',
      daily:
        'weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'Asia/Ho_Chi_Minh',
      timeformat: 'unixtime',
      forecast_days: '3',
      temperature_unit: 'celsius',
      wind_speed_unit: 'kmh',
      cell_selection: 'land',
      ...(mode === 'COMMERCIAL' ? { apikey: key! } : {}),
    }).toString();
    const operation = this.load(url, point).finally(() =>
      this.pending.delete(province),
    );
    this.pending.set(province, operation);
    return structuredClone(await operation);
  }
  private async load(
    url: URL,
    point: (typeof data.points)[number],
  ): Promise<PublicWeatherDto> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), 5000);
    try {
      const response = await this.http(url, {
        signal: abort.signal,
        redirect: 'error',
        credentials: 'omit',
        headers: { Accept: 'application/json' },
      });
      if (
        !response.ok ||
        response.redirected ||
        !response.headers.get('content-type')?.includes('application/json')
      )
        throw new Error();
      const reader = response.body?.getReader();
      if (!reader) throw new Error();
      const chunks: Uint8Array[] = [];
      let size = 0;
      try {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          size += chunk.value.byteLength;
          if (size > 65536) {
            abort.abort();
            throw new Error();
          }
          chunks.push(chunk.value);
        }
      } finally {
        reader.releaseLock();
      }
      const time = this.now();
      const projection = projectWeather(
        JSON.parse(Buffer.concat(chunks).toString('utf8')),
        time,
      );
      const nextMidnight =
        Math.floor((time + 25200000) / 86400000 + 1) * 86400000 - 25200000;
      const until = Math.min(time + 600000, nextMidnight);
      const value: PublicWeatherDto = {
        provinceCode: point.provinceCode,
        provinceName: point.provinceName,
        timezone: 'Asia/Ho_Chi_Minh',
        provider: 'Open-Meteo',
        attributionUrl: 'https://open-meteo.com/',
        fetchedAt: new Date(time).toISOString(),
        expiresAt: new Date(until).toISOString(),
        point: {
          name: point.name,
          latitude: point.latitude,
          longitude: point.longitude,
        },
        ...projection,
      };
      this.cache.set(point.provinceCode, { until, value });
      this.failedUntil.delete(point.provinceCode);
      return value;
    } catch {
      this.failedUntil.set(point.provinceCode, this.now() + 30000);
      throw new BadGatewayException(
        'Chưa lấy được dữ liệu thời tiết. Vui lòng thử lại sau.',
      );
    } finally {
      clearTimeout(timer);
    }
  }
}
