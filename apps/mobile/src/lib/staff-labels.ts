import type { Tone } from '../theme/staff';
/** Enterprise case states (platform-cases.service.ts). */
export const CASE_STATUS: Record<string, { label: string; t: Tone }> = {
  ASSIGNED: { label: 'Mới giao', t: 'orange' },
  ACKNOWLEDGED: { label: 'Đã tiếp nhận', t: 'blue' },
  ESCALATED: { label: 'Đã chuyển cấp', t: 'red' },
  RESPONDED: { label: 'Đã phản hồi', t: 'green' },
  CLOSED: { label: 'Đã đóng', t: 'gray' },
};
/** Case list and detail share one in-memory read. */
export const CASES_CACHE = { key: 'cases', staleTimeMs: 20_000 };
