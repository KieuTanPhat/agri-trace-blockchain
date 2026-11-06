import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service.js';
import { decryptOtp } from './registration-otp.service.js';
import { contractAttachment, enterpriseMailHtml } from './mail-template.js';
import {
  assertSmtpAccepted,
  assertSmtpRecipient,
  mailConfiguration,
  safeMailFailure,
  smtpOptions,
} from './mail-transport.js';

/** Only Worker sends mail. SMTP never falls back to the local test inbox. */
@Injectable()
export class EnterpriseMailWorker {
  private readonly logger = new Logger(EnterpriseMailWorker.name);
  constructor(private readonly db: PrismaService) {}
  get enabled() {
    const mode = process.env.MAIL_TRANSPORT?.trim().toLowerCase();
    return !!mode && mode !== 'disabled';
  }
  async processAll() {
    const config = mailConfiguration();
    if (config.mode === 'disabled') return;
    const candidates = await this.db.enterpriseMail.findMany({
      where: {
        status: 'PENDING',
        nextAttemptAt: { lte: new Date() },
        OR: [{ leaseExpiresAt: null }, { leaseExpiresAt: { lte: new Date() } }],
      },
      orderBy: { createdAt: 'asc' },
      take: 20,
      select: { id: true },
    });
    for (const candidate of candidates) {
      const token = randomUUID();
      const claimed = await this.db.enterpriseMail.updateMany({
        where: {
          id: candidate.id,
          status: 'PENDING',
          OR: [
            { leaseExpiresAt: null },
            { leaseExpiresAt: { lte: new Date() } },
          ],
        },
        data: {
          leaseToken: token,
          leaseExpiresAt: new Date(Date.now() + 60_000),
          attempts: { increment: 1 },
        },
      });
      if (!claimed.count) continue;
      const row = await this.db.enterpriseMail.findUniqueOrThrow({
        where: { id: candidate.id },
      });
      try {
        if (config.mode === 'smtp') assertSmtpRecipient(row.recipient);
        const isStaffReset = row.kind === 'STAFF_PASSWORD_RESET';
        const staffReset =
          isStaffReset && row.staffResetId
            ? await this.db.staffPasswordReset.findUnique({
                where: { id: row.staffResetId },
              })
            : null;
        if (
          isStaffReset &&
          (!staffReset ||
            staffReset.userId !== row.userId ||
            staffReset.email !== row.recipient ||
            staffReset.expiresAt <= new Date() ||
            staffReset.consumedAt ||
            staffReset.supersededAt ||
            staffReset.attempts >= 5)
        ) {
          await this.db.enterpriseMail.updateMany({
            where: { id: row.id, leaseToken: token, status: 'PENDING' },
            data: {
              status: 'CANCELLED',
              otpCiphertext: null,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          continue;
        }
        const verification = row.verificationId
          ? await this.db.registrationEmailVerification.findUnique({
              where: { id: row.verificationId },
            })
          : null;
        if (
          row.kind === 'REGISTRATION_OTP' &&
          (!verification ||
            verification.expiresAt <= new Date() ||
            verification.supersededAt ||
            verification.consumedAt ||
            verification.verifiedAt)
        ) {
          await this.db.enterpriseMail.updateMany({
            where: { id: row.id, leaseToken: token, status: 'PENDING' },
            data: {
              status: 'CANCELLED',
              otpCiphertext: null,
              leaseToken: null,
              leaseExpiresAt: null,
            },
          });
          continue;
        }
        const sealed = row.otpCiphertext
          ? decryptOtp(row.otpCiphertext)
          : undefined;
        const otp =
          row.kind === 'REGISTRATION_OTP' || isStaffReset ? sealed : undefined;
        const password = ['CREDENTIALS', 'ACCOUNT_CREDENTIALS'].includes(
          row.kind,
        )
          ? sealed
          : undefined;
        const links: Record<string, [string, string]> = {
          APPROVED: ['Hoàn thiện dịch vụ', '/enterprise/service'],
          CREDENTIALS: ['Đăng nhập theo dõi hồ sơ', '/login'],
          ACCOUNT_CREDENTIALS: ['Đăng nhập AgriTrace', '/login'],
        };
        const link = links[row.kind];
        const html = enterpriseMailHtml({
          subject: row.subject,
          text: row.text,
          otp,
          password,
          ...(link
            ? {
                action: {
                  label: link[0],
                  url: new URL(
                    link[1],
                    process.env.ENTERPRISE_WEB_BASE_URL ??
                      'http://127.0.0.1:3001',
                  ).href,
                },
              }
            : {}),
        });
        const text =
          row.text +
          (otp
            ? `\n\nMã OTP: ${otp}\nHiệu lực 10 phút. Không chia sẻ mã.`
            : '') +
          (password
            ? `\n\nMật khẩu tạm: ${password}\nĐổi mật khẩu ở lần đăng nhập đầu tiên.`
            : '');
        const attachment =
          !row.attachmentPdf && row.attachment
            ? contractAttachment(row.attachment)
            : null;
        const attachments = [
          ...(row.attachmentPdf
            ? [
                {
                  filename: 'hop-dong-agritrace.pdf',
                  content: Buffer.from(row.attachmentPdf),
                  contentType: 'application/pdf',
                  cid: undefined,
                },
              ]
            : []),
          ...(attachment
            ? [
                {
                  filename: 'hop-dong-agritrace-mo-phong.html',
                  content: Buffer.from(attachment),
                  contentType: 'text/html; charset=utf-8',
                  cid: undefined,
                },
              ]
            : []),
        ];
        if (config.mode === 'mailpit') {
          const response = await fetch(
            new URL('/api/v1/send', config.baseUrl),
            {
              method: 'POST',
              headers: { 'content-type': 'application/json' },
              body: JSON.stringify({
                From: {
                  Email: config.from,
                  Name: config.fromName,
                },
                To: [{ Email: row.recipient }],
                Subject: row.subject,
                Text: text,
                HTML: html,
                Headers: { 'Message-ID': `<${row.id}@agritrace.local>` },
                Attachments: attachments.map((a) => ({
                  Filename: a.filename,
                  ContentType: a.contentType,
                  Content: a.content.toString('base64'),
                  ...(a.cid ? { ContentID: a.cid } : {}),
                })),
              }),
              signal: AbortSignal.timeout(10_000),
            },
          );
          if (!response.ok)
            throw new Error('Local mail transport refused the message');
        } else {
          const transport = nodemailer.createTransport(smtpOptions(config));
          try {
            const result = await transport.sendMail({
              from: {
                address: config.from,
                name: config.fromName,
              },
              to: row.recipient,
              subject: row.subject,
              text,
              html,
              attachments,
              messageId: `<${row.id}@agritrace.local>`,
              disableFileAccess: true,
              disableUrlAccess: true,
            });
            assertSmtpAccepted(result, row.recipient);
          } finally {
            transport.close();
          }
        }
        await this.db.enterpriseMail.updateMany({
          where: { id: row.id, leaseToken: token, status: 'PENDING' },
          data: {
            status: 'SENT',
            sentAt: new Date(),
            otpCiphertext: null,
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
      } catch (cause) {
        // The reason only, never the recipient, password or OTP.
        this.logger.warn(
          `Mail ${row.id} (${row.kind}) attempt ${row.attempts} failed: ${safeMailFailure(cause)}`,
        );
        await this.db.enterpriseMail.updateMany({
          where: { id: row.id, leaseToken: token, status: 'PENDING' },
          data: {
            nextAttemptAt: new Date(
              Date.now() +
                Math.min(300_000, 5_000 * 2 ** Math.min(row.attempts, 6)),
            ),
            leaseToken: null,
            leaseExpiresAt: null,
          },
        });
      }
    }
  }
}
