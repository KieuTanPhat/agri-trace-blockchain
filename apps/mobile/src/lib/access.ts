import type { IconName } from '../components/Icon';
import type { Schemas } from '../api/client';
import { useSession } from '../auth/session';
import { useLoad } from './useApi';

type Access = Schemas['EnterpriseAccessView'];

/** The staff member's enterprise capabilities and permissions, as the Web
 * workspace reads them. The API still decides every command. */
export function useAccess() {
  const { call } = useSession();
  const loaded = useLoad(() => call<Access>('/enterprise-access'));
  const access = loaded.data;
  const active = !!access && ['ACTIVE', 'OPERATOR_PROVISIONED'].includes(access.stage);
  return {
    ...loaded,
    access,
    has: (capability: string) => !!access?.capabilities.includes(capability),
    can: (permission: string) => active && !!access?.permissions.includes(permission),
  };
}

export type StaffTab = { route: string; label: string; icon: IconName };
// A tab shows when the enterprise has the capability and the member holds the
// permission, so a driver of a farm lands on its trips instead of the journal.
const CANDIDATES: (StaffTab & { show: (caps: string[], perms: string[]) => boolean })[] = [
  { route: 'journal', label: 'Nhật ký', icon: 'journal', show: (c, p) => c.includes('FARM') && p.includes('production.read') },
  { route: 'inbound', label: 'Chờ nhận', icon: 'box', show: (c, p) => ['PROCESSOR', 'TRANSPORTER', 'DISTRIBUTOR', 'RETAILER'].some((x) => c.includes(x)) && p.includes('distribution.read') },
  { route: 'sales', label: 'Bán hàng', icon: 'store', show: (c, p) => c.includes('RETAILER') && p.includes('quantity.adjust') },
  { route: 'transfers', label: 'Chuyến hàng', icon: 'truck', show: (_c, p) => p.includes('distribution.read') },
];

/** Home, the first two role tabs by priority, then More; the rest stay in More. */
export function staffTabs(capabilities: string[], permissions: string[]): StaffTab[] {
  const middle = CANDIDATES.filter((t) => t.show(capabilities, permissions)).slice(0, 2);
  return [
    { route: 'index', label: 'Trang chủ', icon: 'home' },
    ...middle.map(({ route, label, icon }) => ({ route, label, icon })),
    { route: 'more', label: 'Thêm', icon: 'more' },
  ];
}
