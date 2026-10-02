/**
 * Authoritative Shared Renewable-to-Load Energy Flow Kernel (Milestone G5C)
 *
 * Integrates independent solar fleet and wind fleet generation profiles against aligned
 * household load intervals through a shared, source-neutral passive renewable boundary.
 *
 * Operational Rules:
 *   1. Total renewable generation serves home load first (passive self-consumption).
 *   2. When both solar and wind are positive, direct-to-load consumption is allocated
 *      proportionally to each source's generation in that interval (source-neutral).
 *   3. Surplus generation from each source is preserved independently for downstream
 *      battery charging and grid export/curtailment accounting.
 *   4. Zero-generation and single-source intervals reduce deterministically:
 *      when windGeneration = 0, output is bit-for-bit identical to solarLoadFlow.
 *
 * Invariants:
 *   solarGeneration = solarDirectToLoad + surplusSolar
 *   windGeneration = windDirectToLoad + surplusWind
 *   totalRenewableGeneration = totalRenewableDirectToLoad + totalRenewableSurplus
 *   homeLoad = totalRenewableDirectToLoad + residualHomeLoad
 */

import {
  IntervalDataPoint,
  RenewableLoadFlowInterval,
  RenewableLoadFlowSummary,
  SolarFleetGenerationInterval,
  WindFleetGenerationInterval,
} from '../types/energy';
import { AlignedLoadTimestamp } from './loadTimeAlignment';

/**
 * Calculates direct renewable-to-load flow, residual household load, and source-specific
 * surpluses for each interval.
 *
 * Pure function: does not mutate inputs or caller state.
 */
