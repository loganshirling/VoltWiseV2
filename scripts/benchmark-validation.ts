import type {
  GenerationConfig,
  GenerationOperationalYear,
  IntervalDataPoint,
  SolarGenerationAsset,
  WindGenerationAsset,
} from '../src/types/energy';
import { alignLoadTimestampsToSite } from '../src/utils/loadTimeAlignment';
import type { SimulationJobInput, SimulationJobResult } from '../src/utils/simulationWorkerJob';

const REQUIRED_OPERATIONAL_VALUES: (keyof GenerationOperationalYear)[] = [
  'baselineElectricityCostUsd', 'simulatedElectricityCostUsd', 'electricitySavingsUsd',
  'solarGeneratedKwh', 'solarDirectToLoadKwh', 'solarToBatteryKwh', 'solarExportKwh', 'solarCurtailedKwh',
  'windGeneratedKwh', 'windDirectToLoadKwh', 'windToBatteryKwh', 'windExportKwh', 'windCurtailedKwh',
  'renewableGeneratedKwh', 'renewableDirectToLoadKwh', 'renewableToBatteryKwh', 'renewableExportKwh', 'renewableCurtailedKwh',
  'gridImportKwh', 'gridExportKwh', 'batteryExportKwh', 'batteryDischargedKwh', 'equivalentFullCycles',
  'batteryCapacityRetentionFactor', 'batteryUsableCapacityKwh',
];

const REQUIRED_FINANCIAL_VALUES = [
  'batteryCapexUsd', 'generationCapexUsd', 'grossProjectCapexUsd', 'immediateRebateUsd',
  'deferredFederalTaxCreditUsd', 'incentivesAmountUsd', 'netInstalledProjectCostUsd',
  'upfrontOutOfPocketUsd', 'loanPrincipalUsd', 'monthlyLoanPaymentUsd', 'totalLoanPaymentsUsd',
  'totalLoanInterestUsd', 'annualGenerationMaintenanceUsd', 'year1ElectricitySavingsUsd',
  'year1NetProjectCashFlowUsd', 'npvUsd', 'lifetimeNetProfitUsd', 'lifetimeRoiPercent',
  'totalProjectCashOutlaysUsd', 'opportunityCostFutureValueUsd', 'opportunityCostProfitUsd',
  'opportunityCostDiffUsd',
];

