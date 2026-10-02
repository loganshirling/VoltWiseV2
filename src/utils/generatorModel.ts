/**
 * Pure, Deterministic Generator Physics, Validation & Fuel Model (Milestone G6A)
 *
 * Implements:
 * - Authoritative validation boundary for enabled generator assets, fuel curves, and schedules
 * - Deterministic minimum stable output calculation
 * - Deterministic piecewise-linear fuel-curve interpolation without extrapolation
 * - Running fuel and sub-hourly interval duration scaling
 * - Stateless startup fuel primitive
 * - Pure fuel cost and variable maintenance cost primitives
 * - Structured interval operating result
 *
 * All operations are pure, deterministic, and non-mutating.
 * Standby / dispatch commitment and production routing belong to later milestones (G6B+).
 */

import {
  GeneratorGenerationAsset,
  GeneratorFuelCurvePoint,
} from '../types/energy';

/**
 * Result structure for pure interval generator fuel and operating cost calculations.
 */
export interface GeneratorIntervalOperatingResult {
  loadPercent: number;
  fuelUnitsPerHour: number;
  runningFuelUnits: number;
  startupFuelUnits: number;
  totalFuelUnits: number;
  fuelCostUsd: number;
  variableMaintenanceCostUsd: number;
  operatingCostUsd: number;
}

/**
 * Input options for calculating generator interval operating metrics.
 */
export interface CalculateGeneratorIntervalOptions {
  asset: GeneratorGenerationAsset;
  outputKw: number;
  intervalHours?: number;
  startedThisInterval?: boolean;
}

/**
 * Validates a generator fuel curve.
 *
 * Enforces:
 * - At least two points
 * - Finite numeric values
 * - 0 <= loadPercent <= 100
 * - fuelUnitsPerHour >= 0
 * - Strictly increasing loadPercent values (no duplicates, no decreases)
 * - Full operating range coverage:
 *     first point loadPercent <= minimumStableLoadPercent
 *     last point loadPercent === 100
 * - If minimumStableLoadPercent === 0, the curve must cover 0%.
 *
 * Does not mutate the input array.
 */
export function validateGeneratorFuelCurve(
  fuelCurve: GeneratorFuelCurvePoint[],
  minimumStableLoadPercent: number
): void {
  if (!Array.isArray(fuelCurve) || fuelCurve.length < 2) {
    throw new Error(
      `Enabled generator fuel curve must contain at least two points. Received ${
        Array.isArray(fuelCurve) ? fuelCurve.length : typeof fuelCurve
      }.`
    );
  }

  for (let i = 0; i < fuelCurve.length; i++) {
    const pt = fuelCurve[i];
    if (
      !Number.isFinite(pt.loadPercent) ||
      pt.loadPercent < 0 ||
      pt.loadPercent > 100
    ) {
      throw new Error(
        `Invalid fuel curve point at index ${i}: loadPercent must be a finite number between 0 and 100. Received ${pt.loadPercent}.`
      );
    }

    if (!Number.isFinite(pt.fuelUnitsPerHour) || pt.fuelUnitsPerHour < 0) {
      throw new Error(
        `Invalid fuel curve point at index ${i}: fuelUnitsPerHour must be a non-negative finite number. Received ${pt.fuelUnitsPerHour}.`
      );
    }

    if (i > 0 && pt.loadPercent <= fuelCurve[i - 1].loadPercent) {
      throw new Error(
        `Fuel curve points must have strictly increasing loadPercent values. Point at index ${i} (${pt.loadPercent}%) <= previous point (${fuelCurve[i - 1].loadPercent}%).`
      );
    }
  }

  const firstLoad = fuelCurve[0].loadPercent;
  if (firstLoad > minimumStableLoadPercent) {
    throw new Error(
      `Fuel curve must cover minimum stable load: first point loadPercent (${firstLoad}%) must be <= minimumStableLoadPercent (${minimumStableLoadPercent}%).`
    );
  }

  const lastLoad = fuelCurve[fuelCurve.length - 1].loadPercent;
  if (lastLoad !== 100) {
    throw new Error(
      `Fuel curve must terminate at 100% load: last point loadPercent is ${lastLoad}%.`
    );
  }
}

/**
 * Validates the canonical 7x24 boolean schedule matrix for scheduled dispatch mode.
 * Convention: 0 = Sunday, 1 = Monday, ..., 6 = Saturday.
 *
 * Does not mutate the input matrix.
 */
