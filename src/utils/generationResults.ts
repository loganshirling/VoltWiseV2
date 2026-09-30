/**
 * Authoritative Generation Operational Results & Presentation Adapter (Milestone G4D)
 *
 * Exposes authoritative Year-1 / observed operational generation metrics for UI presentation
 * from GenerationAwareSimulationResult.
 *
 * Rules:
 * - Pure function; does not mutate source simulation results.
 * - UI is a consumer, not a calculator: aggregates or exposes existing authoritative output fields.
 * - Does not reproduce solar physics, battery dispatch, or tariff accounting.
 * - Keeps solar export and battery export distinct.
 */

import { GenerationAwareSimulationResult } from './generationAwareSimulation';
import { AnalysisState, SolarAssetMetadata } from '../types/energy';

export interface GenerationOperationalDisplayMetrics {
  // Authoritative operational energy flows (kWh)
  homeLoadKwh: number;
  solarGeneratedKwh: number;
  solarDirectToLoadKwh: number;
  solarToBatteryAcKwh: number;
  solarExportKwh: number;
  solarCurtailedKwh: number;
  gridImportKwh: number;
  gridExportKwh: number;
  batteryExportKwh: number;

  // Authoritative economic metrics (USD)
  baselineCostUsd: number;
  simulatedCostUsd: number;
  modeledProjectCostUsd: number;
  electricitySavingsUsd: number;

  // Structural aliases matching G3 aggregate field names
  totalHomeLoadKwh: number;
  totalSolarGenerationKwh: number;
  totalSolarDirectToLoadKwh: number;
  totalSolarToBatteryAcKwh: number;
  totalSolarToBatteryKwh: number;
  solarToBatteryKwh: number;
  solarDirectConsumptionKwh: number;
  totalSolarExportKwh: number;
  totalSolarCurtailedKwh: number;
  totalCurtailedSolarKwh: number;
  curtailedSolarKwh: number;
  totalGridImportKwh: number;
  totalGridExportKwh: number;
  totalBatteryExportKwh: number;
  baselineCost: number;
  simulatedCost: number;
  netSavings: number;
  netSavingsUsd: number;
}

/**
 * Extracts and adapts authoritative operational presentation metrics from a GenerationAwareSimulationResult.
 *
 * Invariant: Sums authoritative interval values for solar-to-battery AC without modifying physics.
 * Strictly adheres to GenerationAwareSimulationResult contract; returns 0 if intervals are absent
 * and never reads undeclared fallback properties.
 */
export function deriveGenerationOperationalDisplayMetrics(
  result: GenerationAwareSimulationResult
): GenerationOperationalDisplayMetrics {
  if (!result || typeof result !== 'object') {
    throw new Error('A valid GenerationAwareSimulationResult must be provided.');
  }

  // Sum authoritative solarToBatteryAcKwh strictly from preExportFlow intervals.
  // If intervals are absent, defaults to 0 with no ad-hoc fallback properties.
  let totalSolarToBatteryAcKwh = 0;
  if (result.exportAwareBatteryFlow?.intervals && Array.isArray(result.exportAwareBatteryFlow.intervals)) {
    for (let i = 0; i < result.exportAwareBatteryFlow.intervals.length; i++) {
      const interval = result.exportAwareBatteryFlow.intervals[i];
      if (interval?.preExportFlow) {
        totalSolarToBatteryAcKwh += interval.preExportFlow.solarToBatteryAcKwh ?? 0;
      }
    }
  }

  const solarToBatteryAc = Math.round(totalSolarToBatteryAcKwh * 100) / 100;
  const solarCurtailed = result.gridFlows?.totalCurtailedSolarKwh ?? 0;

  return {
    homeLoadKwh: result.totalHomeLoadKwh,
    solarGeneratedKwh: result.totalSolarGenerationKwh,
    solarDirectToLoadKwh: result.totalSolarDirectToLoadKwh,
    solarToBatteryAcKwh: solarToBatteryAc,
    solarExportKwh: result.totalSolarExportKwh,
    solarCurtailedKwh: solarCurtailed,
    gridImportKwh: result.totalGridImportKwh,
    gridExportKwh: result.totalGridExportKwh,
    batteryExportKwh: result.totalBatteryExportKwh,
    baselineCostUsd: result.baselineCost,
    simulatedCostUsd: result.simulatedCost,
    modeledProjectCostUsd: result.simulatedCost,
    electricitySavingsUsd: result.netSavings,

    // Aliases
    totalHomeLoadKwh: result.totalHomeLoadKwh,
    totalSolarGenerationKwh: result.totalSolarGenerationKwh,
    totalSolarDirectToLoadKwh: result.totalSolarDirectToLoadKwh,
    totalSolarToBatteryAcKwh: solarToBatteryAc,
    totalSolarToBatteryKwh: solarToBatteryAc,
    solarToBatteryKwh: solarToBatteryAc,
    solarDirectConsumptionKwh: result.totalSolarDirectToLoadKwh,
    totalSolarExportKwh: result.totalSolarExportKwh,
    totalSolarCurtailedKwh: solarCurtailed,
    totalCurtailedSolarKwh: solarCurtailed,
    curtailedSolarKwh: solarCurtailed,
    totalGridImportKwh: result.totalGridImportKwh,
    totalGridExportKwh: result.totalGridExportKwh,
    totalBatteryExportKwh: result.totalBatteryExportKwh,
    baselineCost: result.baselineCost,
    simulatedCost: result.simulatedCost,
    netSavings: result.netSavings,
    netSavingsUsd: result.netSavings,
  };
}

