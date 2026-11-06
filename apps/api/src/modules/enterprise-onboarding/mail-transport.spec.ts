import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  assertSmtpAccepted,
  assertSmtpRecipient,
  mailConfiguration,
  safeMailFailure,
  smtpOptions,
} from './mail-transport.js';
const gmail = {
  MAIL_TRANSPORT: 'smtp',
  MAIL_FROM: 'sender@gmail.com',
  SMTP_USER: 'sender@gmail.com',
  SMTP_HOST: 'smtp.gmail.com',
  SMTP_PASSWORD: 'abcd efgh ijkl mnop',
};
afterEach(() => vi.unstubAllEnvs());
describe('mail transport configuration', () => {
  it('uses Gmail STARTTLS and normalizes App Password spaces without weakening TLS', () => {
    const config = mailConfiguration(gmail);
    expect(config.mode).toBe('smtp');
    if (config.mode !== 'smtp') throw new Error('Expected smtp');
    expect(config.password).toBe('abcdefghijklmnop');
    expect(smtpOptions(config)).toMatchObject({
      port: 587,
      secure: false,
      requireTLS: true,
      tls: { rejectUnauthorized: true, minVersion: 'TLSv1.2' },
      debug: false,
    });
    expect(mailConfiguration({ ...gmail, SMTP_PORT: '465' })).toMatchObject({
      secure: true,
    });
  });
  it.each([
    { SMTP_PASSWORD: '' },
    { SMTP_PASSWORD: 'normal-login-password' },
    { MAIL_FROM: 'other@gmail.com' },
    { SMTP_PORT: '465', SMTP_SECURE: 'false' },
    { SMTP_PORT: '587', SMTP_SECURE: 'true' },
    { SMTP_SECURE: 'yes' },
  ])(
    'rejects missing credentials, wrong Gmail sender and contradictory TLS: %j',
    (override) => {
      expect(() => mailConfiguration({ ...gmail, ...override })).toThrow();
    },
  );
  it('requires explicit Mailpit and never enables it in production', () => {
    expect(mailConfiguration({})).toEqual({ mode: 'disabled' });
    expect(() => mailConfiguration({ MAIL_TRANSPORT: 'unknown' })).toThrow();
    expect(mailConfiguration({ MAIL_TRANSPORT: 'mailpit' })).toMatchObject({
      mode: 'mailpit',
    });
    expect(() =>
      mailConfiguration({ MAIL_TRANSPORT: 'mailpit', NODE_ENV: 'production' }),
    ).toThrow();
    expect(() =>
      mailConfiguration({
        MAIL_TRANSPORT: 'mailpit',
        MAILPIT_API_URL: 'https://external.test',
      }),
    ).toThrow();
  });
  it('keeps fixture recipients off SMTP and checks the accepted envelope', () => {
    for (const address of [
      'user@example.test',
      'user@example.com',
      'user@sub.example.org',
      'user@invalid',
      'bad\naddress@gmail.com',
    ])
      expect(() => assertSmtpRecipient(address)).toThrow();
    expect(() => assertSmtpRecipient('recipient@gmail.com')).not.toThrow();
    expect(() =>
      assertSmtpAccepted(
        { accepted: ['recipient@gmail.com'] },
        'recipient@gmail.com',
      ),
    ).not.toThrow();
    expect(() =>
      assertSmtpAccepted(
        { accepted: [{ address: 'RECIPIENT@gmail.com' }] },
        'recipient@gmail.com',
      ),
    ).not.toThrow();
    expect(() =>
      assertSmtpAccepted({ accepted: [] }, 'recipient@gmail.com'),
    ).toThrow();
  });
  it('does not disclose provider messages, addresses or authentication payloads', () => {
    expect(
      safeMailFailure(
        Object.assign(new Error('AUTH private-secret user@gmail.com'), {
          code: 'EAUTH',
        }),
      ),
    ).toBe('Mail delivery failed (EAUTH)');
    expect(safeMailFailure(new Error('private-secret'))).toBe(
      'Mail delivery failed',
    );
  });
});
