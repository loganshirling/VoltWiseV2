import { readFile } from 'node:fs/promises';
import { expect, test, type Page, type TestInfo } from '@playwright/test';
import { createMaximumLeapYearProjectArchive } from './helpers/maximumLeapYearProject';
import {
  PERFORMANCE_EXPORT_HORIZON_YEARS,
  selectPerformanceExportHorizon,
} from './helpers/performanceExportHorizon';
import {
  classifyPerformanceReadiness,
  classifyPerformanceWorkerCompletion,
  getPerformanceUiCoverageStatus,
  measurePerformanceNavigationSequence,
  returnToResultsForReadiness,
  type PerformanceNavigationSnapshot,
  type PerformanceReadinessState,
} from './helpers/performanceNavigationActions';

type WorkerMessageRecord = {
  type: string;
  requestId: number | null;
  year?: number;
  at: number;
};

type HeapSample = { at: number; usedBytes: number };

type BrowserPerformanceLog = {
  requests: WorkerMessageRecord[];
  responses: WorkerMessageRecord[];
  heapSamples: HeapSample[];
  unhandledRejections: string[];
  alerts: string[];
};

declare global {
  interface Window {
    __voltwisePerformanceLog: BrowserPerformanceLog;
    __voltwisePerformanceHeapTimer: number;
  }
}

type WorkerBaseline = { requests: number; responses: number };

type ProjectSnapshot = Omit<
  PerformanceNavigationSnapshot,
  'runRequests' | 'runSuccesses' | 'projectionRequests' | 'projectionResponses' | 'workerErrors'
> & {
  at: number;
  runRequests: WorkerMessageRecord[];
  runSuccesses: WorkerMessageRecord[];
  projectionRequests: WorkerMessageRecord[];
  projectionResponses: WorkerMessageRecord[];
  workerErrors: WorkerMessageRecord[];
  workerComplete: boolean;
  state: PerformanceReadinessState;
};

async function openTab(page: Page, name: string) {
  await page.getByRole('button', { name, exact: true }).last().click({ timeout: 10_000 });
}

async function installPerformanceInstrumentation(page: Page) {
  await page.addInitScript(() => {
    const log: BrowserPerformanceLog = {
      requests: [], responses: [], heapSamples: [], unhandledRejections: [], alerts: [],
    };
    Object.defineProperty(window, '__voltwisePerformanceLog', { value: log });

    const nativePostMessage = Worker.prototype.postMessage;
    const observedWorkers = new WeakSet<Worker>();
    const workerRequestIds = new WeakMap<Worker, number | null>();
    Worker.prototype.postMessage = new Proxy(nativePostMessage, {
      apply(target, worker, args) {
        const currentWorker = worker as Worker;
        const message = args[0];
        if (message !== null && typeof message === 'object') {
          const type = Reflect.get(message, 'type');
          const requestId = typeof Reflect.get(message, 'requestId') === 'number' ? Reflect.get(message, 'requestId') : null;
          workerRequestIds.set(currentWorker, requestId);
          if (typeof type === 'string') {
            log.requests.push({
              type,
              requestId,
              year: typeof Reflect.get(message, 'year') === 'number' ? Reflect.get(message, 'year') : undefined,
              at: performance.now(),
            });
          }
        }

        if (!observedWorkers.has(currentWorker)) {
          observedWorkers.add(currentWorker);
          currentWorker.addEventListener('message', (event: MessageEvent<unknown>) => {
            const response = event.data;
            if (response === null || typeof response !== 'object') return;
            const type = Reflect.get(response, 'type');
            if (typeof type !== 'string') return;
            log.responses.push({
              type,
              requestId: typeof Reflect.get(response, 'requestId') === 'number'
                ? Reflect.get(response, 'requestId')
                : workerRequestIds.get(currentWorker) ?? null,
              year: typeof Reflect.get(response, 'year') === 'number' ? Reflect.get(response, 'year') : undefined,
              at: performance.now(),
            });
          });
        }
        return Reflect.apply(target, worker, args);
      },
    });

    window.addEventListener('unhandledrejection', (event) => {
      log.unhandledRejections.push(String(event.reason instanceof Error ? event.reason.message : event.reason));
    });
    window.__voltwisePerformanceHeapTimer = window.setInterval(() => {
      const usedBytes = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize;
      if (typeof usedBytes === 'number') log.heapSamples.push({ at: performance.now(), usedBytes });
    }, 50);
  });
}

