import { expect, test, Page } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { MAX_GENERATION_ASSETS, MAX_LOAD_CSV_BYTES, MAX_PROJECT_ARCHIVE_BYTES, MAX_RESOURCE_CSV_BYTES } from '../src/utils/importLimits';

const validLoadCsv = [
  'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
  '01/01/2025,12:00 AM,1,24,kWh',
  '01/01/2025,1:00 AM,1.2,24,kWh',
  '01/01/2025,2:00 AM,0.8,24,kWh',
].join('\n');

const validSolarCsv = [
  'timestamp,ghi_wm2,dni_wm2,dhi_wm2',
  '2025-01-01T12:00:00Z,800,650,150',
  '2025-01-01T13:00:00Z,850,700,150',
].join('\n');

async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).last().click();
}

async function auditNumericNames(page: Page) {
  const unnamed = await page.locator('input[type="number"], input[type="range"], input[type="checkbox"], input[type="radio"]').evaluateAll((inputs) =>
    inputs.filter((input) => {
      const control = input as HTMLInputElement;
      return !control.labels?.length && !control.getAttribute('aria-label') && !control.getAttribute('aria-labelledby');
    }).map((input) => (input as HTMLInputElement).outerHTML)
  );
  expect(unnamed, `numeric inputs need accessible names: ${unnamed.join('\n')}`).toEqual([]);
}

async function startDelayedResourceRead(page: Page) {
  await page.locator('input[aria-label="Import measured resource CSV"]').setInputFiles({
    name: 'delayed-solar.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(validSolarCsv),
  });
  await expect(page.getByText('Reading and validating measured resource data…')).toBeVisible();
}

async function installDelayedFileReader(page: Page) {
  await page.addInitScript(() => {
    const originalText = File.prototype.text;
    (window as Window & { resolvePendingResourceRead?: () => void }).resolvePendingResourceRead = undefined;
    File.prototype.text = function () {
      return new Promise((resolve, reject) => {
        (window as Window & { resolvePendingResourceRead?: () => void }).resolvePendingResourceRead = () =>
          originalText.call(this).then(resolve, reject);
      });
    };
  });
}

async function installDelayedLoadReader(page: Page) {
  await page.addInitScript(() => {
    const read = FileReader.prototype.readAsText;
    const pending: Record<string, () => void> = {};
    (window as Window & { resolvePendingLoadRead?: (name: string) => void }).resolvePendingLoadRead = (name) => pending[name]?.();
    FileReader.prototype.readAsText = function (file: Blob) {
      const reader = this;
      const name = (file as File).name;
      pending[name] = () => read.call(reader, file);
    };
  });
}

async function startDelayedLoadRead(page: Page, name = 'delayed-load.csv', csv = validLoadCsv) {
  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name, mimeType: 'text/csv', buffer: Buffer.from(csv),
  });
  await expect(page.getByText('Reading load CSV…')).toBeVisible();
}

async function completePendingLoadRead(page: Page, name = 'delayed-load.csv') {
  await page.evaluate((requestedName) => (window as Window & { resolvePendingLoadRead?: (name: string) => void }).resolvePendingLoadRead?.(requestedName), name);
  await page.waitForTimeout(100);
}

async function installFailingLoadReader(page: Page) {
  await page.addInitScript(() => {
    FileReader.prototype.readAsText = function (file: Blob) {
      const type = (file as File).name.startsWith('abort') ? 'abort' : 'error';
      setTimeout(() => this.dispatchEvent(new ProgressEvent(type)), 0);
    };
  });
}

async function openGenerationWithSolar(page: Page) {
  await page.goto('/');
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await page.locator('button[title="Add Solar Array"]').click();
}

async function completePendingResourceRead(page: Page) {
  await page.evaluate(() => (window as Window & { resolvePendingResourceRead?: () => void }).resolvePendingResourceRead?.());
  await page.waitForTimeout(150);
}

