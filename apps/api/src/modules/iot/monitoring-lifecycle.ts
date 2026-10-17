import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { monitoringInstant } from './monitoring-evaluator.js';

interface QueueHeartbeat {
  receivedAt: string;
  samplingStopped: boolean;
  pendingCount: number;
  quarantineCount: number;
}

/** This is a decision helper; persistence must hold the same Lot lock as ingest. */
export function monitoringFinalization(input: {
  state: 'RUNNING' | 'DRAINING' | 'INTERRUPTED' | 'FINALIZED';
  cutoffAt: string | null;
  now: string;
  contactTimeoutSeconds: number;
  heartbeat: QueueHeartbeat | null;
  readingCount: number;
  hasDataGap: boolean;
  sensorError: boolean;
  bootChanged: boolean;
  allowIncomplete: boolean;
  reason?: string;
}) {
  if (input.state !== 'DRAINING' && input.state !== 'INTERRUPTED')
    throw new ConflictException(
      'Phiên cần dừng hoặc bị gián đoạn trước khi chốt',
    );
  if (
    input.cutoffAt === null ||
    !Number.isSafeInteger(input.readingCount) ||
    input.readingCount < 0 ||
    !Number.isSafeInteger(input.contactTimeoutSeconds) ||
    input.contactTimeoutSeconds <= 0
  )
    throw new UnprocessableEntityException('Thông tin chốt phiên không hợp lệ');
  const now = monitoringInstant(input.now);
  const cutoff = monitoringInstant(input.cutoffAt);
  if (cutoff > now)
    throw new UnprocessableEntityException('Cutoff ở tương lai');
  const heartbeat = input.heartbeat;
  if (
    heartbeat &&
    (!Number.isSafeInteger(heartbeat.pendingCount) ||
      heartbeat.pendingCount < 0 ||
      !Number.isSafeInteger(heartbeat.quarantineCount) ||
      heartbeat.quarantineCount < 0)
  )
    throw new UnprocessableEntityException('Bộ đếm hàng đợi không hợp lệ');
  const received = heartbeat ? monitoringInstant(heartbeat.receivedAt) : null;
  if (received !== null && received > now)
    throw new UnprocessableEntityException('Giờ nhận heartbeat ở tương lai');
  const reasons: string[] = [];
  if (input.state === 'INTERRUPTED') reasons.push('INTERRUPTED');
  if (
    received === null ||
    received < cutoff ||
    now - received > input.contactTimeoutSeconds * 1000
  )
    reasons.push('MISSING_DRAIN_CONFIRMATION');
  if (heartbeat?.samplingStopped !== true) reasons.push('SAMPLING_NOT_STOPPED');
  if (heartbeat && heartbeat.pendingCount > 0) reasons.push('PENDING_SAMPLES');
  if (heartbeat && heartbeat.quarantineCount > 0)
    reasons.push('QUARANTINED_SAMPLES');
  if (input.hasDataGap) reasons.push('DATA_GAP');
  if (input.sensorError) reasons.push('SENSOR_ERROR');
  if (input.bootChanged) reasons.push('DEVICE_RESET');
  const reason = input.reason?.trim() ?? '';
  if (reasons.length && (input.allowIncomplete !== true || !reason))
    throw new ConflictException(
      'Cần xác nhận chốt thiếu và lý do; dữ liệu chưa đối soát đầy đủ',
    );
  return {
    completeness:
      input.readingCount === 0
        ? ('NO_DATA' as const)
        : reasons.length
          ? ('INCOMPLETE' as const)
          : ('COMPLETE' as const),
    reasons,
    reason: reasons.length ? reason : null,
  };
}
