import { describe, it, expect } from 'vitest';
import {
  aggregateGenerationProjectCosts,
  calculateGenerationProjectCosts,
  calculateGenerationAwareFinancials,
  calculateGenerationFinancials,
  deriveAnalysisState,
  deriveGenerationHorizonFinancialSummary,
  deriveHorizonGenerationFinancialSummary,
  shouldCalculateLegacyFinancials,
} from '../utils/generationFinancials';
import {
  calculate15YearFinancials,
  calculateIRR,
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_RATE_TIERS,
  getHeaderPaybackText,
  getHeaderSavingsLabel,
} from '../utils/simulationEngine';
import { calculateOpportunityCostBenchmark } from '../utils/opportunityCost';
import { calculateGenerationOperationalProjection } from '../utils/generationProjection';
import { runUnifiedSimulation } from '../utils/simulationRouter';
import { createDefaultAsset, createDefaultGenerationConfig } from '../utils/generationDefaults';
import {
  BatteryProfile,
  DatasetCompleteness,
  GenerationConfig,
  GenerationFinancialAnalysis,
  GenerationOperationalProjection,
  GenerationOperationalProjectionResult,
  GenerationOperationalYear,
  GenerationProjectCostSummary,
  IntervalDataPoint,
  MacroFinancials,
  SolarGenerationAsset,
  WindGenerationAsset,
  GeneratorGenerationAsset,
} from '../types/energy';

