import {
  AnnualSimulationSummary,
  BatteryProfile,
  GenerationConfig,
  GenerationFinancialAnalysis,
  GenerationOperationalYear,
  MacroFinancials,
  ProfileFinancialAnalysis,
  RateTier,
  TouSeason,
} from '../types/energy';
import { calculate15YearFinancials } from './simulationEngine';
import { runUnifiedSimulation, UnifiedSimulationResult } from './simulationRouter';
import {
  aggregateGenerationProjectCosts,
  calculateGenerationAwareFinancials,
  shouldCalculateLegacyFinancials,
} from './generationFinancials';
import { calculateGenerationOperationalProjection } from './generationProjection';
import { MAX_INTERVALS_PER_DATASET } from './importLimits';

export interface SimulationJobInput {
  dataPoints: import('../types/energy').IntervalDataPoint[];
  intervalHours: number;
  profiles: BatteryProfile[];
  activeProfileId: string;
  tiers: RateTier[];
  scheduleMatrix: string[][];
  seasons?: TouSeason[];
  generationConfig: GenerationConfig;
  allowSolarExport: boolean;
  annualProjectionEligible: boolean;
  preflightError: string | null;
  financials: MacroFinancials;
}

export interface SimulationJobResult {
  activeUnifiedResult: UnifiedSimulationResult | null;
  allSimulationSummaries: Record<string, AnnualSimulationSummary>;
  allAnalyses: ProfileFinancialAnalysis[];
  simulationError: string | null;
  activeGenerationOperationalProjection: ReturnType<typeof calculateGenerationOperationalProjection> | null;
  generationProjectionError: string | null;
  activeGenerationAnalysis: GenerationFinancialAnalysis | null;
  generationFinancialError: string | null;
}

/**
 * Returns the financial-input portion of the simulation effect key, excluding
 * the three VOLL companion assumptions that can be recalculated from completed
 * operational output.
 */
export function getNonVollFinancialDependencyKey(financials: MacroFinancials): string {
  return JSON.stringify([
    financials.federalTaxCreditPercent,
    financials.federalTaxCreditRealizationYear,
    financials.localRebateFlat,
    financials.annualElectricityInflationRate,
    financials.annualBatteryDegradationRate,
    financials.discountRatePercent,
    financials.opportunityCostVehicle,
    financials.opportunityCostRatePercent,
    financials.replacementEnabled,
    financials.replacementCost,
    financials.replacementYear,
    financials.isFinanced,
    financials.loanAprPercent,
    financials.loanTermYears,
    financials.loanDownPaymentPercent,
    financials.criticalLoadPowerKw,
  ]);
}

/** Recalculates financial analyses from compatible completed operational results. */
export function recalculateSimulationJobFinancials(
  result: SimulationJobResult,
  input: SimulationJobInput,
  financials: MacroFinancials
): SimulationJobResult {
  const allAnalyses = result.allAnalyses.flatMap((analysis) => {
    const profile = input.profiles.find((candidate) => candidate.id === analysis.profile.id);
    const summary = result.allSimulationSummaries[analysis.profile.id];
    return profile && summary ? [calculate15YearFinancials(profile, summary, financials)] : [];
  });

  let activeGenerationAnalysis: GenerationFinancialAnalysis | null = null;
  let generationFinancialError: string | null = null;
  if (
    result.activeUnifiedResult?.mode === 'generation-aware' &&
    result.activeGenerationOperationalProjection
  ) {
    try {
      activeGenerationAnalysis = calculateGenerationAwareFinancials({
        batteryProfile: input.profiles.find((profile) => profile.id === input.activeProfileId) ?? input.profiles[0],
        operationalProjection: result.activeGenerationOperationalProjection,
        projectCosts: aggregateGenerationProjectCosts(input.generationConfig),
        financials,
      });
    } catch (error) {
      generationFinancialError = errorMessage(error, 'Failed to calculate generation financial lifecycle analysis.');
    }
  }

  return {
    ...result,
    allAnalyses,
    activeGenerationAnalysis,
    generationFinancialError,
  };
}

export interface SimulationWorkerRunMessage {
  type: 'run';
  requestId: number;
  input: SimulationJobInput;
}

export interface SimulationWorkerProjectionYearMessage {
  type: 'projection-year';
  requestId: number;
  input: SimulationJobInput;
  year: number;
}

export type SimulationWorkerRequestMessage = SimulationWorkerRunMessage | SimulationWorkerProjectionYearMessage;

export type SimulationWorkerResponseMessage =
  | { type: 'progress'; requestId: number; percent: number; stage: string }
  | { type: 'success'; requestId: number; result: SimulationJobResult }
  | { type: 'projection-year'; requestId: number; year: GenerationOperationalYear }
  | { type: 'error'; requestId: number; message: string };

