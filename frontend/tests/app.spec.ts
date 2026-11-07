import { expect, test } from '@playwright/test';

test('20-query audit, visibility result, evidence, optimizer and exports', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: /Your next customer/ })).toBeVisible();
  await page.getByRole('button', { name: 'Create your first audit' }).click();
  await page.getByLabel('Brand name', { exact: true }).fill('Browser Test CRM');
  // Partial URL entry must not crash the workspace header.
  await page.getByLabel('Product page URL', { exact: true }).fill('https:');
  await page.getByLabel('Product page URL', { exact: true }).fill('https://example.com/product');
  await page.getByLabel('Product category or buyer need').fill('CRM software');
  await page.getByRole('button', { name: 'Suggest prompts' }).click();
  await expect(page.getByLabel('Competitor brand', { exact: true })).toHaveCount(0);
  await page.getByLabel('Run mode').selectOption('demo');
  await page.getByRole('button', { name: 'Launch 20-query demo audit' }).click();
  await expect(page.getByText('20 / 20 queries')).toBeVisible();
  await page.getByRole('link', { name: 'View visibility result' }).click();
  await expect(page.getByRole('heading', { name: 'AI Visibility Score' })).toBeVisible();
  const ring = page.getByRole('img', { name: /\d+(\.\d+)?% observed visibility/ });
  await expect(ring).toBeVisible();
  const score = await ring.locator('strong').innerText();
  await expect(page.getByText(/Coverage 20\/20.*10\/10 distinct questions answered/)).toBeVisible();
  await page.locator('#audit-result').screenshot({ path: 'test-results/live-audit-result.png' });
  await page.getByRole('button', { name: 'Overview', exact: true }).click();
  await expect(page.getByRole('region', { name: 'AI Visibility Score' }).locator('.metric')).toHaveText(score);
  await expect(page.getByText('Weighted share of model', { exact: true })).toBeVisible();
  await expect(page.getByText(/Named in \d+ \/ 20 successful answers/)).toBeVisible();
  await expect(page.locator('.recharts-bar-rectangle').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Answers included in this audit' })).toBeVisible();
  await expect(page.getByRole('list', { name: 'Cited websites by relevance' })).toContainText('example.org');
  await page.getByText('View all relevant website data', { exact: true }).click();
  await expect(page.getByRole('link', { name: 'example.org' })).toHaveAttribute('href', 'https://example.org/demo-source');
  await expect(page.getByText('Revenue scenario', { exact: true })).toHaveCount(0);
  await expect(page.getByText('Next content check', { exact: true })).toHaveCount(0);
  await page.screenshot({ path: 'test-results/overview-desktop.png', fullPage: true });
  await page.reload();
  await expect(page.getByText(/Named in \d+ \/ 20 successful answers/)).toBeVisible();
  await page.getByRole('button', { name: 'Citation matrix', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Read the evidence behind your score' })).toBeVisible();
  await page.getByRole('button', { name: 'Discovery questions' }).click();
  await page.getByRole('button', { name: /01 What are the best options for CRM/ }).click();
  await expect(page.locator('.answer-card')).toHaveCount(2);
  await expect(page.locator('.source-links a[href="https://example.org/demo-source"]')).toHaveCount(2);
  await page.getByRole('button', { name: 'No brand or site', exact: true }).click();
  await page.getByRole('button', { name: 'All prompts', exact: true }).click();
  await page.getByRole('button', { name: 'Optimize for this question', exact: true }).first().click();
  await expect(page.getByText('SELECTED BUYER QUESTION')).toBeVisible();
  const fetchPage = page.getByLabel('Fetch the public product page');
  await fetchPage.check();
  await expect(page.getByLabel(/Allowed redirect hostnames/)).toBeEditable();
  await fetchPage.uncheck();
  await page.getByLabel('Current product content').fill('Browser Test CRM helps B2B sales teams manage their pipeline. It includes contact records, shared deal stages, and team reporting. Pricing is available from the product team.');
  await page.getByLabel('Generation method').selectOption('source');
  await page.getByRole('button', { name: 'Generate GEO assets' }).click();
  await expect(page.getByText('SOURCE EXPORT', { exact: true })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'What to change and why' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Put verifiable proof next to claims' })).toBeVisible();
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
  const history = page.getByRole('dialog');
  await expect(history).toContainText('Browser Test CRM');
  await page.route('**/api/v1/audits', route => route.request().method() === 'DELETE'
    ? route.fulfill({ json: { deleted: 1 } }) : route.continue());
  await history.getByRole('button', { name: 'Delete history', exact: true }).click();
  await history.getByRole('button', { name: 'Cancel', exact: true }).click();
  await expect(history).toContainText('Browser Test CRM');
  await history.getByRole('button', { name: 'Delete history', exact: true }).click();
  await history.getByRole('button', { name: 'Delete all saved audits' }).click();
  await expect(history).toContainText('No saved audits yet.');
  expect(await page.evaluate(() => localStorage.getItem('geo-audit'))).toBeNull();
  expect(errors).toEqual([]);
});

test('live audits use only configured engines and demo keeps all engines available', async ({ page }) => {
  let keysConfigured = false;
  await page.route('**/api/v1/health', route => route.fulfill({ json: {
    status: 'ok', deployment: 'single-user', fetch_hosts: [], providers: [
      { id: 'openai', configured: keysConfigured, model: 'gpt-6-luna' },
      { id: 'perplexity', configured: false, model: 'fast' },
    ],
  } }));
  await page.route('**/api/v1/audits', route => route.fulfill({ status: 503, json: { detail: 'Simulated provider rejection' } }));
  await page.goto('/');
  await page.getByRole('button', { name: 'New audit', exact: true }).click();
  await expect(page.getByRole('button', { name: 'New audit', exact: true })).toHaveCount(0);
  await page.getByLabel('Brand name', { exact: true }).fill('Actual Brand');
  await page.getByLabel('Product page URL', { exact: true }).fill('https://example.com/product');
  await page.getByLabel('Product category or buyer need').fill('CRM software');
  await page.getByRole('button', { name: 'Suggest prompts' }).click();
  await expect(page.getByLabel('Run mode')).toHaveValue('live');
  await expect(page.getByText('Configure at least one API key to run a live audit.')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Launch 0-query live audit' })).toBeDisabled();

  keysConfigured = true;
  await page.getByRole('button', { name: 'Refresh engine readiness' }).click();
  const perplexity = page.getByRole('checkbox', { name: /Perplexity/ });
  await expect(perplexity).toBeDisabled();
  await expect(perplexity).not.toBeChecked();
  await expect(page.getByText('Key configured', { exact: true })).toHaveCSS('color', 'rgb(134, 239, 87)');
  await expect(page.getByRole('button', { name: 'Launch 10-query live audit' })).toBeEnabled();
  await page.getByLabel('Run mode').selectOption('demo');
  await expect(perplexity).toBeEnabled();
  await expect(perplexity).toBeChecked();
  await expect(page.getByRole('button', { name: 'Launch 20-query demo audit' })).toBeEnabled();

  await page.getByLabel('Run mode').selectOption('live');
  const submitted = page.waitForRequest(request => request.method() === 'POST' && request.url().endsWith('/api/v1/audits'));
  await page.getByRole('button', { name: 'Launch 10-query live audit' }).click();
  expect((await submitted).postDataJSON()).toMatchObject({ mode: 'live', providers: ['openai'], offering: 'CRM software' });
  await expect(page.getByRole('alert')).toContainText('Simulated provider rejection');
  await expect(page.getByText('10 / 10 queries')).not.toBeVisible();
});

test('a live audit shows successful answers and only relevant websites', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('geo-audit', 'mixed-live'));
  await page.route('**/api/v1/audits/mixed-live', route => route.fulfill({ json: {
    id: 'mixed-live', status: 'complete', created: 0,
    request: { mode: 'live', brand: 'Electronics Shop', target_url: 'https://electronics.example/laptops',
      offering: 'laptops', providers: ['openai', 'perplexity'], prompts: ['Where can I buy laptops?'] },
    results: [
      { query_id: '0:openai', prompt_index: 0, provider: 'openai', status: 'success', mode: 'live',
        answer: 'Electronics Shop sells laptops.', citations: ['https://electronics.example/laptops', 'https://anpc.ro/'], mentions: [], structural_winner_patterns: [] },
      { query_id: '0:perplexity', prompt_index: 0, provider: 'perplexity', status: 'error', mode: 'live',
        answer: '', error: 'Simulated failure', citations: [], mentions: [], structural_winner_patterns: [] },
    ],
    summary: { successful_queries: 1, failed_queries: 1, total_queries: 2, ranked_queries: 0, brand_leaderboard: [], engine_breakdown: [],
      relevant_sites: [{ domain: 'electronics.example', url: 'https://electronics.example/laptops', relevance_score: 100, response_count: 1 }],
      observed_visibility: {
        categories: {
          discovery: { percentage: 100, brand_mention_pct: 100, valid_answers: 1, planned_answers: 2, distinct_questions: 1, answered_questions: 1,
            providers: [{ provider: 'openai', percentage: 100, valid_answers: 1, planned_answers: 1, cited_answers: 1 },
              { provider: 'perplexity', percentage: null, valid_answers: 0, planned_answers: 1, cited_answers: 0 }] },
          brand_knowledge: { percentage: null, brand_mention_pct: null, valid_answers: 0, planned_answers: 0, distinct_questions: 0, answered_questions: 0, providers: [] },
        },
        questions: [{ id: 'laptops', category: 'discovery', prompt_indices: [0], valid_answers: 1, cited_answers: 1, answers: [
          { query_id: '0:openai', provider: 'openai', classification: 'website_cited', counted: true, website_citations: ['https://electronics.example/laptops'], competitors: [] },
          { query_id: '0:perplexity', provider: 'perplexity', classification: 'api_failure', counted: false, website_citations: [], competitors: [] },
        ] }],
      } },
  } }));
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'Engine setup' })).toHaveCount(0);
  await expect(page.getByRole('link', { name: 'Schema reference' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Overview', exact: true })).toHaveCSS('font-size', '14px');
  await expect(page.getByRole('list', { name: 'Cited websites by relevance' })).toContainText('electronics.example');
  await expect(page.getByText('anpc.ro')).toHaveCount(0);
  const overview = page.getByRole('region', { name: 'AI Visibility Score' });
  await expect(overview).toContainText('Partial provider coverage');
  await expect(overview).toContainText('Perplexity — · 0/1 questions answered');
  await overview.getByText(/Where can I buy laptops/).click();
  await expect(overview.getByRole('link', { name: 'https://electronics.example/laptops' })).toBeVisible();
  await page.getByRole('button', { name: 'Live audit', exact: true }).click();
  const result = page.locator('#audit-result');
  await expect(result.getByRole('img', { name: '100% observed visibility' })).toBeVisible();
  await expect(result).toContainText('1 of 2 planned queries returned successful answers.');
  await expect(result.locator('summary')).toHaveCount(1);
  await result.getByText('OpenAI · Where can I buy laptops?').click();
  await expect(result.getByText('Electronics Shop sells laptops.')).toBeVisible();
  await expect(result).not.toContainText('Simulated failure');
  await result.getByRole('button', { name: 'Inspect answers and sources' }).click();
  await page.getByRole('button', { name: /Where can I buy laptops/ }).click();
  await expect(page.locator('.source-links a[href="https://anpc.ro/"]')).toBeVisible();
});

test('mobile layout fits the viewport and navigation stays usable', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 280 });
  await page.goto('/');
  const scroll = await page.locator('.sidebar').evaluate(sidebar => {
    sidebar.scrollTop = sidebar.scrollHeight;
    return sidebar.scrollTop;
  });
  expect(scroll).toBeGreaterThan(0);
  await expect(page.getByText('From invisible', { exact: false })).toHaveCount(0);
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
