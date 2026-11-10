import { expect, test } from '@playwright/test';
import { join } from 'node:path';

test.beforeEach(async ({ page }) => {
  if (process.env.AEGISPR_OWNER_CODE) await page.addInitScript(code => sessionStorage.setItem('aegispr.deployment-access', code), process.env.AEGISPR_OWNER_CODE);
});

test('fresh remote fixture, signed proof, tamper detection and explicit repair', async ({ page, request }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Reviews with evidence.' })).toBeVisible();
  await expect(page.getByText('$1.00', { exact: true })).toBeVisible();
  if (process.env.AEGISPR_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.AEGISPR_SCREENSHOT_DIR, 'AegisPR-V2-Workspace.png'), fullPage: true });
  await page.getByRole('button', { name: /run safe example/i }).click();
  await expect(page).toHaveURL(/\/reviews\/[0-9a-f-]+/);
  await expect(page.getByRole('heading', { name: 'Evidence-linked findings' })).toBeVisible();
  await expect(page.locator('.v2-page-heading .v2-badge')).toContainText('regression found', { timeout: 60000 });
  await page.getByRole('tab', { name: 'Proof' }).click();
  await expect(page.locator('.v2-executions details')).toHaveCount(6);
  await page.getByRole('button', { name: 'Verify receipt', exact: true }).click();
  await expect(page.getByRole('status')).toContainText('Signature valid');
  if (process.env.AEGISPR_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.AEGISPR_SCREENSHOT_DIR, 'AegisPR-V2-Proof.png'), fullPage: true });
  const id = page.url().split('/').pop();
  const receiptResponse = await request.get(`http://127.0.0.1:8200/api/v2/demo/${id}/receipt`);
  const receipt = await receiptResponse.json(); receipt.payload.title = 'modified evidence';
  const tampered = await request.post('http://127.0.0.1:8200/api/v2/verify-receipt', { data: receipt });
  expect((await tampered.json()).verified).toBe(false);
  await page.getByRole('tab', { name: 'Repair' }).click();
  await page.getByRole('button', { name: 'Verify fixture repair', exact: true }).click();
  await expect(page.getByText('fix verified', { exact: true })).toBeVisible({ timeout: 60000 });
  await expect(page.getByText('Repository write back: disabled.')).toBeVisible();
});

test('mobile workspace fits, provides navigation and opens bounded model settings', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await expect(page.getByRole('button', { name: /run safe example/i })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  if (process.env.AEGISPR_SCREENSHOT_DIR) await page.screenshot({ path: join(process.env.AEGISPR_SCREENSHOT_DIR, 'AegisPR-V2-Mobile.png'), fullPage: true });
  await page.getByRole('navigation', { name: 'Workspace navigation' }).getByRole('link', { name: 'Models & limits' }).click();
  await expect(page.getByRole('heading', { name: 'Models & limits', exact: true })).toBeVisible();
  await expect(page.getByText('mimo-v2.6-flash', { exact: true })).toBeVisible();
  await expect(page.getByText('$1.00', { exact: true })).toBeVisible();
});
