import type { IconName } from '../components/staff/Icon';
import type { Schemas } from '../api/client';
import { useSession } from '../auth/session';
import { useLoad } from './useApi';

type Access = Schemas['EnterpriseAccessView'];

/** Access is stable for a session; screens share one read for a minute. */
const ACCESS_CACHE = { key: 'enterprise-access', staleTimeMs: 60_000 };

/** The employee's enterprise capabilities and permissions, as the Web
 * workspace reads them. The API still decides every command. */
export function useAccess() {
  const { call } = useSession();
  const loaded = useLoad(() => call<Access>('/enterprise-access'), [], ACCESS_CACHE);
  const access = loaded.data;
  const active = !!access && ['ACTIVE', 'OPERATOR_PROVISIONED'].includes(access.stage);
  const caps = access?.capabilities ?? [];
  const perms = active ? access?.permissions ?? [] : [];
  return {
    ...loaded,
    access,
    active,
    has: (capability: string) => caps.includes(capability),
    can: (permission: string) => perms.includes(permission),
    features: FEATURES.filter((f) => f.show(caps, perms)),
  };
}

export type FeatureKey = 'journal' | 'tasks' | 'stock' | 'sales' | 'transfers' | 'devices' | 'cases' | 'messages' | 'signing';
type Feature = {
  key: FeatureKey;
  label: string;
  hint: string;
  icon: IconName;
  href: string;
  /** Route name inside (tabs) when the feature can be a bottom tab. */
  tab?: string;
  show: (caps: string[], perms: string[]) => boolean;
};

const any = (perms: string[], ...wanted: string[]) => wanted.some((p) => perms.includes(p));

/**
 * Every staff function and the permission that opens it, in tab priority.
 * Tabs, the home shortcuts and the More menu all read this list, so an
 * employee sees exactly the work its permission groups assign.
 */
const FEATURES: Feature[] = [
  { key: 'journal', label: 'Mùa vụ', hint: 'Nhật ký chăm sóc, thu hoạch', icon: 'leaf', href: '/staff/journal', tab: 'journal', show: (c, p) => c.includes('FARM') && p.includes('production.read') },
  { key: 'tasks', label: 'Việc ký', hint: 'Xác nhận bàn giao, lấy hàng, giao nhận', icon: 'tasks', href: '/staff/tasks', tab: 'tasks', show: (_c, p) => p.includes('distribution.sign') },
  { key: 'stock', label: 'Tồn kho', hint: 'Lô theo cơ sở, chuyển kho, cách ly', icon: 'warehouse', href: '/staff/stock', tab: 'stock', show: (_c, p) => p.includes('reports.read') && any(p, 'inventory.manage', 'quarantine.manage', 'quantity.adjust') },
  { key: 'sales', label: 'Bán hàng', hint: 'Ghi bán theo lô', icon: 'store', href: '/staff/sales', tab: 'sales', show: (c, p) => c.includes('RETAILER') && p.includes('quantity.adjust') },
  { key: 'transfers', label: 'Vận chuyển', hint: 'Chuyến hàng trong phạm vi được giao', icon: 'truck', href: '/staff/transfers', tab: 'transfers', show: (_c, p) => p.includes('distribution.read') },
  { key: 'devices', label: 'Thiết bị IoT', hint: 'Cảm biến vùng trồng, GPS xe', icon: 'device', href: '/staff/devices', show: (_c, p) => p.includes('devices.read') },
  { key: 'cases', label: 'Sự cố được giao', hint: 'Xem và phản hồi sự cố', icon: 'incident', href: '/staff/cases', show: (_c, p) => p.includes('cases.read') },
  { key: 'messages', label: 'Thông báo nội bộ', hint: 'Tin nhắn trong doanh nghiệp', icon: 'message', href: '/staff/messages', show: () => true },
  { key: 'signing', label: 'Khóa ký', hint: 'Khóa riêng trên điện thoại để ký bàn giao', icon: 'lock', href: '/staff/signing', show: (_c, p) => p.includes('distribution.sign') },
];

type StaffTab = { route: string; label: string; icon: IconName };

/** Home, the first two assigned features that can be tabs, then More. */
export function staffTabs(features: Feature[]): StaffTab[] {
  const middle = features.filter((f) => f.tab).slice(0, 2);
  const short: Partial<Record<FeatureKey, string>> = { journal: 'Mùa vụ', tasks: 'Việc ký', stock: 'Tồn kho', sales: 'Bán hàng', transfers: 'Vận chuyển' };
  return [
    { route: 'index', label: 'Trang chủ', icon: 'home' },
    ...middle.map((f) => ({ route: f.tab!, label: short[f.key] ?? f.label, icon: f.icon })),
    { route: 'more', label: 'Thêm', icon: 'more' },
  ];
}
