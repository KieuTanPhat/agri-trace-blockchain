import { describe, expect, it } from 'vitest';
import { currentAttestations, transferStatus, type TransferDetail } from '../../mobile/src/lib/transfers';
const transfer: TransferDetail = {
  id: 'transfer', status: 'READY', origin: 'Farm', destination: 'Store', createdAt: '2026-10-29T01:00:00.000Z',
  senderId: 'farm', carrierId: 'carrier', receiverId: 'store',
  senderName: 'Vườn', carrierName: 'Vận chuyển', receiverName: 'Cửa hàng',
  attestationEpoch: 2, lines: [], attestations: [],
};
describe('Mobile transfer presentation', () => {
  it('uses the lifecycle returned by the API', () => {
    expect(transferStatus('READY')).toEqual({ label: 'Sẵn sàng lấy hàng', t: 'orange' });
    expect(transferStatus('DELIVERED')).toEqual({ label: 'Đã giao', t: 'green' });
    expect(transferStatus('PROPOSED').label).toBe('Chờ đồng thuận');
    expect(transferStatus('FUTURE_STATE').label).toBe('Trạng thái chưa xác định');
  });
  it('does not display signatures from a superseded consent epoch as current', () => {
    const make = (id: string, epoch: number, organizationId: string, phase: string) =>
      ({ id, epoch, organizationId, phase, createdAt: transfer.createdAt });
    const signatures = currentAttestations({ ...transfer, attestations: [
      make('old-pickup', 1, 'carrier', 'PICKUP'),
      make('current-consent', 2, 'farm', 'CONSENT'),
      make('current-delivery', 2, 'store', 'DELIVERY'),
    ] });
    expect(signatures.map((s) => s.id)).toEqual(['current-consent', 'current-delivery']);
    expect(signatures.map((s) => [s.phaseLabel, s.organizationName])).toEqual([
      ['Đồng thuận', 'Vườn'], ['Giao hàng', 'Cửa hàng'],
    ]);
  });
  it('does not infer signatures from delivery status', () => {
    expect(currentAttestations({ ...transfer, status: 'DELIVERED' })).toEqual([]);
  });
});
