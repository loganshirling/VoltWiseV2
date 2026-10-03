/**
 * Pure, Deterministic Generator Dispatch Policy Engine (Milestone G6B)
 *
 * Implements:
 * - Independent per-generator RUNNING/OFF state tracking and OFF -> RUNNING start detection
 * - Generator-hour runtime accounting for hourly and sub-hourly intervals
 * - Authoritative site-local scheduled commitment using IANA timezone translation
 * - Scheduled load-following bounded by minimum stable load and rated continuous capacity
 * - Deterministic proportional multi-generator headroom allocation
 * - Myopic economic dispatch against counterfactual home grid-import demand
 * - Full-load reference variable cost merit ordering with stable asset ID tie-breaking
 * - Strict candidate economic evaluation (benefit > cost) reusing G6A primitives
 * - Standby zero-dispatch preservation without outage fabrication
 * - Complete per-asset and fleet dispatch result records
 *
 * All functions are pure, deterministic, and non-mutating.
 * Production energy routing (battery, grid export, curtailment) is deferred to G6C.
 */

import {
  GeneratorGenerationAsset,
  GeneratorDispatchMode,
} from '../types/energy';
import {
  calculateGeneratorMinimumStableOutputKw,
  calculateGeneratorIntervalOperating,
  interpolateGeneratorFuelCurve,
  calculateFuelCostUsd,
  calculateVariableMaintenanceCostUsd,
  GeneratorIntervalOperatingResult,
} from './generatorModel';
import { isValidIanaTimeZone } from './loadTimeAlignment';

/**
 * Running state of a generator asset at an interval boundary.
 */
export interface GeneratorRunningState {
  assetId: string;
  running: boolean;
}

/**
 * Per-asset dispatch record for a single modeled interval.
 */
export interface GeneratorAssetDispatchRecord {
  assetId: string;
  assetName: string;
  dispatchMode: GeneratorDispatchMode;

  wasRunningBefore: boolean;
  running: boolean;
  startedThisInterval: boolean;

  outputKw: number;
  generatedKwh: number;
  directLoadTargetKwh: number;
  unavoidableSurplusKwh: number;

  runtimeHours: number;

  loadPercent: number;
  fuelUnitsPerHour: number;
  runningFuelUnits: number;
  startupFuelUnits: number;
  totalFuelUnits: number;

  fuelCostUsd: number;
  variableMaintenanceCostUsd: number;
  operatingCostUsd: number;

  economicCandidateBenefitUsd?: number;
  economicAccepted?: boolean;
}

/**
 * Aggregate fleet dispatch record for a single modeled interval.
 */
export interface GeneratorFleetDispatchRecord {
  intervals: GeneratorAssetDispatchRecord[];
  totalOutputKw: number;
  totalGeneratedKwh: number;
  totalDirectLoadTargetKwh: number;
  totalUnavoidableSurplusKwh: number;
  totalRuntimeHours: number; // Generator-hours
  totalStarts: number;
  totalFuelCostUsd: number;
  totalVariableMaintenanceCostUsd: number;
  totalOperatingCostUsd: number;
  remainingCounterfactualGridImportKwh: number;
  finalStates: GeneratorRunningState[];
}

/**
 * Options for single-interval generator dispatch evaluation.
 */
export interface DispatchGeneratorIntervalOptions {
  assets: GeneratorGenerationAsset[];
  priorStates?: GeneratorRunningState[] | Map<string, boolean>;
  intervalHours?: number;
  timeZone: string;
  instantUtc: Date;
  residualHomeLoadKwh?: number;
  counterfactualGridImportForHomeKwh?: number;
  buyRate?: number;
  sellRate?: number;
}

/**
 * Extracts canonical site-local dayOfWeek (0=Sun..6=Sat) and hour (0..23) for an instant in a timezone.
 */
