import { UnprocessableEntityException } from '@nestjs/common';
import { monitoringInstant } from './monitoring-evaluator.js';

/** Feed only already-authorized accepted rows. Server receipt time drives
 * contact; backfill recording time must not replace a newer current reading. */
export function monitoringContact(input: {
  now: string;
  lastTelemetryReceivedAt: string | null;
  lastHeartbeatReceivedAt: string | null;
  newestRecordedAt: string | null;
  contactTimeoutSeconds: number;
  sensorError: boolean;
}) {
  const now = monitoringInstant(input.now);
  if (
    !Number.isSafeInteger(input.contactTimeoutSeconds) ||
    input.contactTimeoutSeconds <= 0 ||
    input.contactTimeoutSeconds > Number.MAX_SAFE_INTEGER / 1000
  )
    throw new UnprocessableEntityException('Timeout thiết bị không hợp lệ');
  const parse = (value: string | null) => {
    if (value === null) return null;
    const time = monitoringInstant(value);
    if (time > now)
      throw new UnprocessableEntityException('Mốc thiết bị ở tương lai');
    return time;
  };
  const telemetry = parse(input.lastTelemetryReceivedAt);
  const heartbeat = parse(input.lastHeartbeatReceivedAt);
  const measured = parse(input.newestRecordedAt);
  const latest =
    telemetry === null
      ? heartbeat
      : heartbeat === null
        ? telemetry
        : Math.max(telemetry, heartbeat);
  const timeout = input.contactTimeoutSeconds * 1000;
  return {
    contact:
      latest === null
        ? 'NEVER_SEEN'
        : now - latest > timeout
          ? 'OFFLINE'
          : 'ONLINE',
    lastSeenAt: latest === null ? null : new Date(latest).toISOString(),
    measurement: input.sensorError
      ? 'SENSOR_ERROR'
      : measured === null
        ? 'NO_DATA'
        : now - measured > timeout
          ? 'STALE'
          : 'RECENT',
  };
}
