import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { PDFDocument, rgb } from 'pdf-lib';
import fontkit from '@pdf-lib/fontkit';

export const CONTRACT_TEMPLATE_VERSION = 'service-test-v1';
export const pdfHash = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');
const base = new URL('../../../assets/contracts/', import.meta.url);
let assets: Promise<{ template: Buffer; font: Buffer }> | undefined;
function loadAssets() {
  return (assets ??= (async () => {
    const [template, font, manifest] = await Promise.all([
      readFile(new URL('service-test-v1.pdf', base)),
      readFile(new URL('fonts/NotoSans-Regular.ttf', base)),
      readFile(new URL('template-manifest.json', base), 'utf8'),
    ]);
    const expected = JSON.parse(manifest) as {
      version: string;
      sha256: string;
      fontSha256: string;
    };
    if (
      expected.version !== CONTRACT_TEMPLATE_VERSION ||
      pdfHash(template) !== expected.sha256 ||
      pdfHash(font) !== expected.fontSha256
    )
      throw new Error('Contract template integrity check failed');
    return { template, font };
  })());
}
export interface ContractPdfFields {
  organizationName: string;
  representative: string;
  businessId: string | null;
  billingName: string;
  billingEmail: string;
  billingAddress: string;
  planName: string;
  planCode: string;
  termMonths: number;
  setup: number;
  annual: number;
  total: number;
  limits: { products: number; chains: number; members: number };
  reference: string;
}
/** Load the existing two-page template, overlay fields, then freeze its bytes.
 * No network, dynamic HTML or remote document paths are accepted. */
export async function mergeServiceContract(fields: ContractPdfFields) {
  const { template, font: fontBytes } = await loadAssets();
  const pdf = await PDFDocument.load(template);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(fontBytes, { subset: true });
  const page = pdf.getPages()[0];
  function draw(value: string, y: number, maxLines: number, size = 10) {
    const clean = Array.from(value.normalize('NFC'), (c) =>
      c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? ' ' : c,
    ).join('');
    // Wrap at character boundaries too: long emails and unbroken names must fit.
    let line = '',
      lines: string[] = [];
    for (const char of clean) {
      if (font.widthOfTextAtSize(line + char, size) > 510) {
        lines.push(line);
        line = '';
      }
      line += char;
    }
    if (line) lines.push(line);
    if (lines.length > maxLines)
      throw new Error('Contract field exceeds template capacity');
    for (let i = 0; i < lines.length; i++)
      page.drawText(lines[i], {
        x: 40,
        y: y - i * 13,
        size,
        font,
        color: rgb(0.12, 0.22, 0.17),
      });
  }
  draw(fields.organizationName, 690, 3);
  draw(
    `${fields.representative} · MST: ${fields.businessId ?? 'Chưa khai báo'}`,
    615,
    3,
  );
  draw(fields.billingName, 540, 3);
  draw(fields.billingAddress, 465, 5);
  draw(fields.billingEmail, 370, 3);
  draw(
    `${fields.planName} (${fields.planCode}) · ${fields.termMonths} tháng`,
    280,
    2,
    11,
  );
  draw(
    `${fields.limits.products} sản phẩm · ${fields.limits.chains} chuỗi · ${fields.limits.members} thành viên`,
    246,
    2,
  );
  const money = (n: number) => n.toLocaleString('vi-VN') + ' VND';
  draw(
    `Khởi tạo: ${money(fields.setup)} · Duy trì: ${money(fields.annual)}`,
    214,
    2,
  );
  draw(
    `Tổng giá gói: ${money(fields.total)} · Thuế: chưa xác định trong mẫu thử`,
    181,
    2,
    11,
  );
  draw(`Mã bản xem trước: ${fields.reference}`, 144, 1, 8);
  pdf.setTitle(`Hợp đồng AgriTrace - ${fields.planCode}`);
  pdf.setProducer('AgriTrace template merge');
  const bytes = Buffer.from(await pdf.save());
  return {
    bytes,
    sha256: pdfHash(bytes),
    templateVersion: CONTRACT_TEMPLATE_VERSION,
  };
}
