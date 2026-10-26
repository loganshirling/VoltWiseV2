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

export type PerformanceNavigationDiagnosticEvent = {
  actionIndex: number;
  clickEventDispatchAtMs: number | null;
  nextAnimationFrameAtMs: number | null;
};

export type PerformanceNavigationDiagnosticAction = PerformanceNavigationMeasurement & {
  actionIndex: number;
  actionStartedAtMs: number;
  actionCompletedAtMs: number;
  clickEventDispatchAtMs: number | null;
  startToClickDispatchMs: number | null;
  clickDispatchToActionCompletionMs: number | null;
  nextAnimationFrameAtMs: number | null;
  clickDispatchToNextAnimationFrameMs: number | null;
  clickDispatchAvailability: 'available' | 'unavailable';
  nextAnimationFrameAvailability: 'available' | 'unavailable';
};

export type PerformanceNavigationDiagnosticReport = {
  schemaVersion: 1;
  sourceSha: string | null;
  clock: string;
  actions: PerformanceNavigationDiagnosticAction[];
  perTabSummary: Array<{
    tab: string;
    actionCount: number;
    originalWallMeanMs: number;
    originalWallMaximumMs: number;
    clickDispatchMeasuredCount: number;
    meanStartToClickDispatchMs: number | null;
    meanClickDispatchToCompletionMs: number | null;
  }>;
  limitations: string[];
};

export function createPerformanceNavigationDiagnosticAction(
  measurement: PerformanceNavigationMeasurement,
  actionIndex: number,
  actionStartedAtMs: number,
  actionCompletedAtMs: number,
  browserEvent: PerformanceNavigationDiagnosticEvent,
): PerformanceNavigationDiagnosticAction {
  const clickEventDispatchAtMs = browserEvent.clickEventDispatchAtMs;
  const nextAnimationFrameAtMs = browserEvent.nextAnimationFrameAtMs;
  return {
    ...measurement,
    actionIndex,
    actionStartedAtMs,
    actionCompletedAtMs,
    clickEventDispatchAtMs,
    startToClickDispatchMs: clickEventDispatchAtMs === null ? null : clickEventDispatchAtMs - actionStartedAtMs,
    clickDispatchToActionCompletionMs: clickEventDispatchAtMs === null ? null : actionCompletedAtMs - clickEventDispatchAtMs,
    nextAnimationFrameAtMs,
    clickDispatchToNextAnimationFrameMs: clickEventDispatchAtMs === null || nextAnimationFrameAtMs === null
      ? null
      : nextAnimationFrameAtMs - clickEventDispatchAtMs,
    clickDispatchAvailability: clickEventDispatchAtMs === null ? 'unavailable' : 'available',
    nextAnimationFrameAvailability: nextAnimationFrameAtMs === null ? 'unavailable' : 'available',
  };
}

export function nearestRankP95(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.ceil(sorted.length * 0.95) - 1];
}

function roundMilliseconds(value: number): number {
  return Number(value.toFixed(1));
}

export function buildPerformanceNavigationDiagnosticReport(
  sourceSha: string | null,
  navigationActions: readonly PerformanceNavigationDiagnosticAction[],
): PerformanceNavigationDiagnosticReport {
  const actions = navigationActions.map((action) => ({ ...action }));

  const tabNames = [...new Set(actions.map((action) => action.name.replace(/^navigate to /, '')))];
  const perTabSummary = tabNames.map((tab) => {
    const tabActions = actions.filter((action) => action.name === `navigate to ${tab}`);
    const measuredClickDispatches = tabActions.filter((action) => action.startToClickDispatchMs !== null);
    const average = (values: number[]) => values.length
      ? roundMilliseconds(values.reduce((sum, value) => sum + value, 0) / values.length)
      : null;
    return {
      tab,
      actionCount: tabActions.length,
      originalWallMeanMs: average(tabActions.map((action) => action.durationMs))!,
      originalWallMaximumMs: roundMilliseconds(Math.max(...tabActions.map((action) => action.durationMs))),
      clickDispatchMeasuredCount: measuredClickDispatches.length,
      meanStartToClickDispatchMs: average(measuredClickDispatches.map((action) => action.startToClickDispatchMs!)),
      meanClickDispatchToCompletionMs: average(measuredClickDispatches.map((action) => action.clickDispatchToActionCompletionMs!)),
    };
  });

  return {
    schemaVersion: 1,
    sourceSha,
    clock: 'window.performance.now() within the same document',
    actions,
    perTabSummary,
    limitations: [
      'Original Playwright click wall time includes actionability checks and automation round trips as well as browser event handling.',
      'Click-event dispatch splits the wall interval approximately; it does not isolate React event handling or main-thread work.',
      'The next requestAnimationFrame timestamp is an advisory scheduling proxy, not proof that React rendering or browser paint completed.',
      'Unavailable browser-side timestamps are null and excluded from per-tab browser timing means.',
    ],
  };
}

type BrowserNavigationDiagnosticStore = {
  events: Record<string, { clickEventDispatchAtMs: number | null; nextAnimationFrameAtMs: number | null }>;
  listeners: Record<string, EventListener>;
};

