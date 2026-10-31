import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ServicePage from './service';

const state = vi.hoisted(() => ({ stage: 'AWAITING_TEMPORARY_ACTIVATION', order: null as null | { status: string } }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock('@/lib/ledger/data', () => ({
  useLedgerQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[0] === 'ws-service' ? { stage: state.stage, order: state.order } : { status: 'APPROVED' },
  }),
}));
vi.mock('@/lib/ledger/workspace-context', () => ({ useWorkspaceAccess: () => ({ owner: true }) }));
vi.mock('@/components/ledger/workspace/service-draft', () => ({ useLedgerServiceDraft: () => ({ draft: null, setDraft: vi.fn() }) }));
afterEach(() => { cleanup(); state.order = null; });

describe('Service UI while collection is deferred', () => {
  it.each(['quote', 'contract', 'payment'] as const)('does not expose a purchase form through the %s route', view => {
    state.stage = 'AWAITING_TEMPORARY_ACTIVATION';
    render(<ServicePage view={view} />);
    expect(screen.getByText('Chờ quản trị kích hoạt')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /thanh toán|xem hợp đồng|xác nhận hợp đồng/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Vào doanh nghiệp' })).not.toBeInTheDocument();
  });
  it('opens the enterprise only after actual administrator activation', () => {
    state.stage = 'TEMPORARY_ACCESS';
    render(<ServicePage />);
    expect(screen.getByText('Đã kích hoạt sử dụng tạm')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Vào doanh nghiệp' })).toHaveAttribute('href', '/enterprise');
  });
  it('does not label an older unpaid order as settled', () => {
    state.stage = 'TEMPORARY_ACCESS';
    state.order = { status: 'AWAITING_PAYMENT' };
    render(<ServicePage view="payment" />);
    expect(screen.getByText(/sử dụng tạm không xác nhận đơn đã thanh toán/)).toBeInTheDocument();
    expect(state.order.status).toBe('AWAITING_PAYMENT');
  });
});