export function calculateRenewableLoadFlow(
  dataPoints: IntervalDataPoint[],
  alignedTimestamps: AlignedLoadTimestamp[],
  solarProfile: SolarFleetGenerationInterval[],
  windProfile: WindFleetGenerationInterval[]
): RenewableLoadFlowInterval[] {
  if (
    !Array.isArray(dataPoints) ||
    !Array.isArray(alignedTimestamps) ||
    !Array.isArray(solarProfile) ||
    !Array.isArray(windProfile)
  ) {
    throw new Error(
      'All inputs (dataPoints, alignedTimestamps, solarProfile, windProfile) must be arrays.'
    );
  }

  if (
    dataPoints.length === 0 ||
    alignedTimestamps.length === 0 ||
    solarProfile.length === 0 ||
    windProfile.length === 0
  ) {
    throw new Error('Input arrays must have non-zero length.');
  }

  const length = dataPoints.length;
  if (
    alignedTimestamps.length !== length ||
    solarProfile.length !== length ||
    windProfile.length !== length
  ) {
    throw new Error(
      `Input arrays must have identical length. Received dataPoints: ${length}, alignedTimestamps: ${alignedTimestamps.length}, solarProfile: ${solarProfile.length}, windProfile: ${windProfile.length}.`
    );
  }

  const result: RenewableLoadFlowInterval[] = new Array(length);

  for (let i = 0; i < length; i++) {
    const dp = dataPoints[i];
    const aligned = alignedTimestamps[i];
    const solar = solarProfile[i];
    const wind = windProfile[i];

    if (!dp || typeof dp !== 'object') {
      throw new Error(`Invalid dataPoint at index ${i}: must be an object.`);
    }
    if (!aligned || typeof aligned !== 'object') {
      throw new Error(`Invalid alignedTimestamp at index ${i}: must be an object.`);
    }
    if (!solar || typeof solar !== 'object') {
      throw new Error(`Invalid solarProfile interval at index ${i}: must be an object.`);
    }
    if (!wind || typeof wind !== 'object') {
      throw new Error(`Invalid windProfile interval at index ${i}: must be an object.`);
    }

    // Validate indexing and timestamp alignment
    if (aligned.sourceIndex !== i) {
      throw new Error(
        `Aligned timestamp at index ${i} has mismatched sourceIndex ${aligned.sourceIndex}. Expected ${i}.`
      );
    }

    if (aligned.sourceTimestamp !== dp.timestamp) {
      throw new Error(
        `Aligned timestamp sourceTimestamp "${aligned.sourceTimestamp}" at index ${i} does not match data point timestamp "${dp.timestamp}".`
      );
    }

    if (aligned.timestampUtc !== solar.timestampUtc) {
      throw new Error(
        `Aligned timestamp timestampUtc "${aligned.timestampUtc}" at index ${i} does not match solar profile timestampUtc "${solar.timestampUtc}".`
      );
    }

    if (aligned.timestampUtc !== wind.timestampUtc) {
      throw new Error(
        `Aligned timestamp timestampUtc "${aligned.timestampUtc}" at index ${i} does not match wind profile timestampUtc "${wind.timestampUtc}".`
      );
    }

    // Validate energy inputs
    const homeLoadKwh = dp.usageKwh;
    if (
      typeof homeLoadKwh !== 'number' ||
      !Number.isFinite(homeLoadKwh) ||
      homeLoadKwh < 0
    ) {
      throw new Error(
        `Invalid usageKwh at index ${i}: ${homeLoadKwh}. Value must be a finite non-negative number.`
      );
    }

    const solarGenerationKwh = solar.totalAcEnergyKwh;
    if (
      typeof solarGenerationKwh !== 'number' ||
      !Number.isFinite(solarGenerationKwh) ||
      solarGenerationKwh < 0
    ) {
      throw new Error(
        `Invalid totalAcEnergyKwh at index ${i}: ${solarGenerationKwh}. Value must be a finite non-negative number.`
      );
    }

    const windGenerationKwh = wind.totalEnergyKwh;
    if (
      typeof windGenerationKwh !== 'number' ||
      !Number.isFinite(windGenerationKwh) ||
      windGenerationKwh < 0
    ) {
      throw new Error(
        `Invalid totalEnergyKwh at index ${i}: ${windGenerationKwh}. Value must be a finite non-negative number.`
      );
    }

    // Direct renewable routing
    const totalRenewableGenerationKwh = solarGenerationKwh + windGenerationKwh;
    const totalRenewableDirectToLoadKwh = Math.min(
      homeLoadKwh,
      totalRenewableGenerationKwh
    );

    let solarDirectToLoadKwh = 0;
    let windDirectToLoadKwh = 0;

    if (totalRenewableGenerationKwh > 0 && totalRenewableDirectToLoadKwh > 0) {
      const solarShare = solarGenerationKwh / totalRenewableGenerationKwh;
      const windShare = windGenerationKwh / totalRenewableGenerationKwh;

      solarDirectToLoadKwh = totalRenewableDirectToLoadKwh * solarShare;
      windDirectToLoadKwh = totalRenewableDirectToLoadKwh * windShare;
    }

    let residualHomeLoadKwh = homeLoadKwh - totalRenewableDirectToLoadKwh;
    let surplusSolarKwh = solarGenerationKwh - solarDirectToLoadKwh;
    let surplusWindKwh = windGenerationKwh - windDirectToLoadKwh;
    let totalRenewableSurplusKwh = surplusSolarKwh + surplusWindKwh;

    // Protect against insignificant floating-point residue (< 1e-12)
    if (Math.abs(residualHomeLoadKwh) < 1e-12) {
      residualHomeLoadKwh = 0;
    }
    if (Math.abs(solarDirectToLoadKwh) < 1e-12) {
      solarDirectToLoadKwh = 0;
    }
    if (Math.abs(windDirectToLoadKwh) < 1e-12) {
      windDirectToLoadKwh = 0;
    }
    if (Math.abs(surplusSolarKwh) < 1e-12) {
      surplusSolarKwh = 0;
    }
    if (Math.abs(surplusWindKwh) < 1e-12) {
      surplusWindKwh = 0;
    }
    if (Math.abs(totalRenewableSurplusKwh) < 1e-12) {
      totalRenewableSurplusKwh = 0;
    }

    result[i] = {
      sourceIndex: i,
      sourceTimestamp: dp.timestamp,
      timestampUtc: aligned.timestampUtc,

      homeLoadKwh,

      solarGenerationKwh,
      windGenerationKwh,
      totalRenewableGenerationKwh,

      solarDirectToLoadKwh,
      windDirectToLoadKwh,
      totalRenewableDirectToLoadKwh,

      residualHomeLoadKwh,

      surplusSolarKwh,
      surplusWindKwh,
      totalRenewableSurplusKwh,
    };
  }

  return result;
}