function objectValue(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${label} is missing or invalid.`);
  }
  return value as Record<string, unknown>;
}

function arrayValue(value: unknown, label: string): unknown[] {
  if (!Array.isArray(value)) throw new Error(`${label} is missing or invalid.`);
  return value;
}

function requireFinite(record: Record<string, unknown>, key: string, label: string): number {
  const value = record[key];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new Error(`${label}.${key} must be finite.`);
  }
  return value;
}

function validateGenerationProjection(
  projectionValue: unknown,
  analysisValue: unknown,
  scenario: string
): void {
  if (projectionValue === null || typeof projectionValue !== 'object') {
    throw new Error('generation projection is missing or invalid.');
  }
  // The authoritative projection is an array with horizonYears and years properties.
  const projection = projectionValue as Record<string, unknown>;
  if (projection.horizonYears !== 25) throw new Error('generation projection horizon must be 25 years.');
  const years = arrayValue(projection.years, 'generation projection years');
  if (years.length !== 25) throw new Error(`generation projection must contain exactly 25 years; found ${years.length}.`);

  let solarTotal = 0;
  let windTotal = 0;
  years.forEach((yearValue, index) => {
    const year = objectValue(yearValue, `generation projection year ${index + 1}`);
    if (year.year !== index + 1) throw new Error(`generation projection year indices must be contiguous 1–25; found ${String(year.year)} at position ${index + 1}.`);
    for (const key of REQUIRED_OPERATIONAL_VALUES) {
      const value = requireFinite(year, key, `generation projection year ${index + 1}`);
      if (key === 'solarGeneratedKwh') solarTotal += value;
      if (key === 'windGeneratedKwh') windTotal += value;
    }
    for (const key of ['generatorGeneratedKwh', 'generatorRuntimeHours', 'generatorStarts', 'generatorFuelCostUsd', 'generatorVariableMaintenanceCostUsd', 'generatorOperatingCostUsd']) {
      if (year[key] !== undefined) requireFinite(year, key, `generation projection year ${index + 1}`);
    }
  });

  const analysis = objectValue(analysisValue, 'generation financial analysis');
  if (analysis.horizonYears !== 25) throw new Error('generation financial analysis horizon must be 25 years.');
  for (const key of REQUIRED_FINANCIAL_VALUES) requireFinite(analysis, key, 'generation financial analysis');
  for (const key of ['paybackYears', 'irrPercent']) {
    const value = analysis[key];
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) {
      throw new Error(`generation financial analysis.${key} must be finite or null.`);
    }
  }
  const financialYears = arrayValue(analysis.projections, 'generation financial analysis projections');
  if (financialYears.length !== 25) throw new Error(`generation financial analysis must contain exactly 25 projected years; found ${financialYears.length}.`);
  financialYears.forEach((yearValue, index) => {
    const year = objectValue(yearValue, `generation financial year ${index + 1}`);
    if (year.year !== index + 1) throw new Error(`generation financial year indices must be contiguous 1–25; found ${String(year.year)} at position ${index + 1}.`);
    for (const key of ['baselineElectricityCostUsd', 'modeledProjectElectricityCostUsd', 'electricitySavingsUsd', 'generationMaintenanceUsd', 'replacementExpenseUsd', 'annualLoanPaymentUsd', 'taxCreditInflowUsd', 'netProjectCashFlowUsd', 'cumulativeCashFlowUsd', 'discountedCashFlowUsd', 'cumulativeNpvUsd', 'opportunityCostValueUsd']) {
      requireFinite(year, key, `generation financial year ${index + 1}`);
    }
  });

  if (scenario === 'generation-25y-leap-mixed' && (!(solarTotal > 0) || !(windTotal > 0))) {
    throw new Error(`maximum mixed scenario must model nonzero solar and wind generation (solar=${solarTotal}, wind=${windTotal}).`);
  }
}

function validateAnnualSummary(value: unknown): void {
  const summary = objectValue(value, 'active unified annual summary');
  for (const key of ['totalIntervals', 'intervalHours', 'totalHomeLoadKwh', 'baselineAnnualCost', 'simulatedAnnualCost', 'year1Savings', 'savingsPercentage', 'annualGridImportKwh', 'annualGridExportKwh', 'annualBatteryDischargedKwh', 'equivalentFullCycles', 'maxPeakDemandKw']) {
    requireFinite(summary, key, 'active unified annual summary');
  }
}

function validateMaximumMeasuredFixture(
  input: Pick<SimulationJobInput, 'dataPoints' | 'intervalHours' | 'generationConfig'>,
  alignedValue?: unknown
): void {
  const { dataPoints, intervalHours, generationConfig } = input;
  const expectedCount = 35_136;
  const expectedTimestamp = (index: number) => new Date(Date.UTC(2024, 0, 1) + index * 15 * 60_000).toISOString();
  if (intervalHours !== 0.25 || dataPoints.length !== expectedCount) {
    throw new Error(`maximum mixed fixture must contain 35,136 quarter-hour intervals; found ${dataPoints.length} at ${intervalHours} hours.`);
  }
  dataPoints.forEach((point, index) => {
    const expected = expectedTimestamp(index);
    const expectedLocalText = `${expected.slice(0, 10)} ${expected.slice(11, 16)}`;
    if (!(point.date instanceof Date) || !Number.isFinite(point.date.getTime()) || point.date.toISOString() !== expected || point.timestamp !== expectedLocalText) {
      throw new Error(`maximum mixed load timestamps must exactly cover UTC 2024 at interval ${index}.`);
    }
  });
  if (generationConfig.site.timeZone !== 'UTC') throw new Error('maximum mixed fixture site timezone must be UTC.');
  const solar = generationConfig.assets.find(
    (asset): asset is SolarGenerationAsset => asset.type === 'solar' && asset.enabled
  );
  const wind = generationConfig.assets.find(
    (asset): asset is WindGenerationAsset => asset.type === 'wind' && asset.enabled
  );
  if (!solar || solar.resourceMode !== 'weather_file' || !solar.externalResourceId) throw new Error('maximum mixed fixture requires enabled measured solar.');
  if (!wind || wind.resourceMode !== 'interval_file' || !wind.externalResourceId) throw new Error('maximum mixed fixture requires enabled measured wind.');
  const resources = generationConfig.externalResources ?? [];
  const solarResource = resources.find((resource) => resource.id === solar.externalResourceId && resource.kind === 'solar_irradiance');
  const windResource = resources.find((resource) => resource.id === wind.externalResourceId && resource.kind === 'wind_speed');
  if (!solarResource || !windResource) throw new Error('maximum mixed fixture is missing aligned measured solar or wind records.');
  for (const [label, resource] of [['solar', solarResource], ['wind', windResource]] as const) {
    if (resource.sourceTimeZone !== 'UTC' || resource.intervalHours !== 0.25 || resource.rowCount !== expectedCount || resource.records.length !== expectedCount) {
      throw new Error(`maximum mixed ${label} resource metadata must describe the full UTC 2024 leap-year interval series.`);
    }
    if (resource.startTimestampUtc !== expectedTimestamp(0) || resource.endTimestampUtc !== expectedTimestamp(expectedCount - 1)) {
      throw new Error(`maximum mixed ${label} resource endpoints must exactly span UTC 2024.`);
    }
    resource.records.forEach((record, index) => {
      if (record.timestampUtc !== expectedTimestamp(index)) throw new Error(`maximum mixed ${label} timestamps are not exactly aligned at interval ${index}.`);
    });
  }
  if (alignedValue !== undefined) {
    const aligned = arrayValue(alignedValue, 'active unified aligned timestamps');
    if (aligned.length !== expectedCount) throw new Error(`active unified result aligned ${aligned.length} timestamps; expected ${expectedCount}.`);
    aligned.forEach((entry, index) => {
      const row = objectValue(entry, `active unified aligned timestamp ${index}`);
      if (row.timestampUtc !== expectedTimestamp(index)) throw new Error(`active unified timestamps do not align with measured resources at interval ${index}.`);
    });
  }
}

export function validateWorkerBaseResult(resultValue: unknown, scenario: string): void {
  const result = objectValue(resultValue, 'simulation job result');
  if (result.simulationError !== null) throw new Error(`simulationError: ${String(result.simulationError ?? 'missing error state')}`);
  if (result.generationProjectionError !== null) throw new Error(`generationProjectionError: ${String(result.generationProjectionError ?? 'missing error state')}`);
  if (result.generationFinancialError !== null) throw new Error(`generationFinancialError: ${String(result.generationFinancialError ?? 'missing error state')}`);
  const active = objectValue(result.activeUnifiedResult, 'active unified result');
  const isGenerationScenario = scenario.startsWith('generation-25y');
  const expectedMode = isGenerationScenario ? 'generation-aware' : 'legacy';
  if (active.mode !== expectedMode) throw new Error(`expected active unified mode '${expectedMode}', found '${String(active.mode)}'.`);
  validateAnnualSummary(active.annualSummary);
  if (isGenerationScenario && !active.generationAwareResult) {
    throw new Error('active unified result is missing its generation-aware operational result.');
  }
}

export function validateWorkerBenchmarkResult(
  resultValue: unknown,
  scenario: string,
  input?: Pick<SimulationJobInput, 'dataPoints' | 'intervalHours' | 'generationConfig'>
): void {
  validateWorkerBaseResult(resultValue, scenario);
  const result = objectValue(resultValue, 'simulation job result');
  const active = objectValue(result.activeUnifiedResult, 'active unified result');
  const isGenerationScenario = scenario.startsWith('generation-25y');
  if (isGenerationScenario) {
    if (!result.activeGenerationOperationalProjection) throw new Error('active generation projection is missing; expected 25 projected years.');
    if (!result.activeGenerationAnalysis) throw new Error('generation financial analysis is missing.');
    validateGenerationProjection(result.activeGenerationOperationalProjection, result.activeGenerationAnalysis, scenario);
    if (scenario === 'generation-25y-leap-mixed') {
      if (!input) throw new Error('maximum mixed scenario validation requires its input fixture.');
      const generationResult = objectValue(active.generationAwareResult, 'active generation-aware result');
      validateMaximumMeasuredFixture(input, generationResult.alignedTimestamps);
    }
  } else if (result.activeGenerationOperationalProjection !== null || result.activeGenerationAnalysis !== null) {
    throw new Error('legacy scenario unexpectedly returned generation projection outputs.');
  }
}

export function validateLegacyUnifiedResult(resultValue: unknown): void {
  const result = objectValue(resultValue, 'legacy unified result');
  if (result.mode !== 'legacy') throw new Error(`expected active unified mode 'legacy', found '${String(result.mode)}'.`);
  validateAnnualSummary(result.annualSummary);
}

export function validateDirectGenerationBenchmarkResult(
  projection: unknown,
  analysis: unknown,
  scenario: string,
  input: Pick<SimulationJobInput, 'dataPoints' | 'intervalHours' | 'generationConfig'>
): void {
  if (scenario === 'generation-25y-leap-mixed') {
    const aligned = alignLoadTimestampsToSite(input.dataPoints, input.intervalHours, input.generationConfig.site.timeZone);
    validateMaximumMeasuredFixture(input, aligned);
  }
  validateGenerationProjection(projection, analysis, scenario);
}
