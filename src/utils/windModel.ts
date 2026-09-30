/**
 * Pure, Deterministic Wind Physics, Validation & Expected-Power Model (Milestone G5A)
 *
 * Implements:
 * - Authoritative validation boundary for enabled wind generation assets and resource modes
 * - Hub-height wind-speed adjustment via power-law shear exponent
 * - Deterministic standard-atmosphere air density correction (ICAO / US Standard Atmosphere 1976)
 * - Deterministic piecewise linear interpolation of manufacturer power curves within operating envelope
 * - Deterministic numerical integration of expected gross electrical power using the Rayleigh distribution (Weibull k = 2)
 * - Exactly-once application of availability and system losses
 * - Interval energy conversion
 *
 * All operations are pure, deterministic, and non-mutating.
 */

import {
  GenerationSite,
  WindGenerationAsset,
  WindPowerCurvePoint,
} from '../types/energy';

/**
 * Result structure for wind interval expected power and energy simulation.
 */
export interface WindExpectedGenerationResult {
  resourceMeanWindSpeedMps: number;
  hubHeightMeanWindSpeedMps: number;
  airDensityRatio: number;

  expectedGrossPowerKw: number;
  availabilityAdjustedPowerKw: number;
  netPowerKw: number;

  energyKwh: number;
}

/**
 * Breakdown of expected electrical power components.
 */
export interface WindExpectedPowerBreakdown {
  expectedGrossPowerKw: number;
  availabilityAdjustedPowerKw: number;
  netPowerKw: number;
  valueOf(): number;
}

/**
 * Floating-point tolerance for power-curve validation against rated power.
 */
const RATED_POWER_TOLERANCE_KW = 1e-4;

/**
 * Validates a wind generation asset and its resource configuration.
 *
 * For enabled assets, enforces strict physical and operational boundaries:
 * - Positive finite rated power
 * - Positive finite hub and measurement heights
 * - Non-negative finite wind shear exponent
 * - Availability and system loss percentages within [0, 100]
 * - Strictly ordered operating speeds: 0 <= cut-in < rated < cut-out
 * - At least two power-curve points with finite, non-negative, strictly-increasing wind speeds
 * - Non-negative power curve outputs not exceeding ratedPowerKw (within tolerance)
 * - Valid resource-mode parameters for annual_average and monthly_average
 * - Rejection of unsupported interval_file resource mode in G5
 *
 * Disabled assets are considered harmless and do not throw.
 */