/** Formats kWh with thousands separators */
export function formatKwh(value: number): string {
  if (value == null || isNaN(value)) return '0 kWh';
  return `${Math.round(value).toLocaleString()} kWh`;
}

/** Formats USD with thousands separators and optional negative indicator */
export function formatUsd(value: number, decimals: number = 0): string {
  if (value == null || isNaN(value)) return '$0';
  const isNeg = value < 0;
  const absVal = Math.abs(value);
  const formatted = decimals > 0
    ? absVal.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals })
    : Math.round(absVal).toLocaleString();
  return isNeg ? `-$${formatted}` : `$${formatted}`;
}

/** Formats percentage with 1 decimal place */
export function formatPercent(value: number | null | undefined): string {
  if (value == null || isNaN(value)) return 'N/A';
  return `${value.toFixed(1)}%`;
}

/** Determines if generation-aware lifecycle financial engine should be called */
export function shouldCalculateGenerationAwareFinancials(analysisState: string): boolean {
  return analysisState === 'generation-financial' || analysisState === 'generation-financial-pending';
}

export type MultiProfileMatrixMode =
  | 'legacy'
  | 'generation-financial'
  | 'generation-financial-pending'
  | 'partial-period';

/**
 * Resolves the presentation mode for the multi-profile matrix section.
 * Explicitly distinguishes legacy-financial, generation-financial,
 * generation-financial-pending, and partial-period.
 */
export function resolveMultiProfileMatrixState(
  analysisState: AnalysisState | string
): MultiProfileMatrixMode {
  if (analysisState === 'generation-financial') {
    return 'generation-financial';
  }
  if (analysisState === 'generation-financial-pending') {
    return 'generation-financial-pending';
  }
  if (analysisState === 'partial-period') {
    return 'partial-period';
  }
  return 'legacy';
}

/**
 * Formats solar degradation display description for single or multi-array configurations.
 * Prevents presenting a single array's degradation rate as a fleet-wide value.
 */
export function formatSolarDegradationSummary(
  solarMetadata?: Array<Partial<SolarAssetMetadata>> | null
): string {
  if (!solarMetadata || solarMetadata.length === 0) {
    return 'Solar degradation: 0.5%/yr';
  }
  if (solarMetadata.length === 1) {
    const rate = solarMetadata[0].annualDegradationPercent ?? 0.5;
    return `Solar degradation: ${rate}%/yr`;
  }
  const byArray = solarMetadata
    .map((m) => `${m.name || 'Array'} ${m.annualDegradationPercent ?? 0.5}%/yr`)
    .join(' · ');
  return `Solar degradation by array: ${byArray}`;
}

/**
 * Formats solar degradation clause for inline sentence presentation.
 */
export function formatSolarDegradationClause(
  solarMetadata?: Array<Partial<SolarAssetMetadata>> | null
): string {
  if (!solarMetadata || solarMetadata.length === 0) {
    return 'solar DC degradation (0.5%/yr)';
  }
  if (solarMetadata.length === 1) {
    const rate = solarMetadata[0].annualDegradationPercent ?? 0.5;
    return `solar DC degradation (${rate}%/yr)`;
  }
  const byArray = solarMetadata
    .map((m) => `${m.name || 'Array'} ${m.annualDegradationPercent ?? 0.5}%/yr`)
    .join(' · ');
  return `per-array solar DC degradation (${byArray})`;
}
