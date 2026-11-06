import { createHash, timingSafeEqual } from 'node:crypto';
import {
  BadRequestException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';

export type SepayMode = 'test' | 'live';
export interface SepayConfiguration {
  mode: SepayMode;
  bank: string;
  accountNumber: string;
  accountHolder: string;
  virtualAccount: string | null;
  webhookKey: string;
}

/** Server-only configuration. Nothing enables collection merely by opening UI. */
export function sepayConfiguration(
  env: NodeJS.ProcessEnv = process.env,
): SepayConfiguration | null {
  const mode = env.SEPAY_MODE ?? 'disabled';
  if (mode === 'disabled') return null;
  if (
    !['test', 'live'].includes(mode) ||
    env.ENTERPRISE_PAYMENTS_ENABLED !== 'true'
  )
    throw new ServiceUnavailableException(
      'SePay chưa được cấu hình để nhận thanh toán',
    );
  if (mode === 'test' && env.NODE_ENV === 'production')
    throw new ServiceUnavailableException(
      'Không mở SePay test trên môi trường production',
    );
  const bank = env.SEPAY_BANK?.trim() ?? '';
  const accountNumber = env.SEPAY_ACCOUNT_NUMBER?.trim() ?? '';
  const accountHolder = env.SEPAY_ACCOUNT_HOLDER?.trim() ?? '';
  const webhookKey = env.SEPAY_WEBHOOK_KEY ?? '';
  const virtualAccount = env.SEPAY_VIRTUAL_ACCOUNT?.trim() || null;
  if (
    !/^[A-Za-z][A-Za-z0-9]{1,39}$/.test(bank) ||
    !/^[A-Za-z0-9]{3,34}$/.test(accountNumber) ||
    accountHolder.length < 2 ||
    accountHolder.length > 100 ||
    Buffer.byteLength(webhookKey) < 32 ||
    Buffer.byteLength(webhookKey) > 256 ||
    (virtualAccount !== null && !/^[A-Za-z0-9]{3,34}$/.test(virtualAccount))
  )
    throw new ServiceUnavailableException(
      'Cấu hình ngân hàng hoặc khóa webhook SePay chưa hợp lệ',
    );
  return {
    mode: mode as SepayMode,
    bank,
    accountNumber,
    accountHolder,
    virtualAccount,
    webhookKey,
  };
}

/** SePay API Key auth: Authorization: Apikey <server secret>. HTTPS is required.
 * Hash both sides to fixed size before a constant-time comparison. */
export function authenticateSepay(
  authorization: string | undefined,
  config: SepayConfiguration,
) {
  const supplied = /^Apikey ([^\r\n]+)$/i.exec(authorization ?? '')?.[1];
  const digest = (value: string) => createHash('sha256').update(value).digest();
  if (
    !supplied ||
    !timingSafeEqual(digest(supplied), digest(config.webhookKey))
  )
    throw new UnauthorizedException('Webhook SePay không được xác thực');
}

export interface SepayTransaction {
  id: number;
  gateway: string;
  accountNumber: string;
  subAccount: string | null;
  code: string | null;
  content: string;
  transferType: 'in' | 'out';
  transferAmount: number;
  referenceCode: string;
  transactionDate: string;
}

/** Only documented settlement fields are retained; balances/descriptions are not
 * needed for settlement and must not enter public responses or logs. */
export function parseSepayTransaction(input: unknown): SepayTransaction {
  if (!input || typeof input !== 'object' || Array.isArray(input))
    throw new BadRequestException('Nội dung webhook SePay không hợp lệ');
  const value = input as Record<string, unknown>;
  const text = (key: string, max: number, nullable = false) => {
    const field = value[key];
    if (nullable && (field === null || field === undefined || field === ''))
      return null;
    if (typeof field !== 'string' || !field.trim() || field.length > max)
      throw new BadRequestException(`Trường ${key} của SePay không hợp lệ`);
    return field.trim();
  };
  if (
    !Number.isSafeInteger(value.id) ||
    Number(value.id) <= 0 ||
    !Number.isSafeInteger(value.transferAmount) ||
    Number(value.transferAmount) <= 0 ||
    (value.transferType !== 'in' && value.transferType !== 'out')
  )
    throw new BadRequestException(
      'Mã giao dịch, loại hoặc số tiền SePay không hợp lệ',
    );
  const transactionDate = text('transactionDate', 19)!;
  const parsedTime = Date.parse(transactionDate.replace(' ', 'T') + '+07:00');
  if (
    !/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(transactionDate) ||
    !Number.isFinite(parsedTime) ||
    new Date(parsedTime + 7 * 3600000)
      .toISOString()
      .slice(0, 19)
      .replace('T', ' ') !== transactionDate
  )
    throw new BadRequestException('Ngày giao dịch SePay không hợp lệ');
  return {
    id: value.id as number,
    gateway: text('gateway', 80)!,
    accountNumber: text('accountNumber', 34)!,
    subAccount: text('subAccount', 34, true),
    code: text('code', 40, true),
    content: text('content', 4000)!,
    transferType: value.transferType as 'in' | 'out',
    transferAmount: value.transferAmount as number,
    referenceCode: text('referenceCode', 120, true) ?? '',
    transactionDate,
  };
}

/** Stable invoice code: AGT-2026-000001 -> AGT2026000001. Configure the
 * SePay payment-code prefix AGT with a numeric suffix of 10–26 characters. */
export function sepayPaymentCode(invoiceNumber: string) {
  if (!/^AGT-\d{4}-\d{6,22}$/.test(invoiceNumber))
    throw new BadRequestException('Số hóa đơn không hỗ trợ thanh toán QR');
  return invoiceNumber.replaceAll('-', '');
}

export function sepayInvoiceNumber(
  transaction: Pick<SepayTransaction, 'code' | 'content'>,
): string | null {
  const codes = new Set(
    [
      ...transaction.content
        .toUpperCase()
        .matchAll(/(?:^|[^A-Z0-9])(AGT\d{10,26})(?=$|[^A-Z0-9])/g),
    ].map((m) => m[1]),
  );
  if (codes.size !== 1) return null;
  const [code] = codes;
  if (transaction.code && transaction.code.toUpperCase() !== code) return null;
  return `AGT-${code.slice(3, 7)}-${code.slice(7)}`;
}

export function sepayRecipientMatches(
  transaction: SepayTransaction,
  config: SepayConfiguration,
) {
  const bank = (value: string) =>
    value.replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  return (
    transaction.transferType === 'in' &&
    bank(transaction.gateway) === bank(config.bank) &&
    transaction.accountNumber === config.accountNumber &&
    (!config.virtualAccount || transaction.subAccount === config.virtualAccount)
  );
}

export function sepayQrUrl(
  config: SepayConfiguration,
  invoiceNumber: string,
  amount: bigint,
) {
  if (amount <= 0n || amount > BigInt(Number.MAX_SAFE_INTEGER))
    throw new BadRequestException('Số tiền hóa đơn không hỗ trợ thanh toán QR');
  const url = new URL('https://vietqr.app/img');
  url.search = new URLSearchParams({
    acc: config.virtualAccount ?? config.accountNumber,
    bank: config.bank,
    amount: amount.toString(),
    des: sepayPaymentCode(invoiceNumber),
    template: 'compact',
    showinfo: 'true',
    holder: config.accountHolder,
  }).toString();
  return url.toString();
}