async function readLog(page: Page): Promise<BrowserPerformanceLog> {
  return page.evaluate(() => ({
    requests: [...window.__voltwisePerformanceLog.requests],
    responses: [...window.__voltwisePerformanceLog.responses],
    heapSamples: [...window.__voltwisePerformanceLog.heapSamples],
    unhandledRejections: [...window.__voltwisePerformanceLog.unhandledRejections],
    alerts: [...document.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent?.replace(/\s+/g, ' ').trim() ?? ''),
  }));
}

async function readProjectSnapshot(page: Page, baseline: WorkerBaseline): Promise<ProjectSnapshot> {
  const snapshot = await page.evaluate(({ requestsAt, responsesAt }) => {
    const log = window.__voltwisePerformanceLog;
    const requests = log.requests.slice(requestsAt);
    const responses = log.responses.slice(responsesAt);
    const runRequests = requests.filter((message) => message.type === 'run');
    const requestId = runRequests[0]?.requestId;
    const projectResponses = requestId === undefined || requestId === null
      ? []
      : responses.filter((message) => message.requestId === requestId);
    const projectionRequests = requestId === undefined
      ? []
      : requests.filter((message) => message.type === 'projection-year' && message.requestId === requestId);
    const runSuccesses = projectResponses.filter((message) => message.type === 'success');
    const projectionResponses = projectResponses.filter((message) => message.type === 'projection-year');
    const workerErrors = projectResponses.filter((message) => message.type === 'error');
    const alerts = [...document.querySelectorAll('[role="alert"]')].map((alert) => alert.textContent?.replace(/\s+/g, ' ').trim() ?? '');
    const mainText = document.querySelector('main')?.textContent?.replace(/\s+/g, ' ').trim() ?? '';
    const exportButton = [...document.querySelectorAll('button')].find((button) =>
      button.textContent?.includes('Export Analysis for LLM (.json')
    );
    const resultsReady =
      mainText.includes('Modeled Generation & Grid Dispatch Results') && mainText.includes('Annual modeled projections:') &&
      !mainText.includes('Lifecycle Finance Unavailable') && Boolean(exportButton && !exportButton.disabled);
    const projectionActive = projectionRequests.length > projectionResponses.length && projectionResponses.length < 25;
    return {
      at: performance.now(),
      runRequests,
      projectionRequests,
      runSuccesses,
      projectionResponses,
      workerErrors,
      alerts,
      projectionActive,
      resultsReady,
      evidence: workerErrors.map((message) => message.type).join(', ') || alerts.join(' ').slice(0, 800) || mainText.slice(-800),
    };
  }, { requestsAt: baseline.requests, responsesAt: baseline.responses });
  const workerComplete = classifyPerformanceWorkerCompletion(snapshot) === 'complete';
  const state = classifyPerformanceReadiness(snapshot);
  return { ...snapshot, workerComplete, state };
}

async function waitForInitialSimulationToSettle(page: Page) {
  await expect.poll(async () => {
    const counts = await page.evaluate(() => ({
      runRequests: window.__voltwisePerformanceLog.requests.filter((message) => message.type === 'run').length,
    }));
    const pending = await page.getByRole('status').filter({ hasText: 'Updating simulation in the background' }).count();
    return counts.runRequests > 0 && pending === 0;
  }, {
    message: 'Initial application simulation should finish before importing the maximum project.',
    timeout: 60_000,
    intervals: [250, 500, 1_000],
  }).toBe(true);
}

function nearestRankP95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function finiteMetric(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  expect(typeof value, `${label}.${key} must be numeric`).toBe('number');
  expect(Number.isFinite(value), `${label}.${key} must be finite`).toBe(true);
  return value as number;
}

