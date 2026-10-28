import { expect, test } from '@playwright/test';
import { readFile } from 'node:fs/promises';

const singleFallBackCsv = [
  'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
  '11/02/2025,12:00 AM,1.25,20,kWh',
  '11/02/2025,1:00 AM,2.75,20,kWh',
  '11/02/2025,2:00 AM,3.5,20,kWh',
].join('\n');

test('guides a single fall-back row through correction and preserves provenance in a saved project', async ({ page }) => {
  await page.goto('/');
  await page.getByRole('button', { name: '3. Power Generation', exact: true }).last().click();
  await page.getByLabel('Site timezone (IANA)').fill('America/Detroit');
  await page.getByRole('button', { name: '1. Data & TOU Rates', exact: true }).last().click();

  await page.getByLabel('Upload interval load CSV').setInputFiles({
    name: 'dte-fall-back.csv', mimeType: 'text/csv', buffer: Buffer.from(singleFallBackCsv),
  });

  await expect(page.getByRole('heading', { name: 'Review dte-fall-back.csv' })).toBeVisible();
  await expect(page.getByText(/If UTC−04:00 .*surrounding rows leave 2025-11-02T06:00:00.000Z uncovered/)).toBeVisible();
  await expect(page.getByText(/If UTC−05:00 .*surrounding rows leave 2025-11-02T05:00:00.000Z uncovered/)).toBeVisible();
  await expect(page.getByLabel('Confirm the UTC occurrence for source row 3')).toBeVisible();
  await page.getByLabel('Confirm the UTC occurrence for source row 3').selectOption('2025-11-02T05:00:00.000Z');
  await expect(page.getByText(/No CSV row: 2025-11-02 01:00/)).toBeVisible();
  await page.getByLabel('Enter usage (kWh)').fill('2.9');
  await page.getByRole('button', { name: 'Validate and accept corrected data' }).click();

  await expect(page.getByText('Interval Dataset Ready for Simulation')).toBeVisible();
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Save Project' }).click();
  const download = await downloadPromise;
  const saved = JSON.parse(await readFile(await download.path(), 'utf8')) as {
    schemaVersion: number;
    project: { loadData: { csv: string; resolvedCsv: string; importProvenance: { timeAssignments: unknown[]; corrections: unknown[] } } };
  };

  expect(saved.schemaVersion).toBe(3);
  expect(saved.project.loadData.csv).toBe(singleFallBackCsv);
  expect(saved.project.loadData.resolvedCsv).toContain('2025-11-02T05:00:00.000Z,2.75');
  expect(saved.project.loadData.resolvedCsv).toContain('2025-11-02T06:00:00.000Z,2.9');
  expect(saved.project.loadData.importProvenance.timeAssignments).toHaveLength(1);
  expect(saved.project.loadData.importProvenance.corrections).toHaveLength(1);

  page.once('dialog', (dialog) => dialog.accept());
  await page.getByLabel('Choose a VoltWise project JSON file').setInputFiles({
    name: 'dte-corrected.json', mimeType: 'application/json', buffer: await readFile(await download.path()),
  });
  await expect(page.getByRole('status').filter({ hasText: 'Opened dte-corrected.json.' })).toBeVisible();
  await expect(page.getByText('Interval Dataset Ready for Simulation')).toBeVisible();
});