export function validateWindGenerationAsset(asset: WindGenerationAsset): void {
  if (!asset || typeof asset !== 'object') {
    throw new Error('Invalid wind asset: must be an object.');
  }

  // Disabled wind assets remain harmless and neutral
  if (!asset.enabled) {
    return;
  }

  // Rated power validation
  if (!Number.isFinite(asset.ratedPowerKw) || asset.ratedPowerKw <= 0) {
    throw new Error(
      `Invalid ratedPowerKw: ${asset.ratedPowerKw}. Enabled wind asset must have positive finite rated power.`
    );
  }

  // Height validation
  if (!Number.isFinite(asset.hubHeightM) || asset.hubHeightM <= 0) {
    throw new Error(
      `Invalid hubHeightM: ${asset.hubHeightM}. Hub height must be a positive finite number.`
    );
  }

  if (!Number.isFinite(asset.measurementHeightM) || asset.measurementHeightM <= 0) {
    throw new Error(
      `Invalid measurementHeightM: ${asset.measurementHeightM}. Measurement height must be a positive finite number.`
    );
  }

  // Wind shear exponent validation
  if (!Number.isFinite(asset.windShearExponent) || asset.windShearExponent < 0) {
    throw new Error(
      `Invalid windShearExponent: ${asset.windShearExponent}. Shear exponent must be a non-negative finite number.`
    );
  }

  // Availability validation
  if (
    !Number.isFinite(asset.availabilityPercent) ||
    asset.availabilityPercent < 0 ||
    asset.availabilityPercent > 100
  ) {
    throw new Error(
      `Invalid availabilityPercent: ${asset.availabilityPercent}. Must be between 0 and 100.`
    );
  }

  // System loss validation
  if (
    !Number.isFinite(asset.systemLossPercent) ||
    asset.systemLossPercent < 0 ||
    asset.systemLossPercent > 100
  ) {
    throw new Error(
      `Invalid systemLossPercent: ${asset.systemLossPercent}. Must be between 0 and 100.`
    );
  }

  // Speed threshold ordering: cut-in < rated < cut-out
  if (
    !Number.isFinite(asset.cutInWindSpeedMps) ||
    !Number.isFinite(asset.ratedWindSpeedMps) ||
    !Number.isFinite(asset.cutOutWindSpeedMps) ||
    asset.cutInWindSpeedMps < 0 ||
    asset.ratedWindSpeedMps < 0 ||
    asset.cutOutWindSpeedMps < 0 ||
    !(
      asset.cutInWindSpeedMps < asset.ratedWindSpeedMps &&
      asset.ratedWindSpeedMps < asset.cutOutWindSpeedMps
    )
  ) {
    throw new Error(
      `Invalid wind speed thresholds: cut-in (${asset.cutInWindSpeedMps}), rated (${asset.ratedWindSpeedMps}), and cut-out (${asset.cutOutWindSpeedMps}) must satisfy 0 <= cut-in < rated < cut-out.`
    );
  }

  // Power curve validation
  if (!Array.isArray(asset.powerCurve) || asset.powerCurve.length < 2) {
    throw new Error(
      `Invalid power curve: must contain at least 2 points. Found ${asset.powerCurve?.length ?? 0}.`
    );
  }

  for (let i = 0; i < asset.powerCurve.length; i++) {
    const pt = asset.powerCurve[i];
    if (
      !pt ||
      !Number.isFinite(pt.windSpeedMps) ||
      !Number.isFinite(pt.outputKw)
    ) {
      throw new Error(
        `Invalid power curve coordinate at index ${i}: coordinates must be finite numbers.`
      );
    }

    if (pt.windSpeedMps < 0) {
      throw new Error(
        `Invalid power curve point at index ${i}: wind speed (${pt.windSpeedMps} m/s) must be non-negative.`
      );
    }

    if (pt.outputKw < 0) {
      throw new Error(
        `Invalid power curve point at index ${i}: power output (${pt.outputKw} kW) must be non-negative.`
      );
    }

    if (pt.outputKw > asset.ratedPowerKw + RATED_POWER_TOLERANCE_KW) {
      throw new Error(
        `Invalid power curve point at index ${i}: output (${pt.outputKw} kW) exceeds rated power (${asset.ratedPowerKw} kW).`
      );
    }

    if (i > 0) {
      const prevPt = asset.powerCurve[i - 1];
      if (pt.windSpeedMps === prevPt.windSpeedMps) {
        throw new Error(
          `Invalid power curve: duplicate wind speed coordinate (${pt.windSpeedMps} m/s) at index ${i}.`
        );
      }
      if (pt.windSpeedMps < prevPt.windSpeedMps) {
        throw new Error(
          `Invalid power curve: wind speeds must be strictly increasing. Found ${pt.windSpeedMps} m/s after ${prevPt.windSpeedMps} m/s at index ${i}.`
        );
      }
    }
  }

  // Resource mode validation
  if (asset.resourceMode === 'annual_average') {
    if (
      asset.annualAverageWindSpeedMps === null ||
      asset.annualAverageWindSpeedMps === undefined ||
      !Number.isFinite(asset.annualAverageWindSpeedMps) ||
      asset.annualAverageWindSpeedMps < 0
    ) {
      throw new Error(
        `annual_average resource mode requires annualAverageWindSpeedMps to be a non-null, finite, non-negative number. Received: ${asset.annualAverageWindSpeedMps}.`
      );
    }
  } else if (asset.resourceMode === 'monthly_average') {
    if (
      !Array.isArray(asset.monthlyAverageWindSpeedMps) ||
      asset.monthlyAverageWindSpeedMps.length !== 12
    ) {
      throw new Error(
        `monthly_average resource mode requires exactly 12 monthly wind speed values. Found: ${asset.monthlyAverageWindSpeedMps?.length ?? 0}.`
      );
    }
    for (let m = 0; m < 12; m++) {
      const val = asset.monthlyAverageWindSpeedMps[m];
      if (!Number.isFinite(val) || val < 0) {
        throw new Error(
          `monthly_average resource mode requires all 12 monthly values to be finite, non-negative numbers. Invalid value at month index ${m}: ${val}.`
        );
      }
    }
  } else if (asset.resourceMode === 'interval_file') {
    throw new Error(
      'Wind resource mode "interval_file" is unsupported in G5.'
    );
  } else {
    throw new Error(
      `Unsupported wind resource mode: "${asset.resourceMode}".`
    );
  }
}

