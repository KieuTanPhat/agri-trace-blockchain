import { Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import { PrismaService } from '../../prisma/prisma.service.js';
import { decryptOtp } from './registration-otp.service.js';
import { contractAttachment, enterpriseMailHtml } from './mail-template.js';

/** Only Worker sends mail. Reserved test recipients always use the local sink. */
@Injectable()
export class EnterpriseMailWorker {
  private readonly logger = new Logger(EnterpriseMailWorker.name);
  constructor(private readonly db: PrismaService) {}
  get enabled() {
    return ['mailpit', 'smtp'].includes(process.env.MAIL_TRANSPORT ?? '');
  }
  async processAll() {
    if (!this.enabled) return;
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
        const otp = row.kind === 'REGISTRATION_OTP' ? sealed : undefined;
        const password = ['CREDENTIALS', 'ACCOUNT_CREDENTIALS'].includes(row.kind)
          ? sealed
          : undefined;
        const links: Record<string, [string, string]> = {
          APPROVED: ['Hoàn thiện dịch vụ', '/enterprise/service'],
          CONTRACT: ['Xem hợp đồng', '/enterprise/service/contract'],
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
        const logo = await readFile(
          new URL('../../../assets/agritrace-logo.png', import.meta.url),
        );
        const attachment = row.attachment
          ? contractAttachment(row.attachment)
          : null;
        const attachments = [
          {
            filename: 'agritrace-logo.png',
            content: logo,
            contentType: 'image/png',
            cid: 'agritrace-logo',
          },
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
        const reserved =
          /(?:\.test|@example\.(?:com|org|net)|@localhost)$/i.test(
            row.recipient,
          );
        if (process.env.MAIL_TRANSPORT === 'mailpit' || reserved) {
          if (process.env.NODE_ENV === 'production')
            throw new Error('Test mail is disabled in production');
          const base = new URL(
            process.env.MAILPIT_API_URL ?? 'http://mail:8025',
          );
          if (
            base.protocol !== 'http:' ||
            !['mail', '127.0.0.1', 'localhost'].includes(base.hostname) ||
            base.username ||
            base.password ||
            base.pathname !== '/' ||
            base.search ||
            base.hash
          )
            throw new Error('Invalid local mailbox');
          const response = await fetch(new URL('/api/v1/send', base), {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({
              From: {
                Email: process.env.MAIL_FROM ?? 'no-reply@agritrace.local',
                Name: process.env.MAIL_FROM_NAME ?? 'AgriTrace',
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
          });
          if (!response.ok)
            throw new Error('Local mail transport refused the message');
        } else {
          const host = process.env.SMTP_HOST,
            port = Number(process.env.SMTP_PORT ?? 587),
            secure = process.env.SMTP_SECURE === 'true';
          if (
            !host ||
            !process.env.SMTP_USER ||
            !process.env.SMTP_PASSWORD ||
            !process.env.MAIL_FROM ||
            ![465, 587, 2525].includes(port)
          )
            throw new Error('SMTP configuration is incomplete');
          const transport = nodemailer.createTransport({
            host,
            port,
            secure,
            requireTLS: !secure,
            auth: {
              user: process.env.SMTP_USER,
              pass: process.env.SMTP_PASSWORD,
            },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 15_000,
            logger: false,
            debug: false,
            tls: { minVersion: 'TLSv1.2' },
          });
          try {
            await transport.sendMail({
              from: {
                address: process.env.MAIL_FROM,
                name: process.env.MAIL_FROM_NAME ?? 'AgriTrace',
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
          `Mail ${row.id} (${row.kind}) attempt ${row.attempts} failed: ${cause instanceof Error ? cause.message.slice(0, 200) : 'unknown error'}`,
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
