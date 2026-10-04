import { describe, it, expect } from 'vitest';
import {
  calculateGenerationOperationalProjection,
  deriveGenerationConfigForProjectionYear,
  deriveBatteryProfileForProjectionYear,
  deriveTariffsForProjectionYear,
} from '../utils/generationProjection';
import {
  aggregateGenerationProjectCosts,
  calculateGenerationAwareFinancials,
  deriveGenerationHorizonFinancialSummary,
  shouldCalculateLegacyFinancials,
  deriveAnalysisState,
} from '../utils/generationFinancials';
import { runUnifiedSimulation } from '../utils/simulationRouter';
import {
  BatteryProfile,
  GenerationConfig,
  GenerationSite,
  GeneratorGenerationAsset,
  IntervalDataPoint,
  MacroFinancials,
  RateTier,
  SolarGenerationAsset,
  WindGenerationAsset,
} from '../types/energy';
import { DEFAULT_MACRO_FINANCIALS } from '../utils/simulationEngine';

describe('G6D — Multi-Year Projection & Lifecycle Financial Integration', () => {
  const baseSite: GenerationSite = {
    latitude: 37.7749,
    longitude: -122.4194,
    timeZone: 'America/Los_Angeles',
    elevationM: 16,
  };

  const defaultTiers: RateTier[] = [
    {
      id: 'off-peak',
      name: 'Off-Peak Tier',
      buyRate: 0.15,
      sellRate: 0.05,
      color: '#10B981',
      isChargeWindow: true,
      isDischargeWindow: false,
    },
    {
      id: 'on-peak',
      name: 'On-Peak Tier',
      buyRate: 0.45,
      sellRate: 0.25,
      color: '#EF4444',
      isChargeWindow: false,
      isDischargeWindow: true,
    },
  ];

  function createScheduleMatrix(): string[][] {
    return Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, (_, h) => (h >= 16 && h <= 21 ? 'on-peak' : 'off-peak'))
    );
  }

  function createHourlyDataPoints(count = 24, usageKwh = 3.0): IntervalDataPoint[] {
    const points: IntervalDataPoint[] = [];
    const baseDate = new Date('2025-06-15T00:00:00Z');
    for (let i = 0; i < count; i++) {
      const d = new Date(baseDate.getTime() + i * 3600000);
      points.push({
        timestamp: d.toISOString().replace('T', ' ').slice(0, 16),
        date: d,
        hour: d.getUTCHours(),
        dayOfWeek: d.getUTCDay(),
        month: d.getUTCMonth(),
        usageKwh,
      });
    }
    return points;
  }

  function createTestBattery(overrides: Partial<BatteryProfile> = {}): BatteryProfile {
    return {
      id: 'test-battery',
      name: 'Test Battery',
      model: 'VoltCell-10',
      totalCapacityKwh: 10,
      usableDodPercent: 100,
      maxContinuousChargeKw: 5,
      maxContinuousOutputKw: 5,
      roundTripEfficiencyPercent: 90,
      ratedCycleLife: 4000,
      installedCost: 8000,
      strategy: 'arbitrage',
      chargeTiers: ['off-peak'],
      dischargeTiers: ['on-peak'],
      allowGridExport: false,
      ...overrides,
    };
  }

  function createTestGenerator(
    id = 'gen-1',
    overrides: Partial<GeneratorGenerationAsset> = {}
  ): GeneratorGenerationAsset {
    return {
      id,
      name: 'Diesel Generator',
      type: 'generator',
      enabled: true,
      installedCostUsd: 5000,
      annualMaintenanceCostUsd: 150,
      ratedContinuousKw: 10,
      minimumStableLoadPercent: 20,
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

  function createTestSolar(id = 'solar-1', overrides: Partial<SolarGenerationAsset> = {}): SolarGenerationAsset {
    return {
      id,
      name: 'Solar Array',
      type: 'solar',
      enabled: true,
      installedCostUsd: 6000,
      annualMaintenanceCostUsd: 100,
      dcCapacityKw: 5.0,
      tiltDegrees: 25,
      azimuthDegrees: 180,
      inverterAcCapacityKw: 5.0,
      inverterEfficiencyPercent: 100,
      systemLossPercent: 0,
      shadingLossPercent: 0,
      annualDegradationPercent: 0.5,
      resourceMode: 'clear_sky',
      monthlyPeakSunHoursPerDay: Array(12).fill(5),
      ...overrides,
    };
  }

  function createTestWind(id = 'wind-1', overrides: Partial<WindGenerationAsset> = {}): WindGenerationAsset {
    return {
      id,
      name: 'Wind Turbine',
      type: 'wind',
      enabled: true,
      installedCostUsd: 12000,
      annualMaintenanceCostUsd: 200,
      ratedPowerKw: 10.0,
      hubHeightM: 30.0,
      rotorDiameterM: 10.0,
      cutInWindSpeedMps: 3.0,
      ratedWindSpeedMps: 11.0,
      cutOutWindSpeedMps: 25.0,
      availabilityPercent: 100.0,
      systemLossPercent: 0.0,
      resourceMode: 'annual_average',
      measurementHeightM: 10.0,
      windShearExponent: 0.14,
      annualAverageWindSpeedMps: 7.0,
      monthlyAverageWindSpeedMps: Array(12).fill(7.0),
      powerCurve: [
        { windSpeedMps: 0, outputKw: 0 },
        { windSpeedMps: 3, outputKw: 0.5 },
        { windSpeedMps: 7, outputKw: 4.5 },
        { windSpeedMps: 11, outputKw: 10.0 },
        { windSpeedMps: 25, outputKw: 10.0 },
      ],
      ...overrides,
    };
  }

  // ==========================================================================
  // Group 1: Multi-Year Operational Projection
  // ==========================================================================
  describe('Multi-Year Operational Projection', () => {
    it('1. Generator-only full-year projection succeeds and populates compact metrics', () => {
      const dataPoints = createHourlyDataPoints(24, 3.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createTestGenerator('gen-1')],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: false,
        horizonYears: 5,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.horizonYears).toBe(5);
      expect(proj.years).toHaveLength(5);
      const y1 = proj.years[0];
      expect(y1.generatorGeneratedKwh).toBeGreaterThan(0);
      expect(y1.generatorFuelCostUsd).toBeGreaterThan(0);
      expect(y1.generatorVariableMaintenanceCostUsd).toBeGreaterThan(0);
      expect(y1.generatorOperatingCostUsd).toBeCloseTo(
        y1.generatorFuelCostUsd! + y1.generatorVariableMaintenanceCostUsd!,
        2
      );
      expect(y1.netOperationalSavingsUsd).toBeCloseTo(
        y1.utilityElectricitySavingsUsd! - y1.generatorOperatingCostUsd!,
        2
      );
    });

    it('2. Scheduled generator annual metrics reconcile to authoritative yearly simulation', () => {
      const dataPoints = createHourlyDataPoints(24, 2.5);
      const gen = createTestGenerator('gen-1');
      const config: GenerationConfig = {
        site: baseSite,
        assets: [gen],
      };
      const battery = createTestBattery();
      const sched = createScheduleMatrix();

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: sched,
        batteryProfile: battery,
        generationConfig: config,
        allowRenewableExport: false,
        horizonYears: 1,
        allowIncompleteYearForTesting: true,
      });

      const singleSim = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: sched,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: false,
        allowRenewableExport: false,
      });

      const y1 = proj.years[0];
      const gRes = singleSim.generationAwareResult!;
      expect(y1.generatorGeneratedKwh).toBeCloseTo(gRes.generatorGeneratedKwh!, 2);
      expect(y1.generatorFuelCostUsd).toBeCloseTo(gRes.generatorFuelCostUsd!, 2);
      expect(y1.generatorVariableMaintenanceCostUsd).toBeCloseTo(gRes.generatorVariableMaintenanceCostUsd!, 2);
      expect(y1.generatorOperatingCostUsd).toBeCloseTo(gRes.generatorOperatingCostUsd!, 2);
      expect(y1.utilityElectricitySavingsUsd).toBeCloseTo(gRes.utilityElectricitySavingsUsd!, 2);
      expect(y1.netOperationalSavingsUsd).toBeCloseTo(gRes.netOperationalSavingsUsd!, 2);
      expect(y1.modeledTotalOperatingEnergyCostUsd).toBeCloseTo(gRes.modeledTotalOperatingEnergyCostUsd!, 2);
    });

    it('3. Economic generator annual metrics reconcile to authoritative yearly simulation', () => {
      const dataPoints = createHourlyDataPoints(24, 4.0);
      const gen = createTestGenerator('gen-econ', {
        dispatchMode: 'economic',
        fuelPricePerUnit: 1.5,
      });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [gen],
      };
      const battery = createTestBattery();
      const sched = createScheduleMatrix();

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: sched,
        batteryProfile: battery,
        generationConfig: config,
        allowRenewableExport: false,
        horizonYears: 1,
        allowIncompleteYearForTesting: true,
      });

      const singleSim = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: sched,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: false,
        allowRenewableExport: false,
      });

      const y1 = proj.years[0];
      const gRes = singleSim.generationAwareResult!;
      expect(y1.generatorGeneratedKwh).toBeCloseTo(gRes.generatorGeneratedKwh!, 2);
      expect(y1.netOperationalSavingsUsd).toBeCloseTo(gRes.netOperationalSavingsUsd!, 2);
    });

    it('4. Mixed solar + generator projection succeeds with both technologies active', () => {
      const dataPoints = createHourlyDataPoints(24, 3.5);
      const solar = createTestSolar('s1', { dcCapacityKw: 4.0 });
      const gen = createTestGenerator('gen-1');
      const config: GenerationConfig = {
        site: baseSite,
        assets: [solar, gen],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: true,
        horizonYears: 3,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years).toHaveLength(3);
      for (const y of proj.years) {
        expect(y.solarGeneratedKwh).toBeGreaterThan(0);
        expect(y.generatorGeneratedKwh).toBeGreaterThan(0);
        expect(y.solarAssets).toHaveLength(1);
      }
    });

    it('5. Mixed wind + generator projection succeeds with constant wind behavior', () => {
      const dataPoints = createHourlyDataPoints(24, 3.5);
      const wind = createTestWind('w1');
      const gen = createTestGenerator('gen-1');
      const config: GenerationConfig = {
        site: baseSite,
        assets: [wind, gen],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: true,
        horizonYears: 3,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years).toHaveLength(3);
      for (const y of proj.years) {
        expect(y.windGeneratedKwh).toBeGreaterThan(0);
        expect(y.generatorGeneratedKwh).toBeGreaterThan(0);
      }
    });

    it('6. Mixed solar + wind + generator tri-hybrid projection succeeds across horizon', () => {
      const dataPoints = createHourlyDataPoints(24, 4.0);
      const solar = createTestSolar('s1', { dcCapacityKw: 3.0 });
      const wind = createTestWind('w1', { ratedPowerKw: 10.0 });
      const gen = createTestGenerator('gen-1', { ratedContinuousKw: 5.0 });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [solar, wind, gen],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: true,
        horizonYears: 4,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years).toHaveLength(4);
      for (const y of proj.years) {
        expect(y.solarGeneratedKwh).toBeGreaterThan(0);
        expect(y.windGeneratedKwh).toBeGreaterThan(0);
        expect(y.generatorGeneratedKwh).toBeGreaterThan(0);
        expect(y.renewableGeneratedKwh).toBeCloseTo(y.solarGeneratedKwh + y.windGeneratedKwh, 2);
      }
    });

    it('7. Technical capability stability: ratedContinuousKw and fuelCurve remain unchanged across years', () => {
      const gen = createTestGenerator('gen-1', {
        ratedContinuousKw: 15.0,
        minimumStableLoadPercent: 25,
        startupFuelUnits: 0.2,
      });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [gen],
      };

      for (const year of [1, 5, 10, 15, 25]) {
        const derived = deriveGenerationConfigForProjectionYear(config, year);
        const derivedGen = derived.generationConfig.assets[0] as GeneratorGenerationAsset;
        expect(derivedGen.ratedContinuousKw).toBe(15.0);
        expect(derivedGen.minimumStableLoadPercent).toBe(25);
        expect(derivedGen.startupFuelUnits).toBe(0.2);
        expect(derivedGen.fuelCurve).toEqual(gen.fuelCurve);
        expect(derivedGen.fuelPricePerUnit).toBe(gen.fuelPricePerUnit);
      }
    });

    it('8. Fuel price stability: fuelPricePerUnit remains constant even with nonzero electricity escalation', () => {
      const gen = createTestGenerator('gen-1', { fuelPricePerUnit: 4.5 });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [gen],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints: createHourlyDataPoints(24, 2.0),
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: false,
        annualElectricityInflationRate: 5.0, // 5% tariff escalation
        horizonYears: 5,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years).toHaveLength(5);
      const y5Config = deriveGenerationConfigForProjectionYear(config, 5);
      const y5Gen = y5Config.generationConfig.assets[0] as GeneratorGenerationAsset;
      expect(y5Gen.fuelPricePerUnit).toBe(4.5);
    });

    it('9. Solar degradation independence: solar DC degrades while generator capacity remains constant', () => {
      const solar = createTestSolar('s1', { dcCapacityKw: 6.0, annualDegradationPercent: 1.0 });
      const gen = createTestGenerator('gen-1', { ratedContinuousKw: 8.0 });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [solar, gen],
      };

      for (let y = 1; y <= 5; y++) {
        const derived = deriveGenerationConfigForProjectionYear(config, y);
        const dSolar = derived.generationConfig.assets[0] as SolarGenerationAsset;
        const dGen = derived.generationConfig.assets[1] as GeneratorGenerationAsset;

        const expectedRetention = Math.pow(0.99, y - 1);
        expect(derived.solarAssets[0].capacityRetentionFactor).toBeCloseTo(expectedRetention, 4);
        expect(dSolar.dcCapacityKw).toBeCloseTo(6.0 * expectedRetention, 3);
        expect(dGen.ratedContinuousKw).toBe(8.0);
      }
    });

    it('10. Wind stability: wind generation capability does not degrade across projected years', () => {
      const wind = createTestWind('w1', { ratedPowerKw: 10.0 });
      const gen = createTestGenerator('gen-1', { ratedContinuousKw: 10.0 });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [wind, gen],
      };

      for (let y = 1; y <= 5; y++) {
        const derived = deriveGenerationConfigForProjectionYear(config, y);
        const dWind = derived.generationConfig.assets[0] as WindGenerationAsset;
        expect(dWind.ratedPowerKw).toBe(10.0);
        expect(dWind.powerCurve).toEqual(wind.powerCurve);
      }
    });

    it('11. Battery degradation interaction: battery capacity degradation reduces usable capacity across years', () => {
      const dataPoints = createHourlyDataPoints(24, 3.0);
      const gen = createTestGenerator('gen-1');
      const config: GenerationConfig = {
        site: baseSite,
        assets: [gen],
      };
      const battery = createTestBattery({ totalCapacityKwh: 20 });

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: battery,
        generationConfig: config,
        allowRenewableExport: false,
        annualBatteryDegradationRate: 4.0, // 4% degradation per year
        horizonYears: 4,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years[0].batteryCapacityRetentionFactor).toBe(1.0);
      expect(proj.years[1].batteryCapacityRetentionFactor).toBeCloseTo(0.96, 3);
      expect(proj.years[2].batteryCapacityRetentionFactor).toBeCloseTo(0.92, 3);
      expect(proj.years[3].batteryCapacityRetentionFactor).toBeCloseTo(0.88, 3);
    });

    it('12. Electricity escalation changes economic generator utilization physically over time', () => {
      const dataPoints = createHourlyDataPoints(24, 3.0);
      const gen = createTestGenerator('gen-econ', {
        dispatchMode: 'economic',
        ratedContinuousKw: 5.0,
        fuelPricePerUnit: 2.0,
        variableMaintenanceCostPerHourUsd: 0.1,
        scheduledHours: Array.from({ length: 7 }, () => Array(24).fill(false)),
      });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [gen],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: false,
        annualElectricityInflationRate: 5.0,
        horizonYears: 5,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years).toHaveLength(5);
      for (const y of proj.years) {
        expect(y.simulatedElectricityCostUsd).toBeDefined();
        expect(y.netOperationalSavingsUsd).toBeDefined();
      }
    });

    it('13. Fuel cost origin: annual generatorFuelCostUsd comes from Year-N dispatch', () => {
      const dataPoints = createHourlyDataPoints(24, 2.5);
      const gen = createTestGenerator('gen-1');
      const config: GenerationConfig = {
        site: baseSite,
        assets: [gen],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: false,
        horizonYears: 3,
        allowIncompleteYearForTesting: true,
      });

      for (const y of proj.years) {
        expect(y.generatorFuelCostUsd).toBeGreaterThan(0);
        expect(y.generatorOperatingCostUsd).toBeCloseTo(
          y.generatorFuelCostUsd! + y.generatorVariableMaintenanceCostUsd!,
          2
        );
      }
    });

    it('14. Variable-maintenance origin: annual generatorVariableMaintenanceCostUsd comes from Year-N runtime', () => {
      const dataPoints = createHourlyDataPoints(24, 2.0);
      const gen = createTestGenerator('gen-1', { variableMaintenanceCostPerHourUsd: 2.5 });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [gen],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: false,
        horizonYears: 2,
        allowIncompleteYearForTesting: true,
      });

      const y1 = proj.years[0];
      expect(y1.generatorRuntimeHours).toBeGreaterThan(0);
      expect(y1.generatorVariableMaintenanceCostUsd).toBeCloseTo(
        y1.generatorRuntimeHours! * 2.5,
        2
      );
    });

    it('15. Operational-savings separation: utilityElectricitySavingsUsd and generatorOperatingCostUsd are distinct', () => {
      const dataPoints = createHourlyDataPoints(24, 3.0);
      const gen = createTestGenerator('gen-1');
      const config: GenerationConfig = {
        site: baseSite,
        assets: [gen],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: false,
        horizonYears: 2,
        allowIncompleteYearForTesting: true,
      });

      for (const y of proj.years) {
        expect(y.generatorOperatingCostUsd).toBeGreaterThan(0);
        expect(y.netOperationalSavingsUsd).toBeCloseTo(
          y.utilityElectricitySavingsUsd! - y.generatorOperatingCostUsd!,
          2
        );
        expect(y.modeledTotalOperatingEnergyCostUsd).toBeCloseTo(
          y.modeledUtilityCostUsd! + y.generatorOperatingCostUsd!,
          2
        );
      }
    });

    it('16. Standby generator produces exactly 0 operational metrics across all projected years', () => {
      const dataPoints = createHourlyDataPoints(24, 2.5);
      const standby = createTestGenerator('gen-standby', {
        dispatchMode: 'standby',
        installedCostUsd: 8000,
        annualMaintenanceCostUsd: 300,
      });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [standby],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: false,
        horizonYears: 3,
        allowIncompleteYearForTesting: true,
      });

      for (const y of proj.years) {
        expect(y.generatorGeneratedKwh).toBe(0);
        expect(y.generatorRuntimeHours).toBe(0);
        expect(y.generatorStarts).toBe(0);
        expect(y.generatorFuelCostUsd).toBe(0);
        expect(y.generatorVariableMaintenanceCostUsd).toBe(0);
        expect(y.generatorOperatingCostUsd).toBe(0);
      }
    });

    it('17. Memory efficiency: compact annual records retain no intervals in generator projection', () => {
      const dataPoints = createHourlyDataPoints(24, 2.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createTestGenerator('gen-1')],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: false,
        horizonYears: 5,
        allowIncompleteYearForTesting: true,
      });

      for (const y of proj.years) {
        expect((y as any).intervals).toBeUndefined();
        expect((y as any).generatorFleetRecords).toBeUndefined();
        expect((y as any).tariffCosts).toBeUndefined();
      }
    });

    it('18. Partial-period datasets remain blocked when suitability check is not bypassed', () => {
      const shortDataPoints = createHourlyDataPoints(48, 1.5);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createTestGenerator('gen-1')],
      };

      expect(() =>
        calculateGenerationOperationalProjection({
          dataPoints: shortDataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: createScheduleMatrix(),
          batteryProfile: createTestBattery(),
          generationConfig: config,
          allowRenewableExport: false,
        })
      ).toThrow(/not suitable for annual operational projection/i);
    });
  });

  // ==========================================================================
  // Group 2: Lifecycle Financial Integration
  // ==========================================================================
  describe('Lifecycle Financial Integration', () => {
    it('19. Generator CAPEX is included exactly once in grossProjectCapexUsd', () => {
      const gen = createTestGenerator('gen-1', { installedCostUsd: 7500 });
      const costs = aggregateGenerationProjectCosts([gen]);
      expect(costs.generationCapexUsd).toBe(7500);

      const battery = createTestBattery({ installedCost: 10000 });
      const dummyYears = [
        {
          year: 1,
          baselineElectricityCostUsd: 3000,
          simulatedElectricityCostUsd: 1500,
          electricitySavingsUsd: 1500,
          utilityElectricitySavingsUsd: 1500,
          netOperationalSavingsUsd: 1200,
          solarGeneratedKwh: 0,
          solarDirectToLoadKwh: 0,
          solarToBatteryKwh: 0,
          solarExportKwh: 0,
          solarCurtailedKwh: 0,
          windGeneratedKwh: 0,
          windDirectToLoadKwh: 0,
          windToBatteryKwh: 0,
          windExportKwh: 0,
          windCurtailedKwh: 0,
          renewableGeneratedKwh: 0,
          renewableDirectToLoadKwh: 0,
          renewableToBatteryKwh: 0,
          renewableExportKwh: 0,
          renewableCurtailedKwh: 0,
          gridImportKwh: 2000,
          gridExportKwh: 0,
          batteryExportKwh: 0,
          batteryDischargedKwh: 1000,
          equivalentFullCycles: 100,
          batteryCapacityRetentionFactor: 1.0,
          batteryUsableCapacityKwh: 10,
          solarAssets: [],
        },
      ];

      const fin = calculateGenerationAwareFinancials({
        batteryProfile: battery,
        operationalProjection: dummyYears,
        projectCosts: costs,
        financials: DEFAULT_MACRO_FINANCIALS,
      });

      expect(fin.batteryCapexUsd).toBe(10000);
      expect(fin.generationCapexUsd).toBe(7500);
      expect(fin.grossProjectCapexUsd).toBe(17500);
    });

    it('20. Disabled generator CAPEX contributes zero', () => {
      const genDisabled = createTestGenerator('gen-off', { enabled: false, installedCostUsd: 5000 });
      const costs = aggregateGenerationProjectCosts([genDisabled]);
      expect(costs.generationCapexUsd).toBe(0);
      expect(costs.annualGenerationMaintenanceUsd).toBe(0);
    });

    it('21. Fixed generator O&M is deducted through annualMaintenanceCostUsd once per year', () => {
      const gen = createTestGenerator('gen-1', {
        installedCostUsd: 4000,
        annualMaintenanceCostUsd: 250,
      });
      const costs = aggregateGenerationProjectCosts([gen]);
      expect(costs.annualGenerationMaintenanceUsd).toBe(250);

      const battery = createTestBattery({ installedCost: 6000 });
      const dummyYears = [
        {
          year: 1,
          baselineElectricityCostUsd: 2500,
          simulatedElectricityCostUsd: 1500,
          electricitySavingsUsd: 1000,
          utilityElectricitySavingsUsd: 1000,
          netOperationalSavingsUsd: 800,
          solarGeneratedKwh: 0,
          solarDirectToLoadKwh: 0,
          solarToBatteryKwh: 0,
          solarExportKwh: 0,
          solarCurtailedKwh: 0,
          windGeneratedKwh: 0,
          windDirectToLoadKwh: 0,
          windToBatteryKwh: 0,
          windExportKwh: 0,
          windCurtailedKwh: 0,
          renewableGeneratedKwh: 0,
          renewableDirectToLoadKwh: 0,
          renewableToBatteryKwh: 0,
          renewableExportKwh: 0,
          renewableCurtailedKwh: 0,
          gridImportKwh: 1500,
          gridExportKwh: 0,
          batteryExportKwh: 0,
          batteryDischargedKwh: 800,
          equivalentFullCycles: 80,
          batteryCapacityRetentionFactor: 1.0,
          batteryUsableCapacityKwh: 10,
          solarAssets: [],
        },
      ];

      const fin = calculateGenerationAwareFinancials({
        batteryProfile: battery,
        operationalProjection: dummyYears,
        projectCosts: costs,
        financials: {
          ...DEFAULT_MACRO_FINANCIALS,
          isFinanced: false,
          federalTaxCreditPercent: 0,
        },
      });

      expect(fin.annualGenerationMaintenanceUsd).toBe(250);
      // netProjectCashFlow = netOperationalSavings (800) - fixed O&M (250) = 550
      expect(fin.projections[0].netProjectCashFlowUsd).toBe(550);
    });

    it('22. No fuel/O&M double counting: fuel and variable O&M are inside netOperationalSavings, not in fixed O&M', () => {
      const gen = createTestGenerator('gen-1', {
        installedCostUsd: 4000,
        annualMaintenanceCostUsd: 100,
      });
      const costs = aggregateGenerationProjectCosts([gen]);

      const dummyYears = [
        {
          year: 1,
          baselineElectricityCostUsd: 3000,
          simulatedElectricityCostUsd: 1800,
          electricitySavingsUsd: 1200,
          utilityElectricitySavingsUsd: 1200,
          generatorFuelCostUsd: 200,
          generatorVariableMaintenanceCostUsd: 50,
          generatorOperatingCostUsd: 250,
          netOperationalSavingsUsd: 950, // 1200 - 250
          solarGeneratedKwh: 0,
          solarDirectToLoadKwh: 0,
          solarToBatteryKwh: 0,
          solarExportKwh: 0,
          solarCurtailedKwh: 0,
          windGeneratedKwh: 0,
          windDirectToLoadKwh: 0,
          windToBatteryKwh: 0,
          windExportKwh: 0,
          windCurtailedKwh: 0,
          renewableGeneratedKwh: 0,
          renewableDirectToLoadKwh: 0,
          renewableToBatteryKwh: 0,
          renewableExportKwh: 0,
          renewableCurtailedKwh: 0,
          gridImportKwh: 1500,
          gridExportKwh: 0,
          batteryExportKwh: 0,
          batteryDischargedKwh: 800,
          equivalentFullCycles: 80,
          batteryCapacityRetentionFactor: 1.0,
          batteryUsableCapacityKwh: 10,
          solarAssets: [],
        },
      ];

      const fin = calculateGenerationAwareFinancials({
        batteryProfile: createTestBattery({ installedCost: 5000 }),
        operationalProjection: dummyYears,
        projectCosts: costs,
        financials: {
          ...DEFAULT_MACRO_FINANCIALS,
          isFinanced: false,
          federalTaxCreditPercent: 0,
        },
      });

      // Fixed O&M must strictly be $100 (never $100 + $250)
      expect(fin.annualGenerationMaintenanceUsd).toBe(100);
      expect(fin.projections[0].generationMaintenanceUsd).toBe(100);
      // Net project cash flow = 950 - 100 = 850
      expect(fin.projections[0].netProjectCashFlowUsd).toBe(850);
    });

    it('23. Combined project financing basis includes generator CAPEX', () => {
      const gen = createTestGenerator('gen-1', { installedCostUsd: 6000 });
      const costs = aggregateGenerationProjectCosts([gen]);
      const battery = createTestBattery({ installedCost: 10000 }); // gross = 16,000

      const dummyYears = [
        {
          year: 1,
          baselineElectricityCostUsd: 2000,
          simulatedElectricityCostUsd: 1000,
          electricitySavingsUsd: 1000,
          utilityElectricitySavingsUsd: 1000,
          netOperationalSavingsUsd: 900,
          solarGeneratedKwh: 0,
          solarDirectToLoadKwh: 0,
          solarToBatteryKwh: 0,
          solarExportKwh: 0,
          solarCurtailedKwh: 0,
          windGeneratedKwh: 0,
          windDirectToLoadKwh: 0,
          windToBatteryKwh: 0,
          windExportKwh: 0,
          windCurtailedKwh: 0,
          renewableGeneratedKwh: 0,
          renewableDirectToLoadKwh: 0,
          renewableToBatteryKwh: 0,
          renewableExportKwh: 0,
          renewableCurtailedKwh: 0,
          gridImportKwh: 1000,
          gridExportKwh: 0,
          batteryExportKwh: 0,
          batteryDischargedKwh: 500,
          equivalentFullCycles: 50,
          batteryCapacityRetentionFactor: 1.0,
          batteryUsableCapacityKwh: 10,
          solarAssets: [],
        },
      ];

      const fin = calculateGenerationAwareFinancials({
        batteryProfile: battery,
        operationalProjection: dummyYears,
        projectCosts: costs,
        financials: {
          ...DEFAULT_MACRO_FINANCIALS,
          isFinanced: true,
          loanDownPaymentPercent: 10, // 10% of 16,000 = 1,600
          loanAprPercent: 6.0,
          loanTermYears: 5,
        },
      });

      expect(fin.grossProjectCapexUsd).toBe(16000);
      expect(fin.upfrontOutOfPocketUsd).toBe(1600);
      expect(fin.loanPrincipalUsd).toBe(14400);
      expect(fin.monthlyLoanPaymentUsd).toBeGreaterThan(0);
      expect(fin.totalLoanPaymentsUsd).toBeGreaterThan(fin.loanPrincipalUsd);
    });

    it('24. Financial metric authority: payback, NPV, IRR, ROI derive from the project cash-flow series', () => {
      const gen = createTestGenerator('gen-1', { installedCostUsd: 4000, annualMaintenanceCostUsd: 100 });
      const costs = aggregateGenerationProjectCosts([gen]);
      const battery = createTestBattery({ installedCost: 6000 }); // gross = 10,000

      // 5 years with net operational savings = 3,000/yr -> net cash flow = 3,000 - 100 = 2,900/yr
      const dummyYears = Array.from({ length: 5 }, (_, i) => ({
        year: i + 1,
        baselineElectricityCostUsd: 4000,
        simulatedElectricityCostUsd: 1000,
        electricitySavingsUsd: 3000,
        utilityElectricitySavingsUsd: 3000,
        netOperationalSavingsUsd: 3000,
        solarGeneratedKwh: 0,
        solarDirectToLoadKwh: 0,
        solarToBatteryKwh: 0,
        solarExportKwh: 0,
        solarCurtailedKwh: 0,
        windGeneratedKwh: 0,
        windDirectToLoadKwh: 0,
        windToBatteryKwh: 0,
        windExportKwh: 0,
        windCurtailedKwh: 0,
        renewableGeneratedKwh: 0,
        renewableDirectToLoadKwh: 0,
        renewableToBatteryKwh: 0,
        renewableExportKwh: 0,
        renewableCurtailedKwh: 0,
        gridImportKwh: 1000,
        gridExportKwh: 0,
        batteryExportKwh: 0,
        batteryDischargedKwh: 500,
        equivalentFullCycles: 50,
        batteryCapacityRetentionFactor: 1.0,
        batteryUsableCapacityKwh: 10,
        solarAssets: [],
      }));

      const fin = calculateGenerationAwareFinancials({
        batteryProfile: battery,
        operationalProjection: dummyYears,
        projectCosts: costs,
        financials: {
          ...DEFAULT_MACRO_FINANCIALS,
          isFinanced: false,
          federalTaxCreditPercent: 0,
          discountRatePercent: 5.0,
        },
      });

      // Payback = 10,000 / 2,900 = 3.448 years, rounded to 1 decimal place (3.4)
      expect(fin.paybackYears).toBe(3.4);
      expect(fin.lifetimeNetProfitUsd).toBe(5 * 2900 - 10000); // 14,500 - 10,000 = 4,500
      expect(fin.npvUsd).toBeGreaterThan(0);
      expect(fin.irrPercent).toBeGreaterThan(0);

      // Rollup summary
      const horizonSummary = deriveGenerationHorizonFinancialSummary(fin, 5);
      expect(horizonSummary.cumulativeCashFlow).toBe(fin.lifetimeNetProfitUsd);
      expect(horizonSummary.cumulativeNetOperationalSavings).toBe(15000);
    });

    it('25. Standby generator financial boundary: standby contributes CAPEX and fixed O&M without claiming energy or resilience', () => {
      const standby = createTestGenerator('gen-standby', {
        dispatchMode: 'standby',
        installedCostUsd: 7000,
        annualMaintenanceCostUsd: 200,
      });
      const costs = aggregateGenerationProjectCosts([standby]);
      expect(costs.generationCapexUsd).toBe(7000);
      expect(costs.annualGenerationMaintenanceUsd).toBe(200);

      const battery = createTestBattery({ installedCost: 8000 });
      const dummyYears = [
        {
          year: 1,
          baselineElectricityCostUsd: 2000,
          simulatedElectricityCostUsd: 1500,
          electricitySavingsUsd: 500,
          utilityElectricitySavingsUsd: 500,
          generatorFuelCostUsd: 0,
          generatorVariableMaintenanceCostUsd: 0,
          generatorOperatingCostUsd: 0,
          netOperationalSavingsUsd: 500,
          solarGeneratedKwh: 0,
          solarDirectToLoadKwh: 0,
          solarToBatteryKwh: 0,
          solarExportKwh: 0,
          solarCurtailedKwh: 0,
          windGeneratedKwh: 0,
          windDirectToLoadKwh: 0,
          windToBatteryKwh: 0,
          windExportKwh: 0,
          windCurtailedKwh: 0,
          renewableGeneratedKwh: 0,
          renewableDirectToLoadKwh: 0,
          renewableToBatteryKwh: 0,
          renewableExportKwh: 0,
          renewableCurtailedKwh: 0,
          gridImportKwh: 1500,
          gridExportKwh: 0,
          batteryExportKwh: 0,
          batteryDischargedKwh: 500,
          equivalentFullCycles: 50,
          batteryCapacityRetentionFactor: 1.0,
          batteryUsableCapacityKwh: 10,
          solarAssets: [],
        },
      ];

      const fin = calculateGenerationAwareFinancials({
        batteryProfile: battery,
        operationalProjection: dummyYears,
        projectCosts: costs,
        financials: {
          ...DEFAULT_MACRO_FINANCIALS,
          isFinanced: false,
          federalTaxCreditPercent: 0,
        },
      });

      expect(fin.grossProjectCapexUsd).toBe(15000); // 8,000 + 7,000
      expect(fin.projections[0].generationMaintenanceUsd).toBe(200);
      // Net cash flow = 500 - 200 = 300
      expect(fin.projections[0].netProjectCashFlowUsd).toBe(300);
    });

    it('26. Passive regression: solar-only, wind-only, and solar+wind financial metrics remain identical', () => {
      const solarCosts = aggregateGenerationProjectCosts([createTestSolar('s1')]);
      const dummyYears = [
        {
          year: 1,
          baselineElectricityCostUsd: 2500,
          simulatedElectricityCostUsd: 1200,
          electricitySavingsUsd: 1300,
          solarGeneratedKwh: 5000,
          solarDirectToLoadKwh: 2000,
          solarToBatteryKwh: 1500,
          solarExportKwh: 1500,
          solarCurtailedKwh: 0,
          windGeneratedKwh: 0,
          windDirectToLoadKwh: 0,
          windToBatteryKwh: 0,
          windExportKwh: 0,
          windCurtailedKwh: 0,
          renewableGeneratedKwh: 5000,
          renewableDirectToLoadKwh: 2000,
          renewableToBatteryKwh: 1500,
          renewableExportKwh: 1500,
          renewableCurtailedKwh: 0,
          gridImportKwh: 1200,
          gridExportKwh: 1500,
          batteryExportKwh: 0,
          batteryDischargedKwh: 1350,
          equivalentFullCycles: 135,
          batteryCapacityRetentionFactor: 1.0,
          batteryUsableCapacityKwh: 10,
          solarAssets: [],
        },
      ];

      const fin = calculateGenerationAwareFinancials({
        batteryProfile: createTestBattery(),
        operationalProjection: dummyYears,
        projectCosts: solarCosts,
        financials: {
          ...DEFAULT_MACRO_FINANCIALS,
          isFinanced: false,
          federalTaxCreditPercent: 30,
        },
      });

      // Expected net cash flow = 1300 - 100 (solar O&M) + 4200 (tax credit on 14,000 gross) = 5400
      expect(fin.projections[0].netProjectCashFlowUsd).toBe(5400);
    });

    it('27. No-generation regression: legacy path eligibility gate is preserved', () => {
      // Legacy eligibility gate: only full-year with legacy simulation mode
      expect(shouldCalculateLegacyFinancials(true, 'legacy')).toBe(true);
      expect(shouldCalculateLegacyFinancials(true, 'generation-aware')).toBe(false);
      expect(shouldCalculateLegacyFinancials(false, 'legacy')).toBe(false);

      expect(deriveAnalysisState(true, 'legacy')).toBe('legacy-financial');
      expect(deriveAnalysisState(true, 'generation-aware')).toBe('generation-financial-pending');
      expect(deriveAnalysisState(true, 'generation-aware', true)).toBe('generation-financial');
      expect(deriveAnalysisState(false, 'generation-aware')).toBe('partial-period');
    });
  });
});
