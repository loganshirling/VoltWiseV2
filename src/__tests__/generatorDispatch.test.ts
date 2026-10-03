import { describe, it, expect } from 'vitest';
import {
  GeneratorGenerationAsset,
  GeneratorFuelCurvePoint,
} from '../types/energy';
import {
  dispatchGeneratorInterval,
  extractSiteLocalClock,
  isGeneratorScheduledForInterval,
  calculateReferenceVariableCostPerKwh,
  sortEconomicGeneratorsMeritOrder,
  allocateScheduledGenerators,
  GeneratorRunningState,
} from '../utils/generatorDispatch';

function createTestScheduleMatrix(fillValue: boolean = false): boolean[][] {
  const matrix: boolean[][] = [];
  for (let d = 0; d < 7; d++) {
    const dayRow: boolean[] = [];
    for (let h = 0; h < 24; h++) {
      dayRow.push(fillValue);
    }
    matrix.push(dayRow);
  }
  return matrix;
}

function createSampleGenerator(
  overrides: Partial<GeneratorGenerationAsset> = {}
): GeneratorGenerationAsset {
  const defaultCurve: GeneratorFuelCurvePoint[] = [
    { loadPercent: 0, fuelUnitsPerHour: 0.2 },
    { loadPercent: 25, fuelUnitsPerHour: 0.5 },
    { loadPercent: 50, fuelUnitsPerHour: 0.8 },
    { loadPercent: 75, fuelUnitsPerHour: 1.1 },
    { loadPercent: 100, fuelUnitsPerHour: 1.5 },
  ];

  return {
    id: 'gen-1',
    name: 'Sample Generator',
    type: 'generator',
    enabled: true,
    ratedContinuousKw: 10,
    minimumStableLoadPercent: 25, // 2.5 kW minimum
    fuelType: 'natural_gas',
    fuelUnit: 'therm',
    customFuelUnitLabel: '',
    fuelPricePerUnit: 2.0, // $2.00 / therm
    variableMaintenanceCostPerHourUsd: 0.5, // $0.50 / hour
    startupFuelUnits: 0.25, // 0.25 therm on start ($0.50 start fuel cost)
    installedCostUsd: 5000,
    annualMaintenanceCostUsd: 200,
    fuelCurve: defaultCurve,
    dispatchMode: 'scheduled',
    allowBatteryCharging: false,
    allowGridExport: false,
    scheduledHours: createTestScheduleMatrix(false),
    ...overrides,
  };
}

