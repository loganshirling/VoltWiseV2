import { describe, it, expect } from 'vitest';
import {
  runUnifiedSimulation,
  UnifiedSimulationParams,
} from '../utils/simulationRouter';
import { runAnnualSimulation } from '../utils/simulationEngine';
import {
  BatteryProfile,
  GenerationConfig,
  GenerationSite,
  IntervalDataPoint,
  RateTier,
  SolarGenerationAsset,
  TouSeason,
  WindGenerationAsset,
  GeneratorGenerationAsset,
} from '../types/energy';
import {
  createDefaultSolarAsset,
  DEFAULT_WIND_ASSET,
  DEFAULT_GENERATOR_ASSET,
} from '../utils/generationDefaults';

describe('G3R — Production Simulation Router & No-Generation Parity Gate', () => {
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
      sellRate: 0.08,
      color: '#10B981',
      isChargeWindow: true,
      isDischargeWindow: false,
    },
    {
      id: 'on-peak',
      name: 'On-Peak Tier',
      buyRate: 0.50,
      sellRate: 0.40,
      color: '#EF4444',
      isChargeWindow: false,
      isDischargeWindow: true,
    },
  ];

  function createScheduleMatrix(
    defaultTier = 'off-peak',
    onPeakHours: number[] = [16, 17, 18, 19, 20]
  ): string[][] {
    return Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, (_, h) =>
        onPeakHours.includes(h) ? 'on-peak' : defaultTier
      )
    );
  }

  function createTestBattery(
    overrides: Partial<BatteryProfile> = {}
  ): BatteryProfile {
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

  function createHourlyDataPoints(
    count = 48,
    startIso = '2025-06-01T00:00:00Z'
  ): IntervalDataPoint[] {
    const startDate = new Date(startIso);
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(startDate.getTime() + i * 3600 * 1000);
      return {
        timestamp: d.toISOString().replace('T', ' ').slice(0, 16),
        date: d,
        hour: d.getUTCHours(),
        dayOfWeek: d.getUTCDay(),
        month: d.getUTCMonth(),
        usageKwh: 1.5 + (i % 6) * 0.3,
      };
    });
  }

  function createSolarAsset(
    overrides: Partial<SolarGenerationAsset> = {}
  ): SolarGenerationAsset {
    return {
      ...createDefaultSolarAsset('solar-1', 'Clear-Sky Solar PV'),
      dcCapacityKw: 6.0,
      tiltDegrees: 25,
      azimuthDegrees: 180,
      inverterAcCapacityKw: 5.0,
      inverterEfficiencyPercent: 96,
      systemLossPercent: 14,
      shadingLossPercent: 0,
      resourceMode: 'clear_sky',
      enabled: true,
      ...overrides,
    };
  }

  // ==========================================================================
  // No-Generation Parity Tests (The Critical Acceptance Gate)
  // ==========================================================================
  describe('No-Generation Parity Gate (Legacy Exact Match)', () => {
    it('1. default empty GenerationConfig with empty site.timeZone matches runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(48);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const emptyConfig: GenerationConfig = {
        site: {
          latitude: 37.77,
          longitude: -122.42,
          timeZone: '',
          elevationM: null,
        },
        assets: [],
      };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.generationAwareResult).toBeUndefined();
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('2. all assets disabled routes to legacy and matches runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(48);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();

      const disabledSolar: SolarGenerationAsset = {
        ...createSolarAsset(),
        enabled: false,
      };
      const disabledWind: WindGenerationAsset = {
        ...DEFAULT_WIND_ASSET,
        id: 'wind-1',
        name: 'Wind Turb',
        enabled: false,
      };
      const disabledGenerator: GeneratorGenerationAsset = {
        ...DEFAULT_GENERATOR_ASSET,
        id: 'gen-1',
        name: 'Backup Gen',
        enabled: false,
      };

      const configWithDisabledAssets: GenerationConfig = {
        site: baseSite,
        assets: [disabledSolar, disabledWind, disabledGenerator],
      };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: configWithDisabledAssets,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.generationAwareResult).toBeUndefined();
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('3. arbitrage strategy matches runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(72);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ strategy: 'arbitrage' });
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('4. self_consumption strategy matches runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(72);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ strategy: 'self_consumption' });
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('5. seasonal TOU overrides match runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(72);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const seasons: TouSeason[] = [
        {
          id: 'summer',
          name: 'Summer Season',
          months: [5, 6, 7, 8],
          tierRates: {
            'off-peak': { buyRate: 0.22, sellRate: 0.11 },
            'on-peak': { buyRate: 0.65, sellRate: 0.45 },
          },
        },
        {
          id: 'winter',
          name: 'Winter Season',
          months: [0, 1, 2, 3, 4, 9, 10, 11],
          tierRates: {
            'off-peak': { buyRate: 0.14, sellRate: 0.06 },
            'on-peak': { buyRate: 0.40, sellRate: 0.20 },
          },
        },
      ];
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        seasons,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery,
        seasons
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('6. allowGridExport=true matches runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(72);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({
        strategy: 'arbitrage',
        allowGridExport: true,
      });
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('7. overlapping charge/discharge tiers match runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(48);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({
        chargeTiers: ['off-peak', 'on-peak'],
        dischargeTiers: ['on-peak'],
      });
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('8. sub-hourly intervals (15-min) match runAnnualSimulation exactly', () => {
      const startDate = new Date('2025-06-01T00:00:00Z');
      const dataPoints: IntervalDataPoint[] = Array.from(
        { length: 96 },
        (_, i) => {
          const d = new Date(startDate.getTime() + i * 15 * 60 * 1000);
          return {
            timestamp: d.toISOString().replace('T', ' ').slice(0, 16),
            date: d,
            hour: d.getUTCHours(),
            dayOfWeek: d.getUTCDay(),
            month: d.getUTCMonth(),
            usageKwh: 0.4 + (i % 4) * 0.1,
          };
        }
      );
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 0.25,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        0.25,
        defaultTiers,
        schedule,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('9. RTE below legacy 50% floor (e.g. 30%) matches runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(48);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ roundTripEfficiencyPercent: 30 });
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('10. RTE above 100% (e.g. 120%) matches runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(48);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({ roundTripEfficiencyPercent: 120 });
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        schedule,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });

    it('11. schedule tier missing from configured tiers exercises legacy fallback and matches runAnnualSimulation exactly', () => {
      const dataPoints = createHourlyDataPoints(48);
      // Put a tier ID that is not defined in defaultTiers
      const scheduleWithMissingTier = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, () => 'non-existent-tier-xyz')
      );
      const battery = createTestBattery();
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: scheduleWithMissingTier,
        batteryProfile: battery,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      const legacyResult = runAnnualSimulation(
        dataPoints,
        1,
        defaultTiers,
        scheduleWithMissingTier,
        battery
      );

      expect(unifiedResult.mode).toBe('legacy');
      expect(unifiedResult.annualSummary).toEqual(legacyResult);
    });
  });

  // ==========================================================================
  // Generation-Branch Tests
  // ==========================================================================
  describe('Generation-Branch Routing & Adaptation', () => {
    it('12. enabled solar selects generation-aware mode', () => {
      const dataPoints = createHourlyDataPoints(24);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const solarAsset = createSolarAsset();
      const config: GenerationConfig = {
        site: baseSite,
        assets: [solarAsset],
      };

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: true,
      });

      expect(result.mode).toBe('generation-aware');
      expect(result.generationAwareResult).toBeDefined();
      expect(result.annualSummary).toBeDefined();
      expect(result.annualSummary.totalIntervals).toBe(24);
      expect(result.annualSummary.intervalResults).toHaveLength(24);
    });

    it('13. enabled wind/generator continues to reject rather than silently falling back', () => {
      const dataPoints = createHourlyDataPoints(24);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();

      const windConfig: GenerationConfig = {
        site: baseSite,
        assets: [
          {
            ...DEFAULT_WIND_ASSET,
            id: 'wind-1',
            name: 'Wind Turbine',
            enabled: true,
            ratedPowerKw: 5,
          },
        ],
      };

      expect(() =>
        runUnifiedSimulation({
          dataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: schedule,
          batteryProfile: battery,
          generationConfig: windConfig,
          allowSolarExport: false,
        })
      ).toThrow(/Unsupported generation asset type: "wind"/);

      const genConfig: GenerationConfig = {
        site: baseSite,
        assets: [
          {
            ...DEFAULT_GENERATOR_ASSET,
            id: 'gen-1',
            name: 'Backup Generator',
            enabled: true,
            ratedContinuousKw: 10,
          },
        ],
      };

      expect(() =>
        runUnifiedSimulation({
          dataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: schedule,
          batteryProfile: battery,
          generationConfig: genConfig,
          allowSolarExport: false,
        })
      ).toThrow(/Unsupported generation asset type: "generator"/);
    });

    it('14. generation branch starts at exactly 50% synthetic usable SOC', () => {
      const dataPoints = createHourlyDataPoints(24);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery({
        totalCapacityKwh: 12,
        usableDodPercent: 90, // usableCapacityKwh = 10.8 kWh
      });
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createSolarAsset()],
      };

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: true,
      });

      const expectedUsable = 12 * 0.9; // 10.8
      const expectedSyntheticSoc = expectedUsable * 0.5; // 5.4 kWh

      const initialBatteryState =
        result.generationAwareResult!.exportAwareBatteryFlow.initialBatteryState;
      const initialCostBasis =
        result.generationAwareResult!.exportAwareBatteryFlow.initialCostBasisState;

      expect(initialBatteryState.syntheticSocKwh).toBeCloseTo(expectedSyntheticSoc, 6);
      expect(initialBatteryState.gridChargedSocKwh).toBe(0);
      expect(initialBatteryState.renewableChargedSocKwh).toBe(0);
      expect(initialBatteryState.generatorChargedSocKwh).toBe(0);

      expect(initialCostBasis.gridStoredEnergyKwh).toBe(0);
      expect(initialCostBasis.totalAcquisitionCostUsd).toBe(0);
    });

    it('15. AnnualSimulationSummary costs/import/export match G3Q totals after required legacy rounding', () => {
      const dataPoints = createHourlyDataPoints(48);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createSolarAsset()],
      };

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: true,
      });

      const g3q = result.generationAwareResult!;
      const summary = result.annualSummary;

      // Summary costs: 2 decimals
      expect(summary.baselineAnnualCost).toBe(Math.round(g3q.baselineCost * 100) / 100);
      expect(summary.simulatedAnnualCost).toBe(Math.round(g3q.simulatedCost * 100) / 100);
      expect(summary.year1Savings).toBe(
        Math.round((g3q.baselineCost - g3q.simulatedCost) * 100) / 100
      );
      expect(summary.baselinePeriodCost).toBe(Math.round(g3q.baselineCost * 100) / 100);
      expect(summary.simulatedPeriodCost).toBe(Math.round(g3q.simulatedCost * 100) / 100);
      expect(summary.periodSavings).toBe(
        Math.round((g3q.baselineCost - g3q.simulatedCost) * 100) / 100
      );

      // Total home/grid: 1 decimal
      expect(summary.totalHomeLoadKwh).toBe(Math.round(g3q.totalHomeLoadKwh * 10) / 10);
      expect(summary.annualGridImportKwh).toBe(Math.round(g3q.totalGridImportKwh * 10) / 10);
      expect(summary.annualGridExportKwh).toBe(Math.round(g3q.totalGridExportKwh * 10) / 10);

      // Savings %: 1 decimal
      const expectedSavingsPct =
        g3q.baselineCost > 0
          ? Math.round(((g3q.baselineCost - g3q.simulatedCost) / g3q.baselineCost) * 1000) / 10
          : 0;
      expect(summary.savingsPercentage).toBe(expectedSavingsPct);
    });

    it('16. batteryDischargeKwh includes household battery discharge + battery export', () => {
      const tiers: RateTier[] = [
        {
          id: 'off-peak',
          name: 'Off-Peak',
          buyRate: 0.10,
          sellRate: 0.05,
          color: '#10B981',
          isChargeWindow: true,
          isDischargeWindow: false,
        },
        {
          id: 'on-peak',
          name: 'On-Peak',
          buyRate: 0.60,
          sellRate: 0.50,
          color: '#EF4444',
          isChargeWindow: false,
          isDischargeWindow: true,
        },
      ];

      const startDate = new Date('2025-06-01T00:00:00Z');
      const dataPoints: IntervalDataPoint[] = Array.from({ length: 24 }, (_, h) => {
        const d = new Date(startDate.getTime() + h * 3600 * 1000);
        return {
          timestamp: d.toISOString().replace('T', ' ').slice(0, 16),
          date: d,
          hour: h,
          dayOfWeek: d.getUTCDay(),
          month: d.getUTCMonth(),
          usageKwh: 0.5,
        };
      });

      const schedule = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, (_, h) => (h >= 17 && h <= 21 ? 'on-peak' : 'off-peak'))
      );

      const battery = createTestBattery({
        strategy: 'arbitrage',
        allowGridExport: true,
        maxContinuousChargeKw: 5,
        maxContinuousOutputKw: 5,
      });

      const config: GenerationConfig = {
        site: baseSite,
        assets: [createSolarAsset({ dcCapacityKw: 2, inverterAcCapacityKw: 2 })],
      };

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: false,
      });

      const g3q = result.generationAwareResult!;
      const intervals = g3q.exportAwareBatteryFlow.intervals;

      const exportIntervalIndex = intervals.findIndex(
        (inv) => inv.exportResult.batteryExportAcKwh > 0
      );

      if (exportIntervalIndex >= 0) {
        const inv = intervals[exportIntervalIndex];
        const summaryInterval = result.annualSummary.intervalResults[exportIntervalIndex];

        expect(inv.exportResult.batteryExportAcKwh).toBeGreaterThan(0);
        expect(summaryInterval.batteryDischargeKwh).toBeCloseTo(
          inv.preExportFlow.batteryDeliveredToLoadKwh + inv.exportResult.batteryExportAcKwh,
          6
        );
      }

      let sumIntervalDischarge = 0;
      for (const inv of result.annualSummary.intervalResults) {
        sumIntervalDischarge += inv.batteryDischargeKwh;
      }
      expect(result.annualSummary.annualBatteryDischargedKwh).toBe(
        Math.round(sumIntervalDischarge * 10) / 10
      );
    });

    it('17. solar export does NOT count as battery discharge', () => {
      const startDate = new Date('2025-06-01T17:00:00Z');
      const dataPoints: IntervalDataPoint[] = Array.from({ length: 6 }, (_, i) => {
        const d = new Date(startDate.getTime() + i * 3600 * 1000);
        return {
          timestamp: d.toISOString().replace('T', ' ').slice(0, 16),
          date: d,
          hour: d.getUTCHours(),
          dayOfWeek: d.getUTCDay(),
          month: d.getUTCMonth(),
          usageKwh: 0.2,
        };
      });

      const schedule = createScheduleMatrix('off-peak', []);
      const battery = createTestBattery({
        allowGridExport: false,
      });

      const config: GenerationConfig = {
        site: baseSite,
        assets: [createSolarAsset({ dcCapacityKw: 15, inverterAcCapacityKw: 12 })],
      };

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: true,
      });

      const g3q = result.generationAwareResult!;
      expect(g3q.totalSolarExportKwh).toBeGreaterThan(0);

      const solarExportIdx = g3q.gridFlows.intervals.findIndex(
        (gf) => gf.solarExportKwh > 0
      );
      expect(solarExportIdx).toBeGreaterThanOrEqual(0);

      const gf = g3q.gridFlows.intervals[solarExportIdx];
      const intv = result.annualSummary.intervalResults[solarExportIdx];
      const exp = g3q.exportAwareBatteryFlow.intervals[solarExportIdx];

      expect(gf.solarExportKwh).toBeGreaterThan(0);
      expect(intv.batteryDischargeKwh).toBe(
        exp.preExportFlow.batteryDeliveredToLoadKwh + exp.exportResult.batteryExportAcKwh
      );
      expect(intv.batteryDischargeKwh).not.toBe(gf.solarExportKwh);

      const totalDeliveredPlusExport =
        g3q.exportAwareBatteryFlow.intervals.reduce(
          (sum, inv) =>
            sum +
            inv.preExportFlow.batteryDeliveredToLoadKwh +
            inv.exportResult.batteryExportAcKwh,
          0
        );
      expect(result.annualSummary.annualBatteryDischargedKwh).toBe(
        Math.round(totalDeliveredPlusExport * 10) / 10
      );
    });

    it('18. interval SOC reflects post-export state', () => {
      const dataPoints = createHourlyDataPoints(24);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createSolarAsset()],
      };

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: true,
      });

      const g3q = result.generationAwareResult!;
      const usable = battery.totalCapacityKwh * (battery.usableDodPercent / 100);

      for (let i = 0; i < 24; i++) {
        const stateAfter =
          g3q.exportAwareBatteryFlow.intervals[i].batteryStateAfterExport;
        const totalSocKwh =
          stateAfter.syntheticSocKwh +
          stateAfter.gridChargedSocKwh +
          stateAfter.renewableChargedSocKwh +
          stateAfter.generatorChargedSocKwh;

        const summaryIntv = result.annualSummary.intervalResults[i];
        expect(summaryIntv.batterySocKwh).toBe(Math.round(totalSocKwh * 100) / 100);
        expect(summaryIntv.batterySocPercent).toBe(
          Math.round((totalSocKwh / usable) * 1000) / 10
        );
      }
    });

    it('19. generationAwareResult is preserved for future UI/results use', () => {
      const dataPoints = createHourlyDataPoints(24);
      const schedule = createScheduleMatrix();
      const battery = createTestBattery();
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createSolarAsset()],
      };

      const result = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: true,
      });

      expect(result.generationAwareResult).toBeDefined();
      const g3q = result.generationAwareResult!;

      expect(g3q.alignedTimestamps).toHaveLength(24);
      expect(g3q.solarFleetProfile).toHaveLength(24);
      expect(g3q.solarLoadFlow).toHaveLength(24);
      expect(g3q.dispatchPolicy).toHaveLength(24);
      expect(g3q.resolvedRates).toHaveLength(24);
      expect(g3q.exportAwareBatteryFlow.intervals).toHaveLength(24);
      expect(g3q.gridFlows.intervals).toHaveLength(24);
      expect(g3q.tariffCosts.intervals).toHaveLength(24);
    });

    it('20. inputs remain immutable across both execution modes', () => {
      function cloneDataPoints(pts: IntervalDataPoint[]): IntervalDataPoint[] {
        return pts.map((p) => ({
          timestamp: p.timestamp,
          date: new Date(p.date.getTime()),
          hour: p.hour,
          dayOfWeek: p.dayOfWeek,
          month: p.month,
          usageKwh: p.usageKwh,
        }));
      }

      // 20a. Legacy mode immutability
      const dataPointsLegacy = createHourlyDataPoints(24);
      const scheduleLegacy = createScheduleMatrix();
      const batteryLegacy = createTestBattery();
      const emptyConfig: GenerationConfig = {
        site: { ...baseSite },
        assets: [],
      };

      const dataPointsLegacySnapshot = cloneDataPoints(dataPointsLegacy);
      const scheduleLegacySnapshot = JSON.parse(JSON.stringify(scheduleLegacy));
      const batteryLegacySnapshot = JSON.parse(JSON.stringify(batteryLegacy));
      const configLegacySnapshot = JSON.parse(JSON.stringify(emptyConfig));

      runUnifiedSimulation({
        dataPoints: dataPointsLegacy,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: scheduleLegacy,
        batteryProfile: batteryLegacy,
        generationConfig: emptyConfig,
        allowSolarExport: false,
      });

      expect(dataPointsLegacy).toEqual(dataPointsLegacySnapshot);
      expect(scheduleLegacy).toEqual(scheduleLegacySnapshot);
      expect(batteryLegacy).toEqual(batteryLegacySnapshot);
      expect(emptyConfig).toEqual(configLegacySnapshot);

      // 20b. Generation-aware mode immutability
      const dataPointsGen = createHourlyDataPoints(24);
      const scheduleGen = createScheduleMatrix();
      const batteryGen = createTestBattery();
      const solarAsset = createSolarAsset();
      const genConfig: GenerationConfig = {
        site: { ...baseSite },
        assets: [solarAsset],
      };

      const dataPointsGenSnapshot = cloneDataPoints(dataPointsGen);
      const scheduleGenSnapshot = JSON.parse(JSON.stringify(scheduleGen));
      const batteryGenSnapshot = JSON.parse(JSON.stringify(batteryGen));
      const configGenSnapshot = JSON.parse(JSON.stringify(genConfig));

      runUnifiedSimulation({
        dataPoints: dataPointsGen,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: scheduleGen,
        batteryProfile: batteryGen,
        generationConfig: genConfig,
        allowSolarExport: true,
      });

      expect(dataPointsGen).toEqual(dataPointsGenSnapshot);
      expect(scheduleGen).toEqual(scheduleGenSnapshot);
      expect(batteryGen).toEqual(batteryGenSnapshot);
      expect(genConfig).toEqual(configGenSnapshot);
    });

    it('validates parameters object must be provided', () => {
      expect(() => runUnifiedSimulation(null as any)).toThrow(
        'Simulation parameters must be provided as an object.'
      );
      expect(() => runUnifiedSimulation(undefined as any)).toThrow(
        'Simulation parameters must be provided as an object.'
      );
    });

    it('correctly sets durationDays and isSuitableForAnnualProjection heuristic', () => {
      const shortData = createHourlyDataPoints(48);
      const resultShort = runUnifiedSimulation({
        dataPoints: shortData,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: { site: baseSite, assets: [createSolarAsset()] },
        allowSolarExport: true,
      });

      expect(resultShort.annualSummary.durationDays).toBe(2);
      expect(resultShort.annualSummary.isSuitableForAnnualProjection).toBe(false);
    });
  });
});
