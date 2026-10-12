import { expect, test, Page } from '@playwright/test';

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

async function openGenerationWithSolar(page: Page) {
  await page.goto('/');
  await openTab(page, '3. Power Generation');
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
  await loadFile.setInputFiles({ name: 'invalid-load.csv', mimeType: 'text/csv', buffer: Buffer.from('wrong,columns\nno,data') });
  await expect(page.getByRole('heading', { name: 'CSV Schema Validation Errors Detected' })).toBeVisible();
  await expect(page.getByRole('alert')).toContainText(/missing|header|column/i);
  await loadFile.setInputFiles({ name: 'valid-load.csv', mimeType: 'text/csv', buffer: Buffer.from(validLoadCsv) });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();

  await openTab(page, '2. Battery Profiles');
  const capacity = page.getByRole('spinbutton', { name: 'Total storage capacity (kWh)' });
  await capacity.fill('14.5');
  await expect(capacity).toHaveValue('14.5');
  await auditNumericNames(page);

  await openTab(page, '3. Power Generation');
  await page.locator('button[title="Add Solar Array"]').click();
  await page.getByLabel('solar asset name').fill('Test Roof Array');
  await auditNumericNames(page);
  await page.locator('input[aria-label="Import measured resource CSV"]').setInputFiles({
    name: 'measured-solar.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(validSolarCsv),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Loaded 2 intervals from measured-solar.csv.' })).toBeVisible();
  await expect(page.getByText('Attached: measured-solar.csv')).toBeVisible();
  await page.getByRole('button', { name: 'Delete', exact: true }).click();

  await openTab(page, '1. Data & TOU Rates');
  await page.getByRole('button', { name: 'Load synthetic 8,760h sample' }).click();
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
  expect(projectPath).toBeTruthy();
  page.on('dialog', (dialog) => dialog.accept());
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles(projectPath!);
  await expect(page.getByRole('status').filter({ hasText: /^Opened / })).toBeVisible();

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
