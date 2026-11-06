import { describe, expect, it } from 'vitest';
import {
  authenticateSepay,
  parseSepayTransaction,
  sepayConfiguration,
  sepayInvoiceNumber,
  sepayPaymentCode,
  sepayQrUrl,
  sepayRecipientMatches,
} from './sepay-protocol.js';

const env = {
  NODE_ENV: 'test',
  ENTERPRISE_PAYMENTS_ENABLED: 'true',
  SEPAY_MODE: 'test',
  SEPAY_BANK: 'Vietcombank',
  SEPAY_ACCOUNT_NUMBER: '00123456789',
  SEPAY_ACCOUNT_HOLDER: 'CONG TY KIEM THU',
  SEPAY_WEBHOOK_KEY: 'fixture-only-key-with-at-least-32-bytes',
};
const config = sepayConfiguration(env)!;
const payload = {
  id: 92704,
  gateway: 'Vietcombank',
  accountNumber: '00123456789',
  subAccount: null,
  code: 'AGT2026000001',
  content: 'AGT2026000001 chuyen tien',
  transferType: 'in',
  transferAmount: 8500000,
  referenceCode: 'FIXTURE123',
  transactionDate: '2026-11-05 09:00:00',
};

describe('SePay configuration and verified transfer matching (no database/network)', () => {
  it('stays disabled unless explicitly configured and never enables billing itself', () => {
    expect(sepayConfiguration({})).toBeNull();
    expect(() =>
      sepayConfiguration({ ...env, ENTERPRISE_PAYMENTS_ENABLED: 'false' }),
    ).toThrow();
    expect(() =>
      sepayConfiguration({ ...env, SEPAY_MODE: 'unknown' }),
    ).toThrow();
  });
  it('refuses missing/short secrets and test mode in production', () => {
    expect(() =>
      sepayConfiguration({ ...env, SEPAY_WEBHOOK_KEY: '' }),
    ).toThrow();
    expect(() =>
      sepayConfiguration({ ...env, SEPAY_WEBHOOK_KEY: 'short' }),
    ).toThrow();
    expect(() =>
      sepayConfiguration({ ...env, NODE_ENV: 'production' }),
    ).toThrow();
  });
  it('requires the provider API key and never accepts a user bearer token', () => {
    expect(() =>
      authenticateSepay(`Apikey ${config.webhookKey}`, config),
    ).not.toThrow();
    for (const header of [
      undefined,
      '',
      'Bearer user-token',
      'Apikey wrong-key',
    ])
      expect(() => authenticateSepay(header, config)).toThrow();
  });
  it('preserves account leading zeros and only accepts incoming transfers to the configured recipient', () => {
    const tx = parseSepayTransaction(payload);
    expect(sepayRecipientMatches(tx, config)).toBe(true);
    for (const override of [
      { accountNumber: '123456789' },
      { gateway: 'MBBank' },
      { transferType: 'out' as const },
    ])
      expect(sepayRecipientMatches({ ...tx, ...override }, config)).toBe(false);
    expect(
      sepayRecipientMatches(tx, { ...config, virtualAccount: 'VA001' }),
    ).toBe(false);
  });
  it('rejects lossy, negative, fractional and string transaction identifiers/amounts', () => {
    for (const key of ['id', 'transferAmount'])
      for (const value of ['8500000', 0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1])
        expect(() =>
          parseSepayTransaction({ ...payload, [key]: value }),
        ).toThrow();
  });
  it('matches the entire immutable invoice code, including year and leading zeros', () => {
    expect(sepayPaymentCode('AGT-2026-000001')).toBe('AGT2026000001');
    expect(sepayInvoiceNumber(payload)).toBe('AGT-2026-000001');
    expect(sepayInvoiceNumber({ ...payload, code: null })).toBe(
      'AGT-2026-000001',
    );
    expect(
      sepayInvoiceNumber({
        ...payload,
        code: null,
        content: 'agt2026000001 chuyen tien',
      }),
    ).toBe('AGT-2026-000001');
  });
  it('refuses impossible calendar dates instead of normalizing them', () => {
    for (const transactionDate of [
      '2026-02-30 10:00:00',
      '2026-11-05 25:00:00',
      '2026-11-05T09:00:00Z',
    ])
      expect(() =>
        parseSepayTransaction({ ...payload, transactionDate }),
      ).toThrow();
  });
  it('does not activate a different invoice from ambiguous, truncated or conflicting memo content', () => {
    for (const override of [
      { content: 'AGT2026000001 AGT2026000002' },
      { content: 'AGT202600000' },
      { content: 'XAGT2026000001' },
      { content: 'AGT2026000001X' },
      { code: 'AGT2026000002' },
      { content: 'chuyen tien khong co ma' },
    ])
      expect(sepayInvoiceNumber({ ...payload, ...override })).toBeNull();
  });
  it('builds a QR only from server-selected invoice amount and payment code', () => {
    const url = new URL(sepayQrUrl(config, 'AGT-2026-000001', 8500000n));
    expect(url.origin).toBe('https://vietqr.app');
    expect(url.searchParams.get('amount')).toBe('8500000');
    expect(url.searchParams.get('acc')).toBe('00123456789');
    expect(url.searchParams.get('des')).toBe('AGT2026000001');
    expect(url.toString()).not.toContain(config.webhookKey);
    expect(() => sepayQrUrl(config, 'AGT-2026-000001', 0n)).toThrow();
  });
});
