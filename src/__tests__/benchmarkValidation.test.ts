import { describe, expect, it } from 'vitest';
import { createDefaultGenerationConfig } from '../../src/utils/generationDefaults';
import { validateDirectGenerationBenchmarkResult, validateWorkerBenchmarkResult } from '../../scripts/benchmark-validation';

const annualSummary = {
  totalIntervals: 8760,
  intervalHours: 1,
  totalHomeLoadKwh: 8760,
  baselineAnnualCost: 1200,
  simulatedAnnualCost: 900,
  year1Savings: 300,
  savingsPercentage: 25,
  annualGridImportKwh: 8000,
  annualGridExportKwh: 0,
  annualBatteryDischargedKwh: 100,
  equivalentFullCycles: 100,
  maxPeakDemandKw: 2,
};

const operationalYear = (year: number, solarGeneratedKwh = 100, windGeneratedKwh = 100) => ({
  year,
  baselineElectricityCostUsd: 1200,
  simulatedElectricityCostUsd: 900,
  electricitySavingsUsd: 300,
  solarGeneratedKwh,
  solarDirectToLoadKwh: 90,
  solarToBatteryKwh: 5,
  solarExportKwh: 5,
  solarCurtailedKwh: 0,
  windGeneratedKwh,
  windDirectToLoadKwh: 90,
  windToBatteryKwh: 5,
  windExportKwh: 5,
  windCurtailedKwh: 0,
  renewableGeneratedKwh: solarGeneratedKwh + windGeneratedKwh,
  renewableDirectToLoadKwh: 180,
  renewableToBatteryKwh: 10,
  renewableExportKwh: 10,
  renewableCurtailedKwh: 0,
  gridImportKwh: 8000,
  gridExportKwh: 10,
  batteryExportKwh: 0,
  batteryDischargedKwh: 100,
  equivalentFullCycles: 100,
  batteryCapacityRetentionFactor: 0.99,
  batteryUsableCapacityKwh: 9.9,
  solarAssets: [],
});

const operationalYears = (solar = 100, wind = 100) =>
  Array.from({ length: 25 }, (_, index) => operationalYear(index + 1, solar, wind));

const hybridProjection = (years: unknown[] = operationalYears()) =>
  Object.assign([...years], { horizonYears: 25, years });

const financialYear = (year: number) => ({
  year,
  baselineElectricityCostUsd: 1200,
  modeledProjectElectricityCostUsd: 900,
  electricitySavingsUsd: 300,
  generationMaintenanceUsd: 10,
  replacementExpenseUsd: 0,
  annualLoanPaymentUsd: 0,
  taxCreditInflowUsd: 0,
  netProjectCashFlowUsd: 290,
  cumulativeCashFlowUsd: 290 * year,
  discountedCashFlowUsd: 200,
  cumulativeNpvUsd: 200 * year,
  opportunityCostValueUsd: 100 * year,
});

const generationResult = (options: {
  years?: unknown[];
  financialYears?: unknown[];
  solar?: number;
  wind?: number;
  mode?: string;
  projectionError?: string | null;
  financialError?: string | null;
  projection?: unknown;
  analysis?: unknown;
} = {}) => ({
  activeUnifiedResult: {
    mode: options.mode ?? 'generation-aware',
    annualSummary,
    generationAwareResult: {},
  },
  allSimulationSummaries: {},
  allAnalyses: [],
  simulationError: null,
  activeGenerationOperationalProjection: options.projection === undefined
    ? hybridProjection(options.years ?? operationalYears(options.solar, options.wind))
    : options.projection,
  generationProjectionError: options.projectionError ?? null,
  activeGenerationAnalysis: options.analysis === undefined
    ? {
        horizonYears: 25,
        batteryCapexUsd: 100,
        generationCapexUsd: 100,
        grossProjectCapexUsd: 200,
        immediateRebateUsd: 0,
        deferredFederalTaxCreditUsd: 0,
        incentivesAmountUsd: 0,
        netInstalledProjectCostUsd: 200,
        upfrontOutOfPocketUsd: 200,
        loanPrincipalUsd: 0,
        monthlyLoanPaymentUsd: 0,
        totalLoanPaymentsUsd: 0,
        totalLoanInterestUsd: 0,
        annualGenerationMaintenanceUsd: 10,
        year1ElectricitySavingsUsd: 300,
        year1NetProjectCashFlowUsd: 290,
        npvUsd: 1000,
        lifetimeNetProfitUsd: 5000,
        lifetimeRoiPercent: 250,
        totalProjectCashOutlaysUsd: 200,
        opportunityCostFutureValueUsd: 1000,
        opportunityCostProfitUsd: 800,
        opportunityCostDiffUsd: 4200,
        paybackYears: 2,
        irrPercent: null,
        projections: options.financialYears ?? Array.from({ length: 25 }, (_, index) => financialYear(index + 1)),
      }
    : options.analysis,
  generationFinancialError: options.financialError ?? null,
});

