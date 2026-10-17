import { UnprocessableEntityException } from '@nestjs/common';
import { isUUID } from 'class-validator';
import { businessTimestamp } from '../../common/timestamp.js';
import {
  decimalMilli,
  normalizeMonitoringPolicy,
  sensorMilli,
  type MonitoringPolicy,
} from './monitoring-policy.js';

export interface MonitoringReading {
  id: string;
  sampleId: string;
  deviceId: string;
  sessionId: string;
  shipmentId: string;
  recordedAt: string;
  temperature: string;
  humidity: string;
  doorOpen: boolean;
  latitude: string | null;
  longitude: string | null;
}
export interface MonitoringWindow {
  sessionId: string;
  deviceId: string;
  shipmentId: string;
  periodStart: string;
  cutoffAt: string;
  policy: MonitoringPolicy;
}
export interface TemperatureEpisode {
  type: 'TEMPERATURE_EXCURSION';
  startedAt: string;
  lastEvidenceAt: string;
  durationMs: number;
}
export interface DataGap {
  from: string;
  to: string;
  durationMs: number;
}

export function monitoringInstant(value: string): number {
  return businessTimestamp(value, 'Mốc giám sát', {
    allowFuture: true,
  }).getTime();
}

function coordinate(value: string, maximum: number): string {
  if (
    value !== value.trim() ||
    !/^-?\d{1,3}(?:\.\d{1,6})?$/.test(value) ||
    Math.abs(Number(value)) > maximum
  )
    throw new UnprocessableEntityException('Tọa độ giám sát không hợp lệ');
  return Number(value)
    .toFixed(6)
    .replace(/^-0\.000000$/, '0.000000');
}

/** Pure evaluation: caller supplies authorized raw rows, not the newest 100 rows. */
export function evaluateMonitoring(
  window: MonitoringWindow,
  input: readonly MonitoringReading[],
) {
  const policy = normalizeMonitoringPolicy(window.policy);
  const start = monitoringInstant(window.periodStart);
  const end = monitoringInstant(window.cutoffAt);
  if (start > end)
    throw new UnprocessableEntityException('Window giám sát bị đảo');
  for (const id of [window.sessionId, window.deviceId, window.shipmentId])
    if (!isUUID(id) || id !== id.toLowerCase())
      throw new UnprocessableEntityException('Định danh giám sát không hợp lệ');
  const ids = new Set<string>();
  const sampleIds = new Set<string>();
  const readings = input
    .map((row) => {
      const time = monitoringInstant(row.recordedAt);
      const temperature = sensorMilli(row.temperature);
      const humidity = sensorMilli(row.humidity);
      if (
        !isUUID(row.id) ||
        row.id !== row.id.toLowerCase() ||
        !isUUID(row.sampleId) ||
        row.sampleId !== row.sampleId.toLowerCase() ||
        ids.has(row.id) ||
        sampleIds.has(row.sampleId) ||
        row.deviceId !== window.deviceId ||
        row.sessionId !== window.sessionId ||
        row.shipmentId !== window.shipmentId ||
        time < start ||
        time > end ||
        temperature < -40000n ||
        temperature > 80000n ||
        humidity < 0n ||
        humidity > 100000n ||
        typeof row.doorOpen !== 'boolean' ||
        (row.latitude === null) !== (row.longitude === null)
      )
        throw new UnprocessableEntityException(
          'Mẫu giám sát trùng, sai scope/window hoặc ngoài miền cảm biến',
        );
      ids.add(row.id);
      sampleIds.add(row.sampleId);
      // Explicit allowlist prevents ingestion metadata/private notes entering the commitment.
      return {
        id: row.id,
        sampleId: row.sampleId,
        deviceId: row.deviceId,
        sessionId: row.sessionId,
        shipmentId: row.shipmentId,
        recordedAt: new Date(time).toISOString(),
        temperature: decimalMilli(temperature),
        humidity: decimalMilli(humidity),
        doorOpen: row.doorOpen,
        latitude: row.latitude === null ? null : coordinate(row.latitude, 90),
        longitude:
          row.longitude === null ? null : coordinate(row.longitude, 180),
      };
    })
    .sort((a, b) =>
      a.recordedAt < b.recordedAt
        ? -1
        : a.recordedAt > b.recordedAt
          ? 1
          : a.sampleId < b.sampleId
            ? -1
            : a.sampleId > b.sampleId
              ? 1
              : 0,
    );

  const episodes: TemperatureEpisode[] = [];
  const gaps: DataGap[] = [];
  const maximumGap = policy.sampleIntervalSeconds * 2000;
  let runStart: number | null = null;
  let runLast = 0;
  let previous = start;
  let sum = 0n;
  let minimum: bigint | null = null;
  let maximum: bigint | null = null;
  const flush = () => {
    if (
      runStart !== null &&
      runLast - runStart >= policy.excursionDurationSeconds * 1000
    )
      episodes.push({
        type: 'TEMPERATURE_EXCURSION',
        startedAt: new Date(runStart).toISOString(),
        lastEvidenceAt: new Date(runLast).toISOString(),
        durationMs: runLast - runStart,
      });
    runStart = null;
  };
  const gap = (from: number, to: number) => {
    if (to - from > maximumGap)
      gaps.push({
        from: new Date(from).toISOString(),
        to: new Date(to).toISOString(),
        durationMs: to - from,
      });
  };
  for (const row of readings) {
    const time = monitoringInstant(row.recordedAt);
    if (time - previous > maximumGap) flush();
    gap(previous, time);
    const temperature = sensorMilli(row.temperature);
    sum += temperature;
    minimum = minimum === null || temperature < minimum ? temperature : minimum;
    maximum = maximum === null || temperature > maximum ? temperature : maximum;
    if (
      temperature < sensorMilli(policy.temperatureMinC) ||
      temperature > sensorMilli(policy.temperatureMaxC)
    ) {
      if (runStart === null) runStart = time;
      runLast = time;
    } else flush();
    previous = time;
  }
  flush();
  gap(previous, end);
  const count = BigInt(readings.length);
  // Average rounded half away from zero to 3 decimals; sum itself is exact.
  const average =
    count === 0n
      ? null
      : decimalMilli(
          (sum < 0n ? -1n : 1n) *
            ((2n * (sum < 0n ? -sum : sum) + count) / (2n * count)),
        );
  return {
    readings,
    summary: {
      readingCount: readings.length,
      firstRecordedAt: readings[0]?.recordedAt ?? null,
      lastRecordedAt: readings.at(-1)?.recordedAt ?? null,
      temperature:
        minimum === null || maximum === null
          ? null
          : {
              min: decimalMilli(minimum),
              max: decimalMilli(maximum),
              average,
            },
      episodes,
      gaps,
    },
  };
}
