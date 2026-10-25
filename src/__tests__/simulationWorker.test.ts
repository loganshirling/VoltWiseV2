import { describe, expect, it } from 'vitest';
import { DEFAULT_BATTERY_PROFILES, DEFAULT_TOU_PROFILES, calculate15YearFinancials, createDefaultScheduleMatrix } from '../utils/simulationEngine';
import { createDefaultGenerationConfig, createDefaultSolarAsset } from '../utils/generationDefaults';
import { generateRealistic8760Dataset, generateStandardCsvTemplate } from '../utils/sampleData';
import { parseAndValidateEnergyCsv } from '../utils/csvParser';
import { runUnifiedSimulation } from '../utils/simulationRouter';
import {
  executeGenerationProjectionYear,
  executeSimulationJob,
  getNonVollFinancialDependencyKey,
  recalculateSimulationJobFinancials,
  SimulationJobInput,
  SimulationJobResult,
} from '../utils/simulationWorkerJob';
import { calculateGenerationOperationalProjection } from '../utils/generationProjection';
import { createSimulationWorkerClient, SimulationWorkerLike } from '../utils/simulationWorkerClient';
import { SimulationWorkerResponseMessage } from '../utils/simulationWorkerJob';
import { calculateGenerationAwareFinancials, aggregateGenerationProjectCosts } from '../utils/generationFinancials';
import type { GenerationOperationalYear, MacroFinancials } from '../types/energy';

function makeInput(): SimulationJobInput {
  const csv = parseAndValidateEnergyCsv(generateStandardCsvTemplate());
  const tou = DEFAULT_TOU_PROFILES[0];
  return {
    dataPoints: csv.data,
    intervalHours: csv.intervalHours,
    profiles: DEFAULT_BATTERY_PROFILES,
    activeProfileId: DEFAULT_BATTERY_PROFILES[0].id,
    tiers: tou.tiers,
    scheduleMatrix: createDefaultScheduleMatrix(),
    seasons: tou.seasons,
    generationConfig: {
      ...createDefaultGenerationConfig(),
      site: { ...createDefaultGenerationConfig().site, timeZone: 'UTC' },
    },
    allowSolarExport: false,
    annualProjectionEligible: false,
    preflightError: null,
    financials: {
      federalTaxCreditPercent: 0,
      federalTaxCreditRealizationYear: 1,
      localRebateFlat: 0,
      annualElectricityInflationRate: 3,
      annualBatteryDegradationRate: 2,
      discountRatePercent: 5,
      opportunityCostVehicle: 'hysa',
      opportunityCostRatePercent: 4,
      replacementEnabled: false,
      replacementCost: 0,
      replacementYear: 10,
      isFinanced: false,
      loanAprPercent: 0,
      loanTermYears: 10,
      loanDownPaymentPercent: 100,
      criticalLoadPowerKw: 0,
      annualOutageDays: 0,
      valueOfLostLoadPerDay: 0,
      includeVollInRoi: false,
    },
  };
}