const emptyResult = (): SimulationJobResult => ({
  activeUnifiedResult: null,
  allSimulationSummaries: {},
  allAnalyses: [],
  simulationError: null,
  activeGenerationOperationalProjection: null,
  generationProjectionError: null,
  activeGenerationAnalysis: null,
  generationFinancialError: null,
});

function errorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error) return error.message;
  return typeof error === 'string' ? error : fallback;
}

/** Runs the existing authoritative engines and retains full interval detail only for the selected profile. */
export function executeSimulationJob(
  input: SimulationJobInput,
  onProgress: (percent: number, stage: string) => void = () => undefined
): SimulationJobResult {
  const result = emptyResult();
  if (input.preflightError) {
    result.simulationError = input.preflightError;
    onProgress(100, 'blocked');
    return result;
  }
  if (input.dataPoints.length > MAX_INTERVALS_PER_DATASET) {
    result.simulationError = `Simulation input exceeds the supported maximum of ${MAX_INTERVALS_PER_DATASET.toLocaleString()} intervals.`;
    onProgress(100, 'blocked');
    return result;
  }
  if (input.dataPoints.length === 0 || input.profiles.length === 0) {
    onProgress(100, 'idle');
    return result;
  }

  const modeByProfile = new Map<string, UnifiedSimulationResult['mode']>();
  try {
    input.profiles.forEach((profile, index) => {
      const unified = runUnifiedSimulation({
        dataPoints: input.dataPoints,
        intervalHours: input.intervalHours,
        tiers: input.tiers,
        scheduleMatrix: input.scheduleMatrix,
        batteryProfile: profile,
        seasons: input.seasons,
        generationConfig: input.generationConfig,
        allowSolarExport: input.allowSolarExport,
      });
      modeByProfile.set(profile.id, unified.mode);
      result.allSimulationSummaries[profile.id] = profile.id === input.activeProfileId
        ? unified.annualSummary
        : { ...unified.annualSummary, intervalResults: [] };
      if (profile.id === input.activeProfileId) result.activeUnifiedResult = unified;
      onProgress(Math.round(((index + 1) / input.profiles.length) * 55), `simulating ${index + 1}/${input.profiles.length} profiles`);
    });
  } catch (error) {
    result.simulationError = errorMessage(error, 'Simulation error encountered with current settings.');
    onProgress(100, 'error');
    return result;
  }

  if (input.annualProjectionEligible) {
    result.allAnalyses = input.profiles.flatMap((profile) => {
      const summary = result.allSimulationSummaries[profile.id];
      const mode = modeByProfile.get(profile.id);
      if (!summary || !mode || !shouldCalculateLegacyFinancials(input.annualProjectionEligible, mode)) return [];
      return [calculate15YearFinancials(profile, summary, input.financials)];
    });
  }
  onProgress(55, 'interval simulations ready');
  return result;
}

/** Calculates one absolute projection year; each short-lived worker can release its interval arrays afterwards. */
export function executeGenerationProjectionYear(input: SimulationJobInput, year: number): GenerationOperationalYear {
  const batteryProfile = input.profiles.find((profile) => profile.id === input.activeProfileId) ?? input.profiles[0];
  const projection = calculateGenerationOperationalProjection({
    dataPoints: input.dataPoints,
    intervalHours: input.intervalHours,
    tiers: input.tiers,
    scheduleMatrix: input.scheduleMatrix,
    batteryProfile,
    seasons: input.seasons,
    generationConfig: input.generationConfig,
    allowSolarExport: input.allowSolarExport,
    annualElectricityInflationRate: input.financials.annualElectricityInflationRate,
    annualBatteryDegradationRate: input.financials.annualBatteryDegradationRate,
    projectionYears: 25,
    projectionStartYear: year,
    projectionEndYear: year,
  });
  return projection.years[0];
}

export function attachGenerationProjection(
  result: SimulationJobResult,
  input: SimulationJobInput,
  years: GenerationOperationalYear[]
): SimulationJobResult {
  const projection = Object.assign([...years], { horizonYears: 25, years }) as ReturnType<typeof calculateGenerationOperationalProjection>;
  result.activeGenerationOperationalProjection = projection;
  try {
    result.activeGenerationAnalysis = calculateGenerationAwareFinancials({
      batteryProfile: input.profiles.find((profile) => profile.id === input.activeProfileId) ?? input.profiles[0],
      operationalProjection: projection,
      projectCosts: aggregateGenerationProjectCosts(input.generationConfig),
      financials: input.financials,
    });
  } catch (error) {
    result.generationFinancialError = errorMessage(error, 'Failed to calculate generation financial lifecycle analysis.');
  }
  return result;
}