/**
 * Adjusts reference wind speed measured at measurementHeightM to hubHeightM
 * using the empirical wind shear power-law profile:
 *
 *   Vhub = Vref * (hubHeightM / measurementHeightM) ^ windShearExponent
 *
 * Rules:
 * - Equal heights return the original speed.
 * - Positive shear with higher hub height increases speed.
 * - Positive shear with lower hub height decreases speed.
 * - Zero shear returns the original speed.
 * - Speeds and heights are strictly validated.
 */
export function adjustWindSpeedToHubHeight(
  windSpeedMps: number,
  hubHeightM: number,
  measurementHeightM: number,
  windShearExponent: number
): number {
  if (!Number.isFinite(windSpeedMps) || windSpeedMps < 0) {
    throw new Error(
      `Invalid windSpeedMps: ${windSpeedMps}. Must be a non-negative finite number.`
    );
  }

  if (!Number.isFinite(hubHeightM) || hubHeightM <= 0) {
    throw new Error(
      `Invalid hubHeightM: ${hubHeightM}. Must be a positive finite number.`
    );
  }

  if (!Number.isFinite(measurementHeightM) || measurementHeightM <= 0) {
    throw new Error(
      `Invalid measurementHeightM: ${measurementHeightM}. Must be a positive finite number.`
    );
  }

  if (!Number.isFinite(windShearExponent) || windShearExponent < 0) {
    throw new Error(
      `Invalid windShearExponent: ${windShearExponent}. Must be a non-negative finite number.`
    );
  }

  if (windSpeedMps === 0) {
    return 0;
  }

  if (hubHeightM === measurementHeightM || windShearExponent === 0) {
    return windSpeedMps;
  }

  return windSpeedMps * Math.pow(hubHeightM / measurementHeightM, windShearExponent);
}

/**
 * Calculates standard-atmosphere air density ratio (rho / rho_0) for a given site elevation.
 *
 * Uses the International Standard Atmosphere (ICAO / US Standard Atmosphere 1976)
 * tropospheric lapse rate equation:
 *
 *   rho / rho_0 = (1 - (L * h) / T0) ^ ((g / (R * L)) - 1)
 *
 * Constants:
 * - T0 = 288.15 K (sea-level standard temperature, 15 °C)
 * - L  = 0.0065 K/m (standard tropospheric temperature lapse rate)
 * - g  = 9.80665 m/s^2 (standard gravitational acceleration)
 * - R  = 287.058 J/(kg*K) (specific gas constant for dry air)
 * - Exponent = (g / (R * L)) - 1 = (9.80665 / (287.058 * 0.0065)) - 1 ~= 4.25588
 *
 * Properties:
 * - null or undefined represents standard sea-level density (ratio = 1.0).
 * - zero elevation returns ratio = 1.0.
 * - positive elevation produces a density ratio strictly between 0 and 1 (< 1.0).
 * - finite negative elevation (e.g. -100 m) produces a density ratio > 1.0.
 * - values outside the usable standard-atmosphere tropospheric domain (-2000 m to 11000 m) are rejected.
 */
