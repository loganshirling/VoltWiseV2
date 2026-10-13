import { expect, test, Page } from '@playwright/test';
import { readFile, stat } from 'node:fs/promises';
import { MAX_GENERATION_ASSETS, MAX_LOAD_CSV_BYTES, MAX_PROJECT_ARCHIVE_BYTES, MAX_RESOURCE_CSV_BYTES } from '../src/utils/importLimits';
import { DEFAULT_BATTERY_PROFILES, DEFAULT_MACRO_FINANCIALS, DEFAULT_TOU_PROFILES, createDefaultScheduleMatrix } from '../src/utils/simulationEngine';
import { createDefaultGenerationConfig, createDefaultGeneratorAsset, createDefaultSolarAsset, createDefaultWindAsset } from '../src/utils/generationDefaults';
import { serializeProjectArchive } from '../src/utils/projectArchive';
import { ProjectArchiveState } from '../src/types/energy';

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
  await page.getByLabel('Latitude (degrees north)').fill('37.77');
  await page.getByLabel('Longitude (degrees east)').fill('-122.4');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await page.locator('button[title="Add Solar Array"]').click();
}

test('fresh sample explains timezone setup and makes results usable after explicit selection', async ({ page }) => {
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Set a site timezone to run this sample' })).toBeVisible();
  await page.getByRole('button', { name: 'Set site timezone' }).click();
  const timeZone = page.getByLabel('Site timezone (IANA)');
  await expect(timeZone).toBeVisible();
  await expect(timeZone).toHaveValue('');
  await timeZone.fill('UTC');
  await openTab(page, '5. Results & Analytics');
  await expect(page.getByRole('button', { name: 'Table View' })).toBeVisible();
});

test('uploaded load without a site timezone remains blocked until a timezone is selected', async ({ page }) => {
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');
  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name: 'valid-load.csv', mimeType: 'text/csv', buffer: Buffer.from(validLoadCsv),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();
  await expect(page.getByText(/Set a valid site timezone before running a simulation/i)).toBeVisible();
  await expect(page.getByText('Interval Dataset Ready for Simulation')).not.toBeVisible();
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await openTab(page, '1. Data & TOU Rates');
  await expect(page.getByText('Interval Dataset Ready for Simulation')).toBeVisible();
});

test('imports the maximum UTC 2024 quarter-hour load as a complete leap year', async ({ page }) => {
  await page.goto('/');
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await openTab(page, '1. Data & TOU Rates');
  const leapCsv = [
    'timestamp,usage_kwh',
    ...Array.from({ length: 35_136 }, (_, index) => `${new Date(Date.UTC(2024, 0, 1) + index * 15 * 60_000).toISOString()},0.25`),
  ].join('\n');
  const heapBefore = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
  const startedAt = Date.now();
  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name: '2024-quarter-hour-load.csv', mimeType: 'text/csv', buffer: Buffer.from(leapCsv),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();
  await expect(page.getByText('Exact full-calendar-year coverage is available for lifecycle projections.')).toBeVisible();
  const heapAfter = await page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
  console.log(`35,136-row leap-year Chromium import: ${Date.now() - startedAt} ms; renderer JS heap delta: ${heapBefore !== null && heapAfter !== null ? `${((heapAfter - heapBefore) / (1024 * 1024)).toFixed(1)} MiB` : 'unavailable'}`);
});

