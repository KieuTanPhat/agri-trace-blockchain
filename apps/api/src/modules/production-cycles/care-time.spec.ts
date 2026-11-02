import { describe, expect, it } from 'vitest';
import { careTimestamp } from './care-time.js';
import { businessTimestamp } from '../../common/timestamp.js';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CareRecordDto } from './dto.js';

const received = new Date('2026-10-31T08:33:00.000Z');
const planted = new Date('2026-10-29T00:00:00.000Z');
describe('Care journal time policy', () => {
  it.each([null, '', 'UNKNOWN'])('rejects an invalid time source at the HTTP boundary: %s', (source) => {
    const errors = validateSync(plainToInstance(CareRecordDto, { eventTimeSource: source }));
    expect(errors.some(error => error.property === 'eventTimeSource')).toBe(true);
  });
  it('uses server receipt time only on explicit request and retains device time for audit', () => {
    const result = careTimestamp('2026-10-31T15:35:00.000+07:00', 'SERVER_RECEIVED', planted, received);
    expect(result.eventTime).toEqual(received);
    expect(result.audit).toEqual({
      eventTimeSource: 'SERVER_RECEIVED', reportedEventTime: '2026-10-31T08:35:00.000Z',
      receivedAt: received.toISOString(), reportedTimeOffsetMs: 120000,
    });
  });
  it('keeps historical/offline work time independent of upload delay', () => {
    const reported = '2026-10-30T01:20:30.123Z';
    const result = careTimestamp(reported, undefined, planted, received);
    expect(result.eventTime.toISOString()).toBe(reported);
    expect(result.audit.eventTimeSource).toBe('DEVICE');
    expect(result.audit.receivedAt).toBe(received.toISOString());
  });
  it('accepts exactly two minutes ahead without changing the original time', () => {
    expect(careTimestamp('2026-10-31T08:35:00.000Z', 'DEVICE', planted, received).eventTime.toISOString())
      .toBe('2026-10-31T08:35:00.000Z');
  });
  it('rejects one millisecond beyond the skew allowance with a precise reason', () => {
    expect(() => careTimestamp('2026-10-31T08:35:00.001Z', 'DEVICE', planted, received)).toThrow('quá 2 phút');
  });
  it('never relaxes planting order', () => {
    expect(() => careTimestamp('2026-10-28T23:59:59.999Z', 'DEVICE', planted, received)).toThrow('xuống giống');
    expect(() => careTimestamp(received.toISOString(), 'SERVER_RECEIVED', new Date('2026-11-01T00:00:00.000Z'), received)).toThrow('xuống giống');
  });
  it.each(['2026-02-30T08:33:00.000Z', '2026-10-31T08:33:00', '2026-10-31T08:33:00.1234Z'])(
    'rejects malformed device dates even in server-time mode: %s', (reported) => {
      expect(() => careTimestamp(reported, 'SERVER_RECEIVED', planted, received)).toThrow();
    },
  );
  it('does not change the strict future rule for harvesting, sensors or other commands', () => {
    expect(() => businessTimestamp('2026-10-31T08:33:00.001Z', 'Thu hoạch', { now: received })).toThrow();
  });
});
