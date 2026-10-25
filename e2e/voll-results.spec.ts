import { expect, test, Page } from '@playwright/test';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_TOU_PROFILES,
} from '../src/utils/simulationEngine';
import { createDefaultGenerationConfig, createDefaultSolarAsset } from '../src/utils/generationDefaults';
import { serializeProjectArchive } from '../src/utils/projectArchive';
import type { ProjectArchiveState } from '../src/types/energy';

type FinancialValues = {
  npv: number;
  lifetimeProfit: number;
  roi: number;
};

type VollResults = {
  base: FinancialValues;
  companion: FinancialValues;
};

type WorkerRequestCounts = {
  run: number;
  projectionYear: number;
};

type VollPropagationResult = {
  excluded: VollResults;
  included: VollResults;
  disabledAgain: VollResults;
  workerBaseline?: WorkerRequestCounts;
};

declare global {
  interface Window {
    __voltwiseWorkerRequestCounts: WorkerRequestCounts;
  }
}

async function installWorkerRequestInstrumentation(page: Page) {
  await page.addInitScript(() => {
    const counts: WorkerRequestCounts = { run: 0, projectionYear: 0 };
    Object.defineProperty(window, '__voltwiseWorkerRequestCounts', { value: counts });

    const nativePostMessage = Worker.prototype.postMessage;
    Worker.prototype.postMessage = new Proxy(nativePostMessage, {
      apply(target, worker, args) {
        const result = Reflect.apply(target, worker, args);
        const message = args[0];
        if (message !== null && typeof message === 'object') {
          const type = Reflect.get(message, 'type');
          if (type === 'run') counts.run += 1;
          if (type === 'projection-year') counts.projectionYear += 1;
        }
        return result;
      },
    });
  });
}

async function readWorkerRequestCounts(page: Page): Promise<WorkerRequestCounts> {
  return page.evaluate(() => ({ ...window.__voltwiseWorkerRequestCounts }));
}

async function expectWorkerRequestCounts(
  page: Page,
  expected: WorkerRequestCounts,
  phase: string
) {
  const counts = await readWorkerRequestCounts(page);
  expect(counts, `${phase}: simulation worker requests changed from baseline`).toEqual(expected);
  console.info(`[VOLL E2E] ${phase}: run=${counts.run}, projection-year=${counts.projectionYear}`);
}

