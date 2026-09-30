/**
 * Authoritative Wind Generation Profile & Multi-Turbine Fleet Aggregation (Milestone G5B)
 *
 * Implements:
 * - Single-turbine interval generation profile for annual_average and monthly_average resource modes.
 * - Authoritative reuse of G5A wind physics, validation, hub shear, air density, and Rayleigh integration.
 * - Deterministic site-local calendar month resolution using existing timezone logic.
 * - Multi-turbine fleet aggregation with independent per-turbine simulation.
 * - Deterministic, order-independent fleet summation.
 * - Safe handling of disabled wind assets, non-wind assets (solar, generator), and empty fleets.
 * - Explicit rejection of unsupported interval_file resource mode.
 * - Pure wind-profile summary calculation.
 * - Strict non-mutation of caller inputs.
 */

import {
  GenerationAsset,
  GenerationSite,
  WindGenerationAsset,
  WindGenerationInterval,
  WindFleetGenerationInterval,
  WindFleetSummary,
} from '../types/energy';
import { AlignedLoadTimestamp } from './loadTimeAlignment';
import { getLocalDateAndMonth, validateTimeZone } from './solarProfile';
import {
  simulateWindIntervalExpectedEnergy,
  validateWindGenerationAsset,
} from './windModel';

export type WindTimestampInput = AlignedLoadTimestamp | Date;

interface NormalizedTimestamp {
  instantUtc: Date;
  timestampUtc: string;
}

/**
 * Normalizes input timestamps (AlignedLoadTimestamp or Date) into standard UTC instant and ISO string.
 * Does not mutate inputs.
 */
function normalizeTimestamp(item: WindTimestampInput, index: number): NormalizedTimestamp {
  if (item instanceof Date) {
    if (isNaN(item.getTime())) {
      throw new Error(`Invalid Date object at timestamp index ${index}.`);
    }
    return { instantUtc: item, timestampUtc: item.toISOString() };
  }

  if (
    item &&
    typeof item === 'object' &&
    item.instantUtc instanceof Date &&
    typeof item.timestampUtc === 'string'
  ) {
    if (isNaN(item.instantUtc.getTime())) {
      throw new Error(`Invalid instantUtc in AlignedLoadTimestamp at index ${index}.`);
    }
    return { instantUtc: item.instantUtc, timestampUtc: item.timestampUtc };
  }

  throw new Error(
    `Invalid timestamp item at index ${index}: expected an instance of Date or an AlignedLoadTimestamp object.`
  );
}

/**
 * Generates an interval generation profile for a single wind turbine asset.
 *
 * Requirements:
 * - Order and count of intervals match input timestamps 1:1.
 * - For annual_average: uses annualAverageWindSpeedMps constant across all intervals.
 * - For monthly_average: selects monthlyAverageWindSpeedMps based on the site's local calendar month.
 * - Disabled assets return zero-valued intervals without throwing configuration errors.
 * - Enabled interval_file mode is explicitly rejected via G5A validation boundary.
 * - Does not mutate input parameters.
 */
export function generateWindAssetProfile(
  timestamps: WindTimestampInput[],
  intervalHours: number,
  asset: WindGenerationAsset,
  site?: GenerationSite | null
): WindGenerationInterval[] {
  if (!Array.isArray(timestamps)) {
    throw new Error('timestamps must be an array.');
  }

  if (
    typeof intervalHours !== 'number' ||
    !Number.isFinite(intervalHours) ||
    intervalHours <= 0
  ) {
    throw new Error(
      `Invalid intervalHours: ${intervalHours}. Must be a positive finite number.`
    );
  }

  if (!asset || typeof asset !== 'object') {
    throw new Error('Invalid wind asset: must be an object.');
  }

  const normalized = timestamps.map((t, idx) => normalizeTimestamp(t, idx));

  // Disabled assets produce zero generation without requiring valid physics configuration
  if (!asset.enabled) {
    return normalized.map((t) => ({
      assetId: asset.id,
      timestampUtc: t.timestampUtc,
      resourceMode:
        asset.resourceMode === 'monthly_average'
          ? 'monthly_average'
          : 'annual_average',
      resourceMeanWindSpeedMps: 0,
      hubHeightMeanWindSpeedMps: 0,
      expectedNetPowerKw: 0,
      energyKwh: 0,
    }));
  }

  // Validate enabled asset physics and configuration (rejects interval_file or invalid parameters)
  validateWindGenerationAsset(asset);

  if (asset.resourceMode === 'annual_average') {
    const annualMean = asset.annualAverageWindSpeedMps!;
    const sim = simulateWindIntervalExpectedEnergy(
      annualMean,
      intervalHours,
      asset,
      site
    );

    return normalized.map((t) => ({
      assetId: asset.id,
      timestampUtc: t.timestampUtc,
      resourceMode: 'annual_average',
      resourceMeanWindSpeedMps: annualMean,
      hubHeightMeanWindSpeedMps: sim.hubHeightMeanWindSpeedMps,
      expectedNetPowerKw: sim.netPowerKw,
      energyKwh: sim.energyKwh,
    }));
  }

  if (asset.resourceMode === 'monthly_average') {
    if (!site || !site.timeZone) {
      throw new Error(
        'Site timeZone must be provided for monthly_average wind resource mode.'
      );
    }
    const timeZone = validateTimeZone(site.timeZone);

    // Pre-calculate the 12 monthly results for performance and exact determinism
    const monthlySimResults = asset.monthlyAverageWindSpeedMps.map((monthlyMean) =>
      simulateWindIntervalExpectedEnergy(monthlyMean, intervalHours, asset, site)
    );

    return normalized.map((t) => {
      const { monthIndex } = getLocalDateAndMonth(t.instantUtc, timeZone);
      const monthlyMean = asset.monthlyAverageWindSpeedMps[monthIndex];
      const sim = monthlySimResults[monthIndex];

      return {
        assetId: asset.id,
        timestampUtc: t.timestampUtc,
        resourceMode: 'monthly_average',
        resourceMeanWindSpeedMps: monthlyMean,
        hubHeightMeanWindSpeedMps: sim.hubHeightMeanWindSpeedMps,
        expectedNetPowerKw: sim.netPowerKw,
        energyKwh: sim.energyKwh,
      };
    });
  }

  throw new Error(`Unsupported wind resource mode: "${(asset as WindGenerationAsset).resourceMode}".`);
}

