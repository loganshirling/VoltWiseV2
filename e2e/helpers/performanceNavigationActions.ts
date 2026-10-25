import type { Page } from '@playwright/test';

export const PERFORMANCE_NAVIGATION_TABS = [
  '2. Battery Profiles',
  '3. Power Generation',
  '4. Financials & Settings',
  '5. Results & Analytics',
  '1. Data & TOU Rates',
] as const;

export const PERFORMANCE_NAVIGATION_SEQUENCE = [
  ...PERFORMANCE_NAVIGATION_TABS,
  ...PERFORMANCE_NAVIGATION_TABS,
  ...PERFORMANCE_NAVIGATION_TABS,
] as const;

export const PERFORMANCE_READINESS_NAVIGATION_ACTION = {
  tab: '5. Results & Analytics',
  measured: false,
} as const;

export type PerformanceReadinessState = 'projecting' | 'financial-pending' | 'ready' | 'error';
export type PerformanceWorkerCompletionState = 'pending' | 'complete' | 'error';

export type PerformanceNavigationSnapshot = {
  projectionActive: boolean;
  runRequests: Array<{ requestId: number | null }>;
  runSuccesses: readonly unknown[];
  projectionRequests: readonly unknown[];
  projectionResponses: readonly unknown[];
  workerErrors: readonly unknown[];
  alerts: readonly string[];
  resultsReady: boolean;
  evidence: string;
};

export type PerformanceNavigationMeasurement = {
  name: string;
  durationMs: number;
  duringProjection: boolean;
};

export function getPerformanceUiCoverageStatus(activeActionCount: number): 'MEASURED' | 'NOT_FULLY_MEASURED' {
  return activeActionCount >= PERFORMANCE_NAVIGATION_SEQUENCE.length
    ? 'MEASURED'
    : 'NOT_FULLY_MEASURED';
}

export function classifyPerformanceWorkerCompletion(
  snapshot: Pick<PerformanceNavigationSnapshot, 'runRequests' | 'runSuccesses' | 'projectionRequests' | 'projectionResponses' | 'workerErrors'>,
): PerformanceWorkerCompletionState {
  if (snapshot.workerErrors.length > 0 || snapshot.runRequests.length > 1 ||
    snapshot.runSuccesses.length > 1 || snapshot.projectionRequests.length > 25 || snapshot.projectionResponses.length > 25 ||
    snapshot.runRequests.some((request) => request.requestId === null)) {
    return 'error';
  }
  const workerComplete = snapshot.runRequests.length === 1 && snapshot.runSuccesses.length === 1 &&
    snapshot.projectionRequests.length === 25 && snapshot.projectionResponses.length === 25;
  return workerComplete ? 'complete' : 'pending';
}

export function classifyPerformanceReadiness(snapshot: PerformanceNavigationSnapshot): PerformanceReadinessState {
  if (snapshot.alerts.length > 0) return 'error';
  const workerState = classifyPerformanceWorkerCompletion(snapshot);
  if (workerState === 'error') return 'error';
  if (workerState === 'pending') return 'projecting';
  return snapshot.resultsReady ? 'ready' : 'financial-pending';
}

export function preservesOperationalRequestIdentity(
  expectedRequestId: number | null | undefined,
  snapshot: Pick<PerformanceNavigationSnapshot, 'runRequests'>,
): boolean {
  return expectedRequestId !== null && expectedRequestId !== undefined && snapshot.runRequests.length === 1 &&
    snapshot.runRequests[0]?.requestId === expectedRequestId;
}

export async function measurePerformanceNavigationSequence(
  page: Page,
  importedRequestId: number | null,
  readSnapshot: () => Promise<PerformanceNavigationSnapshot>,
): Promise<PerformanceNavigationMeasurement[]> {
  const measurements: PerformanceNavigationMeasurement[] = [];
  for (const tab of PERFORMANCE_NAVIGATION_SEQUENCE) {
    const before = await readSnapshot();
    if (!before.projectionActive) break;
    if (!preservesOperationalRequestIdentity(importedRequestId, before)) {
      throw new Error(`Cannot measure navigation to "${tab}": expected one imported operational worker request; ${before.evidence}`);
    }
    const requestId = importedRequestId;
    const startedAt = await page.evaluate(() => performance.now());
    try {
      await page.getByRole('button', { name: tab, exact: true }).last().click({ timeout: 10_000 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Navigation action "${tab}" failed while generation projection was active (worker request ${requestId}): ${detail}`);
    }
    const finishedAt = await page.evaluate(() => performance.now());
    const after = await readSnapshot();
    if (!preservesOperationalRequestIdentity(requestId, after)) {
      throw new Error(`Navigation action "${tab}" changed the imported operational worker request identity from ${requestId}; ${after.evidence}`);
    }
    measurements.push({
      name: `navigate to ${tab}`,
      durationMs: finishedAt - startedAt,
      duringProjection: before.projectionActive && after.projectionActive,
    });
    if (!after.projectionActive) break;
  }
  return measurements;
}

export async function returnToResultsForReadiness(
  page: Page,
  importedRequestId: number | null,
  readSnapshot: () => Promise<PerformanceNavigationSnapshot>,
): Promise<PerformanceNavigationSnapshot> {
  const before = await readSnapshot();
  if (!preservesOperationalRequestIdentity(importedRequestId, before)) {
    throw new Error(`Cannot return to Results for readiness: imported operational worker identity is missing or ambiguous; ${before.evidence}`);
  }
  const requestId = importedRequestId;
  try {
    await page.getByRole('button', { name: PERFORMANCE_READINESS_NAVIGATION_ACTION.tab, exact: true }).last().click({ timeout: 10_000 });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(`Unmeasured readiness navigation to Results failed (worker request ${requestId}): ${detail}`);
  }
  const after = await readSnapshot();
  if (!preservesOperationalRequestIdentity(requestId, after)) {
    throw new Error(`Returning to Results changed the imported operational worker request identity from ${requestId}; ${after.evidence}`);
  }
  return after;
}