test('rejects a resource attachment that exceeds the project data budget without losing active data', async ({ page }) => {
  await page.goto('/');
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Latitude (degrees north)').fill('37.77');
  await page.getByLabel('Longitude (degrees east)').fill('-122.4');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await openTab(page, '1. Data & TOU Rates');
  const timestamps = Array.from({ length: 35_136 }, (_, index) =>
    new Date(Date.UTC(2024, 0, 1) + index * 15 * 60_000).toISOString()
  );
  const loadCsv = ['timestamp,usage_kwh', ...timestamps.map((timestamp) => `${timestamp},0.25`)].join('\n');
  const solarCsv = (offset: number) => ['timestamp,ghi_wm2,dni_wm2,dhi_wm2',
    ...timestamps.map((timestamp) => `${timestamp},${850.5 + offset},720.25,130.25`),
  ].join('\n');
  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name: 'saveable-2024-load.csv', mimeType: 'text/csv', buffer: Buffer.from(loadCsv),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();

  await openTab(page, '3. Power Generation');
  for (let index = 1; index <= 3; index += 1) {
    await page.locator('button[title="Add Solar Array"]').click();
    const assetName = `Saveable Array ${index}`;
    await page.getByLabel('solar asset name').fill(assetName);
    await page.locator('input[aria-label="Import measured resource CSV"]').setInputFiles({
      name: `saveable-solar-${index}.csv`, mimeType: 'text/csv', buffer: Buffer.from(solarCsv(index)),
    });
    if (index < 3) {
      await expect(page.getByRole('status').filter({ hasText: `Loaded 35,136 intervals from saveable-solar-${index}.csv` })).toBeVisible();
    } else {
      await expect(page.getByText(/aggregate persisted data cannot exceed 9 MiB/i)).toBeVisible();
    }
  }
  await expect(page.getByRole('status').filter({ hasText: 'Unsaved changes' })).toBeVisible();
  await page.getByRole('button', { name: /Saveable Array 1/ }).click();
  await expect(page.getByText('Attached: saveable-solar-1.csv')).toBeVisible();
  await page.getByRole('button', { name: /Saveable Array 2/ }).click();
  await expect(page.getByText('Attached: saveable-solar-2.csv')).toBeVisible();
  await page.getByRole('button', { name: /Saveable Array 3/ }).click();
  await expect(page.getByText('Attached: saveable-solar-3.csv')).not.toBeVisible();
  await openTab(page, '1. Data & TOU Rates');
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();
});

