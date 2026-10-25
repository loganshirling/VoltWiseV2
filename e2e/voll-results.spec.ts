import { expect, test, Page } from '@playwright/test';

type FinancialValues = {
  npv: number;
  lifetimeProfit: number;
  roi: number;
};

type VollResults = {
  base: FinancialValues;
  companion: FinancialValues;
};

async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).last().click();
}

function parseFinancialValues(text: string | null): FinancialValues {
  expect(text).not.toBeNull();
  const match = text!.match(
    /NPV ([+-])\$([\d,]+(?:\.\d+)?), lifetime profit ([+-])\$([\d,]+(?:\.\d+)?), ROI (-?[\d.]+)%/
  );
  expect(match, `Expected displayed NPV, profit, and ROI in: ${text}`).not.toBeNull();

  const signedAmount = (sign: string, amount: string) =>
    (sign === '-' ? -1 : 1) * Number(amount.replaceAll(',', ''));

  return {
    npv: signedAmount(match![1], match![2]),
    lifetimeProfit: signedAmount(match![3], match![4]),
    roi: Number(match![5]),
  };
}

async function readDisplayedResults(page: Page): Promise<VollResults> {
  const base = page.locator('p').filter({ hasText: /^Base 25-year results \(exclude VOLL\):/ });
  const companion = page.locator('p').filter({ hasText: /companion results.*NPV/ });
  await expect(base).toHaveCount(1);
  await expect(companion).toHaveCount(1);

  return {
    base: parseFinancialValues(await base.textContent()),
    companion: parseFinancialValues(await companion.textContent()),
  };
}

async function expectVollSetting(page: Page, included: boolean) {
  await expect(page.getByText('VOLL inclusion setting in Financial Settings:')).toBeVisible({ timeout: 120_000 });
  await expect(page.getByText(included ? 'Included' : 'Excluded', { exact: true })).toBeVisible();
  await expect(page.getByText('Assumed Annual VOLL:', { exact: true })).toBeVisible();
  await expect(page.getByText('Illustrative 25-Year Cumulative VOLL:', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: /VOLL (Excluded|Included) from Financial Results/ })).toHaveCount(0);
}

async function expectResultsPath(page: Page, generationAware: boolean) {
  if (generationAware) {
    await expect(page.getByText('Modeled Generation & Grid Dispatch Results')).toBeVisible();
    await expect(page.getByText(/Annual modeled projections:/)).toBeVisible();
  } else {
    await expect(page.getByText('Modeled Generation & Grid Dispatch Results')).toHaveCount(0);
    await expect(page.getByText(/Annual modeled projections:/)).toHaveCount(0);
  }
}

async function configureNonzeroVollInputs(page: Page) {
  const outageDays = Number(await page.getByLabel('Outage days per year (days)').inputValue());
  const valueOfLostLoad = Number(await page.getByLabel('Value of lost load (US dollars per day)').inputValue());
  expect(outageDays).toBeGreaterThan(0);
  expect(valueOfLostLoad).toBeGreaterThan(0);
}

async function toggleVollAndReadResults(page: Page, include: boolean, generationAware: boolean) {
  await openTab(page, '4. Financials & Settings');
  await configureNonzeroVollInputs(page);

  const current = page.getByRole('button', {
    name: include ? /VOLL Excluded from Financial Results/ : /VOLL Included in Financial Results/,
  });
  await expect(current).toBeVisible();
  await current.click();

  await openTab(page, '5. Results & Analytics');
  await expectVollSetting(page, include);
  await expectResultsPath(page, generationAware);
  return readDisplayedResults(page);
}

async function exerciseVollPropagation(page: Page, generationAware: boolean) {
  await openTab(page, '5. Results & Analytics');
  await expectVollSetting(page, false);
  await expectResultsPath(page, generationAware);
  const excluded = await readDisplayedResults(page);
  expect(excluded.companion).toEqual(excluded.base);

  const included = await toggleVollAndReadResults(page, true, generationAware);
  expect(included.base).toEqual(excluded.base);
  expect(included.companion.npv).toBeGreaterThan(included.base.npv);
  expect(included.companion.lifetimeProfit).toBeGreaterThan(included.base.lifetimeProfit);
  expect(included.companion.roi).toBeGreaterThan(included.base.roi);
  expect(included.companion.npv).not.toBe(excluded.companion.npv);
  expect(included.companion.lifetimeProfit).not.toBe(excluded.companion.lifetimeProfit);
  expect(included.companion.roi).not.toBe(excluded.companion.roi);

  const disabledAgain = await toggleVollAndReadResults(page, false, generationAware);
  expect(disabledAgain.base).toEqual(excluded.base);
  expect(disabledAgain.companion).toEqual(disabledAgain.base);
}

test('VOLL Financial Settings toggle propagates through battery-only Results without refresh', async ({ page }) => {
  await page.goto('/');
  await openTab(page, '3. Power Generation');
  await expect(page.getByText('Configured Assets (0)')).toBeVisible();
  await page.getByLabel('Site timezone (IANA)').fill('UTC');

  await openTab(page, '4. Financials & Settings');
  await configureNonzeroVollInputs(page);
  await expect(page.getByRole('button', { name: 'VOLL Excluded from Financial Results', exact: true })).toBeVisible();

  await exerciseVollPropagation(page, false);
});

test('VOLL Financial Settings toggle propagates through generation-aware Results without refresh', async ({ page }) => {
  test.setTimeout(180_000);
  await page.goto('/');
  await openTab(page, '3. Power Generation');
  await page.locator('button[title="Add Solar Array"]').click();
  await expect(page.locator('input[type="checkbox"][aria-label$=" enabled"]')).toBeChecked();
  await page.getByLabel('Nameplate DC capacity (kW DC)').fill('5');
  await page.getByLabel('Inverter AC capacity (kW AC)').fill('5');
  for (const month of [
    'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
    'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
  ]) {
    await page.getByLabel(`${month} peak sun hours per day`).fill('5');
  }
  await page.getByLabel('Latitude (degrees north)').fill('37.77');
  await page.getByLabel('Longitude (degrees east)').fill('-122.4');
  await page.getByLabel('Site timezone (IANA)').fill('UTC');

  await openTab(page, '4. Financials & Settings');
  await configureNonzeroVollInputs(page);
  await expect(page.getByRole('button', { name: 'VOLL Excluded from Financial Results', exact: true })).toBeVisible();

  await exerciseVollPropagation(page, true);
});
