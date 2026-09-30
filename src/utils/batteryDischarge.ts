/**
 * Provenance-Aware Battery Discharge Primitive (Milestone G3C)
 *
 * Models a single-interval battery discharge to household AC load.
 * Respects inverter/battery discharge efficiency, maximum continuous output power,
 * and available stored SOC.
 *
 * Depletes stored energy provenance in exact priority order:
 *   1. syntheticSocKwh
 *   2. renewableChargedSocKwh
 *   3. generatorChargedSocKwh
 *   4. gridChargedSocKwh
 */

import {
  BatteryProfile,
  BatterySocProvenanceState,
  BatteryLoadDischargeResult,
} from '../types/energy';

/**
 * Calculates symmetric square-root one-way discharge efficiency:
 *   rte = clamp(profile.roundTripEfficiencyPercent / 100, 0.5, 1.0)
 *   etaDischarge = sqrt(rte)
 */
export function calculateDischargeEfficiency(profile: BatteryProfile): number {
  const rte = Math.max(
    0.5,
    Math.min(1.0, profile.roundTripEfficiencyPercent / 100)
  );
  return Math.sqrt(rte);
}

/**
 * Discharges battery to serve requested home load for a single interval.
 * Pure function: does not mutate profile or initialState.
 */
export function dischargeBatteryToHomeLoad(
  requestedHomeLoadKwh: number,
  intervalHours: number,
  profile: BatteryProfile,
  initialState: BatterySocProvenanceState
): BatteryLoadDischargeResult {
  // Validate requestedHomeLoadKwh
  if (
    typeof requestedHomeLoadKwh !== 'number' ||
    !Number.isFinite(requestedHomeLoadKwh) ||
    requestedHomeLoadKwh < 0
  ) {
    throw new Error(
      `Invalid requestedHomeLoadKwh: must be a finite non-negative number. Received: ${requestedHomeLoadKwh}`
    );
  }

  // Validate intervalHours
  if (
    typeof intervalHours !== 'number' ||
    !Number.isFinite(intervalHours) ||
    intervalHours <= 0
  ) {
    throw new Error(
      `Invalid intervalHours: must be a finite positive number. Received: ${intervalHours}`
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
    typeof profile.maxContinuousOutputKw !== 'number' ||
    !Number.isFinite(profile.maxContinuousOutputKw) ||
    profile.maxContinuousOutputKw < 0
  ) {
    throw new Error(
      `Invalid battery maxContinuousOutputKw: must be a finite non-negative number. Received: ${profile.maxContinuousOutputKw}`
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

  const usableCapacityKwh =
    profile.totalCapacityKwh * (profile.usableDodPercent / 100);

  const totalSocKwh =
    initialState.syntheticSocKwh +
    initialState.gridChargedSocKwh +
    initialState.renewableChargedSocKwh +
    initialState.generatorChargedSocKwh;

  if (totalSocKwh - usableCapacityKwh > 1e-9) {
    throw new Error(
      `Initial total SOC (${totalSocKwh} kWh) exceeds usable capacity (${usableCapacityKwh} kWh).`
    );
  }

  const etaDischarge = calculateDischargeEfficiency(profile);
  const availableAcKwh = totalSocKwh * etaDischarge;
  const maxDischargeAcKwh = profile.maxContinuousOutputKw * intervalHours;

  let batteryDeliveredToLoadKwh = Math.min(
    requestedHomeLoadKwh,
    maxDischargeAcKwh,
    availableAcKwh
  );

  if (batteryDeliveredToLoadKwh < 1e-12) {
    batteryDeliveredToLoadKwh = 0;
  }

  let storedEnergyDrainedKwh = batteryDeliveredToLoadKwh / etaDischarge;
  if (storedEnergyDrainedKwh < 1e-12) {
    storedEnergyDrainedKwh = 0;
  }

  let unmetHomeLoadKwh = requestedHomeLoadKwh - batteryDeliveredToLoadKwh;
  if (Math.abs(unmetHomeLoadKwh) < 1e-12) {
    unmetHomeLoadKwh = 0;
  }

  // Provenance depletion order:
  // 1. syntheticSocKwh
  // 2. renewableChargedSocKwh
  // 3. generatorChargedSocKwh
  // 4. gridChargedSocKwh
  let remainingToDrain = storedEnergyDrainedKwh;

  let syntheticSocDrainedKwh = Math.min(
    initialState.syntheticSocKwh,
    remainingToDrain
  );
  remainingToDrain -= syntheticSocDrainedKwh;
  if (syntheticSocDrainedKwh < 1e-12) syntheticSocDrainedKwh = 0;

  let renewableSocDrainedKwh = Math.min(
    initialState.renewableChargedSocKwh,
    remainingToDrain
  );
  remainingToDrain -= renewableSocDrainedKwh;
  if (renewableSocDrainedKwh < 1e-12) renewableSocDrainedKwh = 0;

  let generatorSocDrainedKwh = Math.min(
    initialState.generatorChargedSocKwh,
    remainingToDrain
  );
  remainingToDrain -= generatorSocDrainedKwh;
  if (generatorSocDrainedKwh < 1e-12) generatorSocDrainedKwh = 0;

  let gridSocDrainedKwh = Math.min(
    initialState.gridChargedSocKwh,
    remainingToDrain
  );
  remainingToDrain -= gridSocDrainedKwh;
  if (gridSocDrainedKwh < 1e-12) gridSocDrainedKwh = 0;

  let newSynthetic = initialState.syntheticSocKwh - syntheticSocDrainedKwh;
  let newRenewable = initialState.renewableChargedSocKwh - renewableSocDrainedKwh;
  let newGenerator = initialState.generatorChargedSocKwh - generatorSocDrainedKwh;
  let newGrid = initialState.gridChargedSocKwh - gridSocDrainedKwh;

  if (newSynthetic < 1e-12) newSynthetic = 0;
  if (newRenewable < 1e-12) newRenewable = 0;
  if (newGenerator < 1e-12) newGenerator = 0;
  if (newGrid < 1e-12) newGrid = 0;

  const stateBefore: BatterySocProvenanceState = {
    syntheticSocKwh: initialState.syntheticSocKwh,
    gridChargedSocKwh: initialState.gridChargedSocKwh,
    renewableChargedSocKwh: initialState.renewableChargedSocKwh,
    generatorChargedSocKwh: initialState.generatorChargedSocKwh,
  };

  const stateAfter: BatterySocProvenanceState = {
    syntheticSocKwh: newSynthetic,
    gridChargedSocKwh: newGrid,
    renewableChargedSocKwh: newRenewable,
    generatorChargedSocKwh: newGenerator,
  };

  const batterySocBeforeKwh = totalSocKwh;
  const batterySocAfterKwh =
    newSynthetic + newGrid + newRenewable + newGenerator;

  return {
    requestedHomeLoadKwh,
    batteryDeliveredToLoadKwh,
    unmetHomeLoadKwh,
    storedEnergyDrainedKwh,
    syntheticSocDrainedKwh,
    renewableSocDrainedKwh,
    generatorSocDrainedKwh,
    gridSocDrainedKwh,
    batterySocBeforeKwh,
    batterySocAfterKwh,
    stateBefore,
    stateAfter,
  };
}
