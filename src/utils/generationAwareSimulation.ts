/**
 * Authoritative Renewable Generation Simulation Pipeline (Milestone G5C)
 *
 * Single pure orchestration entry point composing authoritative stages:
 *   1. Load timestamp alignment to site timezone (alignLoadTimestampsToSite)
 *   2. Generation asset filtering & validation (solar and wind enabled, reject generator/interval_file)
 *   3. Multi-array solar fleet profile generation (generateSolarFleetProfile)
 *   4. Multi-turbine wind fleet profile generation (generateWindFleetProfile)
 *   5. Shared source-aware renewable load flow accounting (calculateRenewableLoadFlow)
 *   6. TOU battery dispatch policy generation (generateBatteryDispatchPolicy)
 *   7. Tariff buy/sell rate resolution (resolveTariffRates)
 *   8. Chronological export-aware battery flow & cost basis tracking (routeExportAwareBatteryFlow)
 *   9. Grid boundary import/export flow accounting (calculateExportAwareGridFlows)
 *  10. TOU & export-aware tariff cost accounting (calculateExportAwareTariffCosts)
 *
 * Invariants:
 *   - Pure function; does not mutate inputs.
 *   - Strictly preserves interval count and timestamp ordering across all stages.
 *   - Reconciles final grid SOC with final grid cost-basis energy.
 *   - Derives aggregate convenience values directly from authoritative stage outputs.
 *   - Solar-only projects maintain bit-for-bit numerical parity with G4 authoritative values.
 */

import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  ExportAwareBatteryFlowResult,
  GenerationConfig,
  GeneratorAssetAnnualSummary,
  GeneratorGenerationAsset,
  GridFlowResult,
  GridSocCostBasisState,
  IntervalDataPoint,
  RateTier,
  RenewableLoadFlowInterval,
  ResolvedTariffRateInterval,
  SolarFleetGenerationInterval,
  SolarGenerationAsset,
  SolarLoadFlowInterval,
  TariffCostResult,
  TouSeason,
  WindFleetGenerationInterval,
  WindGenerationAsset,
} from '../types/energy';
import {
  AlignedLoadTimestamp,
  alignLoadTimestampsToSite,
  isValidIanaTimeZone,
} from './loadTimeAlignment';
import { generateSolarFleetProfile } from './solarGeneration';
import { generateWindFleetProfile } from './windGeneration';
import {
  calculateRenewableLoadFlow,
  summarizeRenewableLoadFlow,
} from './renewableLoadFlow';
import { generateBatteryDispatchPolicy } from './batteryDispatchPolicy';
import { resolveTariffRates } from './tariffRateResolver';
import { routeExportAwareBatteryFlow } from './exportAwareBatteryFlow';
import { calculateExportAwareGridFlows } from './gridFlowAccounting';
import { calculateExportAwareTariffCosts } from './tariffCostAccounting';
import { validateGeneratorAsset } from './generatorModel';
import { GeneratorFleetDispatchRecord } from './generatorDispatch';
import { simulateGeneratorAwareOperationalFlow } from './generatorAwareFlow';

export interface GenerationAwareSimulationParams {
  dataPoints: IntervalDataPoint[];
  intervalHours: number;
  generationConfig: GenerationConfig;
  tiers: RateTier[];
  scheduleMatrix: string[][];
  batteryProfile: BatteryProfile;
  seasons?: TouSeason[];
  allowSolarExport?: boolean;
  allowRenewableExport?: boolean;
  initialBatteryState: BatterySocProvenanceState;
  initialCostBasisState: GridSocCostBasisState;
}

export interface GenerationAwareSimulationResult {
  // Authoritative stage outputs
  alignedTimestamps: AlignedLoadTimestamp[];
  solarFleetProfile: SolarFleetGenerationInterval[];
  windFleetProfile: WindFleetGenerationInterval[];
  renewableLoadFlow: RenewableLoadFlowInterval[];
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
  totalSolarToBatteryKwh: number;
  totalSolarExportKwh: number;
  totalSolarCurtailedKwh: number;

  totalWindGenerationKwh: number;
  totalWindDirectToLoadKwh: number;
  totalWindToBatteryKwh: number;
  totalWindExportKwh: number;
  totalWindCurtailedKwh: number;

  totalRenewableGenerationKwh: number;
  totalRenewableDirectToLoadKwh: number;
  totalRenewableToBatteryKwh: number;
  totalRenewableExportKwh: number;
  totalRenewableCurtailedKwh: number;

  totalGridImportKwh: number;
  totalBatteryExportKwh: number;
  totalGridExportKwh: number;
  baselineCost: number;
  simulatedCost: number;
  netSavings: number;

  generatorGeneratedKwh?: number;
  generatorDirectToLoadKwh?: number;
  generatorToBatteryKwh?: number;
  generatorExportKwh?: number;
  generatorCurtailedKwh?: number;

