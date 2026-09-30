/**
 * Solar-to-Load Energy Flow Kernel (Milestone G3A)
 *
 * Combines aligned load intervals with the modeled solar fleet generation profile.
 * Solar serves home load first before any battery storage or grid interaction.
 *
 * Invariant:
 *   solarGeneration = directSolarToLoad + surplusSolar
 *   homeLoad        = directSolarToLoad + residualHomeLoad
 */

import {
  IntervalDataPoint,
  SolarFleetGenerationInterval,
  SolarLoadFlowInterval,
  SolarLoadFlowSummary,
} from '../types/energy';
import { AlignedLoadTimestamp } from './loadTimeAlignment';

/**
 * Calculates direct solar-to-load flow, residual household load, and surplus solar for each interval.
 */
export function calculateSolarLoadFlow(
  dataPoints: IntervalDataPoint[],
  alignedTimestamps: AlignedLoadTimestamp[],
  solarProfile: SolarFleetGenerationInterval[]
): SolarLoadFlowInterval[] {
  if (
    !Array.isArray(dataPoints) ||
    !Array.isArray(alignedTimestamps) ||
    !Array.isArray(solarProfile)
  ) {
    throw new Error(
      'All inputs (dataPoints, alignedTimestamps, solarProfile) must be arrays.'
    );
  }

  if (
    dataPoints.length === 0 ||
    alignedTimestamps.length === 0 ||
    solarProfile.length === 0
  ) {
    throw new Error('Input arrays must have non-zero length.');
  }

  if (
    dataPoints.length !== alignedTimestamps.length ||
    dataPoints.length !== solarProfile.length
  ) {
    throw new Error(
      `Input arrays must have identical length. Received dataPoints: ${dataPoints.length}, alignedTimestamps: ${alignedTimestamps.length}, solarProfile: ${solarProfile.length}.`
    );
  }

  const result: SolarLoadFlowInterval[] = new Array(dataPoints.length);

  for (let i = 0; i < dataPoints.length; i++) {
    const aligned = alignedTimestamps[i];
    const dp = dataPoints[i];
    const solar = solarProfile[i];

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

    // Direct solar routing
    const solarDirectToLoadKwh = Math.min(homeLoadKwh, solarGenerationKwh);
    let residualHomeLoadKwh = homeLoadKwh - solarDirectToLoadKwh;
    let surplusSolarKwh = solarGenerationKwh - solarDirectToLoadKwh;

    // Protect against insignificant floating-point residue
    if (Math.abs(residualHomeLoadKwh) < 1e-12) {
      residualHomeLoadKwh = 0;
    }
    if (Math.abs(surplusSolarKwh) < 1e-12) {
      surplusSolarKwh = 0;
    }

    result[i] = {
      sourceIndex: i,
      sourceTimestamp: dp.timestamp,
      timestampUtc: aligned.timestampUtc,
      homeLoadKwh,
      solarGenerationKwh,
      solarDirectToLoadKwh,
      residualHomeLoadKwh,
      surplusSolarKwh,
    };
  }

  return result;
}

/**
 * Summarizes solar-to-load flow across all intervals by summing independent components
 * and calculating self-consumption and load coverage percentages.
 */
export function summarizeSolarLoadFlow(
  intervals: SolarLoadFlowInterval[]
): SolarLoadFlowSummary {
  if (!Array.isArray(intervals)) {
    throw new Error('intervals must be an array.');
  }

  let totalHomeLoadKwh = 0;
  let totalSolarGenerationKwh = 0;
  let totalSolarDirectToLoadKwh = 0;
  let totalResidualHomeLoadKwh = 0;
  let totalSurplusSolarKwh = 0;

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    totalHomeLoadKwh += inv.homeLoadKwh;
    totalSolarGenerationKwh += inv.solarGenerationKwh;
    totalSolarDirectToLoadKwh += inv.solarDirectToLoadKwh;
    totalResidualHomeLoadKwh += inv.residualHomeLoadKwh;
    totalSurplusSolarKwh += inv.surplusSolarKwh;
  }

  const solarSelfConsumptionPercent =
    totalSolarGenerationKwh > 0
      ? (totalSolarDirectToLoadKwh / totalSolarGenerationKwh) * 100
      : 0;

  const solarLoadCoveragePercent =
    totalHomeLoadKwh > 0
      ? (totalSolarDirectToLoadKwh / totalHomeLoadKwh) * 100
      : 0;

  return {
    intervalCount: intervals.length,
    totalHomeLoadKwh,
    totalSolarGenerationKwh,
    totalSolarDirectToLoadKwh,
    totalResidualHomeLoadKwh,
    totalSurplusSolarKwh,
    solarSelfConsumptionPercent,
    solarLoadCoveragePercent,
  };
}
