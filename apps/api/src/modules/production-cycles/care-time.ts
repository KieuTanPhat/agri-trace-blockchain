import { UnprocessableEntityException } from '@nestjs/common';
import { businessTimestamp } from '../../common/timestamp.js';

export type CareTimeSource = 'DEVICE' | 'SERVER_RECEIVED';
const MAX_DEVICE_AHEAD_MS = 2 * 60 * 1000;

/** Only care journals tolerate a small clock skew; never alter the reported instant. */
export function careTimestamp(
  reported: string,
  source: CareTimeSource = 'DEVICE',
  plantedAt: Date,
  receivedAt: Date,
) {
  if (source !== 'DEVICE' && source !== 'SERVER_RECEIVED')
    throw new UnprocessableEntityException('Nguồn thời điểm chăm sóc không hợp lệ.');
  const deviceTime = businessTimestamp(reported, 'Thời điểm chăm sóc', {
    allowFuture: true,
  });
  const reportedTimeOffsetMs = deviceTime.getTime() - receivedAt.getTime();
  if (source === 'DEVICE' && reportedTimeOffsetMs > MAX_DEVICE_AHEAD_MS)
    throw new UnprocessableEntityException(
      'Thời điểm chăm sóc nhanh hơn giờ máy chủ quá 2 phút. Kiểm tra ngày giờ tự động hoặc nhập lại thời điểm đã thực hiện.',
    );
  const eventTime = source === 'SERVER_RECEIVED' ? receivedAt : deviceTime;
  if (eventTime < plantedAt)
    throw new UnprocessableEntityException(
      'Thời điểm chăm sóc phải từ thời điểm xuống giống trở đi.',
    );
  return {
    eventTime,
    audit: {
      eventTimeSource: source,
      reportedEventTime: deviceTime.toISOString(),
      receivedAt: receivedAt.toISOString(),
      reportedTimeOffsetMs,
    },
  };
}
