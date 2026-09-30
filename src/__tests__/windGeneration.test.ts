import { describe, it, expect } from 'vitest';
import {
  generateWindAssetProfile,
  generateWindFleetProfile,
  summarizeWindFleetProfile,
} from '../utils/windGeneration';
import {
  alignLoadTimestampsToSite,
  AlignedLoadTimestamp,
} from '../utils/loadTimeAlignment';
import {
  calculateStandardAirDensityRatio,
  simulateWindIntervalExpectedEnergy,
} from '../utils/windModel';
import {
  GenerationSite,
  IntervalDataPoint,
  SolarGenerationAsset,
  GeneratorGenerationAsset,
  WindGenerationAsset,
  WindPowerCurvePoint,
} from '../types/energy';

function createValidWindAsset(
  overrides?: Partial<WindGenerationAsset>
): WindGenerationAsset {
  const defaultCurve: WindPowerCurvePoint[] = [
    { windSpeedMps: 0.0, outputKw: 0.0 },
    { windSpeedMps: 3.0, outputKw: 0.0 },
    { windSpeedMps: 6.0, outputKw: 2.0 },
    { windSpeedMps: 9.0, outputKw: 6.5 },
    { windSpeedMps: 12.0, outputKw: 10.0 },
    { windSpeedMps: 25.0, outputKw: 10.0 },
  ];

  return {
    id: 'wind_turbine_1',
    name: 'Residential 10kW Turbine',
    type: 'wind',
    enabled: true,
    installedCostUsd: 15000,
    annualMaintenanceCostUsd: 250,
    ratedPowerKw: 10.0,
    hubHeightM: 30.0,
    rotorDiameterM: 10.0,
    measurementHeightM: 10.0,
    windShearExponent: 0.143,
    cutInWindSpeedMps: 3.0,
    ratedWindSpeedMps: 12.0,
    cutOutWindSpeedMps: 25.0,
    availabilityPercent: 95.0,
    systemLossPercent: 5.0,
    powerCurve: defaultCurve,
    resourceMode: 'annual_average',
    annualAverageWindSpeedMps: 6.5,
    monthlyAverageWindSpeedMps: [
      5.0, 5.5, 6.0, 6.5, 7.0, 7.5, 8.0, 7.5, 7.0, 6.5, 5.5, 5.0,
    ],
    ...overrides,
  };
}

function createSampleSite(overrides?: Partial<GenerationSite>): GenerationSite {
  return {
    latitude: 37.77,
    longitude: -122.42,
    timeZone: 'America/Los_Angeles',
    elevationM: 10,
    ...overrides,
  };
}

function createHourlyDateRange(startDateIso: string, count: number): Date[] {
  const startMs = new Date(startDateIso).getTime();
  const dates: Date[] = [];
  for (let i = 0; i < count; i++) {
    dates.push(new Date(startMs + i * 3600 * 1000));
  }
  return dates;
}

