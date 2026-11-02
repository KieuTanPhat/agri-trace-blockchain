import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import AreasPage from './areas';
import { actorA } from '@/test/ledger-actors';
const m = vi.hoisted(() => ({ push: vi.fn() }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: m.push }) }));
vi.mock('@/lib/auth-store', () => ({ useAuth: () => ({ user: actorA.user }) }));
vi.mock('@/lib/ledger/data', async () => {
  const q = await import('@tanstack/react-query');
  return { useLedgerQuery: q.useQuery, useLedgerQueryClient: q.useQueryClient };
});
vi.mock('@/lib/ledger/workspace-context', () => ({
  useWorkspaceAccess: () => ({ can: () => true, primary: true }),
  useOverview: () => ({ data: { organization: { capabilities: ['FARM'] } } }),
}));
vi.mock('@/lib/ledger/resource-api', () => ({ wapi: {
  catalog: async () => ({ farms: [{ id: 'farm-a', name: 'Vườn A', status: 'ACTIVE', inputMaterialIds: [], seedMaterialIds: [] }], plots: [], products: [] }),
  materials: async () => [], sites: async () => [],
} }));
beforeEach(() => {
  m.push.mockReset();
  vi.stubGlobal('matchMedia', () => ({ matches: false, addEventListener() {}, removeEventListener() {} }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
it('opens only the editable plot dialog, without the farm detail sheet trapping focus', async () => {
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <AreasPage view="plot" farmId="farm-a" />
  </QueryClientProvider>);
  const title = await screen.findByRole('heading', { name: 'Thêm lô đất · Vườn A' });
  const form = title.closest('[role="dialog"]') as HTMLElement;
  expect(screen.getAllByRole('dialog')).toHaveLength(1);
  expect(document.querySelector('[data-slot="sheet-content"]')).toBeNull();
  const name = within(form).getByLabelText('Tên lô đất', { exact: true });
  fireEvent.change(name, { target: { value: 'Thửa A1' } });
  name.focus();
  expect(name).toHaveFocus();
  expect(name).toHaveValue('Thửa A1');
  fireEvent.change(within(form).getByLabelText('Diện tích', { exact: true }), { target: { value: '100' } });
  fireEvent.click(within(form).getByRole('button', { name: 'Hủy' }));
  expect(m.push).toHaveBeenCalledWith('/enterprise/areas/farm-a');
});