export function extractSiteLocalClock(
  instantUtc: Date,
  timeZone: string
): { dayOfWeek: number; hour: number } {
  const trimmed = typeof timeZone === 'string' ? timeZone.trim() : '';
  if (!isValidIanaTimeZone(trimmed)) {
    throw new Error(`Invalid IANA timeZone: "${timeZone}".`);
  }

  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: trimmed,
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  });

  const parts = dtf.formatToParts(instantUtc);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === 'year') year = parseInt(p.value, 10);
    else if (p.type === 'month') month = parseInt(p.value, 10);
    else if (p.type === 'day') day = parseInt(p.value, 10);
    else if (p.type === 'hour') hour = parseInt(p.value, 10);
  }

  if (hour === 24) {
    hour = 0;
  }

  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return { dayOfWeek, hour };
}

/**
 * Determines whether a scheduled generator is committed for a specific instant and timezone.
 */
export function isGeneratorScheduledForInterval(
  asset: GeneratorGenerationAsset,
  instantUtc: Date,
  timeZone: string
): boolean {
  if (asset.dispatchMode !== 'scheduled' || !asset.enabled) {
    return false;
  }
  const { dayOfWeek, hour } = extractSiteLocalClock(instantUtc, timeZone);
  return Boolean(asset.scheduledHours?.[dayOfWeek]?.[hour]);
}

/**
 * Calculates full-load reference variable operating cost in $/kWh:
 * (100% load fuel cost per hour + variable maintenance cost per hour) / ratedContinuousKw
 *
 * Startup fuel is intentionally excluded from the reference merit-order value.
 */
export function calculateReferenceVariableCostPerKwh(
  asset: GeneratorGenerationAsset
): number {
  if (!Number.isFinite(asset.ratedContinuousKw) || asset.ratedContinuousKw <= 0) {
    return Infinity;
  }
  const fuelUnitsPerHourAt100 = interpolateGeneratorFuelCurve(asset.fuelCurve, 100);
  const fuelCostPerHour = calculateFuelCostUsd(fuelUnitsPerHourAt100, asset.fuelPricePerUnit);
  const maintCostPerHour = calculateVariableMaintenanceCostUsd(
    asset.variableMaintenanceCostPerHourUsd,
    1.0,
    true
  );
  return (fuelCostPerHour + maintCostPerHour) / asset.ratedContinuousKw;
}

/**
 * Deterministically sorts economic candidate generators by:
 * 1. Reference full-load variable operating cost ($/kWh) ascending
 * 2. Asset ID ascending (stable tie-breaker)
 *
 * Does not mutate the input array.
 */
export function sortEconomicGeneratorsMeritOrder(
  assets: GeneratorGenerationAsset[]
): GeneratorGenerationAsset[] {
  return [...assets].sort((a, b) => {
    const costA = calculateReferenceVariableCostPerKwh(a);
    const costB = calculateReferenceVariableCostPerKwh(b);
    if (Math.abs(costA - costB) > 1e-12) {
      return costA - costB;
    }
    return a.id.localeCompare(b.id);
  });
}

/**
 * Allocates load-following demand among committed scheduled generators.
 *
 * Rules:
 * 1. All committed units produce at least their minimum stable output.
 * 2. Headroom per unit = ratedContinuousKw - minStableKw.
 * 3. Additional required power above combined minimum output is allocated
 *    proportionally to remaining headroom.
 * 4. No generator exceeds ratedContinuousKw.
 * 5. Deterministic and independent of input array ordering.
 */