test('covers sample, imports, settings, results, local save/open, export, and reset at mobile width', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const loadFile = page.getByLabel('Upload interval load CSV');
  await loadFile.setInputFiles({ name: 'valid-load.csv', mimeType: 'text/csv', buffer: Buffer.from(validLoadCsv) });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();

  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await openTab(page, '1. Data & TOU Rates');
  const quarterHourCsv = [
    'timestamp,usage_kwh',
    ...Array.from({ length: 35_040 }, (_, index) => `${new Date(Date.UTC(2025, 0, 1) + index * 15 * 60_000).toISOString()},1`),
  ].join('\n');
  const memoryBefore = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
  const startedAt = Date.now();
  await loadFile.setInputFiles({ name: 'maximum-intervals.csv', mimeType: 'text/csv', buffer: Buffer.from(quarterHourCsv) });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();
  await expect(page.getByText('Exact full-calendar-year coverage is available for lifecycle projections.')).toBeVisible();
  const importElapsedMs = Date.now() - startedAt;
  const memoryAfter = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
  console.log(`35,040 interval Chromium import: ${importElapsedMs} ms; renderer JS heap delta: ${memoryBefore !== null && memoryAfter !== null ? `${((memoryAfter - memoryBefore) / (1024 * 1024)).toFixed(1)} MiB` : 'unavailable'}`);
  await loadFile.setInputFiles({ name: 'invalid-load.csv', mimeType: 'text/csv', buffer: Buffer.from('wrong,columns\nno,data') });
  await expect(page.getByRole('alert')).toContainText(/missing|header|column/i);
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();
  await loadFile.setInputFiles({ name: 'valid-load.csv', mimeType: 'text/csv', buffer: Buffer.from(validLoadCsv) });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();

  await openTab(page, '2. Battery Profiles');
  const capacity = page.getByRole('spinbutton', { name: 'Total storage capacity (kWh)' });
  await capacity.fill('14.5');
  await expect(capacity).toHaveValue('14.5');
  await auditNumericNames(page);

  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await page.locator('button[title="Add Solar Array"]').click();
  await page.getByLabel('solar asset name').fill('Test Roof Array');
  await auditNumericNames(page);
  await page.locator('input[aria-label="Import measured resource CSV"]').setInputFiles({
    name: 'measured-solar.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(validSolarCsv),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Loaded 2 intervals from measured-solar.csv' })).toBeVisible();
  await expect(page.getByText('Attached: measured-solar.csv')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await openTab(page, '1. Data & TOU Rates');
  await page.getByRole('main').getByRole('button', { name: 'Load synthetic 8,760h sample' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();
  await auditNumericNames(page);
  await openTab(page, '5. Results & Analytics');
  await expect(page.getByRole('button', { name: 'Table View' })).toBeVisible();
  await page.getByRole('button', { name: 'Table View' }).click();
  await expect(page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Home Load' }) })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  const exportButton = page.getByRole('button', { name: 'Export Analysis for LLM (.json)' }).first();
  await expect(exportButton).toBeEnabled();
  const [exportDownload] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
  expect(exportDownload.suggestedFilename()).toMatch(/analysis_export\.json$/);

  await openTab(page, '1. Data & TOU Rates');
  const [projectDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save Project' }).click(),
  ]);
  const projectPath = await projectDownload.path();
  const archiveBytes = (await stat(projectPath!)).size;
  expect(projectPath).toBeTruthy();
  page.on('dialog', (dialog) => dialog.accept());
  const archiveImportStartedAt = Date.now();
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles(projectPath!);
  await expect(page.getByRole('status').filter({ hasText: /^Opened / })).toBeVisible();
  console.log(`8,760-row project archive: ${archiveBytes} bytes; browser open/parse: ${Date.now() - archiveImportStartedAt} ms`);

  await page.getByRole('button', { name: 'Reset all project data, including load and solar/wind resource files' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No load dataset is active.' })).toBeVisible();
  expect(pageErrors).toEqual([]);
});

test('cancels resource reads after asset edits, selection changes, and removal', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 320, height: 760 });
  await installDelayedFileReader(page);
  await openGenerationWithSolar(page);
  await startDelayedResourceRead(page);
  await page.getByLabel('solar asset name').fill('Renamed while waiting');
  await completePendingResourceRead(page);
  await expect(page.getByText('Loaded 2 intervals from delayed-solar.csv.')).toHaveCount(0);
  await expect(page.getByText('Attached: delayed-solar.csv')).toHaveCount(0);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

  await page.locator('button[title="Add Solar Array"]').click();
  await startDelayedResourceRead(page);
  await page.locator('button[title="Add Wind Turbine"]').click();
  await completePendingResourceRead(page);
  await expect(page.getByText('Loaded 2 intervals from delayed-solar.csv.')).toHaveCount(0);
  await page.locator('[role="button"][aria-pressed="false"]').first().click();
  await expect(page.getByText('Attached: delayed-solar.csv')).toHaveCount(0);

  await page.locator('button[title="Add Solar Array"]').click();
  await startDelayedResourceRead(page);
  await page.getByRole('button', { name: 'Delete', exact: true }).click();
  await completePendingResourceRead(page);
  await expect(page.getByText('Loaded 2 intervals from delayed-solar.csv.')).toHaveCount(0);
  await page.locator('button[title="Add Solar Array"]').click();
  await expect(page.getByText('Attached: delayed-solar.csv')).toHaveCount(0);

  await startDelayedResourceRead(page);
  await openTab(page, '1. Data & TOU Rates');
  await completePendingResourceRead(page);
  await openTab(page, '3. Power Generation');
  await expect(page.getByText('Loaded 2 intervals from delayed-solar.csv.')).toHaveCount(0);
  await page.locator('[role="button"][aria-pressed="false"]').last().click();
  await expect(page.getByText('Attached: delayed-solar.csv')).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('keeps measured resource source timezone independent and removal explicitly unbound', async ({ page }) => {
  await openGenerationWithSolar(page);
  await page.getByLabel('Site timezone (IANA)').fill('America/New_York');
  await page.getByLabel('Resource source timezone (IANA)').fill('America/Los_Angeles');
  const resourceCsv = [
    'timestamp,ghi_wm2,dni_wm2,dhi_wm2',
    '2025-01-01 08:00,800,650,150',
    '2025-01-01 09:00,850,700,150',
  ].join('\n');
  await page.locator('input[aria-label="Import measured resource CSV"]').setInputFiles({
    name: 'west-coast-solar.csv', mimeType: 'text/csv', buffer: Buffer.from(resourceCsv),
  });
  await expect(page.getByRole('status').filter({ hasText: /Loaded 2 intervals.*source zone: America\/Los_Angeles.*site zone: America\/New_York/i })).toBeVisible();
  await expect(page.getByText(/2025-01-01T16:00:00\.000Z/)).toBeVisible();
  await expect(page.getByText(/Site time zone:.*America\/New_York/)).toBeVisible();
  await page.getByRole('button', { name: 'Remove measured resource' }).click();
  await expect(page.getByRole('alert')).toContainText(/measured solar mode has no attached resource/i);
  await expect(page.getByRole('radio', { name: 'Measured Irradiance CSV' })).toBeChecked();
  await page.locator('input[aria-label="Import measured resource CSV"]').setInputFiles({
    name: 'west-coast-solar.csv', mimeType: 'text/csv', buffer: Buffer.from(resourceCsv),
  });
  await expect(page.getByText('Attached: west-coast-solar.csv')).toBeVisible();
});

test('rejects invalid project archives atomically and navigates a valid archive across tabs', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.goto('/');
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await openTab(page, '1. Data & TOU Rates');
  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name: 'valid-load.csv', mimeType: 'text/csv', buffer: Buffer.from(validLoadCsv),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();
  const [projectDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save Project' }).click(),
  ]);
  const archivePath = await projectDownload.path();
  const archive = JSON.parse(await readFile(archivePath!, 'utf8'));
  const dialogMessages: string[] = [];
  page.on('dialog', async (dialog) => {
    dialogMessages.push(dialog.message());
    await dialog.accept();
  });

  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles(archivePath!);
  await expect(page.getByRole('status').filter({ hasText: /^Opened / })).toBeVisible();
  await openTab(page, '4. Financials & Settings');
  await expect(page.getByRole('heading', { name: /Macro Financials, Lifecycle Costs & Resilience/ })).toBeVisible();
  await openTab(page, '5. Results & Analytics');
  await expect(page.getByRole('button', { name: 'Table View' })).toBeVisible();

  await openTab(page, '3. Power Generation');
  const siteZone = page.getByLabel('Site timezone (IANA)');
  await siteZone.fill('America/New_York');
  archive.project.generationConfig.site.latitude = 91;
  await openTab(page, '1. Data & TOU Rates');
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles({
    name: 'invalid-project.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(archive)),
  });
  await expect(page.getByText(/latitude.*-90.*90/i)).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await openTab(page, '3. Power Generation');
  await expect(siteZone).toHaveValue('America/New_York');
  await openTab(page, '5. Results & Analytics');
  await expect(page.getByRole('button', { name: 'Table View' })).toBeVisible();
  await openTab(page, '2. Battery Profiles');
  const batteryCapacity = page.getByLabel('Total storage capacity (kWh)');
  await batteryCapacity.fill('0');
  await batteryCapacity.press('Tab');
  await expect(batteryCapacity).toHaveValue('1');
  expect(dialogMessages).toHaveLength(1);
  expect(pageErrors).toEqual([]);
});