test('round-trips and recalculates the maximum supported leap-year solar-wind project', async ({ page }) => {
  // Full-year resources and a multi-MiB project require more than the default
  // 90 seconds on slower CI runners when both save and reopen are exercised.
  test.setTimeout(180_000);
  const inputArchive = await createMaximumLeapYearProjectArchive();
  const startHeapSampler = async (target: Page) => target.addInitScript(() => {
    const scope = window as Window & { __voltwiseHeapSamples?: number[]; __voltwiseHeapTimer?: number };
    scope.__voltwiseHeapSamples = [];
    scope.__voltwiseHeapTimer = window.setInterval(() => {
      const used = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      if (used !== undefined) scope.__voltwiseHeapSamples?.push(used);
    }, 25);
  });
  const peakHeapMiB = async (target: Page) => target.evaluate(() => {
    const scope = window as Window & { __voltwiseHeapSamples?: number[]; __voltwiseHeapTimer?: number };
    window.clearInterval(scope.__voltwiseHeapTimer);
    const samples = scope.__voltwiseHeapSamples ?? [];
    return samples.length ? Math.max(...samples) / (1024 * 1024) : null;
  });

  page.on('dialog', (dialog) => dialog.accept());
  await startHeapSampler(page);
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles({
    name: 'maximum-2024-solar-wind.json', mimeType: 'application/json', buffer: inputArchive,
  });
  await expect(page.getByRole('status').filter({ hasText: /^Opened maximum-2024-solar-wind\.json\./ })).toBeVisible();
  await openTab(page, '3. Power Generation');
  await expect(page.getByText('Attached: Maximum 2024 solar')).toBeVisible();
  await page.getByRole('button', { name: /Wind Turbine Wind Turbine/ }).click();
  await expect(page.getByText('Attached: Maximum 2024 wind')).toBeVisible();
  await openTab(page, '5. Results & Analytics');
  const exportButton = page.getByRole('button', { name: 'Export Analysis for LLM (.json)' }).first();
  await expect(exportButton).toBeEnabled({ timeout: 60_000 });
  const [firstExport] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
  const firstAnalysis = JSON.parse(await readFile((await firstExport.path())!, 'utf8'));

  await openTab(page, '1. Data & TOU Rates');
  const [projectDownload] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Save Project' }).click(),
  ]);
  const savedPath = (await projectDownload.path())!;
  const savedBytes = (await stat(savedPath)).size;
  expect(savedBytes).toBeLessThan(MAX_PROJECT_ARCHIVE_BYTES - 1024 * 1024);
  const browserPeakHeapMiB = await peakHeapMiB(page);

  const freshContext = await page.context().browser()!.newContext();
  const freshPage = await freshContext.newPage();
  freshPage.on('dialog', (dialog) => dialog.accept());
  await startHeapSampler(freshPage);
  await freshPage.goto('/');
  await openTab(freshPage, '1. Data & TOU Rates');
  await freshPage.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles({
    name: 'maximum-roundtrip.json', mimeType: 'application/json', buffer: await readFile(savedPath),
  });
  await expect(freshPage.getByRole('region', { name: 'Local Project File' }).getByRole('status'))
    .toContainText('Opened maximum-roundtrip.json.');
  await openTab(freshPage, '3. Power Generation');
  await expect(freshPage.getByText('Attached: Maximum 2024 solar')).toBeVisible();
  await freshPage.getByRole('button', { name: /Wind Turbine Wind Turbine/ }).click();
  await expect(freshPage.getByText('Attached: Maximum 2024 wind')).toBeVisible();
  await openTab(freshPage, '5. Results & Analytics');
  const freshExportButton = freshPage.getByRole('button', { name: 'Export Analysis for LLM (.json)' }).first();
  await expect(freshExportButton).toBeEnabled({ timeout: 60_000 });
  const [secondExport] = await Promise.all([freshPage.waitForEvent('download'), freshExportButton.click()]);
  const secondAnalysis = JSON.parse(await readFile((await secondExport.path())!, 'utf8'));
  expect(secondAnalysis.metadata.dataset_summary).toEqual(firstAnalysis.metadata.dataset_summary);
  expect(secondAnalysis.year_1_results).toEqual(firstAnalysis.year_1_results);
  expect(secondAnalysis.annual_time_series).toEqual(firstAnalysis.annual_time_series);
  const reopenedPeakHeapMiB = await peakHeapMiB(freshPage);
  console.log(`Maximum project round-trip: ${savedBytes} archive bytes; renderer peak JS heap: ${browserPeakHeapMiB === null || reopenedPeakHeapMiB === null ? 'unavailable' : `${browserPeakHeapMiB.toFixed(1)} / ${reopenedPeakHeapMiB.toFixed(1)} MiB (save and reopen)`}`);
  await freshContext.close();
});

async function completePendingResourceRead(page: Page) {
  await page.evaluate(() => (window as Window & { resolvePendingResourceRead?: () => void }).resolvePendingResourceRead?.());
  await page.waitForTimeout(150);
}

