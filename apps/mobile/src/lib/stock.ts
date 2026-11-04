import type { Tone } from '../theme/staff';

/** Projections of the distribution stock report (apps/web/src/lib/ledger/dist-types.ts). */
export type StockLot = {
  lotId: string;
  version: number;
  lotCode: string;
  productName: string;
  unit: string;
  held: string;
  reserved: string;
  quarantined: string;
  available: string;
  unallocated: string | null;
  blocked: boolean;
  expiryDate: string | null;
  notices: { kind: string; message: string }[];
  siteHoldings: { siteId: string; siteName: string; quantity: string; reserved: string; quarantined: string; available: string }[];
};
export type SiteSlip = {
  id: string;
  code: string;
  version: number;
  lotId: string;
  lotCode: string;
  productName: string;
  fromSiteName: string;
  toSiteName: string;
  quantity: string;
  receivedQuantity: string | null;
  unit: string;
  status: 'PENDING' | 'IN_TRANSIT' | 'RECEIVED' | 'DISCREPANCY' | 'CANCELLED';
  receiverName?: string | null;
  note?: string | null;
  createdAt: string;
};
export type QuarantineCase = {
  id: string;
  code: string;
  version: number;
  lotId: string;
  lotCode: string;
  productName: string;
  siteId: string;
  siteName: string;
  quantity: string;
  openQuantity: string;
  unit: string;
  cause: string;
  status: 'ACTIVE' | 'RELEASED' | 'DISPOSED';
  reason: string;
  createdAt: string;
};

const today = () => new Date().toISOString().slice(0, 10);
/** Lots that may not be sold or moved: blocked, recalled or past expiry. */
export function lotStop(l: Pick<StockLot, 'blocked' | 'notices' | 'expiryDate'>): { label: string; t: Tone } | null {
  if (l.notices.some((n) => n.kind === 'RECALL')) return { label: 'Thu hồi', t: 'red' };
  if (l.blocked) return { label: 'Bị chặn', t: 'red' };
  if (l.expiryDate && l.expiryDate.slice(0, 10) < today()) return { label: 'Hết hạn', t: 'red' };
  return null;
}

export const SLIP_STATUS: Record<SiteSlip['status'], { label: string; t: Tone }> = {
  PENDING: { label: 'Chờ xuất', t: 'orange' },
  IN_TRANSIT: { label: 'Đang chuyển', t: 'blue' },
  RECEIVED: { label: 'Đã nhận', t: 'green' },
  DISCREPANCY: { label: 'Lệch số lượng', t: 'red' },
  CANCELLED: { label: 'Đã hủy', t: 'gray' },
};

export const QUARANTINE_CAUSE: Record<string, string> = {
  SUSPECTED_DAMAGE: 'Nghi hư hỏng',
  QUALITY_FAILED: 'Không đạt chất lượng',
  AWAITING_INSPECTION: 'Chờ kiểm định',
  OTHER: 'Khác',
};