test('supersedes pending load reads when a sample, reset, or project opening is selected', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await installDelayedLoadReader(page);
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');

  const olderCsv = validLoadCsv;
  const newerCsv = validLoadCsv.replace(',1,24,kWh', ',10,33,kWh').replace(',1.2,24,kWh', ',11,33,kWh').replace(',0.8,24,kWh', ',12,33,kWh');
  await startDelayedLoadRead(page, 'older-load.csv', olderCsv);
  await startDelayedLoadRead(page, 'newer-load.csv', newerCsv);
  await completePendingLoadRead(page, 'newer-load.csv');
  await completePendingLoadRead(page, 'older-load.csv');
  await expect(page.getByRole('main').getByText('33 kWh', { exact: true })).toBeVisible();

  await startDelayedLoadRead(page);
  await page.getByRole('main').getByRole('button', { name: 'Load synthetic 8,760h sample' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();
  await completePendingLoadRead(page);
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();
  await expect(page.getByText(/active dataset is unchanged/i)).toHaveCount(0);

  await startDelayedLoadRead(page);
  await page.getByRole('button', { name: 'Reset all project data, including load and solar/wind resource files' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No load dataset is active.' })).toBeVisible();
  await completePendingLoadRead(page);
  await expect(page.getByRole('status').filter({ hasText: 'No load dataset is active.' })).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: 'Load synthetic 8,760h sample' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Save Project' }).click(),
  ]);
  const savedPath = await download.path();
  page.on('dialog', (dialog) => dialog.accept());
  await startDelayedLoadRead(page);
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles(savedPath!);
  await expect(page.getByRole('status').filter({ hasText: /^Opened / })).toBeVisible();
  await completePendingLoadRead(page);
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();
  await expect(page.getByText(/active dataset is unchanged/i)).toHaveCount(0);
  expect(pageErrors).toEqual([]);
});

test('enforces ingestion size limits and preserves active data for over-limit files', async ({ page }) => {
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');
  const loadFile = page.getByLabel('Upload interval load CSV');
  const paddedLoad = Buffer.concat([Buffer.from(validLoadCsv), Buffer.alloc(MAX_LOAD_CSV_BYTES - Buffer.byteLength(validLoadCsv), 32)]);
  await loadFile.setInputFiles({ name: 'at-limit-load.csv', mimeType: 'text/csv', buffer: paddedLoad });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();
  await loadFile.setInputFiles({
    name: 'over-limit-load.csv', mimeType: 'text/csv', buffer: Buffer.alloc(MAX_LOAD_CSV_BYTES + 1, 32),
  });
  await expect(page.getByText(/2 MiB limit.*active dataset is unchanged/i)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();

  const oversizedProject = Buffer.alloc(MAX_PROJECT_ARCHIVE_BYTES + 1, 32);
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles({
    name: 'too-large-project.json', mimeType: 'application/json', buffer: oversizedProject,
  });
  await expect(page.getByText(/12 MiB limit/i)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();

  await openTab(page, '3. Power Generation');
  await page.locator('button[title="Add Solar Array"]').click();
  await page.locator('input[aria-label="Import measured resource CSV"]').setInputFiles({
    name: 'too-large-resource.csv', mimeType: 'text/csv', buffer: Buffer.alloc(MAX_RESOURCE_CSV_BYTES + 1, 32),
  });
  await expect(page.getByText(/resource CSV exceeds the 2 MiB limit/i)).toBeVisible();
  await expect(page.getByText('Attached: too-large-resource.csv')).toHaveCount(0);

  for (let index = 0; index < MAX_GENERATION_ASSETS; index += 1) {
    await page.locator('button[title="Add Solar Array"]').click();
  }
  await expect(page.locator('[role="button"][aria-pressed]')).toHaveCount(MAX_GENERATION_ASSETS);
  await page.locator('button[title="Add Solar Array"]').click();
  await expect(page.getByText(/up to 10 generation assets/i)).toBeVisible();
  await expect(page.locator('[role="button"][aria-pressed]')).toHaveCount(MAX_GENERATION_ASSETS);
});

test('load reader errors and aborts report recoverably without discarding active data', async ({ page }) => {
  await installFailingLoadReader(page);
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');
  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name: 'read-error.csv', mimeType: 'text/csv', buffer: Buffer.from(validLoadCsv),
  });
  await expect(page.getByText(/could not read read-error\.csv/i)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();

  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name: 'abort-load.csv', mimeType: 'text/csv', buffer: Buffer.from(validLoadCsv),
  });
  await expect(page.getByText(/reading abort-load\.csv was canceled/i)).toBeVisible();
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();
});