async function waitForInitialSimulationToSettle(page: Page) {
  await expect.poll(async () => {
    const counts = await readWorkerRequestCounts(page);
    const pending = await page.getByRole('status').filter({ hasText: 'Updating simulation in the background' }).count();
    return counts.run > 0 && pending === 0;
  }, {
    message: 'Initial application simulation should finish before importing the generation fixture.',
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toBe(true);
}

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

type GenerationFinancialReadiness = {
  state: 'initializing' | 'projecting' | 'ready' | 'financial-pending' | 'simulation-error' | 'unexpected-results';
  evidence: string;
};

async function readGenerationFinancialReadiness(page: Page): Promise<GenerationFinancialReadiness> {
  const mainText = (await page.locator('main').innerText()).replace(/\s+/g, ' ').trim();
  const simulationError = await page.getByRole('alert').allTextContents();
  if (simulationError.length > 0) {
    return { state: 'simulation-error', evidence: simulationError.join(' ').replace(/\s+/g, ' ').trim() };
  }

  const progress = await page.getByRole('status').allTextContents();
  const progressText = progress.join(' ').replace(/\s+/g, ' ').trim();
  if (progressText.includes('Updating simulation in the background') || mainText.includes('Running full-year dispatch simulation')) {
    return { state: 'projecting', evidence: progressText || mainText.slice(-500) };
  }

  if (mainText.includes('Lifecycle Finance Unavailable') || mainText.includes('Multi-year lifecycle financial modeling is unavailable')) {
    return { state: 'financial-pending', evidence: mainText.slice(-1_200) };
  }

  if (mainText.includes('VOLL inclusion setting in Financial Settings:')) {
    const generationMarker = await page.getByText('Modeled Generation & Grid Dispatch Results').count();
    const annualProjectionMarker = await page.getByText(/Annual modeled projections:/).count();
    if (generationMarker === 0 || annualProjectionMarker === 0) {
      return {
        state: 'unexpected-results',
        evidence: `VOLL disclosure rendered outside generation lifecycle Results (generation marker count ${generationMarker}, annual projection marker count ${annualProjectionMarker}): ${mainText.slice(-1_200)}`,
      };
    }
    return { state: 'ready', evidence: 'VOLL financial disclosure is visible.' };
  }

  if (
    mainText.includes('Modeled Generation & Grid Dispatch Results') ||
    mainText.includes('Base 25-year results') ||
    mainText.includes('Please upload interval data or select a preset battery profile')
  ) {
    return { state: 'unexpected-results', evidence: `Unexpected or incomplete Results mode: ${mainText.slice(-1_200)}` };
  }

  return { state: 'initializing', evidence: mainText.slice(-1_200) };
}

async function waitForGenerationFinancialReadiness(page: Page, phase: string) {
  const startedAt = Date.now();
  await test.step(phase, async () => {
    await expect.poll(
      async () => {
        const readiness = await readGenerationFinancialReadiness(page);
        const working = readiness.state === 'projecting' || readiness.state === 'initializing';
        return { state: working ? 'working' : readiness.state, evidence: readiness.evidence };
      },
      {
        message: `${phase}: generation-aware Results must reach a terminal financial-results state.`,
        timeout: 120_000,
        intervals: [250, 500, 1_000],
      }
    ).not.toMatchObject({ state: 'working' });

    const readiness = await readGenerationFinancialReadiness(page);
    expect(readiness.state, `${phase}: Results did not reach financial readiness: ${JSON.stringify(readiness)}`).toBe('ready');
  });
  const elapsedSeconds = (Date.now() - startedAt) / 1_000;
  console.info(`[VOLL E2E] ${phase}: ${elapsedSeconds.toFixed(1)}s`);
  return elapsedSeconds;
}

async function expectVollSetting(page: Page, included: boolean) {
  await expect(page.getByText('VOLL inclusion setting in Financial Settings:')).toBeVisible();
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
  const startedAt = Date.now();
  await openTab(page, '4. Financials & Settings');
  await configureNonzeroVollInputs(page);

  const current = page.getByRole('button', {
    name: include ? /VOLL Excluded from Financial Results/ : /VOLL Included in Financial Results/,
  });
  await expect(current).toBeVisible();
  await current.click();

  await openTab(page, '5. Results & Analytics');
  if (generationAware) {
    await waitForGenerationFinancialReadiness(
      page,
      include ? 'VOLL-enabled financial readiness' : 'VOLL-disabled financial readiness'
    );
  }
  await expectVollSetting(page, include);
  await expectResultsPath(page, generationAware);
  const results = await readDisplayedResults(page);
  console.info(`[VOLL E2E] VOLL-${include ? 'enabled' : 'disabled'} Results update: ${((Date.now() - startedAt) / 1_000).toFixed(1)}s`);
  return results;
}

async function exerciseVollPropagation(
  page: Page,
  generationAware: boolean,
  workerCountsBeforeProjectImport?: WorkerRequestCounts
): Promise<VollPropagationResult> {
  await openTab(page, '5. Results & Analytics');
  if (generationAware) await waitForGenerationFinancialReadiness(page, 'Initial financial readiness');
  await expectVollSetting(page, false);
  await expectResultsPath(page, generationAware);
  const excluded = await readDisplayedResults(page);
  expect(excluded.companion).toEqual(excluded.base);

  let workerBaseline: WorkerRequestCounts | undefined;
  if (generationAware) {
    workerBaseline = await readWorkerRequestCounts(page);
    expect(workerBaseline.run - (workerCountsBeforeProjectImport?.run ?? 0),
      `Generation baseline should add one run request; before import=${JSON.stringify(workerCountsBeforeProjectImport)}, after readiness=${JSON.stringify(workerBaseline)}`
    ).toBe(1);
    expect(workerBaseline.projectionYear - (workerCountsBeforeProjectImport?.projectionYear ?? 0),
      `Generation baseline should add 25 projection requests; before import=${JSON.stringify(workerCountsBeforeProjectImport)}, after readiness=${JSON.stringify(workerBaseline)}`
    ).toBe(25);
    console.info(`[VOLL E2E] Completed generation baseline: run=${workerBaseline.run}, projection-year=${workerBaseline.projectionYear}`);
  }

  const included = await toggleVollAndReadResults(page, true, generationAware);
  expect(included.base).toEqual(excluded.base);
  expect(included.companion.npv).toBeGreaterThan(included.base.npv);
  expect(included.companion.lifetimeProfit).toBeGreaterThan(included.base.lifetimeProfit);
  expect(included.companion.roi).toBeGreaterThan(included.base.roi);
  expect(included.companion.npv).not.toBe(excluded.companion.npv);
  expect(included.companion.lifetimeProfit).not.toBe(excluded.companion.lifetimeProfit);
  expect(included.companion.roi).not.toBe(excluded.companion.roi);
  if (workerBaseline) await expectWorkerRequestCounts(page, workerBaseline, 'VOLL enabled');

  const disabledAgain = await toggleVollAndReadResults(page, false, generationAware);
  expect(disabledAgain.base).toEqual(excluded.base);
  expect(disabledAgain.companion).toEqual(disabledAgain.base);
  if (workerBaseline) await expectWorkerRequestCounts(page, workerBaseline, 'VOLL disabled');

  return { excluded, included, disabledAgain, workerBaseline };
}

async function changeRangeByKeyboard(
  page: Page,
  label: string,
  expectedBefore: string,
  arrowSteps: number,
  expectedAfter: string
) {
  const slider = page.getByLabel(label, { exact: true });
  await expect(slider).toHaveValue(expectedBefore);
  await slider.focus();
  for (let step = 0; step < arrowSteps; step += 1) await slider.press('ArrowRight');
  await expect(slider).toHaveValue(expectedAfter);
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
  test.setTimeout(420_000);
  const profile = DEFAULT_BATTERY_PROFILES[0];
  const tou = DEFAULT_TOU_PROFILES[0];
  const generationConfig = createDefaultGenerationConfig();
  generationConfig.site = { latitude: 37.77, longitude: -122.4, elevationM: 0, timeZone: 'UTC' };
  const solar = createDefaultSolarAsset('voll-results-solar', 'VOLL Results Solar');
  solar.dcCapacityKw = 5;
  solar.inverterAcCapacityKw = 5;
  solar.installedCostUsd = 5_000;
  solar.monthlyPeakSunHoursPerDay = Array(12).fill(4.5);
  generationConfig.assets = [solar];

  const loadDataCsv = [
    'timestamp,usage_kwh',
    ...Array.from({ length: 8_760 }, (_, hour) => `${new Date(Date.UTC(2025, 0, 1, hour)).toISOString()},1`),
  ].join('\n');
  const project: ProjectArchiveState = {
    profiles: [profile],
    activeProfileId: profile.id,
    touProfiles: [tou],
    activeTouProfileId: tou.id,
    tiers: tou.tiers,
    scheduleMatrix: tou.scheduleMatrix,
    generationConfig,
    allowSolarExport: false,
    financials: {
      ...DEFAULT_MACRO_FINANCIALS,
      annualOutageDays: 2.5,
      valueOfLostLoadPerDay: 100,
      includeVollInRoi: false,
    },
    loadDataCsv,
    loadDataSource: 'uploaded',
  };
  const projectArchive = Buffer.from(await serializeProjectArchive(project).arrayBuffer());

  await installWorkerRequestInstrumentation(page);
  let mainFrameNavigations = 0;
  page.on('framenavigated', (frame) => {
    if (frame === page.mainFrame()) mainFrameNavigations += 1;
  });
  await page.goto('/');
  await waitForInitialSimulationToSettle(page);
  const workerCountsBeforeProjectImport = await readWorkerRequestCounts(page);
  const appNavigationBaseline = mainFrameNavigations;
  await openTab(page, '1. Data & TOU Rates');
  page.once('dialog', (dialog) => dialog.accept());
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles({
    name: 'voll-generation-fixture.json',
    mimeType: 'application/json',
    buffer: projectArchive,
  });
  await expect(page.getByRole('status').filter({ hasText: 'Opened voll-generation-fixture.json' })).toBeVisible();

  await openTab(page, '4. Financials & Settings');
  await configureNonzeroVollInputs(page);
  await expect(page.getByRole('button', { name: 'VOLL Excluded from Financial Results', exact: true })).toBeVisible();

  const propagation = await exerciseVollPropagation(page, true, workerCountsBeforeProjectImport);
  const workerBaseline = propagation.workerBaseline;
  expect(workerBaseline).toBeDefined();

  await openTab(page, '4. Financials & Settings');
  const outageChangeStartedAt = Date.now();
  await changeRangeByKeyboard(page, 'Outage days per year (days)', '2.5', 3, '4');
  await expect(page.getByText('$400/yr', { exact: true })).toBeVisible();
  await expect(page.getByText('$10,000', { exact: true })).toBeVisible();
  await openTab(page, '5. Results & Analytics');
  await waitForGenerationFinancialReadiness(page, 'Outage-days recalculation readiness');
  await expect(page.getByText('+$400/yr', { exact: true })).toBeVisible();
  await expect(page.getByText('+$10,000', { exact: true })).toBeVisible();
  const afterOutageChange = await readDisplayedResults(page);
  expect(afterOutageChange.base).toEqual(propagation.excluded.base);
  expect(afterOutageChange.companion).toEqual(afterOutageChange.base);
  await expectWorkerRequestCounts(page, workerBaseline!, 'Outage days changed');
  console.info(`[VOLL E2E] Outage-days Results update: ${((Date.now() - outageChangeStartedAt) / 1_000).toFixed(1)}s`);

  await openTab(page, '4. Financials & Settings');
  const valueChangeStartedAt = Date.now();
  await changeRangeByKeyboard(page, 'Value of lost load (US dollars per day)', '100', 4, '200');
  await expect(page.getByText('$800/yr', { exact: true })).toBeVisible();
  await expect(page.getByText('$20,000', { exact: true })).toBeVisible();
  await openTab(page, '5. Results & Analytics');
  await waitForGenerationFinancialReadiness(page, 'VOLL-rate recalculation readiness');
  await expect(page.getByText('+$800/yr', { exact: true })).toBeVisible();
  await expect(page.getByText('+$20,000', { exact: true })).toBeVisible();
  const afterValueChange = await readDisplayedResults(page);
  expect(afterValueChange.base).toEqual(propagation.excluded.base);
  expect(afterValueChange.companion).toEqual(afterValueChange.base);
  await expectWorkerRequestCounts(page, workerBaseline!, 'VOLL rate changed');
  console.info(`[VOLL E2E] VOLL-rate Results update: ${((Date.now() - valueChangeStartedAt) / 1_000).toFixed(1)}s`);

  const includedWithUpdatedAssumptions = await toggleVollAndReadResults(page, true, true);
  expect(includedWithUpdatedAssumptions.base).toEqual(propagation.excluded.base);
  expect(includedWithUpdatedAssumptions.companion.npv).toBeGreaterThan(propagation.included.companion.npv);
  expect(includedWithUpdatedAssumptions.companion.lifetimeProfit).toBeGreaterThan(propagation.included.companion.lifetimeProfit);
  expect(includedWithUpdatedAssumptions.companion.roi).toBeGreaterThan(propagation.included.companion.roi);
  await expectVollSetting(page, true);
  await expectWorkerRequestCounts(page, workerBaseline!, 'VOLL re-enabled with updated assumptions');
  expect(mainFrameNavigations).toBe(appNavigationBaseline);
});