export function validateGeneratorScheduledHours(
  scheduledHours: boolean[][]
): void {
  if (!Array.isArray(scheduledHours) || scheduledHours.length !== 7) {
    throw new Error(
      `Scheduled hours matrix must contain exactly 7 day rows (0=Sunday to 6=Saturday). Received ${
        Array.isArray(scheduledHours) ? scheduledHours.length : typeof scheduledHours
      }.`
    );
  }

  for (let day = 0; day < 7; day++) {
    const dayRow = scheduledHours[day];
    if (!Array.isArray(dayRow) || dayRow.length !== 24) {
      throw new Error(
        `Day ${day} in scheduled hours matrix must contain exactly 24 hour cells. Received ${
          Array.isArray(dayRow) ? dayRow.length : typeof dayRow
        }.`
      );
    }
    for (let hour = 0; hour < 24; hour++) {
      if (typeof dayRow[hour] !== 'boolean') {
        throw new Error(
          `Cell [day ${day}, hour ${hour}] in scheduled hours matrix must be a boolean. Received ${typeof dayRow[hour]}.`
        );
      }
    }
  }
}

/**
 * Validates a generator generation asset.
 *
 * For enabled assets, enforces strict physical and operational boundaries:
 * - ratedContinuousKw > 0 and finite
 * - 0 <= minimumStableLoadPercent <= 100 and finite
 * - fuelPricePerUnit >= 0 and finite
 * - variableMaintenanceCostPerHourUsd >= 0 and finite
 * - startupFuelUnits >= 0 and finite
 * - installedCostUsd >= 0 and finite
 * - annualMaintenanceCostUsd >= 0 and finite
 * - If fuelUnit === 'custom', customFuelUnitLabel must be a non-empty string after whitespace trimming
 * - Fuel curve validation (via validateGeneratorFuelCurve)
 * - If dispatchMode === 'scheduled', schedule matrix validation (via validateGeneratorScheduledHours)
 *
 * Disabled incomplete generator assets contribute no validation failure.
 * Does not mutate the input asset.
 */
export function validateGeneratorAsset(asset: GeneratorGenerationAsset): void {
  if (!asset || typeof asset !== 'object') {
    throw new Error('Invalid generator asset: must be an object.');
  }

  // Disabled generator assets remain harmless and neutral
  if (!asset.enabled) {
    return;
  }

  // Rated power
  if (!Number.isFinite(asset.ratedContinuousKw) || asset.ratedContinuousKw <= 0) {
    throw new Error(
      `Invalid ratedContinuousKw: ${asset.ratedContinuousKw}. Enabled generator must have positive finite rated power.`
    );
  }

  // Minimum stable load percent
  if (
    !Number.isFinite(asset.minimumStableLoadPercent) ||
    asset.minimumStableLoadPercent < 0 ||
    asset.minimumStableLoadPercent > 100
  ) {
    throw new Error(
      `Invalid minimumStableLoadPercent: ${asset.minimumStableLoadPercent}. Must be between 0 and 100%.`
    );
  }

  // Fuel price
  if (!Number.isFinite(asset.fuelPricePerUnit) || asset.fuelPricePerUnit < 0) {
    throw new Error(
      `Invalid fuelPricePerUnit: ${asset.fuelPricePerUnit}. Fuel price must be a non-negative finite number.`
    );
  }

  // Variable maintenance cost per operating hour
  if (
    !Number.isFinite(asset.variableMaintenanceCostPerHourUsd) ||
    asset.variableMaintenanceCostPerHourUsd < 0
  ) {
    throw new Error(
      `Invalid variableMaintenanceCostPerHourUsd: ${asset.variableMaintenanceCostPerHourUsd}. Variable maintenance cost must be a non-negative finite number.`
    );
  }

  // Startup fuel units
  if (!Number.isFinite(asset.startupFuelUnits) || asset.startupFuelUnits < 0) {
    throw new Error(
      `Invalid startupFuelUnits: ${asset.startupFuelUnits}. Startup fuel must be a non-negative finite number.`
    );
  }

  // Installed capital cost
  if (!Number.isFinite(asset.installedCostUsd) || asset.installedCostUsd < 0) {
    throw new Error(
      `Invalid installedCostUsd: ${asset.installedCostUsd}. Installed cost must be a non-negative finite number.`
    );
  }

  // Annual fixed O&M cost
  if (
    !Number.isFinite(asset.annualMaintenanceCostUsd) ||
    asset.annualMaintenanceCostUsd < 0
  ) {
    throw new Error(
      `Invalid annualMaintenanceCostUsd: ${asset.annualMaintenanceCostUsd}. Annual maintenance cost must be a non-negative finite number.`
    );
  }

  // Custom fuel unit label
  if (asset.fuelUnit === 'custom') {
    if (
      typeof asset.customFuelUnitLabel !== 'string' ||
      asset.customFuelUnitLabel.trim().length === 0
    ) {
      throw new Error(
        'Custom fuel unit requires a non-empty customFuelUnitLabel.'
      );
    }
  }

  // Fuel curve validation
  validateGeneratorFuelCurve(asset.fuelCurve, asset.minimumStableLoadPercent);

  // Scheduled mode matrix shape validation
  if (asset.dispatchMode === 'scheduled') {
    validateGeneratorScheduledHours(asset.scheduledHours);
  }
}