function objectValue(value: unknown, label: string): Record<string, unknown> {
  expect(value !== null && typeof value === 'object' && !Array.isArray(value), `${label} must be an object`).toBe(true);
  return value as Record<string, unknown>;
}

function validateGenerationExport(payloadValue: unknown) {
  const payload = objectValue(payloadValue, 'generation export');
  const metadata = objectValue(payload.metadata, 'export metadata');
  const dataset = objectValue(metadata.dataset_summary, 'export dataset summary');
  expect(finiteMetric(dataset, 'total_intervals', 'dataset summary')).toBe(35_136);
  expect(finiteMetric(dataset, 'interval_duration_hours', 'dataset summary')).toBe(0.25);
  expect(dataset.is_suitable_for_annual_projection).toBe(true);

  const yearOne = objectValue(payload.generation_year_1_results, 'year-one operational results');
  const solarYearOne = finiteMetric(yearOne, 'solar_generated_kwh', 'year-one results');
  const windYearOne = finiteMetric(yearOne, 'wind_generated_kwh', 'year-one results');
  expect(solarYearOne).toBeGreaterThan(0);
  expect(windYearOne).toBeGreaterThan(0);

  const financial = objectValue(payload.generation_horizon_summary_kpis, 'generation financial analysis');
  for (const key of [
    'horizon_years', 'horizon_net_present_value_usd', 'horizon_cumulative_project_cash_flow_usd',
    'horizon_cumulative_electricity_savings_usd', 'horizon_cumulative_utility_electricity_savings_usd',
    'horizon_cumulative_net_operational_savings_usd', 'horizon_cumulative_generator_operating_cost_usd',
    'horizon_generation_maintenance_usd', 'horizon_replacement_expenses_usd', 'horizon_loan_payments_usd',
    'horizon_tax_credit_inflows_usd', 'horizon_roi_pct', 'total_project_cash_outlays_usd',
    'opportunity_cost_future_value_usd', 'opportunity_cost_profit_usd', 'project_vs_opportunity_cost_usd',
  ]) finiteMetric(financial, key, 'generation financial analysis');
  expect(finiteMetric(financial, 'horizon_years', 'generation financial analysis'))
    .toBe(PERFORMANCE_EXPORT_HORIZON_YEARS);
  for (const key of ['simple_payback_years', 'discounted_payback_years']) {
    const value = financial[key];
    if (value !== null) {
      expect(typeof value, `generation financial analysis.${key} must be numeric or null`).toBe('number');
      expect(Number.isFinite(value), `generation financial analysis.${key} must be finite or null`).toBe(true);
    }
  }

  if (!Array.isArray(payload.generation_annual_projection)) {
    throw new Error('generation_annual_projection must be an array.');
  }
  const annualProjection: unknown[] = payload.generation_annual_projection;
  expect(annualProjection).toHaveLength(25);
  const operationalKeys = [
    'solar_generation_kwh', 'wind_generation_kwh', 'solar_direct_to_load_kwh', 'wind_direct_to_load_kwh',
    'renewable_generation_kwh', 'baseline_electricity_cost_usd', 'modeled_project_electricity_cost_usd',
    'electricity_savings_usd', 'generation_om_usd', 'replacement_expense_usd', 'annual_loan_payment_usd',
    'tax_credit_inflow_usd', 'project_annual_cash_flow_usd',
    'cumulative_project_cash_flow_usd', 'cumulative_npv_usd', 'grid_import_kwh', 'grid_export_kwh',
    'battery_discharged_kwh', 'equivalent_full_cycles',
  ];
  const optionalGenerationKeys = [
    'solar_to_battery_kwh', 'solar_export_kwh', 'solar_curtailed_kwh', 'wind_to_battery_kwh',
    'wind_export_kwh', 'wind_curtailed_kwh', 'renewable_direct_to_load_kwh', 'renewable_to_battery_kwh',
    'renewable_export_kwh', 'renewable_curtailed_kwh', 'generator_generation_kwh', 'generator_generated_kwh',
    'generator_direct_to_load_kwh', 'generator_to_battery_kwh', 'generator_export_kwh', 'generator_curtailed_kwh',
  ];
  let solarTotal = 0;
  let windTotal = 0;
  annualProjection.forEach((rowValue, index) => {
    const row = objectValue(rowValue, `annual projection year ${index + 1}`);
    expect(finiteMetric(row, 'year', `annual projection year ${index + 1}`)).toBe(index + 1);
    for (const key of operationalKeys) {
      const value = finiteMetric(row, key, `annual projection year ${index + 1}`);
      if (key === 'solar_generation_kwh') solarTotal += value;
      if (key === 'wind_generation_kwh') windTotal += value;
    }
    for (const key of optionalGenerationKeys) {
      if (row[key] !== undefined) finiteMetric(row, key, `annual projection year ${index + 1}`);
    }
  });
  expect(solarTotal).toBeGreaterThan(0);
  expect(windTotal).toBeGreaterThan(0);
  return { solarYearOneKwh: solarYearOne, windYearOneKwh: windYearOne, annualProjectionYears: annualProjection.length };
}

