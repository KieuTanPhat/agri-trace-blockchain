import type { Tone } from '../theme/tokens';

/** Projection of distribution's workspace record; no signing material needed. */
export type Transfer = {
  id: string;
  status: string;
  origin: string;
  destination: string;
  createdAt: string;
  senderId: string;
  carrierId: string;
  receiverId: string;
  senderName?: string;
  carrierName?: string;
  receiverName?: string;
  lines: { id: string; lotId: string; quantity: string; unit: string; productName?: string; lotCode?: string }[];
};
export type TransferDetail = Transfer & {
  attestationEpoch: number;
  attestations: { id: string; organizationId: string; phase: string; epoch: number; createdAt: string }[];
};
const statuses: Record<string, { label: string; t: Tone }> = {
  PROPOSED: { label: 'Chờ đồng thuận', t: 'orange' },
  READY: { label: 'Sẵn sàng lấy hàng', t: 'orange' },
  IN_TRANSIT: { label: 'Đang vận chuyển', t: 'blue' },
  DELIVERED: { label: 'Đã giao', t: 'green' },
  CANCELLED: { label: 'Đã hủy', t: 'red' },
};
export const transferStatus = (status: string) =>
  statuses[status] ?? { label: 'Trạng thái chưa xác định', t: 'blue' as const };
const phases: Record<string, string> = {
  CONSENT: 'Đồng thuận', PICKUP: 'Lấy hàng', DELIVERY: 'Giao hàng',
};
export function currentAttestations(transfer: TransferDetail) {
  return transfer.attestations
    .filter((a) => a.epoch === transfer.attestationEpoch)
    .map((a) => ({
      ...a,
      phaseLabel: phases[a.phase] ?? 'Bước ký khác',
      organizationName:
        a.organizationId === transfer.senderId ? transfer.senderName ?? 'Bên gửi' :
        a.organizationId === transfer.receiverId ? transfer.receiverName ?? 'Bên nhận' :
        a.organizationId === transfer.carrierId ? transfer.carrierName ?? 'Bên vận chuyển' : 'Đơn vị tham gia',
    }));
}