/**
 * Calculates minimum stable electrical output in kW:
 * minimumOutputKw = (ratedContinuousKw * minimumStableLoadPercent) / 100
 */
export function calculateMinimumStableOutputKw(
  ratedContinuousKw: number,
  minimumStableLoadPercent: number
): number {
  if (
    !Number.isFinite(ratedContinuousKw) ||
    ratedContinuousKw <= 0 ||
    !Number.isFinite(minimumStableLoadPercent) ||
    minimumStableLoadPercent <= 0
  ) {
    return 0;
  }
  return (ratedContinuousKw * minimumStableLoadPercent) / 100;
}

/**
 * Calculates minimum stable electrical output in kW directly from an asset.
 */
export function calculateGeneratorMinimumStableOutputKw(
  asset: Pick<GeneratorGenerationAsset, 'ratedContinuousKw' | 'minimumStableLoadPercent'>
): number {
  return calculateMinimumStableOutputKw(
    asset.ratedContinuousKw,
    asset.minimumStableLoadPercent
  );
}

/**
 * Evaluates generator fuel consumption in fuelUnitsPerHour for a given load percentage
 * using deterministic piecewise-linear interpolation.
 *
 * Requirements:
 * - Exact configured curve points return their exact configured values.
 * - Points between curve points use deterministic linear interpolation.
 * - No extrapolation beyond configured curve range [minLoad, maxLoad].
 * - Non-mutating.
 */
export function interpolateGeneratorFuelCurve(
  fuelCurve: GeneratorFuelCurvePoint[],
  loadPercent: number
): number {
  if (!Array.isArray(fuelCurve) || fuelCurve.length === 0) {
    throw new Error('Fuel curve must contain at least one point for interpolation.');
  }

  if (!Number.isFinite(loadPercent)) {
    throw new Error(`Invalid loadPercent: ${loadPercent}. Must be a finite number.`);
  }

  const minLoad = fuelCurve[0].loadPercent;
  const maxLoad = fuelCurve[fuelCurve.length - 1].loadPercent;
  const EPS = 1e-9;

  if (loadPercent < minLoad - EPS || loadPercent > maxLoad + EPS) {
    throw new Error(
      `Cannot extrapolate fuel consumption: load percent ${loadPercent}% is outside configured curve [${minLoad}%, ${maxLoad}%].`
    );
  }

  // Clamp within minuscule floating-point tolerance
  const clampedLoad = Math.max(minLoad, Math.min(maxLoad, loadPercent));

  // Check exact point matches first
  for (let i = 0; i < fuelCurve.length; i++) {
    if (Math.abs(fuelCurve[i].loadPercent - clampedLoad) < 1e-12) {
      return fuelCurve[i].fuelUnitsPerHour;
    }
  }

  // Find bounding segment and linearly interpolate
  for (let i = 0; i < fuelCurve.length - 1; i++) {
    const p1 = fuelCurve[i];
    const p2 = fuelCurve[i + 1];

    if (clampedLoad >= p1.loadPercent && clampedLoad <= p2.loadPercent) {
      const loadSpan = p2.loadPercent - p1.loadPercent;
      if (loadSpan <= 0) {
        return p1.fuelUnitsPerHour;
      }
      const fraction = (clampedLoad - p1.loadPercent) / loadSpan;
      return p1.fuelUnitsPerHour + fraction * (p2.fuelUnitsPerHour - p1.fuelUnitsPerHour);
    }
  }

  return fuelCurve[fuelCurve.length - 1].fuelUnitsPerHour;
}

/**
 * Calculates running fuel consumption for a given duration:
 * runningFuelUnits = fuelUnitsPerHour * intervalHours
 *
 * Pure calculation scaling with hourly and sub-hourly interval durations.
 */
export function calculateRunningFuelUnits(
  fuelUnitsPerHour: number,
  intervalHours: number = 1.0
): number {
  if (
    !Number.isFinite(fuelUnitsPerHour) ||
    fuelUnitsPerHour <= 0 ||
    !Number.isFinite(intervalHours) ||
    intervalHours <= 0
  ) {
    return 0;
  }
  return fuelUnitsPerHour * intervalHours;
}

