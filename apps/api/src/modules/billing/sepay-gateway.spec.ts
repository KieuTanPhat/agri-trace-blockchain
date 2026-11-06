import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import {
  authenticateSepayIpn,
  parseSepayIpn,
  sepayGatewayConfiguration,
  sepayGatewayForm,
} from './sepay-gateway.js';

const env = {
  ENTERPRISE_PAYMENTS_ENABLED: 'true',
  SEPAY_GATEWAY_MODE: 'test',
  SEPAY_MERCHANT_ID: 'TEST_MERCHANT',
  SEPAY_MERCHANT_SECRET: 'fixture-merchant-secret-only',
  SEPAY_IPN_SECRET: 'fixture-ipn-secret-at-least-32-characters',
  SEPAY_WEB_ORIGIN: 'https://web.example',
};
const config = sepayGatewayConfiguration(env)!;
const body = {
  timestamp: 1,
  notification_type: 'ORDER_PAID',
  order: {
    id: 'order-1',
    order_invoice_number: 'AGT-2026-000001',
    order_status: 'CAPTURED',
    order_currency: 'VND',
    order_amount: '1000.00',
  },
  transaction: {
    id: 'transaction-1',
    payment_method: 'BANK_TRANSFER',
    transaction_type: 'PAYMENT',
    transaction_date: '2026-11-06 10:00:00',
    transaction_status: 'APPROVED',
    transaction_amount: '1000',
    transaction_currency: 'VND',
  },
};

describe('SePay Gateway protocol', () => {
  it('fails closed for disabled billing, conflicting transports, unsafe URL and missing secrets', () => {
    expect(sepayGatewayConfiguration({})).toBeNull();
    for (const override of [
      { ENTERPRISE_PAYMENTS_ENABLED: 'false' },
      { SEPAY_MODE: 'test' },
      { NODE_ENV: 'production' },
      { SEPAY_MERCHANT_SECRET: '' },
      { SEPAY_IPN_SECRET: '' },
      { SEPAY_WEB_ORIGIN: 'http://web.example' },
      { SEPAY_WEB_ORIGIN: 'https://user:pass@web.example' },
      { SEPAY_GATEWAY_MODE: 'sandbox' },
    ])
      expect(() =>
        sepayGatewayConfiguration({ ...env, ...override }),
      ).toThrow();
  });
  it('uses a separate authenticated IPN secret', () => {
    expect(() => authenticateSepayIpn(config.ipnSecret, config)).not.toThrow();
    for (const key of [undefined, '', config.secret, 'incorrect'])
      expect(() => authenticateSepayIpn(key, config)).toThrow();
  });
  it('signs fixed ordered fields with server invoice values, never returning secret', () => {
    const form = sepayGatewayForm(config, {
      id: 'invoice-id',
      number: 'AGT-2026-000001',
      amount: 1000n,
    });
    expect(form.action).toBe('https://pay-sandbox.sepay.vn/v1/checkout/init');
    const signed =
      'order_amount=1000,merchant=TEST_MERCHANT,currency=VND,operation=PURCHASE,order_description=Thanh toan goi dich vu AGT-2026-000001,order_invoice_number=AGT-2026-000001,payment_method=BANK_TRANSFER,success_url=https://web.example/enterprise/service/payment?invoiceId=invoice-id,error_url=https://web.example/enterprise/service/payment?invoiceId=invoice-id,cancel_url=https://web.example/enterprise/service/payment?invoiceId=invoice-id';
    expect(form.fields.at(-1)?.value).toBe(
      createHmac('sha256', config.secret).update(signed).digest('base64'),
    );
    expect(JSON.stringify(form)).not.toContain(config.secret);
    expect(() =>
      sepayGatewayForm(config, {
        id: 'id',
        number: 'AGT-2026-000001',
        amount: 0n,
      }),
    ).toThrow();
  });
  it('keeps retry timestamp/customer changes out of settlement fingerprint', () => {
    const first = parseSepayIpn(body);
    expect(first).toMatchObject({
      id: 'PG:transaction-1',
      amount: 1000n,
      rejection: null,
    });
    expect(
      parseSepayIpn({ ...body, timestamp: 2, customer: { id: 'private' } }),
    ).toEqual(first);
    expect(
      parseSepayIpn({
        ...body,
        transaction: { ...body.transaction, transaction_amount: '2000' },
      }).payloadHash,
    ).not.toBe(first.payloadHash);
  });
  it('marks wrong amounts, currency, statuses and void notifications for review', () => {
    for (const override of [
      { transaction_amount: '999' },
      { transaction_currency: 'USD' },
      { transaction_status: 'PENDING' },
      { transaction_type: 'REFUND' },
      { payment_method: 'CARD' },
    ])
      expect(
        parseSepayIpn({
          ...body,
          transaction: { ...body.transaction, ...override },
        }).rejection,
      ).not.toBeNull();
    const voided = parseSepayIpn({
      ...body,
      notification_type: 'TRANSACTION_VOID',
    });
    expect(voided.id).toBe('PG:VOID:transaction-1');
    expect(voided.rejection).not.toBeNull();
  });
  it('rejects fractional, overflowing, malformed amounts and invalid dates', () => {
    for (const transaction_amount of [
      '1.50',
      '1e3',
      '-1',
      '0',
      '9007199254740992',
      null,
      1.1,
    ])
      expect(() =>
        parseSepayIpn({
          ...body,
          transaction: { ...body.transaction, transaction_amount },
        }),
      ).toThrow();
    expect(() =>
      parseSepayIpn({
        ...body,
        transaction: {
          ...body.transaction,
          transaction_date: '2026-02-30 10:00:00',
        },
      }),
    ).toThrow();
    expect(() => parseSepayIpn({ ...body, order: null })).toThrow();
  });
});
