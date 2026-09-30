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
  SolarBatteryChargeInterval,
  SolarBatteryChargeResult,
  SolarLoadFlowInterval,
} from '../types/energy';

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
 * Routes surplus solar energy to battery charging sequentially across intervals.
 *
 * This function is pure and does not mutate its inputs or caller state.
 */
export function routeSurplusSolarToBattery(
  intervals: SolarLoadFlowInterval[],
  intervalHours: number,
  profile: BatteryProfile,
  initialState: BatterySocProvenanceState
): SolarBatteryChargeResult {
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
  let totalRenewableEnergyStoredKwh = 0;
  let totalRemainingSurplusSolarKwh = 0;

  const chargeIntervals: SolarBatteryChargeInterval[] = new Array(
    intervals.length
  );

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (!inv || typeof inv !== 'object') {
      throw new Error(`Invalid interval at index ${i}: must be an object.`);
    }

    const surplusAcKwh = inv.surplusSolarKwh;
    if (
      typeof surplusAcKwh !== 'number' ||
      !Number.isFinite(surplusAcKwh) ||
      surplusAcKwh < 0
    ) {
      throw new Error(
        `Invalid surplusSolarKwh at index ${i}: must be a finite non-negative number. Received: ${surplusAcKwh}`
      );
    }

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

    let solarToBatteryAcKwh = Math.min(
      surplusAcKwh,
      maxChargeAcKwh,
      maxAcByCapacityKwh
    );

    if (solarToBatteryAcKwh < 1e-12) {
      solarToBatteryAcKwh = 0;
    }

    let renewableEnergyStoredKwh = solarToBatteryAcKwh * etaCharge;
    if (renewableEnergyStoredKwh < 1e-12) {
      renewableEnergyStoredKwh = 0;
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

    let remainingSurplusSolarKwh = surplusAcKwh - solarToBatteryAcKwh;
    if (Math.abs(remainingSurplusSolarKwh) < 1e-12) {
      remainingSurplusSolarKwh = 0;
    }

    totalSolarToBatteryAcKwh += solarToBatteryAcKwh;
    totalRenewableEnergyStoredKwh += renewableEnergyStoredKwh;
    totalRemainingSurplusSolarKwh += remainingSurplusSolarKwh;

    chargeIntervals[i] = {
      sourceIndex: inv.sourceIndex,
      sourceTimestamp: inv.sourceTimestamp,
      timestampUtc: inv.timestampUtc,
      residualHomeLoadKwh,
      surplusSolarAvailableKwh: surplusAcKwh,
      solarToBatteryAcKwh,
      renewableEnergyStoredKwh,
      remainingSurplusSolarKwh,
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
    totalRenewableEnergyStoredKwh,
    totalRemainingSurplusSolarKwh,
  };
}