/**
 * Calculates startup fuel consumption for an interval:
 * startupFuelThisInterval = startedThisInterval ? startupFuelUnits : 0
 *
 * Stateless primitive. Start detection belongs to G6B.
 */
export function calculateStartupFuelUnits(
  startupFuelUnits: number,
  startedThisInterval: boolean
): number {
  if (
    !startedThisInterval ||
    !Number.isFinite(startupFuelUnits) ||
    startupFuelUnits <= 0
  ) {
    return 0;
  }
  return startupFuelUnits;
}

/**
 * Calculates fuel cost in USD:
 * fuelCostUsd = totalFuelUnits * fuelPricePerUnit
 */
export function calculateFuelCostUsd(
  totalFuelUnits: number,
  fuelPricePerUnit: number
): number {
  if (
    !Number.isFinite(totalFuelUnits) ||
    totalFuelUnits <= 0 ||
    !Number.isFinite(fuelPricePerUnit) ||
    fuelPricePerUnit <= 0
  ) {
    return 0;
  }
  return totalFuelUnits * fuelPricePerUnit;
}

/**
 * Calculates variable maintenance cost for a running interval in USD:
 * variableMaintenanceCostUsd = variableMaintenanceCostPerHourUsd * intervalHours
 *
 * Distinct from annual fixed maintenance (O&M).
 */
export function calculateVariableMaintenanceCostUsd(
  variableMaintenanceCostPerHourUsd: number,
  intervalHours: number = 1.0,
  isRunning: boolean = true
): number {
  if (
    !isRunning ||
    !Number.isFinite(variableMaintenanceCostPerHourUsd) ||
    variableMaintenanceCostPerHourUsd <= 0 ||
    !Number.isFinite(intervalHours) ||
    intervalHours <= 0
  ) {
    return 0;
  }
  return variableMaintenanceCostPerHourUsd * intervalHours;
}

/**
 * Computes interval operating fuel and variable maintenance metrics for a generator.
 *
 * Pure, deterministic primitive returning structured results:
 * - loadPercent
 * - fuelUnitsPerHour
 * - runningFuelUnits
 * - startupFuelUnits
 * - totalFuelUnits
 * - fuelCostUsd
 * - variableMaintenanceCostUsd
 * - operatingCostUsd = fuelCostUsd + variableMaintenanceCostUsd
 *
 * Does not implement commitment, dispatch policy, battery routing, or grid interaction.
 * Does not mutate the input asset.
 */
export function calculateGeneratorIntervalOperating(
  options: CalculateGeneratorIntervalOptions
): GeneratorIntervalOperatingResult {
  const {
    asset,
    outputKw,
    intervalHours = 1.0,
    startedThisInterval = false,
  } = options;

  const startupFuel = calculateStartupFuelUnits(
    asset.startupFuelUnits,
    startedThisInterval
  );

  // If output is 0, the generator is not running this interval
  if (outputKw <= 0) {
    const fuelCostUsd = calculateFuelCostUsd(startupFuel, asset.fuelPricePerUnit);
    return {
      loadPercent: 0,
      fuelUnitsPerHour: 0,
      runningFuelUnits: 0,
      startupFuelUnits: startupFuel,
      totalFuelUnits: startupFuel,
      fuelCostUsd,
      variableMaintenanceCostUsd: 0,
      operatingCostUsd: fuelCostUsd,
    };
  }

  const loadPercent = (outputKw / asset.ratedContinuousKw) * 100;
  const fuelUnitsPerHour = interpolateGeneratorFuelCurve(
    asset.fuelCurve,
    loadPercent
  );
  const runningFuelUnits = calculateRunningFuelUnits(
    fuelUnitsPerHour,
    intervalHours
  );
  const totalFuelUnits = runningFuelUnits + startupFuel;
  const fuelCostUsd = calculateFuelCostUsd(
    totalFuelUnits,
    asset.fuelPricePerUnit
  );
  const variableMaintenanceCostUsd = calculateVariableMaintenanceCostUsd(
    asset.variableMaintenanceCostPerHourUsd,
    intervalHours,
    true
  );
  const operatingCostUsd = fuelCostUsd + variableMaintenanceCostUsd;

  return {
    loadPercent,
    fuelUnitsPerHour,
    runningFuelUnits,
    startupFuelUnits: startupFuel,
    totalFuelUnits,
    fuelCostUsd,
    variableMaintenanceCostUsd,
    operatingCostUsd,
  };
}