export function allocateScheduledGenerators(
  committedUnits: GeneratorGenerationAsset[],
  targetDemandKw: number
): Map<string, number> {
  const allocation = new Map<string, number>();
  if (committedUnits.length === 0) {
    return allocation;
  }

  // Pre-calculate minimum stable outputs and headrooms
  let totalMinKw = 0;
  let totalHeadroomKw = 0;
  const unitStats = committedUnits.map((asset) => {
    const minKw = calculateGeneratorMinimumStableOutputKw(asset);
    const ratedKw = asset.ratedContinuousKw;
    const headroomKw = Math.max(0, ratedKw - minKw);
    totalMinKw += minKw;
    totalHeadroomKw += headroomKw;
    return { id: asset.id, minKw, ratedKw, headroomKw };
  });

  const additionalRequiredKw = Math.max(0, targetDemandKw - totalMinKw);

  for (const u of unitStats) {
    let outputKw = u.minKw;
    if (additionalRequiredKw > 0 && totalHeadroomKw > 0) {
      const share = u.headroomKw / totalHeadroomKw;
      const additionalKw = Math.min(u.headroomKw, additionalRequiredKw * share);
      outputKw = Math.min(u.ratedKw, u.minKw + additionalKw);
    }
    allocation.set(u.id, outputKw);
  }

  return allocation;
}

/**
 * Evaluates generator dispatch for a single interval across all configured generator assets.
 */
