import { describe, expect, it, vi } from 'vitest';
import { SepayService } from './sepay.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { SepaySettlement } from './sepay-gateway.js';

vi.mock('../platform-governance/platform-audit.js', () => ({
  lockPlatformAudit: vi.fn(),
  appendPlatformAudit: vi.fn(),
}));
const settlement = vi.hoisted(() => vi.fn());
vi.mock('./billing-core.js', () => ({ settleInvoiceTx: settlement }));

const transaction: SepaySettlement = {
  id: 'PG:transaction-1',
  invoiceNumber: 'AGT-2026-000001',
  amount: 1000n,
  posted: Date.now(),
  payloadHash: 'a'.repeat(64),
  rejection: null,
};
function fixture(prior: { payloadHash: string } | null = null, amount = 1000n) {
  const invoice = {
    id: 'invoice-1',
    organizationId: 'org-1',
    number: transaction.invoiceNumber,
    amount,
    currency: 'VND',
    status: 'ISSUED',
    issuedAt: new Date(transaction.posted - 60000),
    dueAt: new Date(transaction.posted + 60000),
  };
  const tx = {
    sepayWebhookReceipt: {
      findUnique: vi.fn().mockResolvedValue(prior),
      create: vi.fn().mockResolvedValue({ id: 'receipt-1' }),
    },
    invoice: {
      findUnique: vi.fn().mockResolvedValue(invoice),
      findUniqueOrThrow: vi.fn().mockResolvedValue(invoice),
    },
    $queryRaw: vi.fn(),
    organization: { findUniqueOrThrow: vi.fn() },
  };
  const db = {
    $transaction: (callback: (client: typeof tx) => unknown) => callback(tx),
  };
  return { tx, service: new SepayService(db as unknown as PrismaService) };
}
describe('Gateway shared settlement safeguards (transaction mocks, not DB acceptance)', () => {
  it('acknowledges an identical retry without settling or recording twice', async () => {
    const { tx, service } = fixture({ payloadHash: transaction.payloadHash });
    await service.receiveSettlement({ mode: 'test' }, transaction);
    expect(tx.invoice.findUnique).not.toHaveBeenCalled();
    expect(tx.sepayWebhookReceipt.create).not.toHaveBeenCalled();
    expect(settlement).not.toHaveBeenCalled();
  });
  it('rejects reuse of the transaction ID with changed settlement data', async () => {
    const { service } = fixture({ payloadHash: 'b'.repeat(64) });
    await expect(
      service.receiveSettlement({ mode: 'test' }, transaction),
    ).rejects.toThrow('nội dung khác');
  });
  it('records wrong invoice amount for review without activation', async () => {
    const { tx, service } = fixture(null, 2000n);
    await service.receiveSettlement({ mode: 'test' }, transaction);
    expect(tx.sepayWebhookReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        outcome: 'REVIEW_REQUIRED',
        reason: 'AMOUNT_OR_CURRENCY_MISMATCH',
      }),
    });
    expect(tx.organization.findUniqueOrThrow).not.toHaveBeenCalled();
    expect(settlement).not.toHaveBeenCalled();
  });
  it('records invalid/void gateway settlements without activating service', async () => {
    const { tx, service } = fixture();
    await service.receiveSettlement(
      { mode: 'test' },
      { ...transaction, rejection: 'GATEWAY_STATUS_OR_AMOUNT_MISMATCH' },
    );
    expect(tx.sepayWebhookReceipt.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ outcome: 'REVIEW_REQUIRED' }),
    });
    expect(settlement).not.toHaveBeenCalled();
  });
});
