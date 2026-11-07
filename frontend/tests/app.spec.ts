import { expect, test } from '@playwright/test';

test('30-query audit, persisted reload, citation drawer, optimizer, copy and download', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your next customer/ })).toBeVisible();
  await page.getByRole('button', { name: 'Create your first audit' }).click();
  await page.getByLabel('Brand name', { exact: true }).fill('Browser Test CRM');
  // Partial URL entry must not crash the workspace header.
  await page.getByLabel('Product page URL', { exact: true }).fill('https:');
  await page.getByLabel('Product page URL', { exact: true }).fill('https://example.com/product');
  await page.getByLabel('Competitor brand', { exact: true }).fill('Other CRM');
  await page.getByRole('button', { name: 'Add competitor' }).click();
  await page.getByLabel('Run mode').selectOption('demo');
  await page.getByRole('button', { name: 'Launch 30-query demo audit' }).click();
  await expect(page.getByText('30 / 30 queries')).toBeVisible();
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByText('Weighted share of model', { exact: true })).toBeVisible();
  await expect(page.getByText(/Named in \d+ \/ 30 successful answers/)).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.getByText(/Named in \d+ \/ 30 successful answers/)).toBeVisible();
  await page.getByRole('button', { name: 'Citation matrix', exact: true }).click();
  await page.getByRole('button', { name: /01 What are the best CRM/ }).click();
  await expect(page.locator('.answer-card')).toHaveCount(3);
  await expect(page.locator('.source-links a').first()).toHaveAttribute('href', 'https://example.com/product');
  await page.getByRole('button', { name: 'Not mentioned', exact: true }).click();
  await page.getByRole('button', { name: 'All prompts', exact: true }).click();
  await page.getByRole('button', { name: 'Fix this gap', exact: true }).first().click();
  await expect(page.getByText('SELECTED BUYER QUESTION')).toBeVisible();
  await page.getByLabel('Current product content').fill('Browser Test CRM helps B2B sales teams manage their pipeline. It includes contact records, shared deal stages, and team reporting. Pricing is available from the product team.');
  await page.getByLabel('Generation method').selectOption('source');
  await page.getByRole('button', { name: 'Generate GEO assets' }).click();
  await expect(page.getByText('SOURCE EXPORT', { exact: true })).toBeVisible();
  await page.getByRole('tab', { name: 'JSON-LD', exact: true }).click();
  await expect(page.getByRole('tabpanel')).toContainText('"@type": "Product"');
  await expect(page.getByRole('tabpanel')).not.toContainText('AggregateRating');
  await page.getByRole('button', { name: 'Copy code', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Copied', exact: true })).toBeVisible();
  const clipboard = await page.evaluate(() => navigator.clipboard.readText());
  expect(clipboard).toContain('application/ld+json');
  await page.getByRole('tab', { name: '/llms.txt', exact: true }).click();
  const downloaded = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download current asset' }).click();
  expect((await downloaded).suggestedFilename()).toBe('llms.txt');
  await page.screenshot({ path: 'test-results/optimizer-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Audit history', exact: true }).click();
  await expect(page.getByRole('dialog')).toContainText('Browser Test CRM');
  expect(errors).toEqual([]);
});

test('live requests report absent credentials without producing demo results', async ({ page }) => {
  const health = await (await page.request.get('/api/v1/health')).json();
  test.skip(health.providers.some((p: { configured: boolean }) => p.configured), 'Missing-key scenario only applies to unconfigured environments');
  await page.goto('/');
  await page.getByRole('button', { name: 'New audit', exact: true }).click();
  await page.getByLabel('Brand name', { exact: true }).fill('Actual Brand');
  await page.getByLabel('Product page URL', { exact: true }).fill('https://example.com/product');
  await expect(page.getByLabel('Run mode')).toHaveValue('live');
  await page.getByRole('button', { name: 'Launch 30-query live audit' }).click();
  await expect(page.getByRole('alert')).toContainText('Configure API keys before a live audit');
  await expect(page.getByText('30 / 30 queries')).not.toBeVisible();
});

test('mobile layout fits the viewport and navigation stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Create your first audit' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-overview.png', fullPage: true });
  await page.getByRole('button', { name: 'Live audit', exact: true }).click();
  await expect(page.getByLabel('Brand name', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/mobile-audit.png', fullPage: true });
});
