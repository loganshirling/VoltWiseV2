import { describe, it, expect } from 'vitest';
import {
  deriveGenerationOperationalDisplayMetrics,
  formatKwh,
  formatUsd,
  formatPercent,
  shouldCalculateGenerationAwareFinancials,
  resolveMultiProfileMatrixState,
  formatSolarDegradationSummary,
  formatSolarDegradationClause,
} from '../utils/generationResults';
import {
  aggregateGenerationProjectCosts,
  calculateGenerationAwareFinancials,
  deriveAnalysisState,
  deriveGenerationHorizonFinancialSummary,
  shouldCalculateLegacyFinancials,
} from '../utils/generationFinancials';
import {
  calculateGenerationOperationalProjection,
} from '../utils/generationProjection';
import {
  createDefaultGenerationConfig,
  createDefaultAsset,
} from '../utils/generationDefaults';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_RATE_TIERS,
} from '../utils/simulationEngine';
import {
  runUnifiedSimulation,
} from '../utils/simulationRouter';
import {
  BatteryProfile,
  GenerationConfig,
  IntervalDataPoint,
  SolarGenerationAsset,
} from '../types/energy';
import {
  GenerationAwareSimulationResult,
} from '../utils/generationAwareSimulation';

describe('G4D — Generation Results & Analytics Integration', () => {
  const profile: BatteryProfile = { ...DEFAULT_BATTERY_PROFILES[0] };
  const financials = { ...DEFAULT_MACRO_FINANCIALS };

  function createMockIntervalData(days: number): IntervalDataPoint[] {
    const data: IntervalDataPoint[] = [];
    const baseDate = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
    const totalHours = days * 24;

    for (let h = 0; h < totalHours; h++) {
      const d = new Date(baseDate.getTime() + h * 3600000);
      data.push({
        timestamp: d.toISOString(),
        date: d,
        hour: d.getUTCHours(),
        dayOfWeek: d.getUTCDay(),
        month: d.getUTCMonth(),
        usageKwh: 1.5,
      });
    }
    return data;
  }

  function createScheduleMatrix(): string[][] {
    return Array.from({ length: 7 }, () =>
      Array.from({ length: 24 }, (_, hour) => (hour >= 16 && hour < 21 ? 'on-peak' : 'off-peak'))
    );
  }

  describe('1. Operational Results Adapter (deriveGenerationOperationalDisplayMetrics)', () => {
    it('accurately extracts all authoritative Year-1 operational generation metrics from intervals', () => {
      const mockResult: GenerationAwareSimulationResult = {
        totalHomeLoadKwh: 10000,
        totalSolarGenerationKwh: 6000,
        totalSolarDirectToLoadKwh: 3500,
        totalGridImportKwh: 5500,
        totalSolarExportKwh: 1000,
        totalBatteryExportKwh: 200,
        totalGridExportKwh: 1200,
        baselineCost: 3500,
        simulatedCost: 1500,
        netSavings: 2000,
        exportAwareBatteryFlow: {
          intervals: [
            {
              intervalIndex: 0,
              preExportFlow: {
                solarToBatteryAcKwh: 800,
              },
            } as any,
            {
              intervalIndex: 1,
              preExportFlow: {
                solarToBatteryAcKwh: 400,
              },
            } as any,
          ],
        } as any,
        gridFlows: {
          totalCurtailedSolarKwh: 300,
        } as any,
      } as unknown as GenerationAwareSimulationResult;

      const metrics = deriveGenerationOperationalDisplayMetrics(mockResult);

      expect(metrics.totalHomeLoadKwh).toBe(10000);
      expect(metrics.totalSolarGenerationKwh).toBe(6000);
      expect(metrics.totalSolarDirectToLoadKwh).toBe(3500);
      expect(metrics.totalSolarToBatteryKwh).toBe(1200);
      expect(metrics.solarToBatteryAcKwh).toBe(1200);
      expect(metrics.totalCurtailedSolarKwh).toBe(300);
      expect(metrics.totalSolarExportKwh).toBe(1000);
      expect(metrics.totalBatteryExportKwh).toBe(200);
      expect(metrics.totalGridExportKwh).toBe(1200);
      expect(metrics.totalGridImportKwh).toBe(5500);
      expect(metrics.baselineCostUsd).toBe(3500);
      expect(metrics.simulatedCostUsd).toBe(1500);
      expect(metrics.netSavingsUsd).toBe(2000);

      // Verify alias fields match
      expect(metrics.solarGeneratedKwh).toBe(metrics.totalSolarGenerationKwh);
      expect(metrics.solarDirectConsumptionKwh).toBe(metrics.totalSolarDirectToLoadKwh);
      expect(metrics.solarToBatteryKwh).toBe(metrics.totalSolarToBatteryKwh);
      expect(metrics.curtailedSolarKwh).toBe(metrics.totalCurtailedSolarKwh);
      expect(metrics.gridImportKwh).toBe(metrics.totalGridImportKwh);
      expect(metrics.gridExportKwh).toBe(metrics.totalGridExportKwh);
      expect(metrics.solarExportKwh).toBe(metrics.totalSolarExportKwh);
      expect(metrics.batteryExportKwh).toBe(metrics.totalBatteryExportKwh);
    });

    it('derives solar-to-battery strictly from authoritative intervals and ignores undeclared fallback properties', () => {
      const mockResult: GenerationAwareSimulationResult = {
        totalHomeLoadKwh: 5000,
        totalSolarGenerationKwh: 4000,
        totalSolarDirectToLoadKwh: 2000,
        totalGridImportKwh: 3000,
        totalSolarExportKwh: 1000,
        totalBatteryExportKwh: 0,
        totalGridExportKwh: 1000,
        baselineCost: 2000,
        simulatedCost: 1000,
        netSavings: 1000,
        exportAwareBatteryFlow: undefined as any,
        gridFlows: undefined as any,
      } as unknown as GenerationAwareSimulationResult;
      // Intentionally attach an ad-hoc undeclared property:
      (mockResult as any).solarToBatteryKwh = 1000;

      const metrics = deriveGenerationOperationalDisplayMetrics(mockResult);
      // Adapter must NOT read undeclared fallback property and must return 0
      expect(metrics.solarToBatteryAcKwh).toBe(0);
      expect(metrics.totalSolarToBatteryKwh).toBe(0);
      expect(metrics.totalCurtailedSolarKwh).toBe(0);
    });

    it('formats values correctly without NaN or floating-point glitches', () => {
      expect(formatKwh(1234.56)).toBe('1,235 kWh');
      expect(formatKwh(0)).toBe('0 kWh');
      expect(formatUsd(1234.56)).toBe('$1,235');
      expect(formatUsd(-500)).toBe('-$500');
      expect(formatPercent(12.34)).toBe('12.3%');
      expect(formatPercent(null)).toBe('N/A');
    });
  });

  describe('2. Multi-Array Solar Degradation Presentation', () => {
    it('formats single solar array degradation clearly', () => {
      const single = [{ name: 'Roof Array', annualDegradationPercent: 0.5 }];
      expect(formatSolarDegradationSummary(single)).toBe('Solar degradation: 0.5%/yr');
      expect(formatSolarDegradationClause(single)).toBe('solar DC degradation (0.5%/yr)');
    });

    it('distinguishes multiple solar arrays without fleet-averaging or picking only the first array', () => {
      const multi = [
        { name: 'Roof South', annualDegradationPercent: 0.3 },
        { name: 'Garage', annualDegradationPercent: 0.8 },
      ];
      const summary = formatSolarDegradationSummary(multi);
      const clause = formatSolarDegradationClause(multi);

      // Must explicitly present both arrays and their rates
      expect(summary).toBe('Solar degradation by array: Roof South 0.3%/yr · Garage 0.8%/yr');
      expect(clause).toBe('per-array solar DC degradation (Roof South 0.3%/yr · Garage 0.8%/yr)');

      // Must NOT collapse to only the first array (0.3%/yr)
      expect(summary).not.toBe('Solar degradation: 0.3%/yr');
      // Must NOT fleet-average (e.g. 0.55%/yr)
      expect(summary).not.toContain('0.55%');
    });

    it('handles empty or missing solar metadata with safe defaults', () => {
      expect(formatSolarDegradationSummary(null)).toBe('Solar degradation: 0.5%/yr');
      expect(formatSolarDegradationSummary([])).toBe('Solar degradation: 0.5%/yr');
      expect(formatSolarDegradationClause(null)).toBe('solar DC degradation (0.5%/yr)');
    });
  });

  describe('3. Multi-Profile Matrix Presentation State', () => {
    it('distinguishes legacy, full-year generation, pending generation, and partial-period states', () => {
      expect(resolveMultiProfileMatrixState('legacy-financial')).toBe('legacy');
      expect(resolveMultiProfileMatrixState('generation-financial')).toBe('generation-financial');
      expect(resolveMultiProfileMatrixState('generation-financial-pending')).toBe('generation-financial-pending');
      expect(resolveMultiProfileMatrixState('partial-period')).toBe('partial-period');
      expect(resolveMultiProfileMatrixState('unknown' as any)).toBe('legacy');
    });
  });

  describe('4. State Derivation and G4 Routing Rules', () => {
    it('preserves legacy-financial for full-year data with legacy simulation', () => {
      const state = deriveAnalysisState(true, 'legacy', true);
      expect(state).toBe('legacy-financial');
      expect(shouldCalculateLegacyFinancials(true, 'legacy')).toBe(true);
      expect(shouldCalculateGenerationAwareFinancials(state)).toBe(false);
    });

    it('identifies generation-financial when full-year generation simulation has financial analysis', () => {
      const state = deriveAnalysisState(true, 'generation-aware', true);
      expect(state).toBe('generation-financial');
      expect(state).not.toBe('partial-period');
      expect(shouldCalculateLegacyFinancials(true, 'generation-aware')).toBe(false);
      expect(shouldCalculateGenerationAwareFinancials(state)).toBe(true);
    });

    it('identifies generation-financial-pending when full-year generation simulation has no financial analysis yet', () => {
      const state = deriveAnalysisState(true, 'generation-aware', false);
      expect(state).toBe('generation-financial-pending');
      expect(state).not.toBe('partial-period');
      expect(shouldCalculateLegacyFinancials(true, 'generation-aware')).toBe(false);
      expect(shouldCalculateGenerationAwareFinancials(state)).toBe(true);
    });

    it('identifies partial-period when data is not suitable for annual projection', () => {
      const state = deriveAnalysisState(false, 'generation-aware', false);
      expect(state).toBe('partial-period');
      expect(state).not.toBe('generation-financial');
      expect(state).not.toBe('generation-financial-pending');
      expect(shouldCalculateLegacyFinancials(false, 'generation-aware')).toBe(false);
      expect(shouldCalculateGenerationAwareFinancials(state)).toBe(false);
    });
  });

  describe('5. Partial-Period Data Invariants & Generation Availability', () => {
    it('remains partial-period while retaining generation-aware operational simulation availability', () => {
      const partialData = createMockIntervalData(30); // 30 days
      const isSuitableForAnnual = false;
      const genConfig: GenerationConfig = {
        ...createDefaultGenerationConfig(),
        site: {
          latitude: 37.7749,
          longitude: -122.4194,
          timeZone: 'UTC',
          elevationM: 16,
        },
        assets: [
          {
            ...(createDefaultAsset('solar', 'solar-partial') as SolarGenerationAsset),
            dcCapacityKw: 5.0,
            inverterAcCapacityKw: 4.0,
            monthlyPeakSunHoursPerDay: [4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5, 4.5],
          },
        ],
      };

      // 1. Run simulation on partial data
      const unifiedResult = runUnifiedSimulation({
        dataPoints: partialData,
        intervalHours: 1,
        tiers: [...DEFAULT_RATE_TIERS],
        scheduleMatrix: createScheduleMatrix(),
        batteryProfile: profile,
        allowSolarExport: true,
        generationConfig: genConfig,
      });

      // Operational generation-aware simulation remains fully functional
      expect(unifiedResult.mode).toBe('generation-aware');
      expect(unifiedResult.generationAwareResult).toBeDefined();

      const opMetrics = deriveGenerationOperationalDisplayMetrics(unifiedResult.generationAwareResult!);
      expect(opMetrics.solarGeneratedKwh).toBeGreaterThan(0);
      expect(opMetrics.homeLoadKwh).toBeGreaterThan(0);

      // Operational projection should ONLY run if isSuitableForAnnual is true
      const shouldRunG4B = isSuitableForAnnual && genConfig.assets.some((a) => a.enabled);
      expect(shouldRunG4B).toBe(false);

      // Analysis state must strictly remain partial-period
      const state = deriveAnalysisState(isSuitableForAnnual, 'generation-aware', false);
      expect(state).toBe('partial-period');
      expect(state).not.toBe('generation-financial');
      expect(state).not.toBe('generation-financial-pending');
      expect(shouldCalculateGenerationAwareFinancials(state)).toBe(false);
    });
  });

  describe('6. Full-Year G4B and G4C Integration & Horizon Summaries', () => {
    it('executes full pipeline and provides authoritative horizon summaries for UI consumption', () => {
      const fullYearData = createMockIntervalData(365);
      const scheduleMatrix = createScheduleMatrix();
      const tiers = [...DEFAULT_RATE_TIERS];
      const genConfig: GenerationConfig = {
        ...createDefaultGenerationConfig(),
        site: {
          latitude: 37.7749,
          longitude: -122.4194,
          timeZone: 'UTC',
          elevationM: 16,
        },
        assets: [
          {
            ...(createDefaultAsset('solar', 'solar-main') as SolarGenerationAsset),
            dcCapacityKw: 6.0,
            inverterAcCapacityKw: 5.0,
            installedCostUsd: 12000,
            annualMaintenanceCostUsd: 150,
            monthlyPeakSunHoursPerDay: [4.5, 4.8, 5.2, 5.5, 5.8, 6.0, 6.0, 5.8, 5.4, 4.9, 4.5, 4.3],
          },
        ],
      };

      // 1. Run authoritative simulation
      const unifiedResult = runUnifiedSimulation({
        dataPoints: fullYearData,
        intervalHours: 1,
        tiers,
        scheduleMatrix,
        batteryProfile: profile,
        allowSolarExport: true,
        generationConfig: genConfig,
      });

      expect(unifiedResult.mode).toBe('generation-aware');
      expect(unifiedResult.generationAwareResult).toBeDefined();

      // 2. Project costs from G4A
      const projectCosts = aggregateGenerationProjectCosts(genConfig);
      expect(projectCosts.generationCapexUsd).toBeGreaterThan(0);
      expect(projectCosts.annualGenerationMaintenanceUsd).toBeGreaterThan(0);

      // 3. Operational projection from G4B (only for active profile)
      const operationalProjection = calculateGenerationOperationalProjection({
        dataPoints: fullYearData,
        intervalHours: 1,
        tiers,
        scheduleMatrix,
        batteryProfile: profile,
        generationConfig: genConfig,
        allowSolarExport: true,
        annualElectricityInflationRate: financials.annualElectricityInflationRate,
        annualBatteryDegradationRate: financials.annualBatteryDegradationRate,
      });

      expect(operationalProjection.horizonYears).toBe(25);
      expect(operationalProjection.years).toHaveLength(25);
      expect(operationalProjection.years[0].solarGeneratedKwh).toBeGreaterThan(0);

      // 4. Financial analysis from G4C
      const financialAnalysis = calculateGenerationAwareFinancials({
        batteryProfile: profile,
        operationalProjection,
        projectCosts,
        financials,
      });

      expect(financialAnalysis.grossProjectCapexUsd).toBe(
        financialAnalysis.batteryCapexUsd + financialAnalysis.generationCapexUsd
      );
      expect(financialAnalysis.projections).toHaveLength(25);
      expect(financialAnalysis.npvUsd).toBeDefined();
      expect(financialAnalysis.lifetimeNetProfitUsd).toBeDefined();
      expect(financialAnalysis.year1ElectricitySavingsUsd).toBeGreaterThan(0);

      // 5. Verify horizon slicing helper works across all standard UI preset horizons
      const presetHorizons = [5, 10, 15, 20, 25];
      for (const horizon of presetHorizons) {
        const horizonSummary = deriveGenerationHorizonFinancialSummary(financialAnalysis, horizon);
        expect(horizonSummary.horizonYears).toBe(horizon);
        expect(typeof horizonSummary.netPresentValue).toBe('number');
        expect(typeof horizonSummary.cumulativeCashFlow).toBe('number');
        expect(typeof horizonSummary.cumulativeElectricitySavings).toBe('number');
        expect(typeof horizonSummary.horizonRoiPercent).toBe('number');

        // Verify that cumulativeElectricitySavings matches the sum of projections up to horizon
        const expectedSavings = financialAnalysis.projections
          .slice(0, horizon)
          .reduce((sum, p) => sum + p.electricitySavingsUsd, 0);
        expect(Math.round(horizonSummary.cumulativeElectricitySavings)).toBe(Math.round(expectedSavings));
      }
    }, 60000);
  });

  describe('7. G5E — Wind & Combined Renewable Presentation Adapter', () => {
    it('1. sources solar-only metrics from authoritative fields and sets wind to zero', () => {
      const mockResult: GenerationAwareSimulationResult = {
        totalHomeLoadKwh: 8000,
        totalSolarGenerationKwh: 5000,
        totalSolarDirectToLoadKwh: 3000,
        totalSolarToBatteryKwh: 1000,
        totalSolarExportKwh: 800,
        totalSolarCurtailedKwh: 200,
        totalWindGenerationKwh: 0,
        totalWindDirectToLoadKwh: 0,
        totalWindToBatteryKwh: 0,
        totalWindExportKwh: 0,
        totalWindCurtailedKwh: 0,
        totalRenewableGenerationKwh: 5000,
        totalRenewableDirectToLoadKwh: 3000,
        totalRenewableToBatteryKwh: 1000,
        totalRenewableExportKwh: 800,
        totalRenewableCurtailedKwh: 200,
        totalGridImportKwh: 5000,
        totalBatteryExportKwh: 300,
        totalGridExportKwh: 1100,
        baselineCost: 2500,
        simulatedCost: 1200,
        netSavings: 1300,
      } as unknown as GenerationAwareSimulationResult;

      const metrics = deriveGenerationOperationalDisplayMetrics(mockResult);

      expect(metrics.solarGeneratedKwh).toBe(5000);
      expect(metrics.solarDirectToLoadKwh).toBe(3000);
      expect(metrics.solarToBatteryAcKwh).toBe(1000);
      expect(metrics.solarExportKwh).toBe(800);
      expect(metrics.solarCurtailedKwh).toBe(200);

      expect(metrics.windGeneratedKwh).toBe(0);
      expect(metrics.windDirectToLoadKwh).toBe(0);
      expect(metrics.windToBatteryAcKwh).toBe(0);
      expect(metrics.windExportKwh).toBe(0);
      expect(metrics.windCurtailedKwh).toBe(0);

      expect(metrics.renewableGeneratedKwh).toBe(5000);
      expect(metrics.batteryExportKwh).toBe(300);
      expect(metrics.gridExportKwh).toBe(1100);
    });

    it('2. extracts wind-only metrics from GenerationAwareSimulationResult', () => {
      const mockResult: GenerationAwareSimulationResult = {
        totalHomeLoadKwh: 9000,
        totalSolarGenerationKwh: 0,
        totalSolarDirectToLoadKwh: 0,
        totalSolarToBatteryKwh: 0,
        totalSolarExportKwh: 0,
        totalSolarCurtailedKwh: 0,
        totalWindGenerationKwh: 7000,
        totalWindDirectToLoadKwh: 4000,
        totalWindToBatteryKwh: 1500,
        totalWindExportKwh: 1200,
        totalWindCurtailedKwh: 300,
        totalRenewableGenerationKwh: 7000,
        totalRenewableDirectToLoadKwh: 4000,
        totalRenewableToBatteryKwh: 1500,
        totalRenewableExportKwh: 1200,
        totalRenewableCurtailedKwh: 300,
        totalGridImportKwh: 5000,
        totalBatteryExportKwh: 450,
        totalGridExportKwh: 1650,
        baselineCost: 3000,
        simulatedCost: 1400,
        netSavings: 1600,
      } as unknown as GenerationAwareSimulationResult;

      const metrics = deriveGenerationOperationalDisplayMetrics(mockResult);

      expect(metrics.windGeneratedKwh).toBe(7000);
      expect(metrics.windDirectToLoadKwh).toBe(4000);
      expect(metrics.windToBatteryAcKwh).toBe(1500);
      expect(metrics.windExportKwh).toBe(1200);
      expect(metrics.windCurtailedKwh).toBe(300);

      expect(metrics.solarGeneratedKwh).toBe(0);
      expect(metrics.renewableGeneratedKwh).toBe(7000);
      expect(metrics.batteryExportKwh).toBe(450);
      expect(metrics.gridExportKwh).toBe(1650);
    });

    it('3. accurately exposes both sources in mixed solar + wind configurations', () => {
      const mockResult: GenerationAwareSimulationResult = {
        totalHomeLoadKwh: 10000,
        totalSolarGenerationKwh: 4000,
        totalSolarDirectToLoadKwh: 2000,
        totalSolarToBatteryKwh: 800,
        totalSolarExportKwh: 1000,
        totalSolarCurtailedKwh: 200,
        totalWindGenerationKwh: 3000,
        totalWindDirectToLoadKwh: 1500,
        totalWindToBatteryKwh: 700,
        totalWindExportKwh: 600,
        totalWindCurtailedKwh: 200,
        totalRenewableGenerationKwh: 7000,
        totalRenewableDirectToLoadKwh: 3500,
        totalRenewableToBatteryKwh: 1500,
        totalRenewableExportKwh: 1600,
        totalRenewableCurtailedKwh: 400,
        totalGridImportKwh: 6500,
        totalBatteryExportKwh: 500,
        totalGridExportKwh: 2100,
        baselineCost: 3500,
        simulatedCost: 1500,
        netSavings: 2000,
      } as unknown as GenerationAwareSimulationResult;

      const metrics = deriveGenerationOperationalDisplayMetrics(mockResult);

      expect(metrics.solarGeneratedKwh).toBe(4000);
      expect(metrics.windGeneratedKwh).toBe(3000);
      expect(metrics.solarDirectToLoadKwh).toBe(2000);
      expect(metrics.windDirectToLoadKwh).toBe(1500);
      expect(metrics.solarToBatteryAcKwh).toBe(800);
      expect(metrics.windToBatteryAcKwh).toBe(700);
      expect(metrics.solarExportKwh).toBe(1000);
      expect(metrics.windExportKwh).toBe(600);
      expect(metrics.solarCurtailedKwh).toBe(200);
      expect(metrics.windCurtailedKwh).toBe(200);
    });

    it('4-8. presentation-level reconciliation verifies renewable totals equal authoritative sums', () => {
      const mockResult: GenerationAwareSimulationResult = {
        totalHomeLoadKwh: 12000,
        totalSolarGenerationKwh: 4500,
        totalSolarDirectToLoadKwh: 2200,
        totalSolarToBatteryKwh: 1100,
        totalSolarExportKwh: 900,
        totalSolarCurtailedKwh: 300,
        totalWindGenerationKwh: 3500,
        totalWindDirectToLoadKwh: 1800,
        totalWindToBatteryKwh: 900,
        totalWindExportKwh: 700,
        totalWindCurtailedKwh: 100,
        totalRenewableGenerationKwh: 8000,
        totalRenewableDirectToLoadKwh: 4000,
        totalRenewableToBatteryKwh: 2000,
        totalRenewableExportKwh: 1600,
        totalRenewableCurtailedKwh: 400,
        totalGridImportKwh: 8000,
        totalBatteryExportKwh: 600,
        totalGridExportKwh: 2200,
        baselineCost: 4000,
        simulatedCost: 2000,
        netSavings: 2000,
      } as unknown as GenerationAwareSimulationResult;

      const metrics = deriveGenerationOperationalDisplayMetrics(mockResult);

      // Invariants:
      expect(metrics.renewableGeneratedKwh).toBe(metrics.solarGeneratedKwh + metrics.windGeneratedKwh);
      expect(metrics.renewableDirectToLoadKwh).toBe(metrics.solarDirectToLoadKwh + metrics.windDirectToLoadKwh);
      expect(metrics.renewableToBatteryAcKwh).toBe(metrics.solarToBatteryAcKwh + metrics.windToBatteryAcKwh);
      expect(metrics.renewableExportKwh).toBe(metrics.solarExportKwh + metrics.windExportKwh);
      expect(metrics.renewableCurtailedKwh).toBe(metrics.solarCurtailedKwh + metrics.windCurtailedKwh);
    });

    it('9-10. keeps solar and wind export distinct from battery export and preserves total grid export', () => {
      const mockResult: GenerationAwareSimulationResult = {
        totalHomeLoadKwh: 10000,
        totalSolarGenerationKwh: 5000,
        totalSolarDirectToLoadKwh: 2500,
        totalSolarToBatteryKwh: 1000,
        totalSolarExportKwh: 1200,
        totalSolarCurtailedKwh: 300,
        totalWindGenerationKwh: 4000,
        totalWindDirectToLoadKwh: 2000,
        totalWindToBatteryKwh: 800,
        totalWindExportKwh: 1000,
        totalWindCurtailedKwh: 200,
        totalRenewableGenerationKwh: 9000,
        totalRenewableDirectToLoadKwh: 4500,
        totalRenewableToBatteryKwh: 1800,
        totalRenewableExportKwh: 2200,
        totalRenewableCurtailedKwh: 500,
        totalGridImportKwh: 5500,
        totalBatteryExportKwh: 400,
        totalGridExportKwh: 2600, // 1200 (solar) + 1000 (wind) + 400 (battery)
        baselineCost: 3200,
        simulatedCost: 1300,
        netSavings: 1900,
      } as unknown as GenerationAwareSimulationResult;

      const metrics = deriveGenerationOperationalDisplayMetrics(mockResult);

      expect(metrics.solarExportKwh).toBe(1200);
      expect(metrics.windExportKwh).toBe(1000);
      expect(metrics.batteryExportKwh).toBe(400);
      expect(metrics.gridExportKwh).toBe(2600);
      expect(metrics.solarExportKwh + metrics.windExportKwh + metrics.batteryExportKwh).toBe(metrics.gridExportKwh);
      expect(metrics.windExportKwh).not.toBe(metrics.batteryExportKwh);
      expect(metrics.solarExportKwh).not.toBe(metrics.batteryExportKwh);
    });

    it('11. presentation adapter directly consumes authoritative G5 aggregates without re-summing interval physics', () => {
      // Mock result with authoritative aggregates but without intervals attached
      const mockResult: GenerationAwareSimulationResult = {
        totalHomeLoadKwh: 11000,
        totalSolarGenerationKwh: 6000,
        totalSolarDirectToLoadKwh: 3000,
        totalSolarToBatteryKwh: 1400.45,
        totalSolarExportKwh: 1300,
        totalSolarCurtailedKwh: 300,
        totalWindGenerationKwh: 4500,
        totalWindDirectToLoadKwh: 2500,
        totalWindToBatteryKwh: 800.25,
        totalWindExportKwh: 900,
        totalWindCurtailedKwh: 300,
        totalRenewableGenerationKwh: 10500,
        totalRenewableDirectToLoadKwh: 5500,
        totalRenewableToBatteryKwh: 2200.70,
        totalRenewableExportKwh: 2200,
        totalRenewableCurtailedKwh: 600,
        totalGridImportKwh: 5500,
        totalBatteryExportKwh: 350,
        totalGridExportKwh: 2550,
        baselineCost: 3500,
        simulatedCost: 1500,
        netSavings: 2000,
      } as unknown as GenerationAwareSimulationResult;

      const metrics = deriveGenerationOperationalDisplayMetrics(mockResult);

      expect(metrics.solarToBatteryAcKwh).toBe(1400.45);
      expect(metrics.windToBatteryAcKwh).toBe(800.25);
      expect(metrics.renewableToBatteryAcKwh).toBe(2200.70);
    });
  });
});
