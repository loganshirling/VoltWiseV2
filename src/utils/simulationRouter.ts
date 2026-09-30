/**
 * Production Simulation Router & No-Generation Parity Gate (Milestone G3R)
 *
 * Directs simulation execution based on generation asset presence:
 * - If NO generation assets are enabled: directly calls legacy runAnnualSimulation()
 *   and returns its result unchanged (exact parity invariant).
 * - If ONE OR MORE generation assets are enabled: routes through G3Q
 *   (runGenerationAwareSimulation) and adapts its authoritative outputs into
 *   AnnualSimulationSummary.
 */

import {
  AnnualSimulationSummary,
  BatteryProfile,
  BatterySocProvenanceState,
  GenerationConfig,
  GridSocCostBasisState,
  IntervalDataPoint,
  IntervalSimulationResult,
  RateTier,
  TouSeason,
} from '../types/energy';
import { runAnnualSimulation } from './simulationEngine';
import {
  GenerationAwareSimulationResult,
  runGenerationAwareSimulation,
} from './generationAwareSimulation';

export interface UnifiedSimulationParams {
  dataPoints: IntervalDataPoint[];
  intervalHours: number;
  tiers: RateTier[];
  scheduleMatrix: string[][];
  batteryProfile: BatteryProfile;
  seasons?: TouSeason[];
  generationConfig: GenerationConfig;
  allowSolarExport: boolean;
}

export interface UnifiedSimulationResult {
  mode: 'legacy' | 'generation-aware';
  annualSummary: AnnualSimulationSummary;
  generationAwareResult?: GenerationAwareSimulationResult;
}

/**
 * Executes unified battery dispatch simulation.
 * When no generation assets are enabled, delegates directly to legacy runAnnualSimulation.
 * When generation assets are enabled, delegates to G3Q and adapts outputs.
 */
