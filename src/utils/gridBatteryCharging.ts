/**
 * Grid-to-Battery Charging Primitive (Milestone G3F)
 *
 * Models a single-interval battery charge from AC grid electricity.
 * Evaluates physical charge power rate limits, remaining storage capacity,
 * and square-root charge conversion efficiency.
 *
 * Updates gridChargedSocKwh in the SOC provenance state.
 * Makes no TOU, economic, tariff, or scheduling decisions.
 */

import {
  BatteryProfile,
  BatterySocProvenanceState,
  GridBatteryChargeResult,
} from '../types/energy';
import {
  calculateUsableCapacityKwh,
  calculateChargeEfficiency,
} from './solarBatteryCharging';

/**
 * Charges battery from AC grid electricity for a single interval.
 *
 * Pure function: does not mutate inputs.
 */
export function chargeBatteryFromGrid(
  requestedGridChargeAcKwh: number,
  intervalHours: number,
  profile: BatteryProfile,
  initialState: BatterySocProvenanceState
): GridBatteryChargeResult {
  // Validate requestedGridChargeAcKwh
  if (
    typeof requestedGridChargeAcKwh !== 'number' ||
    !Number.isFinite(requestedGridChargeAcKwh) ||
    requestedGridChargeAcKwh < 0
  ) {
    throw new Error(
      `Invalid requestedGridChargeAcKwh: must be a finite non-negative number. Received: ${requestedGridChargeAcKwh}`
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

  const etaCharge = calculateChargeEfficiency(profile);
  const roomStoredKwh = Math.max(0, usableCapacityKwh - totalSocKwh);
  const maxChargeAcKwh = profile.maxContinuousChargeKw * intervalHours;
  const maxAcByCapacityKwh = roomStoredKwh / etaCharge;

  let gridToBatteryAcKwh = Math.min(
    requestedGridChargeAcKwh,
    maxChargeAcKwh,
    maxAcByCapacityKwh
  );

  if (gridToBatteryAcKwh < 1e-12) {
    gridToBatteryAcKwh = 0;
  }

  let gridEnergyStoredKwh = gridToBatteryAcKwh * etaCharge;
  if (gridEnergyStoredKwh < 1e-12) {
    gridEnergyStoredKwh = 0;
  }

  let currentGrid = initialState.gridChargedSocKwh + gridEnergyStoredKwh;

  // Guard against floating point imprecision exceeding usableCapacity
  const totalSocAfterRaw =
    initialState.syntheticSocKwh +
    currentGrid +
    initialState.renewableChargedSocKwh +
    initialState.generatorChargedSocKwh;

  if (
    totalSocAfterRaw > usableCapacityKwh &&
    totalSocAfterRaw - usableCapacityKwh < 1e-12
  ) {
    currentGrid = Math.max(
      0,
      usableCapacityKwh -
        (initialState.syntheticSocKwh +
          initialState.renewableChargedSocKwh +
          initialState.generatorChargedSocKwh)
    );
  }

  let unfulfilledGridChargeRequestKwh =
    requestedGridChargeAcKwh - gridToBatteryAcKwh;
  if (Math.abs(unfulfilledGridChargeRequestKwh) < 1e-12) {
    unfulfilledGridChargeRequestKwh = 0;
  }

  const stateBefore: BatterySocProvenanceState = {
    syntheticSocKwh: initialState.syntheticSocKwh,
    gridChargedSocKwh: initialState.gridChargedSocKwh,
    renewableChargedSocKwh: initialState.renewableChargedSocKwh,
    generatorChargedSocKwh: initialState.generatorChargedSocKwh,
  };

  const stateAfter: BatterySocProvenanceState = {
    syntheticSocKwh: initialState.syntheticSocKwh,
    gridChargedSocKwh: currentGrid,
    renewableChargedSocKwh: initialState.renewableChargedSocKwh,
    generatorChargedSocKwh: initialState.generatorChargedSocKwh,
  };

  const batterySocBeforeKwh = totalSocKwh;
  const batterySocAfterKwh =
    stateAfter.syntheticSocKwh +
    stateAfter.gridChargedSocKwh +
    stateAfter.renewableChargedSocKwh +
    stateAfter.generatorChargedSocKwh;

  const gridSocBeforeKwh = initialState.gridChargedSocKwh;
  const gridSocAfterKwh = currentGrid;

  return {
    requestedGridChargeAcKwh,
    gridToBatteryAcKwh,
    gridEnergyStoredKwh,
    unfulfilledGridChargeRequestKwh,
    batterySocBeforeKwh,
    batterySocAfterKwh,
    gridSocBeforeKwh,
    gridSocAfterKwh,
    stateBefore,
    stateAfter,
  };
}