describe('G6B Generator Dispatch Policy', () => {
  describe('Site-local Clock & Schedule Commitment', () => {
    it('correctly maps UTC instant to site-local dayOfWeek and hour for US/Pacific', () => {
      // 2026-06-15 02:00:00 UTC (Monday in UTC)
      // In America/Los_Angeles (UTC-7 in June PDT): 2026-06-14 19:00:00 (Sunday, hour 19)
      const instant = new Date(Date.UTC(2026, 5, 15, 2, 0, 0));
      const clockLA = extractSiteLocalClock(instant, 'America/Los_Angeles');
      expect(clockLA.dayOfWeek).toBe(0); // Sunday
      expect(clockLA.hour).toBe(19);

      // In America/New_York (UTC-4 in June EDT): 2026-06-14 22:00:00 (Sunday, hour 22)
      const clockNY = extractSiteLocalClock(instant, 'America/New_York');
      expect(clockNY.dayOfWeek).toBe(0); // Sunday
      expect(clockNY.hour).toBe(22);

      // In UTC: Monday, hour 2
      const clockUTC = extractSiteLocalClock(instant, 'UTC');
      expect(clockUTC.dayOfWeek).toBe(1); // Monday
      expect(clockUTC.hour).toBe(2);
    });

    it('respects DST transitions and is not tied to host local machine timezone', () => {
      // Winter: 2026-01-15 20:00:00 UTC -> America/Los_Angeles is PST (UTC-8) -> 12:00 (noon)
      const winterInstant = new Date(Date.UTC(2026, 0, 15, 20, 0, 0));
      const winterClock = extractSiteLocalClock(winterInstant, 'America/Los_Angeles');
      expect(winterClock.hour).toBe(12);

      // Summer: 2026-07-15 20:00:00 UTC -> America/Los_Angeles is PDT (UTC-7) -> 13:00 (1 PM)
      const summerInstant = new Date(Date.UTC(2026, 6, 15, 20, 0, 0));
      const summerClock = extractSiteLocalClock(summerInstant, 'America/Los_Angeles');
      expect(summerClock.hour).toBe(13);
    });

    it('remains OFF when scheduled cell is false and commits when true', () => {
      const schedule = createTestScheduleMatrix(false);
      // Enable Monday (1), hour 10
      schedule[1][10] = true;

      const gen = createSampleGenerator({
        dispatchMode: 'scheduled',
        scheduledHours: schedule,
      });

      // Monday hour 10 in UTC: 2026-06-15 10:00:00 UTC
      const onScheduleInstant = new Date(Date.UTC(2026, 5, 15, 10, 0, 0));
      expect(isGeneratorScheduledForInterval(gen, onScheduleInstant, 'UTC')).toBe(true);

      // Monday hour 11 in UTC: off schedule
      const offScheduleInstant = new Date(Date.UTC(2026, 5, 15, 11, 0, 0));
      expect(isGeneratorScheduledForInterval(gen, offScheduleInstant, 'UTC')).toBe(false);
    });
  });

  describe('Scheduled Output Behavior & Load Following', () => {
    it('applies minimum stable output when demand is below minimum', () => {
      const schedule = createTestScheduleMatrix(true);
      const gen = createSampleGenerator({
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 30, // min 3 kW
        scheduledHours: schedule,
      });

      const instant = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));
      const result = dispatchGeneratorInterval({
        assets: [gen],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 1.5, // 1.5 kW demand < 3 kW min
      });

      expect(result.totalOutputKw).toBe(3);
      expect(result.totalGeneratedKwh).toBe(3);
      expect(result.intervals[0].outputKw).toBe(3);
      expect(result.intervals[0].directLoadTargetKwh).toBe(1.5);
      expect(result.intervals[0].unavoidableSurplusKwh).toBe(1.5);
    });

    it('follows load inside operating range [minimum, rated]', () => {
      const schedule = createTestScheduleMatrix(true);
      const gen = createSampleGenerator({
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 20, // min 2 kW
        scheduledHours: schedule,
      });

      const instant = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));
      const result = dispatchGeneratorInterval({
        assets: [gen],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 6.5, // 6.5 kW demand
      });

      expect(result.totalOutputKw).toBe(6.5);
      expect(result.intervals[0].outputKw).toBe(6.5);
      expect(result.intervals[0].directLoadTargetKwh).toBe(6.5);
      expect(result.intervals[0].unavoidableSurplusKwh).toBe(0);
    });

    it('caps generation at rated continuous output when demand exceeds rating', () => {
      const schedule = createTestScheduleMatrix(true);
      const gen = createSampleGenerator({
        ratedContinuousKw: 8,
        minimumStableLoadPercent: 25, // 2 kW
        scheduledHours: schedule,
      });

      const instant = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));
      const result = dispatchGeneratorInterval({
        assets: [gen],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 12.0, // demand exceeds 8 kW
      });

      expect(result.totalOutputKw).toBe(8);
      expect(result.intervals[0].outputKw).toBe(8);
      expect(result.intervals[0].directLoadTargetKwh).toBe(8);
      expect(result.intervals[0].unavoidableSurplusKwh).toBe(0);
    });
  });

  describe('State Tracking, Starts, and Runtime Semantics', () => {
    it('counts first modeled running interval as a start', () => {
      const schedule = createTestScheduleMatrix(true);
      const gen = createSampleGenerator({ scheduledHours: schedule });
      const instant = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));

      const result = dispatchGeneratorInterval({
        assets: [gen],
        priorStates: [], // No prior running state
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 5.0,
      });

      expect(result.intervals[0].running).toBe(true);
      expect(result.intervals[0].startedThisInterval).toBe(true);
      expect(result.intervals[0].startupFuelUnits).toBe(gen.startupFuelUnits);
      expect(result.totalStarts).toBe(1);
    });

    it('does not count continuous RUNNING -> RUNNING as an additional start', () => {
      const schedule = createTestScheduleMatrix(true);
      const gen = createSampleGenerator({ scheduledHours: schedule });
      const instant = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));

      const prior: GeneratorRunningState[] = [{ assetId: gen.id, running: true }];
      const result = dispatchGeneratorInterval({
        assets: [gen],
        priorStates: prior,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 5.0,
      });

      expect(result.intervals[0].running).toBe(true);
      expect(result.intervals[0].startedThisInterval).toBe(false);
      expect(result.intervals[0].startupFuelUnits).toBe(0);
      expect(result.totalStarts).toBe(0);
    });

    it('counts RUNNING -> OFF -> RUNNING as another start', () => {
      const schedule = createTestScheduleMatrix(true);
      const gen = createSampleGenerator({ scheduledHours: schedule });
      const instant = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));

      // Prior interval was OFF
      const prior: GeneratorRunningState[] = [{ assetId: gen.id, running: false }];
      const result = dispatchGeneratorInterval({
        assets: [gen],
        priorStates: prior,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 5.0,
      });

      expect(result.intervals[0].running).toBe(true);
      expect(result.intervals[0].startedThisInterval).toBe(true);
      expect(result.intervals[0].startupFuelUnits).toBe(gen.startupFuelUnits);
      expect(result.totalStarts).toBe(1);
    });

    it('tracks state of independent assets separately', () => {
      const schedule = createTestScheduleMatrix(true);
      const genA = createSampleGenerator({ id: 'gen-A', name: 'Gen A', scheduledHours: schedule });
      const genB = createSampleGenerator({ id: 'gen-B', name: 'Gen B', scheduledHours: schedule });
      const instant = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));

      // Gen A was running, Gen B was OFF
      const prior: GeneratorRunningState[] = [
        { assetId: 'gen-A', running: true },
        { assetId: 'gen-B', running: false },
      ];

      const result = dispatchGeneratorInterval({
        assets: [genA, genB],
        priorStates: prior,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 10.0,
      });

      const recA = result.intervals.find((r) => r.assetId === 'gen-A')!;
      const recB = result.intervals.find((r) => r.assetId === 'gen-B')!;

      expect(recA.running).toBe(true);
      expect(recA.startedThisInterval).toBe(false);
      expect(recA.startupFuelUnits).toBe(0);

      expect(recB.running).toBe(true);
      expect(recB.startedThisInterval).toBe(true);
      expect(recB.startupFuelUnits).toBe(genB.startupFuelUnits);

      expect(result.totalStarts).toBe(1);
    });

    it('computes runtime correctly for hourly and sub-hourly intervals as generator-hours', () => {
      const schedule = createTestScheduleMatrix(true);
      const genA = createSampleGenerator({ id: 'gen-A', scheduledHours: schedule });
      const genB = createSampleGenerator({ id: 'gen-B', scheduledHours: schedule });
      const instant = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));

      // 1-hour interval with 2 generators running = 2.0 generator-hours
      const result1h = dispatchGeneratorInterval({
        assets: [genA, genB],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 15.0,
      });
      expect(result1h.intervals[0].runtimeHours).toBe(1.0);
      expect(result1h.intervals[1].runtimeHours).toBe(1.0);
      expect(result1h.totalRuntimeHours).toBe(2.0);

      // 15-minute (0.25h) interval = 0.50 generator-hours
      const result15m = dispatchGeneratorInterval({
        assets: [genA, genB],
        intervalHours: 0.25,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 5.0,
      });
      expect(result15m.intervals[0].runtimeHours).toBe(0.25);
      expect(result15m.intervals[1].runtimeHours).toBe(0.25);
      expect(result15m.totalRuntimeHours).toBe(0.5);
    });
  });

  describe('Multiple Scheduled Generators Allocation', () => {
    it('commits all scheduled units, gives each minimum output, and allocates headroom proportionally', () => {
      // Gen A: rated 10 kW, min 20% = 2 kW (headroom 8 kW)
      // Gen B: rated 20 kW, min 10% = 2 kW (headroom 18 kW)
      // Total min = 4 kW, total headroom = 26 kW
      const schedule = createTestScheduleMatrix(true);
      const genA = createSampleGenerator({
        id: 'gen-A',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 20,
        scheduledHours: schedule,
      });
      const genB = createSampleGenerator({
        id: 'gen-B',
        ratedContinuousKw: 20,
        minimumStableLoadPercent: 10,
        scheduledHours: schedule,
      });

      // Demand 17 kW:
      // additionalRequired = 17 - 4 = 13 kW (exactly half of 26 kW total headroom)
      // Gen A gets: 2 kW + 13 * (8 / 26) = 2 + 4 = 6 kW
      // Gen B gets: 2 kW + 13 * (18 / 26) = 2 + 9 = 11 kW
      const allocation = allocateScheduledGenerators([genA, genB], 17);
      expect(allocation.get('gen-A')).toBeCloseTo(6.0, 6);
      expect(allocation.get('gen-B')).toBeCloseTo(11.0, 6);

      const result = dispatchGeneratorInterval({
        assets: [genA, genB],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        residualHomeLoadKwh: 17.0,
      });
      expect(result.totalOutputKw).toBeCloseTo(17.0, 6);
    });

    it('keeps both scheduled units at minimum output when combined min exceeds load', () => {
      const schedule = createTestScheduleMatrix(true);
      const genA = createSampleGenerator({
        id: 'gen-A',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 30, // 3 kW min
        scheduledHours: schedule,
      });
      const genB = createSampleGenerator({
        id: 'gen-B',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 30, // 3 kW min
        scheduledHours: schedule,
      });

      // Combined min = 6 kW. Load = 2 kW. Both must remain committed at 3 kW.
      const result = dispatchGeneratorInterval({
        assets: [genA, genB],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        residualHomeLoadKwh: 2.0,
      });

      expect(result.totalOutputKw).toBe(6.0);
      expect(result.totalGeneratedKwh).toBe(6.0);
      expect(result.totalDirectLoadTargetKwh).toBe(2.0);
      expect(result.totalUnavoidableSurplusKwh).toBe(4.0);
    });

    it('produces identical per-ID and fleet results regardless of input array ordering', () => {
      const schedule = createTestScheduleMatrix(true);
      const genA = createSampleGenerator({
        id: 'gen-A',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 20,
        scheduledHours: schedule,
      });
      const genB = createSampleGenerator({
        id: 'gen-B',
        ratedContinuousKw: 20,
        minimumStableLoadPercent: 10,
        scheduledHours: schedule,
      });

      const instant = new Date(Date.UTC(2026, 5, 15, 12, 0, 0));
      const resOrder1 = dispatchGeneratorInterval({
        assets: [genA, genB],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 15.0,
      });

      const resOrder2 = dispatchGeneratorInterval({
        assets: [genB, genA],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: instant,
        residualHomeLoadKwh: 15.0,
      });

      expect(resOrder1.totalOutputKw).toBeCloseTo(resOrder2.totalOutputKw, 8);
      expect(resOrder1.totalFuelCostUsd).toBeCloseTo(resOrder2.totalFuelCostUsd, 8);

      const r1A = resOrder1.intervals.find((r) => r.assetId === 'gen-A')!;
      const r2A = resOrder2.intervals.find((r) => r.assetId === 'gen-A')!;
      expect(r1A.outputKw).toBeCloseTo(r2A.outputKw, 8);

      const r1B = resOrder1.intervals.find((r) => r.assetId === 'gen-B')!;
      const r2B = resOrder2.intervals.find((r) => r.assetId === 'gen-B')!;
      expect(r1B.outputKw).toBeCloseTo(r2B.outputKw, 8);
    });
  });

  describe('Economic Counterfactual & Candidate Economics', () => {
    it('remains OFF when counterfactual home grid import is zero or negative', () => {
      const econGen = createSampleGenerator({
        dispatchMode: 'economic',
        fuelPricePerUnit: 1.0,
        variableMaintenanceCostPerHourUsd: 0.1,
      });

      const resultZero = dispatchGeneratorInterval({
        assets: [econGen],
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 0,
        buyRate: 10.0, // Extremely high buy rate
        sellRate: 5.0,
      });

      expect(resultZero.totalOutputKw).toBe(0);
      expect(resultZero.intervals[0].running).toBe(false);
      expect(resultZero.intervals[0].economicAccepted).toBe(false);

      const resultNeg = dispatchGeneratorInterval({
        assets: [econGen],
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: -2.5,
        buyRate: 10.0,
      });
      expect(resultNeg.totalOutputKw).toBe(0);
      expect(resultNeg.intervals[0].running).toBe(false);
    });

    it('evaluates candidate output based on counterfactual import clamped to [min, rated]', () => {
      const econGen = createSampleGenerator({
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 20, // 2 kW min
        fuelPricePerUnit: 1.0,
        variableMaintenanceCostPerHourUsd: 0.1,
        fuelCurve: [
          { loadPercent: 20, fuelUnitsPerHour: 0.4 },
          { loadPercent: 50, fuelUnitsPerHour: 0.8 },
          { loadPercent: 100, fuelUnitsPerHour: 1.5 },
        ],
      });

      // Demand 1 kW (< min 2 kW): candidate clamps to 2 kW
      const resLow = dispatchGeneratorInterval({
        assets: [econGen],
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 1.0,
        buyRate: 5.0, // High enough to start
      });
      expect(resLow.intervals[0].outputKw).toBe(2.0);

      // Demand 15 kW (> rated 10 kW): candidate clamps to 10 kW
      const resHigh = dispatchGeneratorInterval({
        assets: [econGen],
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 15.0,
        buyRate: 5.0,
      });
      expect(resHigh.intervals[0].outputKw).toBe(10.0);
    });

    it('enforces strict benefit > operating cost rule (tie means OFF)', () => {
      // Setup generator with known operating cost at candidate load
      // rated 10 kW, 50% load = 5 kW.
      // At 50% load: fuelUnitsPerHour = 0.8 therm/h. fuelPrice = $2/therm -> fuelCost = $1.60
      // varMaint = $0.40/h. total operating = $2.00/h.
      // Already running (prior running = true) -> startupFuel = 0.
      const econGen = createSampleGenerator({
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        fuelPricePerUnit: 2.0,
        variableMaintenanceCostPerHourUsd: 0.40,
        startupFuelUnits: 1.0,
      });

      const prior: GeneratorRunningState[] = [{ assetId: econGen.id, running: true }];

      // Case 1: Exact tie ($2.00 operating cost vs $2.00 benefit)
      // Home load = 5 kWh, buyRate = $0.40/kWh -> benefit = 5 * 0.40 = $2.00.
      // Operating cost = $2.00.
      // Strict rule: 2.00 > 2.00 is FALSE -> MUST REMAIN OFF.
      const resTie = dispatchGeneratorInterval({
        assets: [econGen],
        priorStates: prior,
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 5.0,
        buyRate: 0.40,
      });
      expect(resTie.intervals[0].running).toBe(false);
      expect(resTie.intervals[0].economicAccepted).toBe(false);
      expect(resTie.totalOutputKw).toBe(0);

      // Case 2: Strictly positive economic benefit ($2.01 benefit > $2.00 cost)
      // buyRate = 0.402 -> benefit = 5 * 0.402 = $2.01.
      const resPositive = dispatchGeneratorInterval({
        assets: [econGen],
        priorStates: prior,
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 5.0,
        buyRate: 0.402,
      });
      expect(resPositive.intervals[0].running).toBe(true);
      expect(resPositive.intervals[0].economicAccepted).toBe(true);
      expect(resPositive.totalOutputKw).toBe(5.0);
    });

    it('accounts for startup fuel when generator was previously OFF vs RUNNING', () => {
      // Running operating cost = $2.00. Startup fuel = 1.0 therm * $2.00 = $2.00.
      // When OFF: candidate cost = $4.00.
      // When RUNNING: candidate cost = $2.00.
      const econGen = createSampleGenerator({
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        fuelPricePerUnit: 2.0,
        variableMaintenanceCostPerHourUsd: 0.40,
        startupFuelUnits: 1.0, // $2.00 startup cost
      });

      // Buy rate = $0.60/kWh. Benefit on 5 kWh = $3.00.
      // If OFF: cost ($4.00) > benefit ($3.00) -> REJECTED (remains OFF).
      const resOff = dispatchGeneratorInterval({
        assets: [econGen],
        priorStates: [{ assetId: econGen.id, running: false }],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 5.0,
        buyRate: 0.60,
      });
      expect(resOff.intervals[0].running).toBe(false);

      // If RUNNING: cost ($2.00) < benefit ($3.00) -> ACCEPTED (continues running).
      const resRunning = dispatchGeneratorInterval({
        assets: [econGen],
        priorStates: [{ assetId: econGen.id, running: true }],
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 5.0,
        buyRate: 0.60,
      });
      expect(resRunning.intervals[0].running).toBe(true);
    });

    it('handles finite negative and low buy rates without clamping to zero', () => {
      const econGen = createSampleGenerator({
        dispatchMode: 'economic',
      });

      const resNegative = dispatchGeneratorInterval({
        assets: [econGen],
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 5.0,
        buyRate: -0.05, // Negative electricity price
      });

      expect(resNegative.intervals[0].running).toBe(false);
      expect(resNegative.intervals[0].economicCandidateBenefitUsd).toBeLessThan(0);
    });
  });

  describe('Export Economics Boundary', () => {
    it('never starts a generator when counterfactual home grid import is zero even with huge export compensation', () => {
      const econGen = createSampleGenerator({
        dispatchMode: 'economic',
        allowGridExport: true,
      });

      const result = dispatchGeneratorInterval({
        assets: [econGen],
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 0,
        buyRate: 0.20,
        sellRate: 100.0, // $100/kWh export rate!
      });

      expect(result.totalOutputKw).toBe(0);
      expect(result.intervals[0].running).toBe(false);
    });

    it('does not deliberately increase output to obtain export revenue', () => {
      // Home demand = 4 kWh. Rated = 10 kW. Min = 2 kW.
      // Generator should output exactly 4 kW, NOT 10 kW to export 6 kW.
      const econGen = createSampleGenerator({
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 20, // 2 kW
        allowGridExport: true,
        fuelPricePerUnit: 1.0,
        variableMaintenanceCostPerHourUsd: 0.1,
      });

      const result = dispatchGeneratorInterval({
        assets: [econGen],
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 4.0,
        buyRate: 1.0,
        sellRate: 2.0, // Lucrative sell rate
      });

      expect(result.intervals[0].outputKw).toBe(4.0);
      expect(result.intervals[0].unavoidableSurplusKwh).toBe(0);
    });
  });

  describe('Economic Merit Order & Sequential Evaluation', () => {
    it('sorts candidates deterministically by full-load variable operating cost with asset ID tie-breaker', () => {
      // Gen A: 10 kW rated, 100% fuel = 1.5 therm/h * $2/therm = $3.00/h. maint = $0.50/h. total = $3.50/h -> $0.35/kWh
      // Gen B: 10 kW rated, 100% fuel = 1.0 therm/h * $2/therm = $2.00/h. maint = $0.50/h. total = $2.50/h -> $0.25/kWh (Cheaper)
      const genA = createSampleGenerator({
        id: 'gen-A',
        name: 'Gen A',
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        fuelCurve: [
          { loadPercent: 25, fuelUnitsPerHour: 0.5 },
          { loadPercent: 100, fuelUnitsPerHour: 1.5 },
        ],
      });

      const genB = createSampleGenerator({
        id: 'gen-B',
        name: 'Gen B',
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        fuelCurve: [
          { loadPercent: 25, fuelUnitsPerHour: 0.5 },
          { loadPercent: 100, fuelUnitsPerHour: 1.0 },
        ],
      });

      expect(calculateReferenceVariableCostPerKwh(genA)).toBeCloseTo(0.35, 6);
      expect(calculateReferenceVariableCostPerKwh(genB)).toBeCloseTo(0.25, 6);

      const sorted = sortEconomicGeneratorsMeritOrder([genA, genB]);
      expect(sorted[0].id).toBe('gen-B');
      expect(sorted[1].id).toBe('gen-A');

      // Reversing input produces the same sort
      const sortedRev = sortEconomicGeneratorsMeritOrder([genB, genA]);
      expect(sortedRev[0].id).toBe('gen-B');
      expect(sortedRev[1].id).toBe('gen-A');
    });

    it('breaks ties in reference variable cost using stable asset ID', () => {
      const genZ = createSampleGenerator({ id: 'gen-Z', dispatchMode: 'economic' });
      const genA = createSampleGenerator({ id: 'gen-A', dispatchMode: 'economic' });

      const sorted = sortEconomicGeneratorsMeritOrder([genZ, genA]);
      expect(sorted[0].id).toBe('gen-A');
      expect(sorted[1].id).toBe('gen-Z');
    });

    it('allows later candidates to be evaluated if earlier candidates are rejected', () => {
      // Gen 1 has cheaper reference full-load cost, BUT has large startup fuel and was OFF, making candidate cost exceed benefit.
      // Gen 2 has slightly higher reference cost, but was already RUNNING (no startup fuel), so its candidate cost is lower and gets accepted!
      const gen1 = createSampleGenerator({
        id: 'gen-1',
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        fuelPricePerUnit: 2.0,
        variableMaintenanceCostPerHourUsd: 0.1,
        startupFuelUnits: 5.0, // $10 startup cost!
        fuelCurve: [
          { loadPercent: 25, fuelUnitsPerHour: 0.5 },
          { loadPercent: 100, fuelUnitsPerHour: 1.0 },
        ],
      });

      const gen2 = createSampleGenerator({
        id: 'gen-2',
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        fuelPricePerUnit: 2.0,
        variableMaintenanceCostPerHourUsd: 0.1,
        startupFuelUnits: 1.0,
        fuelCurve: [
          { loadPercent: 25, fuelUnitsPerHour: 0.6 },
          { loadPercent: 100, fuelUnitsPerHour: 1.1 },
        ],
      });

      const prior: GeneratorRunningState[] = [
        { assetId: 'gen-1', running: false },
        { assetId: 'gen-2', running: true },
      ];

      // Demand 5 kWh, buyRate = $0.50/kWh -> benefit = $2.50.
      // Gen 1 candidate cost includes $10 startup fuel -> ~$11 > $2.50 -> REJECTED.
      // Gen 2 candidate cost has no startup fuel -> ~$1.50 < $2.50 -> ACCEPTED.
      const result = dispatchGeneratorInterval({
        assets: [gen1, gen2],
        priorStates: prior,
        intervalHours: 1.0,
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        counterfactualGridImportForHomeKwh: 5.0,
        buyRate: 0.50,
      });

      const rec1 = result.intervals.find((r) => r.assetId === 'gen-1')!;
      const rec2 = result.intervals.find((r) => r.assetId === 'gen-2')!;

      expect(rec1.running).toBe(false);
      expect(rec1.economicAccepted).toBe(false);

      expect(rec2.running).toBe(true);
      expect(rec2.economicAccepted).toBe(true);
      expect(rec2.outputKw).toBe(5.0);
    });
  });

  describe('Standby Mode', () => {
    it('always remains OFF with zero runtime, starts, fuel, and variable maintenance', () => {
      const standbyGen = createSampleGenerator({
        dispatchMode: 'standby',
        installedCostUsd: 10000,
        annualMaintenanceCostUsd: 500,
      });

      const result = dispatchGeneratorInterval({
        assets: [standbyGen],
        timeZone: 'UTC',
        instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
        residualHomeLoadKwh: 20.0,
        counterfactualGridImportForHomeKwh: 20.0,
        buyRate: 10.0,
      });

      expect(result.totalOutputKw).toBe(0);
      expect(result.totalGeneratedKwh).toBe(0);
      expect(result.totalRuntimeHours).toBe(0);
      expect(result.totalStarts).toBe(0);
      expect(result.totalFuelCostUsd).toBe(0);
      expect(result.totalVariableMaintenanceCostUsd).toBe(0);
      expect(result.totalOperatingCostUsd).toBe(0);

      const rec = result.intervals[0];
      expect(rec.running).toBe(false);
      expect(rec.outputKw).toBe(0);
      expect(rec.runtimeHours).toBe(0);
      expect(rec.fuelCostUsd).toBe(0);
      expect(rec.variableMaintenanceCostUsd).toBe(0);
    });
  });

  describe('Input Immutability', () => {
    it('does not mutate generator assets, fuel curves, schedules, or prior states', () => {
      const schedule = createTestScheduleMatrix(true);
      const fuelCurve: GeneratorFuelCurvePoint[] = [
        { loadPercent: 25, fuelUnitsPerHour: 0.5 },
        { loadPercent: 100, fuelUnitsPerHour: 1.5 },
      ];
      const gen = createSampleGenerator({
        scheduledHours: schedule,
        fuelCurve,
      });

      const assets = [gen];
      const priorStates: GeneratorRunningState[] = [{ assetId: gen.id, running: false }];

      // Deep freeze inputs to guarantee immutability
      Object.freeze(fuelCurve[0]);
      Object.freeze(fuelCurve[1]);
      Object.freeze(fuelCurve);
      for (const row of schedule) {
        Object.freeze(row);
      }
      Object.freeze(schedule);
      Object.freeze(gen);
      Object.freeze(assets);
      Object.freeze(priorStates[0]);
      Object.freeze(priorStates);

      expect(() => {
        dispatchGeneratorInterval({
          assets,
          priorStates,
          timeZone: 'UTC',
          instantUtc: new Date(Date.UTC(2026, 5, 15, 12, 0, 0)),
          residualHomeLoadKwh: 5.0,
        });
      }).not.toThrow();
    });
  });
});