async function createGenerationJourneyArchive(assets: ProjectArchiveState['generationConfig']['assets']): Promise<Buffer> {
  const generationConfig = createDefaultGenerationConfig();
  generationConfig.site = { latitude: 37.7749, longitude: -122.4194, elevationM: 16, timeZone: 'UTC' };
  const start = Date.UTC(2025, 5, 15);
  const timestamps = Array.from({ length: 24 }, (_, hour) => new Date(start + hour * 3_600_000).toISOString());
  const externalResources: NonNullable<ProjectArchiveState['generationConfig']['externalResources']> = [];
  for (const asset of assets) {
    if (asset.type === 'solar' && asset.resourceMode === 'weather_file') {
      externalResources.push({
        id: asset.externalResourceId!, name: 'E2E measured solar', kind: 'solar_irradiance', sourceTimeZone: 'UTC',
        intervalHours: 1, rowCount: timestamps.length, startTimestampUtc: timestamps[0], endTimestampUtc: timestamps.at(-1)!,
        records: timestamps.map((timestampUtc, hour) => {
          const ghiWm2 = hour >= 11 && hour <= 15 ? 700 : 0;
          return { timestampUtc, ghiWm2, dniWm2: ghiWm2 * 0.75, dhiWm2: ghiWm2 * 0.25 };
        }),
      });
    }
    if (asset.type === 'wind' && asset.resourceMode === 'interval_file') {
      externalResources.push({
        id: asset.externalResourceId!, name: 'E2E measured wind', kind: 'wind_speed', sourceTimeZone: 'UTC',
        intervalHours: 1, rowCount: timestamps.length, startTimestampUtc: timestamps[0], endTimestampUtc: timestamps.at(-1)!,
        records: timestamps.map((timestampUtc, hour) => ({ timestampUtc, windSpeedMps: hour >= 8 && hour <= 17 ? 8 : 0 })),
      });
    }
  }
  generationConfig.assets = assets;
  generationConfig.externalResources = externalResources;
  const tou = DEFAULT_TOU_PROFILES[0];
  const loadDataCsv = [
    'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
    ...Array.from({ length: 24 }, (_, hour) => `06/15/2025,${hour === 0 ? '12:00 AM' : hour < 12 ? `${hour}:00 AM` : hour === 12 ? '12:00 PM' : `${hour - 12}:00 PM`},1,24,kWh`),
  ].join('\n');
  const state: ProjectArchiveState = {
    profiles: DEFAULT_BATTERY_PROFILES,
    activeProfileId: DEFAULT_BATTERY_PROFILES[0].id,
    touProfiles: DEFAULT_TOU_PROFILES,
    activeTouProfileId: tou.id,
    tiers: tou.tiers,
    scheduleMatrix: tou.scheduleMatrix,
    generationConfig,
    allowSolarExport: false,
    financials: DEFAULT_MACRO_FINANCIALS,
    loadDataCsv,
    loadDataSource: 'uploaded',
  };
  return Buffer.from(await serializeProjectArchive(state).arrayBuffer());
}

async function createMaximumLeapYearProjectArchive(): Promise<Buffer> {
  const timestamps = Array.from({ length: 35_136 }, (_, index) =>
    new Date(Date.UTC(2024, 0, 1) + index * 15 * 60_000).toISOString()
  );
  const solarId = 'max-solar-resource';
  const windId = 'max-wind-resource';
  const solar = createDefaultSolarAsset('max-solar');
  solar.enabled = false;
  solar.resourceMode = 'weather_file';
  solar.externalResourceId = solarId;
  const wind = createDefaultWindAsset('max-wind');
  wind.enabled = false;
  wind.resourceMode = 'interval_file';
  wind.externalResourceId = windId;
  const generationConfig = createDefaultGenerationConfig();
  generationConfig.site = { latitude: 37.7749, longitude: -122.4194, elevationM: 16, timeZone: 'UTC' };
  generationConfig.assets = [solar, wind];
  generationConfig.externalResources = [
    {
      id: solarId, name: 'Maximum 2024 solar', kind: 'solar_irradiance', sourceTimeZone: 'UTC',
      intervalHours: 0.25, rowCount: timestamps.length, startTimestampUtc: timestamps[0], endTimestampUtc: timestamps.at(-1)!,
      records: timestamps.map((timestampUtc) => ({ timestampUtc, ghiWm2: 850.5, dniWm2: 720.25, dhiWm2: 130.25 })),
    },
    {
      id: windId, name: 'Maximum 2024 wind', kind: 'wind_speed', sourceTimeZone: 'UTC',
      intervalHours: 0.25, rowCount: timestamps.length, startTimestampUtc: timestamps[0], endTimestampUtc: timestamps.at(-1)!,
      records: timestamps.map((timestampUtc) => ({ timestampUtc, windSpeedMps: 5.25 })),
    },
  ];
  const tou = DEFAULT_TOU_PROFILES[0];
  const state: ProjectArchiveState = {
    profiles: DEFAULT_BATTERY_PROFILES,
    activeProfileId: DEFAULT_BATTERY_PROFILES[0].id,
    touProfiles: DEFAULT_TOU_PROFILES,
    activeTouProfileId: tou.id,
    tiers: tou.tiers,
    scheduleMatrix: createDefaultScheduleMatrix(),
    generationConfig,
    allowSolarExport: false,
    financials: DEFAULT_MACRO_FINANCIALS,
    loadDataCsv: ['timestamp,usage_kwh', ...timestamps.map((timestamp) => `${timestamp},0.25`)].join('\n'),
    loadDataSource: 'uploaded',
  };
  return Buffer.from(await serializeProjectArchive(state).arrayBuffer());
}

