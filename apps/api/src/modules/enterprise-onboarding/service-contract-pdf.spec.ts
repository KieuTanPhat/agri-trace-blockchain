import { describe, it, expect } from 'vitest';
import { PDFDocument } from 'pdf-lib';
import {
  mergeServiceContract,
  pdfHash,
  CONTRACT_TEMPLATE_VERSION,
} from './service-contract-pdf.js';
const fields = {
  organizationName: 'HTX Rau sạch Hòa Lợi',
  representative: 'Nguyễn Văn A',
  businessId: '1234567890',
  billingName: 'HTX Rau sạch Hòa Lợi',
  billingEmail: 'test@example.test',
  billingAddress: '123 Lê Hồng Phong, Phường Hòa Lợi, Thành phố Hồ Chí Minh',
  planName: 'Gói truy xuất 10 sản phẩm',
  planCode: 'TRACE_10',
  termMonths: 12,
  setup: 500000,
  annual: 1000000,
  total: 1500000,
  limits: { products: 10, chains: 1, members: 5 },
  reference: 'c6a67f83-3389-4c8c-adb9-a80d370a96ce',
};
describe('existing contract PDF template merge', () => {
  it('produces a private two-page Vietnamese PDF with a digest of its actual bytes', async () => {
    const result = await mergeServiceContract(fields);
    expect(result.templateVersion).toBe(CONTRACT_TEMPLATE_VERSION);
    expect(pdfHash(result.bytes)).toBe(result.sha256);
    expect(result.bytes.subarray(0, 5).toString()).toBe('%PDF-');
    expect((await PDFDocument.load(result.bytes)).getPageCount()).toBe(2);
    expect(result.bytes.length).toBeLessThan(250000);
  });
  it('wraps maximum Vietnamese fields without dropping text and rejects overflow', async () => {
    await expect(
      mergeServiceContract({
        ...fields,
        organizationName: 'Nguyễn '.repeat(36),
        billingName: 'Nguyễn '.repeat(36),
        representative: 'Nguyễn '.repeat(36),
        billingAddress: 'Địa chỉ '.repeat(62),
        billingEmail: 'x'.repeat(230) + '@example.test',
      }),
    ).resolves.toHaveProperty('sha256');
    await expect(
      mergeServiceContract({ ...fields, organizationName: 'A'.repeat(5000) }),
    ).rejects.toThrow('capacity');
  });
});
