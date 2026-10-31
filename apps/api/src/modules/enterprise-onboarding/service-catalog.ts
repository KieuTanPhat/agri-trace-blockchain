import { enterprisePaymentsEnabled } from './payment-policy.js';
export const simulationEnabled = () =>
  enterprisePaymentsEnabled() &&
  process.env.ENTERPRISE_PAYMENT_SIMULATION_ENABLED === 'true' &&
  process.env.NODE_ENV !== 'production';
/** Static terms around the DB-backed, versioned plan list. QR usage is quoted
 * separately and never silently charged. Source:
 * https://icheck.com.vn/chi-phi-trien-khai-truy-xuat-nguon-goc (iCheck
 * reference dated 2026-08-07, checked 2026-10-17). Peer pricing is an
 * AgriTrace demo assumption, not an iCheck infrastructure offering. */
export const serviceCatalog = (plans: unknown[], version: string) => ({
  version,
  currency: 'VND',
  termMonths: 12,
  sourceUrl: 'https://icheck.com.vn/chi-phi-trien-khai-truy-xuat-nguon-goc',
  sourceDate: '2026-08-07',
  checkedAt: '2026-10-17',
  disclaimer:
    'Bảng giá AgriTrace tham khảo cấu trúc và mức phí iCheck. Chỉ dùng trải nghiệm local; chưa phải báo giá hay hóa đơn chính thức. Chưa xác định thuế. Phí QR và hạ tầng peer chưa bao gồm.',
  plans,
  qrReference: [
    { min: 10_000, max: 49_999, unitPrice: 300 },
    { min: 50_000, max: 199_999, unitPrice: 200 },
    { min: 200_000, max: 999_999, unitPrice: 150 },
    { min: 1_000_000, max: null, unitPrice: 90 },
  ],
  hosting: [
    {
      code: 'MANAGED_ORG',
      name: 'AgriTrace quản lý peer',
      description:
        'AgriTrace vận hành hạ tầng. Doanh nghiệp không nhập endpoint hay khóa riêng. Chi phí hạ tầng cần báo giá riêng.',
    },
    {
      code: 'SELF_MANAGED_ORG',
      name: 'Doanh nghiệp tự quản lý peer',
      description:
        'Doanh nghiệp tự chịu chi phí máy chủ và vận hành. Sau thanh toán mới gửi cấu hình peer để quản trị kiểm chứng.',
    },
  ],
  simulationEnabled: simulationEnabled(),
});
