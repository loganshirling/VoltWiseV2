/**
 * Surplus Solar to Battery Charging Engine (Milestone G3B)
 *
 * Routes surplus solar generation (after serving household load) into battery storage
 * according to physical battery capacity, charge power rate limits, and square-root
 * charge efficiency.
 *
 * Tracks battery SOC provenance (synthetic, grid, renewable, generator).
 * In this milestone, only renewable-charged SOC increases.
 */

import {
  BatteryProfile,
  BatterySocProvenanceState,
  RenewableLoadFlowInterval,
  SolarBatteryChargeInterval,
  SolarBatteryChargeResult,
  SolarLoadFlowInterval,
} from '../types/energy';

export interface RenewableBatteryChargeInterval
  extends SolarBatteryChargeInterval {
  surplusWindAvailableKwh?: number;
  totalRenewableSurplusAvailableKwh?: number;
  windToBatteryAcKwh?: number;
  totalRenewableToBatteryAcKwh?: number;
  remainingSurplusWindKwh?: number;
  remainingSurplusRenewableKwh?: number;
}

export interface RenewableBatteryChargeResult
  extends SolarBatteryChargeResult {
  intervals: RenewableBatteryChargeInterval[];
  totalWindToBatteryAcKwh?: number;
  totalRenewableToBatteryAcKwh?: number;
  totalRemainingSurplusWindKwh?: number;
  totalRemainingSurplusRenewableKwh?: number;
}

/**
 * Calculates battery usable capacity:
 * usableCapacityKwh = totalCapacityKwh * (usableDodPercent / 100)
 */
export function calculateUsableCapacityKwh(profile: BatteryProfile): number {
  return profile.totalCapacityKwh * (profile.usableDodPercent / 100);
}

/**
 * Calculates square-root one-way charge efficiency from roundTripEfficiencyPercent:
 * rte = clamp(profile.roundTripEfficiencyPercent / 100, 0.5, 1.0)
 * etaCharge = sqrt(rte)
 */
export function calculateChargeEfficiency(profile: BatteryProfile): number {
  const rte = Math.max(
    0.5,
    Math.min(1.0, profile.roundTripEfficiencyPercent / 100)
  );
  return Math.sqrt(rte);
}

/**
 * Routes surplus passive renewable energy (solar, wind, or combined) to battery charging
 * sequentially across intervals.
 *
 * Source-neutral: total renewable surplus is evaluated against physical battery capacity
 * and charge rate limit. If capacity is constrained, accepted charge is allocated
 * proportionally between solar and wind according to their pre-battery surplus.
 *
 * Pure function: does not mutate inputs or caller state.
 */
