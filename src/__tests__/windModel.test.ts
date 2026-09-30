import { describe, it, expect } from 'vitest';
import {
  WindGenerationAsset,
  WindPowerCurvePoint,
  GenerationSite,
} from '../types/energy';
import { DEFAULT_WIND_ASSET } from '../utils/generationDefaults';
import {
  validateWindGenerationAsset,
  adjustWindSpeedToHubHeight,
  calculateStandardAirDensityRatio,
  interpolateWindPowerCurve,
  calculateExpectedWindPowerKw,
  simulateWindIntervalExpectedEnergy,
  WindExpectedGenerationResult,
} from '../utils/windModel';

/**
 * Creates a valid, fully configured enabled wind turbine asset for testing.
 */
function createValidWindAsset(
  overrides: Partial<WindGenerationAsset> = {}
): WindGenerationAsset {
  return {
    id: 'test-wind-1',
    name: 'Test Wind Turbine',
    enabled: true,
    type: 'wind',
    installedCostUsd: 15000,
    annualMaintenanceCostUsd: 250,

    ratedPowerKw: 10,
    hubHeightM: 20,
    rotorDiameterM: 7.2,

    cutInWindSpeedMps: 3.0,
    ratedWindSpeedMps: 12.0,
    cutOutWindSpeedMps: 25.0,

    availabilityPercent: 100.0,
    systemLossPercent: 0.0,

    resourceMode: 'annual_average',
    measurementHeightM: 10.0,
    windShearExponent: 0.14,

    annualAverageWindSpeedMps: 6.5,
    monthlyAverageWindSpeedMps: [
      6.0, 6.2, 6.5, 6.8, 6.5, 6.0, 5.8, 5.9, 6.1, 6.4, 6.6, 6.3,
    ],

    powerCurve: [
      { windSpeedMps: 3.0, outputKw: 0.0 },
      { windSpeedMps: 6.0, outputKw: 2.0 },
      { windSpeedMps: 9.0, outputKw: 5.5 },
      { windSpeedMps: 12.0, outputKw: 10.0 },
      { windSpeedMps: 25.0, outputKw: 10.0 },
    ],
    ...overrides,
  };
}