export function calculateStandardAirDensityRatio(
  elevationM: number | null | undefined
): number {
  if (elevationM === null || elevationM === undefined) {
    return 1.0;
  }

  if (!Number.isFinite(elevationM)) {
    throw new Error(
      `Invalid elevationM: ${elevationM}. Must be a finite number or null.`
    );
  }

  if (elevationM === 0) {
    return 1.0;
  }

  const T0 = 288.15;
  const L = 0.0065;
  const exponent = 4.25588;

  // The tropospheric lapse-rate formula is valid within the standard troposphere
  // (from -2,000 m up to the tropopause boundary at 11,000 m), where temperature remains strictly positive.
  // Values outside this physical domain are rejected rather than silently clamped.
  if (elevationM < -2000 || elevationM > 11000) {
    throw new Error(
      `Invalid elevationM: ${elevationM}. Elevation is outside the usable standard-atmosphere tropospheric domain (-2000 m to 11000 m).`
    );
  }

  const tempRatio = 1 - (L * elevationM) / T0;
  return Math.pow(tempRatio, exponent);
}

/**
 * Evaluates the manufacturer power curve at a specified wind speed using deterministic
 * linear interpolation within the operating envelope.
 *
 * Operating envelope rules:
 * - wind speed < cut-in   => 0 kW
 * - wind speed >= cut-out => 0 kW
 * - inside operating range => linear interpolation on manufacturer power curve
 * - output capped at ratedPowerKw
 */
export function interpolateWindPowerCurve(
  windSpeedMps: number,
  powerCurveOrAsset:
    | WindPowerCurvePoint[]
    | Pick<
        WindGenerationAsset,
        'powerCurve' | 'ratedPowerKw' | 'cutInWindSpeedMps' | 'cutOutWindSpeedMps'
      >,
  ratedPowerKw?: number,
  cutInWindSpeedMps?: number,
  cutOutWindSpeedMps?: number
): number {
  let curve: WindPowerCurvePoint[];
  let rated: number;
  let cutIn: number;
  let cutOut: number;

  if (Array.isArray(powerCurveOrAsset)) {
    curve = powerCurveOrAsset;
    rated = ratedPowerKw ?? Infinity;
    cutIn = cutInWindSpeedMps ?? 0;
    cutOut = cutOutWindSpeedMps ?? Infinity;
  } else {
    curve = powerCurveOrAsset.powerCurve;
    rated = powerCurveOrAsset.ratedPowerKw;
    cutIn = powerCurveOrAsset.cutInWindSpeedMps;
    cutOut = powerCurveOrAsset.cutOutWindSpeedMps;
  }

  if (!Number.isFinite(windSpeedMps) || windSpeedMps < cutIn || windSpeedMps >= cutOut) {
    return 0;
  }

  if (!curve || curve.length === 0) {
    return 0;
  }

  // If wind speed is below the first defined curve coordinate
  if (windSpeedMps < curve[0].windSpeedMps) {
    return 0;
  }

  // If wind speed is above the last defined curve coordinate (but below cut-out)
  if (windSpeedMps >= curve[curve.length - 1].windSpeedMps) {
    return Math.max(0, Math.min(rated, curve[curve.length - 1].outputKw));
  }

  // Linear interpolation between curve points
  for (let i = 0; i < curve.length - 1; i++) {
    const p0 = curve[i];
    const p1 = curve[i + 1];

    if (windSpeedMps >= p0.windSpeedMps && windSpeedMps <= p1.windSpeedMps) {
      const span = p1.windSpeedMps - p0.windSpeedMps;
      if (span <= 0) {
        return Math.max(0, Math.min(rated, p0.outputKw));
      }
      const t = (windSpeedMps - p0.windSpeedMps) / span;
      const rawPower = p0.outputKw + t * (p1.outputKw - p0.outputKw);
      return Math.max(0, Math.min(rated, rawPower));
    }
  }

  return 0;
}

