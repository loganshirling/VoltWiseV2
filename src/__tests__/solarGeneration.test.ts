import { describe, it, expect } from 'vitest';
import {
  generateSolarAssetProfile,
  generateSolarFleetProfile,
} from '../utils/solarGeneration';
import { calculateClearSkySolarInterval } from '../utils/solarModel';
import { generateMonthlyPeakSunHourSolarProfile } from '../utils/solarProfile';
import { GenerationSite, SolarGenerationAsset } from '../types/energy';
import { createDefaultSolarAsset } from '../utils/generationDefaults';

describe('G2C Milestone — Unified Solar Profile API & Multi-Array Aggregation', () => {
  const baseSite: GenerationSite = {
    latitude: 37.7749, // San Francisco, CA
    longitude: -122.4194,
    timeZone: 'America/Los_Angeles',
    elevationM: 16,
  };

  const clearSkyAsset: SolarGenerationAsset = {
    ...createDefaultSolarAsset('solar-clear-sky-1', 'Clear-Sky Array'),
    dcCapacityKw: 8.0,
    tiltDegrees: 25,
    azimuthDegrees: 180,
    inverterAcCapacityKw: 7.0,
    inverterEfficiencyPercent: 96.0,
    systemLossPercent: 14.0,
    shadingLossPercent: 2.0,
    resourceMode: 'clear_sky',
  };

  const pshAsset: SolarGenerationAsset = {
    ...createDefaultSolarAsset('solar-psh-1', 'PSH Array'),
    dcCapacityKw: 10.0,
    tiltDegrees: 20,
    azimuthDegrees: 180,
    inverterAcCapacityKw: 8.0,
    inverterEfficiencyPercent: 96.0,
    systemLossPercent: 14.0,
    shadingLossPercent: 0.0,
    resourceMode: 'monthly_peak_sun_hours',
    monthlyPeakSunHoursPerDay: [3.0, 3.8, 5.0, 6.0, 6.8, 7.2, 5.5, 6.5, 5.8, 4.5, 3.2, 2.8],
  };

  function generateDateSequence(startUtc: Date, count: number, intervalHours: number): Date[] {
    const stepMs = Math.round(intervalHours * 3600 * 1000);
    const dates: Date[] = [];
    for (let i = 0; i < count; i++) {
      dates.push(new Date(startUtc.getTime() + i * stepMs));
    }
    return dates;
  }

  // --------------------------------------------------------------------------
  // A. Clear-sky adapter parity
  // --------------------------------------------------------------------------
  it('A. matches calculateClearSkySolarInterval output exactly for clear_sky mode', () => {
    const startUtc = new Date('2026-07-15T18:00:00Z');
    const dates = generateDateSequence(startUtc, 4, 1.0);

    const unifiedProfile = generateSolarAssetProfile(dates, 1.0, baseSite, clearSkyAsset);
    expect(unifiedProfile).toHaveLength(4);

    for (let i = 0; i < dates.length; i++) {
      const instant = dates[i];
      const directResult = calculateClearSkySolarInterval(instant, 1.0, baseSite, clearSkyAsset);
      const unified = unifiedProfile[i];

      expect(unified.assetId).toBe(clearSkyAsset.id);
      expect(unified.timestampUtc).toBe(instant.toISOString());
      expect(unified.resourceMode).toBe('clear_sky');

      expect(unified.position.elevationDegrees).toBeCloseTo(directResult.position.elevationDegrees, 8);
      expect(unified.position.azimuthDegrees).toBeCloseTo(directResult.position.azimuthDegrees, 8);

      expect(unified.ghiKwPerM2).toBeCloseTo(directResult.clearSkyGhiKwPerM2, 8);
      expect(unified.dniKwPerM2).toBeCloseTo(directResult.clearSkyDniKwPerM2, 8);
      expect(unified.poaKwPerM2).toBeCloseTo(directResult.planeOfArrayIrradianceKwPerM2, 8);

      expect(unified.rawDcPowerKw).toBeCloseTo(directResult.rawDcPowerKw, 8);
      expect(unified.dcPowerAfterLossesKw).toBeCloseTo(directResult.dcPowerAfterLossesKw, 8);
      expect(unified.unclippedAcPowerKw).toBeCloseTo(directResult.unclippedAcPowerKw, 8);
      expect(unified.acPowerKw).toBeCloseTo(directResult.acPowerKw, 8);
      expect(unified.dcEnergyKwh).toBeCloseTo(directResult.dcEnergyKwh, 8);
      expect(unified.acEnergyKwh).toBeCloseTo(directResult.acEnergyKwh, 8);
      expect(unified.clippedEnergyKwh).toBeCloseTo(directResult.clippedEnergyKwh, 8);
    }
  });

  // --------------------------------------------------------------------------
  // B. Clear-sky partial sequence
  // --------------------------------------------------------------------------
  it('B. succeeds with partial sequence of 6 consecutive hourly timestamps in clear_sky mode', () => {
    // 6 hours from 10:00 to 15:00 UTC (does not start or end at local midnight)
    const partialDates = generateDateSequence(new Date('2026-07-15T10:00:00Z'), 6, 1.0);

    // Site does not even need a valid timezone for pure clear-sky physics
    const siteWithoutTz: GenerationSite = {
      ...baseSite,
      timeZone: '',
    };

    const profile = generateSolarAssetProfile(partialDates, 1.0, siteWithoutTz, clearSkyAsset);
    expect(profile).toHaveLength(6);
    expect(profile[0].timestampUtc).toBe('2026-07-15T10:00:00.000Z');
    expect(profile[5].timestampUtc).toBe('2026-07-15T15:00:00.000Z');
  });

  // --------------------------------------------------------------------------
  // C. Monthly-PSH adapter parity
  // --------------------------------------------------------------------------
  it('C. matches generateMonthlyPeakSunHourSolarProfile output exactly for monthly_peak_sun_hours mode', () => {
    // Complete local day in America/Los_Angeles (July 15, PDT: UTC-7 -> starts 07:00 UTC)
    const startUtc = new Date('2026-07-15T07:00:00Z');
    const fullDayDates = generateDateSequence(startUtc, 24, 1.0);

    const pshDirectProfile = generateMonthlyPeakSunHourSolarProfile(
      fullDayDates,
      1.0,
      baseSite,
      pshAsset
    );
    const unifiedProfile = generateSolarAssetProfile(fullDayDates, 1.0, baseSite, pshAsset);

    expect(unifiedProfile).toHaveLength(24);

    for (let i = 0; i < 24; i++) {
      const direct = pshDirectProfile[i];
      const unified = unifiedProfile[i];

      expect(unified.assetId).toBe(pshAsset.id);
      expect(unified.timestampUtc).toBe(direct.timestampUtc);
      expect(unified.resourceMode).toBe('monthly_peak_sun_hours');

      // Irradiance mapping checks
      expect(unified.ghiKwPerM2).toBeCloseTo(direct.modeledGhiKwPerM2, 8);
      expect(unified.dniKwPerM2).toBeCloseTo(direct.modeledDniKwPerM2, 8);
      expect(unified.poaKwPerM2).toBeCloseTo(direct.modeledPoaKwPerM2, 8);

      // Electrical conversion mapping checks
      expect(unified.rawDcPowerKw).toBeCloseTo(direct.rawDcPowerKw, 8);
      expect(unified.dcPowerAfterLossesKw).toBeCloseTo(direct.dcPowerAfterLossesKw, 8);
      expect(unified.unclippedAcPowerKw).toBeCloseTo(direct.unclippedAcPowerKw, 8);
      expect(unified.acPowerKw).toBeCloseTo(direct.acPowerKw, 8);
      expect(unified.dcEnergyKwh).toBeCloseTo(direct.dcEnergyKwh, 8);
      expect(unified.acEnergyKwh).toBeCloseTo(direct.acEnergyKwh, 8);
      expect(unified.clippedEnergyKwh).toBeCloseTo(direct.clippedEnergyKwh, 8);
    }
  });

  // --------------------------------------------------------------------------
  // D. Unsupported weather mode
  // --------------------------------------------------------------------------
  it('D. throws clear error when resourceMode is weather_file', () => {
    const weatherAsset: SolarGenerationAsset = {
      ...clearSkyAsset,
      resourceMode: 'weather_file',
    };
    const dates = generateDateSequence(new Date('2026-07-15T07:00:00Z'), 6, 1.0);

    expect(() =>
      generateSolarAssetProfile(dates, 1.0, baseSite, weatherAsset)
    ).toThrow(/weather-file resource mode is not implemented yet/i);
  });

  // --------------------------------------------------------------------------
  // E. Two-array aggregation
  // --------------------------------------------------------------------------
  it('E. correctly aggregates two solar arrays across all powers, energies, and clipping', () => {
    // Array 1: 6 kW DC on 5 kW inverter, South facing
    const array1: SolarGenerationAsset = {
      ...clearSkyAsset,
      id: 'array-1',
      dcCapacityKw: 6.0,
      inverterAcCapacityKw: 5.0,
      tiltDegrees: 20,
      azimuthDegrees: 180,
    };

    // Array 2: 4 kW DC on 4 kW inverter, West facing
    const array2: SolarGenerationAsset = {
      ...clearSkyAsset,
      id: 'array-2',
      dcCapacityKw: 4.0,
      inverterAcCapacityKw: 4.0,
      tiltDegrees: 20,
      azimuthDegrees: 270,
    };

    const dates = generateDateSequence(new Date('2026-07-15T14:00:00Z'), 10, 1.0);

    const profile1 = generateSolarAssetProfile(dates, 1.0, baseSite, array1);
    const profile2 = generateSolarAssetProfile(dates, 1.0, baseSite, array2);
    const fleetProfile = generateSolarFleetProfile(dates, 1.0, baseSite, [array1, array2]);

    expect(fleetProfile).toHaveLength(dates.length);

    for (let i = 0; i < dates.length; i++) {
      const p1 = profile1[i];
      const p2 = profile2[i];
      const f = fleetProfile[i];

      expect(f.timestampUtc).toBe(dates[i].toISOString());
      expect(f.totalRawDcPowerKw).toBeCloseTo(p1.rawDcPowerKw + p2.rawDcPowerKw, 8);
      expect(f.totalDcPowerAfterLossesKw).toBeCloseTo(
        p1.dcPowerAfterLossesKw + p2.dcPowerAfterLossesKw,
        8
      );
      expect(f.totalUnclippedAcPowerKw).toBeCloseTo(
        p1.unclippedAcPowerKw + p2.unclippedAcPowerKw,
        8
      );
      expect(f.totalAcPowerKw).toBeCloseTo(p1.acPowerKw + p2.acPowerKw, 8);
      expect(f.totalDcEnergyKwh).toBeCloseTo(p1.dcEnergyKwh + p2.dcEnergyKwh, 8);
      expect(f.totalAcEnergyKwh).toBeCloseTo(p1.acEnergyKwh + p2.acEnergyKwh, 8);
      expect(f.totalClippedEnergyKwh).toBeCloseTo(p1.clippedEnergyKwh + p2.clippedEnergyKwh, 8);
    }
  });

  // --------------------------------------------------------------------------
  // F. Mixed resource modes
  // --------------------------------------------------------------------------
  it('F. aggregates a mixed fleet containing one clear_sky array and one monthly_peak_sun_hours array', () => {
    // Complete local day required when PSH array is present
    const startUtc = new Date('2026-07-15T07:00:00Z');
    const fullDayDates = generateDateSequence(startUtc, 24, 1.0);

    const clearSkyArr: SolarGenerationAsset = {
      ...clearSkyAsset,
      id: 'clear-sky-array',
      dcCapacityKw: 5.0,
      inverterAcCapacityKw: 5.0,
    };

    const pshArr: SolarGenerationAsset = {
      ...pshAsset,
      id: 'psh-array',
      dcCapacityKw: 7.0,
      inverterAcCapacityKw: 7.0,
    };

    const profClearSky = generateSolarAssetProfile(fullDayDates, 1.0, baseSite, clearSkyArr);
    const profPsh = generateSolarAssetProfile(fullDayDates, 1.0, baseSite, pshArr);
    const fleet = generateSolarFleetProfile(fullDayDates, 1.0, baseSite, [clearSkyArr, pshArr]);

    expect(fleet).toHaveLength(24);

    for (let i = 0; i < 24; i++) {
      const c = profClearSky[i];
      const p = profPsh[i];
      const f = fleet[i];

      expect(f.totalAcEnergyKwh).toBeCloseTo(c.acEnergyKwh + p.acEnergyKwh, 8);
      expect(f.totalDcEnergyKwh).toBeCloseTo(c.dcEnergyKwh + p.dcEnergyKwh, 8);
      expect(f.totalAcPowerKw).toBeCloseTo(c.acPowerKw + p.acPowerKw, 8);
      expect(f.totalClippedEnergyKwh).toBeCloseTo(c.clippedEnergyKwh + p.clippedEnergyKwh, 8);
    }
  });

  // --------------------------------------------------------------------------
  // G. Disabled array in fleet
  // --------------------------------------------------------------------------
  it('G. includes only enabled array production when combining enabled and disabled arrays', () => {
    const enabledArray: SolarGenerationAsset = {
      ...clearSkyAsset,
      id: 'enabled-array',
      enabled: true,
      dcCapacityKw: 8.0,
    };

    const disabledArray: SolarGenerationAsset = {
      ...clearSkyAsset,
      id: 'disabled-array',
      enabled: false,
      dcCapacityKw: 12.0,
    };

    const dates = generateDateSequence(new Date('2026-07-15T17:00:00Z'), 6, 1.0);

    const fleet = generateSolarFleetProfile(dates, 1.0, baseSite, [enabledArray, disabledArray]);
    const enabledOnly = generateSolarAssetProfile(dates, 1.0, baseSite, enabledArray);

    for (let i = 0; i < dates.length; i++) {
      expect(fleet[i].totalAcPowerKw).toBeCloseTo(enabledOnly[i].acPowerKw, 8);
      expect(fleet[i].totalAcEnergyKwh).toBeCloseTo(enabledOnly[i].acEnergyKwh, 8);
      expect(fleet[i].totalDcEnergyKwh).toBeCloseTo(enabledOnly[i].dcEnergyKwh, 8);
    }
  });

  // --------------------------------------------------------------------------
  // H. Empty fleet invariant (critical regression)
  // --------------------------------------------------------------------------
  it('H. returns zero generation without requiring configured site when assets is empty', () => {
    const unconfiguredSite: GenerationSite = {
      latitude: null,
      longitude: null,
      timeZone: '',
      elevationM: null,
    };

    const dates = generateDateSequence(new Date('2026-07-15T12:00:00Z'), 12, 1.0);

    const fleet = generateSolarFleetProfile(dates, 1.0, unconfiguredSite, []);

    expect(fleet).toHaveLength(dates.length);

    for (let i = 0; i < dates.length; i++) {
      expect(fleet[i].timestampUtc).toBe(dates[i].toISOString());
      expect(fleet[i].totalRawDcPowerKw).toBe(0);
      expect(fleet[i].totalDcPowerAfterLossesKw).toBe(0);
      expect(fleet[i].totalUnclippedAcPowerKw).toBe(0);
      expect(fleet[i].totalAcPowerKw).toBe(0);
      expect(fleet[i].totalDcEnergyKwh).toBe(0);
      expect(fleet[i].totalAcEnergyKwh).toBe(0);
      expect(fleet[i].totalClippedEnergyKwh).toBe(0);
    }
  });

  // --------------------------------------------------------------------------
  // I. Common sequence validation
  // --------------------------------------------------------------------------
  describe('Sequence validation', () => {
    it('rejects empty timestamps array', () => {
      expect(() =>
        generateSolarAssetProfile([], 1.0, baseSite, clearSkyAsset)
      ).toThrow(/at least one timestamp/i);

      expect(() =>
        generateSolarFleetProfile([], 1.0, baseSite, [clearSkyAsset])
      ).toThrow(/at least one timestamp/i);
    });

    it('rejects invalid Date object in sequence', () => {
      const dates = [
        new Date('2026-07-15T12:00:00Z'),
        new Date('invalid-date-string'),
      ];
      expect(() =>
        generateSolarAssetProfile(dates, 1.0, baseSite, clearSkyAsset)
      ).toThrow(/Invalid Date object/i);
    });

    it('rejects duplicate timestamps', () => {
      const dates = [
        new Date('2026-07-15T12:00:00Z'),
        new Date('2026-07-15T12:00:00Z'),
      ];
      expect(() =>
        generateSolarAssetProfile(dates, 1.0, baseSite, clearSkyAsset)
      ).toThrow(/strictly increasing/i);
    });

    it('rejects out-of-order timestamps', () => {
      const dates = [
        new Date('2026-07-15T14:00:00Z'),
        new Date('2026-07-15T13:00:00Z'),
      ];
      expect(() =>
        generateSolarAssetProfile(dates, 1.0, baseSite, clearSkyAsset)
      ).toThrow(/strictly increasing/i);
    });

    it('rejects irregular interval spacing', () => {
      const dates = [
        new Date('2026-07-15T12:00:00Z'),
        new Date('2026-07-15T13:30:00Z'), // 1.5h step instead of 1.0h
      ];
      expect(() =>
        generateSolarAssetProfile(dates, 1.0, baseSite, clearSkyAsset)
      ).toThrow(/Irregular interval spacing/i);
    });

    it('rejects intervalHours <= 0 or non-finite', () => {
      const dates = [new Date('2026-07-15T12:00:00Z')];
      expect(() =>
        generateSolarAssetProfile(dates, 0, baseSite, clearSkyAsset)
      ).toThrow(/intervalHours/i);

      expect(() =>
        generateSolarAssetProfile(dates, -1, baseSite, clearSkyAsset)
      ).toThrow(/intervalHours/i);

      expect(() =>
        generateSolarAssetProfile(dates, NaN, baseSite, clearSkyAsset)
      ).toThrow(/intervalHours/i);
    });
  });

  // --------------------------------------------------------------------------
  // J. Input immutability
  // --------------------------------------------------------------------------
  it('J. preserves purity by never mutating inputs', () => {
    // 24 hours of complete local day in America/Los_Angeles (July 15 starts at 07:00:00Z)
    const dates = generateDateSequence(new Date('2026-07-15T07:00:00Z'), 24, 1.0);
    const datesSnapshot = JSON.stringify(dates.map((d) => d.toISOString()));
    const siteSnapshot = JSON.stringify(baseSite);
    const assetSnapshot = JSON.stringify(clearSkyAsset);
    const assetsArray = [clearSkyAsset, pshAsset];
    const assetsSnapshot = JSON.stringify(assetsArray);

    generateSolarAssetProfile(dates, 1.0, baseSite, clearSkyAsset);
    generateSolarFleetProfile(dates, 1.0, baseSite, assetsArray);

    expect(JSON.stringify(dates.map((d) => d.toISOString()))).toBe(datesSnapshot);
    expect(JSON.stringify(baseSite)).toBe(siteSnapshot);
    expect(JSON.stringify(clearSkyAsset)).toBe(assetSnapshot);
    expect(JSON.stringify(assetsArray)).toBe(assetsSnapshot);
  });
});
