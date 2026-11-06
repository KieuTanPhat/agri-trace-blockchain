import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service.js';
import { EnterpriseMailWorker } from './enterprise-mail.worker.js';
import { encryptOtp } from './registration-otp.service.js';
const smtp = vi.hoisted(() => ({
  sendMail: vi.fn(),
  close: vi.fn(),
  createTransport: vi.fn(),
}));
vi.mock('nodemailer', () => ({
  default: { createTransport: smtp.createTransport },
}));
function fixture(recipient = 'recipient@gmail.com') {
  const pdf = Buffer.from('%PDF-1.7 unchanged signed snapshot');
  const row = {
    staffResetId: null as string | null,
    userId: 'user-a',
    id: 'mail-test',
    kind: 'CONTRACT',
    recipient,
    subject: 'Hợp đồng',
    text: 'Hợp đồng đã xác nhận',
    attempts: 1,
    attachmentPdf: pdf,
    attachment: null,
    otpCiphertext: null,
    verificationId: null,
  };
  const db = {
    staffPasswordReset: { findUnique: vi.fn() },
    enterpriseMail: {
      findMany: vi.fn().mockResolvedValue([{ id: row.id }]),
      findUniqueOrThrow: vi.fn().mockResolvedValue(row),
      updateMany: vi.fn().mockResolvedValue({ count: 1 }),
    },
  };
  return {
    db,
    pdf,
    row,
    worker: new EnterpriseMailWorker(db as unknown as PrismaService),
  };
}
beforeEach(() => {
  vi.stubEnv('MAIL_TRANSPORT', 'smtp');
  vi.stubEnv('SMTP_HOST', 'smtp.gmail.com');
  vi.stubEnv('SMTP_PORT', '587');
  vi.stubEnv('SMTP_SECURE', 'false');
  vi.stubEnv('SMTP_USER', 'sender@gmail.com');
  vi.stubEnv('SMTP_PASSWORD', 'abcdefghijklmnop');
  vi.stubEnv('MAIL_FROM', 'sender@gmail.com');
  smtp.createTransport.mockReturnValue(smtp);
  smtp.sendMail.mockResolvedValue({ accepted: ['recipient@gmail.com'] });
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});
describe('SMTP contract delivery worker', () => {
  it('validates config before claiming any queued mail', async () => {
    vi.stubEnv('SMTP_PASSWORD', '');
    const { worker, db } = fixture();
    await expect(worker.processAll()).rejects.toThrow('SMTP configuration');
    expect(db.enterpriseMail.findMany).not.toHaveBeenCalled();
  });
  it('attaches the exact PDF bytes and only then marks the claimed row sent', async () => {
    const { worker, db, pdf } = fixture();
    await worker.processAll();
    expect(smtp.sendMail).toHaveBeenCalledOnce();
    const sent = smtp.sendMail.mock.calls[0][0];
    expect(sent.attachments).toEqual([
      {
        filename: 'hop-dong-agritrace.pdf',
        content: pdf,
        contentType: 'application/pdf',
        cid: undefined,
      },
    ]);
    expect(sent.html).not.toContain('Xem hợp đồng');
    expect(db.enterpriseMail.updateMany.mock.calls[1][0]).toMatchObject({
      where: {
        id: 'mail-test',
        status: 'PENDING',
        leaseToken: expect.any(String),
      },
      data: { status: 'SENT', sentAt: expect.any(Date), leaseToken: null },
    });
    expect(smtp.close).toHaveBeenCalledOnce();
  });
  it.each(['rejected', 'authentication'])(
    'preserves pending status and retry on %s failure without logging secrets',
    async (reason) => {
      const warn = vi
        .spyOn(Logger.prototype, 'warn')
        .mockImplementation(() => undefined);
      if (reason === 'rejected')
        smtp.sendMail.mockResolvedValue({ accepted: [] });
      else
        smtp.sendMail.mockRejectedValue(
          Object.assign(new Error('AUTH my-secret recipient@gmail.com'), {
            code: 'EAUTH',
          }),
        );
      const { worker, db } = fixture();
      await worker.processAll();
      const update = db.enterpriseMail.updateMany.mock.calls[1][0];
      expect(update.data).toMatchObject({
        nextAttemptAt: expect.any(Date),
        leaseToken: null,
        leaseExpiresAt: null,
      });
      expect(update.data).not.toHaveProperty('status');
      expect(JSON.stringify(warn.mock.calls)).not.toMatch(
        /my-secret|recipient@gmail.com/,
      );
      expect(smtp.close).toHaveBeenCalledOnce();
    },
  );
  it('never silently delivers a reserved SMTP recipient through Mailpit', async () => {
    vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    const fetch = vi.spyOn(globalThis, 'fetch');
    const { worker, db } = fixture('fixture@example.test');
    await worker.processAll();
    expect(fetch).not.toHaveBeenCalled();
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(
      db.enterpriseMail.updateMany.mock.calls[1][0].data,
    ).not.toHaveProperty('status');
  });
});

describe('staff recovery mail', () => {
  it('sends the sealed OTP through SMTP without a contract attachment', async () => {
    vi.stubEnv('JWT_SECRET', 'unit-worker-reset-secret');
    const { worker, db, row } = fixture();
    row.kind = 'STAFF_PASSWORD_RESET';
    row.staffResetId = 'reset-a';
    row.attachmentPdf = null as never;
    row.otpCiphertext = encryptOtp('123456') as never;
    db.staffPasswordReset.findUnique.mockResolvedValue({
      id: 'reset-a',
      userId: 'user-a',
      email: row.recipient,
      attempts: 0,
      expiresAt: new Date(Date.now() + 600000),
      consumedAt: null,
      supersededAt: null,
    });
    await worker.processAll();
    expect(smtp.sendMail.mock.calls[0][0].text).toContain('123456');
    expect(smtp.sendMail.mock.calls[0][0].attachments).toEqual([]);
  });
  it('cancels an expired recovery message instead of sending an unusable code', async () => {
    const { worker, db, row } = fixture();
    row.kind = 'STAFF_PASSWORD_RESET';
    row.staffResetId = 'reset-a';
    db.staffPasswordReset.findUnique.mockResolvedValue({
      userId: 'user-a',
      email: row.recipient,
      attempts: 0,
      expiresAt: new Date(0),
    });
    await worker.processAll();
    expect(smtp.sendMail).not.toHaveBeenCalled();
    expect(db.enterpriseMail.updateMany.mock.calls[1][0].data).toMatchObject({
      status: 'CANCELLED',
      otpCiphertext: null,
    });
  });
});
