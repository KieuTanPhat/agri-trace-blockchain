import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { EvidencePanel } from './evidence-panel';
import type { Evidence } from '@/lib/ledger/workspace-types';

const m = vi.hoisted(() => ({ rows: [] as Evidence[], upload: vi.fn() }));
vi.mock('@/lib/ledger/data', async () => {
  const q = await import('@tanstack/react-query');
  return { useLedgerQuery: q.useQuery, useLedgerQueryClient: q.useQueryClient };
});
vi.mock('@/lib/ledger/workspace-api', () => ({ wapi: {
  evidence: async () => m.rows,
  evidenceContent: async () => undefined,
  uploadEvidence: m.upload,
} }));

function evidence(id: string, kind: string, description: string, supersedesId: string | null = null): Evidence {
  return { id, kind, description, supersedesId, entityType: 'PRODUCT', entityId: 'salad',
    fileName: `${id}.png`, mediaType: 'image/png', size: 123, public: false,
    siteId: null, sha256: 'a'.repeat(64), createdAt: '2026-11-21T00:00:00Z' };
}
function panels() {
  return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <EvidencePanel entityType="PRODUCT" entityId="salad" canManage onlyKinds={['PRODUCT_IMAGE']} required={[{ kind: 'PRODUCT_IMAGE', min: 1 }]} title="Ảnh sản phẩm" />
    <EvidencePanel entityType="PRODUCT" entityId="salad" canManage onlyKinds={['PRODUCT_DECLARATION', 'QUALITY_CERTIFICATE']} required={[{ kind: 'PRODUCT_DECLARATION', alternatives: ['QUALITY_CERTIFICATE'], min: 1, label: 'Công bố hoặc chứng nhận' }]} title="Hồ sơ công bố" />
    <EvidencePanel entityType="PRODUCT" entityId="salad" canManage onlyKinds={['INSPECTION_IMAGE', 'OTHER']} title="Tài liệu khác" />
  </QueryClientProvider>);
}
beforeEach(() => { m.rows = []; m.upload.mockReset(); m.upload.mockResolvedValue({}); });
afterEach(cleanup);

it('keeps photos and inspection uploads out of declarations, including misleading descriptions', async () => {
  m.rows = [evidence('old', 'PRODUCT_IMAGE', 'Ảnh cũ'), evidence('new', 'PRODUCT_IMAGE', 'Ảnh SALAD', 'old'), evidence('check', 'INSPECTION_IMAGE', 'Chứng nhận chất lượng')];
  panels();
  const photos = within(screen.getByRole('region', { name: 'Ảnh sản phẩm' }));
  expect(await photos.findByText('Ảnh SALAD')).toBeVisible();
  expect(photos.queryByText('Ảnh cũ')).not.toBeInTheDocument();
  expect(photos.queryByText('Chứng nhận chất lượng')).not.toBeInTheDocument();
  const declarations = within(screen.getByRole('region', { name: 'Hồ sơ công bố' }));
  expect(declarations.getByText('Công bố hoặc chứng nhận 0/1')).toBeVisible();
  expect(declarations.getByText('Chưa có ảnh hoặc chứng từ')).toBeVisible();
  expect(declarations.queryByText('Ảnh SALAD')).not.toBeInTheDocument();
  expect(within(screen.getByRole('region', { name: 'Tài liệu khác' })).getByText('Chứng nhận chất lượng')).toBeVisible();
});

it('accepts a quality certificate without falsely requiring a second declaration', async () => {
  m.rows = [evidence('cert', 'QUALITY_CERTIFICATE', 'Giấy chứng nhận SALAD')];
  panels();
  const declarations = within(screen.getByRole('region', { name: 'Hồ sơ công bố' }));
  expect(await declarations.findByText('Giấy chứng nhận SALAD')).toBeVisible();
  expect(declarations.getByText('Công bố hoặc chứng nhận 1/1')).toBeVisible();
});

it('uploads a PDF as a declaration from the declaration panel, rather than another product photo', async () => {
  panels();
  fireEvent.click(within(screen.getByRole('region', { name: 'Hồ sơ công bố' })).getByRole('button', { name: 'Tải lên' }));
  const dialog = within(await screen.findByRole('dialog'));
  expect(await dialog.findByRole('combobox', { name: 'Loại' })).toHaveTextContent('Tài liệu công bố sản phẩm');
  fireEvent.change(dialog.getByLabelText('Tệp'), { target: { files: [new File(['demo'], 'cong-bo.pdf', { type: 'application/pdf' })] } });
  fireEvent.change(dialog.getByLabelText('Mô tả'), { target: { value: 'Tài liệu công bố SALAD dùng kiểm thử' } });
  fireEvent.click(dialog.getByRole('button', { name: 'Tải lên' }));
  await waitFor(() => expect(m.upload).toHaveBeenCalledOnce());
  expect(m.upload.mock.calls[0][0]).toMatchObject({ kind: 'PRODUCT_DECLARATION', entityType: 'PRODUCT', entityId: 'salad' });
});