async function armBrowserNavigationDiagnostic(page: Page, actionIndex: number, tab: string): Promise<number> {
  return page.evaluate(({ actionIndex: currentActionIndex, expectedTab }) => {
    const diagnosticWindow = window as Window & { __voltwiseNavigationDiagnostics?: BrowserNavigationDiagnosticStore };
    const store = diagnosticWindow.__voltwiseNavigationDiagnostics ?? { events: {}, listeners: {} };
    diagnosticWindow.__voltwiseNavigationDiagnostics = store;
    const id = String(currentActionIndex);
    const eventData = { clickEventDispatchAtMs: null as number | null, nextAnimationFrameAtMs: null as number | null };
    store.events[id] = eventData;
    const listener: EventListener = (event) => {
      const target = event.target;
      const button = target instanceof Element ? target.closest('button') : null;
      const label = button?.textContent?.replace(/\s+/g, ' ').trim();
      if (label !== expectedTab) return;
      document.removeEventListener('click', listener, true);
      delete store.listeners[id];
      eventData.clickEventDispatchAtMs = performance.now();
      requestAnimationFrame(() => { eventData.nextAnimationFrameAtMs = performance.now(); });
    };
    store.listeners[id] = listener;
    document.addEventListener('click', listener, true);
    return performance.now();
  }, { actionIndex, expectedTab: tab });
}

async function finishBrowserNavigationDiagnostic(page: Page, actionIndex: number): Promise<number> {
  return page.evaluate((currentActionIndex) => {
    const now = performance.now();
    const store = (window as Window & { __voltwiseNavigationDiagnostics?: BrowserNavigationDiagnosticStore }).__voltwiseNavigationDiagnostics;
    const id = String(currentActionIndex);
    const listener = store?.listeners[id];
    if (listener) document.removeEventListener('click', listener, true);
    if (store) delete store.listeners[id];
    return now;
  }, actionIndex);
}

async function readBrowserNavigationDiagnostics(page: Page, actionCount: number): Promise<PerformanceNavigationDiagnosticEvent[]> {
  return page.evaluate((count) => {
    const store = (window as Window & { __voltwiseNavigationDiagnostics?: BrowserNavigationDiagnosticStore }).__voltwiseNavigationDiagnostics;
    return Array.from({ length: count }, (_, actionIndex) => {
      const event = store?.events[String(actionIndex)];
      return {
        actionIndex,
        clickEventDispatchAtMs: event?.clickEventDispatchAtMs ?? null,
        nextAnimationFrameAtMs: event?.nextAnimationFrameAtMs ?? null,
      };
    });
  }, actionCount);
}

async function removeBrowserNavigationDiagnosticListener(page: Page, actionIndex: number): Promise<void> {
  await page.evaluate((currentActionIndex) => {
    const store = (window as Window & { __voltwiseNavigationDiagnostics?: BrowserNavigationDiagnosticStore }).__voltwiseNavigationDiagnostics;
    const id = String(currentActionIndex);
    const listener = store?.listeners[id];
    if (listener) document.removeEventListener('click', listener, true);
    if (store) delete store.listeners[id];
  }, actionIndex);
}

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
  diagnosticActions?: PerformanceNavigationDiagnosticAction[],
): Promise<PerformanceNavigationMeasurement[]> {
  const measurements: PerformanceNavigationMeasurement[] = [];
  const actionTimes: Array<{ actionStartedAtMs: number; actionCompletedAtMs: number }> = [];
  for (const [actionIndex, tab] of PERFORMANCE_NAVIGATION_SEQUENCE.entries()) {
    const before = await readSnapshot();
    if (!before.projectionActive) break;
    if (!preservesOperationalRequestIdentity(importedRequestId, before)) {
      throw new Error(`Cannot measure navigation to "${tab}": expected one imported operational worker request; ${before.evidence}`);
    }
    const requestId = importedRequestId;
    const startedAt = diagnosticActions
      ? await armBrowserNavigationDiagnostic(page, actionIndex, tab)
      : await page.evaluate(() => performance.now());
    try {
      await page.getByRole('button', { name: tab, exact: true }).last().click({ timeout: 10_000 });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      await removeBrowserNavigationDiagnosticListener(page, actionIndex).catch(() => undefined);
      throw new Error(`Navigation action "${tab}" failed while generation projection was active (worker request ${requestId}): ${detail}`);
    }
    const finishedAt = diagnosticActions
      ? await finishBrowserNavigationDiagnostic(page, actionIndex)
      : await page.evaluate(() => performance.now());
    const after = await readSnapshot();
    if (!preservesOperationalRequestIdentity(requestId, after)) {
      throw new Error(`Navigation action "${tab}" changed the imported operational worker request identity from ${requestId}; ${after.evidence}`);
    }
    measurements.push({
      name: `navigate to ${tab}`,
      durationMs: finishedAt - startedAt,
      duringProjection: before.projectionActive && after.projectionActive,
    });
    actionTimes.push({ actionStartedAtMs: startedAt, actionCompletedAtMs: finishedAt });
    if (!after.projectionActive) break;
  }
  if (diagnosticActions) {
    const browserEvents = await readBrowserNavigationDiagnostics(page, measurements.length);
    for (const [actionIndex, measurement] of measurements.entries()) {
      const event = browserEvents[actionIndex]!;
      const { actionStartedAtMs, actionCompletedAtMs } = actionTimes[actionIndex]!;
      diagnosticActions.push(createPerformanceNavigationDiagnosticAction(
        measurement,
        actionIndex,
        actionStartedAtMs,
        actionCompletedAtMs,
        event,
      ));
    }
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