  totalGeneratorGenerationKwh?: number;
  totalGeneratorDirectToLoadKwh?: number;
  totalGeneratorToBatteryKwh?: number;
  totalGeneratorExportKwh?: number;
  totalGeneratorCurtailedKwh?: number;

  totalOnsiteGenerationKwh?: number;

  generatorRuntimeHours?: number;
  generatorStarts?: number;

  generatorFuelCostUsd?: number;
  generatorVariableMaintenanceCostUsd?: number;
  generatorOperatingCostUsd?: number;

  modeledUtilityCostUsd?: number;
  utilityElectricitySavingsUsd?: number;
  netOperationalSavingsUsd?: number;
  modeledTotalOperatingEnergyCostUsd?: number;

  generatorAssetSummaries?: GeneratorAssetAnnualSummary[];
  generatorFleetRecords?: GeneratorFleetDispatchRecord[];
}

/**
 * Runs the authoritative end-to-end solar, wind, battery dispatch, grid export,
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
    allowRenewableExport,
    initialBatteryState,
    initialCostBasisState,
  } = params;

  const count = dataPoints?.length ?? 0;

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

  if (
    typeof allowSolarExport !== 'boolean' &&
    typeof allowRenewableExport !== 'boolean'
  ) {
    throw new Error('allowSolarExport must be a boolean.');
  }

  const effectiveAllowRenewableExport =
    allowRenewableExport !== undefined
      ? allowRenewableExport
      : allowSolarExport!;

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
  const enabledWindAssets: WindGenerationAsset[] = [];
  const enabledGeneratorAssets: GeneratorGenerationAsset[] = [];

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
    } else if (asset.type === 'wind') {
      enabledWindAssets.push(asset);
    } else if (asset.type === 'generator') {
      validateGeneratorAsset(asset);
      enabledGeneratorAssets.push(asset);
    } else {
      throw new Error(
        `Unsupported generation asset type: "${(asset as any).type}" for asset "${(asset as any).name ?? (asset as any).id}". Only solar, wind, and generator assets are currently supported in this simulation pipeline.`
      );
    }
  }

  // 4. Stage 3 & 4: Generate solar fleet and wind fleet profiles independently
  const solarFleetProfile = generateSolarFleetProfile(
    alignedTimestamps.map((x) => x.instantUtc),
    intervalHours,
    generationConfig.site,
    enabledSolarAssets
  );

  const windFleetProfile = generateWindFleetProfile(
    alignedTimestamps,
    intervalHours,
    enabledWindAssets,
    generationConfig.site
  );

  // 5. Stage 5: Calculate shared source-aware renewable load flow
  const renewableLoadFlow = calculateRenewableLoadFlow(
    dataPoints,
    alignedTimestamps,
    solarFleetProfile,
    windFleetProfile
  );

  // Solar-only compatibility adapter: preserves existing SolarLoadFlowInterval shape
  const solarLoadFlow: SolarLoadFlowInterval[] = renewableLoadFlow.map((r) => ({
    sourceIndex: r.sourceIndex,
    sourceTimestamp: r.sourceTimestamp,
    timestampUtc: r.timestampUtc,
    homeLoadKwh: r.homeLoadKwh,
    solarGenerationKwh: r.solarGenerationKwh,
    solarDirectToLoadKwh: r.solarDirectToLoadKwh,
    residualHomeLoadKwh: r.residualHomeLoadKwh,
    surplusSolarKwh: r.surplusSolarKwh,
  }));

  // 6. Stage 6: Generate battery dispatch policy
  const dispatchPolicy = generateBatteryDispatchPolicy(
    alignedTimestamps,
    generationConfig.site.timeZone,
    scheduleMatrix,
    batteryProfile
  );

  // 7. Stage 7: Resolve tariff rates
  const resolvedRates = resolveTariffRates(
    dispatchPolicy,
    alignedTimestamps,
    generationConfig.site.timeZone,
    tiers,
    seasons
  );

  // If one or more generator assets are enabled, route through G6C generator-aware operational flow
  if (enabledGeneratorAssets.length > 0) {
    const generatorFlowResult = simulateGeneratorAwareOperationalFlow({
      dataPoints,
      alignedTimestamps,
      solarFleetProfile,
      windFleetProfile,
      renewableLoadFlow,
      dispatchPolicy,
      resolvedRates,
      intervalHours,
      batteryProfile,
      generatorAssets: enabledGeneratorAssets,
      timeZone: generationConfig.site.timeZone,
      initialBatteryState,
      initialCostBasisState,
      allowRenewableExport: effectiveAllowRenewableExport,
    });

    return {
      alignedTimestamps,
      solarFleetProfile,
      windFleetProfile,
      renewableLoadFlow: generatorFlowResult.renewableLoadFlow,
      solarLoadFlow: generatorFlowResult.solarLoadFlow,
      dispatchPolicy,
      resolvedRates,
      exportAwareBatteryFlow: generatorFlowResult.exportAwareBatteryFlow,
      gridFlows: generatorFlowResult.gridFlows,
      tariffCosts: generatorFlowResult.tariffCosts,

      totalIntervals: count,
      totalHomeLoadKwh: generatorFlowResult.totalHomeLoadKwh,

      totalSolarGenerationKwh: generatorFlowResult.totalSolarGenerationKwh,
      totalSolarDirectToLoadKwh: generatorFlowResult.totalSolarDirectToLoadKwh,
      totalSolarToBatteryKwh: generatorFlowResult.totalSolarToBatteryKwh,
      totalSolarExportKwh: generatorFlowResult.totalSolarExportKwh,
      totalSolarCurtailedKwh: generatorFlowResult.totalSolarCurtailedKwh,

      totalWindGenerationKwh: generatorFlowResult.totalWindGenerationKwh,
      totalWindDirectToLoadKwh: generatorFlowResult.totalWindDirectToLoadKwh,
      totalWindToBatteryKwh: generatorFlowResult.totalWindToBatteryKwh,
      totalWindExportKwh: generatorFlowResult.totalWindExportKwh,
      totalWindCurtailedKwh: generatorFlowResult.totalWindCurtailedKwh,

      totalRenewableGenerationKwh:
        generatorFlowResult.totalRenewableGenerationKwh,
      totalRenewableDirectToLoadKwh:
        generatorFlowResult.totalRenewableDirectToLoadKwh,
      totalRenewableToBatteryKwh: generatorFlowResult.totalRenewableToBatteryKwh,
      totalRenewableExportKwh: generatorFlowResult.totalRenewableExportKwh,
      totalRenewableCurtailedKwh:
        generatorFlowResult.totalRenewableCurtailedKwh,

      generatorGeneratedKwh: generatorFlowResult.generatorGeneratedKwh,
      generatorDirectToLoadKwh: generatorFlowResult.generatorDirectToLoadKwh,
      generatorToBatteryKwh: generatorFlowResult.generatorToBatteryKwh,
      generatorExportKwh: generatorFlowResult.generatorExportKwh,
      generatorCurtailedKwh: generatorFlowResult.generatorCurtailedKwh,

      totalGeneratorGenerationKwh:
        generatorFlowResult.totalGeneratorGenerationKwh,
      totalGeneratorDirectToLoadKwh:
        generatorFlowResult.totalGeneratorDirectToLoadKwh,
      totalGeneratorToBatteryKwh:
        generatorFlowResult.totalGeneratorToBatteryKwh,
      totalGeneratorExportKwh: generatorFlowResult.totalGeneratorExportKwh,
      totalGeneratorCurtailedKwh:
        generatorFlowResult.totalGeneratorCurtailedKwh,

      totalOnsiteGenerationKwh: generatorFlowResult.totalOnsiteGenerationKwh,

      generatorRuntimeHours: generatorFlowResult.generatorRuntimeHours,
      generatorStarts: generatorFlowResult.generatorStarts,

      generatorFuelCostUsd: generatorFlowResult.generatorFuelCostUsd,
      generatorVariableMaintenanceCostUsd:
        generatorFlowResult.generatorVariableMaintenanceCostUsd,
      generatorOperatingCostUsd: generatorFlowResult.generatorOperatingCostUsd,

      generatorAssetSummaries: generatorFlowResult.generatorAssetSummaries,
      generatorFleetRecords: generatorFlowResult.generatorFleetRecords,

      totalGridImportKwh: generatorFlowResult.totalGridImportKwh,
      totalBatteryExportKwh: generatorFlowResult.totalBatteryExportKwh,
      totalGridExportKwh: generatorFlowResult.totalGridExportKwh,
      baselineCost: generatorFlowResult.baselineCost,
      simulatedCost: generatorFlowResult.simulatedCost,
      netSavings: generatorFlowResult.netSavings,

      modeledUtilityCostUsd: generatorFlowResult.modeledUtilityCostUsd,
      utilityElectricitySavingsUsd:
        generatorFlowResult.utilityElectricitySavingsUsd,
      netOperationalSavingsUsd: generatorFlowResult.netOperationalSavingsUsd,
      modeledTotalOperatingEnergyCostUsd:
        generatorFlowResult.modeledTotalOperatingEnergyCostUsd,
    };
  }

  // 8. Stage 8: Route export-aware battery flow (source-aware renewable charging)
  const exportAwareBatteryFlow = routeExportAwareBatteryFlow(
    renewableLoadFlow,
    dispatchPolicy,
    resolvedRates,
    intervalHours,
    batteryProfile,
    initialBatteryState,
    initialCostBasisState
  );

  // 9. Stage 9: Calculate export-aware grid flows
  const gridFlows = calculateExportAwareGridFlows(
    exportAwareBatteryFlow.intervals,
    effectiveAllowRenewableExport
  );

  // 10. Stage 10: Calculate export-aware tariff costs
  const tariffCosts = calculateExportAwareTariffCosts(
    gridFlows.intervals,
    exportAwareBatteryFlow.intervals,
    resolvedRates
  );

  // 11. Pipeline completion invariants
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
      windFleetProfile[i].timestampUtc !== tsUtc ||
      renewableLoadFlow[i].timestampUtc !== tsUtc ||
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
  const renewableSummary = summarizeRenewableLoadFlow(renewableLoadFlow);

  const totalSolarToBatteryKwh = exportAwareBatteryFlow.intervals.reduce(
    (sum, inv) => sum + inv.preExportFlow.solarToBatteryAcKwh,
    0
  );

  const totalWindToBatteryKwh = exportAwareBatteryFlow.intervals.reduce(
    (sum, inv) => sum + (inv.preExportFlow.windToBatteryAcKwh ?? 0),
    0
  );

  const totalRenewableToBatteryKwh =
    totalSolarToBatteryKwh + totalWindToBatteryKwh;

  const totalSolarCurtailedKwh = gridFlows.totalCurtailedSolarKwh;
  const totalWindCurtailedKwh = gridFlows.totalCurtailedWindKwh ?? 0;
  const totalRenewableCurtailedKwh =
    gridFlows.totalCurtailedRenewableKwh ??
    totalSolarCurtailedKwh + totalWindCurtailedKwh;

  const totalSolarExportKwh = gridFlows.totalSolarExportKwh;
  const totalWindExportKwh = gridFlows.totalWindExportKwh ?? 0;
  const totalRenewableExportKwh =
    gridFlows.totalRenewableExportKwh ??
    totalSolarExportKwh + totalWindExportKwh;

  return {
    alignedTimestamps,
    solarFleetProfile,
    windFleetProfile,
    renewableLoadFlow,
    solarLoadFlow,
    dispatchPolicy,
    resolvedRates,
    exportAwareBatteryFlow,
    gridFlows,
    tariffCosts,

    totalIntervals: count,
    totalHomeLoadKwh: renewableSummary.totalHomeLoadKwh,

    totalSolarGenerationKwh: renewableSummary.totalSolarGenerationKwh,
    totalSolarDirectToLoadKwh: renewableSummary.totalSolarDirectToLoadKwh,
    totalSolarToBatteryKwh,
    totalSolarExportKwh,
    totalSolarCurtailedKwh,

    totalWindGenerationKwh: renewableSummary.totalWindGenerationKwh,
    totalWindDirectToLoadKwh: renewableSummary.totalWindDirectToLoadKwh,
    totalWindToBatteryKwh,
    totalWindExportKwh,
    totalWindCurtailedKwh,

    totalRenewableGenerationKwh: renewableSummary.totalRenewableGenerationKwh,
    totalRenewableDirectToLoadKwh: renewableSummary.totalRenewableDirectToLoadKwh,
    totalRenewableToBatteryKwh,
    totalRenewableExportKwh,
    totalRenewableCurtailedKwh,

    totalOnsiteGenerationKwh: renewableSummary.totalRenewableGenerationKwh,
    generatorGeneratedKwh: 0,
    generatorDirectToLoadKwh: 0,
    generatorToBatteryKwh: 0,
    generatorExportKwh: 0,
    generatorCurtailedKwh: 0,
    totalGeneratorGenerationKwh: 0,
    totalGeneratorDirectToLoadKwh: 0,
    totalGeneratorToBatteryKwh: 0,
    totalGeneratorExportKwh: 0,
    totalGeneratorCurtailedKwh: 0,
    generatorRuntimeHours: 0,
    generatorStarts: 0,
    generatorFuelCostUsd: 0,
    generatorVariableMaintenanceCostUsd: 0,
    generatorOperatingCostUsd: 0,
    modeledUtilityCostUsd: tariffCosts.simulatedCost,
    utilityElectricitySavingsUsd: tariffCosts.netSavings,
    netOperationalSavingsUsd: tariffCosts.netSavings,
    modeledTotalOperatingEnergyCostUsd: tariffCosts.simulatedCost,
    generatorAssetSummaries: [],

    totalGridImportKwh: gridFlows.totalGridImportKwh,
    totalBatteryExportKwh: gridFlows.totalBatteryExportKwh,
    totalGridExportKwh: gridFlows.totalGridExportKwh,
    baselineCost: tariffCosts.baselineCost,
    simulatedCost: tariffCosts.simulatedCost,
    netSavings: tariffCosts.netSavings,
  };
}