test('gives numeric controls accessible names across data, batteries, and every generation asset type', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  await page.setViewportSize({ width: 1200, height: 900 });
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');
  await auditNumericNames(page);
  await openTab(page, '2. Battery Profiles');
  await auditNumericNames(page);
  await openTab(page, '4. Financials & Settings');
  await auditNumericNames(page);
  await openTab(page, '5. Results & Analytics');
  await auditNumericNames(page);
  await openTab(page, '3. Power Generation');

  for (const [index, title] of ['Add Solar Array', 'Add Wind Turbine', 'Add Generator'].entries()) {
    await page.locator(`button[title="${title}"]`).click();
    await page.locator('[role="button"][aria-pressed]').nth(index).click();
    await auditNumericNames(page);
    if (title === 'Add Wind Turbine') {
      await page.getByText('Monthly Average Wind Speed', { exact: true }).click();
      await auditNumericNames(page);
    }
  }

  await page.getByRole('button', { name: 'Add Point', exact: true }).last().click();
  await auditNumericNames(page);
  expect(pageErrors).toEqual([]);
});

test('keeps keyboard focus visible, chart table navigation accessible, and honors reduced motion', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await page.locator('body').click({ position: { x: 1, y: 1 } });
  await page.keyboard.press('Tab');
  const focus = await page.evaluate(() => {
    const active = document.activeElement as HTMLElement;
    const style = getComputedStyle(active);
    return { tag: active.tagName, outline: style.outlineStyle, width: style.outlineWidth, shadow: style.boxShadow };
  });
  expect(focus.tag).not.toBe('BODY');
  expect(focus.outline !== 'none' && focus.outline !== 'initial' || focus.shadow !== 'none').toBe(true);

  let resultsTabReached = false;
  for (let i = 0; i < 20; i += 1) {
    const focusedText = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement;
      return active.getAttribute('aria-label') || active.innerText || '';
    });
    if (focusedText.includes('5. Results & Analytics')) {
      await page.keyboard.press('Enter');
      resultsTabReached = true;
      break;
    }
    await page.keyboard.press('Tab');
  }
  expect(resultsTabReached).toBe(true);
  await expect(page.getByRole('button', { name: 'Table View' })).toBeVisible();
  let tableViewReached = false;
  for (let i = 0; i < 100; i += 1) {
    await page.keyboard.press('Tab');
    const focusedText = await page.evaluate(() => {
      const active = document.activeElement as HTMLElement;
      return active.getAttribute('aria-label') || active.innerText || '';
    });
    if (focusedText.trim() === 'Table View') {
      await page.keyboard.press('Enter');
      tableViewReached = true;
      break;
    }
  }
  expect(tableViewReached).toBe(true);
  await expect(page.locator('table').filter({ has: page.getByRole('columnheader', { name: 'Home Load' }) })).toBeVisible();
  const motion = await page.getByRole('button', { name: '5. Results & Analytics' }).last()
    .evaluate((node) => getComputedStyle(node).transitionDuration);
  expect(parseFloat(motion)).toBeLessThanOrEqual(0.00001);
});