describe('G4A — Financial Safety Gate & Generation Project Cost Contracts', () => {
  function makeSolar(
    id: string,
    enabled: boolean,
    installedCost: number,
    annualOm: number,
    overrides: Partial<SolarGenerationAsset> = {}
  ): SolarGenerationAsset {
    const base = createDefaultAsset('solar', id) as SolarGenerationAsset;
    return {
      ...base,
      enabled,
      installedCostUsd: installedCost,
      annualMaintenanceCostUsd: annualOm,
      dcCapacityKw: 8.5,
      inverterAcCapacityKw: 7.6,
      annualDegradationPercent: 0.5,
      ...overrides,
    };
  }

  function makeWind(
    id: string,
    enabled: boolean,
    installedCost: number,
    annualOm: number
  ): WindGenerationAsset {
    const base = createDefaultAsset('wind', id) as WindGenerationAsset;
    return {
      ...base,
      enabled,
      installedCostUsd: installedCost,
      annualMaintenanceCostUsd: annualOm,
    };
  }

  function makeGenerator(
    id: string,
    enabled: boolean,
    installedCost: number,
    annualOm: number
  ): GeneratorGenerationAsset {
    const base = createDefaultAsset('generator', id) as GeneratorGenerationAsset;
    return {
      ...base,
      enabled,
      installedCostUsd: installedCost,
      annualMaintenanceCostUsd: annualOm,
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

  function createScheduleMatrix(): string[][] {
    return Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, (_, h) =>
        h >= 16 && h < 21 ? 'on-peak' : 'off-peak'
      )
    );
  }

  // ==========================================================================
  // Group A: Project-Cost Aggregation
  // ==========================================================================
  describe('Project-Cost Aggregation', () => {
    it('1. One enabled solar asset contributes its CAPEX exactly once', () => {
      const solar = makeSolar('solar-1', true, 18500, 150);
      const summary = aggregateGenerationProjectCosts([solar]);

      expect(summary.generationCapexUsd).toBe(18500);
      expect(summary.byAsset).toHaveLength(1);
      expect(summary.byAsset[0].installedCostUsd).toBe(18500);
      expect(summary.byType.solar.installedCostUsd).toBe(18500);
    });

    it('2. Disabled solar contributes zero to CAPEX and O&M', () => {
      const disabledSolar = makeSolar('solar-disabled', false, 25000, 500);
      const summary = aggregateGenerationProjectCosts([disabledSolar]);

      expect(summary.generationCapexUsd).toBe(0);
      expect(summary.annualGenerationMaintenanceUsd).toBe(0);
      expect(summary.byAsset).toHaveLength(0);
      expect(summary.byType.solar.installedCostUsd).toBe(0);
      expect(summary.byType.solar.annualMaintenanceCostUsd).toBe(0);
      expect(summary.solarMetadata).toHaveLength(0);
    });

    it('3. Annual solar O&M aggregates correctly', () => {
      const solar = makeSolar('solar-om', true, 12000, 275.5);
      const summary = aggregateGenerationProjectCosts([solar]);

      expect(summary.annualGenerationMaintenanceUsd).toBe(275.5);
      expect(summary.byAsset[0].annualMaintenanceCostUsd).toBe(275.5);
      expect(summary.byType.solar.annualMaintenanceCostUsd).toBe(275.5);
    });

    it('4. Multiple enabled solar arrays aggregate deterministically', () => {
      const array1 = makeSolar('roof-array', true, 14000, 120, {
        dcCapacityKw: 6,
        inverterAcCapacityKw: 5.5,
        annualDegradationPercent: 0.5,
      });
      const array2 = makeSolar('ground-array', true, 22000, 230, {
        dcCapacityKw: 10,
        inverterAcCapacityKw: 9.6,
        annualDegradationPercent: 0.7,
      });

      const summary = aggregateGenerationProjectCosts([array1, array2]);

      expect(summary.generationCapexUsd).toBe(36000);
      expect(summary.annualGenerationMaintenanceUsd).toBe(350);
      expect(summary.byAsset).toHaveLength(2);
      expect(summary.byType.solar.installedCostUsd).toBe(36000);
      expect(summary.byType.solar.annualMaintenanceCostUsd).toBe(350);
      expect(summary.byType.solar.assetCount).toBe(2);
    });

    it('5. Per-asset CAPEX/O&M breakdown reconciles to totals', () => {
      const solar1 = makeSolar('solar-1', true, 15000, 150);
      const solar2 = makeSolar('solar-2', true, 8500, 95);
      const disabledSolar = makeSolar('solar-3', false, 30000, 300);
      const wind = makeWind('wind-1', true, 12000, 200);
      const generator = makeGenerator('gen-1', true, 7500, 100);

      const summary = aggregateGenerationProjectCosts({
        site: { latitude: 37.77, longitude: -122.42, timeZone: 'America/Los_Angeles', elevationM: 10 },
        assets: [solar1, solar2, disabledSolar, wind, generator],
      });

      const totalCapexFromAssets = summary.byAsset.reduce(
        (sum, a) => sum + a.installedCostUsd,
        0
      );
      const totalOmFromAssets = summary.byAsset.reduce(
        (sum, a) => sum + a.annualMaintenanceCostUsd,
        0
      );

      expect(totalCapexFromAssets).toBe(summary.generationCapexUsd);
      expect(totalOmFromAssets).toBe(summary.annualGenerationMaintenanceUsd);
      expect(summary.generationCapexUsd).toBe(15000 + 8500 + 12000 + 7500);
      expect(summary.annualGenerationMaintenanceUsd).toBe(150 + 95 + 200 + 100);
    });

    it('6. Per-type CAPEX/O&M breakdown reconciles to totals', () => {
      const solar = makeSolar('solar-1', true, 20000, 250);
      const wind = makeWind('wind-1', true, 16000, 350);
      const generator = makeGenerator('gen-1', true, 5000, 75);

      const summary = aggregateGenerationProjectCosts([solar, wind, generator]);

      // Array methods iteration on byType
      const capexSumFromArray = summary.byType.reduce(
        (sum, t) => sum + t.installedCostUsd,
        0
      );
      const omSumFromArray = summary.byType.reduce(
        (sum, t) => sum + t.annualMaintenanceCostUsd,
        0
      );

      // Property access on byType
      const capexSumFromMap =
        summary.byType.solar.installedCostUsd +
        summary.byType.wind.installedCostUsd +
        summary.byType.generator.installedCostUsd;
      const omSumFromMap =
        summary.byType.solar.annualMaintenanceCostUsd +
        summary.byType.wind.annualMaintenanceCostUsd +
        summary.byType.generator.annualMaintenanceCostUsd;

      expect(capexSumFromArray).toBe(summary.generationCapexUsd);
      expect(omSumFromArray).toBe(summary.annualGenerationMaintenanceUsd);
      expect(capexSumFromMap).toBe(summary.generationCapexUsd);
      expect(omSumFromMap).toBe(summary.annualGenerationMaintenanceUsd);
    });

    it('7. Solar metadata retains independent capacity/degradation information for multiple arrays', () => {
      const array1 = makeSolar('east-facing', true, 11000, 100, {
        dcCapacityKw: 5.2,
        inverterAcCapacityKw: 4.8,
        annualDegradationPercent: 0.45,
        tiltDegrees: 20,
        azimuthDegrees: 90,
      });
      const array2 = makeSolar('west-facing', true, 17500, 180, {
        dcCapacityKw: 9.8,
        inverterAcCapacityKw: 8.6,
        annualDegradationPercent: 0.75,
        tiltDegrees: 30,
        azimuthDegrees: 270,
      });

      const summary = aggregateGenerationProjectCosts([array1, array2]);

      expect(summary.solarMetadata).toHaveLength(2);

      const meta1 = summary.solarMetadata.find((m) => m.id === 'east-facing');
      const meta2 = summary.solarMetadata.find((m) => m.id === 'west-facing');

      expect(meta1).toBeDefined();
      expect(meta1?.dcCapacityKw).toBe(5.2);
      expect(meta1?.inverterAcCapacityKw).toBe(4.8);
      expect(meta1?.annualDegradationPercent).toBe(0.45);
      expect(meta1?.tiltDegrees).toBe(20);
      expect(meta1?.azimuthDegrees).toBe(90);

      expect(meta2).toBeDefined();
      expect(meta2?.dcCapacityKw).toBe(9.8);
      expect(meta2?.inverterAcCapacityKw).toBe(8.6);
      expect(meta2?.annualDegradationPercent).toBe(0.75);
      expect(meta2?.tiltDegrees).toBe(30);
      expect(meta2?.azimuthDegrees).toBe(270);

      // Verify alias
      const aliasSummary = calculateGenerationProjectCosts([array1, array2]);
      expect(aliasSummary).toStrictEqual(summary);
    });
  });

  // ==========================================================================
  // Group B: Analysis-State Safety
  // ==========================================================================
  describe('Analysis-State Safety', () => {
    it('8. Full-year legacy mode derives legacy-financial', () => {
      expect(deriveAnalysisState(true, 'legacy')).toBe('legacy-financial');
      expect(deriveAnalysisState({ isSuitableForAnnual: true, simulationMode: 'legacy' })).toBe('legacy-financial');

      const fullCompleteness: DatasetCompleteness = {
        startDate: '2025-01-01',
        endDate: '2025-12-31',
        intervalCount: 8760,
        intervalDurationHours: 1,
        durationDays: 365,
        expectedIntervalCount: 8760,
        missingIntervalCount: 0,
        isLeapYear: false,
        isSuitableForAnnualProjection: true,
      };
      expect(
        deriveAnalysisState({
          completeness: fullCompleteness,
          simulationMode: 'legacy',
        })
      ).toBe('legacy-financial');
    });

    it('9. Partial/incomplete data derives partial-period', () => {
      expect(deriveAnalysisState(false, 'legacy')).toBe('partial-period');
      expect(deriveAnalysisState(false, 'generation-aware')).toBe('partial-period');
      expect(deriveAnalysisState({ isSuitableForAnnual: false, simulationMode: 'generation-aware' })).toBe('partial-period');

      const partialCompleteness: DatasetCompleteness = {
        startDate: '2025-06-01',
        endDate: '2025-06-30',
        intervalCount: 720,
        intervalDurationHours: 1,
        durationDays: 30,
        expectedIntervalCount: 8760,
        missingIntervalCount: 8040,
        isLeapYear: false,
        isSuitableForAnnualProjection: false,
      };
      expect(
        deriveAnalysisState({
          completeness: partialCompleteness,
          simulationMode: 'generation-aware',
        })
      ).toBe('partial-period');
    });

    it('10. Full-year generation-aware mode derives generation-financial-pending', () => {
      expect(deriveAnalysisState(true, 'generation-aware')).toBe('generation-financial-pending');
      expect(
        deriveAnalysisState({
          isSuitableForAnnual: true,
          simulationMode: 'generation-aware',
        })
      ).toBe('generation-financial-pending');
    });

    it('11. Full-year generation-aware mode is NOT reported as partial-period', () => {
      const state = deriveAnalysisState(true, 'generation-aware');
      expect(state).not.toBe('partial-period');
      expect(state).toBe('generation-financial-pending');
    });
  });

  // ==========================================================================
  // Group C: Financial Routing & Safety Gate
  // ==========================================================================
  describe('Financial Routing & Header Safety', () => {
    it('12. No-generation/full-year mode remains eligible for calculate15YearFinancials()', () => {
      const eligible = shouldCalculateLegacyFinancials(true, 'legacy');
      expect(eligible).toBe(true);
    });

    it('13. Generation-aware/full-year mode is not eligible for the legacy financial engine', () => {
      const eligible = shouldCalculateLegacyFinancials(true, 'generation-aware');
      expect(eligible).toBe(false);

      // Incomplete dataset is also not eligible
      expect(shouldCalculateLegacyFinancials(false, 'legacy')).toBe(false);
      expect(shouldCalculateLegacyFinancials(false, 'generation-aware')).toBe(false);
    });

    it('14. Generation-enabled Year-1 operational savings remain available even though lifecycle finance is suppressed', () => {
      const dataPoints = createDataPoints(48);
      const scheduleMatrix = createScheduleMatrix();
      const battery = DEFAULT_BATTERY_PROFILES[0];
      const solar = makeSolar('solar-active', true, 18000, 150);
      const config: GenerationConfig = {
        site: { latitude: 37.77, longitude: -122.42, timeZone: 'America/Los_Angeles', elevationM: 10 },
        assets: [solar],
      };

      const unifiedResult = runUnifiedSimulation({
        dataPoints,
        intervalHours: 1,
        tiers: DEFAULT_RATE_TIERS,
        scheduleMatrix,
        batteryProfile: battery,
        generationConfig: config,
        allowSolarExport: false,
      });

      expect(unifiedResult.mode).toBe('generation-aware');
      // Year-1 operational electricity savings remain fully calculated and authoritative
      expect(unifiedResult.annualSummary.year1Savings).toBeDefined();
      expect(typeof unifiedResult.annualSummary.year1Savings).toBe('number');
      expect(unifiedResult.annualSummary.baselineAnnualCost).toBeGreaterThan(0);
      expect(unifiedResult.annualSummary.simulatedAnnualCost).toBeLessThanOrEqual(
        unifiedResult.annualSummary.baselineAnnualCost
      );
      expect(unifiedResult.generationAwareResult).toBeDefined();

      // Lifecycle financial eligibility is false
      expect(shouldCalculateLegacyFinancials(true, unifiedResult.mode)).toBe(false);
    });

    it('15. Header payback is unavailable/suppressed while generation financial analysis is pending', () => {
      // In generation-financial-pending mode, activeAnalysis is null because lifecycle calculation is suppressed
      const activeAnalysis = null;
      const paybackText = getHeaderPaybackText(activeAnalysis, true);

      expect(paybackText).toBeNull();
    });

    it('16. The valid full-year generation case retains annual/Year-1 savings semantics rather than being labeled as a partial-period result', () => {
      const isSuitableForAnnual = true;
      const label = getHeaderSavingsLabel(isSuitableForAnnual);

      expect(label).toBe('Year 1 Savings');
      expect(label).not.toBe('Period Savings');

      const partialLabel = getHeaderSavingsLabel(false);
      expect(partialLabel).toBe('Period Savings');
    });
  });

  // ==========================================================================
  // G4C: Generation-Aware Project Financial Engine Test Suites
  // ==========================================================================
  describe('G4C — Generation-Aware Project Financial Engine', () => {
    const mockBatteryProfile: BatteryProfile = {
      id: 'bat-10kwh',
      name: 'Residential Battery 10 kWh',
      model: 'VoltPower 10',
      totalCapacityKwh: 10,
      usableDodPercent: 100,
      maxContinuousOutputKw: 5,
      maxContinuousChargeKw: 5,
      roundTripEfficiencyPercent: 90,
      ratedCycleLife: 4000,
      installedCost: 10000,
      strategy: 'arbitrage',
      chargeTiers: [],
      dischargeTiers: [],
    };

    function createMockOperationalYear(
      year: number,
      savings: number,
      overrides: Partial<GenerationOperationalYear> = {}
    ): GenerationOperationalYear {
      return {
        year,
        baselineElectricityCostUsd: 2500,
        simulatedElectricityCostUsd: 2500 - savings,
        electricitySavingsUsd: savings,
        solarGeneratedKwh: 10000,
        solarDirectToLoadKwh: 4000,
        solarToBatteryKwh: 3000,
        solarExportKwh: 2500,
        solarCurtailedKwh: 500,
        gridImportKwh: 4000,
        gridExportKwh: 2500,
        batteryExportKwh: 0,
        batteryDischargedKwh: 2700,
        equivalentFullCycles: 270,
        batteryCapacityRetentionFactor: 1.0 - (year - 1) * 0.02,
        batteryUsableCapacityKwh: 10.0 * (1.0 - (year - 1) * 0.02),
        solarAssets: [
          {
            assetId: 'solar-1',
            capacityRetentionFactor: 1.0 - (year - 1) * 0.005,
            effectiveDcCapacityKw: 8.5 * (1.0 - (year - 1) * 0.005),
          },
        ],
        ...overrides,
      };
    }

    function createMockProjection(
      horizonYears: number,
      savingsFnOrValue: number | ((y: number) => number)
    ): GenerationOperationalProjectionResult {
      const years: GenerationOperationalYear[] = [];
      for (let y = 1; y <= horizonYears; y++) {
        const s = typeof savingsFnOrValue === 'function' ? savingsFnOrValue(y) : savingsFnOrValue;
        years.push(createMockOperationalYear(y, s));
      }
      return Object.assign([...years], {
        horizonYears,
        years,
      });
    }

    // ========================================================================
    // Group D: Public Input Validation & Safety
    // ========================================================================
    describe('Group D: Input Validation & Safety', () => {
      it('validates project cost summary presence and non-negative finite amounts', () => {
        const projection = createMockProjection(10, 1500);
        expect(() =>
          calculateGenerationAwareFinancials({
            batteryProfile: mockBatteryProfile,
            operationalProjection: projection,
            projectCosts: null as any,
            financials: DEFAULT_MACRO_FINANCIALS,
          })
        ).toThrow('A valid GenerationProjectCostSummary must be provided.');

        expect(() =>
          calculateGenerationAwareFinancials({
            batteryProfile: mockBatteryProfile,
            operationalProjection: projection,
            projectCosts: {
              generationCapexUsd: -500,
              annualGenerationMaintenanceUsd: 100,
              byAsset: [],
              byType: [] as any,
              solarMetadata: [],
            },
            financials: DEFAULT_MACRO_FINANCIALS,
          })
        ).toThrow('Generation CAPEX must be a finite, non-negative number.');
      });

      it('validates operational projection presence, horizon bounds (1..25), and contiguous years', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 15000,
          annualGenerationMaintenanceUsd: 150,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        expect(() =>
          calculateGenerationAwareFinancials({
            batteryProfile: mockBatteryProfile,
            operationalProjection: null as any,
            projectCosts: costs,
            financials: DEFAULT_MACRO_FINANCIALS,
          })
        ).toThrow('A valid GenerationOperationalProjection must be provided.');

        expect(() =>
          calculateGenerationAwareFinancials({
            batteryProfile: mockBatteryProfile,
            operationalProjection: { horizonYears: 0, years: [] },
            projectCosts: costs,
            financials: DEFAULT_MACRO_FINANCIALS,
          })
        ).toThrow('Operational projection must contain at least one projected year.');

        expect(() =>
          calculateGenerationAwareFinancials({
            batteryProfile: mockBatteryProfile,
            operationalProjection: { horizonYears: 30, years: new Array(30).fill(createMockOperationalYear(1, 1000)) },
            projectCosts: costs,
            financials: DEFAULT_MACRO_FINANCIALS,
          })
        ).toThrow('Projection horizon must be an integer between 1 and 25 years.');

        expect(() =>
          calculateGenerationAwareFinancials({
            batteryProfile: mockBatteryProfile,
            operationalProjection: {
              horizonYears: 2,
              years: [createMockOperationalYear(1, 1000), createMockOperationalYear(3, 1000)], // Gap in year
            },
            projectCosts: costs,
            financials: DEFAULT_MACRO_FINANCIALS,
          })
        ).toThrow('Operational projection years must be contiguous and 1-indexed. Expected year 2, found 3.');
      });

      it('rejects non-finite operational savings and costs', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 15000,
          annualGenerationMaintenanceUsd: 150,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const badProjection = {
          horizonYears: 1,
          years: [createMockOperationalYear(1, NaN)],
        };

        expect(() =>
          calculateGenerationAwareFinancials({
            batteryProfile: mockBatteryProfile,
            operationalProjection: badProjection,
            projectCosts: costs,
            financials: DEFAULT_MACRO_FINANCIALS,
          })
        ).toThrow('contains invalid or non-finite electricity cost/savings values');
      });
    });

    // ========================================================================
    // Group E: Project CAPEX & Cost Basis
    // ========================================================================
    describe('Group E: Project CAPEX & Cost Basis', () => {
      it('1. Battery CAPEX + enabled solar CAPEX are counted exactly once', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 18500,
          annualGenerationMaintenanceUsd: 150,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(10, 2000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 11000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, localRebateFlat: 0, federalTaxCreditPercent: 0 },
        });

        expect(analysis.batteryCapexUsd).toBe(11000);
        expect(analysis.generationCapexUsd).toBe(18500);
        expect(analysis.grossProjectCapexUsd).toBe(29500);
      });

      it('2. Disabled generation asset costs remain excluded through the G4A cost summary', () => {
        const disabledSolar = makeSolar('solar-off', false, 25000, 500);
        const g4aSummary = aggregateGenerationProjectCosts([disabledSolar]);
        expect(g4aSummary.generationCapexUsd).toBe(0);

        const projection = createMockProjection(10, 1000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: g4aSummary,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false },
        });

        expect(analysis.generationCapexUsd).toBe(0);
        expect(analysis.grossProjectCapexUsd).toBe(10000);
      });

      it('3. Multiple enabled solar assets reconcile to combined generation CAPEX', () => {
        const solar1 = makeSolar('s1', true, 12000, 100);
        const solar2 = makeSolar('s2', true, 8000, 80);
        const g4aSummary = aggregateGenerationProjectCosts([solar1, solar2]);

        const projection = createMockProjection(10, 2000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: g4aSummary,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false },
        });

        expect(analysis.generationCapexUsd).toBe(20000);
        expect(analysis.grossProjectCapexUsd).toBe(30000);
      });

      it('4. Gross project CAPEX equals battery + generation CAPEX', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 14250.75,
          annualGenerationMaintenanceUsd: 120,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(10, 2000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 9749.25 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: DEFAULT_MACRO_FINANCIALS,
        });

        expect(analysis.grossProjectCapexUsd).toBe(24000);
        expect(analysis.grossProjectCapexUsd).toBe(analysis.batteryCapexUsd + analysis.generationCapexUsd);
      });
    });

    // ========================================================================
    // Group F: Annual Generation O&M
    // ========================================================================
    describe('Group F: Annual Generation O&M', () => {
      it('5. Annual generation O&M is deducted every projected year', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 250,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, replacementEnabled: false, federalTaxCreditPercent: 0 },
        });

        analysis.projections.forEach((p) => {
          expect(p.generationMaintenanceUsd).toBe(250);
          expect(p.netProjectCashFlowUsd).toBe(1000 - 250);
        });
      });

      it('6. $0 generation O&M produces no O&M deduction', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, replacementEnabled: false, federalTaxCreditPercent: 0 },
        });

        analysis.projections.forEach((p) => {
          expect(p.generationMaintenanceUsd).toBe(0);
          expect(p.netProjectCashFlowUsd).toBe(1000);
        });
      });

      it('7. Generation O&M remains constant nominal and is not escalated by electricity inflation', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 180,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(15, 1200);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            annualElectricityInflationRate: 5.0, // 5% inflation must NOT escalate generation O&M
          },
        });

        for (let y = 1; y <= 15; y++) {
          expect(analysis.projections[y - 1].generationMaintenanceUsd).toBe(180);
        }
      });
    });

    // ========================================================================
    // Group G: Incentives
    // ========================================================================
    describe('Group G: Incentive Semantics', () => {
      it('8. Immediate rebate reduces the upfront/financing basis', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 15000,
          annualGenerationMaintenanceUsd: 100,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1500);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            localRebateFlat: 3000,
            federalTaxCreditPercent: 0,
            isFinanced: false,
          },
        });

        expect(analysis.grossProjectCapexUsd).toBe(25000);
        expect(analysis.immediateRebateUsd).toBe(3000);
        expect(analysis.upfrontOutOfPocketUsd).toBe(22000);
      });

      it('9. Deferred federal tax credit uses combined project CAPEX', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 15000,
          annualGenerationMaintenanceUsd: 100,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1500);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            federalTaxCreditPercent: 30, // 30% of $25,000 = $7,500
          },
        });

        expect(analysis.deferredFederalTaxCreditUsd).toBe(7500);
      });

      it('10. Deferred tax credit does not reduce the initial loan principal', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 100,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1500);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            localRebateFlat: 2000,
            federalTaxCreditPercent: 30,
            isFinanced: true,
            loanDownPaymentPercent: 0, // 0% down
            loanTermYears: 10,
            loanAprPercent: 5.0,
          },
        });

        // Gross = $20,000. Immediate rebate = $2,000 => Upfront basis = $18,000.
        // Tax credit = $6,000. Loan principal must remain $18,000 (not reduced to $12,000).
        expect(analysis.loanPrincipalUsd).toBe(18000);
      });

      it('11. Tax credit appears exactly once in its configured realization year', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: false,
            federalTaxCreditPercent: 20, // $4,000
            federalTaxCreditRealizationYear: 2, // Realized in Year 2
          },
        });

        expect(analysis.projections[0].taxCreditInflowUsd).toBe(0);
        expect(analysis.projections[1].taxCreditInflowUsd).toBe(4000);
        expect(analysis.projections[2].taxCreditInflowUsd).toBe(0);
        expect(analysis.projections[3].taxCreditInflowUsd).toBe(0);
        expect(analysis.projections[4].taxCreditInflowUsd).toBe(0);
      });
    });

    // ========================================================================
    // Group H: Financing
    // ========================================================================
    describe('Group H: Financing Basis & Loan Amortization', () => {
      it('12. Cash purchase uses the combined upfront project basis', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 12000,
          annualGenerationMaintenanceUsd: 100,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 8000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: false,
            localRebateFlat: 1500,
          },
        });

        expect(analysis.isFinanced).toBe(false);
        expect(analysis.loanPrincipalUsd).toBe(0);
        expect(analysis.upfrontOutOfPocketUsd).toBe(18500); // $20,000 - $1,500
      });

      it('13. Financed project loan principal uses combined battery + generation basis after immediate rebate', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 14000,
          annualGenerationMaintenanceUsd: 100,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 6000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: true,
            localRebateFlat: 2000,
            loanDownPaymentPercent: 10,
          },
        });

        // Upfront basis = $20,000 - $2,000 = $18,000
        // Down payment 10% = $1,800
        // Loan principal = $16,200
        expect(analysis.upfrontOutOfPocketUsd).toBe(1800);
        expect(analysis.loanPrincipalUsd).toBe(16200);
      });

      it('14. Down-payment behavior matches the established legacy convention', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: true,
            localRebateFlat: 0,
            loanDownPaymentPercent: 25, // 25% down payment
          },
        });

        expect(analysis.upfrontOutOfPocketUsd).toBe(5000);
        expect(analysis.loanPrincipalUsd).toBe(15000);
      });

      it('15. 0% APR amortization works correctly', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 6000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 6000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: true,
            localRebateFlat: 0,
            loanDownPaymentPercent: 0,
            loanAprPercent: 0, // 0% APR
            loanTermYears: 10, // 120 months
          },
        });

        // $12,000 / 120 = $100/mo
        expect(analysis.monthlyLoanPaymentUsd).toBe(100);
        expect(analysis.totalLoanPaymentsUsd).toBe(12000);
        expect(analysis.totalLoanInterestUsd).toBe(0);
      });

      it('16. Positive APR amortization works correctly', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(5, 1000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: true,
            localRebateFlat: 0,
            loanDownPaymentPercent: 0,
            loanAprPercent: 6.0,
            loanTermYears: 10, // 120 months
          },
        });

        // P = 20,000, r = 0.06/12 = 0.005, n = 120
        // M = 20000 * (0.005 * 1.005^120) / (1.005^120 - 1) ≈ 222.04
        expect(analysis.monthlyLoanPaymentUsd).toBeCloseTo(222.04, 2);
        expect(analysis.totalLoanPaymentsUsd).toBeCloseTo(222.04 * 120, 1);
        expect(analysis.totalLoanInterestUsd).toBeCloseTo(analysis.totalLoanPaymentsUsd - 20000, 1);
      });

      it('17. Loan payments stop after the configured loan term', () => {
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };
        const projection = createMockProjection(10, 2000);
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: true,
            loanTermYears: 5,
            loanAprPercent: 5.0,
          },
        });

        for (let y = 1; y <= 5; y++) {
          expect(analysis.projections[y - 1].annualLoanPaymentUsd).toBeGreaterThan(0);
        }
        for (let y = 6; y <= 10; y++) {
          expect(analysis.projections[y - 1].annualLoanPaymentUsd).toBe(0);
        }
      });
    });

    // ========================================================================
    // Group I: Authoritative G4B Operational Savings Consumption
    // ========================================================================
    describe('Group I: G4B Operational Savings Consumption', () => {
      it('18. Each financial year uses the corresponding G4B electricitySavingsUsd exactly', () => {
        const savingsSeries = [1845.22, 1792.11, 1740.05, 1690.5, 1642.33];
        const projection = createMockProjection(5, (y) => savingsSeries[y - 1]);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: DEFAULT_MACRO_FINANCIALS,
        });

        for (let y = 0; y < 5; y++) {
          expect(analysis.projections[y].electricitySavingsUsd).toBe(savingsSeries[y]);
        }
      });

      it('19, 20, 21. G4C does not reapply solar degradation, battery degradation, or electricity inflation', () => {
        // Flat $1,000 savings in G4B
        const projection = createMockProjection(10, 1000);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        // Setting aggressive macro inflation and degradation rates
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            annualElectricityInflationRate: 8.0,
            annualBatteryDegradationRate: 5.0,
          },
        });

        // Operational savings must remain $1,000 for every single year
        analysis.projections.forEach((p) => {
          expect(p.electricitySavingsUsd).toBe(1000);
        });
      });

      it('22. A deliberately non-monotonic G4B savings series remains non-monotonic in G4C', () => {
        const nonMonotonicSavings = [1000, 1500, 800, 2200, 1100];
        const projection = createMockProjection(5, (y) => nonMonotonicSavings[y - 1]);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: DEFAULT_MACRO_FINANCIALS,
        });

        const extracted = analysis.projections.map((p) => p.electricitySavingsUsd);
        expect(extracted).toEqual(nonMonotonicSavings);
      });
    });

    // ========================================================================
    // Group J: Cash Flow, Cumulative Tracking & Lifetime Net Profit
    // ========================================================================
    describe('Group J: Cash Flow, Cumulative Tracking & Lifetime Net Profit', () => {
      it('23. Annual net project cash flow reconciles: savings - O&M - replacement - debt service + tax credit', () => {
        const projection = createMockProjection(5, 2000);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 12000,
          annualGenerationMaintenanceUsd: 150,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 12000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: true,
            loanTermYears: 5,
            loanAprPercent: 0,
            loanDownPaymentPercent: 0, // Loan = $24,000 / 60 mos = $400/mo = $4,800/yr
            replacementEnabled: true,
            replacementCost: 1500,
            replacementYear: 3,
            federalTaxCreditPercent: 20, // $4,800 in Year 1
            federalTaxCreditRealizationYear: 1,
          },
        });

        // Year 1: $2,000 savings - $150 O&M - $0 rep - $4,800 loan + $4,800 tax credit = $1,850
        expect(analysis.projections[0].netProjectCashFlowUsd).toBe(1850);

        // Year 2: $2,000 - $150 - $0 - $4,800 + $0 = -$2,950
        expect(analysis.projections[1].netProjectCashFlowUsd).toBe(-2950);

        // Year 3: $2,000 - $150 - $1,500 - $4,800 + $0 = -$4,450
        expect(analysis.projections[2].netProjectCashFlowUsd).toBe(-4450);

        // Year 4: $2,000 - $150 - $0 - $4,800 + $0 = -$2,950
        expect(analysis.projections[3].netProjectCashFlowUsd).toBe(-2950);

        // Reconcile each year directly against formula:
        analysis.projections.forEach((p) => {
          const expected = Math.round(
            (p.electricitySavingsUsd -
              p.generationMaintenanceUsd -
              p.replacementExpenseUsd -
              p.annualLoanPaymentUsd +
              p.taxCreditInflowUsd) * 100
          ) / 100;
          expect(p.netProjectCashFlowUsd).toBe(expected);
        });
      });

      it('24. Final cumulative cash flow equals reported lifecycle net profit', () => {
        const projection = createMockProjection(15, (y) => 1200 + y * 50);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 12000,
          annualGenerationMaintenanceUsd: 180,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: false,
            replacementEnabled: true,
            replacementCost: 2000,
            replacementYear: 10,
          },
        });

        const finalYearProj = analysis.projections[analysis.projections.length - 1];
        expect(analysis.lifetimeNetProfitUsd).toBe(finalYearProj.cumulativeCashFlowUsd);
      });

      it('25 & 26. Replacement expense behavior when enabled vs disabled', () => {
        const projection = createMockProjection(10, 1000);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysisEnabled = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            replacementEnabled: true,
            replacementCost: 2500,
            replacementYear: 7,
          },
        });

        expect(analysisEnabled.projections[6].replacementExpenseUsd).toBe(2500);
        expect(analysisEnabled.projections[0].replacementExpenseUsd).toBe(0);

        const analysisDisabled = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            replacementEnabled: false,
            replacementCost: 2500,
            replacementYear: 7,
          },
        });

        analysisDisabled.projections.forEach((p) => {
          expect(p.replacementExpenseUsd).toBe(0);
        });
      });
    });

    // ========================================================================
    // Group K: Payback
    // ========================================================================
    describe('Group K: Simple Payback Period', () => {
      it('27 & 28. Payback uses varying cash flows and interpolates crossing-year fraction', () => {
        // Cost: $10,000 cash upfront.
        // Cash flows: Y1: $4,000, Y2: $4,000, Y3: $4,000.
        // CumCF: Y0: -10,000, Y1: -6,000, Y2: -2,000, Y3: +2,000.
        // Crossing in Year 3. Deficit before Y3 = $2,000. Y3 net flow = $4,000.
        // Fraction = 2000 / 4000 = 0.5. Payback = 2.5 years.
        const projection = createMockProjection(5, 4000);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 0,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, federalTaxCreditPercent: 0 },
        });

        expect(analysis.paybackYears).toBe(2.5);
        expect(analysis.paybackFormatted).toBe('2 yrs 6 mos');
      });

      it('29. A project that never crosses zero returns no within-horizon payback', () => {
        // Upfront: $20,000, savings $500/yr for 10 years => max cumulative CF = -$15,000
        const projection = createMockProjection(10, 500);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, federalTaxCreditPercent: 0 },
        });

        expect(analysis.paybackYears).toBeNull();
        expect(analysis.paybackFormatted).toBe('Over 10 Years');
      });
    });

    // ========================================================================
    // Group L: Net Present Value (NPV)
    // ========================================================================
    describe('Group L: Net Present Value (NPV)', () => {
      it('30. NPV independently reconciles to discounted cash-flow stream', () => {
        const projection = createMockProjection(5, 2000);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 5000,
          annualGenerationMaintenanceUsd: 100,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const discountRatePercent = 8.0;
        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 5000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: false,
            discountRatePercent,
            federalTaxCreditPercent: 0,
          },
        });

        // Upfront = -$10,000. Annual net CF = $2,000 - $100 = $1,900.
        const r = 0.08;
        let expectedNpv = -10000;
        for (let y = 1; y <= 5; y++) {
          expectedNpv += 1900 / Math.pow(1 + r, y);
        }

        expect(analysis.npvUsd).toBeCloseTo(expectedNpv, 1);
        expect(analysis.projections[4].cumulativeNpvUsd).toBeCloseTo(expectedNpv, 1);
      });

      it('31. Changing discountRatePercent changes NPV without changing nominal cash flow', () => {
        const projection = createMockProjection(5, 2000);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 5000,
          annualGenerationMaintenanceUsd: 100,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysisLow = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 5000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, discountRatePercent: 4.0 },
        });

        const analysisHigh = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 5000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, discountRatePercent: 12.0 },
        });

        // Nominal cash flows and net profit must be identical
        expect(analysisLow.lifetimeNetProfitUsd).toBe(analysisHigh.lifetimeNetProfitUsd);
        for (let y = 0; y < 5; y++) {
          expect(analysisLow.projections[y].netProjectCashFlowUsd).toBe(
            analysisHigh.projections[y].netProjectCashFlowUsd
          );
        }

        // NPV must differ (lower discount rate gives higher NPV for positive cash flows)
        expect(analysisLow.npvUsd).toBeGreaterThan(analysisHigh.npvUsd);
      });

      it('31b. 0% discount rate yields NPV equal to nominal lifetimeNetProfit', () => {
        const projection = createMockProjection(10, 1500);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 5000,
          annualGenerationMaintenanceUsd: 50,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 5000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, discountRatePercent: 0 },
        });

        expect(analysis.npvUsd).toBe(analysis.lifetimeNetProfitUsd);
      });
    });

    // ========================================================================
    // Group M: Internal Rate of Return (IRR)
    // ========================================================================
    describe('Group M: Internal Rate of Return (IRR)', () => {
      it('32. Reported IRR equals calculateIRR(...) on identical project cash-flow stream', () => {
        const projection = createMockProjection(5, 3000);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 5000,
          annualGenerationMaintenanceUsd: 100,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 5000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, federalTaxCreditPercent: 0 },
        });

        const expectedCashFlows = [-10000, 2900, 2900, 2900, 2900, 2900];
        const expectedIrr = calculateIRR(expectedCashFlows);

        expect(analysis.irrPercent).toBe(expectedIrr);
        expect(analysis.irrPercent).toBeGreaterThan(0);
      });

      it('33. A cash-flow stream without a valid positive IRR returns null', () => {
        // High cost $50,000, small savings $500/yr => nominal inflows do not recover investment
        const projection = createMockProjection(5, 500);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 25000,
          annualGenerationMaintenanceUsd: 0,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 25000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, federalTaxCreditPercent: 0 },
        });

        expect(analysis.irrPercent).toBeNull();
      });
    });

    // ========================================================================
    // Group N: Lifetime ROI & Cash Outlay Denominator
    // ========================================================================
    describe('Group N: Lifetime ROI & Cash Outlay Denominator', () => {
      it('34 & 35. ROI reconciles to documented project cash-outlay denominator including generation O&M', () => {
        // Upfront cash: $10,000 ($5,000 battery + $5,000 solar)
        // 5 years, savings = $3,000/yr => $15,000 savings
        // O&M = $200/yr => $1,000 total O&M
        // Total cash outlays = $10,000 (upfront) + $1,000 (O&M) = $11,000
        // Lifetime Net Profit = $15,000 - $11,000 = $4,000
        // ROI = ($4,000 / $11,000) * 100 = 36.36% ≈ 36.4%
        const projection = createMockProjection(5, 3000);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 5000,
          annualGenerationMaintenanceUsd: 200,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 5000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: { ...DEFAULT_MACRO_FINANCIALS, isFinanced: false, federalTaxCreditPercent: 0 },
        });

        expect(analysis.totalProjectCashOutlaysUsd).toBe(11000);
        expect(analysis.lifetimeNetProfitUsd).toBe(4000);
        expect(analysis.lifetimeRoiPercent).toBeCloseTo(36.4, 1);
      });
    });

    // ========================================================================
    // Group O: Opportunity Cost Benchmark
    // ========================================================================
    describe('Group O: Opportunity Cost Benchmark with Generation O&M', () => {
      it('36, 37, 38, 39. Opportunity cost accounts for generation-aware upfront cash, debt service, replacement, and O&M', () => {
        const projection = createMockProjection(5, 3000);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 250,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: { ...mockBatteryProfile, installedCost: 10000 },
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: true,
            loanDownPaymentPercent: 20, // $4,000 upfront
            loanTermYears: 5,
            loanAprPercent: 5.0,
            replacementEnabled: true,
            replacementCost: 1000,
            replacementYear: 3,
            opportunityCostRatePercent: 5.0,
          },
        });

        // Upfront contribution must be $4,000 (not battery-only down payment)
        expect(analysis.upfrontOutOfPocketUsd).toBe(4000);

        // Verification against direct calculateOpportunityCostBenchmark call
        const directBenchmark = calculateOpportunityCostBenchmark({
          horizonYears: 5,
          annualRatePercent: 5.0,
          upfrontContribution: 4000,
          monthlyLoanPayment: analysis.monthlyLoanPaymentUsd,
          loanTermYears: 5,
          replacementEnabled: true,
          replacementCost: 1000,
          replacementYear: 3,
          additionalAnnualContributions: [250, 250, 250, 250, 250],
        });

        expect(analysis.opportunityCostFutureValueUsd).toBeCloseTo(directBenchmark.futureValue, 1);
        expect(analysis.opportunityCostProfitUsd).toBeCloseTo(directBenchmark.profit, 1);
      });

      it('40. Existing opportunity-cost calls without optional parameter remain completely unchanged', () => {
        const input = {
          horizonYears: 10,
          annualRatePercent: 7.0,
          upfrontContribution: 10000,
          monthlyLoanPayment: 150,
          loanTermYears: 5,
          replacementEnabled: false,
          replacementCost: 0,
          replacementYear: 0,
        };

        const result = calculateOpportunityCostBenchmark(input);
        expect(result.horizonYears).toBe(10);
        expect(result.upfrontContribution).toBe(10000);
        expect(result.yearly).toHaveLength(10);
      });
    });

    // ========================================================================
    // Group P: Horizon Financial Summary Helper
    // ========================================================================
    describe('Group P: Selected-Horizon Summary Helper', () => {
      it('41, 42, 43, 44. deriveGenerationHorizonFinancialSummary reconciles from annual records', () => {
        const projection = createMockProjection(15, (y) => 1000 + y * 100);
        const costs: GenerationProjectCostSummary = {
          generationCapexUsd: 10000,
          annualGenerationMaintenanceUsd: 150,
          byAsset: [],
          byType: [] as any,
          solarMetadata: [],
        };

        const analysis = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection: projection,
          projectCosts: costs,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: true,
            loanTermYears: 10,
            loanAprPercent: 5.0,
            replacementEnabled: true,
            replacementCost: 2000,
            replacementYear: 12,
          },
        });

        const horizon10 = deriveGenerationHorizonFinancialSummary(analysis, 10);
        expect(horizon10.horizonYears).toBe(10);
        expect(horizon10.cumulativeCashFlow).toBe(analysis.projections[9].cumulativeCashFlowUsd);
        expect(horizon10.netPresentValue).toBe(analysis.projections[9].cumulativeNpvUsd);

        // Replacement cost in Year 12 must NOT be included in Year 10 horizon
        expect(horizon10.totalReplacementExpense).toBe(0);

        // Total savings across years 1..10
        const expectedSavings10 = analysis.projections.slice(0, 10).reduce((s, p) => s + p.electricitySavingsUsd, 0);
        expect(horizon10.cumulativeElectricitySavings).toBe(expectedSavings10);

        // Total O&M across years 1..10
        expect(horizon10.totalGenerationMaintenance).toBe(150 * 10);

        // Payback verification
        if (analysis.paybackYears !== null && analysis.paybackYears > 10) {
          expect(horizon10.simplePaybackYears).toBeNull();
        } else if (analysis.paybackYears !== null && analysis.paybackYears <= 10) {
          expect(horizon10.simplePaybackYears).toBe(analysis.paybackYears);
        }
      });
    });

    // ========================================================================
    // Group Q: Legacy Separation & Safety Invariant
    // ========================================================================
    describe('Group Q: Legacy Invariant & Separation', () => {
      it('45, 46, 47. Legacy calculate15YearFinancials remains isolated and unchanged', () => {
        const baseSummary = {
          profileId: mockBatteryProfile.id,
          profileName: mockBatteryProfile.name,
          totalIntervals: 8760,
          intervalHours: 1,
          totalHomeLoadKwh: 6000,
          baselineAnnualCost: 2000,
          simulatedAnnualCost: 1200,
          year1Savings: 800,
          savingsPercentage: 40,
          annualGridImportKwh: 4000,
          annualGridExportKwh: 0,
          annualBatteryDischargedKwh: 2000,
          equivalentFullCycles: 200,
          maxPeakDemandKw: 5,
          intervalResults: [],
        };

        const legacyAnalysis = calculate15YearFinancials(
          mockBatteryProfile,
          baseSummary,
          DEFAULT_MACRO_FINANCIALS
        );

        expect(legacyAnalysis).toBeDefined();
        expect(legacyAnalysis.grossCost).toBe(mockBatteryProfile.installedCost);
        expect(legacyAnalysis.projections).toHaveLength(25);

        // Safety gate confirms generation mode cannot pass into legacy
        expect(shouldCalculateLegacyFinancials(true, 'generation-aware')).toBe(false);
        expect(shouldCalculateLegacyFinancials(true, 'legacy')).toBe(true);
      });
    });

    // ========================================================================
    // Group R: Full End-to-End Engine Pipeline (G4A -> G4B -> G4C)
    // ========================================================================
    describe('Group R: Full End-to-End Pipeline (G4A -> G4B -> G4C)', () => {
      it('runs real G4A cost aggregation -> G4B projection -> G4C lifecycle finance cleanly', () => {
        const dataPoints = createDataPoints(48);
        const scheduleMatrix = createScheduleMatrix();
        const solarAsset = makeSolar('solar-array-1', true, 16000, 180, {
          dcCapacityKw: 8.0,
          inverterAcCapacityKw: 7.2,
          annualDegradationPercent: 0.5,
        });

        const genConfig: GenerationConfig = {
          site: { latitude: 37.77, longitude: -122.42, timeZone: 'America/Los_Angeles', elevationM: 10 },
          assets: [solarAsset],
        };

        // G4A: Aggregate costs
        const projectCosts = aggregateGenerationProjectCosts(genConfig);
        expect(projectCosts.generationCapexUsd).toBe(16000);
        expect(projectCosts.annualGenerationMaintenanceUsd).toBe(180);

        // G4B: Operational projection (3 years for test speed)
        const operationalProjection = calculateGenerationOperationalProjection({
          dataPoints,
          intervalHours: 1,
          tiers: DEFAULT_RATE_TIERS,
          scheduleMatrix,
          batteryProfile: mockBatteryProfile,
          generationConfig: genConfig,
          allowSolarExport: true,
          horizonYears: 3,
          allowIncompleteYearForTesting: true,
        });

        expect(operationalProjection.horizonYears).toBe(3);
        expect(operationalProjection.years).toHaveLength(3);

        // G4C: Financial lifecycle engine
        const financials = calculateGenerationAwareFinancials({
          batteryProfile: mockBatteryProfile,
          operationalProjection,
          projectCosts,
          financials: {
            ...DEFAULT_MACRO_FINANCIALS,
            isFinanced: false,
            localRebateFlat: 1000,
            federalTaxCreditPercent: 30,
            discountRatePercent: 6.0,
          },
        });

        expect(financials.grossProjectCapexUsd).toBe(26000); // 10,000 + 16,000
        expect(financials.immediateRebateUsd).toBe(1000);
        expect(financials.deferredFederalTaxCreditUsd).toBe(7800); // 30% of 26,000
        expect(financials.upfrontOutOfPocketUsd).toBe(25000);
        expect(financials.projections).toHaveLength(3);

        // Verify that year-1 savings match G4B exactly
        expect(financials.year1ElectricitySavingsUsd).toBe(
          operationalProjection.years[0].electricitySavingsUsd
        );

        // Reconcile horizon summary
        const horizonSummary = deriveGenerationHorizonFinancialSummary(financials, 3);
        expect(horizonSummary.cumulativeCashFlow).toBe(financials.lifetimeNetProfitUsd);
        expect(horizonSummary.netPresentValue).toBe(financials.npvUsd);
      });
    });
  });
});

