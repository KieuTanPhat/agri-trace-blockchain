import 'dotenv/config';
import { readFile, stat } from 'node:fs/promises';
import nodemailer from 'nodemailer';
import {
  mailConfiguration,
  smtpOptions,
  assertSmtpRecipient,
  assertSmtpAccepted,
  safeMailFailure,
} from '../dist/modules/enterprise-onboarding/mail-transport.js';
import { enterpriseMailHtml } from '../dist/modules/enterprise-onboarding/mail-template.js';

// Operator tool only. It does not touch orders, payments, outbox rows or the DB.
// Preview sends only to the configured sender, never a restored queue recipient.
let transport;
try {
  const [command, flag, path, ...extra] = process.argv.slice(2);
  if (
    !['verify', 'preview'].includes(command) ||
    extra.length ||
    (command === 'verify' && (flag || path)) ||
    (command === 'preview' && (flag !== '--pdf' || !path))
  )
    throw new Error(
      'Usage: npm run mail:verify OR npm run mail:preview -- --pdf /absolute/path/contract.pdf',
    );
  const config = mailConfiguration();
  if (config.mode !== 'smtp')
    throw new Error(
      'Set MAIL_TRANSPORT=smtp and configure the private SMTP environment first.',
    );
  let pdf;
  if (command === 'preview') {
    assertSmtpRecipient(config.user);
    if (
      !(await stat(path)).isFile() ||
      (await stat(path)).size > 2 * 1024 * 1024
    )
      throw new Error('Choose a PDF file no larger than 2 MiB.');
    pdf = await readFile(path);
    if (pdf.subarray(0, 5).toString() !== '%PDF-')
      throw new Error('The attachment must contain a PDF.');
  }
  transport = nodemailer.createTransport(smtpOptions(config));
  await transport.verify();
  if (command === 'verify') {
    console.log('SMTP authentication and TLS verified. No email sent.');
  } else {
    const subject = '[TEST] Gửi thử hợp đồng PDF AgriTrace';
    const text =
      'Đây là bản gửi thử để kiểm tra SMTP và tệp PDF đính kèm. Email này không xác nhận thanh toán hay kích hoạt dịch vụ.';
    const result = await transport.sendMail({
      from: { address: config.from, name: config.fromName },
      to: config.user,
      subject,
      text,
      html: enterpriseMailHtml({ subject, text }),
      attachments: [
        {
          filename: 'hop-dong-agritrace.pdf',
          content: pdf,
          contentType: 'application/pdf',
        },
      ],
      disableFileAccess: true,
      disableUrlAccess: true,
    });
    assertSmtpAccepted(result, config.user);
    console.log(
      'SMTP accepted the test email to the configured sender with one PDF. Check Inbox and Spam to confirm delivery.',
    );
  }
} catch (error) {
  // Only operator-controlled validation messages are printed verbatim.
  const validation =
    error instanceof Error &&
    /^(Usage:|Set MAIL_TRANSPORT|Choose a PDF|The attachment)/.test(
      error.message,
    );
  console.error(validation ? error.message : safeMailFailure(error));
  process.exitCode = 1;
} finally {
  transport?.close();
}