class FakeWorker implements SimulationWorkerLike {
  onmessage: ((event: MessageEvent<SimulationWorkerResponseMessage>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  posted: unknown[] = [];
  terminated = false;
  postMessage(message: unknown) { this.posted.push(message); }
  terminate() { this.terminated = true; }
  respond(data: SimulationWorkerResponseMessage) { this.onmessage?.({ data } as MessageEvent<SimulationWorkerResponseMessage>); }
}

function createProjectionYear(year: number): GenerationOperationalYear {
  return {
    year,
    baselineElectricityCostUsd: 1_000,
    simulatedElectricityCostUsd: 700,
    electricitySavingsUsd: 300,
    solarGeneratedKwh: 100,
    solarDirectToLoadKwh: 80,
    solarToBatteryKwh: 20,
    solarExportKwh: 0,
    solarCurtailedKwh: 0,
    windGeneratedKwh: 0,
    windDirectToLoadKwh: 0,
    windToBatteryKwh: 0,
    windExportKwh: 0,
    windCurtailedKwh: 0,
    renewableGeneratedKwh: 100,
    renewableDirectToLoadKwh: 80,
    renewableToBatteryKwh: 20,
    renewableExportKwh: 0,
    renewableCurtailedKwh: 0,
    gridImportKwh: 500,
    gridExportKwh: 0,
    batteryExportKwh: 0,
    batteryDischargedKwh: 100,
    equivalentFullCycles: 10,
    batteryCapacityRetentionFactor: 1,
    batteryUsableCapacityKwh: 10,
    solarAssets: [],
  };
}

function makeResult(overrides: Partial<SimulationJobResult> = {}): SimulationJobResult {
  return {
    activeUnifiedResult: null,
    allSimulationSummaries: {},
    allAnalyses: [],
    simulationError: null,
    activeGenerationOperationalProjection: null,
    generationProjectionError: null,
    activeGenerationAnalysis: null,
    generationFinancialError: null,
    ...overrides,
  };
}

describe('VOLL-only financial recalculation', () => {
  it('keeps the simulation dependency key stable only for VOLL assumption edits', () => {
    const financials = makeInput().financials;
    const key = getNonVollFinancialDependencyKey(financials);

    expect(getNonVollFinancialDependencyKey({
      ...financials,
      includeVollInRoi: true,
      annualOutageDays: 4,
      valueOfLostLoadPerDay: 250,
    })).toBe(key);

    const nonVollChanges: Partial<MacroFinancials>[] = [
      { federalTaxCreditPercent: 10 },
      { federalTaxCreditRealizationYear: 2 },
      { localRebateFlat: 500 },
      { annualElectricityInflationRate: 4 },
      { annualBatteryDegradationRate: 3 },
      { discountRatePercent: 6 },
      { opportunityCostVehicle: 'custom' },
      { opportunityCostRatePercent: 5 },
      { replacementEnabled: true },
      { replacementCost: 1_000 },
      { replacementYear: 12 },
      { isFinanced: true },
      { loanAprPercent: 2 },
      { loanTermYears: 15 },
      { loanDownPaymentPercent: 20 },
      { criticalLoadPowerKw: 2 },
    ];
    for (const change of nonVollChanges) {
      expect(getNonVollFinancialDependencyKey({ ...financials, ...change })).not.toBe(key);
    }
  });

  it('recalculates legacy financial analysis from retained summaries without replacing operational output', () => {
    const input = makeInput();
    const profile = input.profiles[0];
    const summary = runUnifiedSimulation({
      dataPoints: input.dataPoints.slice(0, 48),
      intervalHours: input.intervalHours,
      tiers: input.tiers,
      scheduleMatrix: input.scheduleMatrix,
      batteryProfile: profile,
      seasons: input.seasons,
      generationConfig: input.generationConfig,
      allowSolarExport: input.allowSolarExport,
    }).annualSummary;
    const initialFinancials = { ...input.financials, annualOutageDays: 2, valueOfLostLoadPerDay: 100 };
    const initialAnalysis = calculate15YearFinancials(profile, summary, initialFinancials);
    const operationalSummary = { [profile.id]: summary };
    const unifiedResult = {
      mode: 'legacy' as const,
      annualSummary: summary,
    };
    const result = makeResult({
      activeUnifiedResult: unifiedResult,
      allSimulationSummaries: operationalSummary,
      allAnalyses: [initialAnalysis],
    });
    input.profiles = [profile];
    input.activeProfileId = profile.id;

    const latestFinancials = {
      ...initialFinancials,
      annualOutageDays: 5,
      valueOfLostLoadPerDay: 200,
      includeVollInRoi: true,
    };
    const refreshed = recalculateSimulationJobFinancials(result, input, latestFinancials);

    expect(refreshed.allAnalyses[0]).toEqual(
      calculate15YearFinancials(profile, summary, latestFinancials)
    );
    expect(refreshed.allAnalyses[0].npv).toBe(initialAnalysis.npv);
    expect(refreshed.allAnalyses[0].lifetimeNetProfit).toBe(initialAnalysis.lifetimeNetProfit);
    expect(refreshed.allAnalyses[0].lifetimeRoiPercent).toBe(initialAnalysis.lifetimeRoiPercent);
    expect(refreshed.allAnalyses[0].lifetimeResilienceValue).toBe(25_000);
    expect(refreshed.allAnalyses[0].npvWithVoll).toBeGreaterThan(refreshed.allAnalyses[0].npv);
    expect(refreshed.allAnalyses[0].lifetimeNetProfitWithVoll).toBeGreaterThan(refreshed.allAnalyses[0].lifetimeNetProfit);
    expect(refreshed.allAnalyses[0].lifetimeRoiWithVollPercent).toBeGreaterThan(refreshed.allAnalyses[0].lifetimeRoiPercent);
    expect(refreshed.activeUnifiedResult).toBe(unifiedResult);
    expect(refreshed.allSimulationSummaries).toBe(operationalSummary);
  });

  it('reuses a compact generation projection and recalculates both VOLL companion states', () => {
    const input = makeInput();
    const profile = input.profiles[0];
    input.profiles = [profile];
    input.activeProfileId = profile.id;
    const solar = createDefaultSolarAsset('financial-reuse-solar');
    solar.enabled = true;
    solar.dcCapacityKw = 5;
    solar.inverterAcCapacityKw = 5;
    solar.installedCostUsd = 5_000;
    solar.annualMaintenanceCostUsd = 100;
    input.generationConfig = {
      ...input.generationConfig,
      site: { latitude: 37.77, longitude: -122.4, elevationM: 0, timeZone: 'UTC' },
      assets: [solar],
    };

    const years = Array.from({ length: 25 }, (_, index) => createProjectionYear(index + 1));
    const projection = Object.assign([...years], { horizonYears: 25, years });
    const summary = runUnifiedSimulation({
      dataPoints: input.dataPoints.slice(0, 24),
      intervalHours: input.intervalHours,
      tiers: input.tiers,
      scheduleMatrix: input.scheduleMatrix,
      batteryProfile: profile,
      seasons: input.seasons,
      generationConfig: input.generationConfig,
      allowSolarExport: input.allowSolarExport,
    }).annualSummary;
    const unifiedResult = { mode: 'generation-aware' as const, annualSummary: summary };
    const costs = aggregateGenerationProjectCosts(input.generationConfig);
    const result = makeResult({
      activeUnifiedResult: unifiedResult,
      allSimulationSummaries: { [profile.id]: summary },
      activeGenerationOperationalProjection: projection,
      activeGenerationAnalysis: calculateGenerationAwareFinancials({
        batteryProfile: profile,
        operationalProjection: projection,
        projectCosts: costs,
        financials: input.financials,
      }),
    });
    const includedFinancials = {
      ...input.financials,
      annualOutageDays: 3,
      valueOfLostLoadPerDay: 200,
      includeVollInRoi: true,
    };
    const included = recalculateSimulationJobFinancials(result, input, includedFinancials);
    const excluded = recalculateSimulationJobFinancials(result, input, {
      ...includedFinancials,
      includeVollInRoi: false,
    });
    const directIncluded = calculateGenerationAwareFinancials({
      batteryProfile: profile,
      operationalProjection: projection,
      projectCosts: costs,
      financials: includedFinancials,
    });

    expect(included.activeGenerationAnalysis).toEqual(directIncluded);
    expect(included.activeGenerationAnalysis?.npvUsd).toBe(result.activeGenerationAnalysis?.npvUsd);
    expect(included.activeGenerationAnalysis?.lifetimeNetProfitUsd).toBe(result.activeGenerationAnalysis?.lifetimeNetProfitUsd);
    expect(included.activeGenerationAnalysis?.lifetimeRoiPercent).toBe(result.activeGenerationAnalysis?.lifetimeRoiPercent);
    expect(included.activeGenerationAnalysis?.lifetimeResilienceValueUsd).toBe(15_000);
    expect(included.activeGenerationAnalysis?.npvWithVollUsd).toBeGreaterThan(included.activeGenerationAnalysis?.npvUsd ?? 0);
    expect(included.activeGenerationAnalysis?.lifetimeNetProfitWithVollUsd).toBeGreaterThan(included.activeGenerationAnalysis?.lifetimeNetProfitUsd ?? 0);
    expect(included.activeGenerationAnalysis?.lifetimeRoiWithVollPercent).toBeGreaterThan(included.activeGenerationAnalysis?.lifetimeRoiPercent ?? 0);
    expect(excluded.activeGenerationAnalysis?.npvWithVollUsd).toBe(excluded.activeGenerationAnalysis?.npvUsd);
    expect(excluded.activeGenerationAnalysis?.lifetimeNetProfitWithVollUsd).toBe(excluded.activeGenerationAnalysis?.lifetimeNetProfitUsd);
    expect(excluded.activeGenerationAnalysis?.lifetimeRoiWithVollPercent).toBe(excluded.activeGenerationAnalysis?.lifetimeRoiPercent);
    expect(included.activeGenerationOperationalProjection).toBe(projection);
    expect(included.activeUnifiedResult).toBe(unifiedResult);
    expect(included.allSimulationSummaries).toBe(result.allSimulationSummaries);
  });
});

describe('simulation worker job', () => {
  it('matches direct unified-engine outputs and keeps interval detail for the active profile only', () => {
    const input = makeInput();
    const progress: number[] = [];
    const result = executeSimulationJob(input, (percent) => progress.push(percent));
    const direct = runUnifiedSimulation({
      dataPoints: input.dataPoints,
      intervalHours: input.intervalHours,
      tiers: input.tiers,
      scheduleMatrix: input.scheduleMatrix,
      batteryProfile: input.profiles[0],
      seasons: input.seasons,
      generationConfig: input.generationConfig,
      allowSolarExport: input.allowSolarExport,
    });

    expect(result.activeUnifiedResult).toEqual(direct);
    expect(result.allSimulationSummaries[input.activeProfileId].intervalResults).toEqual(direct.annualSummary.intervalResults);
    expect(result.allSimulationSummaries[input.profiles[1].id].intervalResults).toEqual([]);
    expect(progress.at(-1)).toBe(55);
  });

  it('matches the authoritative projection engine for an isolated absolute year', () => {
    const input = makeInput();
    input.dataPoints = generateRealistic8760Dataset().dataPoints;
    input.intervalHours = 1;
    const solar = createDefaultSolarAsset('worker-projection-solar');
    solar.dcCapacityKw = 5;
    solar.inverterAcCapacityKw = 5;
    solar.monthlyPeakSunHoursPerDay = Array(12).fill(4);
    input.generationConfig = {
      site: { latitude: 37.77, longitude: -122.4, elevationM: 0, timeZone: 'UTC' },
      assets: [solar],
    };
    const expected = calculateGenerationOperationalProjection({
      dataPoints: input.dataPoints,
      intervalHours: input.intervalHours,
      tiers: input.tiers,
      scheduleMatrix: input.scheduleMatrix,
      batteryProfile: input.profiles[0],
      seasons: input.seasons,
      generationConfig: input.generationConfig,
      allowSolarExport: input.allowSolarExport,
      annualElectricityInflationRate: input.financials.annualElectricityInflationRate,
      annualBatteryDegradationRate: input.financials.annualBatteryDegradationRate,
      projectionYears: 5,
      projectionStartYear: 3,
      projectionEndYear: 3,
      isSuitableForAnnual: true,
    });

    expect(executeGenerationProjectionYear(input, 3)).toEqual(expected.years[0]);
  }, 15000);

  it('returns a recoverable preflight error without invoking simulation', () => {
    const input = { ...makeInput(), preflightError: 'Invalid site-local timestamp.' };
    const result = executeSimulationJob(input);

    expect(result.simulationError).toBe(input.preflightError);
    expect(result.activeUnifiedResult).toBeNull();
  });

  it('rejects worker inputs above the shared interval ceiling before simulation', () => {
    const input = makeInput();
    input.dataPoints = new Array(35_137).fill(input.dataPoints[0]);
    const result = executeSimulationJob(input);

    expect(result.simulationError).toBe('Simulation input exceeds the supported maximum of 35,136 intervals.');
    expect(result.activeUnifiedResult).toBeNull();
  });
});

describe('simulation worker client', () => {
  it('resolves cancellation and ignores a late response after a newer request starts', async () => {
    const workers: FakeWorker[] = [];
    const client = createSimulationWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const first = client.run(makeInput());
    const second = client.run(makeInput());
    const firstResult = await first.promise;

    expect(firstResult.status).toBe('cancelled');
    expect(workers[0].terminated).toBe(true);

    const secondWorkerResponse: SimulationWorkerResponseMessage = {
      type: 'success', requestId: second.requestId,
      result: executeSimulationJob(makeInput()),
    };
    workers[1].respond(secondWorkerResponse);
    workers[0].respond({ ...secondWorkerResponse, requestId: first.requestId });

    expect((await second.promise).status).toBe('completed');
  });

  it('allows explicit cancellation to settle its promise without a worker response', async () => {
    const worker = new FakeWorker();
    const client = createSimulationWorkerClient(() => worker);
    const request = client.run(makeInput());

    request.cancel();

    expect(await request.promise).toMatchObject({ status: 'cancelled', requestId: request.requestId });
    expect(worker.terminated).toBe(true);
  });

  it('returns worker errors to the current request without leaving it pending', async () => {
    const worker = new FakeWorker();
    const client = createSimulationWorkerClient(() => worker);
    const task = client.run(makeInput());
    worker.onerror?.({ message: 'worker calculation failed' } as ErrorEvent);

    expect(await task.promise).toMatchObject({
      status: 'error',
      requestId: task.requestId,
      message: 'worker calculation failed',
    });
    expect(worker.terminated).toBe(true);
  });

  it('cancels an in-flight projection year before its late response can advance the job', async () => {
    const workers: FakeWorker[] = [];
    const client = createSimulationWorkerClient(() => {
      const worker = new FakeWorker();
      workers.push(worker);
      return worker;
    });
    const input = { ...makeInput(), annualProjectionEligible: true };
    const task = client.run(input);
    const base = executeSimulationJob(input);
    base.activeUnifiedResult = {
      mode: 'generation-aware',
      annualSummary: base.allSimulationSummaries[input.activeProfileId],
    };
    workers[0].respond({ type: 'success', requestId: task.requestId, result: base });
    await Promise.resolve();

    expect(workers).toHaveLength(2);
    task.cancel();
    workers[1].respond({ type: 'projection-year', requestId: task.requestId, year: {} as never });

    expect(await task.promise).toMatchObject({ status: 'cancelled', requestId: task.requestId });
    expect(workers[1].terminated).toBe(true);
    expect(workers).toHaveLength(2);
  });
});
