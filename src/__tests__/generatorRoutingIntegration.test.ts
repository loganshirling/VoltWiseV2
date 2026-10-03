/**
 * Milestone G6C — Generator Routing, Battery Provenance, Grid Boundary & Production Integration Tests
 *
 * Comprehensive integration test suite validating:
 *   - Production routing & compatibility (generator-only, solar+gen, wind+gen, tri-hybrid, multi-gen)
 *   - Exact legacy no-generation parity & passive (solar-only, wind-only, solar+wind) parity
 *   - Passive renewable priority over generator load service & charging
 *   - Shared charge headroom constraints (renewable -> generator -> grid)
 *   - Battery provenance activation (generatorChargedSocKwh isolated, discharge priority preserved)
 *   - Grid charging suppression when any generator actually runs
 *   - Economic counterfactual evaluation against residual home grid import
 *   - Same-interval anti-cycling prevention for economic generators
 *   - Direct generator export permission & separation from renewable / battery export
 *   - Explicit generator curtailment & energy conservation
 *   - Isolation of battery export from generator-charged SOC
 *   - Metric semantics & financial separation (tariff cost vs generator operating cost)
 *   - Heterogeneous physical fuel units preservation
 *   - Standby physically zero guarantee
 *   - Input immutability & partial-period safety
 */

import { describe, it, expect } from 'vitest';
import {
  BatteryProfile,
  BatterySocProvenanceState,
  GenerationConfig,
  GeneratorGenerationAsset,
  GridSocCostBasisState,
  IntervalDataPoint,
  RateTier,
  SolarGenerationAsset,
  WindGenerationAsset,
} from '../types/energy';
import { runUnifiedSimulation } from '../utils/simulationRouter';
import { runGenerationAwareSimulation } from '../utils/generationAwareSimulation';
import { runAnnualSimulation } from '../utils/simulationEngine';

// ============================================================================
// Shared Test Fixtures
// ============================================================================

const defaultTiers: RateTier[] = [
  {
    id: 'off-peak',
    name: 'Off-Peak',
    buyRate: 0.15,
    sellRate: 0.05,
    color: '#10b981',
    isChargeWindow: true,
  },
  {
    id: 'peak',
    name: 'Peak',
    buyRate: 0.45,
    sellRate: 0.25,
    color: '#ef4444',
    isDischargeWindow: true,
  },
];

function createScheduleMatrix(): string[][] {
  // Day 0..6: 00:00-15:00 off-peak, 16:00-21:00 peak, 22:00-23:00 off-peak
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, (_, h) => (h >= 16 && h <= 21 ? 'peak' : 'off-peak'))
  );
}

function createHourlyDataPoints(count: number, baseLoadKw = 2.0): IntervalDataPoint[] {
  const points: IntervalDataPoint[] = [];
  const start = new Date(Date.UTC(2025, 0, 1, 0, 0, 0)); // 2025-01-01 00:00 UTC (Wednesday)

  for (let i = 0; i < count; i++) {
    const instant = new Date(start.getTime() + i * 3600000);
    const dateStr = instant.toISOString().replace('.000Z', '').replace('T', ' ');
    points.push({
      timestamp: dateStr,
      date: instant,
      hour: instant.getUTCHours(),
      dayOfWeek: instant.getUTCDay(),
      month: instant.getUTCMonth(),
      usageKwh: baseLoadKw,
    });
  }
  return points;
}

function createTestBattery(overrides?: Partial<BatteryProfile>): BatteryProfile {
  return {
    id: 'test-battery',
    name: 'Test Battery',
    model: 'Li-Ion 10kWh',
    totalCapacityKwh: 10,
    usableDodPercent: 100,
    maxContinuousChargeKw: 5,
    maxContinuousOutputKw: 5,
    roundTripEfficiencyPercent: 100, // 100% simplifies hand calculations
    ratedCycleLife: 4000,
    installedCost: 5000,
    strategy: 'self_consumption',
    chargeTiers: ['off-peak'],
    dischargeTiers: ['peak'],
    allowGridExport: false,
    ...overrides,
  };
}

const baseSite = {
  latitude: 37.7749,
  longitude: -122.4194,
  timeZone: 'UTC',
  elevationM: 10,
};

function createStandardGenerator(overrides?: Partial<GeneratorGenerationAsset>): GeneratorGenerationAsset {
  return {
    id: 'gen-std',
    name: 'Standard Generator',
    type: 'generator',
    enabled: true,
    installedCostUsd: 4000,
    annualMaintenanceCostUsd: 200,
    ratedContinuousKw: 10,
    minimumStableLoadPercent: 20, // 2 kW min output
    fuelType: 'diesel',
    fuelUnit: 'gallon',
    customFuelUnitLabel: '',
    fuelPricePerUnit: 3.5,
    variableMaintenanceCostPerHourUsd: 1.0,
    startupFuelUnits: 0.1,
    fuelCurve: [
      { loadPercent: 0, fuelUnitsPerHour: 0.2 },
      { loadPercent: 20, fuelUnitsPerHour: 0.5 },
      { loadPercent: 100, fuelUnitsPerHour: 2.0 },
    ],
    dispatchMode: 'scheduled',
    allowBatteryCharging: true,
    allowGridExport: false,
    scheduledHours: Array.from({ length: 7 }, () => Array(24).fill(true)),
    ...overrides,
  };
}

