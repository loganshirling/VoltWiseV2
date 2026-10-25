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

export type PerformanceNavigationSnapshot = {
  projectionActive: boolean;
  runRequests: Array<{ requestId: number | null }>;
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

export async function measurePerformanceNavigationSequence(
  page: Page,
  readSnapshot: () => Promise<PerformanceNavigationSnapshot>,
): Promise<PerformanceNavigationMeasurement[]> {
  const measurements: PerformanceNavigationMeasurement[] = [];
  for (const tab of PERFORMANCE_NAVIGATION_SEQUENCE) {
    const before = await readSnapshot();
    if (!before.projectionActive) break;
    if (before.runRequests.length !== 1 || before.runRequests[0]?.requestId === null || before.runRequests[0]?.requestId === undefined) {
      throw new Error(`Cannot measure navigation to "${tab}": expected one imported operational worker request; ${before.evidence}`);
    }
    const requestId = before.runRequests[0].requestId;
    const startedAt = await page.evaluate(() => performance.now());
    try {
      await page.getByRole('button', { name: tab, exact: true }).last().click({ timeout: 10_000 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(`Navigation action "${tab}" failed while generation projection was active (worker request ${requestId}): ${detail}`);
    }
    const finishedAt = await page.evaluate(() => performance.now());
    const after = await readSnapshot();
    if (after.runRequests.length !== 1 || after.runRequests[0]?.requestId !== requestId) {
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