test('explains the modeled scope at tariff, generation, and results steps', async ({ page }) => {
  await page.goto('/');
  await expect(page).toHaveTitle(/VoltWise \| Home Energy Scenario Analyzer/);
  const description = await page.locator('meta[name="description"]').getAttribute('content');
  expect(description).toMatch(/energy-rate estimates/i);
  expect(description).not.toMatch(/comprehensive|ROI & TOU Simulation/i);

  await openTab(page, '1. Data & TOU Rates');
  await expect(page.getByRole('region', { name: 'Tariff scope' })).toContainText(/energy-rate estimate/i);
  await expect(page.getByRole('region', { name: 'Tariff scope' })).toContainText(/demand charges.*fixed.*taxes/i);
  await expect(page.getByRole('region', { name: 'Tariff scope' })).toContainText(/built-in profiles are illustrative/i);

  await openTab(page, '3. Power Generation');
  await expect(page.getByRole('region', { name: 'Generation model scope' })).toContainText(/interval-by-interval/i);
  await expect(page.getByRole('region', { name: 'Generation model scope' })).toContainText(/does not simulate chronological outages/i);
  await expect(page.getByRole('region', { name: 'Generation model scope' })).toContainText(/does not fetch weather services or support TMY3\/EPW files/i);
  await expect(page.getByRole('region', { name: 'Generation model scope' })).toContainText(/complete aligned measured year can be replayed as a representative resource year/i);

  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await openTab(page, '5. Results & Analytics');
  await expect(page.getByRole('region', { name: 'Analysis scope' })).toContainText(/estimates, not a utility bill or a guarantee/i);
  await expect(page.getByRole('region', { name: 'Analysis scope' })).toContainText(/user-entered outage assumptions/i);
  await expect(page.getByText(/modeled cost reduction/i).first()).toBeVisible();
  await expect(page.getByText(/bill cut|8,760 hours/i)).toHaveCount(0);
});