describe('benchmark result validation', () => {
  it('accepts a valid legacy simulation result', () => {
    expect(() => validateWorkerBenchmarkResult({
      activeUnifiedResult: { mode: 'legacy', annualSummary },
      simulationError: null,
      generationProjectionError: null,
      generationFinancialError: null,
      activeGenerationOperationalProjection: null,
      activeGenerationAnalysis: null,
    }, '8760-single')).not.toThrow();
  });

  it('accepts the authoritative hybrid array/object projection on the worker path', () => {
    expect(Array.isArray(generationResult().activeGenerationOperationalProjection)).toBe(true);
    expect(() => validateWorkerBenchmarkResult(generationResult(), 'generation-25y-mixed')).not.toThrow();
  });

  it('accepts the authoritative hybrid array/object projection on the direct path', () => {
    const result = generationResult();
    expect(() => validateDirectGenerationBenchmarkResult(
      hybridProjection(),
      result.activeGenerationAnalysis,
      'generation-25y',
      { dataPoints: [], intervalHours: 1, generationConfig: createDefaultGenerationConfig() }
    )).not.toThrow();
  });

  it('rejects simulation errors', () => {
    expect(() => validateWorkerBenchmarkResult({ ...generationResult(), simulationError: 'failed' }, 'generation-25y-mixed'))
      .toThrow(/simulationError: failed/);
  });

  it('rejects missing or incorrect generation-aware mode', () => {
    expect(() => validateWorkerBenchmarkResult(generationResult({ mode: 'legacy' }), 'generation-25y-mixed'))
      .toThrow(/expected active unified mode 'generation-aware'/);
    const missingMode = generationResult();
    delete (missingMode.activeUnifiedResult as { mode?: string }).mode;
    expect(() => validateWorkerBenchmarkResult(missingMode, 'generation-25y-mixed'))
      .toThrow(/expected active unified mode 'generation-aware'/);
  });

  it('rejects missing projections and projections with fewer than 25 years', () => {
    expect(() => validateWorkerBenchmarkResult(generationResult({ projection: null }), 'generation-25y-mixed'))
      .toThrow(/generation projection is missing/);
    expect(() => validateWorkerBenchmarkResult(generationResult({ years: Array.from({ length: 24 }, (_, index) => operationalYear(index + 1)) }), 'generation-25y-mixed'))
      .toThrow(/exactly 25 years/);
  });

  it('rejects duplicate and noncontiguous projection years', () => {
    const duplicate = Array.from({ length: 25 }, (_, index) => operationalYear(index + 1));
    duplicate[3] = operationalYear(3);
    expect(() => validateWorkerBenchmarkResult(generationResult({ years: duplicate }), 'generation-25y-mixed'))
      .toThrow(/contiguous 1–25/);
    const gap = Array.from({ length: 25 }, (_, index) => operationalYear(index + 1));
    gap[4] = operationalYear(9);
    expect(() => validateWorkerBenchmarkResult(generationResult({ years: gap }), 'generation-25y-mixed'))
      .toThrow(/contiguous 1–25/);
  });

  it('rejects nonfinite required operational values', () => {
    const years = Array.from({ length: 25 }, (_, index) => operationalYear(index + 1));
    years[0].gridImportKwh = Number.NaN;
    expect(() => validateWorkerBenchmarkResult(generationResult({ years }), 'generation-25y-mixed'))
      .toThrow(/gridImportKwh must be finite/);
  });

  it('rejects generation projection and financial errors', () => {
    expect(() => validateWorkerBenchmarkResult(generationResult({ projectionError: 'projection failed' }), 'generation-25y-mixed'))
      .toThrow(/generationProjectionError: projection failed/);
    expect(() => validateWorkerBenchmarkResult(generationResult({ financialError: 'finance failed' }), 'generation-25y-mixed'))
      .toThrow(/generationFinancialError: finance failed/);
  });

  it('rejects missing or nonfinite financial outputs', () => {
    expect(() => validateWorkerBenchmarkResult(generationResult({ analysis: null }), 'generation-25y-mixed'))
      .toThrow(/generation financial analysis is missing/);
    const analysis = generationResult().activeGenerationAnalysis as { npvUsd: number };
    analysis.npvUsd = Number.POSITIVE_INFINITY;
    expect(() => validateWorkerBenchmarkResult(generationResult({ analysis }), 'generation-25y-mixed'))
      .toThrow(/npvUsd must be finite/);
  });

  it('rejects zero solar or wind generation in the maximum mixed scenario', () => {
    expect(() => validateWorkerBenchmarkResult(generationResult({ solar: 0 }), 'generation-25y-leap-mixed'))
      .toThrow(/must model nonzero solar and wind/);
    expect(() => validateWorkerBenchmarkResult(generationResult({ wind: 0 }), 'generation-25y-leap-mixed'))
      .toThrow(/must model nonzero solar and wind/);
  });
});
