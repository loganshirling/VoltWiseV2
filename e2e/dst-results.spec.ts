import { expect, test, Page } from '@playwright/test';

const QUARTER_HOUR_MS = 15 * 60 * 1_000;

type DailyFixture = {
  intervalCount: number;
  loadKwhPerInterval: number;
};

async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).last().click();
}

function createQuarterHourLoadCsv(startUtc: string, days: DailyFixture[]): string {
  const startMs = Date.parse(startUtc);
  expect(Number.isFinite(startMs), `Invalid UTC fixture start: ${startUtc}`).toBe(true);

  const rows = ['timestamp,usage_kwh'];
  let intervalIndex = 0;
  for (const day of days) {
    for (let index = 0; index < day.intervalCount; index += 1) {
      const timestamp = new Date(startMs + intervalIndex * QUARTER_HOUR_MS).toISOString();
      rows.push(`${timestamp},${day.loadKwhPerInterval.toFixed(2)}`);
      intervalIndex += 1;
    }
  }
  return rows.join('\n');
}

async function importPartialPeriod(page: Page, name: string, csv: string) {
  await page.goto('/');
  await openTab(page, '3. Power Generation');
  await page.getByLabel('Site timezone (IANA)').fill('America/Los_Angeles');
  await openTab(page, '1. Data & TOU Rates');
  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name,
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Uploaded load data.' })).toBeVisible();
  await expect(page.getByText('Interval Dataset Ready for Simulation')).toBeVisible();
  await openTab(page, '5. Results & Analytics');
  await expect(page.getByText('Partial-Period Savings')).toBeVisible();
  await expect(page.getByText('Multi-profile multi-year financial matrix is disabled for partial-period datasets.')).toBeVisible();
}

async function selectMedianDay(page: Page, month: string, expectedMedianLoadKwh: number, expectedDate: string, dayPosition: number) {
  await page.getByRole('button', { name: 'Median Daily by Month' }).click();
  const monthlyTable = page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: 'Median Daily Load', exact: true }),
  });
  const monthRow = monthlyTable.getByRole('row').filter({ hasText: month });
  await expect(monthRow).toHaveCount(1);
  await expect(monthRow.locator('td').nth(3)).toHaveText(`${expectedMedianLoadKwh.toFixed(2)} kWh`);
  await monthRow.getByRole('button', { name: 'Inspect day', exact: true }).click();
  await expect(page.getByText(`${expectedDate} (Day ${dayPosition} of 3)`, { exact: true })).toBeVisible();
}

function getIntervalTable(page: Page) {
  return page.getByRole('table').filter({
    has: page.getByRole('columnheader', { name: 'Local Timestamp', exact: true }),
  });
}

function sumDisplayedKwh(values: string[]): number {
  return values.reduce((sum, value) => {
    const match = value.match(/([+-]?[\d,]+(?:\.\d+)?)\s*kWh/);
    return sum + (match ? Number(match[1].replaceAll(',', '')) : 0);
  }, 0);
}

async function readDailyBatteryTotals(page: Page) {
  const dayTotals = page.getByText(/Day Total Charged:/);
  await expect(dayTotals).toBeVisible();
  const totalsText = await dayTotals.textContent() ?? '';
  const charged = Number(totalsText.match(/Day Total Charged:\s*([\d.]+)/)?.[1]);
  const discharged = Number(totalsText.match(/Day Total Discharged:\s*([\d.]+)/)?.[1]);
  return { charged, discharged };
}

async function assertDailyEnergyReconciliation(
  page: Page,
  expectedHomeLoadKwh: number,
  intervalCount: number,
  dailyTotals: { charged: number; discharged: number }
) {
  const table = getIntervalTable(page);
  await expect(table).toBeVisible();
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(intervalCount);
  const homeLoads = await rows.locator('td:nth-child(3)').allTextContents();
  expect(sumDisplayedKwh(homeLoads)).toBeCloseTo(expectedHomeLoadKwh, 2);

  const actions = await rows.locator('td:nth-child(4)').allTextContents();
  const rowCharge = actions.reduce((sum, action) => {
    const match = action.match(/\+([\d,]+(?:\.\d+)?)\s*kWh/);
    return sum + (match ? Number(match[1].replaceAll(',', '')) : 0);
  }, 0);
  const rowDischarge = actions.reduce((sum, action) => {
    const match = action.match(/-([\d,]+(?:\.\d+)?)\s*kWh/);
    return sum + (match ? Number(match[1].replaceAll(',', '')) : 0);
  }, 0);
  // Table actions round each interval to 0.01 kWh; Daily Profile rounds the sum to 0.1 kWh.
  const roundingToleranceKwh = intervalCount * 0.005 + 0.05 + Number.EPSILON;
  expect(Math.abs(rowCharge - dailyTotals.charged)).toBeLessThanOrEqual(roundingToleranceKwh);
  expect(Math.abs(rowDischarge - dailyTotals.discharged)).toBeLessThanOrEqual(roundingToleranceKwh);
}

