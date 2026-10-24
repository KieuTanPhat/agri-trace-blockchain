import { describe, it, expect } from 'vitest';
import { encryptOtp, decryptOtp } from './registration-otp.service.js';
import { enterpriseMailHtml } from './mail-template.js';
describe('Registration email secrets and template', () => {
  it('encrypts a fresh nonce and rejects tampered ciphertext', () => {
    const key = 'isolated-test-key-no-real-credentials',
      a = encryptOtp('001234', key),
      b = encryptOtp('001234', key);
    expect(a).not.toBe(b);
    expect(a).not.toContain('001234');
    expect(decryptOtp(a, key)).toBe('001234');
    const bytes = Buffer.from(a, 'base64');
    bytes[bytes.length - 1] ^= 1;
    expect(() => decryptOtp(bytes.toString('base64'), key)).toThrow();
    expect(() => decryptOtp(a, key + 'wrong')).toThrow();
  });
  it('renders a small self-contained Vietnamese email with escaped content and CID logo', () => {
    const html = enterpriseMailHtml({
      subject: 'AgriTrace — Xác thực email',
      text: '<script>not markup</script>',
      otp: '001234',
    });
    expect(html).toContain('cid:agritrace-logo');
    expect(html).toContain('lang="vi"');
    expect(html).toContain('001234');
    expect(html).toContain('&lt;script&gt;');
    expect(html).not.toContain('<script>');
    expect(html).not.toMatch(/https?:\/\/|<style|<link|iframe/);
    const approval = enterpriseMailHtml({
      subject: 'Hồ sơ được duyệt',
      text: 'Chọn dịch vụ theo hồ sơ đã duyệt.',
      action: {
        label: 'Hoàn thiện dịch vụ',
        url: 'http://127.0.0.1:3001/enterprise/service',
      },
    });
    expect(approval).toContain(
      'href="http://127.0.0.1:3001/enterprise/service"',
    );
    const unsafe = enterpriseMailHtml({
      subject: 'Test',
      text: 'Test',
      action: { label: 'Invalid', url: 'javascript:alert(1)' },
    });
    expect(unsafe).not.toContain('href=');
  });
});