export function runUnifiedSimulation(
  params: UnifiedSimulationParams
): UnifiedSimulationResult {
  if (!params || typeof params !== 'object') {
    throw new Error('Simulation parameters must be provided as an object.');
  }

  const {
    dataPoints,
    intervalHours,
    tiers,
    scheduleMatrix,
    batteryProfile,
    seasons,
    generationConfig,
    allowSolarExport,
  } = params;

  // Determine enabled generation assets
  const assets = generationConfig?.assets;
  const enabledAssets = Array.isArray(assets)
    ? assets.filter((asset) => asset != null && asset.enabled === true)
    : [];

  // Permanent Invariant: When NO generation assets are enabled, execute legacy engine directly
  if (enabledAssets.length === 0) {
    const legacySummary = runAnnualSimulation(
      dataPoints,
      intervalHours,
      tiers,
      scheduleMatrix,
      batteryProfile,
      seasons
    );

    return {
      mode: 'legacy',
      annualSummary: legacySummary,
    };
  }

  // Generation-aware branch: Initial startup convention (50% synthetic usable SOC)
  const usableCapacityKwh =
    batteryProfile.totalCapacityKwh *
    (batteryProfile.usableDodPercent / 100);

  const initialBatteryState: BatterySocProvenanceState = {
    syntheticSocKwh: usableCapacityKwh * 0.5,
    gridChargedSocKwh: 0,
    renewableChargedSocKwh: 0,
    generatorChargedSocKwh: 0,
  };

  const initialCostBasisState: GridSocCostBasisState = {
    gridStoredEnergyKwh: 0,
    totalAcquisitionCostUsd: 0,
  };

  // Authoritative G3Q simulation call
  const generationAwareResult = runGenerationAwareSimulation({
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
  });

  // Adapt G3Q authoritative outputs into AnnualSimulationSummary
  const count = dataPoints.length;
  const intervalResults: IntervalSimulationResult[] = new Array(count);

  let totalBatteryDischarged = 0;
  let maxPeakKw = 0;

  for (let i = 0; i < count; i++) {
    const pt = dataPoints[i];
    const pol = generationAwareResult.dispatchPolicy[i];
    const tariffCost = generationAwareResult.tariffCosts.intervals[i];
    const gridFlow = generationAwareResult.gridFlows.intervals[i];
    const expInterval =
      generationAwareResult.exportAwareBatteryFlow.intervals[i];
    const preExportFlow = expInterval.preExportFlow;
    const exportResult = expInterval.exportResult;

    const loadKwh = pt.usageKwh;
    const currentKw = intervalHours > 0 ? loadKwh / intervalHours : loadKwh;
    if (currentKw > maxPeakKw) {
      maxPeakKw = currentKw;
    }

    // Battery charge = renewable stored + grid stored
    const batteryChargeKwh =
      preExportFlow.renewableEnergyStoredKwh +
      preExportFlow.gridEnergyStoredKwh;

    // Battery discharge = delivered to home load + battery export to grid (never solar export)
    const batteryDischargeKwh =
      preExportFlow.batteryDeliveredToLoadKwh +
      exportResult.batteryExportAcKwh;

    totalBatteryDischarged += batteryDischargeKwh;

    // Battery SOC after interval = sum of all provenance buckets after export
    const stateAfter = expInterval.batteryStateAfterExport;
    const currentSocKwh =
      stateAfter.syntheticSocKwh +
      stateAfter.gridChargedSocKwh +
      stateAfter.renewableChargedSocKwh +
      stateAfter.generatorChargedSocKwh;

    const socPercent =
      usableCapacityKwh > 0 ? (currentSocKwh / usableCapacityKwh) * 100 : 0;

    intervalResults[i] = {
      timestamp: pt.timestamp,
      hour: pol.hour,
      dayOfWeek: pol.dayOfWeek,
      homeLoadKwh: loadKwh,
      tierId: tariffCost.tierId,
      tierName: tariffCost.tierName,
      seasonName: tariffCost.seasonName,
      buyRate: tariffCost.buyRate,
      sellRate: tariffCost.sellRate,
      batteryChargeKwh,
      batteryDischargeKwh,
      batterySocKwh: Math.round(currentSocKwh * 100) / 100,
      batterySocPercent: Math.round(socPercent * 10) / 10,
      gridImportKwh: Math.round(gridFlow.totalGridImportKwh * 100) / 100,
      gridExportKwh: Math.round(gridFlow.totalGridExportKwh * 100) / 100,
      baselineCost: tariffCost.baselineCost,
      simulatedCost: tariffCost.simulatedCost,
      netSavings: tariffCost.netSavings,
    };
  }

  const equivalentFullCycles =
    usableCapacityKwh > 0
      ? totalBatteryDischarged / usableCapacityKwh
      : 0;

  const baselineCost = generationAwareResult.baselineCost;
  const simulatedCost = generationAwareResult.simulatedCost;
  const year1Savings = baselineCost - simulatedCost;
  const savingsPercentage =
    baselineCost > 0 ? (year1Savings / baselineCost) * 100 : 0;

  const durationDays =
    intervalHours > 0
      ? Math.round((count * intervalHours) / 24)
      : Math.round(count / 24);

  const isSuitableForAnnual = count >= 8760 * 0.95 && durationDays >= 360;

  const annualSummary: AnnualSimulationSummary = {
    profileId: batteryProfile.id,
    profileName: batteryProfile.name,
    totalIntervals: count,
    intervalHours,
    durationDays,
    isSuitableForAnnualProjection: isSuitableForAnnual,
    totalHomeLoadKwh:
      Math.round(generationAwareResult.totalHomeLoadKwh * 10) / 10,
    baselineAnnualCost: Math.round(baselineCost * 100) / 100,
    simulatedAnnualCost: Math.round(simulatedCost * 100) / 100,
    year1Savings: Math.round(year1Savings * 100) / 100,
    baselinePeriodCost: Math.round(baselineCost * 100) / 100,
    simulatedPeriodCost: Math.round(simulatedCost * 100) / 100,
    periodSavings: Math.round(year1Savings * 100) / 100,
    savingsPercentage: Math.round(savingsPercentage * 10) / 10,
    annualGridImportKwh:
      Math.round(generationAwareResult.totalGridImportKwh * 10) / 10,
    annualGridExportKwh:
      Math.round(generationAwareResult.totalGridExportKwh * 10) / 10,
    annualBatteryDischargedKwh:
      Math.round(totalBatteryDischarged * 10) / 10,
    equivalentFullCycles: Math.round(equivalentFullCycles),
    maxPeakDemandKw: Math.round(maxPeakKw * 100) / 100,
    intervalResults,
  };

  return {
    mode: 'generation-aware',
    annualSummary,
    generationAwareResult,
  };
}
