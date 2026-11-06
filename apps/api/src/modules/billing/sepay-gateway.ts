import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { SepayMode } from './sepay-protocol.js';

export interface SepayGatewayConfiguration {
  mode: SepayMode;
  merchant: string;
  secret: string;
  ipnSecret: string;
  webOrigin: string;
}

export function sepayGatewayConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): SepayGatewayConfiguration | null {
  const mode = env.SEPAY_GATEWAY_MODE ?? 'disabled';
  if (mode === 'disabled') return null;
  const merchant = env.SEPAY_MERCHANT_ID ?? '';
  const secret = env.SEPAY_MERCHANT_SECRET ?? '';
  const ipnSecret = env.SEPAY_IPN_SECRET ?? '';
  let origin: URL;
  try {
    origin = new URL(env.SEPAY_WEB_ORIGIN ?? '');
  } catch {
    throw new ServiceUnavailableException(
      'Thiếu địa chỉ Web công khai cho SePay',
    );
  }
  if (
    !['test', 'live'].includes(mode) ||
    env.ENTERPRISE_PAYMENTS_ENABLED !== 'true' ||
    (env.SEPAY_MODE ?? 'disabled') !== 'disabled' ||
    (mode === 'test' && env.NODE_ENV === 'production') ||
    !/^[A-Za-z0-9_-]{3,100}$/.test(merchant) ||
    secret.length < 16 ||
    secret.length > 256 ||
    ipnSecret.length < 32 ||
    ipnSecret.length > 256 ||
    secret === ipnSecret ||
    origin.protocol !== 'https:' ||
    origin.username ||
    origin.password ||
    origin.search ||
    origin.hash ||
    origin.pathname !== '/'
  ) {
    throw new ServiceUnavailableException(
      'Cấu hình SePay Gateway chưa hợp lệ; cần khóa IPN riêng và HTTPS',
    );
  }
  return {
    mode: mode as SepayMode,
    merchant,
    secret,
    ipnSecret,
    webOrigin: origin.origin,
  };
}

export function authenticateSepayIpn(
  supplied: string | undefined,
  config: SepayGatewayConfiguration,
) {
  const hash = (s: string) => createHash('sha256').update(s).digest();
  if (!supplied || !timingSafeEqual(hash(supplied), hash(config.ipnSecret)))
    throw new UnauthorizedException('IPN SePay không được xác thực');
}

export function sepayGatewayForm(
  config: SepayGatewayConfiguration,
  invoice: { id: string; number: string; amount: bigint },
) {
  if (
    !/^AGT-\d{4}-\d{6,22}$/.test(invoice.number) ||
    invoice.amount <= 0n ||
    invoice.amount > BigInt(Number.MAX_SAFE_INTEGER)
  )
    throw new BadRequestException('Hóa đơn không hỗ trợ SePay Gateway');
  const returnUrl = new URL('/enterprise/service/payment', config.webOrigin);
  returnUrl.searchParams.set('invoiceId', invoice.id);
  // Provider requires this exact signing/input order. All values originate on server.
  const fields: Record<string, string> = {
    order_amount: invoice.amount.toString(),
    merchant: config.merchant,
    currency: 'VND',
    operation: 'PURCHASE',
    order_description: `Thanh toan goi dich vu ${invoice.number}`,
    order_invoice_number: invoice.number,
    payment_method: 'BANK_TRANSFER',
    success_url: returnUrl.toString(),
    error_url: returnUrl.toString(),
    cancel_url: returnUrl.toString(),
  };
  const signed = Object.entries(fields)
    .map(([k, v]) => `${k}=${v}`)
    .join(',');
  fields.signature = createHmac('sha256', config.secret)
    .update(signed)
    .digest('base64');
  return {
    action:
      config.mode === 'test'
        ? 'https://pay-sandbox.sepay.vn/v1/checkout/init'
        : 'https://pay.sepay.vn/v1/checkout/init',
    fields: Object.entries(fields).map(([name, value]) => ({ name, value })),
  };
}

export interface SepaySettlement {
  id: string;
  invoiceNumber: string | null;
  amount: bigint;
  posted: number;
  payloadHash: string;
  rejection: string | null;
}

/** Retain settlement data only; exclude customer/card details and retry timestamp. */
export function parseSepayIpn(input: unknown): SepaySettlement {
  const object = (value: unknown): Record<string, unknown> => {
    if (!value || typeof value !== 'object' || Array.isArray(value))
      throw new BadRequestException('IPN SePay không hợp lệ');
    return value as Record<string, unknown>;
  };
  const text = (value: unknown, max = 100): string => {
    if (typeof value !== 'string' || !value || value.length > max)
      throw new BadRequestException('Trường IPN không hợp lệ');
    return value;
  };
  const money = (value: unknown) => {
    const s =
      typeof value === 'number' && Number.isSafeInteger(value)
        ? String(value)
        : text(value, 30);
    if (!/^[0-9]{1,16}(?:\.0{1,2})?$/.test(s))
      throw new BadRequestException('Số tiền IPN không hợp lệ');
    const n = BigInt(s.split('.')[0]);
    if (n <= 0n || n > BigInt(Number.MAX_SAFE_INTEGER))
      throw new BadRequestException('Số tiền IPN ngoài giới hạn');
    return n;
  };
  const body = object(input),
    order = object(body.order),
    transaction = object(body.transaction);
  const type = text(body.notification_type);
  if (!['ORDER_PAID', 'TRANSACTION_VOID'].includes(type))
    throw new BadRequestException('Loại IPN chưa được hỗ trợ');
  const id = text(transaction.id);
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(id))
    throw new BadRequestException('Mã giao dịch IPN không hợp lệ');
  const number = text(order.order_invoice_number);
  const amount = money(transaction.transaction_amount),
    orderAmount = money(order.order_amount);
  const date = text(transaction.transaction_date, 19);
  const posted = Date.parse(date.replace(' ', 'T') + '+07:00');
  if (
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(date) ||
    !Number.isFinite(posted) ||
    new Date(posted + 7 * 3600000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ') !== date
  )
    throw new BadRequestException('Ngày giao dịch IPN không hợp lệ');
  const normalized = {
    type,
    id,
    orderId: text(order.id),
    number,
    amount: amount.toString(),
    orderAmount: orderAmount.toString(),
    date,
    status: text(order.order_status),
    currency: text(order.order_currency),
    transactionStatus: text(transaction.transaction_status),
    transactionCurrency: text(transaction.transaction_currency),
    transactionType: text(transaction.transaction_type),
    paymentMethod: text(transaction.payment_method),
  };
  const approved =
    type === 'ORDER_PAID' &&
    normalized.status === 'CAPTURED' &&
    normalized.transactionStatus === 'APPROVED' &&
    normalized.transactionType === 'PAYMENT' &&
    normalized.paymentMethod === 'BANK_TRANSFER' &&
    normalized.currency === 'VND' &&
    normalized.transactionCurrency === 'VND' &&
    amount === orderAmount;
  return {
    id: `PG:${type === 'TRANSACTION_VOID' ? 'VOID:' : ''}${id}`,
    invoiceNumber: /^AGT-\d{4}-\d{6,22}$/.test(number) ? number : null,
    amount,
    posted,
    payloadHash: createHash('sha256')
      .update(JSON.stringify(normalized))
      .digest('hex'),
    rejection: approved ? null : 'GATEWAY_STATUS_OR_AMOUNT_MISMATCH',
  };
}
