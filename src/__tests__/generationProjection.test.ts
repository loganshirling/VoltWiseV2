import { describe, it, expect } from 'vitest';
import {
  calculateGenerationOperationalProjection,
  deriveBatteryProfileForProjectionYear,
  deriveSolarConfigForProjectionYear,
  deriveGenerationConfigForProjectionYear,
  deriveTariffsForProjectionYear,
  projectGenerationAwareOperations,
} from '../utils/generationProjection';
import {
  BatteryProfile,
  GenerationConfig,
  GenerationSite,
  GeneratorGenerationAsset,
  IntervalDataPoint,
  RateTier,
  SolarGenerationAsset,
  TouSeason,
  WindGenerationAsset,
} from '../types/energy';
import { createDefaultSolarAsset } from '../utils/generationDefaults';

describe('G4B — Multi-Year Generation-Aware Operational Projection', () => {
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
      sellRate: 0.35,
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

  function createClearSkyAsset(
    id = 'solar-1',
    overrides: Partial<SolarGenerationAsset> = {}
  ): SolarGenerationAsset {
    return {
      ...createDefaultSolarAsset(id, 'Clear-Sky Array'),
      dcCapacityKw: 6.0,
      tiltDegrees: 25,
      azimuthDegrees: 180,
      inverterAcCapacityKw: 5.0,
      inverterEfficiencyPercent: 100,
      systemLossPercent: 0,
      shadingLossPercent: 0,
      annualDegradationPercent: 0.5,
      resourceMode: 'clear_sky',
      ...overrides,
    };
  }

  function createHourlyDataPoints(
    count = 24,
    usageKwh: number | number[] = 1.5,
    startDateStr = '2025-06-15'
  ): IntervalDataPoint[] {
    const points: IntervalDataPoint[] = [];
    const [yearStr, monthStr, startDayStr] = startDateStr.split('-');
    const baseDay = parseInt(startDayStr, 10);
    const month = parseInt(monthStr, 10) - 1;

    for (let i = 0; i < count; i++) {
      const hour = i % 24;
      const day = baseDay + Math.floor(i / 24);
      const hourPad = String(hour).padStart(2, '0');
      const dayPad = String(day).padStart(2, '0');
      const ts = `${yearStr}-${monthStr}-${dayPad} ${hourPad}:00`;
      const usage = Array.isArray(usageKwh) ? usageKwh[i] : usageKwh;
      points.push({
        timestamp: ts,
        date: new Date(`${ts}:00`),
        hour,
        dayOfWeek: 0, // Sunday
        month,
        usageKwh: usage,
      });
    }
    return points;
  }

  // ==========================================================================
  // 1. Year Semantics
  // ==========================================================================
  describe('Year semantics', () => {
    it('1. Year 1 solar retention is exactly 1.0', () => {
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { annualDegradationPercent: 0.8 })],
      };

      const { solarAssets, generationConfig } = deriveSolarConfigForProjectionYear(config, 1);
      expect(solarAssets[0].capacityRetentionFactor).toBe(1.0);
      expect(solarAssets[0].effectiveDcCapacityKw).toBe(6.0);
      expect((generationConfig.assets[0] as SolarGenerationAsset).dcCapacityKw).toBe(6.0);
    });

    it('2. Year 1 battery retention preserves the base battery energy capacity', () => {
      const baseBattery = createTestBattery({ totalCapacityKwh: 12, usableDodPercent: 90 });
      const { capacityRetentionFactor, batteryProfile, usableCapacityKwh } =
        deriveBatteryProfileForProjectionYear(baseBattery, 1, 2.5);

      expect(capacityRetentionFactor).toBe(1.0);
      expect(batteryProfile.totalCapacityKwh).toBe(12);
      expect(usableCapacityKwh).toBe(12 * 0.9);
    });

    it('3. Year 1 tariff factor is exactly 1.0', () => {
      const { tiers, inflationFactor } = deriveTariffsForProjectionYear(defaultTiers, undefined, 1, 4.0);
      expect(inflationFactor).toBe(1.0);
      expect(tiers[0].buyRate).toBe(defaultTiers[0].buyRate);
      expect(tiers[0].sellRate).toBe(defaultTiers[0].sellRate);
      expect(tiers[1].buyRate).toBe(defaultTiers[1].buyRate);
      expect(tiers[1].sellRate).toBe(defaultTiers[1].sellRate);
    });
  });

  // ==========================================================================
  // 2. Solar Degradation
  // ==========================================================================
  describe('Solar degradation', () => {
    it('4. 0% solar degradation preserves solar capability across years', () => {
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { annualDegradationPercent: 0 })],
      };

      for (const y of [1, 5, 10, 25]) {
        const { solarAssets } = deriveSolarConfigForProjectionYear(config, y);
        expect(solarAssets[0].capacityRetentionFactor).toBe(1.0);
        expect(solarAssets[0].effectiveDcCapacityKw).toBe(6.0);
      }
    });

    it('5. Positive solar degradation compounds using the approved formula', () => {
      const degPercent = 0.5;
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { dcCapacityKw: 10.0, annualDegradationPercent: degPercent })],
      };

      for (let y = 1; y <= 5; y++) {
        const { solarAssets } = deriveSolarConfigForProjectionYear(config, y);
        const expectedRetention = Math.pow(1 - degPercent / 100, y - 1);
        expect(solarAssets[0].capacityRetentionFactor).toBeCloseTo(expectedRetention, 8);
        expect(solarAssets[0].effectiveDcCapacityKw).toBeCloseTo(10.0 * expectedRetention, 8);
      }
    });

    it('6. Multiple arrays with different degradation rates retain independent Year-N capacities', () => {
      const config: GenerationConfig = {
        site: baseSite,
        assets: [
          createClearSkyAsset('array-a', { dcCapacityKw: 10.0, annualDegradationPercent: 0.3 }),
          createClearSkyAsset('array-b', { dcCapacityKw: 8.0, annualDegradationPercent: 0.8 }),
        ],
      };

      const year = 10;
      const { solarAssets } = deriveSolarConfigForProjectionYear(config, year);

      expect(solarAssets).toHaveLength(2);

      const arrayA = solarAssets.find((a) => a.assetId === 'array-a')!;
      const arrayB = solarAssets.find((a) => a.assetId === 'array-b')!;

      const expectedA = Math.pow(1 - 0.3 / 100, 9);
      const expectedB = Math.pow(1 - 0.8 / 100, 9);

      expect(arrayA.capacityRetentionFactor).toBeCloseTo(expectedA, 8);
      expect(arrayA.effectiveDcCapacityKw).toBeCloseTo(10.0 * expectedA, 8);

      expect(arrayB.capacityRetentionFactor).toBeCloseTo(expectedB, 8);
      expect(arrayB.effectiveDcCapacityKw).toBeCloseTo(8.0 * expectedB, 8);
    });

    it('7. Solar degradation changes DC generation capability before the inverter limit rather than scaling final AC output', () => {
      // Oversized array: 10 kW DC paired with a 4 kW AC inverter (heavy clipping)
      const asset = createClearSkyAsset('clipped-array', {
        dcCapacityKw: 10.0,
        inverterAcCapacityKw: 4.0,
        annualDegradationPercent: 5.0, // 5% degradation
      });

      const config: GenerationConfig = {
        site: baseSite,
        assets: [asset],
      };

      const dataPoints = createHourlyDataPoints(24, 0.5);

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowSolarExport: true,
        projectionYears: 2,
        allowIncompleteYearForTesting: true,
      });

      // Year 1 DC: 10 kW, Year 2 DC: 9.5 kW
      // If we scaled final AC output post-simulation, Year 2 AC generation would drop by 5%.
      // But because the array was severely clipped by the 4 kW inverter at midday,
      // the drop in delivered AC generation is much less than 5%!
      const year1Gen = projection.years[0].solarGeneratedKwh;
      const year2Gen = projection.years[1].solarGeneratedKwh;

      const acDropPercent = ((year1Gen - year2Gen) / year1Gen) * 100;
      expect(acDropPercent).toBeLessThan(5.0);
    });

    it('8. Inverter AC capacity is not degraded', () => {
      const originalInverterAcKw = 5.0;
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { inverterAcCapacityKw: originalInverterAcKw, annualDegradationPercent: 2.0 })],
      };

      const { generationConfig } = deriveSolarConfigForProjectionYear(config, 15);
      const derivedSolar = generationConfig.assets[0] as SolarGenerationAsset;

      expect(derivedSolar.inverterAcCapacityKw).toBe(originalInverterAcKw);
    });
  });

  // ==========================================================================
  // 3. Battery Degradation
  // ==========================================================================
  describe('Battery degradation', () => {
    it('9. Positive battery degradation lowers Year-N usable energy capacity', () => {
      const baseBattery = createTestBattery({ totalCapacityKwh: 10, usableDodPercent: 90 });
      const annualDegradationRate = 2.0; // 2% per year

      // Year 1: 10 * 0.9 = 9.0 kWh
      // Year 6: (1 - 5 * 0.02) = 0.90 -> 9.0 * 0.9 = 8.1 kWh
      const y1 = deriveBatteryProfileForProjectionYear(baseBattery, 1, annualDegradationRate);
      const y6 = deriveBatteryProfileForProjectionYear(baseBattery, 6, annualDegradationRate);

      expect(y1.capacityRetentionFactor).toBe(1.0);
      expect(y1.batteryProfile.totalCapacityKwh).toBe(10);
      expect(y1.usableCapacityKwh).toBe(9.0);

      expect(y6.capacityRetentionFactor).toBe(0.9);
      expect(y6.batteryProfile.totalCapacityKwh).toBe(9.0);
      expect(y6.usableCapacityKwh).toBeCloseTo(8.1, 6);
    });

    it('10. Battery charge/discharge power limits remain unchanged', () => {
      const baseBattery = createTestBattery({
        maxContinuousChargeKw: 3.8,
        maxContinuousOutputKw: 4.2,
      });

      const y10 = deriveBatteryProfileForProjectionYear(baseBattery, 10, 3.0);
      expect(y10.batteryProfile.maxContinuousChargeKw).toBe(3.8);
      expect(y10.batteryProfile.maxContinuousOutputKw).toBe(4.2);
    });

    it('11. 0% battery degradation preserves capacity', () => {
      const baseBattery = createTestBattery({ totalCapacityKwh: 15 });
      const y20 = deriveBatteryProfileForProjectionYear(baseBattery, 20, 0);

      expect(y20.capacityRetentionFactor).toBe(1.0);
      expect(y20.batteryProfile.totalCapacityKwh).toBe(15);
      expect(y20.usableCapacityKwh).toBe(15);
    });

    it('12. Battery and solar degradation can operate simultaneously through the authoritative dispatch simulation', () => {
      const dataPoints = createHourlyDataPoints(24, 2.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { annualDegradationPercent: 1.0 })],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery({ totalCapacityKwh: 10 }),
        generationConfig: config,
        allowSolarExport: false,
        annualBatteryDegradationRate: 2.0,
        projectionYears: 3,
        allowIncompleteYearForTesting: true,
      });

      expect(projection.years[0].batteryCapacityRetentionFactor).toBe(1.0);
      expect(projection.years[1].batteryCapacityRetentionFactor).toBe(0.98);
      expect(projection.years[2].batteryCapacityRetentionFactor).toBe(0.96);

      expect(projection.years[0].solarAssets[0].capacityRetentionFactor).toBe(1.0);
      expect(projection.years[1].solarAssets[0].capacityRetentionFactor).toBeCloseTo(0.99, 6);
      expect(projection.years[2].solarAssets[0].capacityRetentionFactor).toBeCloseTo(0.99 * 0.99, 6);
    });
  });

  // ==========================================================================
  // 4. Tariff Escalation
  // ==========================================================================
  describe('Tariff escalation', () => {
    it('13. Year 1 rates are unchanged', () => {
      const { tiers, inflationFactor } = deriveTariffsForProjectionYear(defaultTiers, undefined, 1, 3.5);
      expect(inflationFactor).toBe(1.0);
      expect(tiers[0].buyRate).toBe(0.15);
      expect(tiers[0].sellRate).toBe(0.08);
    });

    it('14. Later-year base tier rates use compound electricity escalation', () => {
      const inflationPercent = 3.0;
      const { tiers: y3Tiers, inflationFactor } = deriveTariffsForProjectionYear(
        defaultTiers,
        undefined,
        3,
        inflationPercent
      );

      const expectedFactor = Math.pow(1.03, 2);
      expect(inflationFactor).toBeCloseTo(expectedFactor, 8);
      expect(y3Tiers[0].buyRate).toBeCloseTo(0.15 * expectedFactor, 8);
      expect(y3Tiers[0].sellRate).toBeCloseTo(0.08 * expectedFactor, 8);
      expect(y3Tiers[1].buyRate).toBeCloseTo(0.50 * expectedFactor, 8);
      expect(y3Tiers[1].sellRate).toBeCloseTo(0.35 * expectedFactor, 8);
    });

    it('15. Seasonal rate overrides are escalated consistently', () => {
      const seasons: TouSeason[] = [
        {
          id: 'summer',
          name: 'Summer Season',
          months: [5, 6, 7],
          tierRates: {
            'on-peak': { buyRate: 0.60, sellRate: 0.40 },
          },
        },
      ];

      const { seasons: y2Seasons } = deriveTariffsForProjectionYear(defaultTiers, seasons, 2, 5.0);
      expect(y2Seasons![0].tierRates['on-peak'].buyRate).toBeCloseTo(0.60 * 1.05, 8);
      expect(y2Seasons![0].tierRates['on-peak'].sellRate).toBeCloseTo(0.40 * 1.05, 8);
    });

    it('16. Original tariff objects are not mutated', () => {
      const origTier0Buy = defaultTiers[0].buyRate;
      deriveTariffsForProjectionYear(defaultTiers, undefined, 5, 4.0);
      expect(defaultTiers[0].buyRate).toBe(origTier0Buy);
    });

    it('17. Savings are produced by the Year-N tariff simulation rather than by post-multiplying Year-1 savings', () => {
      const dataPoints = createHourlyDataPoints(24, 2.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { annualDegradationPercent: 0.5 })],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowSolarExport: true,
        annualElectricityInflationRate: 3.5,
        projectionYears: 2,
        allowIncompleteYearForTesting: true,
      });

      const y1Savings = projection.years[0].electricitySavingsUsd;
      const y2Savings = projection.years[1].electricitySavingsUsd;

      // Ensure Year 2 savings are from simulation, not simply y1Savings * 1.035
      expect(y2Savings).not.toBe(y1Savings * 1.035);
      expect(projection.years[1].baselineElectricityCostUsd).toBeCloseTo(
        projection.years[0].baselineElectricityCostUsd * 1.035,
        4
      );
    });
  });

  // ==========================================================================
  // 5. Operational Scenarios
  // ==========================================================================
  describe('Operational scenarios', () => {
    it('18. Solar self-consumption produces reconciled annual aggregates', () => {
      const dataPoints = createHourlyDataPoints(24, 2.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { dcCapacityKw: 4.0 })],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery({ strategy: 'self_consumption' }),
        generationConfig: config,
        allowSolarExport: false,
        projectionYears: 2,
        allowIncompleteYearForTesting: true,
      });

      for (const yr of projection.years) {
        expect(yr.solarGeneratedKwh).toBeGreaterThan(0);
        expect(yr.solarDirectToLoadKwh).toBeGreaterThan(0);
        expect(yr.electricitySavingsUsd).toBeGreaterThan(0);
      }
    });

    it('19. Solar export enabled produces authoritative solar export', () => {
      const dataPoints = createHourlyDataPoints(24, 0.2); // Low load -> high surplus
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { dcCapacityKw: 6.0 })],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowSolarExport: true,
        projectionYears: 1,
        allowIncompleteYearForTesting: true,
      });

      expect(projection.years[0].solarExportKwh).toBeGreaterThan(0);
      expect(projection.years[0].solarCurtailedKwh).toBe(0);
    });

    it('20. Solar export disabled produces curtailment instead', () => {
      const dataPoints = createHourlyDataPoints(24, 0.2); // Low load -> high surplus
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { dcCapacityKw: 6.0 })],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowSolarExport: false,
        projectionYears: 1,
        allowIncompleteYearForTesting: true,
      });

      expect(projection.years[0].solarExportKwh).toBe(0);
      expect(projection.years[0].solarCurtailedKwh).toBeGreaterThan(0);
    });

    it('21. Battery export remains distinct from solar export', () => {
      const dataPoints = createHourlyDataPoints(24, 1.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { dcCapacityKw: 6.0 })],
      };

      const battery = createTestBattery({
        allowGridExport: true,
        chargeTiers: ['off-peak'],
        dischargeTiers: ['on-peak'],
      });

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: true,
        projectionYears: 1,
        allowIncompleteYearForTesting: true,
      });

      const yr1 = projection.years[0];
      // Total grid export = solar export + battery export
      expect(yr1.gridExportKwh).toBeCloseTo(yr1.solarExportKwh + yr1.batteryExportKwh, 6);
    });

    it('22. Grid-battery arbitrage remains operational while solar degrades; does not directly scale arbitrage by solar retention', () => {
      const dataPoints = createHourlyDataPoints(24, 2.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { dcCapacityKw: 4.0, annualDegradationPercent: 10.0 })], // Heavy solar degradation
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery({ totalCapacityKwh: 10, strategy: 'arbitrage' }),
        generationConfig: config,
        allowSolarExport: false,
        annualBatteryDegradationRate: 0, // Battery does not degrade
        projectionYears: 2,
        allowIncompleteYearForTesting: true,
      });

      // Battery throughput is driven by TOU grid/battery arbitrage, so discharged energy is preserved
      // and not artificially scaled down by the 10% solar degradation factor.
      expect(projection.years[1].batteryDischargedKwh).toBeGreaterThan(0);
      expect(projection.years[1].batteryDischargedKwh).toBeGreaterThanOrEqual(
        projection.years[0].batteryDischargedKwh
      );
      expect(projection.years[1].batteryDischargedKwh).toBeGreaterThan(
        projection.years[0].batteryDischargedKwh * 0.9
      );
    });
  });

  // ==========================================================================
  // 6. Reconciliation
  // ==========================================================================
  describe('Reconciliation', () => {
    it('23. For every tested year: solar generated ≈ direct-to-load + solar-to-battery + solar export + curtailed solar', () => {
      const dataPoints = createHourlyDataPoints(48, 1.2);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { dcCapacityKw: 6.0, annualDegradationPercent: 0.8 })],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowSolarExport: true,
        projectionYears: 3,
        allowIncompleteYearForTesting: true,
      });

      for (const yr of projection.years) {
        const sumOfSinks =
          yr.solarDirectToLoadKwh +
          yr.solarToBatteryKwh +
          yr.solarExportKwh +
          yr.solarCurtailedKwh;

        expect(yr.solarGeneratedKwh).toBeCloseTo(sumOfSinks, 4);
      }
    });

    it('24. For every tested year: electricity savings ≈ baseline cost - simulated cost', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { dcCapacityKw: 5.0, annualDegradationPercent: 0.5 })],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowSolarExport: false,
        projectionYears: 4,
        allowIncompleteYearForTesting: true,
      });

      for (const yr of projection.years) {
        const diff = yr.baselineElectricityCostUsd - yr.simulatedElectricityCostUsd;
        expect(yr.electricitySavingsUsd).toBeCloseTo(diff, 6);
      }
    });
  });

  // ==========================================================================
  // 7. Boundary / Compatibility & Contract Horizon
  // ==========================================================================
  describe('Boundary / compatibility & contract horizon', () => {
    it('25. Projection output stores compact annual aggregates rather than retaining interval arrays', () => {
      const dataPoints = createHourlyDataPoints(24, 1.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1')],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowSolarExport: true,
        projectionYears: 2,
        allowIncompleteYearForTesting: true,
      });

      for (const yr of projection.years) {
        expect((yr as any).intervals).toBeUndefined();
        expect((yr as any).intervalResults).toBeUndefined();
        expect((yr as any).exportAwareBatteryFlow).toBeUndefined();
        expect(typeof yr.year).toBe('number');
        expect(typeof yr.electricitySavingsUsd).toBe('number');
        expect(Array.isArray(yr.solarAssets)).toBe(true);
      }
    });

    it('26. Original generation config, battery profile, tariffs, seasons, schedule and load data remain unchanged', () => {
      const origBatteryCap = 10;
      const battery = createTestBattery({ totalCapacityKwh: origBatteryCap });
      const origSolarDc = 6.0;
      const solarAsset = createClearSkyAsset('s1', { dcCapacityKw: origSolarDc });
      const config: GenerationConfig = { site: baseSite, assets: [solarAsset] };
      const origTier0Buy = defaultTiers[0].buyRate;
      const schedule = createScheduleMatrix();
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const origUsage0 = dataPoints[0].usageKwh;

      calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: schedule,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: true,
        annualElectricityInflationRate: 5.0,
        annualBatteryDegradationRate: 3.0,
        projectionYears: 2,
        allowIncompleteYearForTesting: true,
      });

      expect(battery.totalCapacityKwh).toBe(origBatteryCap);
      expect(solarAsset.dcCapacityKw).toBe(origSolarDc);
      expect(defaultTiers[0].buyRate).toBe(origTier0Buy);
      expect(dataPoints[0].usageKwh).toBe(origUsage0);
    });

    it('27. No-generation configuration does not silently enter the G4B generation projection', () => {
      const dataPoints = createHourlyDataPoints(24, 1.0);
      const emptyConfig: GenerationConfig = { site: baseSite, assets: [] };

      expect(() =>
        calculateGenerationOperationalProjection({
          dataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: createScheduleMatrix(),
          batteryProfile: createTestBattery(),
          generationConfig: emptyConfig,
          allowSolarExport: true,
          allowIncompleteYearForTesting: true,
        })
      ).toThrow(/requires at least one enabled/i);

      const disabledConfig: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { enabled: false })],
      };

      expect(() =>
        calculateGenerationOperationalProjection({
          dataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: createScheduleMatrix(),
          batteryProfile: createTestBattery(),
          generationConfig: disabledConfig,
          allowSolarExport: true,
          allowIncompleteYearForTesting: true,
        })
      ).toThrow(/requires at least one enabled/i);
    });

    it('28. Existing unsupported enabled generator and wind interval_file remain unsupported rather than falling back to legacy', () => {
      const dataPoints = createHourlyDataPoints(24, 1.0);
      const windIntervalConfig: GenerationConfig = {
        site: baseSite,
        assets: [
          createClearSkyAsset('s1'),
          {
            id: 'wind-1',
            name: 'Wind Turbine',
            type: 'wind',
            enabled: true,
            resourceMode: 'interval_file',
            ratedPowerKw: 10,
            hubHeightMeters: 30,
            rotorDiameterMeters: 12,
            cutInWindSpeedMps: 3,
            ratedWindSpeedMps: 11,
            cutOutWindSpeedMps: 25,
            installedCostUsd: 10000,
            annualMaintenanceCostUsd: 200,
          } as unknown as WindGenerationAsset,
        ],
      };

      expect(() =>
        calculateGenerationOperationalProjection({
          dataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: createScheduleMatrix(),
          batteryProfile: createTestBattery(),
          generationConfig: windIntervalConfig,
          allowSolarExport: true,
          allowIncompleteYearForTesting: true,
        })
      ).toThrow(/Wind assets with resourceMode "interval_file" are unsupported/i);

      const genConfig: GenerationConfig = {
        site: baseSite,
        assets: [
          createClearSkyAsset('s1'),
          {
            id: 'gen-1',
            name: 'Diesel Gen',
            type: 'generator',
            enabled: true,
            installedCostUsd: 5000,
            annualMaintenanceCostUsd: 100,
          } as GeneratorGenerationAsset,
        ],
      };

      expect(() =>
        calculateGenerationOperationalProjection({
          dataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: createScheduleMatrix(),
          batteryProfile: createTestBattery(),
          generationConfig: genConfig,
          allowSolarExport: true,
          allowIncompleteYearForTesting: true,
        })
      ).toThrow(/Unsupported generation asset type: "generator"/i);
    });

    it('29. Rejects partial-period datasets when suitability check is not bypassed', () => {
      const shortDataPoints = createHourlyDataPoints(48, 1.0); // 2 days < 360 days
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1')],
      };

      expect(() =>
        calculateGenerationOperationalProjection({
          dataPoints: shortDataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: createScheduleMatrix(),
          batteryProfile: createTestBattery(),
          generationConfig: config,
          allowSolarExport: true,
        })
      ).toThrow(/not suitable for annual operational projection/i);
    });

    it('30. Default contract horizon is 25 years without retaining interval history', () => {
      const dataPoints = createHourlyDataPoints(24, 1.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1')],
      };

      const projection = projectGenerationAwareOperations({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowSolarExport: true,
        allowIncompleteYearForTesting: true,
      });

      expect(projection.horizonYears).toBe(25);
      expect(projection.years).toHaveLength(25);
      expect(projection).toHaveLength(25);
      expect(projection.years[0].year).toBe(1);
      expect(projection.years[24].year).toBe(25);
      // Confirms compact memory: no intervals retained in 25-year series
      expect((projection.years[24] as any).intervals).toBeUndefined();
    });

    it('31. Validates horizon bounds (1 to 25)', () => {
      const dataPoints = createHourlyDataPoints(24, 1.0);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1')],
      };

      expect(() =>
        calculateGenerationOperationalProjection({
          dataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: createScheduleMatrix(),
          batteryProfile: createTestBattery(),
          generationConfig: config,
          allowSolarExport: true,
          horizonYears: 0,
          allowIncompleteYearForTesting: true,
        })
      ).toThrow(/between 1 and 25 years/i);

      expect(() =>
        calculateGenerationOperationalProjection({
          dataPoints,
          intervalHours: 1,
          tiers: defaultTiers,
          scheduleMatrix: createScheduleMatrix(),
          batteryProfile: createTestBattery(),
          generationConfig: config,
          allowSolarExport: true,
          horizonYears: 26,
          allowIncompleteYearForTesting: true,
        })
      ).toThrow(/between 1 and 25 years/i);
    });
  });

  // ==========================================================================
  // G5D — Multi-Year Wind and Solar+Wind Operational Projections
  // ==========================================================================
  describe('G5D — Multi-Year Wind and Solar+Wind Operational Projections', () => {
    function createTestWindAsset(
      id = 'wind-1',
      overrides: Partial<WindGenerationAsset> = {}
    ): WindGenerationAsset {
      return {
        id,
        name: 'Residential Wind Turbine',
        type: 'wind',
        enabled: true,
        installedCostUsd: 15000,
        annualMaintenanceCostUsd: 250,
        ratedPowerKw: 10.0,
        hubHeightM: 30.0,
        rotorDiameterM: 10.0,
        measurementHeightM: 10.0,
        windShearExponent: 0.143,
        cutInWindSpeedMps: 3.0,
        ratedWindSpeedMps: 12.0,
        cutOutWindSpeedMps: 25.0,
        availabilityPercent: 100.0,
        systemLossPercent: 0.0,
        resourceMode: 'annual_average',
        annualAverageWindSpeedMps: 7.0,
        monthlyAverageWindSpeedMps: [
          6.0, 6.5, 7.0, 7.5, 7.0, 6.5, 6.0, 6.5, 7.0, 7.5, 8.0, 7.0,
        ],
        powerCurve: [
          { windSpeedMps: 0.0, outputKw: 0.0 },
          { windSpeedMps: 3.0, outputKw: 0.0 },
          { windSpeedMps: 6.0, outputKw: 2.5 },
          { windSpeedMps: 9.0, outputKw: 6.5 },
          { windSpeedMps: 12.0, outputKw: 10.0 },
          { windSpeedMps: 25.0, outputKw: 10.0 },
        ],
        ...overrides,
      };
    }

    it('1. Wind-only Year-1 projection succeeds and produces authoritative wind metrics', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const windConfig: GenerationConfig = {
        site: baseSite,
        assets: [createTestWindAsset('wind-1')],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: windConfig,
        allowRenewableExport: true,
        horizonYears: 1,
        allowIncompleteYearForTesting: true,
      });

      expect(projection.horizonYears).toBe(1);
      expect(projection.years).toHaveLength(1);
      const y1 = projection.years[0];
      expect(y1.year).toBe(1);
      expect(y1.windGeneratedKwh).toBeGreaterThan(0);
      expect(y1.solarGeneratedKwh).toBe(0);
      expect(y1.solarDirectToLoadKwh).toBe(0);
      expect(y1.solarToBatteryKwh).toBe(0);
      expect(y1.solarExportKwh).toBe(0);
      expect(y1.solarCurtailedKwh).toBe(0);
      expect(y1.solarAssets).toEqual([]);
      expect(y1.renewableGeneratedKwh).toBe(y1.windGeneratedKwh);
      expect(y1.renewableDirectToLoadKwh).toBe(y1.windDirectToLoadKwh);
      expect(y1.renewableToBatteryKwh).toBe(y1.windToBatteryKwh);
      expect(y1.renewableExportKwh).toBe(y1.windExportKwh);
      expect(y1.renewableCurtailedKwh).toBe(y1.windCurtailedKwh);
      expect(y1.electricitySavingsUsd).toBeCloseTo(
        y1.baselineElectricityCostUsd - y1.simulatedElectricityCostUsd,
        2
      );
    });

    it('2. Wind-only multi-year projection produces contiguous years and valid economics', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const windConfig: GenerationConfig = {
        site: baseSite,
        assets: [createTestWindAsset('wind-1')],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: windConfig,
        allowRenewableExport: true,
        horizonYears: 5,
        allowIncompleteYearForTesting: true,
      });

      expect(projection.horizonYears).toBe(5);
      expect(projection.years).toHaveLength(5);
      for (let i = 0; i < 5; i++) {
        expect(projection.years[i].year).toBe(i + 1);
        expect(projection.years[i].windGeneratedKwh).toBeGreaterThan(0);
        expect(projection.years[i].solarGeneratedKwh).toBe(0);
      }
    });

    it('3. Solar-only existing projection parity: wind metrics are zero and solar metrics match', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const solarConfig: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1', { annualDegradationPercent: 0.5 })],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: solarConfig,
        allowSolarExport: true,
        horizonYears: 3,
        allowIncompleteYearForTesting: true,
      });

      for (const y of projection.years) {
        expect(y.windGeneratedKwh).toBe(0);
        expect(y.windDirectToLoadKwh).toBe(0);
        expect(y.windToBatteryKwh).toBe(0);
        expect(y.windExportKwh).toBe(0);
        expect(y.windCurtailedKwh).toBe(0);

        expect(y.renewableGeneratedKwh).toBe(y.solarGeneratedKwh);
        expect(y.renewableDirectToLoadKwh).toBe(y.solarDirectToLoadKwh);
        expect(y.renewableToBatteryKwh).toBe(y.solarToBatteryKwh);
        expect(y.renewableExportKwh).toBe(y.solarExportKwh);
        expect(y.renewableCurtailedKwh).toBe(y.solarCurtailedKwh);
      }
      expect(projection.years[0].solarAssets[0].capacityRetentionFactor).toBe(1.0);
      expect(projection.years[1].solarAssets[0].capacityRetentionFactor).toBeCloseTo(0.995, 4);
    });

    it('4. Solar + wind multi-year projection combines both technologies', () => {
      const dataPoints = createHourlyDataPoints(24, 2.0);
      const mixedConfig: GenerationConfig = {
        site: baseSite,
        assets: [createClearSkyAsset('s1'), createTestWindAsset('w1')],
      };

      const projection = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: mixedConfig,
        allowRenewableExport: true,
        horizonYears: 3,
        allowIncompleteYearForTesting: true,
      });

      for (const y of projection.years) {
        expect(y.solarGeneratedKwh).toBeGreaterThan(0);
        expect(y.windGeneratedKwh).toBeGreaterThan(0);
        expect(y.renewableGeneratedKwh).toBeCloseTo(
          y.solarGeneratedKwh + y.windGeneratedKwh,
          4
        );
        expect(y.renewableDirectToLoadKwh).toBeCloseTo(
          y.solarDirectToLoadKwh + y.windDirectToLoadKwh,
          4
        );
        expect(y.renewableToBatteryKwh).toBeCloseTo(
          y.solarToBatteryKwh + y.windToBatteryKwh,
          4
        );
        expect(y.renewableExportKwh).toBeCloseTo(
          y.solarExportKwh + y.windExportKwh,
          4
        );
        expect(y.renewableCurtailedKwh).toBeCloseTo(
          y.solarCurtailedKwh + y.windCurtailedKwh,
          4
        );
      }
    });

    it('5. Multiple wind turbines combine outputs additively', () => {
      const dataPoints = createHourlyDataPoints(24, 2.5);
      const singleTurbineConfig: GenerationConfig = {
        site: baseSite,
        assets: [createTestWindAsset('w1', { ratedPowerKw: 10.0 })],
      };
      const twoTurbineConfig: GenerationConfig = {
        site: baseSite,
        assets: [
          createTestWindAsset('w1', { ratedPowerKw: 10.0 }),
          createTestWindAsset('w2', {
            ratedPowerKw: 5.0,
            hubHeightM: 25.0,
            powerCurve: [
              { windSpeedMps: 0.0, outputKw: 0.0 },
              { windSpeedMps: 3.0, outputKw: 0.0 },
              { windSpeedMps: 6.0, outputKw: 1.5 },
              { windSpeedMps: 9.0, outputKw: 3.5 },
              { windSpeedMps: 12.0, outputKw: 5.0 },
              { windSpeedMps: 25.0, outputKw: 5.0 },
            ],
          }),
        ],
      };

      const pSingle = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: singleTurbineConfig,
        allowRenewableExport: true,
        horizonYears: 1,
        allowIncompleteYearForTesting: true,
      });

      const pTwo = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: twoTurbineConfig,
        allowRenewableExport: true,
        horizonYears: 1,
        allowIncompleteYearForTesting: true,
      });

      expect(pTwo.years[0].windGeneratedKwh).toBeGreaterThan(
        pSingle.years[0].windGeneratedKwh
      );
    });

    it('6. Annual-average wind resource mode simulates multi-year projection', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [
          createTestWindAsset('w1', {
            resourceMode: 'annual_average',
            annualAverageWindSpeedMps: 6.8,
          }),
        ],
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

      expect(proj.years[0].windGeneratedKwh).toBeGreaterThan(0);
    });

    it('7. Monthly-average wind resource mode simulates multi-year projection', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [
          createTestWindAsset('w1', {
            resourceMode: 'monthly_average',
            monthlyAverageWindSpeedMps: [
              6.0, 6.2, 6.5, 7.0, 7.2, 7.0, 6.5, 6.0, 6.2, 6.5, 6.8, 6.5,
            ],
          }),
        ],
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

      expect(proj.years[0].windGeneratedKwh).toBeGreaterThan(0);
    });

    it('8. Wind generated energy remains constant across years when no wind degradation contract exists', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [createTestWindAsset('w1')],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: true,
        horizonYears: 5,
        annualBatteryDegradationRate: 2.0,
        annualElectricityInflationRate: 3.0,
        allowIncompleteYearForTesting: true,
      });

      const y1Generated = proj.years[0].windGeneratedKwh;
      for (let y = 1; y < 5; y++) {
        expect(proj.years[y].windGeneratedKwh).toBeCloseTo(y1Generated, 4);
      }
    });

    it('9. Wind configuration, power curves, and resource arrays are cloned and remain unchanged across projected years', () => {
      const baseWind = createTestWindAsset('w1');
      const baseConfig: GenerationConfig = {
        site: baseSite,
        assets: [baseWind],
      };

      const year5 = deriveGenerationConfigForProjectionYear(baseConfig, 5);
      const clonedWind = year5.generationConfig.assets[0] as WindGenerationAsset;

      expect(clonedWind.ratedPowerKw).toBe(baseWind.ratedPowerKw);
      expect(clonedWind.hubHeightM).toBe(baseWind.hubHeightM);
      expect(clonedWind.powerCurve).toEqual(baseWind.powerCurve);
      expect(clonedWind.powerCurve).not.toBe(baseWind.powerCurve);
      expect(clonedWind.monthlyAverageWindSpeedMps).toEqual(
        baseWind.monthlyAverageWindSpeedMps
      );
      expect(clonedWind.monthlyAverageWindSpeedMps).not.toBe(
        baseWind.monthlyAverageWindSpeedMps
      );
    });

    it('10. Solar degradation still compounds independently per array in mixed configurations', () => {
      const mixedConfig: GenerationConfig = {
        site: baseSite,
        assets: [
          createClearSkyAsset('s1', { dcCapacityKw: 6.0, annualDegradationPercent: 0.5 }),
          createClearSkyAsset('s2', { dcCapacityKw: 4.0, annualDegradationPercent: 1.0 }),
          createTestWindAsset('w1'),
        ],
      };

      const y3 = deriveGenerationConfigForProjectionYear(mixedConfig, 3);
      expect(y3.solarAssets).toHaveLength(2);
      expect(y3.solarAssets[0].capacityRetentionFactor).toBeCloseTo(Math.pow(0.995, 2), 6);
      expect(y3.solarAssets[1].capacityRetentionFactor).toBeCloseTo(Math.pow(0.99, 2), 6);
      const windInY3 = y3.generationConfig.assets[2] as WindGenerationAsset;
      expect(windInY3.ratedPowerKw).toBe(10.0);
    });

    it('11. In mixed project, solar degrades while wind capability does not', () => {
      const dataPoints = createHourlyDataPoints(24, 2.0);
      const mixedConfig: GenerationConfig = {
        site: baseSite,
        assets: [
          createClearSkyAsset('s1', { annualDegradationPercent: 1.0 }),
          createTestWindAsset('w1'),
        ],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: mixedConfig,
        allowRenewableExport: true,
        horizonYears: 4,
        allowIncompleteYearForTesting: true,
      });

      // Solar generation decreases
      expect(proj.years[0].solarGeneratedKwh).toBeGreaterThan(proj.years[3].solarGeneratedKwh);
      // Wind generation remains constant
      expect(proj.years[0].windGeneratedKwh).toBeCloseTo(proj.years[3].windGeneratedKwh, 4);
    });

    it('12. Battery degradation influences wind/battery interaction through authoritative rerun', () => {
      const dataPoints = createHourlyDataPoints(24, 0.5); // light load -> high wind surplus
      const windConfig: GenerationConfig = {
        site: baseSite,
        assets: [createTestWindAsset('w1', { ratedPowerKw: 20.0 })],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery({ totalCapacityKwh: 20 }),
        generationConfig: windConfig,
        allowRenewableExport: true,
        horizonYears: 5,
        annualBatteryDegradationRate: 5.0, // significant battery degradation
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years[0].batteryCapacityRetentionFactor).toBe(1.0);
      expect(proj.years[4].batteryCapacityRetentionFactor).toBeCloseTo(0.80, 2);
      expect(proj.years[4].batteryUsableCapacityKwh).toBeLessThan(
        proj.years[0].batteryUsableCapacityKwh
      );
    });

    it('13. Tariff inflation changes wind-project economics through Year-N tariff inputs', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const windConfig: GenerationConfig = {
        site: baseSite,
        assets: [createTestWindAsset('w1')],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: windConfig,
        allowRenewableExport: true,
        horizonYears: 3,
        annualElectricityInflationRate: 5.0,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years[1].baselineElectricityCostUsd).toBeGreaterThan(
        proj.years[0].baselineElectricityCostUsd
      );
      expect(proj.years[2].baselineElectricityCostUsd).toBeGreaterThan(
        proj.years[1].baselineElectricityCostUsd
      );
    });

    it('14. Grid export reconciles to renewable + battery export for wind projects', () => {
      const dataPoints = createHourlyDataPoints(24, 0.5);
      const windConfig: GenerationConfig = {
        site: baseSite,
        assets: [createTestWindAsset('w1', { ratedPowerKw: 15.0 })],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery({ allowGridExport: true }),
        generationConfig: windConfig,
        allowRenewableExport: true,
        horizonYears: 2,
        allowIncompleteYearForTesting: true,
      });

      for (const y of proj.years) {
        expect(y.gridExportKwh).toBeCloseTo(
          y.renewableExportKwh + y.batteryExportKwh,
          2
        );
      }
    });

    it('15. Memory efficiency: compact annual records retain no intervals in wind projection', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const windConfig: GenerationConfig = {
        site: baseSite,
        assets: [createTestWindAsset('w1')],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: windConfig,
        allowRenewableExport: true,
        horizonYears: 5,
        allowIncompleteYearForTesting: true,
      });

      for (const y of proj.years) {
        expect((y as any).intervals).toBeUndefined();
        expect((y as any).exportAwareBatteryFlow).toBeUndefined();
      }
    });

    it('16. Base config/assets are not mutated during wind projection', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const windAsset = createTestWindAsset('w1');
      const baseConfig: GenerationConfig = {
        site: { ...baseSite },
        assets: [windAsset],
      };

      const copyBefore = JSON.stringify(baseConfig);
      calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: baseConfig,
        allowRenewableExport: true,
        horizonYears: 3,
        allowIncompleteYearForTesting: true,
      });

      expect(JSON.stringify(baseConfig)).toBe(copyBefore);
    });

    it('17. Disabled generator and disabled wind interval_file do not block valid supported projection', () => {
      const dataPoints = createHourlyDataPoints(24, 1.5);
      const config: GenerationConfig = {
        site: baseSite,
        assets: [
          createTestWindAsset('w1', { enabled: true }),
          {
            id: 'gen-1',
            name: 'Standby Generator',
            type: 'generator',
            enabled: false,
            installedCostUsd: 5000,
            annualMaintenanceCostUsd: 100,
          } as GeneratorGenerationAsset,
          {
            id: 'wind-disabled-file',
            name: 'File Wind',
            type: 'wind',
            enabled: false,
            resourceMode: 'interval_file',
            installedCostUsd: 8000,
            annualMaintenanceCostUsd: 150,
          } as WindGenerationAsset,
        ],
      };

      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: config,
        allowRenewableExport: true,
        horizonYears: 2,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years).toHaveLength(2);
      expect(proj.years[0].windGeneratedKwh).toBeGreaterThan(0);
    });

    it('18. allowRenewableExport takes precedence over allowSolarExport when both are provided', () => {
      const dataPoints = createHourlyDataPoints(24, 0.5);
      const windConfig: GenerationConfig = {
        site: baseSite,
        assets: [createTestWindAsset('w1', { ratedPowerKw: 15.0 })],
      };

      // allowRenewableExport: false, allowSolarExport: true -> export should be prohibited (0)
      const proj = calculateGenerationOperationalProjection({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createTestBattery(),
        generationConfig: windConfig,
        allowRenewableExport: false,
        allowSolarExport: true,
        horizonYears: 1,
        allowIncompleteYearForTesting: true,
      });

      expect(proj.years[0].windExportKwh).toBe(0);
      expect(proj.years[0].renewableExportKwh).toBe(0);
      expect(proj.years[0].windCurtailedKwh).toBeGreaterThan(0);
    });
  });
});