export function routeSurplusRenewableToBattery(
  intervals: (SolarLoadFlowInterval | RenewableLoadFlowInterval)[],
  intervalHours: number,
  profile: BatteryProfile,
  initialState: BatterySocProvenanceState
): RenewableBatteryChargeResult {
  // Validate intervals array
  if (!Array.isArray(intervals)) {
    throw new Error('intervals must be an array.');
  }

  // Validate intervalHours
  if (
    typeof intervalHours !== 'number' ||
    !Number.isFinite(intervalHours) ||
    intervalHours <= 0
  ) {
    throw new Error(
      `intervalHours must be a finite positive number. Received: ${intervalHours}`
    );
  }

  // Validate battery profile
  if (!profile || typeof profile !== 'object') {
    throw new Error('Battery profile must be a valid object.');
  }

  if (
    typeof profile.totalCapacityKwh !== 'number' ||
    !Number.isFinite(profile.totalCapacityKwh) ||
    profile.totalCapacityKwh < 0
  ) {
    throw new Error(
      `Invalid battery totalCapacityKwh: must be a finite non-negative number. Received: ${profile.totalCapacityKwh}`
    );
  }

  if (
    typeof profile.usableDodPercent !== 'number' ||
    !Number.isFinite(profile.usableDodPercent) ||
    profile.usableDodPercent < 0 ||
    profile.usableDodPercent > 100
  ) {
    throw new Error(
      `Invalid battery usableDodPercent: must be a finite number between 0 and 100. Received: ${profile.usableDodPercent}`
    );
  }

  if (
    typeof profile.maxContinuousChargeKw !== 'number' ||
    !Number.isFinite(profile.maxContinuousChargeKw) ||
    profile.maxContinuousChargeKw < 0
  ) {
    throw new Error(
      `Invalid battery maxContinuousChargeKw: must be a finite non-negative number. Received: ${profile.maxContinuousChargeKw}`
    );
  }

  if (
    typeof profile.roundTripEfficiencyPercent !== 'number' ||
    !Number.isFinite(profile.roundTripEfficiencyPercent) ||
    profile.roundTripEfficiencyPercent <= 0 ||
    profile.roundTripEfficiencyPercent > 100
  ) {
    throw new Error(
      `Invalid battery roundTripEfficiencyPercent: must be a finite number between 0 and 100. Received: ${profile.roundTripEfficiencyPercent}`
    );
  }

  // Validate initialState
  if (!initialState || typeof initialState !== 'object') {
    throw new Error('initialState must be a valid object.');
  }

  const provenanceKeys: (keyof BatterySocProvenanceState)[] = [
    'syntheticSocKwh',
    'gridChargedSocKwh',
    'renewableChargedSocKwh',
    'generatorChargedSocKwh',
  ];

  for (let k = 0; k < provenanceKeys.length; k++) {
    const key = provenanceKeys[k];
    const val = initialState[key];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      throw new Error(
        `Invalid initial state provenance for ${key}: must be a finite non-negative number. Received: ${val}`
      );
    }
  }

  const usableCapacityKwh = calculateUsableCapacityKwh(profile);
  const initialTotalSoc =
    initialState.syntheticSocKwh +
    initialState.gridChargedSocKwh +
    initialState.renewableChargedSocKwh +
    initialState.generatorChargedSocKwh;

  if (initialTotalSoc - usableCapacityKwh > 1e-9) {
    throw new Error(
      `Initial total SOC (${initialTotalSoc} kWh) exceeds usable capacity (${usableCapacityKwh} kWh).`
    );
  }

  const etaCharge = calculateChargeEfficiency(profile);
  const maxChargeAcKwh = profile.maxContinuousChargeKw * intervalHours;

  const currentSynthetic = initialState.syntheticSocKwh;
  const currentGrid = initialState.gridChargedSocKwh;
  let currentRenewable = initialState.renewableChargedSocKwh;
  const currentGenerator = initialState.generatorChargedSocKwh;

  let totalSolarToBatteryAcKwh = 0;
  let totalWindToBatteryAcKwh = 0;
  let totalRenewableToBatteryAcKwh = 0;
  let totalRenewableEnergyStoredKwh = 0;
  let totalRemainingSurplusSolarKwh = 0;
  let totalRemainingSurplusWindKwh = 0;
  let totalRemainingSurplusRenewableKwh = 0;

  const chargeIntervals: RenewableBatteryChargeInterval[] = new Array(
    intervals.length
  );

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (!inv || typeof inv !== 'object') {
      throw new Error(`Invalid interval at index ${i}: must be an object.`);
    }

    const surplusSolarAvailableKwh = inv.surplusSolarKwh;
    if (
      typeof surplusSolarAvailableKwh !== 'number' ||
      !Number.isFinite(surplusSolarAvailableKwh) ||
      surplusSolarAvailableKwh < 0
    ) {
      throw new Error(
        `Invalid surplusSolarKwh at index ${i}: must be a finite non-negative number. Received: ${surplusSolarAvailableKwh}`
      );
    }

    const surplusWindAvailableKwh =
      typeof (inv as any).surplusWindKwh === 'number' &&
      Number.isFinite((inv as any).surplusWindKwh) &&
      (inv as any).surplusWindKwh >= 0
        ? (inv as any).surplusWindKwh
        : 0;

    const totalRenewableSurplusAvailableKwh =
      typeof (inv as any).totalRenewableSurplusKwh === 'number' &&
      Number.isFinite((inv as any).totalRenewableSurplusKwh)
        ? (inv as any).totalRenewableSurplusKwh
        : surplusSolarAvailableKwh + surplusWindAvailableKwh;

    const residualHomeLoadKwh = inv.residualHomeLoadKwh;
    if (
      typeof residualHomeLoadKwh !== 'number' ||
      !Number.isFinite(residualHomeLoadKwh) ||
      residualHomeLoadKwh < 0
    ) {
      throw new Error(
        `Invalid residualHomeLoadKwh at index ${i}: must be a finite non-negative number. Received: ${residualHomeLoadKwh}`
      );
    }

    const batterySocBeforeKwh =
      currentSynthetic + currentGrid + currentRenewable + currentGenerator;
    const renewableSocBeforeKwh = currentRenewable;

    const roomStoredKwh = Math.max(0, usableCapacityKwh - batterySocBeforeKwh);
    const maxAcByCapacityKwh = roomStoredKwh / etaCharge;

    let renewableToBatteryAcKwh = Math.min(
      totalRenewableSurplusAvailableKwh,
      maxChargeAcKwh,
      maxAcByCapacityKwh
    );

    if (renewableToBatteryAcKwh < 1e-12) {
      renewableToBatteryAcKwh = 0;
    }

    let renewableEnergyStoredKwh = renewableToBatteryAcKwh * etaCharge;
    if (renewableEnergyStoredKwh < 1e-12) {
      renewableEnergyStoredKwh = 0;
    }

    // Source-neutral proportional allocation of accepted AC charge
    let solarToBatteryAcKwh = 0;
    let windToBatteryAcKwh = 0;

    if (
      renewableToBatteryAcKwh > 0 &&
      totalRenewableSurplusAvailableKwh > 0
    ) {
      const solarShare =
        surplusSolarAvailableKwh / totalRenewableSurplusAvailableKwh;
      const windShare =
        surplusWindAvailableKwh / totalRenewableSurplusAvailableKwh;

      solarToBatteryAcKwh = renewableToBatteryAcKwh * solarShare;
      windToBatteryAcKwh = renewableToBatteryAcKwh * windShare;
    }

    if (solarToBatteryAcKwh < 1e-12) {
      solarToBatteryAcKwh = 0;
    }
    if (windToBatteryAcKwh < 1e-12) {
      windToBatteryAcKwh = 0;
    }

    currentRenewable += renewableEnergyStoredKwh;

    // Guard against floating point imprecision exceeding usableCapacity
    const totalSocAfterRaw =
      currentSynthetic + currentGrid + currentRenewable + currentGenerator;
    if (
      totalSocAfterRaw > usableCapacityKwh &&
      totalSocAfterRaw - usableCapacityKwh < 1e-12
    ) {
      currentRenewable = Math.max(
        0,
        usableCapacityKwh - (currentSynthetic + currentGrid + currentGenerator)
      );
    }

    const batterySocAfterKwh =
      currentSynthetic + currentGrid + currentRenewable + currentGenerator;
    const renewableSocAfterKwh = currentRenewable;

    let remainingSurplusSolarKwh =
      surplusSolarAvailableKwh - solarToBatteryAcKwh;
    if (Math.abs(remainingSurplusSolarKwh) < 1e-12) {
      remainingSurplusSolarKwh = 0;
    }

    let remainingSurplusWindKwh =
      surplusWindAvailableKwh - windToBatteryAcKwh;
    if (Math.abs(remainingSurplusWindKwh) < 1e-12) {
      remainingSurplusWindKwh = 0;
    }

    let remainingSurplusRenewableKwh =
      remainingSurplusSolarKwh + remainingSurplusWindKwh;
    if (Math.abs(remainingSurplusRenewableKwh) < 1e-12) {
      remainingSurplusRenewableKwh = 0;
    }

    totalSolarToBatteryAcKwh += solarToBatteryAcKwh;
    totalWindToBatteryAcKwh += windToBatteryAcKwh;
    totalRenewableToBatteryAcKwh += renewableToBatteryAcKwh;
    totalRenewableEnergyStoredKwh += renewableEnergyStoredKwh;
    totalRemainingSurplusSolarKwh += remainingSurplusSolarKwh;
    totalRemainingSurplusWindKwh += remainingSurplusWindKwh;
    totalRemainingSurplusRenewableKwh += remainingSurplusRenewableKwh;

    chargeIntervals[i] = {
      sourceIndex: inv.sourceIndex,
      sourceTimestamp: inv.sourceTimestamp,
      timestampUtc: inv.timestampUtc,
      residualHomeLoadKwh,

      surplusSolarAvailableKwh,
      surplusWindAvailableKwh,
      totalRenewableSurplusAvailableKwh,

      solarToBatteryAcKwh,
      windToBatteryAcKwh,
      totalRenewableToBatteryAcKwh: renewableToBatteryAcKwh,
      renewableEnergyStoredKwh,

      remainingSurplusSolarKwh,
      remainingSurplusWindKwh,
      remainingSurplusRenewableKwh,

      batterySocBeforeKwh,
      batterySocAfterKwh,
      renewableSocBeforeKwh,
      renewableSocAfterKwh,
    };
  }

  return {
    intervals: chargeIntervals,
    initialState: {
      syntheticSocKwh: initialState.syntheticSocKwh,
      gridChargedSocKwh: initialState.gridChargedSocKwh,
      renewableChargedSocKwh: initialState.renewableChargedSocKwh,
      generatorChargedSocKwh: initialState.generatorChargedSocKwh,
    },
    finalState: {
      syntheticSocKwh: currentSynthetic,
      gridChargedSocKwh: currentGrid,
      renewableChargedSocKwh: currentRenewable,
      generatorChargedSocKwh: currentGenerator,
    },
    totalSolarToBatteryAcKwh,
    totalWindToBatteryAcKwh,
    totalRenewableToBatteryAcKwh,
    totalRenewableEnergyStoredKwh,
    totalRemainingSurplusSolarKwh,
    totalRemainingSurplusWindKwh,
    totalRemainingSurplusRenewableKwh,
  };
}

/**
 * Routes surplus solar energy to battery charging sequentially across intervals.
 * Backwards-compatibility wrapper delegating to routeSurplusRenewableToBattery.
 *
 * This function is pure and does not mutate its inputs or caller state.
 */
export function routeSurplusSolarToBattery(
  intervals: SolarLoadFlowInterval[],
  intervalHours: number,
  profile: BatteryProfile,
  initialState: BatterySocProvenanceState
): SolarBatteryChargeResult {
  return routeSurplusRenewableToBattery(
    intervals,
    intervalHours,
    profile,
    initialState
  );
}
