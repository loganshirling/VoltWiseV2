/**
 * Unified Solar Profile Engine & Multi-Array Fleet Aggregation (Milestone G2C)
 *
 * Provides a single entry point for generating deterministic solar intervals across
 * any supported resource model ('clear_sky' or 'monthly_peak_sun_hours'), and aggregating
 * multi-array fleets into unified interval production profiles for dispatch.
 */

import {
  GenerationSite,
  SolarGenerationAsset,
  SolarGenerationInterval,
  SolarFleetGenerationInterval,
} from '../types/energy';
import { calculateClearSkySolarInterval } from './solarModel';
import { generateMonthlyPeakSunHourSolarProfile } from './solarProfile';

/**
 * Validates the common UTC interval sequence.
 *
 * Requirements:
 * - instantsUtc.length > 0
 * - intervalHours > 0 and finite
 * - all items are valid Date objects
 * - strictly increasing timestamps
 * - regular spacing equal to intervalHours (with 1ms tolerance)
 *
 * Note: Does not require complete local days; resource models that require
 * complete days (e.g. monthly_peak_sun_hours) enforce that downstream.
 */
function validateCommonUtcSequence(instantsUtc: Date[], intervalHours: number): void {
  if (!instantsUtc || instantsUtc.length === 0) {
    throw new Error('instantsUtc must contain at least one timestamp.');
  }

  if (intervalHours <= 0 || !Number.isFinite(intervalHours)) {
    throw new Error(`Invalid intervalHours: ${intervalHours}. Must be greater than 0.`);
  }

  const expectedStepMs = Math.round(intervalHours * 3600 * 1000);

  for (let i = 0; i < instantsUtc.length; i++) {
    const d = instantsUtc[i];
    if (!(d instanceof Date) || isNaN(d.getTime())) {
      throw new Error(`Invalid Date object at index ${i}.`);
    }

    if (i > 0) {
      const diffMs = d.getTime() - instantsUtc[i - 1].getTime();
      if (diffMs <= 0) {
        throw new Error(
          `Timestamps must be strictly increasing. Duplicate or out-of-order timestamp at index ${i}: ${d.toISOString()}.`
        );
      }
      if (Math.abs(diffMs - expectedStepMs) > 1) {
        throw new Error(
          `Irregular interval spacing at index ${i}: expected step of ${expectedStepMs}ms (${intervalHours}h), but got ${diffMs}ms.`
        );
      }
    }
  }
}

/**
 * Generates an interval generation profile for a single solar asset under its configured resource mode.
 *
 * Maps specific resource results to the common SolarGenerationInterval contract:
 * - clear_sky: maps clearSkyGhi, clearSkyDni, clearSkyPOA
 * - monthly_peak_sun_hours: maps modeledGhi, modeledDni, modeledPoa
 * - weather_file: throws clear error (not implemented yet)
 */
