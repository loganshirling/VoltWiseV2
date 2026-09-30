import { describe, it, expect } from 'vitest';
import {
  runGenerationAwareSimulation,
  GenerationAwareSimulationParams,
} from '../utils/generationAwareSimulation';
import {
  BatteryProfile,
  BatterySocProvenanceState,
  GenerationConfig,
  GenerationSite,
  GridSocCostBasisState,
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
import { summarizeSolarLoadFlow } from '../utils/solarLoadFlow';

describe('G3Q Milestone — Authoritative Solar Generation Simulation Pipeline', () => {
  const baseSite: GenerationSite = {
    latitude: 37.7749, // San Francisco, CA
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
    },
    {
      id: 'on-peak',
      name: 'On-Peak Tier',
      buyRate: 0.45,
      sellRate: 0.35,
      color: '#EF4444',
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
      roundTripEfficiencyPercent: 100, // 100% RTE for clean arithmetic
      ratedCycleLife: 4000,
      installedCost: 8000,
      strategy: 'arbitrage',
      chargeTiers: ['off-peak'],
      dischargeTiers: ['on-peak'],
      allowGridExport: true,
      ...overrides,
    };
  }

  const zeroBatteryState: BatterySocProvenanceState = {
    syntheticSocKwh: 0,
    gridChargedSocKwh: 0,
    renewableChargedSocKwh: 0,
    generatorChargedSocKwh: 0,
  };

  const zeroCostBasisState: GridSocCostBasisState = {
    gridStoredEnergyKwh: 0,
    totalAcquisitionCostUsd: 0,
  };

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
      resourceMode: 'clear_sky',
      ...overrides,
    };
  }

  function createDataPoints(
    count = 24,
    usageKwh: number | number[] = 1.0,
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
        dayOfWeek: 0,
        month,
        usageKwh: usage,
      });
    }
    return points;
  }

  function buildSimulationParams(
    overrides: Partial<GenerationAwareSimulationParams> = {}
  ): GenerationAwareSimulationParams {
    const solarAsset = createClearSkyAsset();
    const generationConfig: GenerationConfig = {
      site: baseSite,
      assets: [solarAsset],
    };

    return {
      dataPoints: createDataPoints(24, 1.0),
      intervalHours: 1.0,
      generationConfig,
      tiers: defaultTiers,
      scheduleMatrix: createScheduleMatrix(),
      batteryProfile: createTestBattery(),
      allowSolarExport: true,
      initialBatteryState: { ...zeroBatteryState },
      initialCostBasisState: { ...zeroCostBasisState },
      ...overrides,
    };
  }

  // --------------------------------------------------------------------------
  // 1. simple enabled clear-sky solar asset runs through full pipeline
  // --------------------------------------------------------------------------
  it('1. simple enabled clear-sky solar asset runs through full pipeline', () => {
    const params = buildSimulationParams();
    const result = runGenerationAwareSimulation(params);

    // Verify all authoritative stage outputs exist and have correct length
    expect(result.alignedTimestamps).toHaveLength(24);
    expect(result.solarFleetProfile).toHaveLength(24);
    expect(result.solarLoadFlow).toHaveLength(24);
    expect(result.dispatchPolicy).toHaveLength(24);
    expect(result.resolvedRates).toHaveLength(24);
    expect(result.exportAwareBatteryFlow.intervals).toHaveLength(24);
    expect(result.gridFlows.intervals).toHaveLength(24);
    expect(result.tariffCosts.intervals).toHaveLength(24);

    // Verify production occurred during daylight hours
    expect(result.totalSolarGenerationKwh).toBeGreaterThan(0);
    expect(result.totalHomeLoadKwh).toBe(24.0);
    expect(result.totalSolarDirectToLoadKwh).toBeGreaterThan(0);

    // Verify aggregate values are finite numbers
    expect(Number.isFinite(result.baselineCost)).toBe(true);
    expect(Number.isFinite(result.simulatedCost)).toBe(true);
    expect(Number.isFinite(result.netSavings)).toBe(true);
    expect(result.netSavings).toBeCloseTo(
      result.baselineCost - result.simulatedCost,
      6
    );
  });

  // --------------------------------------------------------------------------
  // 2. solar generation serves load before grid
  // --------------------------------------------------------------------------
  it('2. solar generation serves load before grid', () => {
    // 24 intervals with varying load
    const params = buildSimulationParams({
      dataPoints: createDataPoints(24, 2.0),
      // No battery dispatch so we inspect pure solar serving load
      batteryProfile: createTestBattery({
        chargeTiers: [],
        dischargeTiers: [],
      }),
    });
    const result = runGenerationAwareSimulation(params);

    // Find midday interval with solar generation
    const midDayIdx = 13; // 13:00 PDT is peak sun
    const flow = result.solarLoadFlow[midDayIdx];
    const grid = result.gridFlows.intervals[midDayIdx];

    expect(flow.solarGenerationKwh).toBeGreaterThan(0);
    expect(flow.solarDirectToLoadKwh).toBe(
      Math.min(flow.homeLoadKwh, flow.solarGenerationKwh)
    );
    expect(flow.residualHomeLoadKwh).toBe(
      flow.homeLoadKwh - flow.solarDirectToLoadKwh
    );
    // Grid import for home exactly matches residual home load
    expect(grid.gridImportForHomeKwh).toBeCloseTo(flow.residualHomeLoadKwh, 6);
  });

  // --------------------------------------------------------------------------
  // 3. solar surplus charges battery
  // --------------------------------------------------------------------------
  it('3. solar surplus charges battery', () => {
    // 0.2 kWh low load during sunny day so solar surplus is large
    const params = buildSimulationParams({
      dataPoints: createDataPoints(24, 0.2),
      batteryProfile: createTestBattery({
        totalCapacityKwh: 20,
        maxContinuousChargeKw: 5,
        chargeTiers: [], // Not grid-charged
      }),
      initialBatteryState: { ...zeroBatteryState },
    });
    const result = runGenerationAwareSimulation(params);

    // Midday interval should have surplus solar charging battery
    const midDayIdx = 13;
    const inv = result.exportAwareBatteryFlow.intervals[midDayIdx];

    expect(inv.preExportFlow.surplusSolarBeforeBatteryKwh).toBeGreaterThan(0);
    expect(inv.preExportFlow.renewableEnergyStoredKwh).toBeGreaterThan(0);
    expect(inv.preExportFlow.batterySocAfterKwh).toBeGreaterThan(
      inv.preExportFlow.batterySocBeforeKwh
    );
    expect(
      result.exportAwareBatteryFlow.finalBatteryState.renewableChargedSocKwh
    ).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 4. remaining solar surplus exports when allowSolarExport=true
  // --------------------------------------------------------------------------
  it('4. remaining solar surplus exports when allowSolarExport=true', () => {
    // Zero load and small battery (1 kWh) so solar surplus cannot all fit in battery
    const params = buildSimulationParams({
      dataPoints: createDataPoints(24, 0.0),
      batteryProfile: createTestBattery({
        totalCapacityKwh: 1.0,
        maxContinuousChargeKw: 1.0,
      }),
      allowSolarExport: true,
    });
    const result = runGenerationAwareSimulation(params);

    expect(result.totalSolarExportKwh).toBeGreaterThan(0);
    expect(result.gridFlows.totalCurtailedSolarKwh).toBe(0);
    expect(result.tariffCosts.solarExportCredit).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 5. remaining solar surplus curtails when false
  // --------------------------------------------------------------------------
  it('5. remaining solar surplus curtails when false', () => {
    // Same setup but allowSolarExport = false
    const params = buildSimulationParams({
      dataPoints: createDataPoints(24, 0.0),
      batteryProfile: createTestBattery({
        totalCapacityKwh: 1.0,
        maxContinuousChargeKw: 1.0,
      }),
      allowSolarExport: false,
    });
    const result = runGenerationAwareSimulation(params);

    expect(result.totalSolarExportKwh).toBe(0);
    expect(result.gridFlows.totalCurtailedSolarKwh).toBeGreaterThan(0);
    expect(result.tariffCosts.solarExportCredit).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 6. low-price grid charge -> later G3O battery export -> G3P tariff credit
  // --------------------------------------------------------------------------
  it('6. low-price grid charge -> later G3O battery export -> G3P tariff credit', () => {
    // 2-hour night scenario without solar:
    // Hour 0: off-peak, buyRate = $0.10, sellRate = $0.05. Battery charges from grid.
    // Hour 1: on-peak, buyRate = $0.60, sellRate = $0.50. Battery exports to grid (arbitrage).
    const tiers: RateTier[] = [
      {
        id: 'off-peak',
        name: 'Off-Peak',
        buyRate: 0.10,
        sellRate: 0.05,
        color: '#10B981',
        isChargeWindow: true,
      },
      {
        id: 'on-peak',
        name: 'On-Peak',
        buyRate: 0.60,
        sellRate: 0.50,
        color: '#EF4444',
        isDischargeWindow: true,
      },
    ];

    // Data points at night: 01:00 and 02:00 (no solar)
    const dataPoints: IntervalDataPoint[] = [
      {
        timestamp: '2025-06-15 01:00',
        date: new Date('2025-06-15T08:00:00Z'),
        hour: 1,
        dayOfWeek: 0,
        month: 5,
        usageKwh: 0,
      },
      {
        timestamp: '2025-06-15 02:00',
        date: new Date('2025-06-15T09:00:00Z'),
        hour: 2,
        dayOfWeek: 0,
        month: 5,
        usageKwh: 0,
      },
    ];

    // Schedule matrix: hour 1 is off-peak (charge), hour 2 is on-peak (discharge)
    const scheduleMatrix = Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, (_, h) => (h === 2 ? 'on-peak' : 'off-peak'))
    );

    const battery = createTestBattery({
      totalCapacityKwh: 10,
      maxContinuousChargeKw: 5,
      maxContinuousOutputKw: 5,
      roundTripEfficiencyPercent: 100,
      strategy: 'arbitrage',
      chargeTiers: ['off-peak'],
      dischargeTiers: ['on-peak'],
      allowGridExport: true,
    });

    const params: GenerationAwareSimulationParams = {
      dataPoints,
      intervalHours: 1.0,
      generationConfig: {
        site: baseSite,
        assets: [createClearSkyAsset()],
      },
      tiers,
      scheduleMatrix,
      batteryProfile: battery,
      allowSolarExport: true,
      initialBatteryState: { ...zeroBatteryState },
      initialCostBasisState: { ...zeroCostBasisState },
    };

    const result = runGenerationAwareSimulation(params);

    // Interval 0: grid charges battery
    const inv0 = result.exportAwareBatteryFlow.intervals[0];
    expect(inv0.preExportFlow.gridToBatteryAcKwh).toBe(5.0);
    expect(inv0.costBasisStateAfterExport.gridStoredEnergyKwh).toBe(5.0);
    expect(inv0.costBasisStateAfterExport.totalAcquisitionCostUsd).toBeCloseTo(
      0.50, // 5 kWh * $0.10
      6
    );

    // Interval 1: grid export triggers at sellRate = $0.50 (cost basis was $0.10)
    const inv1 = result.exportAwareBatteryFlow.intervals[1];
    expect(inv1.exportResult.batteryExportAcKwh).toBe(5.0);
    expect(inv1.exportResult.exportRevenueUsd).toBeCloseTo(2.50, 6); // 5 kWh * $0.50

    // Grid flow and tariff accounting reflection
    expect(result.gridFlows.intervals[1].batteryExportKwh).toBe(5.0);
    expect(result.tariffCosts.intervals[1].batteryExportCredit).toBeCloseTo(
      2.50,
      6
    );
    expect(result.totalBatteryExportKwh).toBe(5.0);
    expect(result.tariffCosts.batteryExportCredit).toBeCloseTo(2.50, 6);
  });

  // --------------------------------------------------------------------------
  // 7. seasonal TOU rates flow unchanged through resolver/dispatch/accounting
  // --------------------------------------------------------------------------
  it('7. seasonal TOU rates flow unchanged through resolver/dispatch/accounting', () => {
    const seasons: TouSeason[] = [
      {
        id: 'summer',
        name: 'Summer Season',
        months: [5, 6, 7], // June, July, August
        tierRates: {
          'off-peak': { buyRate: 0.22, sellRate: 0.12 },
          'on-peak': { buyRate: 0.65, sellRate: 0.50 },
        },
      },
    ];

    const params = buildSimulationParams({
      seasons,
    });
    const result = runGenerationAwareSimulation(params);

    // All intervals are in June (month 5) -> summer rates apply
    for (let i = 0; i < 24; i++) {
      const resolved = result.resolvedRates[i];
      const tariff = result.tariffCosts.intervals[i];
      const exportFlow = result.exportAwareBatteryFlow.intervals[i];

      expect(resolved.seasonName).toBe('Summer Season');
      if (resolved.tierId === 'off-peak') {
        expect(resolved.buyRate).toBe(0.22);
        expect(resolved.sellRate).toBe(0.12);
      } else {
        expect(resolved.buyRate).toBe(0.65);
        expect(resolved.sellRate).toBe(0.50);
      }

      // Exact match in exportFlow and tariff
      expect(exportFlow.buyRate).toBe(resolved.buyRate);
      expect(exportFlow.sellRate).toBe(resolved.sellRate);
      expect(tariff.buyRate).toBe(resolved.buyRate);
      expect(tariff.sellRate).toBe(resolved.sellRate);
      expect(tariff.seasonName).toBe('Summer Season');
    }
  });

  // --------------------------------------------------------------------------
  // 8. negative tariff rate survives end-to-end
  // --------------------------------------------------------------------------
  it('8. negative tariff rate survives end-to-end', () => {
    const negativeTiers: RateTier[] = [
      {
        id: 'off-peak',
        name: 'Off-Peak Negative',
        buyRate: -0.05,
        sellRate: -0.02,
        color: '#10B981',
      },
      {
        id: 'on-peak',
        name: 'On-Peak',
        buyRate: 0.30,
        sellRate: 0.20,
        color: '#EF4444',
      },
    ];

    const params = buildSimulationParams({
      tiers: negativeTiers,
      dataPoints: createDataPoints(24, 2.0),
    });
    const result = runGenerationAwareSimulation(params);

    const offPeakIdx = 0; // Hour 0 is off-peak
    const resolved = result.resolvedRates[offPeakIdx];
    const tariff = result.tariffCosts.intervals[offPeakIdx];

    expect(resolved.buyRate).toBe(-0.05);
    expect(resolved.sellRate).toBe(-0.02);
    expect(tariff.buyRate).toBe(-0.05);
    expect(tariff.baselineCost).toBeCloseTo(2.0 * -0.05, 6);
  });

  // --------------------------------------------------------------------------
  // 9. multiple enabled solar arrays aggregate before dispatch
  // --------------------------------------------------------------------------
  it('9. multiple enabled solar arrays aggregate before dispatch', () => {
    const array1 = createClearSkyAsset('array-1', {
      dcCapacityKw: 4.0,
      inverterAcCapacityKw: 4.0,
    });
    const array2 = createClearSkyAsset('array-2', {
      dcCapacityKw: 6.0,
      inverterAcCapacityKw: 6.0,
    });

    // Run combined
    const combinedParams = buildSimulationParams({
      generationConfig: {
        site: baseSite,
        assets: [array1, array2],
      },
    });
    const combinedResult = runGenerationAwareSimulation(combinedParams);

    // Run single 1
    const single1Result = runGenerationAwareSimulation(
      buildSimulationParams({
        generationConfig: {
          site: baseSite,
          assets: [array1],
        },
      })
    );

    // Run single 2
    const single2Result = runGenerationAwareSimulation(
      buildSimulationParams({
        generationConfig: {
          site: baseSite,
          assets: [array2],
        },
      })
    );

    // Fleet aggregation must exactly equal sum of array 1 + array 2
    for (let i = 0; i < 24; i++) {
      const combinedAc = combinedResult.solarFleetProfile[i].totalAcEnergyKwh;
      const expectedAc =
        single1Result.solarFleetProfile[i].totalAcEnergyKwh +
        single2Result.solarFleetProfile[i].totalAcEnergyKwh;
      expect(combinedAc).toBeCloseTo(expectedAc, 6);
    }
  });

  // --------------------------------------------------------------------------
  // 10. disabled solar asset contributes zero
  // --------------------------------------------------------------------------
  it('10. disabled solar asset contributes zero', () => {
    const enabledArray = createClearSkyAsset('array-1', {
      enabled: true,
      dcCapacityKw: 4.0,
      inverterAcCapacityKw: 4.0,
    });
    const disabledArray = createClearSkyAsset('array-2', {
      enabled: false,
      dcCapacityKw: 10.0,
      inverterAcCapacityKw: 10.0,
    });

    const resultWithDisabled = runGenerationAwareSimulation(
      buildSimulationParams({
        generationConfig: {
          site: baseSite,
          assets: [enabledArray, disabledArray],
        },
      })
    );

    const resultOnlyEnabled = runGenerationAwareSimulation(
      buildSimulationParams({
        generationConfig: {
          site: baseSite,
          assets: [enabledArray],
        },
      })
    );

    expect(resultWithDisabled.totalSolarGenerationKwh).toBeCloseTo(
      resultOnlyEnabled.totalSolarGenerationKwh,
      6
    );

    // All disabled solar array contributes zero
    const allDisabledResult = runGenerationAwareSimulation(
      buildSimulationParams({
        generationConfig: {
          site: baseSite,
          assets: [disabledArray],
        },
      })
    );
    expect(allDisabledResult.totalSolarGenerationKwh).toBe(0);
  });

  // --------------------------------------------------------------------------
  // 11. enabled wind asset rejects as unsupported
  // --------------------------------------------------------------------------
  it('11. enabled wind asset rejects as unsupported', () => {
    const windAsset: WindGenerationAsset = {
      ...DEFAULT_WIND_ASSET,
      id: 'wind-1',
      enabled: true,
    };

    expect(() =>
      runGenerationAwareSimulation(
        buildSimulationParams({
          generationConfig: {
            site: baseSite,
            assets: [windAsset],
          },
        })
      )
    ).toThrow(/unsupported.*wind/i);
  });

  // --------------------------------------------------------------------------
  // 12. enabled generator rejects as unsupported
  // --------------------------------------------------------------------------
  it('12. enabled generator rejects as unsupported', () => {
    const generatorAsset: GeneratorGenerationAsset = {
      ...DEFAULT_GENERATOR_ASSET,
      id: 'gen-1',
      enabled: true,
    };

    expect(() =>
      runGenerationAwareSimulation(
        buildSimulationParams({
          generationConfig: {
            site: baseSite,
            assets: [generatorAsset],
          },
        })
      )
    ).toThrow(/unsupported.*generator/i);
  });

  // --------------------------------------------------------------------------
  // 13. disabled wind/generator do not block solar pipeline
  // --------------------------------------------------------------------------
  it('13. disabled wind/generator do not block solar pipeline', () => {
    const windAsset: WindGenerationAsset = {
      ...DEFAULT_WIND_ASSET,
      id: 'wind-1',
      enabled: false,
    };
    const generatorAsset: GeneratorGenerationAsset = {
      ...DEFAULT_GENERATOR_ASSET,
      id: 'gen-1',
      enabled: false,
    };
    const solarAsset = createClearSkyAsset();

    const result = runGenerationAwareSimulation(
      buildSimulationParams({
        generationConfig: {
          site: baseSite,
          assets: [solarAsset, windAsset, generatorAsset],
        },
      })
    );

    expect(result.alignedTimestamps).toHaveLength(24);
    expect(result.totalSolarGenerationKwh).toBeGreaterThan(0);
  });

  // --------------------------------------------------------------------------
  // 14. initial grid SOC/cost-basis mismatch rejects
  // --------------------------------------------------------------------------
  it('14. initial grid SOC/cost-basis mismatch rejects', () => {
    expect(() =>
      runGenerationAwareSimulation(
        buildSimulationParams({
          initialBatteryState: {
            ...zeroBatteryState,
            gridChargedSocKwh: 3.0,
          },
          initialCostBasisState: {
            gridStoredEnergyKwh: 1.0,
            totalAcquisitionCostUsd: 0.20,
          },
        })
      )
    ).toThrow(/Initial state mismatch/i);
  });

  // --------------------------------------------------------------------------
  // 15. stage interval/timestamp alignment remains exact
  // --------------------------------------------------------------------------
  it('15. stage interval/timestamp alignment remains exact', () => {
    const params = buildSimulationParams();
    const result = runGenerationAwareSimulation(params);

    for (let i = 0; i < 24; i++) {
      const tsUtc = result.alignedTimestamps[i].timestampUtc;
      expect(result.solarFleetProfile[i].timestampUtc).toBe(tsUtc);
      expect(result.solarLoadFlow[i].timestampUtc).toBe(tsUtc);
      expect(result.dispatchPolicy[i].timestampUtc).toBe(tsUtc);
      expect(result.resolvedRates[i].timestampUtc).toBe(tsUtc);
      expect(result.exportAwareBatteryFlow.intervals[i].timestampUtc).toBe(
        tsUtc
      );
      expect(result.gridFlows.intervals[i].timestampUtc).toBe(tsUtc);
      expect(result.tariffCosts.intervals[i].timestampUtc).toBe(tsUtc);

      expect(result.solarLoadFlow[i].sourceIndex).toBe(i);
      expect(result.dispatchPolicy[i].sourceIndex).toBe(i);
      expect(result.resolvedRates[i].sourceIndex).toBe(i);
      expect(result.exportAwareBatteryFlow.intervals[i].sourceIndex).toBe(i);
      expect(result.gridFlows.intervals[i].sourceIndex).toBe(i);
      expect(result.tariffCosts.intervals[i].sourceIndex).toBe(i);
    }
  });

  // --------------------------------------------------------------------------
  // 16. aggregate convenience totals equal authoritative stage totals
  // --------------------------------------------------------------------------
  it('16. aggregate convenience totals equal authoritative stage totals', () => {
    const params = buildSimulationParams();
    const result = runGenerationAwareSimulation(params);

    const solarSummary = summarizeSolarLoadFlow(result.solarLoadFlow);

    expect(result.totalHomeLoadKwh).toBe(solarSummary.totalHomeLoadKwh);
    expect(result.totalSolarGenerationKwh).toBe(
      solarSummary.totalSolarGenerationKwh
    );
    expect(result.totalSolarDirectToLoadKwh).toBe(
      solarSummary.totalSolarDirectToLoadKwh
    );

    expect(result.totalGridImportKwh).toBe(result.gridFlows.totalGridImportKwh);
    expect(result.totalSolarExportKwh).toBe(result.gridFlows.totalSolarExportKwh);
    expect(result.totalBatteryExportKwh).toBe(
      result.gridFlows.totalBatteryExportKwh
    );
    expect(result.totalGridExportKwh).toBe(result.gridFlows.totalGridExportKwh);

    expect(result.baselineCost).toBe(result.tariffCosts.baselineCost);
    expect(result.simulatedCost).toBe(result.tariffCosts.simulatedCost);
    expect(result.netSavings).toBe(result.tariffCosts.netSavings);
  });

  // --------------------------------------------------------------------------
  // 17. input immutability
  // --------------------------------------------------------------------------
  it('17. input immutability', () => {
    const solarAsset = createClearSkyAsset();
    const generationConfig: GenerationConfig = {
      site: baseSite,
      assets: [solarAsset],
    };
    const dataPoints = createDataPoints(24, 1.0);
    const tiers = defaultTiers;
    const scheduleMatrix = createScheduleMatrix();
    const batteryProfile = createTestBattery();
    const initialBatteryState = { ...zeroBatteryState };
    const initialCostBasisState = { ...zeroCostBasisState };

    // Deep freeze inputs
    Object.freeze(baseSite);
    Object.freeze(solarAsset);
    Object.freeze(generationConfig);
    Object.freeze(generationConfig.assets);
    dataPoints.forEach((dp) => Object.freeze(dp));
    Object.freeze(dataPoints);
    tiers.forEach((t) => Object.freeze(t));
    Object.freeze(tiers);
    scheduleMatrix.forEach((row) => Object.freeze(row));
    Object.freeze(scheduleMatrix);
    Object.freeze(batteryProfile);
    Object.freeze(batteryProfile.chargeTiers);
    Object.freeze(batteryProfile.dischargeTiers);
    Object.freeze(initialBatteryState);
    Object.freeze(initialCostBasisState);

    const params: GenerationAwareSimulationParams = {
      dataPoints,
      intervalHours: 1.0,
      generationConfig,
      tiers,
      scheduleMatrix,
      batteryProfile,
      allowSolarExport: true,
      initialBatteryState,
      initialCostBasisState,
    };
    Object.freeze(params);

    // Must execute cleanly without trying to mutate any frozen input
    expect(() => runGenerationAwareSimulation(params)).not.toThrow();
  });

  // --------------------------------------------------------------------------
  // Additional validations
  // --------------------------------------------------------------------------
  it('validates generationConfig, site, timeZone, and allowSolarExport presence', () => {
    const validParams = buildSimulationParams();

    expect(() =>
      runGenerationAwareSimulation(null as unknown as GenerationAwareSimulationParams)
    ).toThrow(/Simulation parameters must be provided as an object/i);

    expect(() =>
      runGenerationAwareSimulation({
        ...validParams,
        generationConfig: null as unknown as GenerationConfig,
      })
    ).toThrow(/generationConfig must be a valid object/i);

    expect(() =>
      runGenerationAwareSimulation({
        ...validParams,
        generationConfig: {
          ...validParams.generationConfig,
          site: null as unknown as GenerationSite,
        },
      })
    ).toThrow(/generationConfig.site must be a valid object/i);

    expect(() =>
      runGenerationAwareSimulation({
        ...validParams,
        generationConfig: {
          ...validParams.generationConfig,
          site: {
            ...validParams.generationConfig.site,
            timeZone: 'Invalid/Zone_Foo_Bar',
          },
        },
      })
    ).toThrow(/Invalid site timeZone/i);

    expect(() =>
      runGenerationAwareSimulation({
        ...validParams,
        allowSolarExport: 'yes' as unknown as boolean,
      })
    ).toThrow(/allowSolarExport must be a boolean/i);
  });
});
