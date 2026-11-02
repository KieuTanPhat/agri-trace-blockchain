import { test, expect } from './fixtures';
import { farmId } from './fixtures/enterprise-products';
import './fixtures/enterprise-products';

for (const viewport of [{ width: 1440, height: 900 }, { width: 390, height: 844 }]) {
  test(`plot form is editable without a covering farm sheet at ${viewport.width}px`, async ({ page, api }) => {
    await page.setViewportSize(viewport);
    await api.useActor('org-owner');
    await api.scenario('products.baseline');
    await page.goto(`/enterprise/areas/plots/new?farmId=${farmId}`);
    const form = page.getByRole('dialog');
    await expect(form).toHaveCount(1);
    await expect(form.getByRole('heading', { name: /Thêm lô đất/ })).toBeVisible();
    await form.getByLabel('Tên lô đất', { exact: true }).fill('[UI-TEST] Thửa A1');
    await form.getByLabel('Diện tích', { exact: true }).fill('100');
    await form.getByLabel('Vị trí', { exact: true }).fill('Khu A');
    await expect(form.getByLabel('Tên lô đất', { exact: true })).toHaveValue('[UI-TEST] Thửa A1');
    await form.getByLabel('Đơn vị', { exact: true }).click();
    await page.getByRole('option', { name: 'ha', exact: true }).click();
    await expect(form.getByLabel('Đơn vị', { exact: true })).toContainText('ha');
    await form.getByRole('button', { name: 'Hủy', exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/enterprise/areas/${farmId}$`));
    await expect(page.getByRole('heading', { name: /Thêm lô đất/ })).toHaveCount(0);
    expect(api.requests().filter(r => r.method === 'POST' && r.path === '/catalog/plots')).toHaveLength(0);
  });
}
