/**
 * Authoritative Solar Generation Simulation Pipeline (Milestone G3Q)
 *
 * Single pure orchestration entry point composing authoritative stages:
 *   1. Load timestamp alignment to site timezone (alignLoadTimestampsToSite)
 *   2. Generation asset filtering & validation (solar enabled only, reject unsupported)
 *   3. Multi-array solar fleet profile generation (generateSolarFleetProfile)
 *   4. Direct solar-to-load flow accounting (calculateSolarLoadFlow)
 *   5. TOU battery dispatch policy generation (generateBatteryDispatchPolicy)
 *   6. Tariff buy/sell rate resolution (resolveTariffRates)
 *   7. Chronological export-aware battery flow & cost basis tracking (routeExportAwareBatteryFlow)
 *   8. Grid boundary import/export flow accounting (calculateExportAwareGridFlows)
 *   9. TOU & export-aware tariff cost accounting (calculateExportAwareTariffCosts)
 *
 * Invariants:
 *   - Pure function; does not mutate inputs.
 *   - Strictly preserves interval count and timestamp ordering across all stages.
 *   - Reconciles final grid SOC with final grid cost-basis energy.
 *   - Derives aggregate convenience values directly from authoritative stage outputs.
 */

import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  ExportAwareBatteryFlowResult,
  GenerationConfig,
  GridFlowResult,
  GridSocCostBasisState,
  IntervalDataPoint,
  RateTier,
  ResolvedTariffRateInterval,
  SolarFleetGenerationInterval,
  SolarGenerationAsset,
  SolarLoadFlowInterval,
  TariffCostResult,
  TouSeason,
} from '../types/energy';
import {
  AlignedLoadTimestamp,
  alignLoadTimestampsToSite,
  isValidIanaTimeZone,
} from './loadTimeAlignment';
import { generateSolarFleetProfile } from './solarGeneration';
import {
  calculateSolarLoadFlow,
  summarizeSolarLoadFlow,
} from './solarLoadFlow';
import { generateBatteryDispatchPolicy } from './batteryDispatchPolicy';
import { resolveTariffRates } from './tariffRateResolver';
import { routeExportAwareBatteryFlow } from './exportAwareBatteryFlow';
import { calculateExportAwareGridFlows } from './gridFlowAccounting';
import { calculateExportAwareTariffCosts } from './tariffCostAccounting';

export interface GenerationAwareSimulationParams {
  dataPoints: IntervalDataPoint[];
  intervalHours: number;
  generationConfig: GenerationConfig;
  tiers: RateTier[];
  scheduleMatrix: string[][];
  batteryProfile: BatteryProfile;
  seasons?: TouSeason[];
  allowSolarExport: boolean;
  initialBatteryState: BatterySocProvenanceState;
  initialCostBasisState: GridSocCostBasisState;
}

export interface GenerationAwareSimulationResult {
  // Authoritative stage outputs
  alignedTimestamps: AlignedLoadTimestamp[];
  solarFleetProfile: SolarFleetGenerationInterval[];
  solarLoadFlow: SolarLoadFlowInterval[];
  dispatchPolicy: BatteryDispatchPolicyInterval[];
  resolvedRates: ResolvedTariffRateInterval[];
  exportAwareBatteryFlow: ExportAwareBatteryFlowResult;
  gridFlows: GridFlowResult;
  tariffCosts: TariffCostResult;

  // Concise aggregate convenience values
  totalIntervals?: number;
  totalHomeLoadKwh: number;
  totalSolarGenerationKwh: number;
  totalSolarDirectToLoadKwh: number;
  totalGridImportKwh: number;
  totalSolarExportKwh: number;
  totalBatteryExportKwh: number;
  totalGridExportKwh: number;
  baselineCost: number;
  simulatedCost: number;
  netSavings: number;
}

/**
 * Runs the authoritative end-to-end solar generation, battery dispatch, grid export,
 * and tariff cost simulation pipeline.
 */