describe('G5B — Wind Generation Profile & Fleet Aggregation', () => {
  // ==========================================================================
  // G5A Prerequisite Correction
  // ==========================================================================
  describe('G5A Prerequisite Correction — Air Density Ratio', () => {
    it('1. negative finite elevation such as -100 m produces density ratio > 1.0', () => {
      const ratio = calculateStandardAirDensityRatio(-100);
      expect(ratio).toBeGreaterThan(1.0);
      expect(ratio).toBeCloseTo(
        Math.pow(1 - (0.0065 * -100) / 288.15, 4.25588),
        5
      );
    });

    it('2. null and undefined elevation return 1.0 (sea level)', () => {
      expect(calculateStandardAirDensityRatio(null)).toBe(1.0);
      expect(calculateStandardAirDensityRatio(undefined)).toBe(1.0);
    });

    it('3. zero elevation returns 1.0 (sea level)', () => {
      expect(calculateStandardAirDensityRatio(0)).toBe(1.0);
    });

    it('4. positive elevation produces density ratio < 1.0', () => {
      const ratio = calculateStandardAirDensityRatio(1500);
      expect(ratio).toBeLessThan(1.0);
      expect(ratio).toBeGreaterThan(0.7);
      expect(ratio).toBeCloseTo(
        Math.pow(1 - (0.0065 * 1500) / 288.15, 4.25588),
        5
      );
    });

    it('proves negative elevation increases wind power compared to sea-level', () => {
      const asset = createValidWindAsset();
      const timestamps = createHourlyDateRange('2026-06-01T00:00:00.000Z', 1);

      const profileSeaLevel = generateWindAssetProfile(
        timestamps,
        1,
        asset,
        createSampleSite({ elevationM: 0 })
      );
      const profileBelowSeaLevel = generateWindAssetProfile(
        timestamps,
        1,
        asset,
        createSampleSite({ elevationM: -100 })
      );

      // Higher air density below sea level produces higher power
      expect(profileBelowSeaLevel[0].expectedNetPowerKw).toBeGreaterThan(
        profileSeaLevel[0].expectedNetPowerKw
      );
    });
  });

  // ==========================================================================
  // Annual-Average Mode
  // ==========================================================================
  describe('Annual-Average Resource Mode', () => {
    it('5. annual-average profile preserves interval count', () => {
      const asset = createValidWindAsset({ resourceMode: 'annual_average' });
      const timestamps = createHourlyDateRange('2026-01-01T00:00:00.000Z', 24);
      const site = createSampleSite();

      const profile = generateWindAssetProfile(timestamps, 1, asset, site);
      expect(profile).toHaveLength(24);
    });

    it('6. annual mode uses the configured annual mean wind speed', () => {
      const asset = createValidWindAsset({
        resourceMode: 'annual_average',
        annualAverageWindSpeedMps: 7.2,
      });
      const timestamps = createHourlyDateRange('2026-01-01T00:00:00.000Z', 5);
      const profile = generateWindAssetProfile(timestamps, 1, asset, createSampleSite());

      for (const interval of profile) {
        expect(interval.resourceMode).toBe('annual_average');
        expect(interval.resourceMeanWindSpeedMps).toBe(7.2);
      }
    });

    it('7. annual-mode expected power remains deterministic across intervals', () => {
      const asset = createValidWindAsset({ resourceMode: 'annual_average' });
      const timestamps = createHourlyDateRange('2026-01-01T00:00:00.000Z', 10);
      const site = createSampleSite();

      const profile = generateWindAssetProfile(timestamps, 1, asset, site);
      const expectedPower = profile[0].expectedNetPowerKw;

      expect(expectedPower).toBeGreaterThan(0);
      for (let i = 1; i < profile.length; i++) {
        expect(profile[i].expectedNetPowerKw).toBe(expectedPower);
      }
    });

    it('8. hourly interval energy is correct (energyKwh = netPowerKw * 1.0)', () => {
      const asset = createValidWindAsset({ resourceMode: 'annual_average' });
      const timestamps = createHourlyDateRange('2026-01-01T00:00:00.000Z', 4);
      const profile = generateWindAssetProfile(timestamps, 1, asset, createSampleSite());

      for (const interval of profile) {
        expect(interval.energyKwh).toBeCloseTo(interval.expectedNetPowerKw * 1.0, 8);
      }
    });

    it('9. sub-hourly interval energy is correct (15-minute = 0.25h)', () => {
      const asset = createValidWindAsset({ resourceMode: 'annual_average' });
      const startMs = new Date('2026-01-01T00:00:00.000Z').getTime();
      const timestamps = [0, 1, 2, 3].map(
        (i) => new Date(startMs + i * 15 * 60 * 1000)
      );

      const profile = generateWindAssetProfile(timestamps, 0.25, asset, createSampleSite());
      for (const interval of profile) {
        expect(interval.energyKwh).toBeCloseTo(interval.expectedNetPowerKw * 0.25, 8);
      }
    });
  });

  // ==========================================================================
  // Monthly-Average Mode
  // ==========================================================================
  describe('Monthly-Average Resource Mode', () => {
    it('10. correct monthly resource value is selected for each interval', () => {
      const monthlySpeeds = [
        3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 8.5, 7.5, 6.5, 4.5, 3.5,
      ];
      const asset = createValidWindAsset({
        resourceMode: 'monthly_average',
        monthlyAverageWindSpeedMps: monthlySpeeds,
      });
      const site = createSampleSite({ timeZone: 'UTC' });

      // Mid-month UTC timestamps for Jan, March, July, Dec
      const dates = [
        new Date('2026-01-15T12:00:00.000Z'),
        new Date('2026-03-15T12:00:00.000Z'),
        new Date('2026-07-15T12:00:00.000Z'),
        new Date('2026-12-15T12:00:00.000Z'),
      ];

      const profile = generateWindAssetProfile(dates, 1, asset, site);

      expect(profile[0].resourceMeanWindSpeedMps).toBe(3.0); // Jan (index 0)
      expect(profile[1].resourceMeanWindSpeedMps).toBe(5.0); // March (index 2)
      expect(profile[2].resourceMeanWindSpeedMps).toBe(9.0); // July (index 6)
      expect(profile[3].resourceMeanWindSpeedMps).toBe(3.5); // Dec (index 11)
    });

    it('11. month is resolved in site-local time rather than UTC', () => {
      const monthlySpeeds = [
        1.0, 2.0, 3.0, 4.0, 5.0, 6.0, 7.0, 8.0, 9.0, 10.0, 11.0, 12.0,
      ];
      const asset = createValidWindAsset({
        resourceMode: 'monthly_average',
        monthlyAverageWindSpeedMps: monthlySpeeds,
      });

      // 2026-02-01T05:00:00.000Z:
      // In UTC, month is February (monthIndex = 1, speed = 2.0).
      // In America/Los_Angeles (UTC-8), local time is 2026-01-31 21:00:00 (January, monthIndex = 0, speed = 1.0).
      const instant = new Date('2026-02-01T05:00:00.000Z');

      const profileLA = generateWindAssetProfile(
        [instant],
        1,
        asset,
        createSampleSite({ timeZone: 'America/Los_Angeles' })
      );
      expect(profileLA[0].resourceMeanWindSpeedMps).toBe(1.0); // January in LA

      const profileUTC = generateWindAssetProfile(
        [instant],
        1,
        asset,
        createSampleSite({ timeZone: 'UTC' })
      );
      expect(profileUTC[0].resourceMeanWindSpeedMps).toBe(2.0); // February in UTC
    });

    it('12. a UTC/month-boundary case selects the correct local month (cross-month transition)', () => {
      const monthlySpeeds = [
        5.0, 8.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0, 5.0,
      ];
      const asset = createValidWindAsset({
        resourceMode: 'monthly_average',
        monthlyAverageWindSpeedMps: monthlySpeeds,
      });
      const site = createSampleSite({ timeZone: 'America/Los_Angeles' }); // UTC-8 in winter

      // 2026-02-01T07:59:00Z -> 2026-01-31 23:59:00 local (January, speed = 5.0)
      // 2026-02-01T08:01:00Z -> 2026-02-01 00:01:00 local (February, speed = 8.0)
      const instantJan = new Date('2026-02-01T07:59:00.000Z');
      const instantFeb = new Date('2026-02-01T08:01:00.000Z');

      const profile = generateWindAssetProfile([instantJan, instantFeb], 1, asset, site);

      expect(profile[0].resourceMeanWindSpeedMps).toBe(5.0);
      expect(profile[1].resourceMeanWindSpeedMps).toBe(8.0);
    });

    it('13. monthly expected power changes when monthly resource changes', () => {
      const asset = createValidWindAsset({
        resourceMode: 'monthly_average',
        monthlyAverageWindSpeedMps: [
          4.0, 10.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0, 4.0,
        ],
      });
      const site = createSampleSite({ timeZone: 'UTC' });

      const dates = [
        new Date('2026-01-15T00:00:00.000Z'),
        new Date('2026-02-15T00:00:00.000Z'),
      ];

      const profile = generateWindAssetProfile(dates, 1, asset, site);

      expect(profile[0].expectedNetPowerKw).toBeLessThan(
        profile[1].expectedNetPowerKw
      );
    });

    it('throws if site timezone is missing when resourceMode is monthly_average', () => {
      const asset = createValidWindAsset({ resourceMode: 'monthly_average' });
      const dates = [new Date('2026-01-15T00:00:00.000Z')];

      expect(() =>
        generateWindAssetProfile(dates, 1, asset, null)
      ).toThrow(/Site timeZone must be provided/);

      expect(() =>
        generateWindAssetProfile(dates, 1, asset, {
          latitude: 0,
          longitude: 0,
          timeZone: '',
          elevationM: 0,
        })
      ).toThrow(/Site timeZone/);
    });
  });

  // ==========================================================================
  // Timestamp Alignment & DST Behavior
  // ==========================================================================
  describe('Alignment & DST Behavior', () => {
    it('14. UTC timestamp ordering is preserved exactly', () => {
      const timestamps = createHourlyDateRange('2026-03-01T00:00:00.000Z', 10);
      const asset = createValidWindAsset();
      const profile = generateWindAssetProfile(timestamps, 1, asset, createSampleSite());

      for (let i = 0; i < timestamps.length; i++) {
        expect(profile[i].timestampUtc).toBe(timestamps[i].toISOString());
      }
    });

    it('15. DST-crossing aligned timestamps remain one-to-one', () => {
      // Create raw load points crossing spring-forward in America/Detroit (2026-03-08)
      // Clocks jump 01:59:59 EST -> 03:00:00 EDT.
      const rawPoints: IntervalDataPoint[] = [
        { timestamp: '2026-03-08 00:00', date: new Date(), hour: 0, dayOfWeek: 0, month: 3, usageKwh: 1 },
        { timestamp: '2026-03-08 01:00', date: new Date(), hour: 1, dayOfWeek: 0, month: 3, usageKwh: 1 },
        { timestamp: '2026-03-08 03:00', date: new Date(), hour: 3, dayOfWeek: 0, month: 3, usageKwh: 1 },
        { timestamp: '2026-03-08 04:00', date: new Date(), hour: 4, dayOfWeek: 0, month: 3, usageKwh: 1 },
      ];

      const aligned = alignLoadTimestampsToSite(rawPoints, 1, 'America/Detroit');
      expect(aligned).toHaveLength(4);

      const asset = createValidWindAsset();
      const site = createSampleSite({ timeZone: 'America/Detroit' });

      // Consumes aligned load timestamps
      const windProfile = generateWindAssetProfile(aligned, 1, asset, site);

      expect(windProfile).toHaveLength(4);
      for (let i = 0; i < aligned.length; i++) {
        expect(windProfile[i].timestampUtc).toBe(aligned[i].timestampUtc);
      }
    });

    it('16. no interval is inserted or omitted across DST transition', () => {
      // Fall-back with explicit offsets in Detroit: 2026-11-01 01:00 EDT (-04:00) and 01:00 EST (-05:00)
      const rawPoints: IntervalDataPoint[] = [
        { timestamp: '2026-11-01T00:00:00-04:00', date: new Date(), hour: 0, dayOfWeek: 0, month: 11, usageKwh: 1 },
        { timestamp: '2026-11-01T01:00:00-04:00', date: new Date(), hour: 1, dayOfWeek: 0, month: 11, usageKwh: 1 },
        { timestamp: '2026-11-01T01:00:00-05:00', date: new Date(), hour: 1, dayOfWeek: 0, month: 11, usageKwh: 1 },
        { timestamp: '2026-11-01T02:00:00-05:00', date: new Date(), hour: 2, dayOfWeek: 0, month: 11, usageKwh: 1 },
      ];

      const aligned = alignLoadTimestampsToSite(rawPoints, 1, 'America/Detroit');
      expect(aligned).toHaveLength(4);

      const asset = createValidWindAsset();
      const fleetProfile = generateWindFleetProfile(aligned, 1, [asset], createSampleSite({ timeZone: 'America/Detroit' }));

      expect(fleetProfile).toHaveLength(4);
      expect(fleetProfile[0].timestampUtc).toBe('2026-11-01T04:00:00.000Z');
      expect(fleetProfile[1].timestampUtc).toBe('2026-11-01T05:00:00.000Z');
      expect(fleetProfile[2].timestampUtc).toBe('2026-11-01T06:00:00.000Z');
      expect(fleetProfile[3].timestampUtc).toBe('2026-11-01T07:00:00.000Z');
    });
  });

  // ==========================================================================
  // Multi-Turbine Fleet Aggregation
  // ==========================================================================
  describe('Multi-Turbine Fleet Aggregation', () => {
    it('17. two enabled turbines sum correctly per interval', () => {
      const assetA = createValidWindAsset({ id: 'turbine_A', ratedPowerKw: 10.0, annualAverageWindSpeedMps: 6.0 });
      const assetB = createValidWindAsset({ id: 'turbine_B', ratedPowerKw: 15.0, annualAverageWindSpeedMps: 7.0 });

      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 5);
      const site = createSampleSite();

      const singleA = generateWindAssetProfile(timestamps, 1, assetA, site);
      const singleB = generateWindAssetProfile(timestamps, 1, assetB, site);
      const fleet = generateWindFleetProfile(timestamps, 1, [assetA, assetB], site);

      expect(fleet).toHaveLength(5);
      for (let i = 0; i < fleet.length; i++) {
        expect(fleet[i].totalExpectedPowerKw).toBeCloseTo(
          singleA[i].expectedNetPowerKw + singleB[i].expectedNetPowerKw,
          8
        );
        expect(fleet[i].totalEnergyKwh).toBeCloseTo(
          singleA[i].energyKwh + singleB[i].energyKwh,
          8
        );
      }
    });

    it('18. different power curves remain independent during aggregation', () => {
      const curve1: WindPowerCurvePoint[] = [
        { windSpeedMps: 0, outputKw: 0 },
        { windSpeedMps: 3, outputKw: 0 },
        { windSpeedMps: 10, outputKw: 5 },
        { windSpeedMps: 25, outputKw: 5 },
      ];
      const curve2: WindPowerCurvePoint[] = [
        { windSpeedMps: 0, outputKw: 0 },
        { windSpeedMps: 3, outputKw: 0 },
        { windSpeedMps: 10, outputKw: 10 },
        { windSpeedMps: 25, outputKw: 10 },
      ];

      const asset1 = createValidWindAsset({ id: 't1', ratedPowerKw: 5, powerCurve: curve1 });
      const asset2 = createValidWindAsset({ id: 't2', ratedPowerKw: 10, powerCurve: curve2 });

      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 1);
      const site = createSampleSite();

      const p1 = generateWindAssetProfile(timestamps, 1, asset1, site);
      const p2 = generateWindAssetProfile(timestamps, 1, asset2, site);
      const fleet = generateWindFleetProfile(timestamps, 1, [asset1, asset2], site);

      expect(p2[0].expectedNetPowerKw).toBeGreaterThan(p1[0].expectedNetPowerKw);
      expect(fleet[0].totalExpectedPowerKw).toBeCloseTo(
        p1[0].expectedNetPowerKw + p2[0].expectedNetPowerKw,
        8
      );
    });

    it('19. different hub heights remain independent during aggregation', () => {
      // Turbine with 50m hub height experiences higher hub-height speed than 20m under positive shear
      const assetLow = createValidWindAsset({ id: 'low', hubHeightM: 20, measurementHeightM: 10, windShearExponent: 0.2 });
      const assetHigh = createValidWindAsset({ id: 'high', hubHeightM: 50, measurementHeightM: 10, windShearExponent: 0.2 });

      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 1);
      const site = createSampleSite();

      const pLow = generateWindAssetProfile(timestamps, 1, assetLow, site);
      const pHigh = generateWindAssetProfile(timestamps, 1, assetHigh, site);

      expect(pHigh[0].hubHeightMeanWindSpeedMps).toBeGreaterThan(
        pLow[0].hubHeightMeanWindSpeedMps
      );
      expect(pHigh[0].expectedNetPowerKw).toBeGreaterThan(
        pLow[0].expectedNetPowerKw
      );
    });

    it('20. different resource modes remain independent across turbines', () => {
      // Turbine 1 is annual_average, Turbine 2 is monthly_average
      const assetAnnual = createValidWindAsset({
        id: 't_annual',
        resourceMode: 'annual_average',
        annualAverageWindSpeedMps: 6.0,
      });
      const assetMonthly = createValidWindAsset({
        id: 't_monthly',
        resourceMode: 'monthly_average',
        monthlyAverageWindSpeedMps: [
          3.0, 9.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0, 3.0,
        ],
      });

      const dates = [
        new Date('2026-01-15T00:00:00.000Z'),
        new Date('2026-02-15T00:00:00.000Z'),
      ];
      const site = createSampleSite({ timeZone: 'UTC' });

      const fleet = generateWindFleetProfile(dates, 1, [assetAnnual, assetMonthly], site);

      const pAnnual = generateWindAssetProfile(dates, 1, assetAnnual, site);
      const pMonthly = generateWindAssetProfile(dates, 1, assetMonthly, site);

      // Annual remains constant
      expect(pAnnual[0].expectedNetPowerKw).toBe(pAnnual[1].expectedNetPowerKw);

      // Monthly changes between Jan and Feb
      expect(pMonthly[0].expectedNetPowerKw).toBeLessThan(pMonthly[1].expectedNetPowerKw);

      // Fleet sums accurately
      expect(fleet[0].totalExpectedPowerKw).toBeCloseTo(
        pAnnual[0].expectedNetPowerKw + pMonthly[0].expectedNetPowerKw,
        8
      );
      expect(fleet[1].totalExpectedPowerKw).toBeCloseTo(
        pAnnual[1].expectedNetPowerKw + pMonthly[1].expectedNetPowerKw,
        8
      );
    });

    it('21. reversing asset order does not change fleet totals', () => {
      const asset1 = createValidWindAsset({ id: 'alpha', ratedPowerKw: 10 });
      const asset2 = createValidWindAsset({ id: 'beta', ratedPowerKw: 25 });
      const asset3 = createValidWindAsset({ id: 'gamma', ratedPowerKw: 50 });

      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 5);
      const site = createSampleSite();

      const fleetForward = generateWindFleetProfile(
        timestamps,
        1,
        [asset1, asset2, asset3],
        site
      );
      const fleetReverse = generateWindFleetProfile(
        timestamps,
        1,
        [asset3, asset2, asset1],
        site
      );

      for (let i = 0; i < fleetForward.length; i++) {
        expect(fleetForward[i].totalExpectedPowerKw).toBe(
          fleetReverse[i].totalExpectedPowerKw
        );
        expect(fleetForward[i].totalEnergyKwh).toBe(
          fleetReverse[i].totalEnergyKwh
        );
      }
    });

    it('22. multiple turbines produce deterministic repeated results', () => {
      const asset1 = createValidWindAsset({ id: 't1' });
      const asset2 = createValidWindAsset({ id: 't2' });
      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 3);
      const site = createSampleSite();

      const run1 = generateWindFleetProfile(timestamps, 1, [asset1, asset2], site);
      const run2 = generateWindFleetProfile(timestamps, 1, [asset1, asset2], site);

      expect(run1).toEqual(run2);
    });
  });

  // ==========================================================================
  // Asset Filtering & Neutrality
  // ==========================================================================
  describe('Asset Filtering & Neutrality', () => {
    it('23. disabled wind contributes zero to fleet aggregation', () => {
      const enabledTurbine = createValidWindAsset({ id: 'enabled', ratedPowerKw: 10 });
      const disabledTurbine = createValidWindAsset({ id: 'disabled', enabled: false, ratedPowerKw: 20 });

      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 3);
      const site = createSampleSite();

      const fleetSolo = generateWindFleetProfile(timestamps, 1, [enabledTurbine], site);
      const fleetWithDisabled = generateWindFleetProfile(
        timestamps,
        1,
        [enabledTurbine, disabledTurbine],
        site
      );

      expect(fleetWithDisabled).toEqual(fleetSolo);
    });

    it('24. neutral disabled default wind configuration remains harmless', () => {
      // Incomplete/neutral disabled configuration that would fail validation if enabled
      const neutralDisabledAsset: WindGenerationAsset = {
        id: 'neutral_disabled',
        name: 'Unconfigured Wind Asset',
        type: 'wind',
        enabled: false,
        installedCostUsd: 0,
        annualMaintenanceCostUsd: 0,
        ratedPowerKw: 0, // Invalid for enabled, but neutral when disabled
        hubHeightM: 0,
        rotorDiameterM: 0,
        measurementHeightM: 0,
        windShearExponent: 0,
        cutInWindSpeedMps: 0,
        ratedWindSpeedMps: 0,
        cutOutWindSpeedMps: 0,
        availabilityPercent: 0,
        systemLossPercent: 0,
        powerCurve: [],
        resourceMode: 'annual_average',
        annualAverageWindSpeedMps: null,
        monthlyAverageWindSpeedMps: [],
      };

      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 2);
      expect(() => {
        const fleet = generateWindFleetProfile(
          timestamps,
          1,
          [neutralDisabledAsset],
          createSampleSite()
        );
        expect(fleet[0].totalExpectedPowerKw).toBe(0);
        expect(fleet[0].totalEnergyKwh).toBe(0);
      }).not.toThrow();

      // Also directly in generateWindAssetProfile
      const assetProfile = generateWindAssetProfile(
        timestamps,
        1,
        neutralDisabledAsset,
        createSampleSite()
      );
      expect(assetProfile[0].expectedNetPowerKw).toBe(0);
      expect(assetProfile[0].energyKwh).toBe(0);
    });

    it('25. solar assets are ignored by the wind-profile fleet layer', () => {
      const solarAsset: SolarGenerationAsset = {
        id: 'solar_1',
        name: 'Rooftop Solar',
        type: 'solar',
        enabled: true,
        installedCostUsd: 20000,
        annualMaintenanceCostUsd: 150,
        dcCapacityKw: 10.0,
        inverterAcCapacityKw: 8.0,
        inverterEfficiencyPercent: 96,
        azimuthDegrees: 180,
        tiltDegrees: 25,
        shadingLossPercent: 3,
        systemLossPercent: 14,
        annualDegradationPercent: 0.5,
        resourceMode: 'clear_sky',
        monthlyPeakSunHoursPerDay: [],
      };

      const windAsset = createValidWindAsset({ id: 'wind_1' });
      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 2);
      const site = createSampleSite();

      const fleetOnlyWind = generateWindFleetProfile(timestamps, 1, [windAsset], site);
      const fleetCombined = generateWindFleetProfile(timestamps, 1, [windAsset, solarAsset], site);

      expect(fleetCombined).toEqual(fleetOnlyWind);
    });

    it('26. generator assets are ignored by the wind-profile fleet layer', () => {
      const generatorAsset: GeneratorGenerationAsset = {
        id: 'gen_1',
        name: 'Standby Generator',
        type: 'generator',
        enabled: true,
        installedCostUsd: 10000,
        annualMaintenanceCostUsd: 200,
        ratedContinuousKw: 12.0,
        minimumStableLoadPercent: 20,
        fuelType: 'natural_gas',
        fuelUnit: 'therm',
        customFuelUnitLabel: '',
        fuelPricePerUnit: 1.5,
        variableMaintenanceCostPerHourUsd: 0.1,
        fuelCurve: [],
        dispatchMode: 'standby',
        allowBatteryCharging: false,
        allowGridExport: false,
        scheduledHours: [],
      };

      const windAsset = createValidWindAsset({ id: 'wind_1' });
      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 2);
      const site = createSampleSite();

      const fleetOnlyWind = generateWindFleetProfile(timestamps, 1, [windAsset], site);
      const fleetCombined = generateWindFleetProfile(timestamps, 1, [windAsset, generatorAsset], site);

      expect(fleetCombined).toEqual(fleetOnlyWind);
    });

    it('27. enabled interval_file wind fails explicitly via G5A validation boundary', () => {
      const invalidAsset = createValidWindAsset({
        id: 'invalid_interval_file',
        resourceMode: 'interval_file' as any,
      });

      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 1);

      expect(() => {
        generateWindAssetProfile(timestamps, 1, invalidAsset, createSampleSite());
      }).toThrow(/interval_file/);

      expect(() => {
        generateWindFleetProfile(timestamps, 1, [invalidAsset], createSampleSite());
      }).toThrow(/interval_file/);
    });

    it('28. empty wind fleet returns a zero profile with the correct interval count', () => {
      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 12);

      // No site config or resources required for empty fleet
      const emptyProfile = generateWindFleetProfile(timestamps, 1, []);

      expect(emptyProfile).toHaveLength(12);
      for (let i = 0; i < emptyProfile.length; i++) {
        expect(emptyProfile[i].timestampUtc).toBe(timestamps[i].toISOString());
        expect(emptyProfile[i].totalExpectedPowerKw).toBe(0);
        expect(emptyProfile[i].totalEnergyKwh).toBe(0);
      }
    });
  });

  // ==========================================================================
  // Summary Helper & Input Immutability
  // ==========================================================================
  describe('Summary & Purity', () => {
    it('29. total wind generation equals the sum of fleet interval energy', () => {
      const asset1 = createValidWindAsset({ id: 't1', ratedPowerKw: 10 });
      const asset2 = createValidWindAsset({ id: 't2', ratedPowerKw: 15 });
      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 24);

      const fleet = generateWindFleetProfile(timestamps, 1, [asset1, asset2], createSampleSite());
      const summary = summarizeWindFleetProfile(fleet);

      expect(summary.intervalCount).toBe(24);

      const manualEnergySum = fleet.reduce((acc, curr) => acc + curr.totalEnergyKwh, 0);
      expect(summary.totalGenerationKwh).toBeCloseTo(manualEnergySum, 8);
    });

    it('30. average expected power reconciles with fleet intervals', () => {
      const asset = createValidWindAsset({ id: 't1' });
      const timestamps = createHourlyDateRange('2026-05-01T00:00:00.000Z', 10);

      const fleet = generateWindFleetProfile(timestamps, 1, [asset], createSampleSite());
      const summary = summarizeWindFleetProfile(fleet);

      const manualPowerAvg =
        fleet.reduce((acc, curr) => acc + curr.totalExpectedPowerKw, 0) /
        fleet.length;

      expect(summary.averagePowerKw).toBeCloseTo(manualPowerAvg, 8);
    });

    it('handles empty fleet summary safely', () => {
      const summary = summarizeWindFleetProfile([]);
      expect(summary.intervalCount).toBe(0);
      expect(summary.totalGenerationKwh).toBe(0);
      expect(summary.averagePowerKw).toBe(0);
    });

    it('31. inputs are not mutated (immutability regression)', () => {
      const asset = Object.freeze(createValidWindAsset({
        powerCurve: Object.freeze([
          Object.freeze({ windSpeedMps: 0, outputKw: 0 }),
          Object.freeze({ windSpeedMps: 3, outputKw: 0 }),
          Object.freeze({ windSpeedMps: 12, outputKw: 10 }),
          Object.freeze({ windSpeedMps: 25, outputKw: 10 }),
        ]) as any,
        monthlyAverageWindSpeedMps: Object.freeze([
          5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5, 5,
        ]) as any,
      }));

      const date1 = new Date('2026-06-01T00:00:00.000Z');
      const date2 = new Date('2026-06-01T01:00:00.000Z');
      const timestamps = Object.freeze([date1, date2]) as any;

      const site = Object.freeze(createSampleSite());
      const assets = Object.freeze([asset]) as any;

      expect(() => {
        const profile = generateWindAssetProfile(timestamps, 1, asset, site);
        expect(profile).toHaveLength(2);

        const fleet = generateWindFleetProfile(timestamps, 1, assets, site);
        expect(fleet).toHaveLength(2);

        summarizeWindFleetProfile(fleet);
      }).not.toThrow();

      // Ensure Dates were not mutated
      expect(date1.toISOString()).toBe('2026-06-01T00:00:00.000Z');
      expect(date2.toISOString()).toBe('2026-06-01T01:00:00.000Z');
    });
  });
});
