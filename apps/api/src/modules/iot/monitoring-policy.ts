import { UnprocessableEntityException } from '@nestjs/common';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';

export interface MonitoringPolicy {
  temperatureMinC: string;
  temperatureMaxC: string;
  excursionDurationSeconds: number;
  sampleIntervalSeconds: 10;
  contactTimeoutSeconds: number;
}

/** Match Decimal(10,3) without rounding measurements or using floating point sums. */
export function sensorMilli(value: string | number): bigint {
  const text = String(value);
  if (text !== text.trim() || !/^-?\d{1,7}(?:\.\d{1,3})?$/.test(text))
    throw new UnprocessableEntityException(
      'Số đo cần Decimal hữu hạn, tối đa 3 chữ số thập phân',
    );
  const negative = text.startsWith('-');
  const [whole, fraction = ''] = (negative ? text.slice(1) : text).split('.');
  const result = BigInt(whole) * 1000n + BigInt(fraction.padEnd(3, '0'));
  return negative ? -result : result;
}

export function decimalMilli(value: bigint): string {
  const absolute = value < 0n ? -value : value;
  return `${value < 0n ? '-' : ''}${absolute / 1000n}.${String(absolute % 1000n).padStart(3, '0')}`;
}

export function normalizeMonitoringPolicy(
  input: MonitoringPolicy,
): MonitoringPolicy {
  const min = sensorMilli(input.temperatureMinC);
  const max = sensorMilli(input.temperatureMaxC);
  if (
    min < -40000n ||
    max > 80000n ||
    min >= max ||
    input.sampleIntervalSeconds !== 10 ||
    !Number.isSafeInteger(input.excursionDurationSeconds) ||
    input.excursionDurationSeconds <= 0 ||
    !Number.isSafeInteger(input.contactTimeoutSeconds) ||
    input.contactTimeoutSeconds <= 0 ||
    input.excursionDurationSeconds > Number.MAX_SAFE_INTEGER / 1000 ||
    input.contactTimeoutSeconds > Number.MAX_SAFE_INTEGER / 1000
  )
    throw new UnprocessableEntityException('Hồ sơ giám sát không hợp lệ');
  return {
    temperatureMinC: decimalMilli(min),
    temperatureMaxC: decimalMilli(max),
    excursionDurationSeconds: input.excursionDurationSeconds,
    sampleIntervalSeconds: 10,
    contactTimeoutSeconds: input.contactTimeoutSeconds,
  };
}

export const DEMO_MONITORING_POLICY: Readonly<MonitoringPolicy> = Object.freeze(
  {
    temperatureMinC: '2.000',
    temperatureMaxC: '8.000',
    excursionDurationSeconds: 120,
    sampleIntervalSeconds: 10,
    contactTimeoutSeconds: 30,
  },
);

export function monitoringPolicyDigest(
  mode: 'NONE' | 'ENABLED',
  policy: MonitoringPolicy | null,
): string {
  if (
    (mode !== 'NONE' && mode !== 'ENABLED') ||
    (mode === 'NONE' && policy !== null) ||
    (mode === 'ENABLED' && policy === null)
  )
    throw new UnprocessableEntityException('Mode và hồ sơ giám sát không khớp');
  return canonicalSha256({
    schemaVersion: 'shipment-monitoring-policy-1',
    monitoringMode: mode,
    policy: policy === null ? null : normalizeMonitoringPolicy(policy),
  });
}