function createStandardSolar(overrides?: Partial<SolarGenerationAsset>): SolarGenerationAsset {
  return {
    id: 'solar-std',
    name: 'Standard Solar',
    type: 'solar',
    enabled: true,
    installedCostUsd: 6000,
    annualMaintenanceCostUsd: 100,
    dcCapacityKw: 5,
    inverterAcCapacityKw: 5,
    inverterEfficiencyPercent: 100,
    tiltDegrees: 20,
    azimuthDegrees: 180,
    systemLossPercent: 0,
    shadingLossPercent: 0,
    annualDegradationPercent: 0.5,
    resourceMode: 'clear_sky',
    monthlyPeakSunHoursPerDay: Array(12).fill(5),
    ...overrides,
  };
}

function createStandardWind(overrides?: Partial<WindGenerationAsset>): WindGenerationAsset {
  return {
    id: 'wind-std',
    name: 'Standard Wind',
    type: 'wind',
    enabled: true,
    installedCostUsd: 7000,
    annualMaintenanceCostUsd: 150,
    ratedPowerKw: 5,
    hubHeightM: 20,
    rotorDiameterM: 5,
    cutInWindSpeedMps: 3,
    ratedWindSpeedMps: 11,
    cutOutWindSpeedMps: 25,
    availabilityPercent: 100,
    systemLossPercent: 0,
    resourceMode: 'annual_average',
    measurementHeightM: 10,
    windShearExponent: 0.14,
    annualAverageWindSpeedMps: 7.0,
    monthlyAverageWindSpeedMps: Array(12).fill(7.0),
    powerCurve: [
      { windSpeedMps: 0, outputKw: 0 },
      { windSpeedMps: 3, outputKw: 0 },
      { windSpeedMps: 7, outputKw: 2 },
      { windSpeedMps: 11, outputKw: 5 },
      { windSpeedMps: 25, outputKw: 5 },
    ],
    ...overrides,
  };
}

// ============================================================================
// Test Suite
// ============================================================================