/**
 * Rayleigh probability density function (Weibull k = 2):
 *
 *   f(v) = (pi * v / (2 * Vmean^2)) * exp(-pi * v^2 / (4 * Vmean^2))
 *
 * For mean wind speed Vmean > 0 and wind speed v >= 0.
 */
function rayleighPdf(v: number, meanWindSpeedMps: number): number {
  if (v < 0 || meanWindSpeedMps <= 0) {
    return 0;
  }
  const meanSq = meanWindSpeedMps * meanWindSpeedMps;
  const factor = (Math.PI * v) / (2 * meanSq);
  const exponent = (-Math.PI * v * v) / (4 * meanSq);
  return factor * Math.exp(exponent);
}

/**
 * Calculates expected turbine electrical power (gross, availability-adjusted, and net)
 * across the Rayleigh wind speed distribution using deterministic numerical integration.
 *
 * Physical modeling:
 * - Rayleigh wind distribution (Weibull k = 2) parameterized around hubHeightMeanWindSpeedMps.
 * - Standard IEC 61400-12 density normalization via equivalent wind speed:
 *     Veq = V * (airDensityRatio)^(1/3)
 * - Operating envelope: turbine cuts in at cutInWindSpeedMps and cuts out at cutOutWindSpeedMps.
 * - Integration via composite Simpson's rule across [cutIn, cutOut].
 * - Availability factor (availabilityPercent / 100) applied exactly once.
 * - System loss factor (1 - systemLossPercent / 100) applied exactly once.
 */
export function calculateExpectedWindPowerKw(
  hubHeightMeanWindSpeedMps: number,
  asset: WindGenerationAsset,
  airDensityRatio: number = 1.0
): WindExpectedPowerBreakdown {
  if (!asset.enabled) {
    const res: WindExpectedPowerBreakdown = {
      expectedGrossPowerKw: 0,
      availabilityAdjustedPowerKw: 0,
      netPowerKw: 0,
      valueOf() {
        return this.netPowerKw;
      },
    };
    return res;
  }

  validateWindGenerationAsset(asset);

  if (!Number.isFinite(hubHeightMeanWindSpeedMps) || hubHeightMeanWindSpeedMps <= 0) {
    const res: WindExpectedPowerBreakdown = {
      expectedGrossPowerKw: 0,
      availabilityAdjustedPowerKw: 0,
      netPowerKw: 0,
      valueOf() {
        return this.netPowerKw;
      },
    };
    return res;
  }

  const cutIn = asset.cutInWindSpeedMps;
  const cutOut = asset.cutOutWindSpeedMps;

  if (cutIn >= cutOut) {
    const res: WindExpectedPowerBreakdown = {
      expectedGrossPowerKw: 0,
      availabilityAdjustedPowerKw: 0,
      netPowerKw: 0,
      valueOf() {
        return this.netPowerKw;
      },
    };
    return res;
  }

  // Composite Simpson's rule integration over [cutIn, cutOut]
  const numSteps = 2000; // Even number of subintervals for high deterministic convergence
  const h = (cutOut - cutIn) / numSteps;

  const densityCbrt =
    airDensityRatio > 0 ? Math.cbrt(Math.max(0, airDensityRatio)) : 0;

  let simpsonSum = 0;
  for (let i = 0; i <= numSteps; i++) {
    const v = cutIn + i * h;
    const vEq = v * densityCbrt;

    const powerAtV = interpolateWindPowerCurve(
      vEq,
      asset.powerCurve,
      asset.ratedPowerKw,
      asset.cutInWindSpeedMps,
      asset.cutOutWindSpeedMps
    );

    const pdfAtV = rayleighPdf(v, hubHeightMeanWindSpeedMps);
    const weight = i === 0 || i === numSteps ? 1 : i % 2 === 1 ? 4 : 2;

    simpsonSum += weight * powerAtV * pdfAtV;
  }

  let grossPowerKw = (h / 3) * simpsonSum;
  grossPowerKw = Math.max(0, Math.min(asset.ratedPowerKw, grossPowerKw));

  // Exactly-once availability and system loss application
  const availabilityFactor = asset.availabilityPercent / 100;
  const systemLossFactor = 1 - asset.systemLossPercent / 100;

  const availabilityAdjustedPowerKw = grossPowerKw * availabilityFactor;
  const netPowerKw = availabilityAdjustedPowerKw * systemLossFactor;

  const res: WindExpectedPowerBreakdown = {
    expectedGrossPowerKw: grossPowerKw,
    availabilityAdjustedPowerKw,
    netPowerKw,
    valueOf() {
      return this.netPowerKw;
    },
  };

  return res;
}

