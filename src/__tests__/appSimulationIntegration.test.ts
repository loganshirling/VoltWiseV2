import { describe, it, expect } from 'vitest';
import {
  runUnifiedSimulation,
  UnifiedSimulationResult,
} from '../utils/simulationRouter';
import {
  runAnnualSimulation,
  calculate15YearFinancials,
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_RATE_TIERS,
  DEFAULT_TOU_PROFILES,
} from '../utils/simulationEngine';
import {
  createDefaultGenerationConfig,
  createDefaultAsset,
} from '../utils/generationDefaults';
import {
  deriveAnalysisState,
  shouldCalculateLegacyFinancials,
  aggregateGenerationProjectCosts,
  calculateGenerationAwareFinancials,
} from '../utils/generationFinancials';
import {
  calculateGenerationOperationalProjection,
} from '../utils/generationProjection';
import {
  deriveGenerationOperationalDisplayMetrics,
} from '../utils/generationResults';
import {
  BatteryProfile,
  GenerationConfig,
  GenerationSite,
  IntervalDataPoint,
  RateTier,
  SolarGenerationAsset,
  WindGenerationAsset,
  WindPowerCurvePoint,
} from '../types/energy';

describe('G3S — Application Integration & Final G3 Gate', () => {
  const validSite: GenerationSite = {
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
      buyRate: 0.55,
      sellRate: 0.40,
      color: '#EF4444',
      isChargeWindow: false,
      isDischargeWindow: true,
    },
  ];

  function createScheduleMatrix(): string[][] {
    return Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, (_, h) =>
        h >= 16 && h < 21 ? 'on-peak' : 'off-peak'
      )
    );
  }

  function createBattery(overrides: Partial<BatteryProfile> = {}): BatteryProfile {
    return {
      id: 'test-battery',
      name: 'Test Battery',
      model: 'VoltCell-13.5',
      totalCapacityKwh: 13.5,
      usableDodPercent: 100,
      maxContinuousChargeKw: 5,
      maxContinuousOutputKw: 5,
      roundTripEfficiencyPercent: 90,
      ratedCycleLife: 4000,
      installedCost: 10000,
      strategy: 'arbitrage',
      chargeTiers: ['off-peak'],
      dischargeTiers: ['on-peak'],
      allowGridExport: false,
      ...overrides,
    };
  }

  function createDataPoints(count = 48): IntervalDataPoint[] {
    const start = new Date('2025-06-01T00:00:00Z');
    return Array.from({ length: count }, (_, i) => {
      const d = new Date(start.getTime() + i * 3600 * 1000);
      return {
        timestamp: d.toISOString().replace('T', ' ').slice(0, 16),
        date: d,
        hour: d.getUTCHours(),
        dayOfWeek: d.getUTCDay(),
        month: d.getUTCMonth(),
        usageKwh: 1.5,
      };
    });
  }

  function createSolarAsset(overrides: Partial<SolarGenerationAsset> = {}): SolarGenerationAsset {
    const asset = createDefaultAsset('solar', 'solar-test-1') as SolarGenerationAsset;
    return {
      ...asset,
      enabled: true,
      dcCapacityKw: 8,
      inverterAcCapacityKw: 7.6,
      inverterEfficiencyPercent: 96,
      tiltDegrees: 25,
      azimuthDegrees: 180,
      resourceMode: 'monthly_peak_sun_hours',
      monthlyPeakSunHoursPerDay: [5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5],
      ...overrides,
    };
  }

  // 1. default empty generation configuration uses legacy mode
  it('1. default empty generation configuration uses legacy mode', () => {
    const dataPoints = createDataPoints(24);
    const scheduleMatrix = createScheduleMatrix();
    const battery = createBattery();
    const defaultConfig = createDefaultGenerationConfig();

    const result = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: defaultConfig,
      allowSolarExport: false,
    });

    expect(result.mode).toBe('legacy');
    expect(result.generationAwareResult).toBeUndefined();
    expect(result.annualSummary).toBeDefined();
    expect(result.annualSummary.profileId).toBe(battery.id);
  });

  // 2. default/no-generation AnnualSimulationSummary remains unchanged
  it('2. default/no-generation AnnualSimulationSummary remains unchanged (exact parity)', () => {
    const dataPoints = createDataPoints(72);
    const scheduleMatrix = createScheduleMatrix();
    const battery = createBattery();
    const defaultConfig = createDefaultGenerationConfig();

    const legacyDirect = runAnnualSimulation(
      dataPoints,
      1,
      defaultTiers,
      scheduleMatrix,
      battery
    );

    const unifiedResult = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: defaultConfig,
      allowSolarExport: false,
    });

    expect(unifiedResult.annualSummary).toStrictEqual(legacyDirect);
  });

  // 3. enabling configured solar selects generation-aware mode
  it('3. enabling configured solar selects generation-aware mode', () => {
    const dataPoints = createDataPoints(24);
    const scheduleMatrix = createScheduleMatrix();
    const battery = createBattery();
    const solar = createSolarAsset();
    const configWithSolar: GenerationConfig = {
      site: validSite,
      assets: [solar],
    };

    const result = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: configWithSolar,
      allowSolarExport: false,
    });

    expect(result.mode).toBe('generation-aware');
    expect(result.generationAwareResult).toBeDefined();
    expect(result.annualSummary).toBeDefined();
    expect(result.generationAwareResult?.solarLoadFlow).toHaveLength(24);
  });

  // 4. generationConfig changes affect application simulation inputs
  it('4. generationConfig changes affect application simulation inputs', () => {
    const dataPoints = createDataPoints(48);
    const scheduleMatrix = createScheduleMatrix();
    const battery = createBattery();

    const solarSmall = createSolarAsset({ dcCapacityKw: 3, inverterAcCapacityKw: 3 });
    const solarLarge = createSolarAsset({ dcCapacityKw: 12, inverterAcCapacityKw: 12 });

    const resultSmall = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: { site: validSite, assets: [solarSmall] },
      allowSolarExport: false,
    });

    const resultLarge = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: { site: validSite, assets: [solarLarge] },
      allowSolarExport: false,
    });

    // Higher solar capacity leads to lower or equal simulated cost and grid import
    expect(resultLarge.annualSummary.simulatedAnnualCost).toBeLessThan(
      resultSmall.annualSummary.simulatedAnnualCost
    );
    expect(resultLarge.annualSummary.annualGridImportKwh).toBeLessThan(
      resultSmall.annualSummary.annualGridImportKwh
    );
  });

  // 5. allowSolarExport=false curtails surplus solar
  it('5. allowSolarExport=false curtails surplus solar', () => {
    // Generate noon hours with high solar and small home load
    const dataPoints = createDataPoints(24);
    const scheduleMatrix = createScheduleMatrix();
    // Battery that doesn't export to grid
    const battery = createBattery({ allowGridExport: false, totalCapacityKwh: 2 });
    const largeSolar = createSolarAsset({
      dcCapacityKw: 25,
      inverterAcCapacityKw: 25,
      monthlyPeakSunHoursPerDay: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
    });

    const resultNoExport = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: { site: validSite, assets: [largeSolar] },
      allowSolarExport: false,
    });

    // With allowSolarExport = false and battery.allowGridExport = false, surplus solar is curtailed
    expect(resultNoExport.annualSummary.annualGridExportKwh).toBe(0);
    const g3q = resultNoExport.generationAwareResult!;
    expect(g3q.gridFlows.totalSolarExportKwh).toBe(0);
    expect(g3q.gridFlows.totalCurtailedSolarKwh).toBeGreaterThan(0);
    for (const iv of g3q.gridFlows.intervals) {
      expect(iv.solarExportKwh).toBe(0);
    }
  });

  // 6. allowSolarExport=true permits surplus solar export
  it('6. allowSolarExport=true permits surplus solar export', () => {
    const dataPoints = createDataPoints(24);
    const scheduleMatrix = createScheduleMatrix();
    const battery = createBattery({ allowGridExport: false, totalCapacityKwh: 2 });
    const largeSolar = createSolarAsset({
      dcCapacityKw: 25,
      inverterAcCapacityKw: 25,
      monthlyPeakSunHoursPerDay: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
    });

    const resultWithExport = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: { site: validSite, assets: [largeSolar] },
      allowSolarExport: true,
    });

    expect(resultWithExport.annualSummary.annualGridExportKwh).toBeGreaterThan(0);
    const g3q = resultWithExport.generationAwareResult!;
    expect(g3q.gridFlows.totalSolarExportKwh).toBeGreaterThan(0);
    expect(g3q.gridFlows.totalCurtailedSolarKwh).toBe(0);
  });

  // 7. battery allowGridExport does not control solar export
  it('7. battery allowGridExport does not control solar export (independent permissions)', () => {
    const dataPoints = createDataPoints(24);
    const scheduleMatrix = createScheduleMatrix();
    const largeSolar = createSolarAsset({
      dcCapacityKw: 20,
      inverterAcCapacityKw: 20,
      monthlyPeakSunHoursPerDay: [7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7, 7],
    });

    // Case A: battery allowGridExport=true, but allowSolarExport=false
    // Battery can export, but solar CANNOT export
    const batteryWithExport = createBattery({ allowGridExport: true });
    const resA = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: batteryWithExport,
      generationConfig: { site: validSite, assets: [largeSolar] },
      allowSolarExport: false,
    });

    const g3qA = resA.generationAwareResult!;
    expect(g3qA.gridFlows.totalSolarExportKwh).toBe(0);
    expect(g3qA.gridFlows.totalCurtailedSolarKwh).toBeGreaterThan(0);

    // Case B: battery allowGridExport=false, but allowSolarExport=true
    // Solar CAN export, even though battery cannot
    const batteryWithoutExport = createBattery({ allowGridExport: false });
    const resB = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: batteryWithoutExport,
      generationConfig: { site: validSite, assets: [largeSolar] },
      allowSolarExport: true,
    });

    const g3qB = resB.generationAwareResult!;
    expect(g3qB.gridFlows.totalSolarExportKwh).toBeGreaterThan(0);
    expect(g3qB.gridFlows.totalBatteryExportKwh).toBe(0);
  });

  // 8. invalid enabled-generation configuration produces a handled error rather than legacy fallback
  it('8. invalid enabled-generation configuration produces a handled error rather than legacy fallback', () => {
    const dataPoints = createDataPoints(24);
    const scheduleMatrix = createScheduleMatrix();
    const battery = createBattery();
    const enabledSolar = createSolarAsset();

    // Incomplete site: missing timeZone
    const invalidConfig: GenerationConfig = {
      site: {
        latitude: 37.77,
        longitude: -122.42,
        timeZone: '', // Missing timeZone
        elevationM: 0,
      },
      assets: [enabledSolar],
    };

    // runUnifiedSimulation must NOT fall back to legacy mode; it must throw an informative exception
    expect(() =>
      runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix,
        batteryProfile: battery,
        generationConfig: invalidConfig,
        allowSolarExport: false,
      })
    ).toThrow();

    // Verify application-level error handling contract (safe batch wrapper)
    function simulateAppMemo(config: GenerationConfig) {
      try {
        const results: Record<string, UnifiedSimulationResult> = {};
        for (const p of [battery]) {
          results[p.id] = runUnifiedSimulation({
            dataPoints,
            intervalHours: 1,
            tiers: defaultTiers,
            scheduleMatrix,
            batteryProfile: p,
            generationConfig: config,
            allowSolarExport: false,
          });
        }
        return { results, simulationError: null };
      } catch (err: any) {
        return { results: {}, simulationError: err?.message || 'Error' };
      }
    }

    const appState = simulateAppMemo(invalidConfig);
    expect(appState.simulationError).toBeTruthy();
    expect(typeof appState.simulationError).toBe('string');
    expect(Object.keys(appState.results)).toHaveLength(0);
  });

  // 9. reset/default behavior restores allowSolarExport=false
  it('9. reset/default behavior restores allowSolarExport=false and default generation config', () => {
    // Model App state and reset handler
    let allowSolarExport = true;
    let generationConfig: GenerationConfig = {
      site: validSite,
      assets: [createSolarAsset()],
    };

    function handleReset() {
      allowSolarExport = false;
      generationConfig = createDefaultGenerationConfig();
    }

    handleReset();

    expect(allowSolarExport).toBe(false);
    expect(generationConfig.assets).toHaveLength(0);

    // Default configuration runs cleanly in legacy mode
    const res = runUnifiedSimulation({
      dataPoints: createDataPoints(24),
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix: createScheduleMatrix(),
      batteryProfile: createBattery(),
      generationConfig,
      allowSolarExport,
    });

    expect(res.mode).toBe('legacy');
  });

  // 10. G4A routing contract: generation-aware mode adapts AnnualSimulationSummary contract but routes to pending lifecycle state
  it('10. G4A routing contract: generation-aware mode adapts AnnualSimulationSummary contract but routes to pending lifecycle state', () => {
    const dataPoints = createDataPoints(48);
    const scheduleMatrix = createScheduleMatrix();
    const battery = DEFAULT_BATTERY_PROFILES[0];
    const solar = createSolarAsset();
    const configWithSolar: GenerationConfig = {
      site: validSite,
      assets: [solar],
    };

    const unifiedResult = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: DEFAULT_RATE_TIERS,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: configWithSolar,
      allowSolarExport: true,
    });

    expect(unifiedResult.mode).toBe('generation-aware');
    const annualSummary = unifiedResult.annualSummary;

    // Structural compatibility of adapted AnnualSimulationSummary
    expect(annualSummary).toBeDefined();
    expect(annualSummary.profileId).toBe(battery.id);
    expect(typeof annualSummary.year1Savings).toBe('number');
    expect(typeof annualSummary.baselineAnnualCost).toBe('number');
    expect(typeof annualSummary.simulatedAnnualCost).toBe('number');
    expect(annualSummary.intervalResults).toHaveLength(48);

    // G4A Production Safety Gate: generation-aware mode is NOT eligible for calculate15YearFinancials
    const isEligibleForLegacyEngine = shouldCalculateLegacyFinancials(true, unifiedResult.mode);
    expect(isEligibleForLegacyEngine).toBe(false);

    // G4A Explicit State: full-year generation routes to generation-financial-pending
    const analysisState = deriveAnalysisState(true, unifiedResult.mode);
    expect(analysisState).toBe('generation-financial-pending');

    // In contrast, legacy (no-generation) mode remains eligible for calculate15YearFinancials
    const legacyResult = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: DEFAULT_RATE_TIERS,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: createDefaultGenerationConfig(),
      allowSolarExport: false,
    });
    expect(legacyResult.mode).toBe('legacy');
    expect(shouldCalculateLegacyFinancials(true, legacyResult.mode)).toBe(true);
    expect(deriveAnalysisState(true, legacyResult.mode)).toBe('legacy-financial');

    const legacyFinancials = calculate15YearFinancials(
      battery,
      legacyResult.annualSummary,
      DEFAULT_MACRO_FINANCIALS
    );
    expect(legacyFinancials).toBeDefined();
    expect(legacyFinancials.year1Savings).toBe(Math.round(legacyResult.annualSummary.year1Savings));
  });

  function createWindAsset(overrides: Partial<WindGenerationAsset> = {}): WindGenerationAsset {
    const defaultCurve: WindPowerCurvePoint[] = [
      { windSpeedMps: 0.0, outputKw: 0.0 },
      { windSpeedMps: 3.0, outputKw: 0.0 },
      { windSpeedMps: 6.0, outputKw: 2.0 },
      { windSpeedMps: 9.0, outputKw: 6.5 },
      { windSpeedMps: 12.0, outputKw: 10.0 },
      { windSpeedMps: 25.0, outputKw: 10.0 },
    ];

    return {
      id: 'wind-test-1',
      name: 'Residential 10kW Turbine',
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
      availabilityPercent: 95.0,
      systemLossPercent: 5.0,
      powerCurve: defaultCurve,
      resourceMode: 'annual_average',
      annualAverageWindSpeedMps: 6.5,
      monthlyAverageWindSpeedMps: [
        5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 7.5, 7.0, 6.5, 5.5, 5.0,
      ],
      ...overrides,
    };
  }

  // 11. G5E: Wind-only generation-aware state is treated as generation-aware Results
  it('11. wind-only generation-aware state is treated as generation-aware Results', () => {
    const dataPoints = createDataPoints(48);
    const scheduleMatrix = createScheduleMatrix();
    const battery = createBattery();
    const wind = createWindAsset();
    const configWithWind: GenerationConfig = {
      site: validSite,
      assets: [wind],
    };

    const unifiedResult = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: configWithWind,
      allowSolarExport: true,
    });

    expect(unifiedResult.mode).toBe('generation-aware');
    expect(unifiedResult.generationAwareResult).toBeDefined();

    const displayMetrics = deriveGenerationOperationalDisplayMetrics(unifiedResult.generationAwareResult!);
    expect(displayMetrics.windGeneratedKwh).toBeGreaterThan(0);
    expect(displayMetrics.solarGeneratedKwh).toBe(0);
    expect(displayMetrics.renewableGeneratedKwh).toBe(displayMetrics.windGeneratedKwh);
    expect(displayMetrics.renewableDirectToLoadKwh).toBe(displayMetrics.windDirectToLoadKwh);
    expect(displayMetrics.renewableExportKwh).toBe(displayMetrics.windExportKwh);
  });

  // 12. G5E: Mixed solar+wind generation-aware state reaches Results
  it('12. mixed solar+wind generation-aware state reaches Results', () => {
    const dataPoints = createDataPoints(48);
    const scheduleMatrix = createScheduleMatrix();
    const battery = createBattery();
    const solar = createSolarAsset();
    const wind = createWindAsset();
    const configMixed: GenerationConfig = {
      site: validSite,
      assets: [solar, wind],
    };

    const unifiedResult = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: configMixed,
      allowSolarExport: true,
    });

    expect(unifiedResult.mode).toBe('generation-aware');
    expect(unifiedResult.generationAwareResult).toBeDefined();

    const displayMetrics = deriveGenerationOperationalDisplayMetrics(unifiedResult.generationAwareResult!);
    expect(displayMetrics.solarGeneratedKwh).toBeGreaterThan(0);
    expect(displayMetrics.windGeneratedKwh).toBeGreaterThan(0);
    expect(displayMetrics.renewableGeneratedKwh).toBeCloseTo(
      displayMetrics.solarGeneratedKwh + displayMetrics.windGeneratedKwh,
      5
    );
    expect(displayMetrics.renewableDirectToLoadKwh).toBeCloseTo(
      displayMetrics.solarDirectToLoadKwh + displayMetrics.windDirectToLoadKwh,
      5
    );
  });

  // 13. G5E: Solar-only Results path remains intact
  it('13. solar-only Results path remains intact', () => {
    const dataPoints = createDataPoints(48);
    const scheduleMatrix = createScheduleMatrix();
    const battery = createBattery();
    const solar = createSolarAsset();
    const configSolar: GenerationConfig = {
      site: validSite,
      assets: [solar],
    };

    const unifiedResult = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: configSolar,
      allowSolarExport: true,
    });

    expect(unifiedResult.mode).toBe('generation-aware');
    const displayMetrics = deriveGenerationOperationalDisplayMetrics(unifiedResult.generationAwareResult!);
    expect(displayMetrics.solarGeneratedKwh).toBeGreaterThan(0);
    expect(displayMetrics.windGeneratedKwh).toBe(0);
    expect(displayMetrics.solarDirectToLoadKwh).toBeGreaterThan(0);
  });

  // 14. G5E: Partial-period wind state does not create lifecycle finance
  it('14. partial-period wind state does not create lifecycle finance', () => {
    const dataPoints = createDataPoints(48); // Only 2 days
    const scheduleMatrix = createScheduleMatrix();
    const isSuitableForAnnual = false;
    const battery = createBattery();
    const wind = createWindAsset();
    const configWind: GenerationConfig = {
      site: validSite,
      assets: [wind],
    };

    const unifiedResult = runUnifiedSimulation({
      dataPoints,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix,
      batteryProfile: battery,
      generationConfig: configWind,
      allowSolarExport: true,
    });

    expect(unifiedResult.mode).toBe('generation-aware');
    const analysisState = deriveAnalysisState(isSuitableForAnnual, unifiedResult.mode, false);
    expect(analysisState).toBe('partial-period');

    // Lifecycle finance is suppressed for partial-period
    expect(analysisState).not.toBe('generation-financial');
    expect(analysisState).not.toBe('generation-financial-pending');
  });

  // 15. G5E: Full-year wind state consumes G5D generation financial analysis
  it('15. full-year wind state consumes G5D generation financial analysis', () => {
    // 365 days of UTC mock data
    const fullYearData = Array.from({ length: 365 * 24 }, (_, i) => {
      const d = new Date(Date.UTC(2025, 0, 1, i, 0, 0));
      return {
        timestamp: d.toISOString().replace('T', ' ').slice(0, 16),
        date: d,
        hour: d.getUTCHours(),
        dayOfWeek: d.getUTCDay(),
        month: d.getUTCMonth(),
        usageKwh: 1.5,
      };
    });

    const siteUtc: GenerationSite = {
      latitude: 37.7749,
      longitude: -122.4194,
      timeZone: 'UTC',
      elevationM: 16,
    };

    const battery = createBattery();
    const wind = createWindAsset({
      installedCostUsd: 15000,
      annualMaintenanceCostUsd: 200,
    });
    const configWind: GenerationConfig = {
      site: siteUtc,
      assets: [wind],
    };

    const projectCosts = aggregateGenerationProjectCosts(configWind);
    expect(projectCosts.generationCapexUsd).toBe(15000);

    const operationalProjection = calculateGenerationOperationalProjection({
      dataPoints: fullYearData,
      intervalHours: 1,
      tiers: defaultTiers,
      scheduleMatrix: createScheduleMatrix(),
      batteryProfile: battery,
      generationConfig: configWind,
      allowSolarExport: true,
      annualElectricityInflationRate: 0.03,
      annualBatteryDegradationRate: 0.02,
    });

    expect(operationalProjection.horizonYears).toBe(25);
    expect(operationalProjection.years[0].windGeneratedKwh).toBeGreaterThan(0);
    expect(operationalProjection.years[0].solarGeneratedKwh).toBe(0);

    const financials = calculateGenerationAwareFinancials({
      batteryProfile: battery,
      operationalProjection,
      projectCosts,
      financials: DEFAULT_MACRO_FINANCIALS,
    });

    expect(financials.grossProjectCapexUsd).toBe(battery.installedCost + 15000);
    expect(financials.projections).toHaveLength(25);
    expect(typeof financials.npvUsd).toBe('number');
    expect(typeof financials.lifetimeRoiPercent).toBe('number');
  }, 60000);

  // 16. G5E UX contracts: interval_file disabled, persisted state preserved, generator inactive
  it('16. configuration UX contracts protect interval_file and generator status', () => {
    // A persisted interval_file asset must not be silently converted
    const persistedIntervalAsset: WindGenerationAsset = {
      ...createWindAsset(),
      resourceMode: 'interval_file',
    };
    const configWithInterval: GenerationConfig = {
      site: validSite,
      assets: [persistedIntervalAsset],
    };

    // Configuration object is preserved intact without mutation
    expect((configWithInterval.assets[0] as WindGenerationAsset).resourceMode).toBe('interval_file');

    // Engine rejects interval_file if simulation is attempted
    expect(() => {
      runUnifiedSimulation({
        dataPoints: createDataPoints(24),
        intervalHours: 1,
        tiers: defaultTiers,
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: createBattery(),
        generationConfig: configWithInterval,
        allowSolarExport: false,
      });
    }).toThrow(/interval_file/i);
  });
});
