import { describe, expect, it } from 'vitest';
import { DEFAULT_BATTERY_PROFILES, DEFAULT_TOU_PROFILES, createDefaultScheduleMatrix } from '../utils/simulationEngine';
import { createDefaultGenerationConfig, createDefaultSolarAsset } from '../utils/generationDefaults';
import { generateStandardCsvTemplate } from '../utils/sampleData';
import { parseAndValidateEnergyCsv } from '../utils/csvParser';
import { runUnifiedSimulation } from '../utils/simulationRouter';
import { executeGenerationProjectionYear, executeSimulationJob, SimulationJobInput } from '../utils/simulationWorkerJob';
import { calculateGenerationOperationalProjection } from '../utils/generationProjection';
import { createSimulationWorkerClient, SimulationWorkerLike } from '../utils/simulationWorkerClient';
import { SimulationWorkerResponseMessage } from '../utils/simulationWorkerJob';

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
    generationConfig: createDefaultGenerationConfig(),
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
  });

  it('returns a recoverable preflight error without invoking simulation', () => {
    const input = { ...makeInput(), preflightError: 'Invalid site-local timestamp.' };
    const result = executeSimulationJob(input);

    expect(result.simulationError).toBe(input.preflightError);
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
