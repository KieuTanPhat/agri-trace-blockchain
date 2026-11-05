import type SMTPTransport from 'nodemailer/lib/smtp-transport/index.js';

type MailEnvironment = Record<string, string | undefined>;
type Sender = { from: string; fromName: string };
export type MailConfiguration =
  | { mode: 'disabled' }
  | (Sender & { mode: 'mailpit'; baseUrl: URL })
  | (Sender & {
      mode: 'smtp';
      host: string;
      port: number;
      secure: boolean;
      user: string;
      password: string;
    });

export class MailConfigurationError extends Error {}
const mailbox = /^[^\s<>@,;]+@[^\s<>@,;]+$/;
export function isReservedMailRecipient(address: string) {
  const domain = address.trim().toLowerCase().split('@')[1] ?? '';
  return [
    'test',
    'invalid',
    'localhost',
    'example',
    'example.com',
    'example.org',
    'example.net',
  ].some((reserved) => domain === reserved || domain.endsWith('.' + reserved));
}
export function assertSmtpRecipient(address: string) {
  if (!mailbox.test(address) || isReservedMailRecipient(address))
    throw new MailConfigurationError(
      'SMTP recipient must be a real email address; test recipients are not sent externally',
    );
}
/** Credentials belong to the worker only. SMTP never falls back to a local inbox. */
export function mailConfiguration(
  env: MailEnvironment = process.env,
): MailConfiguration {
  const mode = env.MAIL_TRANSPORT?.trim().toLowerCase() || 'disabled';
  if (mode === 'disabled') return { mode };
  if (mode !== 'smtp' && mode !== 'mailpit')
    throw new MailConfigurationError(
      'MAIL_TRANSPORT must be smtp, mailpit or disabled',
    );
  const user = env.SMTP_USER?.trim() ?? '';
  const from =
    env.MAIL_FROM?.trim() ||
    (mode === 'smtp' ? user : 'no-reply@agritrace.local');
  const fromName = env.MAIL_FROM_NAME?.trim() || 'AgriTrace';
  if (!mailbox.test(from) || /[\r\n]/.test(fromName))
    throw new MailConfigurationError('Mail sender configuration is invalid');
  if (mode === 'mailpit') {
    if (env.NODE_ENV === 'production')
      throw new MailConfigurationError('Mailpit is disabled in production');
    let baseUrl: URL;
    try {
      baseUrl = new URL(env.MAILPIT_API_URL || 'http://mail:8025');
    } catch {
      throw new MailConfigurationError('Invalid local mailbox');
    }
    if (
      baseUrl.protocol !== 'http:' ||
      !['mail', '127.0.0.1', 'localhost'].includes(baseUrl.hostname) ||
      baseUrl.username ||
      baseUrl.password ||
      baseUrl.pathname !== '/' ||
      baseUrl.search ||
      baseUrl.hash
    )
      throw new MailConfigurationError('Invalid local mailbox');
    return { mode, from, fromName, baseUrl };
  }
  const host = env.SMTP_HOST?.trim().toLowerCase() ?? '';
  const port = Number(env.SMTP_PORT || 587);
  if (
    !host ||
    !/^[a-z0-9.-]+$/.test(host) ||
    ![465, 587, 2525].includes(port) ||
    !mailbox.test(user) ||
    !env.SMTP_PASSWORD?.trim() ||
    isReservedMailRecipient(from)
  )
    throw new MailConfigurationError(
      'SMTP configuration is incomplete or invalid',
    );
  if (env.SMTP_SECURE && !['true', 'false'].includes(env.SMTP_SECURE))
    throw new MailConfigurationError('SMTP_SECURE must be true or false');
  const secure = env.SMTP_SECURE ? env.SMTP_SECURE === 'true' : port === 465;
  if ((port === 465 && !secure) || (port !== 465 && secure))
    throw new MailConfigurationError(
      'Use TLS on port 465 or STARTTLS on port 587/2525',
    );
  const gmail = host === 'smtp.gmail.com';
  const password = gmail
    ? env.SMTP_PASSWORD.replace(/\s/g, '')
    : env.SMTP_PASSWORD;
  if (
    gmail &&
    (!/^[a-zA-Z0-9]{16}$/.test(password) ||
      from.toLowerCase() !== user.toLowerCase())
  )
    throw new MailConfigurationError(
      'Gmail requires a 16-character App Password and MAIL_FROM matching SMTP_USER',
    );
  return { mode, from, fromName, host, port, secure, user, password };
}
export function smtpOptions(
  config: Extract<MailConfiguration, { mode: 'smtp' }>,
): SMTPTransport.Options {
  return {
    host: config.host,
    port: config.port,
    secure: config.secure,
    requireTLS: !config.secure,
    auth: { user: config.user, pass: config.password },
    connectionTimeout: 10000,
    greetingTimeout: 10000,
    socketTimeout: 15000,
    logger: false,
    debug: false,
    tls: { minVersion: 'TLSv1.2', rejectUnauthorized: true },
  };
}
export function assertSmtpAccepted(
  result: { accepted?: unknown[] },
  recipient: string,
) {
  const accepted = result.accepted?.some((item) => {
    const address =
      typeof item === 'string'
        ? item
        : item && typeof item === 'object' && 'address' in item
          ? item.address
          : null;
    return (
      typeof address === 'string' &&
      address.toLowerCase() === recipient.toLowerCase()
    );
  });
  if (!accepted)
    throw new MailConfigurationError(
      'SMTP server did not accept the recipient',
    );
}
/** Provider errors can contain addresses or AUTH data. Logs keep fixed codes only. */
export function safeMailFailure(cause: unknown) {
  if (cause instanceof MailConfigurationError) return cause.message;
  if (
    cause &&
    typeof cause === 'object' &&
    'code' in cause &&
    typeof cause.code === 'string' &&
    [
      'EAUTH',
      'ESOCKET',
      'ECONNECTION',
      'ETIMEDOUT',
      'EENVELOPE',
      'EMESSAGE',
      'ESTREAM',
      'EDNS',
      'ETLS',
    ].includes(cause.code)
  )
    return `Mail delivery failed (${cause.code})`;
  return 'Mail delivery failed';
}