test('covers sample, imports, settings, results, local save/open, export, and reset at mobile width', async ({ page }) => {
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('dialog', (dialog) => dialog.accept());
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();
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
  page.on('dialog', (dialog) => dialog.accept());
  await installDelayedLoadReader(page);
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();

  const olderCsv = validLoadCsv;
  const newerCsv = validLoadCsv.replace(',1,24,kWh', ',10,33,kWh').replace(',1.2,24,kWh', ',11,33,kWh').replace(',0.8,24,kWh', ',12,33,kWh');
  await startDelayedLoadRead(page, 'older-load.csv', olderCsv);
  await startDelayedLoadRead(page, 'newer-load.csv', newerCsv);
  await completePendingLoadRead(page, 'newer-load.csv');
  await completePendingLoadRead(page, 'older-load.csv');
  await expect(page.getByRole('main').getByText('33 kWh', { exact: true })).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();

  await startDelayedLoadRead(page);
  await page.getByRole('main').getByRole('button', { name: 'Load synthetic 8,760h sample' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();
  await completePendingLoadRead(page);
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();
  await expect(page.getByText(/active dataset is unchanged/i)).toHaveCount(0);
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();

  await startDelayedLoadRead(page);
  await page.getByRole('button', { name: 'Reset all project data, including load and solar/wind resource files' }).click();
  await expect(page.getByRole('status').filter({ hasText: 'No load dataset is active.' })).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await completePendingLoadRead(page);
  await expect(page.getByRole('status').filter({ hasText: 'No load dataset is active.' })).toBeVisible();

  await page.getByRole('main').getByRole('button', { name: 'Load synthetic 8,760h sample' }).click();
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Save Project' }).click(),
  ]);
  const savedPath = await download.path();
  await startDelayedLoadRead(page);
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles(savedPath!);
  await expect(page.getByRole('status').filter({ hasText: /^Opened / })).toBeVisible();
  await completePendingLoadRead(page);
  await expect(page.getByRole('status').filter({ hasText: 'Illustrative synthetic sample.' })).toBeVisible();
  await expect(page.getByText(/active dataset is unchanged/i)).toHaveCount(0);
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();
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

test('tracks unsaved project edits and guards save, open, reset, and browser close', async ({ page }) => {
  await page.addInitScript(() => {
    const listeners = new Set<EventListenerOrEventListenerObject>();
    const add = window.addEventListener.bind(window);
    const remove = window.removeEventListener.bind(window);
    Object.defineProperty(window, '__beforeUnloadCount', { value: 0, writable: true });
    window.addEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | AddEventListenerOptions) => {
      if (type === 'beforeunload') {
        listeners.add(listener);
        (window as unknown as Window & { __beforeUnloadCount: number }).__beforeUnloadCount = listeners.size;
      }
      add(type, listener, options);
    }) as typeof window.addEventListener;
    window.removeEventListener = ((type: string, listener: EventListenerOrEventListenerObject, options?: boolean | EventListenerOptions) => {
      if (type === 'beforeunload') {
        listeners.delete(listener);
        (window as unknown as Window & { __beforeUnloadCount: number }).__beforeUnloadCount = listeners.size;
      }
      remove(type, listener, options);
    }) as typeof window.removeEventListener;
  });
  await page.goto('/');
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await openTab(page, '1. Data & TOU Rates');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  const [download] = await Promise.all([
    page.waitForEvent('download'), page.getByRole('button', { name: 'Save Project' }).click(),
  ]);
  const savedPath = await download.path();
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();

  await openTab(page, '2. Battery Profiles');
  const capacity = page.getByLabel('Total storage capacity (kWh)');
  await capacity.fill('13');
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Window & { __beforeUnloadCount: number }).__beforeUnloadCount)).toBe(1);

  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('not-a-timezone');
  await openTab(page, '1. Data & TOU Rates');
  await page.getByRole('button', { name: 'Save Project' }).click();
  await expect(page.getByText(/Invalid project archive: project\.generationConfig\.site\.timeZone/i)).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await openTab(page, '1. Data & TOU Rates');
  await Promise.all([page.waitForEvent('download'), page.getByRole('button', { name: 'Save Project' }).click()]);
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();
  expect(await page.evaluate(() => (window as unknown as Window & { __beforeUnloadCount: number }).__beforeUnloadCount)).toBe(0);
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(false);

  await openTab(page, '2. Battery Profiles');
  await capacity.fill('14');
  await openTab(page, '1. Data & TOU Rates');
  const cancelOpenDialog = page.waitForEvent('dialog').then((dialog) => dialog.dismiss());
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles(savedPath!);
  await cancelOpenDialog;
  await expect(page.getByText(/Open canceled/i)).toBeVisible();
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await openTab(page, '2. Battery Profiles');
  await expect(capacity).toHaveValue('14');

  await openTab(page, '1. Data & TOU Rates');
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles({
    name: 'invalid.json', mimeType: 'application/json', buffer: Buffer.from('{ invalid'),
  });
  await expect(page.getByRole('alert')).toContainText(/not valid JSON/i);
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();
  await openTab(page, '2. Battery Profiles');
  await expect(capacity).toHaveValue('14');
  expect(await page.evaluate(() => {
    const event = new Event('beforeunload', { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  })).toBe(true);

  const acceptResetDialog = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await page.getByRole('button', { name: 'Reset all project data, including load and solar/wind resource files' }).click();
  await acceptResetDialog;
  await expect(page.getByText('Unsaved changes', { exact: true })).toBeVisible();

  const acceptReplacementDialog = page.waitForEvent('dialog').then((dialog) => dialog.accept());
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles(savedPath!);
  await acceptReplacementDialog;
  await expect(page.getByRole('status').filter({ hasText: /^Opened / })).toBeVisible();
  await expect(page.getByText('No unsaved changes', { exact: true })).toBeVisible();
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

test('imports exact measured solar intervals, shows period results, and exports the aligned run', async ({ page }) => {
  await page.goto('/');
  await openTab(page, '1. Data & TOU Rates');
  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name: 'measured-period-load.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
      '06/15/2025,12:00 PM,1,3,kWh',
      '06/15/2025,1:00 PM,1,3,kWh',
      '06/15/2025,2:00 PM,1,3,kWh',
    ].join('\n')),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Latitude (degrees north)').fill('37.7749');
  await page.getByLabel('Longitude (degrees east)').fill('-122.4194');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');
  await page.locator('button[title="Add Solar Array"]').click();
  await page.getByLabel('Nameplate DC capacity (kW DC)').fill('5');
  await page.getByLabel('Inverter AC capacity (kW AC)').fill('5');
  await page.locator('input[aria-label="Import measured resource CSV"]').setInputFiles({
    name: 'measured-period-solar.csv', mimeType: 'text/csv', buffer: Buffer.from([
      'timestamp,ghi_wm2,dni_wm2,dhi_wm2',
      '2025-06-15T12:00:00Z,600,450,150',
      '2025-06-15T13:00:00Z,800,600,200',
      '2025-06-15T14:00:00Z,300,225,75',
    ].join('\n')),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Loaded 3 intervals from measured-period-solar.csv' })).toBeVisible();
  await openTab(page, '5. Results & Analytics');
  await expect(page.getByText('Modeled Generation & Grid Dispatch Results')).toBeVisible({ timeout: 20_000 });
  await expect(page.getByText('Solar Generated', { exact: true }).locator('..')).toContainText(/kWh/);

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export Period Results (.json)' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('generation_period_results.json');
  const path = await download.path();
  const period = JSON.parse(await readFile(path!, 'utf8'));
  expect(period.analysis_scope).toBe('simulated_period');
  expect(period.period.interval_count).toBe(3);
  expect(period.results.total_solar_generation_kwh).toBeGreaterThan(0);
  expect(period.results.total_home_load_kwh).toBe(3);
});

test('runs and exports wind, generator, and mixed measured-resource projects at the configured tariff boundary', async ({ page }) => {
  const solar = {
    ...createDefaultSolarAsset('journey-solar'),
    name: 'Journey Solar', dcCapacityKw: 5, inverterAcCapacityKw: 5,
    resourceMode: 'weather_file' as const, externalResourceId: 'journey-solar-data',
  };
  const wind = {
    ...createDefaultWindAsset('journey-wind'),
    name: 'Journey Wind', enabled: true, ratedPowerKw: 5, hubHeightM: 20, measurementHeightM: 10,
    cutInWindSpeedMps: 3, ratedWindSpeedMps: 11, cutOutWindSpeedMps: 25,
    resourceMode: 'interval_file' as const, externalResourceId: 'journey-wind-data',
    powerCurve: [
      { windSpeedMps: 0, outputKw: 0 }, { windSpeedMps: 3, outputKw: 0 },
      { windSpeedMps: 7, outputKw: 2 }, { windSpeedMps: 11, outputKw: 5 },
      { windSpeedMps: 25, outputKw: 5 },
    ],
  };
  const generator = {
    ...createDefaultGeneratorAsset('journey-generator'),
    name: 'Journey Generator', enabled: true, ratedContinuousKw: 10, minimumStableLoadPercent: 20,
    fuelPricePerUnit: 3.5, variableMaintenanceCostPerHourUsd: 1,
    fuelCurve: [
      { loadPercent: 0, fuelUnitsPerHour: 0.2 }, { loadPercent: 20, fuelUnitsPerHour: 0.5 },
      { loadPercent: 100, fuelUnitsPerHour: 2 },
    ],
    dispatchMode: 'scheduled' as const,
    scheduledHours: Array.from({ length: 7 }, () => Array(24).fill(true)),
  };

  const scenarios = [
    { name: 'wind', assets: [wind], labels: ['Wind'] },
    { name: 'generator', assets: [generator], labels: ['Generator'] },
    { name: 'mixed', assets: [solar, wind, generator], labels: ['Solar', 'Wind', 'Generator'] },
  ];
  await page.goto('/');
  for (const scenario of scenarios) {
    await openTab(page, '1. Data & TOU Rates');
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles({
      name: `${scenario.name}-journey.json`, mimeType: 'application/json',
      buffer: await createGenerationJourneyArchive(scenario.assets),
    });
    await expect(page.getByRole('status').filter({ hasText: `Opened ${scenario.name}-journey.json` })).toBeVisible();
    await openTab(page, '5. Results & Analytics');
    await expect(page.getByText('Modeled Generation & Grid Dispatch Results')).toBeVisible({ timeout: 30_000 });
    for (const label of scenario.labels) await expect(page.getByText(label, { exact: true }).first()).toBeVisible();

    const [download] = await Promise.all([
      page.waitForEvent('download'),
      page.getByRole('button', { name: 'Export Period Results (.json)' }).click(),
    ]);
    const filePath = await download.path();
    const period = JSON.parse(await readFile(filePath!, 'utf8'));
    expect(period.results.total_home_load_kwh).toBe(24);
    expect(period.period.interval_count).toBe(24);
    const tariffRates = period.results.interval_results.map((interval: any) => interval.tariff.buyRate);
    expect(tariffRates[15]).not.toBe(tariffRates[16]);
    if (scenario.assets.some((asset) => asset.type === 'wind')) expect(period.results.total_wind_generation_kwh).toBeGreaterThan(0);
    if (scenario.assets.some((asset) => asset.type === 'solar')) expect(period.results.total_solar_generation_kwh).toBeGreaterThan(0);
    if (scenario.assets.some((asset) => asset.type === 'generator')) {
      expect(period.results.total_generator_generation_kwh).toBeGreaterThan(0);
      const operatingCost = period.results.interval_results.reduce((sum: number, interval: any) => sum + (interval.generator?.totalOperatingCostUsd ?? 0), 0);
      expect(operatingCost).toBeGreaterThan(0);
    }
  }
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
