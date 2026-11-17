import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SepayService } from './sepay.service.js';
import type { PrismaService } from '../../prisma/prisma.service.js';
import type { SepayConfiguration, SepayTransaction } from './sepay-protocol.js';
import { canonicalSha256 } from '../../common/crypto/rfc8785.js';
const mocks = vi.hoisted(() => ({
  audit: vi.fn(),
  settle: vi.fn(),
  activate: vi.fn(),
}));
vi.mock('../platform-governance/platform-audit.js', () => ({
  appendPlatformAudit: mocks.audit,
  lockPlatformAudit: vi.fn(),
}));
vi.mock('./billing-core.js', () => ({ settleInvoiceTx: mocks.settle }));
vi.mock('../enterprise-onboarding/service-activation.js', () => ({
  activateEnrollmentTx: mocks.activate,
}));
const config: SepayConfiguration = {
  mode: 'live',
  bank: 'MBBank',
  accountNumber: '123456789',
  accountHolder: 'TEST',
  virtualAccount: null,
  webhookKey: 'unused',
};
function fixture(amount = 1500) {
  const now = new Date();
  const date = new Date(now.getTime() + 7 * 3600000)
    .toISOString()
    .slice(0, 19)
    .replace('T', ' ');
  const input: SepayTransaction = {
    id: 123,
    gateway: 'MBBank',
    accountNumber: '123456789',
    subAccount: null,
    code: null,
    content: 'AGT2026000001',
    transferType: 'in',
    transferAmount: amount,
    referenceCode: 'BANK123',
    transactionDate: date,
  };
  const invoice = {
    id: 'invoice',
    number: 'AGT-2026-000001',
    organizationId: 'org',
    subscriptionId: 'sub',
    kind: 'INITIAL',
    status: 'ISSUED',
    amount: 1000n,
    currency: 'VND',
    version: 0,
    issuedAt: new Date(now.getTime() - 60000),
    dueAt: new Date(now.getTime() + 60000),
  };
  const order = {
    id: 'order',
    status: 'AWAITING_PAYMENT',
    amount: 1000,
    billingEmail: 'owner@example.test',
    contractText: 'contract',
    contractDigest: 'hash',
    contractPdf: null,
    contractPdfHash: null,
  };
  const tx = {
    $executeRaw: vi.fn(),
    $queryRaw: vi.fn(),
    invoice: {
      findUnique: vi.fn().mockResolvedValue(invoice),
      findUniqueOrThrow: vi.fn().mockResolvedValue(invoice),
    },
    sepayWebhookReceipt: {
      findUnique: vi.fn(),
      create: vi.fn().mockResolvedValue({ id: 'receipt' }),
    },
    organization: {
      findUniqueOrThrow: vi
        .fn()
        .mockResolvedValue({
          id: 'org',
          status: 'ACTIVE',
          participationStatus: 'CHAIN_OWNER',
          capabilityRequests: [{ status: 'APPROVED' }],
          enterpriseEnrollment: {
            id: 'enroll',
            status: 'APPROVED',
            serviceActivatedAt: null,
            owner: { accountStatus: 'ACTIVE' },
          },
        }),
    },
    subscription: {
      findUnique: vi
        .fn()
        .mockResolvedValue({
          id: 'sub',
          organizationId: 'org',
          sourceOrderId: 'order',
          status: 'PENDING_PAYMENT',
        }),
    },
    enterpriseServiceOrder: {
      findUnique: vi.fn().mockResolvedValue(order),
      update: vi.fn(),
    },
    enterpriseMail: { findFirst: vi.fn(), create: vi.fn() },
  };
  const db = {
    $transaction: async (run: (value: typeof tx) => Promise<unknown>) =>
      run(tx),
  };
  return {
    tx,
    invoice,
    input,
    service: new SepayService(db as unknown as PrismaService),
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  mocks.settle.mockResolvedValue({ paidAt: new Date() });
});
describe('SePay settlement allocation', () => {
  it.each([1000, 1500])(
    'settles %i VND once, activates and records the received and excess amounts',
    async (amount) => {
      const { tx, input, service } = fixture(amount);
      await service.receive(config, input);
      expect(mocks.settle).toHaveBeenCalledOnce();
      expect(mocks.activate).toHaveBeenCalledOnce();
      expect(tx.enterpriseServiceOrder.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'PAID' }),
        }),
      );
      expect(mocks.audit).toHaveBeenCalledWith(
        tx,
        expect.objectContaining({
          action: 'SEPAY_WEBHOOK_RECEIVED',
          details: expect.objectContaining({
            receivedAmount: String(amount),
            appliedAmount: '1000',
            excessAmount: String(amount - 1000),
            bankReference: 'BANK123',
          }),
        }),
      );
      tx.sepayWebhookReceipt.findUnique.mockResolvedValue({
        payloadHash: canonicalSha256(input),
      });
      await service.receive(config, input);
      expect(mocks.settle).toHaveBeenCalledOnce();
      expect(tx.enterpriseMail.create).toHaveBeenCalledOnce();
    },
  );
  it('keeps underpayment and transfers against void invoices for review without activation', async () => {
    for (const kind of ['underpaid', 'void']) {
      const { tx, input, invoice, service } = fixture(
        kind === 'underpaid' ? 999 : 1500,
      );
      if (kind === 'void') invoice.status = 'VOID';
      await service.receive(config, input);
      expect(tx.sepayWebhookReceipt.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ outcome: 'REVIEW_REQUIRED' }),
        }),
      );
    }
    expect(mocks.settle).not.toHaveBeenCalled();
    expect(mocks.activate).not.toHaveBeenCalled();
  });
  it('rejects a changed duplicate instead of settling again', async () => {
    const { tx, input, service } = fixture();
    tx.sepayWebhookReceipt.findUnique.mockResolvedValue({
      payloadHash: canonicalSha256({ ...input, transferAmount: 1000 }),
    });
    await expect(service.receive(config, input)).rejects.toThrow(
      'Giao dịch SePay đã có nội dung khác',
    );
    expect(mocks.settle).not.toHaveBeenCalled();
  });
});
