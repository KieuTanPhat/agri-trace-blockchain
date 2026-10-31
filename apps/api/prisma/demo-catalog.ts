import { createHash } from 'node:crypto';
import type { OrganizationType } from '../src/generated/prisma/client.js';
type CommercialOrganizationType = Exclude<OrganizationType, 'AUDITOR'>;

export const DEMO_CATALOG_NAMESPACE = 'agritrace:demo-catalog:v1';
function fixtureId(kind: string, index: number): string {
  const hex = createHash('sha256')
    .update(`${DEMO_CATALOG_NAMESPACE}:${kind}:${index}`)
    .digest('hex');
  // Stable, UUID-shaped fixture IDs, not unpredictable credentials or QR tokens.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}
export function createDemoCatalog() {
  const groups: Array<[CommercialOrganizationType, number, string]> = [
    ['FARM', 12, 'HTX Sản xuất mẫu'],
    ['PROCESSOR', 6, 'Doanh nghiệp Chế biến mẫu'],
    ['TRANSPORTER', 4, 'Doanh nghiệp Vận chuyển mẫu'],
    ['DISTRIBUTOR', 4, 'Doanh nghiệp Phân phối mẫu'],
    ['RETAILER', 4, 'Cửa hàng Bán lẻ mẫu'],
  ];
  const organizations = groups.flatMap(([type, count, label]) =>
    Array.from({ length: count }, (_, index) => ({
      id: fixtureId(type, index),
      name: `[DEMO] ${label} ${String(index + 1).padStart(2, '0')}`,
      type,
      status: 'INACTIVE' as const,
    })),
  );
  const crops = [
    'Rau cải',
    'Xà lách',
    'Cà chua',
    'Dưa leo',
    'Bí đỏ',
    'Cà rốt',
    'Khoai lang',
    'Bắp',
    'Lúa',
    'Xoài',
    'Chuối',
    'Thanh long',
    'Bưởi',
    'Cà phê',
  ];
  const processed = [
    'Xoài sấy',
    'Chuối sấy',
    'Cà phê rang',
    'Gạo đóng gói',
    'Nước ép trái cây',
    'Rau củ đông lạnh',
  ];
  const names = [...crops, ...processed];
  const farms = organizations.filter((org) => org.type === 'FARM');
  const processors = organizations.filter((org) => org.type === 'PROCESSOR');
  const products = names.flatMap((name, group) =>
    Array.from({ length: 5 }, (_, variant) => {
      const index = group * 5 + variant;
      return {
        id: fixtureId('product', index),
        organizationId: (group < crops.length ? farms : processors)[
          variant % (group < crops.length ? farms.length : processors.length)
        ].id,
        evidenceComplete: false,
        category:
          group < crops.length
            ? 'Nông sản thử nghiệm'
            : 'Sản phẩm chế biến thử nghiệm',
        productName: `[DEMO] ${name} ${String(variant + 1).padStart(2, '0')}`,
        variety: `Mẫu kiểm thử ${String(index + 1).padStart(3, '0')}`,
        defaultUnit: 'kg',
        description:
          'Dữ liệu tổng hợp dùng kiểm thử danh mục. Không phải hàng hóa, chứng nhận hoặc bằng chứng blockchain thật.',
        status: 'INACTIVE' as const,
      };
    }),
  );
  return { organizations, products };
}

export class DemoCatalogRefusal extends Error {}

/** Necessary safeguards, not proof of ownership: the operator must first create
 * and verify a disposable database. Never point this at a shared database. */
export function assertDemoCatalogTarget(
  env: Record<string, string | undefined>,
) {
  if (!['development', 'test'].includes(env.NODE_ENV ?? ''))
    throw new DemoCatalogRefusal(
      'Seed chỉ chạy khi NODE_ENV là development hoặc test.',
    );
  if (!env.DATABASE_URL || env.TEST_DATABASE_URL !== env.DATABASE_URL)
    throw new DemoCatalogRefusal(
      'DATABASE_URL và TEST_DATABASE_URL phải cùng trỏ DB test cách ly.',
    );
  let url: URL;
  try {
    url = new URL(env.DATABASE_URL);
  } catch {
    throw new DemoCatalogRefusal('Cấu hình DB test không hợp lệ.');
  }
  if (
    !['postgres:', 'postgresql:'].includes(url.protocol) ||
    !['localhost', '127.0.0.1', '[::1]'].includes(url.hostname)
  )
    throw new DemoCatalogRefusal(
      'Chỉ cho phép PostgreSQL test cục bộ đã được xác minh.',
    );
  const database = decodeURIComponent(url.pathname.slice(1));
  if (
    !/^agritrace_demo_[a-z0-9_]{3,48}$/.test(database) ||
    env.AGRI_DEMO_SEED_CONFIRM !== database
  )
    throw new DemoCatalogRefusal(
      'Tên DB/AGRI_DEMO_SEED_CONFIRM không xác nhận đúng DB demo cách ly.',
    );
  return database;
}