async function readHeapBytes(page: Page): Promise<number | null> {
  return page.evaluate(() => (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory?.usedJSHeapSize ?? null);
}

test('measures the maximum active measured solar/wind production-browser workload', async ({ page, browser, browserName }, testInfo: TestInfo) => {
  test.setTimeout(480_000);
  await page.setViewportSize({ width: 390, height: 844 });
  await installPerformanceInstrumentation(page);
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(message.text()); });
  page.on('dialog', (dialog) => dialog.accept());

  const projectArchive = await createMaximumLeapYearProjectArchive('performance');
  await page.goto('/');
  await waitForInitialSimulationToSettle(page);
  const initialHeapBytes = await readHeapBytes(page);
  const beforeImport = await readLog(page);
  const baseline = { requests: beforeImport.requests.length, responses: beforeImport.responses.length };
  await openTab(page, '1. Data & TOU Rates');
  const importStartedAt = await page.evaluate(() => performance.now());
  await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles({
    name: 'maximum-active-2024-solar-wind.json',
    mimeType: 'application/json',
    buffer: projectArchive,
  });
  await expect(page.getByRole('status').filter({ hasText: /^Opened maximum-active-2024-solar-wind\.json\./ })).toBeVisible({ timeout: 60_000 });
  const importFinishedAt = await page.evaluate(() => performance.now());
  const importElapsedMs = importFinishedAt - importStartedAt;

  await expect.poll(async () => (await readProjectSnapshot(page, baseline)).runRequests.length, {
    message: 'The imported project should dispatch one operational worker run.',
    timeout: 60_000,
    intervals: [100, 250, 500],
  }).toBeGreaterThan(0);
  const started = await readProjectSnapshot(page, baseline);
  expect(started.runRequests, 'The imported project adds exactly one operational run request.').toHaveLength(1);
  const firstRunRequest = started.runRequests[0];
  expect(firstRunRequest.requestId).not.toBeNull();

  const remainingReadinessMs = async () => {
    const now = await page.evaluate(() => performance.now());
    return Math.max(1, 240_000 - (now - firstRunRequest.at));
  };
  await expect.poll(async () => (await readProjectSnapshot(page, baseline)).projectionRequests.length, {
    message: 'The generation-aware operational result should begin its projection-year worker sequence.',
    timeout: await remainingReadinessMs(),
    intervals: [100, 250, 500],
  }).toBeGreaterThan(0);
  const projectionStarted = await readProjectSnapshot(page, baseline);
  const firstProjectionRequest = projectionStarted.projectionRequests[0];
  expect(firstProjectionRequest).toBeDefined();

  const uiMeasurements = await measurePerformanceNavigationSequence(
    page,
    firstRunRequest.requestId,
    () => readProjectSnapshot(page, baseline),
  );
  await returnToResultsForReadiness(page, firstRunRequest.requestId, () => readProjectSnapshot(page, baseline));
  await expect.poll(async () => classifyPerformanceWorkerCompletion(await readProjectSnapshot(page, baseline)), {
    message: 'The imported operational run and all 25 projection-year worker requests must complete without worker errors.',
    timeout: await remainingReadinessMs(),
    intervals: [250, 500, 1_000],
  }).toBe('complete');
  const workerCompletion = await readProjectSnapshot(page, baseline);
  expect(workerCompletion.runRequests, 'The imported project must retain one operational worker request.').toHaveLength(1);
  expect(workerCompletion.runRequests[0]?.requestId).toBe(firstRunRequest.requestId);
  expect(workerCompletion.runSuccesses, 'The operational worker must succeed exactly once.').toHaveLength(1);
  expect(workerCompletion.projectionRequests, 'The worker must request all 25 projection years.').toHaveLength(25);
  expect(workerCompletion.projectionResponses, 'The worker must return all 25 projection years.').toHaveLength(25);
  expect(workerCompletion.workerErrors, 'Worker errors must prevent successful completion.').toEqual([]);
  expect(workerCompletion.workerComplete).toBe(true);

  const readinessPollMs = await remainingReadinessMs();
  await expect.poll(async () => (await readProjectSnapshot(page, baseline)).state, {
    message: 'Completed worker output must become generation-financial Results on the Results tab.',
    timeout: readinessPollMs,
    intervals: [250, 500, 1_000],
  }).toBe('ready');
  const readiness = await readProjectSnapshot(page, baseline);
  expect(readiness.state, `Generation financial readiness failed: ${readiness.evidence}`).toBe('ready');

  await openTab(page, '5. Results & Analytics');
  await expect(page.getByText('Modeled Generation & Grid Dispatch Results')).toBeVisible();
  await expect(page.getByText(/Annual modeled projections:/)).toBeVisible();
  await selectPerformanceExportHorizon({
    clickPreset: async (label) => page.getByRole('button', { name: label, exact: true }).first().click({ timeout: 10_000 }),
    readSliderValue: async (accessibleName) => page.getByRole('slider', { name: accessibleName, exact: true }).first().inputValue(),
    assertImportedRunStable: async () => {
      const snapshot = await readProjectSnapshot(page, baseline);
      expect(snapshot.state, `Results must stay ready while selecting the export horizon: ${snapshot.evidence}`).toBe('ready');
      expect(snapshot.runRequests).toHaveLength(1);
      expect(snapshot.runRequests[0]?.requestId).toBe(firstRunRequest.requestId);
      expect(snapshot.runSuccesses).toHaveLength(1);
      expect(snapshot.projectionRequests).toHaveLength(25);
      expect(snapshot.projectionResponses).toHaveLength(25);
      expect(snapshot.workerErrors).toEqual([]);
    },
  });
  const heapAfterCompletionBytes = await readHeapBytes(page);
  const exportButton = page.getByRole('button', { name: 'Export Analysis for LLM (.json)' }).first();
  await expect(exportButton).toBeEnabled();
  const [download] = await Promise.all([page.waitForEvent('download'), exportButton.click()]);
  expect(download.suggestedFilename()).toBe('generation_project_analysis_export.json');
  const exportPath = await download.path();
  expect(exportPath).not.toBeNull();
  const exportPayload = JSON.parse(await readFile(exportPath!, 'utf8')) as unknown;
  const results = validateGenerationExport(exportPayload);

  const finalSnapshot = await readProjectSnapshot(page, baseline);
  expect(finalSnapshot.runRequests, 'Safe navigation and display actions must not restart operational runs.').toHaveLength(1);
  expect(finalSnapshot.projectionRequests, 'Safe navigation and display actions must preserve the single 25-year projection.').toHaveLength(25);
  expect(finalSnapshot.runSuccesses).toHaveLength(1);
  expect(finalSnapshot.projectionResponses).toHaveLength(25);
  expect(finalSnapshot.workerErrors).toEqual([]);
  const browserLog = await readLog(page);
  expect(browserLog.alerts).toEqual([]);
  expect(browserLog.unhandledRejections).toEqual([]);
  expect(pageErrors, 'Browser page errors').toEqual([]);
  expect(consoleErrors, 'Browser console errors').toEqual([]);

  await page.evaluate(() => window.clearInterval(window.__voltwisePerformanceHeapTimer));
  const projectionHeapSamples = browserLog.heapSamples.filter((sample) =>
    sample.at >= firstProjectionRequest.at && sample.at <= readiness.at
  );
  const peakProjectionHeapBytes = projectionHeapSamples.length
    ? projectionHeapSamples.reduce((peak, sample) => Math.max(peak, sample.usedBytes), 0)
    : null;
  const activeActionDurations = uiMeasurements.filter((measurement) => measurement.duringProjection).map((measurement) => measurement.durationMs);
  const allNewRequests = browserLog.requests.slice(baseline.requests);
  const allNewResponses = browserLog.responses.slice(baseline.responses);
  const report = {
    schemaVersion: 1,
    sourceSha: process.env.GITHUB_SHA ?? process.env.GITHUB_REF_SHA ?? null,
    scenario: 'maximum-active-measured-solar-wind-2024-leap',
    browser: { name: browserName, version: browser.version(), viewport: { width: 390, height: 844 } },
    input: { intervalCount: 35_136, intervalDurationHours: 0.25, calendarYear: 2024, enabledAssetTypes: ['solar', 'wind'], batteryProfiles: 1, projectionYears: 25 },
    timings: {
      clock: 'window.performance.now()',
      projectImportElapsedMs: Number(importElapsedMs.toFixed(1)),
      initialOperationalRunRequestAtMs: Number(firstRunRequest.at.toFixed(1)),
      firstProjectionYearRequestAtMs: Number(firstProjectionRequest.at.toFixed(1)),
      lastProjectionYearResponseAtMs: Number(finalSnapshot.projectionResponses.at(-1)!.at.toFixed(1)),
      generationFinancialReadyAtMs: Number(readiness.at.toFixed(1)),
      operationalRunToFinancialReadyElapsedMs: Number((readiness.at - firstRunRequest.at).toFixed(1)),
    },
    workerRequests: {
      baselineRequestCount: baseline.requests,
      importedProjectDelta: { run: allNewRequests.filter((message) => message.type === 'run').length, projectionYear: allNewRequests.filter((message) => message.type === 'projection-year').length },
      importedProjectResponses: { success: finalSnapshot.runSuccesses.length, projectionYear: finalSnapshot.projectionResponses.length, error: finalSnapshot.workerErrors.length },
      totalNewResponseCount: allNewResponses.length,
    },
    uiResponsiveness: {
      interactionTargetMs: 100,
      actionCount: uiMeasurements.length,
      actionsDuringActiveProjection: activeActionDurations.length,
      individualActions: uiMeasurements.map((measurement) => ({ ...measurement, durationMs: Number(measurement.durationMs.toFixed(1)) })),
      observedNearestRankP95Ms: nearestRankP95(activeActionDurations) === null ? null : Number(nearestRankP95(activeActionDurations)!.toFixed(1)),
      observedMaximumMs: activeActionDurations.length ? Number(Math.max(...activeActionDurations).toFixed(1)) : null,
      status: getPerformanceUiCoverageStatus(activeActionDurations.length),
    },
    memory: {
      measurement: 'renderer JavaScript heap; not total browser memory or process-tree RSS',
      supported: initialHeapBytes !== null || projectionHeapSamples.length > 0 || heapAfterCompletionBytes !== null,
      initialBytes: initialHeapBytes,
      peakSampledDuringProjectionBytes: peakProjectionHeapBytes,
      afterCompletionBytes: heapAfterCompletionBytes,
      sampleIntervalMs: 50,
    },
    resultsValidation: { status: 'PASS', ...results },
    browserErrorCount: pageErrors.length + consoleErrors.length + browserLog.unhandledRejections.length +
      finalSnapshot.workerErrors.length + browserLog.alerts.length,
  };
  await testInfo.attach('maximum-active-generation-performance.json', {
    body: Buffer.from(JSON.stringify(report, null, 2)),
    contentType: 'application/json',
  });
  console.info(`VOLTWISE_PERFORMANCE_FEASIBILITY_JSON ${JSON.stringify(report)}`);
});