/**
 * Summarizes renewable-to-load flow across all intervals.
 */
export function summarizeRenewableLoadFlow(
  intervals: RenewableLoadFlowInterval[]
): RenewableLoadFlowSummary {
  if (!Array.isArray(intervals)) {
    throw new Error('intervals must be an array.');
  }

  let totalHomeLoadKwh = 0;
  let totalSolarGenerationKwh = 0;
  let totalWindGenerationKwh = 0;
  let totalRenewableGenerationKwh = 0;

  let totalSolarDirectToLoadKwh = 0;
  let totalWindDirectToLoadKwh = 0;
  let totalRenewableDirectToLoadKwh = 0;

  let totalResidualHomeLoadKwh = 0;
  let totalSurplusSolarKwh = 0;
  let totalSurplusWindKwh = 0;
  let totalRenewableSurplusKwh = 0;

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    totalHomeLoadKwh += inv.homeLoadKwh;
    totalSolarGenerationKwh += inv.solarGenerationKwh;
    totalWindGenerationKwh += inv.windGenerationKwh;
    totalRenewableGenerationKwh += inv.totalRenewableGenerationKwh;

    totalSolarDirectToLoadKwh += inv.solarDirectToLoadKwh;
    totalWindDirectToLoadKwh += inv.windDirectToLoadKwh;
    totalRenewableDirectToLoadKwh += inv.totalRenewableDirectToLoadKwh;

    totalResidualHomeLoadKwh += inv.residualHomeLoadKwh;
    totalSurplusSolarKwh += inv.surplusSolarKwh;
    totalSurplusWindKwh += inv.surplusWindKwh;
    totalRenewableSurplusKwh += inv.totalRenewableSurplusKwh;
  }

  const solarSelfConsumptionPercent =
    totalSolarGenerationKwh > 0
      ? (totalSolarDirectToLoadKwh / totalSolarGenerationKwh) * 100
      : 0;

  const windSelfConsumptionPercent =
    totalWindGenerationKwh > 0
      ? (totalWindDirectToLoadKwh / totalWindGenerationKwh) * 100
      : 0;

  const renewableSelfConsumptionPercent =
    totalRenewableGenerationKwh > 0
      ? (totalRenewableDirectToLoadKwh / totalRenewableGenerationKwh) * 100
      : 0;

  const solarLoadCoveragePercent =
    totalHomeLoadKwh > 0
      ? (totalSolarDirectToLoadKwh / totalHomeLoadKwh) * 100
      : 0;

  const windLoadCoveragePercent =
    totalHomeLoadKwh > 0
      ? (totalWindDirectToLoadKwh / totalHomeLoadKwh) * 100
      : 0;

  const renewableLoadCoveragePercent =
    totalHomeLoadKwh > 0
      ? (totalRenewableDirectToLoadKwh / totalHomeLoadKwh) * 100
      : 0;

  return {
    intervalCount: intervals.length,

    totalHomeLoadKwh,
    totalSolarGenerationKwh,
    totalWindGenerationKwh,
    totalRenewableGenerationKwh,

    totalSolarDirectToLoadKwh,
    totalWindDirectToLoadKwh,
    totalRenewableDirectToLoadKwh,

    totalResidualHomeLoadKwh,
    totalSurplusSolarKwh,
    totalSurplusWindKwh,
    totalRenewableSurplusKwh,

    solarSelfConsumptionPercent,
    windSelfConsumptionPercent,
    renewableSelfConsumptionPercent,
    solarLoadCoveragePercent,
    windLoadCoveragePercent,
    renewableLoadCoveragePercent,
  };
}