/**
 * Simulates deterministic expected power and interval energy for a wind turbine.
 *
 * Sequence:
 * 1. Validates interval duration and input asset (if enabled).
 * 2. Determines air density ratio from site elevation.
 * 3. Adjusts resource mean wind speed from measurement height to hub height.
 * 4. Integrates expected power across Rayleigh distribution with IEC density normalization.
 * 5. Applies availability and system losses exactly once.
 * 6. Converts net expected power to interval energy (energyKwh = netPowerKw * intervalHours).
 */
export function simulateWindIntervalExpectedEnergy(
  resourceMeanWindSpeedMps: number,
  intervalHours: number,
  asset: WindGenerationAsset,
  site?: GenerationSite | null
): WindExpectedGenerationResult {
  if (!Number.isFinite(intervalHours) || intervalHours <= 0) {
    throw new Error(
      `Invalid intervalHours: ${intervalHours}. Must be a positive finite number.`
    );
  }

  // Disabled assets produce 0 power and 0 energy safely
  if (!asset.enabled) {
    const safeSpeed =
      Number.isFinite(resourceMeanWindSpeedMps) && resourceMeanWindSpeedMps >= 0
        ? resourceMeanWindSpeedMps
        : 0;

    return {
      resourceMeanWindSpeedMps: safeSpeed,
      hubHeightMeanWindSpeedMps: safeSpeed,
      airDensityRatio: 1.0,
      expectedGrossPowerKw: 0,
      availabilityAdjustedPowerKw: 0,
      netPowerKw: 0,
      energyKwh: 0,
    };
  }

  validateWindGenerationAsset(asset);

  if (!Number.isFinite(resourceMeanWindSpeedMps) || resourceMeanWindSpeedMps < 0) {
    throw new Error(
      `Invalid resourceMeanWindSpeedMps: ${resourceMeanWindSpeedMps}. Must be a non-negative finite number.`
    );
  }

  const airDensityRatio = calculateStandardAirDensityRatio(site?.elevationM);

  const hubHeightMeanWindSpeedMps = adjustWindSpeedToHubHeight(
    resourceMeanWindSpeedMps,
    asset.hubHeightM,
    asset.measurementHeightM,
    asset.windShearExponent
  );

  const powerBreakdown = calculateExpectedWindPowerKw(
    hubHeightMeanWindSpeedMps,
    asset,
    airDensityRatio
  );

  const energyKwh = powerBreakdown.netPowerKw * intervalHours;

  return {
    resourceMeanWindSpeedMps,
    hubHeightMeanWindSpeedMps,
    airDensityRatio,
    expectedGrossPowerKw: powerBreakdown.expectedGrossPowerKw,
    availabilityAdjustedPowerKw: powerBreakdown.availabilityAdjustedPowerKw,
    netPowerKw: powerBreakdown.netPowerKw,
    energyKwh,
  };
}
