import {
  BadGatewayException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { vi } from 'vitest';
import { WeatherService } from './weather.service.js';
import { projectWeather } from './weather-projection.js';
import { weatherFixture } from '../../../test/support/weather-fixture.js';
const fixed = Date.UTC(2026, 9, 19, 5);
const response = (body = weatherFixture(fixed)) =>
  new Response(JSON.stringify(body), {
    headers: { 'Content-Type': 'application/json' },
  });
const settings = () =>
  new ConfigService({
    WEATHER_PROVIDER: 'OPEN_METEO',
    WEATHER_LICENSE_MODE: 'DEV_NONCOMMERCIAL',
    NODE_ENV: 'test',
  });
describe('Weather cache, provider boundary and projection', () => {
  afterEach(() => vi.useRealTimers());
  it('defaults off and rejects unsupported province/configuration without provider access', async () => {
    const http = vi.fn();
    await expect(
      new WeatherService(new ConfigService(), http, () => fixed).get('01'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(
      new WeatherService(settings(), http, () => fixed).get('https://internal'),
    ).rejects.toThrow();
    const production = new ConfigService({
      WEATHER_PROVIDER: 'OPEN_METEO',
      WEATHER_LICENSE_MODE: 'DEV_NONCOMMERCIAL',
      NODE_ENV: 'production',
    });
    await expect(
      new WeatherService(production, http, () => fixed).get('01'),
    ).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(http).not.toHaveBeenCalled();
  });
  it('uses a fixed HTTPS endpoint and required units; caches per province for ten minutes', async () => {
    let now = fixed;
    const http = vi.fn(async (url: URL, options: RequestInit) => {
      expect(url.origin).toBe('https://api.open-meteo.com');
      expect(url.searchParams.get('forecast_days')).toBe('3');
      expect(options.redirect).toBe('error');
      expect(options.credentials).toBe('omit');
      expect(options.headers).toEqual({ Accept: 'application/json' });
      return response(weatherFixture(now));
    });
    const service = new WeatherService(
      settings(),
      http as unknown as typeof fetch,
      () => now,
    );
    const first = await service.get('01');
    first.current.temperatureC = -90;
    expect((await service.get('01')).current.temperatureC).toBe(27.5);
    expect(http).toHaveBeenCalledTimes(1);
    await service.get('31');
    expect(http).toHaveBeenCalledTimes(2);
    now += 600001;
    await service.get('01');
    expect(http).toHaveBeenCalledTimes(3);
  });
  it('coalesces simultaneous requests to the same province', async () => {
    let finish!: (value: Response) => void;
    const http = vi.fn(
      () =>
        new Promise<Response>((resolve) => {
          finish = resolve;
        }),
    );
    const service = new WeatherService(
      settings(),
      http as typeof fetch,
      () => fixed,
    );
    const a = service.get('01'),
      b = service.get('01');
    expect(http).toHaveBeenCalledTimes(1);
    finish(response());
    expect(await a).toEqual(await b);
  });
  it('does not return stale cached data after failure, hides details and backs off failed requests', async () => {
    let now = fixed;
    const http = vi.fn(async () => response());
    const service = new WeatherService(
      settings(),
      http as typeof fetch,
      () => now,
    );
    await service.get('01');
    now += 600001;
    http.mockRejectedValue(new Error('PRIVATE-provider-key-and-url'));
    await expect(service.get('01')).rejects.toBeInstanceOf(BadGatewayException);
    await expect(service.get('01')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(http).toHaveBeenCalledTimes(2);
  });
  it('cancels hanging requests and rejects oversized responses', async () => {
    vi.useFakeTimers();
    const http = vi.fn(
      (_: unknown, options?: RequestInit) =>
        new Promise<Response>((_, reject) =>
          options?.signal?.addEventListener('abort', () =>
            reject(new Error('SECRET')),
          ),
        ),
    );
    const service = new WeatherService(
      settings(),
      http as typeof fetch,
      () => fixed,
    );
    const result = expect(service.get('01')).rejects.toBeInstanceOf(
      BadGatewayException,
    );
    await vi.advanceTimersByTimeAsync(5001);
    await result;
    vi.useRealTimers();
    const huge = vi.fn(
      async () =>
        new Response('x'.repeat(65537), {
          headers: { 'Content-Type': 'application/json' },
        }),
    );
    await expect(
      new WeatherService(settings(), huge as typeof fetch, () => fixed).get(
        '01',
      ),
    ).rejects.toBeInstanceOf(BadGatewayException);
  });
  it('validates timezone, units, timestamps, day order and preserves null readings', () => {
    const raw = weatherFixture();
    expect(projectWeather(raw, fixed).daily).toHaveLength(3);
    expect(() => projectWeather({ ...raw, timezone: 'UTC' }, fixed)).toThrow();
    expect(() =>
      projectWeather(
        {
          ...raw,
          current_units: { ...raw.current_units, temperature_2m: '°F' },
        },
        fixed,
      ),
    ).toThrow();
    expect(() => projectWeather(raw, fixed + 4 * 3600000)).toThrow();
    expect(() =>
      projectWeather(
        { ...raw, daily: { ...raw.daily, temperature_2m_min: [40, 25, 26] } },
        fixed,
      ),
    ).toThrow();
    const nullable = {
      ...raw,
      current: { ...raw.current, temperature_2m: null },
    };
    expect(projectWeather(nullable, fixed).current.temperatureC).toBeNull();
  });
  it('expires cached forecasts at Vietnam midnight rather than carrying yesterday into tomorrow', async () => {
    const now = Date.parse('2026-10-19T16:59:00Z');
    const service = new WeatherService(
      settings(),
      vi.fn(async () => response(weatherFixture(now))) as typeof fetch,
      () => now,
    );
    expect((await service.get('01')).expiresAt).toBe(
      '2026-10-19T17:00:00.000Z',
    );
  });
  it('requires explicit approval/key for commercial mode and never returns the key', async () => {
    const privateKey = 'test-only-key-not-a-real-credential';
    const config = new ConfigService({
      NODE_ENV: 'production',
      WEATHER_PROVIDER: 'OPEN_METEO',
      WEATHER_LICENSE_MODE: 'COMMERCIAL',
      WEATHER_PROVIDER_APPROVED: 'false',
      WEATHER_API_KEY: privateKey,
    });
    const http = vi.fn(async (url: URL) => {
      expect(url.origin).toBe('https://customer-api.open-meteo.com');
      expect(url.searchParams.get('apikey')).toBe(privateKey);
      return response();
    });
    const service = new WeatherService(
      config,
      http as unknown as typeof fetch,
      () => fixed,
    );
    await expect(service.get('01')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(http).not.toHaveBeenCalled();
    config.set('WEATHER_PROVIDER_APPROVED', 'true');
    expect(JSON.stringify(await service.get('01'))).not.toContain(privateKey);
  });
  it('bounds upstream concurrency across different provinces', async () => {
    const finishes: Array<(response: Response) => void> = [];
    const http = vi.fn(
      () => new Promise<Response>((resolve) => finishes.push(resolve)),
    );
    const service = new WeatherService(
      settings(),
      http as typeof fetch,
      () => fixed,
    );
    const pending = ['01', '31', '79'].map((code) => service.get(code));
    await expect(service.get('48')).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
    expect(http).toHaveBeenCalledTimes(3);
    for (const finish of finishes) finish(response());
    expect(await Promise.all(pending)).toHaveLength(3);
  });
});