describe('G5A — Wind Physics, Validation & Expected-Power Model', () => {
  // --------------------------------------------------------------------------
  // 1-4. Hub-height wind-speed adjustment via power law
  // --------------------------------------------------------------------------
  describe('Hub-Height Wind-Speed Adjustment', () => {
    it('1. returns original speed when hub height equals measurement height', () => {
      const v = adjustWindSpeedToHubHeight(7.5, 10, 10, 0.14);
      expect(v).toBe(7.5);
    });

    it('2. increases speed for higher hub height with positive shear exponent', () => {
      const vRef = 6.0;
      const vHub = adjustWindSpeedToHubHeight(vRef, 30, 10, 0.2);
      // 6.0 * (30 / 10)^0.2 = 6.0 * 3^0.2 ~= 7.473
      expect(vHub).toBeGreaterThan(vRef);
      expect(vHub).toBeCloseTo(6.0 * Math.pow(3, 0.2), 6);
    });

    it('3. reduces speed for lower hub height with positive shear exponent', () => {
      const vRef = 6.0;
      const vHub = adjustWindSpeedToHubHeight(vRef, 5, 10, 0.2);
      // 6.0 * (5 / 10)^0.2 = 6.0 * 0.5^0.2 ~= 5.223
      expect(vHub).toBeLessThan(vRef);
      expect(vHub).toBeCloseTo(6.0 * Math.pow(0.5, 0.2), 6);
    });

    it('4. leaves speed unchanged when shear exponent is zero', () => {
      const vHub = adjustWindSpeedToHubHeight(8.0, 50, 10, 0.0);
      expect(vHub).toBe(8.0);
    });

    it('27. rejects invalid heights (<= 0 or non-finite)', () => {
      expect(() => adjustWindSpeedToHubHeight(6.0, 0, 10, 0.14)).toThrow(
        /Invalid hubHeightM/
      );
      expect(() => adjustWindSpeedToHubHeight(6.0, -10, 10, 0.14)).toThrow(
        /Invalid hubHeightM/
      );
      expect(() => adjustWindSpeedToHubHeight(6.0, 20, 0, 0.14)).toThrow(
        /Invalid measurementHeightM/
      );
      expect(() => adjustWindSpeedToHubHeight(6.0, 20, -5, 0.14)).toThrow(
        /Invalid measurementHeightM/
      );
      expect(() => adjustWindSpeedToHubHeight(6.0, NaN, 10, 0.14)).toThrow(
        /Invalid hubHeightM/
      );
    });

    it('28. rejects invalid shear exponent (< 0 or non-finite)', () => {
      expect(() => adjustWindSpeedToHubHeight(6.0, 20, 10, -0.1)).toThrow(
        /Invalid windShearExponent/
      );
      expect(() => adjustWindSpeedToHubHeight(6.0, 20, 10, NaN)).toThrow(
        /Invalid windShearExponent/
      );
    });

    it('handles zero reference speed cleanly', () => {
      expect(adjustWindSpeedToHubHeight(0, 30, 10, 0.2)).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 5-6. Elevation / air-density correction
  // --------------------------------------------------------------------------
  describe('Elevation & Air-Density Correction', () => {
    it('5. returns 1.0 (sea-level density) for zero, null, or undefined elevation', () => {
      expect(calculateStandardAirDensityRatio(0)).toBe(1.0);
      expect(calculateStandardAirDensityRatio(null)).toBe(1.0);
      expect(calculateStandardAirDensityRatio(undefined)).toBe(1.0);
    });

    it('produces higher-density correction (> 1.0) for valid negative elevation (below sea level)', () => {
      const ratioNeg100 = calculateStandardAirDensityRatio(-100);
      expect(ratioNeg100).toBeGreaterThan(1.0);
      expect(ratioNeg100).toBeCloseTo(
        Math.pow(1 - (0.0065 * -100) / 288.15, 4.25588),
        5
      );

      const ratioNeg50 = calculateStandardAirDensityRatio(-50);
      expect(ratioNeg50).toBeGreaterThan(1.0);
      expect(ratioNeg100).toBeGreaterThan(ratioNeg50);
    });

    it('6. produces lower-density correction (< 1.0) for positive elevation', () => {
      const ratio1000 = calculateStandardAirDensityRatio(1000);
      const ratio2000 = calculateStandardAirDensityRatio(2000);

      expect(ratio1000).toBeLessThan(1.0);
      expect(ratio1000).toBeGreaterThan(0.85); // ISA at 1000m is ~0.9075
      expect(ratio2000).toBeLessThan(ratio1000);
      expect(ratio2000).toBeCloseTo(
        Math.pow(1 - (0.0065 * 2000) / 288.15, 4.25588),
        5
      );
    });

    it('rejects non-finite elevation', () => {
      expect(() => calculateStandardAirDensityRatio(NaN)).toThrow(
        /Invalid elevationM/
      );
    });

    it('rejects elevations outside usable standard-atmosphere domain', () => {
      expect(() => calculateStandardAirDensityRatio(15000)).toThrow(
        /Invalid elevationM/
      );
      expect(() => calculateStandardAirDensityRatio(-3000)).toThrow(
        /Invalid elevationM/
      );
    });
  });

  // --------------------------------------------------------------------------
  // 7-10. Manufacturer power-curve interpolation & envelope
  // --------------------------------------------------------------------------
  describe('Power Curve Interpolation & Envelope', () => {
    const curve: WindPowerCurvePoint[] = [
      { windSpeedMps: 3.0, outputKw: 0.0 },
      { windSpeedMps: 6.0, outputKw: 3.0 },
      { windSpeedMps: 12.0, outputKw: 10.0 },
      { windSpeedMps: 25.0, outputKw: 10.0 },
    ];

    it('7. returns zero below cut-in wind speed', () => {
      expect(interpolateWindPowerCurve(2.9, curve, 10, 3.0, 25.0)).toBe(0);
      expect(interpolateWindPowerCurve(0, curve, 10, 3.0, 25.0)).toBe(0);
      expect(interpolateWindPowerCurve(1.5, curve, 10, 3.0, 25.0)).toBe(0);
    });

    it('8. returns zero at or above cut-out wind speed', () => {
      expect(interpolateWindPowerCurve(25.0, curve, 10, 3.0, 25.0)).toBe(0);
      expect(interpolateWindPowerCurve(26.0, curve, 10, 3.0, 25.0)).toBe(0);
      expect(interpolateWindPowerCurve(35.0, curve, 10, 3.0, 25.0)).toBe(0);
    });

    it('9. performs linear interpolation between manufacturer power-curve points', () => {
      // Midpoint between 3.0 m/s (0 kW) and 6.0 m/s (3 kW) -> 4.5 m/s = 1.5 kW
      const pMid1 = interpolateWindPowerCurve(4.5, curve, 10, 3.0, 25.0);
      expect(pMid1).toBeCloseTo(1.5, 6);

      // Midpoint between 6.0 m/s (3 kW) and 12.0 m/s (10 kW) -> 9.0 m/s = 6.5 kW
      const pMid2 = interpolateWindPowerCurve(9.0, curve, 10, 3.0, 25.0);
      expect(pMid2).toBeCloseTo(6.5, 6);

      // Exact curve points
      expect(interpolateWindPowerCurve(6.0, curve, 10, 3.0, 25.0)).toBe(3.0);
      expect(interpolateWindPowerCurve(12.0, curve, 10, 3.0, 25.0)).toBe(10.0);
    });

    it('10. caps power output at ratedPowerKw', () => {
      // Over-rated curve points or interpolation are clamped
      const overCurve: WindPowerCurvePoint[] = [
        { windSpeedMps: 3.0, outputKw: 0.0 },
        { windSpeedMps: 10.0, outputKw: 12.0 },
      ];
      const capped = interpolateWindPowerCurve(10.0, overCurve, 8.0, 3.0, 25.0);
      expect(capped).toBe(8.0);
    });

    it('supports passing asset object directly to interpolateWindPowerCurve', () => {
      const asset = createValidWindAsset();
      const p = interpolateWindPowerCurve(6.0, asset);
      expect(p).toBe(2.0);
    });
  });

  // --------------------------------------------------------------------------
  // 11-15. Availability and system losses
  // --------------------------------------------------------------------------
  describe('Availability & System Losses', () => {
    it('11. does not reduce gross power when availability is 100%', () => {
      const asset = createValidWindAsset({
        availabilityPercent: 100.0,
        systemLossPercent: 0.0,
      });
      const breakdown = calculateExpectedWindPowerKw(8.0, asset, 1.0);
      expect(breakdown.availabilityAdjustedPowerKw).toBe(
        breakdown.expectedGrossPowerKw
      );
      expect(breakdown.netPowerKw).toBe(breakdown.expectedGrossPowerKw);
    });

    it('12. scales availability-adjusted power when availability is below 100%', () => {
      const asset = createValidWindAsset({
        availabilityPercent: 92.0,
        systemLossPercent: 0.0,
      });
      const breakdown = calculateExpectedWindPowerKw(8.0, asset, 1.0);
      expect(breakdown.availabilityAdjustedPowerKw).toBeCloseTo(
        breakdown.expectedGrossPowerKw * 0.92,
        6
      );
      expect(breakdown.netPowerKw).toBe(breakdown.availabilityAdjustedPowerKw);
    });

    it('13. leaves availability-adjusted power intact when system loss is 0%', () => {
      const asset = createValidWindAsset({
        availabilityPercent: 95.0,
        systemLossPercent: 0.0,
      });
      const breakdown = calculateExpectedWindPowerKw(8.0, asset, 1.0);
      expect(breakdown.netPowerKw).toBe(breakdown.availabilityAdjustedPowerKw);
    });

    it('14. scales net power appropriately when system loss is positive', () => {
      const asset = createValidWindAsset({
        availabilityPercent: 100.0,
        systemLossPercent: 15.0,
      });
      const breakdown = calculateExpectedWindPowerKw(8.0, asset, 1.0);
      expect(breakdown.netPowerKw).toBeCloseTo(
        breakdown.expectedGrossPowerKw * (1 - 0.15),
        6
      );
    });

    it('15. applies availability and system loss exactly once across the pipeline', () => {
      const asset = createValidWindAsset({
        hubHeightM: 10.0,
        measurementHeightM: 10.0,
        availabilityPercent: 90.0,
        systemLossPercent: 10.0,
      });
      const breakdown = calculateExpectedWindPowerKw(8.0, asset, 1.0);

      // net = gross * 0.90 * (1 - 0.10) = gross * 0.81
      expect(breakdown.netPowerKw).toBeCloseTo(
        breakdown.expectedGrossPowerKw * 0.9 * 0.9,
        6
      );

      // Interval energy simulation must simply be netPowerKw * hours without re-multiplying
      const sim = simulateWindIntervalExpectedEnergy(8.0, 2.0, asset);
      expect(sim.energyKwh).toBeCloseTo(breakdown.netPowerKw * 2.0, 6);
      expect(sim.netPowerKw).toBe(breakdown.netPowerKw);
      expect(sim.expectedGrossPowerKw).toBe(breakdown.expectedGrossPowerKw);
      expect(sim.availabilityAdjustedPowerKw).toBe(
        breakdown.availabilityAdjustedPowerKw
      );
    });
  });

  // --------------------------------------------------------------------------
  // 16-17. Deterministic Rayleigh expected-power model & Reference test
  // --------------------------------------------------------------------------
  describe('Rayleigh Integration & Closed-Form Reference Case', () => {
    it('16. produces bit-for-bit deterministic results across repeated calls', () => {
      const asset = createValidWindAsset();
      const results: number[] = [];

      for (let i = 0; i < 5; i++) {
        const res = calculateExpectedWindPowerKw(7.2, asset, 0.95);
        results.push(res.netPowerKw);
      }

      for (let i = 1; i < results.length; i++) {
        expect(results[i]).toBe(results[0]);
      }
    });

    it('17. matches closed-form analytical solution for a flat power curve reference case', () => {
      // Reference case with flat power P0 between cutIn and cutOut:
      // E[P] = P0 * [exp(-pi * cutIn^2 / (4 * Vmean^2)) - exp(-pi * cutOut^2 / (4 * Vmean^2))]
      const P0 = 5.0; // kW
      const cutIn = 3.0; // m/s
      const cutOut = 25.0; // m/s
      const meanSpeed = 6.0; // m/s

      const analyticalGrossPower =
        P0 *
        (Math.exp((-Math.PI * cutIn * cutIn) / (4 * meanSpeed * meanSpeed)) -
          Math.exp((-Math.PI * cutOut * cutOut) / (4 * meanSpeed * meanSpeed)));

      const flatAsset = createValidWindAsset({
        ratedPowerKw: P0,
        cutInWindSpeedMps: cutIn,
        ratedWindSpeedMps: 10.0,
        cutOutWindSpeedMps: cutOut,
        availabilityPercent: 100.0,
        systemLossPercent: 0.0,
        powerCurve: [
          { windSpeedMps: cutIn, outputKw: P0 },
          { windSpeedMps: cutOut, outputKw: P0 },
        ],
      });

      const computed = calculateExpectedWindPowerKw(meanSpeed, flatAsset, 1.0);

      // Numerical Simpson's integration with 2000 steps converges within 1e-5 of analytical
      expect(computed.expectedGrossPowerKw).toBeCloseTo(
        analyticalGrossPower,
        5
      );
      expect(computed.netPowerKw).toBeCloseTo(analyticalGrossPower, 5);
    });

    it('returns zero expected power when mean wind speed is zero', () => {
      const asset = createValidWindAsset();
      const res = calculateExpectedWindPowerKw(0, asset, 1.0);
      expect(res.expectedGrossPowerKw).toBe(0);
      expect(res.netPowerKw).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 18-30. Wind asset and resource-mode validation boundaries
  // --------------------------------------------------------------------------
  describe('Asset & Resource-Mode Validation Boundary', () => {
    it('18. validates annual_average resource mode requires non-null, finite, non-negative speed', () => {
      const nullAsset = createValidWindAsset({
        resourceMode: 'annual_average',
        annualAverageWindSpeedMps: null,
      });
      expect(() => validateWindGenerationAsset(nullAsset)).toThrow(
        /annual_average resource mode requires/
      );

      const negAsset = createValidWindAsset({
        resourceMode: 'annual_average',
        annualAverageWindSpeedMps: -2.5,
      });
      expect(() => validateWindGenerationAsset(negAsset)).toThrow(
        /annual_average resource mode requires/
      );

      const nanAsset = createValidWindAsset({
        resourceMode: 'annual_average',
        annualAverageWindSpeedMps: NaN,
      });
      expect(() => validateWindGenerationAsset(nanAsset)).toThrow(
        /annual_average resource mode requires/
      );
    });

    it('19. validates monthly_average resource mode requires exactly 12 non-negative finite values', () => {
      const shortAsset = createValidWindAsset({
        resourceMode: 'monthly_average',
        monthlyAverageWindSpeedMps: [5, 5, 5],
      });
      expect(() => validateWindGenerationAsset(shortAsset)).toThrow(
        /monthly_average resource mode requires exactly 12/
      );

      const negAsset = createValidWindAsset({
        resourceMode: 'monthly_average',
        monthlyAverageWindSpeedMps: [
          5, 5, -1, 5, 5, 5, 5, 5, 5, 5, 5, 5,
        ],
      });
      expect(() => validateWindGenerationAsset(negAsset)).toThrow(
        /Invalid value at month index 2/
      );
    });

    it('20. rejects empty power curve for enabled asset', () => {
      const asset = createValidWindAsset({ powerCurve: [] });
      expect(() => validateWindGenerationAsset(asset)).toThrow(
        /must contain at least 2 points/
      );
    });

    it('21. rejects single-point power curve for enabled asset', () => {
      const asset = createValidWindAsset({
        powerCurve: [{ windSpeedMps: 6.0, outputKw: 2.0 }],
      });
      expect(() => validateWindGenerationAsset(asset)).toThrow(
        /must contain at least 2 points/
      );
    });

    it('22. rejects duplicate wind speed coordinates in power curve', () => {
      const asset = createValidWindAsset({
        powerCurve: [
          { windSpeedMps: 3.0, outputKw: 0.0 },
          { windSpeedMps: 6.0, outputKw: 2.0 },
          { windSpeedMps: 6.0, outputKw: 2.5 },
          { windSpeedMps: 12.0, outputKw: 10.0 },
        ],
      });
      expect(() => validateWindGenerationAsset(asset)).toThrow(
        /duplicate wind speed coordinate/
      );
    });

    it('23. rejects non-increasing wind speed coordinates in power curve', () => {
      const asset = createValidWindAsset({
        powerCurve: [
          { windSpeedMps: 3.0, outputKw: 0.0 },
          { windSpeedMps: 8.0, outputKw: 3.0 },
          { windSpeedMps: 6.0, outputKw: 2.0 },
          { windSpeedMps: 12.0, outputKw: 10.0 },
        ],
      });
      expect(() => validateWindGenerationAsset(asset)).toThrow(
        /wind speeds must be strictly increasing/
      );
    });

    it('24. rejects negative curve output in power curve', () => {
      const asset = createValidWindAsset({
        powerCurve: [
          { windSpeedMps: 3.0, outputKw: -0.5 },
          { windSpeedMps: 12.0, outputKw: 10.0 },
        ],
      });
      expect(() => validateWindGenerationAsset(asset)).toThrow(
        /power output \(-0.5 kW\) must be non-negative/
      );
    });

    it('25. rejects curve output exceeding rated power beyond tolerance', () => {
      const asset = createValidWindAsset({
        ratedPowerKw: 10.0,
        powerCurve: [
          { windSpeedMps: 3.0, outputKw: 0.0 },
          { windSpeedMps: 12.0, outputKw: 10.5 },
        ],
      });
      expect(() => validateWindGenerationAsset(asset)).toThrow(
        /exceeds rated power/
      );

      // Within small floating point tolerance is accepted
      const tolerantAsset = createValidWindAsset({
        ratedPowerKw: 10.0,
        powerCurve: [
          { windSpeedMps: 3.0, outputKw: 0.0 },
          { windSpeedMps: 12.0, outputKw: 10.00005 },
        ],
      });
      expect(() => validateWindGenerationAsset(tolerantAsset)).not.toThrow();
    });

    it('26. rejects invalid cut-in / rated / cut-out speed ordering', () => {
      // cut-in >= rated
      const bad1 = createValidWindAsset({
        cutInWindSpeedMps: 12.0,
        ratedWindSpeedMps: 12.0,
        cutOutWindSpeedMps: 25.0,
      });
      expect(() => validateWindGenerationAsset(bad1)).toThrow(
        /must satisfy 0 <= cut-in < rated < cut-out/
      );

      // rated >= cut-out
      const bad2 = createValidWindAsset({
        cutInWindSpeedMps: 3.0,
        ratedWindSpeedMps: 25.0,
        cutOutWindSpeedMps: 25.0,
      });
      expect(() => validateWindGenerationAsset(bad2)).toThrow(
        /must satisfy 0 <= cut-in < rated < cut-out/
      );

      // negative cut-in
      const bad3 = createValidWindAsset({
        cutInWindSpeedMps: -1.0,
        ratedWindSpeedMps: 12.0,
        cutOutWindSpeedMps: 25.0,
      });
      expect(() => validateWindGenerationAsset(bad3)).toThrow(
        /must satisfy 0 <= cut-in < rated < cut-out/
      );
    });

    it('27. rejects invalid heights in asset validation', () => {
      const badHub = createValidWindAsset({ hubHeightM: 0 });
      expect(() => validateWindGenerationAsset(badHub)).toThrow(
        /Invalid hubHeightM/
      );

      const badMeas = createValidWindAsset({ measurementHeightM: -5 });
      expect(() => validateWindGenerationAsset(badMeas)).toThrow(
        /Invalid measurementHeightM/
      );
    });

    it('28. rejects invalid wind shear in asset validation', () => {
      const badShear = createValidWindAsset({ windShearExponent: -0.05 });
      expect(() => validateWindGenerationAsset(badShear)).toThrow(
        /Invalid windShearExponent/
      );
    });

    it('29. rejects invalid availability and loss percentages', () => {
      const badAvailLow = createValidWindAsset({ availabilityPercent: -1 });
      expect(() => validateWindGenerationAsset(badAvailLow)).toThrow(
        /Invalid availabilityPercent/
      );

      const badAvailHigh = createValidWindAsset({ availabilityPercent: 100.5 });
      expect(() => validateWindGenerationAsset(badAvailHigh)).toThrow(
        /Invalid availabilityPercent/
      );

      const badLossLow = createValidWindAsset({ systemLossPercent: -0.1 });
      expect(() => validateWindGenerationAsset(badLossLow)).toThrow(
        /Invalid systemLossPercent/
      );

      const badLossHigh = createValidWindAsset({ systemLossPercent: 101 });
      expect(() => validateWindGenerationAsset(badLossHigh)).toThrow(
        /Invalid systemLossPercent/
      );
    });

    it('30. explicitly rejects interval_file resource mode in G5', () => {
      const intervalAsset = createValidWindAsset({
        resourceMode: 'interval_file',
      });
      expect(() => validateWindGenerationAsset(intervalAsset)).toThrow(
        /Wind resource mode "interval_file" is unsupported in G5/
      );
    });

    it('disabled wind asset remains harmless and does not throw even with incomplete defaults', () => {
      // The default disabled asset has 0 rated power and empty curve
      expect(DEFAULT_WIND_ASSET.enabled).toBe(false);
      expect(() => validateWindGenerationAsset(DEFAULT_WIND_ASSET)).not.toThrow();

      // simulateWindIntervalExpectedEnergy returns 0 without throwing
      const result = simulateWindIntervalExpectedEnergy(
        6.0,
        1.0,
        DEFAULT_WIND_ASSET
      );
      expect(result.energyKwh).toBe(0);
      expect(result.netPowerKw).toBe(0);
      expect(result.expectedGrossPowerKw).toBe(0);
    });
  });

  // --------------------------------------------------------------------------
  // 31-32. Interval energy scaling
  // --------------------------------------------------------------------------
  describe('Interval Energy Scaling', () => {
    it('31. scales energy correctly for hourly intervals (intervalHours = 1.0)', () => {
      const asset = createValidWindAsset();
      const res: WindExpectedGenerationResult =
        simulateWindIntervalExpectedEnergy(7.0, 1.0, asset);

      expect(res.energyKwh).toBeCloseTo(res.netPowerKw * 1.0, 6);
    });

    it('32. scales energy correctly for sub-hourly intervals (15 min and 30 min)', () => {
      const asset = createValidWindAsset();

      const res15min = simulateWindIntervalExpectedEnergy(7.0, 0.25, asset);
      expect(res15min.energyKwh).toBeCloseTo(res15min.netPowerKw * 0.25, 6);

      const res30min = simulateWindIntervalExpectedEnergy(7.0, 0.5, asset);
      expect(res30min.energyKwh).toBeCloseTo(res30min.netPowerKw * 0.5, 6);
    });

    it('rejects invalid interval duration (<= 0 or non-finite)', () => {
      const asset = createValidWindAsset();
      expect(() => simulateWindIntervalExpectedEnergy(7.0, 0, asset)).toThrow(
        /Invalid intervalHours/
      );
      expect(() => simulateWindIntervalExpectedEnergy(7.0, -1, asset)).toThrow(
        /Invalid intervalHours/
      );
      expect(() => simulateWindIntervalExpectedEnergy(7.0, NaN, asset)).toThrow(
        /Invalid intervalHours/
      );
    });
  });

  // --------------------------------------------------------------------------
  // 33. Input immutability
  // --------------------------------------------------------------------------
  describe('Input Immutability', () => {
    it('33. never mutates input asset, power-curve array, or site objects', () => {
      const asset = createValidWindAsset();
      const site: GenerationSite = {
        latitude: 40.0,
        longitude: -105.0,
        timeZone: 'America/Denver',
        elevationM: 1650,
      };

      // Deep freeze the inputs
      Object.freeze(asset);
      Object.freeze(asset.powerCurve);
      for (const pt of asset.powerCurve) {
        Object.freeze(pt);
      }
      Object.freeze(asset.monthlyAverageWindSpeedMps);
      Object.freeze(site);

      // Perform all operations — none should throw mutation error
      expect(() => validateWindGenerationAsset(asset)).not.toThrow();
      expect(() =>
        adjustWindSpeedToHubHeight(
          asset.annualAverageWindSpeedMps!,
          asset.hubHeightM,
          asset.measurementHeightM,
          asset.windShearExponent
        )
      ).not.toThrow();
      expect(() =>
        calculateStandardAirDensityRatio(site.elevationM)
      ).not.toThrow();
      expect(() => interpolateWindPowerCurve(8.0, asset)).not.toThrow();
      expect(() =>
        calculateExpectedWindPowerKw(8.0, asset, 0.85)
      ).not.toThrow();
      expect(() =>
        simulateWindIntervalExpectedEnergy(6.5, 1.0, asset, site)
      ).not.toThrow();
    });
  });
});