async function selectSeasonalDay(page: Page, preset: string, date: string, dayPosition: number, intervalCount: number, expectedHomeLoadKwh: number) {
  await page.getByRole('button', { name: 'Daily Profile', exact: true }).click();
  await page.getByRole('button', { name: preset, exact: true }).click();
  await expect(page.getByText(`${date} (Day ${dayPosition} of 3)`, { exact: true })).toBeVisible();
  await page.getByRole('button', { name: 'Table View', exact: true }).click();
  const table = getIntervalTable(page);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(intervalCount);
  expect(sumDisplayedKwh(await rows.locator('td:nth-child(3)').allTextContents())).toBeCloseTo(expectedHomeLoadKwh, 2);
}

test('spring-forward Results navigate the 23-hour observed day and reconcile its intervals', async ({ page }) => {
  const csv = createQuarterHourLoadCsv('2024-03-09T08:00:00.000Z', [
    { intervalCount: 96, loadKwhPerInterval: 0.10 },
    { intervalCount: 92, loadKwhPerInterval: 0.25 },
    { intervalCount: 96, loadKwhPerInterval: 0.50 },
  ]);
  expect(csv.split('\n')).toHaveLength(285);

  await importPartialPeriod(page, 'spring-forward-2024.csv', csv);
  await selectMedianDay(page, 'March', 23, '2024-03-10', 2);
  const dailyTotals = await readDailyBatteryTotals(page);
  await page.getByRole('button', { name: 'Table View', exact: true }).click();

  const table = getIntervalTable(page);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(92);
  const timestamps = await rows.locator('td:first-child').allTextContents();
  expect(timestamps[0]).toContain('2024-03-10 12:00 AM');
  expect(timestamps[7]).toContain('1:45 AM');
  expect(timestamps[8]).toContain('3:00 AM');
  expect(timestamps.some((timestamp) => /2024-03-10 2:\d\d AM/.test(timestamp))).toBe(false);
  expect(sumDisplayedKwh(await rows.locator('td:nth-child(3)').allTextContents())).toBeCloseTo(23, 2);
  await assertDailyEnergyReconciliation(page, 23, 92, dailyTotals);

  await selectSeasonalDay(page, 'Spring Equinox', '2024-03-11', 3, 96, 48);
});

test('fall-back Results preserve both 1 AM hours and navigate the 25-hour observed day', async ({ page }) => {
  const csv = createQuarterHourLoadCsv('2024-11-02T07:00:00.000Z', [
    { intervalCount: 96, loadKwhPerInterval: 0.20 },
    { intervalCount: 100, loadKwhPerInterval: 0.25 },
    { intervalCount: 96, loadKwhPerInterval: 0.50 },
  ]);
  expect(csv.split('\n')).toHaveLength(293);

  await importPartialPeriod(page, 'fall-back-2024.csv', csv);
  await selectMedianDay(page, 'November', 25, '2024-11-03', 2);
  const dailyTotals = await readDailyBatteryTotals(page);
  await page.getByRole('button', { name: 'Table View', exact: true }).click();

  const table = getIntervalTable(page);
  const rows = table.locator('tbody tr');
  await expect(rows).toHaveCount(100);
  const timestamps = await rows.locator('td:first-child').allTextContents();
  expect(timestamps.filter((timestamp) => timestamp === '2024-11-03 1:15 AM PDT')).toHaveLength(1);
  expect(timestamps.filter((timestamp) => timestamp === '2024-11-03 1:15 AM PST')).toHaveLength(1);
  expect(timestamps.slice(4, 13)).toEqual([
    '2024-11-03 1:00 AM PDT',
    '2024-11-03 1:15 AM PDT',
    '2024-11-03 1:30 AM PDT',
    '2024-11-03 1:45 AM PDT',
    '2024-11-03 1:00 AM PST',
    '2024-11-03 1:15 AM PST',
    '2024-11-03 1:30 AM PST',
    '2024-11-03 1:45 AM PST',
    '2024-11-03 2:00 AM',
  ]);
  expect(sumDisplayedKwh(await rows.locator('td:nth-child(3)').allTextContents())).toBeCloseTo(25, 2);
  await assertDailyEnergyReconciliation(page, 25, 100, dailyTotals);

  await selectSeasonalDay(page, 'Autumn Evening', '2024-11-02', 1, 96, 19.2);
});