export function dispatchGeneratorInterval(
  options: DispatchGeneratorIntervalOptions
): GeneratorFleetDispatchRecord {
  const {
    assets,
    priorStates,
    intervalHours = 1.0,
    timeZone,
    instantUtc,
    residualHomeLoadKwh = 0,
    counterfactualGridImportForHomeKwh = 0,
    buyRate = 0,
    sellRate = 0,
  } = options;

  if (!Array.isArray(assets)) {
    throw new Error('assets must be an array.');
  }
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    throw new Error(`Invalid intervalHours: ${intervalHours}. Must be a positive finite number.`);
  }

  // Build state map from priorStates without mutating input
  const priorStateMap = new Map<string, boolean>();
  if (priorStates instanceof Map) {
    priorStates.forEach((val, key) => priorStateMap.set(key, Boolean(val)));
  } else if (Array.isArray(priorStates)) {
    for (const s of priorStates) {
      if (s && typeof s.assetId === 'string') {
        priorStateMap.set(s.assetId, Boolean(s.running));
      }
    }
  }

  // Map to hold decided outputKw and economic metrics for each asset
  const decidedOutputKw = new Map<string, number>();
  const directLoadTargetMap = new Map<string, number>();
  const unavoidableSurplusMap = new Map<string, number>();
  const economicAcceptedMap = new Map<string, boolean>();
  const economicBenefitMap = new Map<string, number>();

  // 1. Standby generators: explicitly 0 kW
  for (const asset of assets) {
    if (asset.dispatchMode === 'standby' || !asset.enabled) {
      decidedOutputKw.set(asset.id, 0);
      directLoadTargetMap.set(asset.id, 0);
      unavoidableSurplusMap.set(asset.id, 0);
    }
  }

  // 2. Scheduled generators: evaluate commitment & allocate load-following
  const committedScheduled: GeneratorGenerationAsset[] = [];
  for (const asset of assets) {
    if (asset.enabled && asset.dispatchMode === 'scheduled') {
      if (isGeneratorScheduledForInterval(asset, instantUtc, timeZone)) {
        committedScheduled.push(asset);
      } else {
        decidedOutputKw.set(asset.id, 0);
        directLoadTargetMap.set(asset.id, 0);
        unavoidableSurplusMap.set(asset.id, 0);
      }
    }
  }

  if (committedScheduled.length > 0) {
    const residualDemandKw = Math.max(0, residualHomeLoadKwh) / intervalHours;
    const scheduledAllocation = allocateScheduledGenerators(
      committedScheduled,
      residualDemandKw
    );
    let totalScheduledGenKwh = 0;
    scheduledAllocation.forEach((kw, id) => {
      decidedOutputKw.set(id, kw);
      totalScheduledGenKwh += kw * intervalHours;
    });

    const homeLoadKwh = Math.max(0, residualHomeLoadKwh);
    for (const asset of committedScheduled) {
      const genKwh = (decidedOutputKw.get(asset.id) ?? 0) * intervalHours;
      if (genKwh <= 0) {
        directLoadTargetMap.set(asset.id, 0);
        unavoidableSurplusMap.set(asset.id, 0);
      } else if (totalScheduledGenKwh <= homeLoadKwh) {
        directLoadTargetMap.set(asset.id, genKwh);
        unavoidableSurplusMap.set(asset.id, 0);
      } else {
        const share = totalScheduledGenKwh > 0 ? genKwh / totalScheduledGenKwh : 0;
        const directKwh = share * homeLoadKwh;
        directLoadTargetMap.set(asset.id, directKwh);
        unavoidableSurplusMap.set(asset.id, Math.max(0, genKwh - directKwh));
      }
    }
  }

  // 3. Economic generators: evaluated sequentially in deterministic merit order
  const economicCandidates = assets.filter(
    (a) => a.enabled && a.dispatchMode === 'economic'
  );

  let remainingCounterfactualImportKwh = Math.max(
    0,
    counterfactualGridImportForHomeKwh
  );

  if (economicCandidates.length > 0) {
    const sortedCandidates = sortEconomicGeneratorsMeritOrder(economicCandidates);

    for (const candidate of sortedCandidates) {
      const wasRunning = Boolean(priorStateMap.get(candidate.id));

      // Economic generators require positive remaining counterfactual home grid import
      if (remainingCounterfactualImportKwh <= 0) {
        decidedOutputKw.set(candidate.id, 0);
        directLoadTargetMap.set(candidate.id, 0);
        unavoidableSurplusMap.set(candidate.id, 0);
        economicAcceptedMap.set(candidate.id, false);
        economicBenefitMap.set(candidate.id, 0);
        continue;
      }

      // Candidate output based on remaining demand clamped to [minStable, rated]
      const minKw = calculateGeneratorMinimumStableOutputKw(candidate);
      const ratedKw = candidate.ratedContinuousKw;
      const targetKw = remainingCounterfactualImportKwh / intervalHours;
      const candidateKw = Math.max(minKw, Math.min(ratedKw, targetKw));

      // Operating cost calculation reusing G6A primitives
      const candidateOperating: GeneratorIntervalOperatingResult =
        calculateGeneratorIntervalOperating({
          asset: candidate,
          outputKw: candidateKw,
          intervalHours,
          startedThisInterval: !wasRunning,
        });

      // Avoided grid import benefit serving household demand
      const candidateEnergyKwh = candidateKw * intervalHours;
      const energyServingHomeKwh = Math.min(
        candidateEnergyKwh,
        remainingCounterfactualImportKwh
      );

      // Export-only opportunity cannot create commitment
      if (energyServingHomeKwh <= 0) {
        decidedOutputKw.set(candidate.id, 0);
        directLoadTargetMap.set(candidate.id, 0);
        unavoidableSurplusMap.set(candidate.id, 0);
        economicAcceptedMap.set(candidate.id, false);
        economicBenefitMap.set(candidate.id, 0);
        continue;
      }

      let candidateBenefitUsd = energyServingHomeKwh * buyRate;

      // Unavoidable surplus export credit if permitted and present
      const unavoidableSurplusKwh = Math.max(
        0,
        candidateEnergyKwh - energyServingHomeKwh
      );
      if (candidate.allowGridExport && unavoidableSurplusKwh > 0) {
        candidateBenefitUsd += unavoidableSurplusKwh * sellRate;
      }

      economicBenefitMap.set(candidate.id, candidateBenefitUsd);

      // Strict economic start rule: candidateBenefitUsd > candidateOperatingCostUsd
      const isAccepted =
        candidateBenefitUsd > candidateOperating.operatingCostUsd;
      economicAcceptedMap.set(candidate.id, isAccepted);

      if (isAccepted) {
        decidedOutputKw.set(candidate.id, candidateKw);
        directLoadTargetMap.set(candidate.id, energyServingHomeKwh);
        unavoidableSurplusMap.set(candidate.id, unavoidableSurplusKwh);
        remainingCounterfactualImportKwh = Math.max(
          0,
          remainingCounterfactualImportKwh - energyServingHomeKwh
        );
      } else {
        decidedOutputKw.set(candidate.id, 0);
        directLoadTargetMap.set(candidate.id, 0);
        unavoidableSurplusMap.set(candidate.id, 0);
      }
    }
  }

  // 4. Assemble per-asset dispatch records and fleet aggregates
  const assetRecords: GeneratorAssetDispatchRecord[] = [];
  const finalStates: GeneratorRunningState[] = [];

  let totalOutputKw = 0;
  let totalGeneratedKwh = 0;
  let totalDirectLoadTargetKwh = 0;
  let totalUnavoidableSurplusKwh = 0;
  let totalRuntimeHours = 0;
  let totalStarts = 0;
  let totalFuelCostUsd = 0;
  let totalVariableMaintenanceCostUsd = 0;
  let totalOperatingCostUsd = 0;

  for (const asset of assets) {
    const wasRunning = Boolean(priorStateMap.get(asset.id));
    const outputKw = decidedOutputKw.get(asset.id) ?? 0;
    const running = outputKw > 0;
    const startedThisInterval = !wasRunning && running;
    const generatedKwh = outputKw * intervalHours;
    const runtimeHours = running ? intervalHours : 0;

    const directLoadTargetKwh = directLoadTargetMap.get(asset.id) ?? 0;
    const unavoidableSurplusKwh = unavoidableSurplusMap.get(asset.id) ?? 0;

    const operating: GeneratorIntervalOperatingResult =
      calculateGeneratorIntervalOperating({
        asset,
        outputKw,
        intervalHours,
        startedThisInterval,
      });

    finalStates.push({
      assetId: asset.id,
      running,
    });

    const record: GeneratorAssetDispatchRecord = {
      assetId: asset.id,
      assetName: asset.name,
      dispatchMode: asset.dispatchMode,
      wasRunningBefore: wasRunning,
      running,
      startedThisInterval,
      outputKw,
      generatedKwh,
      directLoadTargetKwh,
      unavoidableSurplusKwh,
      runtimeHours,
      loadPercent: operating.loadPercent,
      fuelUnitsPerHour: operating.fuelUnitsPerHour,
      runningFuelUnits: operating.runningFuelUnits,
      startupFuelUnits: operating.startupFuelUnits,
      totalFuelUnits: operating.totalFuelUnits,
      fuelCostUsd: operating.fuelCostUsd,
      variableMaintenanceCostUsd: operating.variableMaintenanceCostUsd,
      operatingCostUsd: operating.operatingCostUsd,
      economicCandidateBenefitUsd: economicBenefitMap.get(asset.id),
      economicAccepted: economicAcceptedMap.get(asset.id),
    };

    assetRecords.push(record);

    totalOutputKw += outputKw;
    totalGeneratedKwh += generatedKwh;
    totalDirectLoadTargetKwh += directLoadTargetKwh;
    totalUnavoidableSurplusKwh += unavoidableSurplusKwh;
    totalRuntimeHours += runtimeHours;
    if (startedThisInterval) {
      totalStarts += 1;
    }
    totalFuelCostUsd += operating.fuelCostUsd;
    totalVariableMaintenanceCostUsd += operating.variableMaintenanceCostUsd;
    totalOperatingCostUsd += operating.operatingCostUsd;
  }

  return {
    intervals: assetRecords,
    totalOutputKw,
    totalGeneratedKwh,
    totalDirectLoadTargetKwh,
    totalUnavoidableSurplusKwh,
    totalRuntimeHours,
    totalStarts,
    totalFuelCostUsd,
    totalVariableMaintenanceCostUsd,
    totalOperatingCostUsd,
    remainingCounterfactualGridImportKwh: remainingCounterfactualImportKwh,
    finalStates,
  };
}
