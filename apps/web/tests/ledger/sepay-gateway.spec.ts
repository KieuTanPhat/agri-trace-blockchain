import { test, expect } from './fixtures';
import './fixtures/enterprise-coordination';

test('Gateway checkout is usable on desktop/mobile and waits for server settlement', async ({ page, api }) => {
  await api.useActor('org-owner');
  await api.scenario('coordination.service');
  await page.route('**/api/enterprise-service/payment/sepay', route => route.fulfill({
    contentType: 'application/json',
    body: JSON.stringify({ success: true, data: {
      enabled: true, mode: 'test', invoiceId: '88888888-8888-4888-8888-888888888888',
      invoiceNumber: 'AGT-2026-000001', amount: 1500000, status: 'ISSUED',
      dueAt: '2099-01-01T00:00:00Z', paidAt: null, simulated: true, serviceActive: false,
      bank: null, accountNumber: null, accountHolder: null, paymentCode: null, qrUrl: null, reviewMessage: null,
      gateway: { action: 'https://pay-sandbox.sepay.vn/v1/checkout/init', fields: [{ name: 'order_amount', value: '1500000' }, { name: 'signature', value: 'fixture-only' }] },
    } }),
  }));
  await page.goto('/enterprise/service');
  await page.getByLabel('Địa chỉ thanh toán', { exact: true }).fill('Địa chỉ kiểm thử');
  await page.getByLabel('Email nhận hợp đồng', { exact: true }).fill('bill@example.invalid');
  await page.getByRole('button', { name: 'Tiếp tục · Kiểm tra hợp đồng', exact: true }).click();
  await page.getByRole('checkbox', { name: 'Tôi đã kiểm tra và đồng ý với bản hợp đồng PDF này', exact: true }).check();
  await page.getByRole('button', { name: 'Xác nhận và thanh toán', exact: true }).click();
  const dialog = page.getByRole('dialog');
  const pay = dialog.getByRole('button', { name: 'Thanh toán qua SePay', exact: true });
  await expect(pay).toBeVisible();
  await expect(dialog.locator('form')).toHaveAttribute('action', 'https://pay-sandbox.sepay.vn/v1/checkout/init');
  await expect(dialog.locator('form')).toHaveAttribute('method', 'POST');
  await expect(dialog.getByText('Thanh toán thành công', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: test.info().outputPath('sepay-desktop.png') });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(pay).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  await pay.focus();
  await expect(pay).toBeFocused();
  await page.screenshot({ path: test.info().outputPath('sepay-mobile.png') });
  // Never submit this fixture to SePay: external provider acceptance is separate.
});