export function runGenerationAwareSimulation(
  params: GenerationAwareSimulationParams
): GenerationAwareSimulationResult {
  if (!params || typeof params !== 'object') {
    throw new Error('Simulation parameters must be provided as an object.');
  }

  const {
    dataPoints,
    intervalHours,
    generationConfig,
    tiers,
    scheduleMatrix,
    batteryProfile,
    seasons,
    allowSolarExport,
    initialBatteryState,
    initialCostBasisState,
  } = params;

  // 1. Validate top-level pipeline configurations
  if (!generationConfig || typeof generationConfig !== 'object') {
    throw new Error('generationConfig must be a valid object.');
  }

  if (!generationConfig.site || typeof generationConfig.site !== 'object') {
    throw new Error('generationConfig.site must be a valid object.');
  }

  if (
    typeof generationConfig.site.timeZone !== 'string' ||
    !isValidIanaTimeZone(generationConfig.site.timeZone)
  ) {
    throw new Error(
      `Invalid site timeZone: "${generationConfig.site?.timeZone}". A valid IANA timezone string is required.`
    );
  }

  if (typeof allowSolarExport !== 'boolean') {
    throw new Error('allowSolarExport must be a boolean.');
  }

  // 2. Stage 1: Align load timestamps to site timezone
  const alignedTimestamps = alignLoadTimestampsToSite(
    dataPoints,
    intervalHours,
    generationConfig.site.timeZone
  );

  // 3. Stage 2: Select enabled generation assets
  const assets = generationConfig.assets ?? [];
  if (!Array.isArray(assets)) {
    throw new Error('generationConfig.assets must be an array.');
  }

  const enabledSolarAssets: SolarGenerationAsset[] = [];
  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') {
      throw new Error('Each generation asset must be a valid object.');
    }

    if (!asset.enabled) {
      // Disabled assets (solar, wind, generator) are ignored
      continue;
    }

    if (asset.type === 'solar') {
      enabledSolarAssets.push(asset);
    } else if (asset.type === 'wind' || asset.type === 'generator') {
      throw new Error(
        `Unsupported generation asset type: "${asset.type}" for asset "${asset.name ?? asset.id}". Only solar assets are currently supported in this simulation pipeline.`
      );
    } else {
      throw new Error(
        `Unsupported generation asset type: "${(asset as any).type}" for asset "${(asset as any).name ?? (asset as any).id}". Only solar assets are currently supported in this simulation pipeline.`
      );
    }
  }

  // 4. Stage 3: Generate solar fleet profile
  const solarFleetProfile = generateSolarFleetProfile(
    alignedTimestamps.map((x) => x.instantUtc),
    intervalHours,
    generationConfig.site,
    enabledSolarAssets
  );

  // 5. Stage 4: Calculate solar-to-load flow
  const solarLoadFlow = calculateSolarLoadFlow(
    dataPoints,
    alignedTimestamps,
    solarFleetProfile
  );

  // 6. Stage 5: Generate battery dispatch policy
  const dispatchPolicy = generateBatteryDispatchPolicy(
    alignedTimestamps,
    generationConfig.site.timeZone,
    scheduleMatrix,
    batteryProfile
  );

  // 7. Stage 6: Resolve tariff rates
  const resolvedRates = resolveTariffRates(
    dispatchPolicy,
    alignedTimestamps,
    generationConfig.site.timeZone,
    tiers,
    seasons
  );

  // 8. Stage 7: Route export-aware battery flow
  const exportAwareBatteryFlow = routeExportAwareBatteryFlow(
    solarLoadFlow,
    dispatchPolicy,
    resolvedRates,
    intervalHours,
    batteryProfile,
    initialBatteryState,
    initialCostBasisState
  );

  // 9. Stage 8: Calculate export-aware grid flows
  const gridFlows = calculateExportAwareGridFlows(
    exportAwareBatteryFlow.intervals,
    allowSolarExport
  );

  // 10. Stage 9: Calculate export-aware tariff costs
  const tariffCosts = calculateExportAwareTariffCosts(
    gridFlows.intervals,
    exportAwareBatteryFlow.intervals,
    resolvedRates
  );

  // 11. Pipeline completion invariants
  const count = dataPoints.length;
  if (gridFlows.intervals.length !== count) {
    throw new Error(
      `Completion invariant violated: gridFlows.intervals length (${gridFlows.intervals.length}) !== dataPoints length (${count}).`
    );
  }

  if (tariffCosts.intervals.length !== count) {
    throw new Error(
      `Completion invariant violated: tariffCosts.intervals length (${tariffCosts.intervals.length}) !== dataPoints length (${count}).`
    );
  }

  // Final grid SOC and final cost-basis energy reconciliation
  const finalGridSoc = exportAwareBatteryFlow.finalBatteryState.gridChargedSocKwh;
  const finalCostBasisEnergy = exportAwareBatteryFlow.finalCostBasisState.gridStoredEnergyKwh;
  if (Math.abs(finalGridSoc - finalCostBasisEnergy) > 1e-6) {
    throw new Error(
      `Completion invariant violated: final grid SOC (${finalGridSoc} kWh) does not reconcile with final cost-basis energy (${finalCostBasisEnergy} kWh).`
    );
  }

  // Verify interval count and timestamp alignment across all stages
  for (let i = 0; i < count; i++) {
    const tsUtc = alignedTimestamps[i].timestampUtc;
    if (
      solarFleetProfile[i].timestampUtc !== tsUtc ||
      solarLoadFlow[i].timestampUtc !== tsUtc ||
      dispatchPolicy[i].timestampUtc !== tsUtc ||
      resolvedRates[i].timestampUtc !== tsUtc ||
      exportAwareBatteryFlow.intervals[i].timestampUtc !== tsUtc ||
      gridFlows.intervals[i].timestampUtc !== tsUtc ||
      tariffCosts.intervals[i].timestampUtc !== tsUtc
    ) {
      throw new Error(
        `Completion invariant violated: timestampUtc mismatch across stages at interval ${i}.`
      );
    }
  }

  // 12. Derive concise aggregate convenience values directly from authoritative stage outputs
  const solarSummary = summarizeSolarLoadFlow(solarLoadFlow);

  return {
    alignedTimestamps,
    solarFleetProfile,
    solarLoadFlow,
    dispatchPolicy,
    resolvedRates,
    exportAwareBatteryFlow,
    gridFlows,
    tariffCosts,

    totalIntervals: count,
    totalHomeLoadKwh: solarSummary.totalHomeLoadKwh,
    totalSolarGenerationKwh: solarSummary.totalSolarGenerationKwh,
    totalSolarDirectToLoadKwh: solarSummary.totalSolarDirectToLoadKwh,
    totalGridImportKwh: gridFlows.totalGridImportKwh,
    totalSolarExportKwh: gridFlows.totalSolarExportKwh,
    totalBatteryExportKwh: gridFlows.totalBatteryExportKwh,
    totalGridExportKwh: gridFlows.totalGridExportKwh,
    baselineCost: tariffCosts.baselineCost,
    simulatedCost: tariffCosts.simulatedCost,
    netSavings: tariffCosts.netSavings,
  };
}
