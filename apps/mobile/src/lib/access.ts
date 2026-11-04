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
const CANDIDATES: (StaffTab & { show: (caps: string[]) => boolean })[] = [
  { route: 'journal', label: 'Nhật ký', icon: 'journal', show: (c) => c.includes('FARM') },
  { route: 'inbound', label: 'Chờ nhận', icon: 'box', show: (c) => ['PROCESSOR', 'TRANSPORTER', 'DISTRIBUTOR', 'RETAILER'].some((x) => c.includes(x)) },
  { route: 'sales', label: 'Bán hàng', icon: 'store', show: (c) => c.includes('RETAILER') },
  { route: 'transfers', label: 'Chuyến hàng', icon: 'truck', show: () => true },
];

/** Home, the first two role tabs by priority, then More; the rest stay in More. */
export function staffTabs(capabilities: string[]): StaffTab[] {
  const middle = CANDIDATES.filter((t) => t.show(capabilities)).slice(0, 2);
  return [
    { route: 'index', label: 'Trang chủ', icon: 'home' },
    ...middle.map(({ route, label, icon }) => ({ route, label, icon })),
    { route: 'more', label: 'Thêm', icon: 'more' },
  ];
}
