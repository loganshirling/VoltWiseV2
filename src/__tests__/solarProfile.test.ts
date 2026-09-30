import { describe, it, expect } from 'vitest';
import {
  generateMonthlyPeakSunHourSolarProfile,
  summarizeSolarGenerationProfile,
  calculateMonthlyPeakSunHourSolarInterval,
  getLocalDateAndMonth,
  validateTimeZone,
  validateAssetForMonthlyPsh,
} from '../utils/solarProfile';
import { GenerationSite, SolarGenerationAsset } from '../types/energy';
import { createDefaultSolarAsset } from '../utils/generationDefaults';

describe('G2B Milestone — Monthly Peak-Sun-Hour Solar Profile & Summaries', () => {
  const baseSite: GenerationSite = {
    latitude: 37.7749, // San Francisco, CA
    longitude: -122.4194,
    timeZone: 'America/Los_Angeles',
    elevationM: 16,
  };

  const baseAsset: SolarGenerationAsset = {
    ...createDefaultSolarAsset('solar-psh-test', 'Rooftop Solar Array'),
    dcCapacityKw: 10.0,
    tiltDegrees: 20,
    azimuthDegrees: 180, // South
    inverterAcCapacityKw: 8.0,
    inverterEfficiencyPercent: 96.0,
    systemLossPercent: 14.0,
    shadingLossPercent: 0.0,
    annualDegradationPercent: 0.5,
    resourceMode: 'monthly_peak_sun_hours',
    monthlyPeakSunHoursPerDay: [3.0, 3.8, 5.0, 6.0, 6.8, 7.2, 5.5, 6.5, 5.8, 4.5, 3.2, 2.8],
  };

  /**
   * Helper to generate a sequence of regularly spaced UTC Date objects.
   */
  function generateDateSequence(
    startUtc: Date,
    count: number,
    intervalHours: number
  ): Date[] {
    const stepMs = Math.round(intervalHours * 3600 * 1000);
    const dates: Date[] = [];
    for (let i = 0; i < count; i++) {
      dates.push(new Date(startUtc.getTime() + i * stepMs));
    }
    return dates;
  }

  // --------------------------------------------------------------------------
  // 1. Exact Daily Normalization (1-hour & 15-minute intervals)
  // --------------------------------------------------------------------------
  describe('Exact daily normalization', () => {
    it('normalizes a complete day of 1-hour intervals to exactly target PSH = 5.0 within tight tolerance', () => {
      // 2026-07-15 in America/Los_Angeles (PDT: UTC-7) starts at 2026-07-15 07:00:00 UTC
      const startUtc = new Date('2026-07-15T07:00:00Z');
      const hourlyDates = generateDateSequence(startUtc, 24, 1.0);

      const assetWith5Psh: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [5, 5, 5, 5, 5, 5, 5.0, 5, 5, 5, 5, 5],
      };

      const profile = generateMonthlyPeakSunHourSolarProfile(
        hourlyDates,
        1.0,
        baseSite,
        assetWith5Psh
      );
      expect(profile).toHaveLength(24);

      const dailyModeledGhi = profile.reduce(
        (sum, int) => sum + int.modeledGhiKwPerM2 * 1.0,
        0
      );

      expect(dailyModeledGhi).toBeCloseTo(5.0, 9);
      expect(profile[0].targetPeakSunHoursPerDay).toBe(5.0);
    });

    it('normalizes a complete day of 15-minute intervals to exactly target PSH = 5.0 within tight tolerance', () => {
      const startUtc = new Date('2026-07-15T07:00:00Z');
      const quarterHourDates = generateDateSequence(startUtc, 96, 0.25);

      const assetWith5Psh: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [5, 5, 5, 5, 5, 5, 5.0, 5, 5, 5, 5, 5],
      };

      const profile = generateMonthlyPeakSunHourSolarProfile(
        quarterHourDates,
        0.25,
        baseSite,
        assetWith5Psh
      );
      expect(profile).toHaveLength(96);

      const dailyModeledGhi = profile.reduce(
        (sum, int) => sum + int.modeledGhiKwPerM2 * 0.25,
        0
      );

      // Both 1h and 15min normalize independently to the exact same daily PSH target
      expect(dailyModeledGhi).toBeCloseTo(5.0, 9);
    });
  });

  // --------------------------------------------------------------------------
  // 2. Mandatory Timezone Validation
  // --------------------------------------------------------------------------
  describe('Mandatory timezone validation', () => {
    it('rejects empty timezone string', () => {
      const emptyTzSite: GenerationSite = { ...baseSite, timeZone: '' };
      const startUtc = new Date('2026-07-15T07:00:00Z');
      const dates = generateDateSequence(startUtc, 24, 1.0);

      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(dates, 1.0, emptyTzSite, baseAsset)
      ).toThrow(/timeZone/i);

      expect(() => validateTimeZone('')).toThrow(/timeZone/i);
      expect(() => getLocalDateAndMonth(startUtc, '')).toThrow(/timeZone/i);
    });

    it('rejects invalid timezone string Not/A_TimeZone', () => {
      const invalidTzSite: GenerationSite = { ...baseSite, timeZone: 'Not/A_TimeZone' };
      const startUtc = new Date('2026-07-15T07:00:00Z');
      const dates = generateDateSequence(startUtc, 24, 1.0);

      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(dates, 1.0, invalidTzSite, baseAsset)
      ).toThrow(/Invalid IANA timeZone/i);

      expect(() => validateTimeZone('Not/A_TimeZone')).toThrow(/Invalid IANA timeZone/i);
      expect(() => getLocalDateAndMonth(startUtc, 'Not/A_TimeZone')).toThrow(/Invalid IANA timeZone/i);
    });

    it('accepts explicit UTC and canonical IANA timezones', () => {
      expect(validateTimeZone('UTC')).toBe('UTC');
      expect(validateTimeZone('America/Detroit')).toBe('America/Detroit');
      expect(validateTimeZone('America/Los_Angeles')).toBe('America/Los_Angeles');
    });
  });

  // --------------------------------------------------------------------------
  // 3. Local Month Boundary vs UTC Month Boundary
  // --------------------------------------------------------------------------
  describe('Local month boundary resolution', () => {
    it('proves the PSH value comes from the local month (June) rather than UTC month (July) near boundary', () => {
      // In America/Los_Angeles (PDT: UTC-7):
      // Complete local day of 2026-06-30 runs from 2026-06-30 07:00:00 UTC to 2026-07-01 07:00:00 UTC.
      // Notice that UTC instants from 2026-07-01 00:00:00Z to 06:00:00Z fall into July in UTC!
      const startUtc = new Date('2026-06-30T07:00:00Z');
      const dates = generateDateSequence(startUtc, 24, 1.0);

      // Asset has June (index 5) PSH = 4.0 and July (index 6) PSH = 7.0
      const assetWithDistinctMonths: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [3, 3, 3, 3, 3, 4.0, 7.0, 3, 3, 3, 3, 3],
      };

      const profile = generateMonthlyPeakSunHourSolarProfile(
        dates,
        1.0,
        baseSite,
        assetWithDistinctMonths
      );
      expect(profile).toHaveLength(24);

      // Every single interval in this local day must be assigned to local June (monthIndex 5)
      // and have targetPeakSunHoursPerDay = 4.0 (June target, NOT July 7.0)
      for (const interval of profile) {
        expect(interval.localDate).toBe('2026-06-30');
        expect(interval.monthIndex).toBe(5);
        expect(interval.targetPeakSunHoursPerDay).toBe(4.0);
      }

      // Check an interval that is in July UTC (e.g. 2026-07-01 03:00:00Z = index 20)
      const lateUtcInterval = profile[20];
      expect(lateUtcInterval.timestampUtc).toBe('2026-07-01T03:00:00.000Z');
      expect(lateUtcInterval.localDate).toBe('2026-06-30');
      expect(lateUtcInterval.monthIndex).toBe(5); // June
      expect(lateUtcInterval.targetPeakSunHoursPerDay).toBe(4.0);

      // Daily integral normalizes to June target (4.0), not July target (7.0)
      const dailyGhi = profile.reduce((sum, int) => sum + int.modeledGhiKwPerM2 * 1.0, 0);
      expect(dailyGhi).toBeCloseTo(4.0, 9);
    });
  });

  // --------------------------------------------------------------------------
  // 4. Invalid Resource Array Validation
  // --------------------------------------------------------------------------
  describe('Resource array validation', () => {
    const validDates = generateDateSequence(new Date('2026-07-15T07:00:00Z'), 24, 1.0);

    it('rejects an array with 11 values', () => {
      const asset11: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
      };
      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(validDates, 1.0, baseSite, asset11)
      ).toThrow(/exactly 12 values/i);
      expect(() => validateAssetForMonthlyPsh(asset11)).toThrow(/exactly 12 values/i);
    });

    it('rejects an array with 13 values', () => {
      const asset13: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
      };
      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(validDates, 1.0, baseSite, asset13)
      ).toThrow(/exactly 12 values/i);
      expect(() => validateAssetForMonthlyPsh(asset13)).toThrow(/exactly 12 values/i);
    });

    it('rejects negative value in resource array', () => {
      const assetNegative: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [3, 3, -1.5, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      };
      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(validDates, 1.0, baseSite, assetNegative)
      ).toThrow(/finite number >= 0/i);
      expect(() => validateAssetForMonthlyPsh(assetNegative)).toThrow(/finite number >= 0/i);
    });

    it('rejects NaN in resource array', () => {
      const assetNaN: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [3, 3, NaN, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      };
      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(validDates, 1.0, baseSite, assetNaN)
      ).toThrow(/finite number >= 0/i);
      expect(() => validateAssetForMonthlyPsh(assetNaN)).toThrow(/finite number >= 0/i);
    });

    it('rejects Infinity in resource array', () => {
      const assetInf: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [3, 3, Infinity, 3, 3, 3, 3, 3, 3, 3, 3, 3],
      };
      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(validDates, 1.0, baseSite, assetInf)
      ).toThrow(/finite number >= 0/i);
      expect(() => validateAssetForMonthlyPsh(assetInf)).toThrow(/finite number >= 0/i);
    });
  });

  // --------------------------------------------------------------------------
  // 5. Wrong Resource Mode Validation
  // --------------------------------------------------------------------------
  describe('Resource mode validation', () => {
    it('rejects an asset whose resourceMode is clear_sky or weather_file', () => {
      const clearSkyAsset: SolarGenerationAsset = {
        ...baseAsset,
        resourceMode: 'clear_sky',
      };
      const dates = generateDateSequence(new Date('2026-07-15T07:00:00Z'), 24, 1.0);

      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(dates, 1.0, baseSite, clearSkyAsset)
      ).toThrow(/Invalid resourceMode.*clear_sky/i);

      expect(() => validateAssetForMonthlyPsh(clearSkyAsset)).toThrow(/Invalid resourceMode/i);
    });
  });

  // --------------------------------------------------------------------------
  // 6. Partial Local Day Validation
  // --------------------------------------------------------------------------
  describe('Complete local calendar day validation', () => {
    const fullDayDates = generateDateSequence(new Date('2026-07-15T07:00:00Z'), 24, 1.0);

    it('rejects a profile missing the beginning of a local day (starts after 00:00)', () => {
      // Starts at local 01:00 (index 1)
      const partialStartDates = fullDayDates.slice(1);
      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(partialStartDates, 1.0, baseSite, baseAsset)
      ).toThrow(/Incomplete local day.*does not start at local 00:00:00/i);
    });

    it('rejects a profile missing the end of a local day (ends before next midnight)', () => {
      // Ends at local 21:00 (22 intervals)
      const partialEndDates = fullDayDates.slice(0, 22);
      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(partialEndDates, 1.0, baseSite, baseAsset)
      ).toThrow(/Incomplete local day.*does not end at the boundary/i);
    });

    it('rejects an empty instantsUtc array', () => {
      expect(() =>
        generateMonthlyPeakSunHourSolarProfile([], 1.0, baseSite, baseAsset)
      ).toThrow(/at least one timestamp/i);
    });
  });

  // --------------------------------------------------------------------------
  // 7. Irregular Spacing Validation
  // --------------------------------------------------------------------------
  describe('Interval spacing validation', () => {
    it('rejects missing interval (gap in timestamps)', () => {
      const startUtc = new Date('2026-07-15T07:00:00Z');
      const dates = generateDateSequence(startUtc, 24, 1.0);
      // Remove index 10 to create a 2-hour gap
      dates.splice(10, 1);

      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(dates, 1.0, baseSite, baseAsset)
      ).toThrow(/Irregular interval spacing/i);
    });

    it('rejects duplicate timestamps', () => {
      const startUtc = new Date('2026-07-15T07:00:00Z');
      const dates = generateDateSequence(startUtc, 24, 1.0);
      // Duplicate index 5
      dates[6] = new Date(dates[5].getTime());

      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(dates, 1.0, baseSite, baseAsset)
      ).toThrow(/strictly increasing/i);
    });

    it('rejects incorrect timestamp spacing (e.g. 30-min step when intervalHours is 1.0)', () => {
      const startUtc = new Date('2026-07-15T07:00:00Z');
      // Create 30-min spacing but pass intervalHours = 1.0
      const dates = generateDateSequence(startUtc, 24, 0.5);

      expect(() =>
        generateMonthlyPeakSunHourSolarProfile(dates, 1.0, baseSite, baseAsset)
      ).toThrow(/Irregular interval spacing/i);
    });
  });

  // --------------------------------------------------------------------------
  // 8. Disabled Assets
  // --------------------------------------------------------------------------
  describe('Disabled asset behavior', () => {
    it('produces zero DC and AC generation for a disabled asset while keeping geometry populated', () => {
      const disabledAsset: SolarGenerationAsset = {
        ...baseAsset,
        enabled: false,
      };

      const startUtc = new Date('2026-07-15T07:00:00Z');
      const dates = generateDateSequence(startUtc, 24, 1.0);

      const profile = generateMonthlyPeakSunHourSolarProfile(
        dates,
        1.0,
        baseSite,
        disabledAsset
      );
      expect(profile).toHaveLength(24);

      // Irradiance and resource fields are populated
      expect(profile[12].clearSkyGhiKwPerM2).toBeGreaterThan(0);
      expect(profile[12].modeledGhiKwPerM2).toBeGreaterThan(0);
      expect(profile[12].resourceScaleFactor).toBeGreaterThan(0);

      // Electrical output is completely zero
      for (const int of profile) {
        expect(int.rawDcPowerKw).toBe(0);
        expect(int.dcPowerAfterLossesKw).toBe(0);
        expect(int.unclippedAcPowerKw).toBe(0);
        expect(int.acPowerKw).toBe(0);
        expect(int.dcEnergyKwh).toBe(0);
        expect(int.acEnergyKwh).toBe(0);
        expect(int.clippedEnergyKwh).toBe(0);
      }

      const summary = summarizeSolarGenerationProfile(profile);
      expect(summary.totalDcEnergyKwh).toBe(0);
      expect(summary.totalAcEnergyKwh).toBe(0);
      expect(summary.totalClippedEnergyKwh).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 9. Daylight Saving Time (DST) Transitions
  // --------------------------------------------------------------------------
  describe('DST handling (America/Detroit)', () => {
    const detroitSite: GenerationSite = {
      latitude: 42.3314, // Detroit, MI
      longitude: -83.0458,
      timeZone: 'America/Detroit',
      elevationM: 180,
    };

    it('accepts valid 23-hour local day on Spring Forward DST transition without requiring 24 hours', () => {
      // In America/Detroit, Spring Forward in 2026 occurs on Sunday, March 8:
      // Local 00:00 EST = 2026-03-08 05:00:00 UTC
      // Local 24:00 (March 9 00:00 EDT) = 2026-03-09 04:00:00 UTC
      // Total elapsed hours = 23 hours!
      const springForwardStartUtc = new Date('2026-03-08T05:00:00Z');
      const springForwardDates = generateDateSequence(springForwardStartUtc, 23, 1.0);

      const detroitAsset: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [3, 3, 4.5, 3, 3, 3, 3, 3, 3, 3, 3, 3], // March = 4.5
      };

      const profile = generateMonthlyPeakSunHourSolarProfile(
        springForwardDates,
        1.0,
        detroitSite,
        detroitAsset
      );

      // Successfully accepted 23 intervals
      expect(profile).toHaveLength(23);
      for (const int of profile) {
        expect(int.localDate).toBe('2026-03-08');
        expect(int.monthIndex).toBe(2); // March
      }

      // Normalizes correctly to March target PSH (4.5)
      const dailyGhi = profile.reduce((sum, int) => sum + int.modeledGhiKwPerM2 * 1.0, 0);
      expect(dailyGhi).toBeCloseTo(4.5, 9);
    });

    it('accepts valid 25-hour local day on Fall Back DST transition without requiring 24 hours', () => {
      // In America/Detroit, Fall Back in 2026 occurs on Sunday, Nov 1:
      // Local 00:00 EDT = 2026-11-01 04:00:00 UTC
      // Local 24:00 (Nov 2 00:00 EST) = 2026-11-02 05:00:00 UTC
      // Total elapsed hours = 25 hours!
      const fallBackStartUtc = new Date('2026-11-01T04:00:00Z');
      const fallBackDates = generateDateSequence(fallBackStartUtc, 25, 1.0);

      const detroitAsset: SolarGenerationAsset = {
        ...baseAsset,
        monthlyPeakSunHoursPerDay: [3, 3, 3, 3, 3, 3, 3, 3, 3, 3, 2.5, 3], // Nov = 2.5
      };

      const profile = generateMonthlyPeakSunHourSolarProfile(
        fallBackDates,
        1.0,
        detroitSite,
        detroitAsset
      );

      expect(profile).toHaveLength(25);
      for (const int of profile) {
        expect(int.localDate).toBe('2026-11-01');
        expect(int.monthIndex).toBe(10); // Nov
      }

      const dailyGhi = profile.reduce((sum, int) => sum + int.modeledGhiKwPerM2 * 1.0, 0);
      expect(dailyGhi).toBeCloseTo(2.5, 9);
    });
  });

  // --------------------------------------------------------------------------
  // 10. Orientation Physics & Inverter Clipping Regressions
  // --------------------------------------------------------------------------
  describe('Preserved solar physics and summaries', () => {
    it('preserves panel orientation differences: south-facing produces substantially more than north-facing', () => {
      const southAsset: SolarGenerationAsset = {
        ...baseAsset,
        tiltDegrees: 30,
        azimuthDegrees: 180, // South
      };
      const northAsset: SolarGenerationAsset = {
        ...baseAsset,
        tiltDegrees: 30,
        azimuthDegrees: 0, // North
      };

      const midLatSite: GenerationSite = {
        latitude: 38,
        longitude: 0,
        timeZone: 'UTC',
        elevationM: 0,
      };
      const midday = new Date('2026-03-20T12:00:00Z');

      const southRes = calculateMonthlyPeakSunHourSolarInterval(midday, 1.0, midLatSite, southAsset);
      const northRes = calculateMonthlyPeakSunHourSolarInterval(midday, 1.0, midLatSite, northAsset);

      expect(southRes.clearSkyGhiKwPerM2).toBeCloseTo(northRes.clearSkyGhiKwPerM2, 5);
      expect(southRes.modeledGhiKwPerM2).toBeCloseTo(northRes.modeledGhiKwPerM2, 5);

      expect(southRes.modeledPoaKwPerM2).toBeGreaterThan(northRes.modeledPoaKwPerM2 * 1.5);
      expect(southRes.acEnergyKwh).toBeGreaterThan(northRes.acEnergyKwh * 1.5);
    });

    it('clips modeled AC power to inverterAcCapacityKw and records positive clipped energy', () => {
      const highDcAsset: SolarGenerationAsset = {
        ...baseAsset,
        dcCapacityKw: 20.0,
        inverterAcCapacityKw: 5.0,
        inverterEfficiencyPercent: 100.0,
        systemLossPercent: 0,
        shadingLossPercent: 0,
        monthlyPeakSunHoursPerDay: [8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8, 8],
      };

      const solarNoon = new Date('2026-07-15T20:09:00Z');
      const result = calculateMonthlyPeakSunHourSolarInterval(solarNoon, 1.0, baseSite, highDcAsset);

      expect(result.unclippedAcPowerKw).toBeGreaterThan(5.0);
      expect(result.acPowerKw).toBe(5.0);
      expect(result.clippedEnergyKwh).toBeGreaterThan(0);
      expect(result.clippedEnergyKwh).toBeCloseTo(result.unclippedAcPowerKw - 5.0, 5);
    });

    it('returns zero modeled irradiance and zero power at night', () => {
      const midnight = new Date('2026-07-15T07:00:00Z'); // 00:00 PDT
      const result = calculateMonthlyPeakSunHourSolarInterval(midnight, 1.0, baseSite, baseAsset);

      expect(result.position.isDaylight).toBe(false);
      expect(result.clearSkyGhiKwPerM2).toBe(0);
      expect(result.modeledGhiKwPerM2).toBe(0);
      expect(result.acPowerKw).toBe(0);
      expect(result.acEnergyKwh).toBe(0);
    });

    it('creates 12-month summary structure with matching monthly and total sums', () => {
      // 2 complete local days in July
      const startUtc = new Date('2026-07-15T07:00:00Z');
      const dates = generateDateSequence(startUtc, 48, 1.0);

      const profile = generateMonthlyPeakSunHourSolarProfile(dates, 1.0, baseSite, baseAsset);
      const summary = summarizeSolarGenerationProfile(profile);

      expect(summary.intervalCount).toBe(48);
      expect(summary.monthly).toHaveLength(12);

      const sumMonthlyAc = summary.monthly.reduce((sum, m) => sum + m.acEnergyKwh, 0);
      expect(sumMonthlyAc).toBeCloseTo(summary.totalAcEnergyKwh, 6);

      // July has 48 intervals, other months have 0
      expect(summary.monthly[6].intervalCount).toBe(48);
      expect(summary.monthly[0].intervalCount).toBe(0);
    });

    it('preserves purity by not mutating site or asset objects', () => {
      const siteSnapshot = JSON.stringify(baseSite);
      const assetSnapshot = JSON.stringify(baseAsset);

      const dates = generateDateSequence(new Date('2026-07-15T07:00:00Z'), 24, 1.0);
      generateMonthlyPeakSunHourSolarProfile(dates, 1.0, baseSite, baseAsset);

      expect(JSON.stringify(baseSite)).toBe(siteSnapshot);
      expect(JSON.stringify(baseAsset)).toBe(assetSnapshot);
    });
  });
});