/**
 * Aggregates interval generation across a fleet of wind turbines into a unified
 * WindFleetGenerationInterval profile.
 *
 * Rules:
 * - Each enabled wind turbine is simulated independently through G5A.
 * - Disabled wind assets contribute zero and do not undergo physics validation.
 * - Non-wind assets (solar, generator) are ignored.
 * - If no enabled wind assets are present, returns a zero-valued profile without requiring site/resource config.
 * - Aggregation is deterministic and independent of turbine array ordering.
 * - Does not mutate input parameters.
 */
export function generateWindFleetProfile(
  timestamps: WindTimestampInput[],
  intervalHours: number,
  assets: (GenerationAsset | WindGenerationAsset)[],
  site?: GenerationSite | null
): WindFleetGenerationInterval[] {
  if (!Array.isArray(timestamps)) {
    throw new Error('timestamps must be an array.');
  }

  if (
    typeof intervalHours !== 'number' ||
    !Number.isFinite(intervalHours) ||
    intervalHours <= 0
  ) {
    throw new Error(
      `Invalid intervalHours: ${intervalHours}. Must be a positive finite number.`
    );
  }

  if (!Array.isArray(assets)) {
    throw new Error('assets must be an array.');
  }

  const normalized = timestamps.map((t, idx) => normalizeTimestamp(t, idx));

  // Filter for wind assets only. Solar and generator assets are ignored by the wind fleet layer.
  // Disabled wind assets contribute zero and their physics config is not validated.
  const enabledWindAssets: WindGenerationAsset[] = [];

  for (const asset of assets) {
    if (!asset || typeof asset !== 'object') {
      continue;
    }
    // Solar and generator assets are explicitly ignored in the wind fleet layer
    if (asset.type === 'solar' || asset.type === 'generator') {
      continue;
    }
    // Wind assets
    if (asset.type === 'wind' && asset.enabled) {
      enabledWindAssets.push(asset as WindGenerationAsset);
    }
  }

  // Critical zero-asset invariant: empty wind fleet yields zero power/energy without requiring site or resource config
  if (enabledWindAssets.length === 0) {
    return normalized.map((t) => ({
      timestampUtc: t.timestampUtc,
      totalExpectedPowerKw: 0,
      totalEnergyKwh: 0,
    }));
  }

  // Sort enabled wind assets by ID to guarantee bit-for-bit deterministic order-independence
  const sortedAssets = [...enabledWindAssets].sort((a, b) => a.id.localeCompare(b.id));

  // Generate individual profiles for each turbine
  const assetProfiles = sortedAssets.map((asset) =>
    generateWindAssetProfile(timestamps, intervalHours, asset, site)
  );

  // Aggregate power and energy across all turbines for each interval
  const fleetIntervals: WindFleetGenerationInterval[] = [];

  for (let i = 0; i < normalized.length; i++) {
    let totalExpectedPowerKw = 0;
    let totalEnergyKwh = 0;

    for (let a = 0; a < assetProfiles.length; a++) {
      const interval = assetProfiles[a][i];
      totalExpectedPowerKw += interval.expectedNetPowerKw;
      totalEnergyKwh += interval.energyKwh;
    }

    fleetIntervals.push({
      timestampUtc: normalized[i].timestampUtc,
      totalExpectedPowerKw,
      totalEnergyKwh,
    });
  }

  return fleetIntervals;
}

/**
 * Pure summary helper deriving fleet performance metrics strictly from fleet intervals.
 * Does not recompute wind physics.
 */
export function summarizeWindFleetProfile(
  fleetIntervals: WindFleetGenerationInterval[]
): WindFleetSummary {
  if (!Array.isArray(fleetIntervals) || fleetIntervals.length === 0) {
    return {
      intervalCount: 0,
      totalGenerationKwh: 0,
      averagePowerKw: 0,
    };
  }

  let totalGenerationKwh = 0;
  let totalPowerKw = 0;

  for (let i = 0; i < fleetIntervals.length; i++) {
    const interval = fleetIntervals[i];
    totalGenerationKwh += interval.totalEnergyKwh;
    totalPowerKw += interval.totalExpectedPowerKw;
  }

  return {
    intervalCount: fleetIntervals.length,
    totalGenerationKwh,
    averagePowerKw: totalPowerKw / fleetIntervals.length,
  };
}