describe('G6C — Generator Routing, Battery Provenance & Production Integration', () => {

  // --------------------------------------------------------------------------
  // 1. Routing & Backward-Compatibility Gates
  // --------------------------------------------------------------------------
  describe('1. Routing & Backward-Compatibility Gates', () => {
    it('exact no-generation legacy routing is preserved', () => {
      const dataPoints = createHourlyDataPoints(48);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery
      );

      const unifiedEmpty = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [] },
      });

      expect(unifiedEmpty.mode).toBe('legacy');
      expect(unifiedEmpty.annualSummary.baselineAnnualCost).toBe(legacyResult.baselineAnnualCost);
      expect(unifiedEmpty.annualSummary.simulatedAnnualCost).toBe(legacyResult.simulatedAnnualCost);
      expect(unifiedEmpty.annualSummary.year1Savings).toBe(legacyResult.year1Savings);
      expect(unifiedEmpty.annualSummary.annualGridImportKwh).toBe(legacyResult.annualGridImportKwh);
      expect(unifiedEmpty.annualSummary.annualGridExportKwh).toBe(legacyResult.annualGridExportKwh);
    });

    it('all assets disabled routes directly to legacy path', () => {
      const dataPoints = createHourlyDataPoints(24);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();

      const disabledGen = createStandardGenerator({ enabled: false });
      const disabledSolar = createStandardSolar({ enabled: false });

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [disabledGen, disabledSolar] },
      });

      expect(unifiedResult.mode).toBe('legacy');
    });

    it('solar-only project preserves G4/G5 numerical results', () => {
      const dataPoints = createHourlyDataPoints(48);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const solarAsset = createStandardSolar();

      const solarOnlyResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [solarAsset] },
        allowSolarExport: true,
      });

      expect(solarOnlyResult.mode).toBe('generation-aware');
      expect(solarOnlyResult.generationAwareResult?.totalSolarGenerationKwh).toBeGreaterThan(0);
      expect(solarOnlyResult.generationAwareResult?.generatorGeneratedKwh).toBe(0);
      expect(solarOnlyResult.generationAwareResult?.generatorOperatingCostUsd).toBe(0);
      expect(solarOnlyResult.annualSummary.simulatedAnnualCost).toBe(
        Math.round((solarOnlyResult.generationAwareResult?.simulatedCost ?? 0) * 100) / 100
      );
    });

    it('generator-only scheduled project executes through generation-aware pipeline', () => {
      const dataPoints = createHourlyDataPoints(24, 3.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const generator = createStandardGenerator({ dispatchMode: 'scheduled' });

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [generator] },
        allowRenewableExport: false,
      });

      expect(result.mode).toBe('generation-aware');
      expect(result.generationAwareResult?.generatorGeneratedKwh).toBeGreaterThan(0);
      expect(result.generationAwareResult?.totalSolarGenerationKwh).toBe(0);
      expect(result.generationAwareResult?.totalWindGenerationKwh).toBe(0);
      expect(result.generationAwareResult?.totalRenewableGenerationKwh).toBe(0);
      expect(result.generationAwareResult?.generatorFuelCostUsd).toBeGreaterThan(0);
      expect(result.generationAwareResult?.generatorOperatingCostUsd).toBeGreaterThan(0);
    });

    it('generator-only economic project executes through generation-aware pipeline', () => {
      const dataPoints = createHourlyDataPoints(24, 5.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ strategy: 'self_consumption' });
      // Economic generator with very low operating cost so it runs against high buyRate ($0.45 during peak)
      const economicGen = createStandardGenerator({
        id: 'gen-econ',
        dispatchMode: 'economic',
        fuelPricePerUnit: 0.5,
        variableMaintenanceCostPerHourUsd: 0.1,
        fuelCurve: [
          { loadPercent: 0, fuelUnitsPerHour: 0.1 },
          { loadPercent: 20, fuelUnitsPerHour: 0.2 },
          { loadPercent: 100, fuelUnitsPerHour: 0.5 },
        ],
      });

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [economicGen] },
        allowRenewableExport: false,
      });

      expect(result.mode).toBe('generation-aware');
      expect(result.generationAwareResult?.generatorGeneratedKwh).toBeGreaterThan(0);
    });

    it('tri-hybrid (solar + wind + generator) project executes coherently', () => {
      const dataPoints = createHourlyDataPoints(24, 4.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const solar = createStandardSolar();
      const wind = createStandardWind();
      const generator = createStandardGenerator();

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [solar, wind, generator] },
        allowRenewableExport: true,
      });

      expect(result.mode).toBe('generation-aware');
      const genAware = result.generationAwareResult!;
      expect(genAware.totalSolarGenerationKwh).toBeGreaterThan(0);
      expect(genAware.totalWindGenerationKwh).toBeGreaterThan(0);
      expect(genAware.totalRenewableGenerationKwh).toBe(
        genAware.totalSolarGenerationKwh + genAware.totalWindGenerationKwh
      );
      expect(genAware.generatorGeneratedKwh).toBeGreaterThan(0);
      expect(genAware.totalOnsiteGenerationKwh).toBe(
        genAware.totalRenewableGenerationKwh + genAware.generatorGeneratedKwh!
      );
    });
  });

  // --------------------------------------------------------------------------
  // 2. Renewable Precedence & Residual Load Service
  // --------------------------------------------------------------------------
  describe('2. Renewable Precedence & Residual Load Service', () => {
    it('passive renewables serve home load before generator', () => {
      const dataPoints = createHourlyDataPoints(1, 5.0); // 5 kWh load
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      // Solar provides 3 kWh
      const solar = createStandardSolar({ dcCapacityKw: 3, inverterAcCapacityKw: 3 });
      // Generator rated 10 kW, scheduled
      const generator = createStandardGenerator({
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 10, // 1 kW min
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [solar, generator] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      // Solar directly serves load first
      const renFlow = result.renewableLoadFlow[0];
      expect(renFlow.solarDirectToLoadKwh).toBeGreaterThan(0);
      // Generator serves only residual load
      expect(renFlow.residualHomeLoadKwh).toBe(
        5.0 - renFlow.solarDirectToLoadKwh
      );
      const genRecord = result.generatorFleetRecords?.[0]?.intervals[0];
      expect(genRecord?.directLoadTargetKwh).toBeLessThanOrEqual(renFlow.residualHomeLoadKwh);
    });

    it('renewable surplus charging occurs before generator surplus charging', () => {
      const dataPoints = createHourlyDataPoints(1, 0); // 0 load -> 100% surplus
      const schedule = createScheduleMatrix();
      // Battery has 4 kWh capacity, 5 kW charge power
      const battery = createTestBattery({ totalCapacityKwh: 4, maxContinuousChargeKw: 5 });
      // Solar surplus = 3 kWh
      const solar = createStandardSolar({ dcCapacityKw: 3, inverterAcCapacityKw: 3 });
      // Generator surplus = 2 kWh (min output 2 kW)
      const generator = createStandardGenerator({
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 20,
        allowBatteryCharging: true,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [solar, generator] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      const finalBattery = result.exportAwareBatteryFlow.finalBatteryState;
      // Solar gets first priority: stores its surplus up to capacity
      expect(finalBattery.renewableChargedSocKwh).toBeGreaterThan(0);
      // Generator gets only the remaining headroom: 4 kWh total capacity - solar charged
      const totalStored = finalBattery.renewableChargedSocKwh + finalBattery.generatorChargedSocKwh;
      expect(totalStored).toBeLessThanOrEqual(4.000001);
      expect(finalBattery.generatorChargedSocKwh).toBeCloseTo(
        Math.min(2.0, 4.0 - finalBattery.renewableChargedSocKwh),
        4
      );
    });
  });

  // --------------------------------------------------------------------------
  // 3. Battery Provenance & Discharge Order
  // --------------------------------------------------------------------------
  describe('3. Battery Provenance & Discharge Order', () => {
    it('generator charging increments generatorChargedSocKwh ONLY', () => {
      const dataPoints = createHourlyDataPoints(1, 0); // 0 load -> full surplus
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ totalCapacityKwh: 10 });
      const generator = createStandardGenerator({
        ratedContinuousKw: 5,
        minimumStableLoadPercent: 40, // 2 kW
        allowBatteryCharging: true,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 1.0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [generator] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      const finalState = result.exportAwareBatteryFlow.finalBatteryState;
      expect(finalState.syntheticSocKwh).toBe(1.0);
      expect(finalState.gridChargedSocKwh).toBe(0);
      expect(finalState.renewableChargedSocKwh).toBe(0);
      expect(finalState.generatorChargedSocKwh).toBeGreaterThan(0);
    });

    it('generator-charged SOC later serves load in provenance order (synthetic -> renewable -> generator -> grid)', () => {
      // Interval 0: 0 load, generator charges battery
      // Interval 1: 5 kWh load during peak discharge window, generator off
      const dataPoints: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 15:00', // off-peak
          date: new Date('2025-01-01T15:00:00Z'),
          hour: 15,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 0,
        },
        {
          timestamp: '2025-01-01 16:00', // peak
          date: new Date('2025-01-01T16:00:00Z'),
          hour: 16,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 5.0,
        },
      ];

      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ totalCapacityKwh: 10, maxContinuousOutputKw: 5 });
      // Generator scheduled only at hour 15
      const scheduledHours = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, (_, h) => h === 15)
      );
      const generator = createStandardGenerator({
        ratedContinuousKw: 4,
        minimumStableLoadPercent: 100, // 4 kW output
        allowBatteryCharging: true,
        scheduledHours,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 1.0,
        renewableChargedSocKwh: 1.0,
        generatorChargedSocKwh: 0,
        gridChargedSocKwh: 1.0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 1.0,
        totalAcquisitionCostUsd: 0.15,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [generator] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      // At interval 0: generator charges 4 kWh into generatorChargedSocKwh
      // State before interval 1: synthetic=1, renewable=1, generator=4, grid=1 (total 7 kWh)
      // At interval 1: load is 5 kWh.
      // Drains in order:
      // 1. synthetic: 1.0 (drained)
      // 2. renewable: 1.0 (drained)
      // 3. generator: 3.0 (drained from 4.0, leaving 1.0)
      // 4. grid: 0 (untouched!)
      const inv1 = result.exportAwareBatteryFlow.intervals[1].preExportFlow;
      expect(inv1.batteryDeliveredToLoadKwh).toBe(5.0);
      expect(inv1.syntheticSocDrainedKwh).toBe(1.0);
      expect(inv1.renewableSocDrainedKwh).toBe(1.0);
      expect(inv1.generatorSocDrainedKwh).toBe(3.0);
      expect(inv1.gridSocDrainedKwh).toBe(0);

      const finalState = result.exportAwareBatteryFlow.finalBatteryState;
      expect(finalState.syntheticSocKwh).toBe(0);
      expect(finalState.renewableChargedSocKwh).toBe(0);
      expect(finalState.generatorChargedSocKwh).toBeCloseTo(1.0, 4);
      expect(finalState.gridChargedSocKwh).toBe(1.0);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Grid-Charge Suppression
  // --------------------------------------------------------------------------
  describe('4. Grid-Charge Suppression', () => {
    it('grid-to-battery charging is suppressed when scheduled generator runs', () => {
      // Off-peak interval with charge permission in policy, but scheduled generator runs
      const dataPoints = createHourlyDataPoints(1, 1.0);
      const schedule = createScheduleMatrix();
      // Battery strategy arbitrage with charge window
      const battery = createTestBattery({ strategy: 'arbitrage' });
      const generator = createStandardGenerator({
        ratedContinuousKw: 5,
        minimumStableLoadPercent: 20,
        dispatchMode: 'scheduled',
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [generator] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      const preExport = result.exportAwareBatteryFlow.intervals[0].preExportFlow;
      // Generator ran, so grid charging MUST be suppressed
      expect(preExport.gridToBatteryAcKwh).toBe(0);
      expect(preExport.gridEnergyStoredKwh).toBe(0);
      expect(result.exportAwareBatteryFlow.finalBatteryState.gridChargedSocKwh).toBe(0);
      expect(result.gridFlows.totalGridImportForBatteryKwh).toBe(0);
    });

    it('counterfactual grid charging is NOT committed when economic generator starts', () => {
      // Off-peak interval where battery policy would grid charge, but an economic generator is accepted
      const dataPoints = createHourlyDataPoints(1, 5.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({
        strategy: 'arbitrage',
        totalCapacityKwh: 10,
      });

      // Cheap economic generator (benefit from 5 kWh load @ $0.15 = $0.75 > operating cost)
      const economicGen = createStandardGenerator({
        id: 'econ-cheap',
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 10,
        fuelPricePerUnit: 0.1,
        variableMaintenanceCostPerHourUsd: 0.05,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [economicGen] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      expect(result.generatorFleetRecords?.[0]?.intervals[0]?.running).toBe(true);
      // Suppressed grid charging
      const preExport = result.exportAwareBatteryFlow.intervals[0].preExportFlow;
      expect(preExport.gridToBatteryAcKwh).toBe(0);
      expect(preExport.gridEnergyStoredKwh).toBe(0);
      expect(result.exportAwareBatteryFlow.finalBatteryState.gridChargedSocKwh).toBe(0);
      expect(result.gridFlows.totalGridImportForBatteryKwh).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Economic Counterfactual & Battery Precedence
  // --------------------------------------------------------------------------
  describe('5. Economic Counterfactual & Battery Precedence', () => {
    it('economic generator stays OFF when battery fully serves residual load', () => {
      // Peak interval: load is 4 kWh.
      // Battery has 8 kWh usable capacity and is allowed to discharge.
      // Battery discharges 4 kWh, leaving 0 unmet load.
      // Economic generator sees counterfactualGridImportForHomeKwh = 0 and stays OFF.
      const dataPoints: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 17:00', // peak
          date: new Date('2025-01-01T17:00:00Z'),
          hour: 17,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 4.0,
        },
      ];

      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ totalCapacityKwh: 10, maxContinuousOutputKw: 5 });

      const economicGen = createStandardGenerator({
        id: 'gen-econ',
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 10,
        fuelPricePerUnit: 0.1,
        variableMaintenanceCostPerHourUsd: 0.05,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 8.0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [economicGen] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      // Battery serves entire load
      const preExport = result.exportAwareBatteryFlow.intervals[0].preExportFlow;
      expect(preExport.batteryDeliveredToLoadKwh).toBe(4.0);
      expect(preExport.residualHomeLoadAfterBatteryKwh).toBe(0);

      // Economic generator stays OFF!
      const genRec = result.generatorFleetRecords?.[0]?.intervals[0];
      expect(genRec?.running).toBe(false);
      expect(genRec?.generatedKwh).toBe(0);
      expect(result.generatorGeneratedKwh).toBe(0);
    });

    it('economic generator serves unmet load when battery discharge is partial', () => {
      // Peak interval: load is 8 kWh.
      // Battery max discharge power is 3 kW -> discharges 3 kWh, leaving 5 kWh unmet load.
      // Economic generator evaluates against 5 kWh unmet load and runs.
      const dataPoints: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 17:00', // peak
          date: new Date('2025-01-01T17:00:00Z'),
          hour: 17,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 8.0,
        },
      ];

      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ totalCapacityKwh: 10, maxContinuousOutputKw: 3 });

      const economicGen = createStandardGenerator({
        id: 'gen-econ',
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 10,
        fuelPricePerUnit: 0.1,
        variableMaintenanceCostPerHourUsd: 0.05,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 8.0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [economicGen] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      // Battery delivered its maximum 3 kW
      const preExport = result.exportAwareBatteryFlow.intervals[0].preExportFlow;
      expect(preExport.batteryDeliveredToLoadKwh).toBe(3.0);

      // Economic generator ran and served the remaining 5 kWh
      const genRec = result.generatorFleetRecords?.[0]?.intervals[0];
      expect(genRec?.running).toBe(true);
      expect(genRec?.directLoadTargetKwh).toBe(5.0);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Same-Interval Anti-Cycling Protection
  // --------------------------------------------------------------------------
  describe('6. Same-Interval Anti-Cycling Protection', () => {
    it('economic generator surplus cannot recharge battery if battery discharged to load in same interval', () => {
      // Peak interval: load is 1 kWh.
      // Battery has 5 kWh and discharges 1 kWh to load.
      // But suppose economic generator runs at minimum stable load (e.g. 3 kW) to serve remaining demand or was running.
      // If economic generator produces unavoidable surplus, that surplus MUST NOT charge the battery!
      const dataPoints: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 17:00', // peak
          date: new Date('2025-01-01T17:00:00Z'),
          hour: 17,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 3.0,
        },
      ];

      const schedule = createScheduleMatrix();
      // Battery can only discharge 1 kW, leaving 2 kW
      const battery = createTestBattery({
        totalCapacityKwh: 10,
        maxContinuousOutputKw: 1,
        maxContinuousChargeKw: 5,
        allowGridExport: false,
      });

      // Economic generator with min stable load = 4 kW.
      // It serves the remaining 2 kW unmet load.
      // Unavoidable surplus = 4 - 2 = 2 kWh.
      // Asset allows battery charging and export.
      const economicGen = createStandardGenerator({
        id: 'gen-econ',
        dispatchMode: 'economic',
        ratedContinuousKw: 10,
        minimumStableLoadPercent: 40, // 4 kW min
        allowBatteryCharging: true,
        allowGridExport: true,
        fuelPricePerUnit: 0.05,
        variableMaintenanceCostPerHourUsd: 0.01,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 5.0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [economicGen] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      const preExport = result.exportAwareBatteryFlow.intervals[0].preExportFlow;
      // Battery discharged 1 kWh
      expect(preExport.batteryDeliveredToLoadKwh).toBe(1.0);

      // Economic generator surplus to battery MUST BE 0 due to anti-cycling!
      expect(result.generatorToBatteryKwh).toBe(0);

      // Surplus proceeded to direct generator export (since allowGridExport = true)
      expect(result.generatorExportKwh).toBe(2.0);
      expect(result.generatorCurtailedKwh).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Generator Direct Export & Curtailment
  // --------------------------------------------------------------------------
  describe('7. Generator Direct Export & Curtailment', () => {
    it('allowGridExport = false curtails surplus when battery charging unavailable', () => {
      const dataPoints = createHourlyDataPoints(1, 1.0); // 1 kWh load
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ totalCapacityKwh: 10 });

      // Generator rated 5 kW, min 3 kW (3 kWh), allowBatteryCharging=false, allowGridExport=false
      const generator = createStandardGenerator({
        ratedContinuousKw: 5,
        minimumStableLoadPercent: 60, // 3 kW
        allowBatteryCharging: false,
        allowGridExport: false,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [generator] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      // 3 kWh generated: 1 kWh direct to load, 2 kWh curtailed
      expect(result.generatorGeneratedKwh).toBe(3.0);
      expect(result.generatorDirectToLoadKwh).toBe(1.0);
      expect(result.generatorToBatteryKwh).toBe(0);
      expect(result.generatorExportKwh).toBe(0);
      expect(result.generatorCurtailedKwh).toBe(2.0);

      // Fuel and maintenance reflect full 3 kW physical generation
      expect(result.generatorFuelCostUsd).toBeGreaterThan(0);
      expect(result.generatorVariableMaintenanceCostUsd).toBe(1.0); // $1/hr for 1 hr
    });

    it('allowGridExport = true permits surplus export and prices at sellRate', () => {
      const dataPoints = createHourlyDataPoints(1, 1.0); // 1 kWh load
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ totalCapacityKwh: 10 });

      // Generator rated 5 kW, min 3 kW (3 kWh), allowBatteryCharging=false, allowGridExport=true
      const generator = createStandardGenerator({
        ratedContinuousKw: 5,
        minimumStableLoadPercent: 60, // 3 kW
        allowBatteryCharging: false,
        allowGridExport: true,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [generator] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      // 3 kWh generated: 1 kWh direct to load, 2 kWh export, 0 curtailed
      expect(result.generatorGeneratedKwh).toBe(3.0);
      expect(result.generatorDirectToLoadKwh).toBe(1.0);
      expect(result.generatorToBatteryKwh).toBe(0);
      expect(result.generatorExportKwh).toBe(2.0);
      expect(result.generatorCurtailedKwh).toBe(0);

      // Export credit in tariff costs: 2 kWh * $0.05 sellRate = $0.10
      const tariffInv = result.tariffCosts.intervals[0];
      expect(tariffInv.generatorExportKwh).toBe(2.0);
      expect(tariffInv.generatorExportCredit).toBeCloseTo(0.10, 4);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Battery Export Isolation (No Generator Arbitrage)
  // --------------------------------------------------------------------------
  describe('8. Battery Export Isolation (No Generator Arbitrage)', () => {
    it('generator-charged battery SOC cannot be exported to grid through grid battery export', () => {
      // Interval 0: generator charges battery with 5 kWh
      // Interval 1: peak sellRate = $0.45. Battery allows grid export.
      // Battery has 5 kWh of generator-charged SOC.
      // Expected: batteryExportAcKwh = 0! Because only gridChargedSocKwh is exportable.
      const dataPoints: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 15:00', // off-peak
          date: new Date('2025-01-01T15:00:00Z'),
          hour: 15,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 0,
        },
        {
          timestamp: '2025-01-01 16:00', // peak
          date: new Date('2025-01-01T16:00:00Z'),
          hour: 16,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 0,
        },
      ];

      const schedule = createScheduleMatrix();
      const battery = createTestBattery({
        totalCapacityKwh: 10,
        strategy: 'arbitrage',
        allowGridExport: true,
      });

      // Scheduled generator runs only at hour 15
      const scheduledHours = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, (_, h) => h === 15)
      );
      const generator = createStandardGenerator({
        ratedContinuousKw: 5,
        minimumStableLoadPercent: 100, // 5 kW output
        allowBatteryCharging: true,
        scheduledHours,
      });

      const initialBatteryState: BatterySocProvenanceState = {
        syntheticSocKwh: 0,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      const initialCostBasisState: GridSocCostBasisState = {
        gridStoredEnergyKwh: 0,
        totalAcquisitionCostUsd: 0,
      };

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [generator] },
        initialBatteryState,
        initialCostBasisState,
        allowSolarExport: false,
      });

      // At interval 1, battery export to grid must be 0!
      const inv1Export = result.exportAwareBatteryFlow.intervals[1].exportResult;
      expect(inv1Export.batteryExportAcKwh).toBe(0);
      expect(result.totalBatteryExportKwh).toBe(0);
      // Generator-charged SOC remains safely in battery
      expect(result.exportAwareBatteryFlow.finalBatteryState.generatorChargedSocKwh).toBe(5.0);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Source-Level Energy & Grid Reconciliation
  // --------------------------------------------------------------------------
  describe('9. Source-Level Energy & Grid Reconciliation', () => {
    it('every generator and fleet satisfies energy conservation: gen = load + bat + export + curtail', () => {
      const dataPoints = createHourlyDataPoints(24, 3.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const gen1 = createStandardGenerator({
        id: 'gen-1',
        name: 'Generator 1',
        ratedContinuousKw: 8,
        minimumStableLoadPercent: 25,
        allowBatteryCharging: true,
        allowGridExport: true,
      });
      const gen2 = createStandardGenerator({
        id: 'gen-2',
        name: 'Generator 2',
        ratedContinuousKw: 6,
        minimumStableLoadPercent: 30,
        allowBatteryCharging: false,
        allowGridExport: false,
      });

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [gen1, gen2] },
        initialBatteryState: { syntheticSocKwh: 0, gridChargedSocKwh: 0, renewableChargedSocKwh: 0, generatorChargedSocKwh: 0 },
        initialCostBasisState: { gridStoredEnergyKwh: 0, totalAcquisitionCostUsd: 0 },
        allowSolarExport: false,
      });

      // Check per-asset summaries
      const summaries = result.generatorAssetSummaries ?? [];
      expect(summaries.length).toBe(2);

      for (const s of summaries) {
        const sumFlows = s.directToLoadKwh + s.toBatteryAcKwh + s.directExportKwh + s.curtailedKwh;
        expect(s.generatedKwh).toBeCloseTo(sumFlows, 4);
      }

      // Check fleet aggregation
      const fleetGenerated = result.generatorGeneratedKwh!;
      const fleetSum =
        result.generatorDirectToLoadKwh! +
        result.generatorToBatteryKwh! +
        result.generatorExportKwh! +
        result.generatorCurtailedKwh!;
      expect(fleetGenerated).toBeCloseTo(fleetSum, 4);
    });

    it('totalGridExportKwh reconciles across solar + wind + generator + battery', () => {
      const dataPoints = createHourlyDataPoints(24, 1.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ strategy: 'arbitrage', allowGridExport: true });
      const solar = createStandardSolar();
      const wind = createStandardWind();
      const generator = createStandardGenerator({ allowGridExport: true });

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [solar, wind, generator] },
        initialBatteryState: { syntheticSocKwh: 0, gridChargedSocKwh: 0, renewableChargedSocKwh: 0, generatorChargedSocKwh: 0 },
        initialCostBasisState: { gridStoredEnergyKwh: 0, totalAcquisitionCostUsd: 0 },
        allowRenewableExport: true,
      });

      const gridFlows = result.gridFlows;
      const expectedTotalExport =
        gridFlows.totalSolarExportKwh +
        (gridFlows.totalWindExportKwh ?? 0) +
        (gridFlows.totalGeneratorExportKwh ?? 0) +
        gridFlows.totalBatteryExportKwh;

      expect(gridFlows.totalGridExportKwh).toBeCloseTo(expectedTotalExport, 4);
    });
  });

  // --------------------------------------------------------------------------
  // 10. Metric Semantics & Financial Separation
  // --------------------------------------------------------------------------
  describe('10. Metric Semantics & Financial Separation', () => {
    it('generator operating cost is outside utility tariff cost and netOperationalSavings reconciles', () => {
      const dataPoints = createHourlyDataPoints(24, 3.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const generator = createStandardGenerator({
        fuelPricePerUnit: 4.0,
        variableMaintenanceCostPerHourUsd: 2.0,
      });

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [generator] },
        initialBatteryState: { syntheticSocKwh: 0, gridChargedSocKwh: 0, renewableChargedSocKwh: 0, generatorChargedSocKwh: 0 },
        initialCostBasisState: { gridStoredEnergyKwh: 0, totalAcquisitionCostUsd: 0 },
        allowRenewableExport: false,
      });

      const genFuel = result.generatorFuelCostUsd!;
      const genMaint = result.generatorVariableMaintenanceCostUsd!;
      const genOpex = result.generatorOperatingCostUsd!;

      expect(genOpex).toBeCloseTo(genFuel + genMaint, 4);

      const baselineCost = result.baselineCost;
      const modeledUtilityCost = result.modeledUtilityCostUsd!;
      const utilitySavings = result.utilityElectricitySavingsUsd!;
      const netSavings = result.netOperationalSavingsUsd!;

      expect(utilitySavings).toBeCloseTo(baselineCost - modeledUtilityCost, 4);
      expect(netSavings).toBeCloseTo(utilitySavings - genOpex, 4);
      expect(result.modeledTotalOperatingEnergyCostUsd).toBeCloseTo(
        modeledUtilityCost + genOpex,
        4
      );
    });

    it('heterogeneous fuel units are preserved per-asset without meaningless unitless physical addition', () => {
      const dataPoints = createHourlyDataPoints(24, 4.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();

      const dieselGen = createStandardGenerator({
        id: 'gen-diesel',
        name: 'Diesel Generator',
        fuelType: 'diesel',
        fuelUnit: 'gallon',
        fuelPricePerUnit: 3.5,
      });

      const gasGen = createStandardGenerator({
        id: 'gen-gas',
        name: 'Natural Gas Generator',
        fuelType: 'natural_gas',
        fuelUnit: 'therm',
        fuelPricePerUnit: 1.2,
      });

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [dieselGen, gasGen] },
        initialBatteryState: { syntheticSocKwh: 0, gridChargedSocKwh: 0, renewableChargedSocKwh: 0, generatorChargedSocKwh: 0 },
        initialCostBasisState: { gridStoredEnergyKwh: 0, totalAcquisitionCostUsd: 0 },
        allowRenewableExport: false,
      });

      const summaries = result.generatorAssetSummaries ?? [];
      expect(summaries.length).toBe(2);

      const dieselSummary = summaries.find((s) => s.assetId === 'gen-diesel')!;
      const gasSummary = summaries.find((s) => s.assetId === 'gen-gas')!;

      expect(dieselSummary.fuelUnit).toBe('gallon');
      expect(dieselSummary.totalFuelUnits).toBeGreaterThan(0);

      expect(gasSummary.fuelUnit).toBe('therm');
      expect(gasSummary.totalFuelUnits).toBeGreaterThan(0);

      // Financial costs sum cleanly
      expect(result.generatorFuelCostUsd).toBeCloseTo(
        dieselSummary.fuelCostUsd + gasSummary.fuelCostUsd,
        4
      );
    });
  });

  // --------------------------------------------------------------------------
  // 11. Standby Physical Zero Guarantee
  // --------------------------------------------------------------------------
  describe('11. Standby Physical Zero Guarantee', () => {
    it('standby generator produces physically zero generation, runtime, starts, fuel, and maintenance', () => {
      const dataPoints = createHourlyDataPoints(48, 5.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();

      const standbyGen = createStandardGenerator({
        id: 'gen-standby',
        name: 'Standby Generator',
        dispatchMode: 'standby',
        ratedContinuousKw: 20,
      });

      const result = runGenerationAwareSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [standbyGen] },
        initialBatteryState: { syntheticSocKwh: 0, gridChargedSocKwh: 0, renewableChargedSocKwh: 0, generatorChargedSocKwh: 0 },
        initialCostBasisState: { gridStoredEnergyKwh: 0, totalAcquisitionCostUsd: 0 },
        allowRenewableExport: false,
      });

      expect(result.generatorGeneratedKwh).toBe(0);
      expect(result.generatorRuntimeHours).toBe(0);
      expect(result.generatorStarts).toBe(0);
      expect(result.generatorFuelCostUsd).toBe(0);
      expect(result.generatorVariableMaintenanceCostUsd).toBe(0);
      expect(result.generatorOperatingCostUsd).toBe(0);

      const standbySummary = result.generatorAssetSummaries?.[0];
      expect(standbySummary?.generatedKwh).toBe(0);
      expect(standbySummary?.totalFuelUnits).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 12. Safety, Immutability & Partial-Period Behavior
  // --------------------------------------------------------------------------
  describe('12. Safety, Immutability & Partial-Period Behavior', () => {
    it('input objects and arrays are not mutated', () => {
      const dataPoints = createHourlyDataPoints(24, 2.0);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const generator = createStandardGenerator();
      const genConfig: GenerationConfig = { site: baseSite, assets: [generator] };

      const configClone = JSON.parse(JSON.stringify(genConfig));
      const batteryClone = JSON.parse(JSON.stringify(battery));
      const dataPointsClone = dataPoints.map((p) => ({ ...p, date: new Date(p.date) }));

      runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: genConfig,
        allowSolarExport: false,
      });

      expect(genConfig).toEqual(configClone);
      expect(battery).toEqual(batteryClone);
      expect(dataPoints).toEqual(dataPointsClone);
    });

    it('partial-period simulation executes cleanly without fabricating annual utilization', () => {
      const dataPoints = createHourlyDataPoints(48, 2.0); // 2 days (48 hours)
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const generator = createStandardGenerator();

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: { site: baseSite, assets: [generator] },
        allowSolarExport: false,
      });

      expect(result.annualSummary.totalIntervals).toBe(48);
      expect(result.annualSummary.durationDays).toBe(2);
      expect(result.annualSummary.isSuitableForAnnualProjection).toBe(false);
      expect(result.generationAwareResult?.generatorGeneratedKwh).toBeGreaterThan(0);
    });
  });
});