export function generateSolarAssetProfile(
  instantsUtc: Date[],
  intervalHours: number,
  site: GenerationSite,
  asset: SolarGenerationAsset
): SolarGenerationInterval[] {
  validateCommonUtcSequence(instantsUtc, intervalHours);

  if (!asset) {
    throw new Error('Asset must be defined.');
  }

  switch (asset.resourceMode) {
    case 'clear_sky': {
      return instantsUtc.map((instant) => {
        const res = calculateClearSkySolarInterval(instant, intervalHours, site, asset);
        return {
          assetId: asset.id,
          timestampUtc: instant.toISOString(),
          resourceMode: 'clear_sky',
          position: res.position,
          ghiKwPerM2: res.clearSkyGhiKwPerM2,
          dniKwPerM2: res.clearSkyDniKwPerM2,
          poaKwPerM2: res.planeOfArrayIrradianceKwPerM2,
          rawDcPowerKw: res.rawDcPowerKw,
          dcPowerAfterLossesKw: res.dcPowerAfterLossesKw,
          unclippedAcPowerKw: res.unclippedAcPowerKw,
          acPowerKw: res.acPowerKw,
          dcEnergyKwh: res.dcEnergyKwh,
          acEnergyKwh: res.acEnergyKwh,
          clippedEnergyKwh: res.clippedEnergyKwh,
        };
      });
    }

    case 'monthly_peak_sun_hours': {
      const pshIntervals = generateMonthlyPeakSunHourSolarProfile(
        instantsUtc,
        intervalHours,
        site,
        asset
      );
      return pshIntervals.map((int) => ({
        assetId: asset.id,
        timestampUtc: int.timestampUtc,
        resourceMode: 'monthly_peak_sun_hours',
        position: int.position,
        ghiKwPerM2: int.modeledGhiKwPerM2,
        dniKwPerM2: int.modeledDniKwPerM2,
        poaKwPerM2: int.modeledPoaKwPerM2,
        rawDcPowerKw: int.rawDcPowerKw,
        dcPowerAfterLossesKw: int.dcPowerAfterLossesKw,
        unclippedAcPowerKw: int.unclippedAcPowerKw,
        acPowerKw: int.acPowerKw,
        dcEnergyKwh: int.dcEnergyKwh,
        acEnergyKwh: int.acEnergyKwh,
        clippedEnergyKwh: int.clippedEnergyKwh,
      }));
    }

    case 'weather_file':
      throw new Error('Solar weather-file resource mode is not implemented yet.');

    default:
      throw new Error(`Unsupported solar resource mode: ${(asset as SolarGenerationAsset).resourceMode}`);
  }
}

/**
 * Aggregates interval generation across a fleet of solar arrays into a single
 * unified SolarFleetGenerationInterval profile for downstream battery dispatch.
 *
 * Invariant: If assets is empty, returns zero generation for each timestamp
 * without requiring configured site coordinates or timezone.
 */
export function generateSolarFleetProfile(
  instantsUtc: Date[],
  intervalHours: number,
  site: GenerationSite,
  assets: SolarGenerationAsset[]
): SolarFleetGenerationInterval[] {
  validateCommonUtcSequence(instantsUtc, intervalHours);

  // Critical zero-asset invariant: empty fleet yields zero power/energy without requiring site config
  if (!assets || assets.length === 0) {
    return instantsUtc.map((instant) => ({
      timestampUtc: instant.toISOString(),
      totalRawDcPowerKw: 0,
      totalDcPowerAfterLossesKw: 0,
      totalUnclippedAcPowerKw: 0,
      totalAcPowerKw: 0,
      totalDcEnergyKwh: 0,
      totalAcEnergyKwh: 0,
      totalClippedEnergyKwh: 0,
    }));
  }

  // Generate individual profiles for each asset in the fleet
  const assetProfiles = assets.map((asset) =>
    generateSolarAssetProfile(instantsUtc, intervalHours, site, asset)
  );

  // Aggregate production across all arrays at each interval timestamp
  const fleetIntervals: SolarFleetGenerationInterval[] = [];

  for (let i = 0; i < instantsUtc.length; i++) {
    let totalRawDcPowerKw = 0;
    let totalDcPowerAfterLossesKw = 0;
    let totalUnclippedAcPowerKw = 0;
    let totalAcPowerKw = 0;
    let totalDcEnergyKwh = 0;
    let totalAcEnergyKwh = 0;
    let totalClippedEnergyKwh = 0;

    for (let a = 0; a < assetProfiles.length; a++) {
      const interval = assetProfiles[a][i];
      totalRawDcPowerKw += interval.rawDcPowerKw;
      totalDcPowerAfterLossesKw += interval.dcPowerAfterLossesKw;
      totalUnclippedAcPowerKw += interval.unclippedAcPowerKw;
      totalAcPowerKw += interval.acPowerKw;
      totalDcEnergyKwh += interval.dcEnergyKwh;
      totalAcEnergyKwh += interval.acEnergyKwh;
      totalClippedEnergyKwh += interval.clippedEnergyKwh;
    }

    fleetIntervals.push({
      timestampUtc: instantsUtc[i].toISOString(),
      totalRawDcPowerKw,
      totalDcPowerAfterLossesKw,
      totalUnclippedAcPowerKw,
      totalAcPowerKw,
      totalDcEnergyKwh,
      totalAcEnergyKwh,
      totalClippedEnergyKwh,
    });
  }

  return fleetIntervals;
}
