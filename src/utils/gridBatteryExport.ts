/**
 * Grid-Charged Battery Export Primitive (Milestone G3L)
 *
 * Implements a pure single-interval battery-to-grid export decision and dispatch primitive:
 *   - Only GRID-CHARGED SOC may be exported.
 *   - Respects inverter discharge capacity remaining after serving household load.
 *   - Evaluates economic profitability based on the weighted-average acquisition cost
 *     and inverter round-trip discharge efficiency.
 *   - Uses strict inequality: sellRate > effectiveDeliveryCostPerAcKwh.
 *   - Depletes only grid-provenance SOC, removing proportional acquisition cost basis.
 *   - Supports finite negative acquisition costs and negative sell rates mathematically.
 *
 * Pure function: does not mutate inputs. Does not modify chronological dispatch,
 * G3J tariff accounting, solar exports, or long-term financial results.
 */

import {
  BatteryProfile,
  BatterySocProvenanceState,
  GridBatteryExportResult,
  GridSocCostBasisState,
} from '../types/energy';
import { calculateDischargeEfficiency } from './batteryDischarge';

const EPSILON = 1e-6;
const ZERO_THRESHOLD = 1e-9;

/**
 * Evaluates and dispatches battery-to-grid export of stored grid-charged energy.
 *
 * @param allowExportInInterval Whether the current interval permits battery export to grid
 * @param sellRate Grid sell / feed-in compensation rate ($/kWh)
 * @param batteryDeliveredToLoadKwh AC energy already discharged to household load in this interval (kWh)
 * @param intervalHours Duration of the interval in hours (e.g. 1.0 or 0.25)
 * @param profile Battery specification and hardware capabilities
 * @param batteryState Provenance-tracked battery SOC state before export
 * @param costBasisState Grid-charged SOC acquisition-cost ledger before export
 * @returns Result containing export quantities, economic metrics, and updated states
 */
export function exportGridChargedBatteryEnergy(
  allowExportInInterval: boolean,
  sellRate: number,
  batteryDeliveredToLoadKwh: number,
  intervalHours: number,
  profile: BatteryProfile,
  batteryState: BatterySocProvenanceState,
  costBasisState: GridSocCostBasisState
): GridBatteryExportResult {
  // 1. Parameter type and range validations
  if (typeof allowExportInInterval !== 'boolean') {
    throw new Error(
      `Invalid allowExportInInterval: must be a boolean. Received: ${allowExportInInterval}`
    );
  }

  if (typeof sellRate !== 'number' || !Number.isFinite(sellRate)) {
    throw new Error(
      `Invalid sellRate: must be a finite number. Received: ${sellRate}`
    );
  }

  if (
    typeof batteryDeliveredToLoadKwh !== 'number' ||
    !Number.isFinite(batteryDeliveredToLoadKwh) ||
    batteryDeliveredToLoadKwh < 0
  ) {
    throw new Error(
      `Invalid batteryDeliveredToLoadKwh: must be a finite non-negative number. Received: ${batteryDeliveredToLoadKwh}`
    );
  }

  if (
    typeof intervalHours !== 'number' ||
    !Number.isFinite(intervalHours) ||
    intervalHours <= 0
  ) {
    throw new Error(
      `Invalid intervalHours: must be a finite positive number. Received: ${intervalHours}`
    );
  }

  // 2. Profile validation
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

  // 3. BatteryState validation
  if (!batteryState || typeof batteryState !== 'object') {
    throw new Error('batteryState must be a valid object.');
  }

  const provenanceKeys: (keyof BatterySocProvenanceState)[] = [
    'syntheticSocKwh',
    'gridChargedSocKwh',
    'renewableChargedSocKwh',
    'generatorChargedSocKwh',
  ];

  for (let k = 0; k < provenanceKeys.length; k++) {
    const key = provenanceKeys[k];
    const val = batteryState[key];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      throw new Error(
        `Invalid batteryState provenance for ${key}: must be a finite non-negative number. Received: ${val}`
      );
    }
  }

  const usableCapacityKwh =
    profile.totalCapacityKwh * (profile.usableDodPercent / 100);
  const totalSocKwh =
    batteryState.syntheticSocKwh +
    batteryState.gridChargedSocKwh +
    batteryState.renewableChargedSocKwh +
    batteryState.generatorChargedSocKwh;

  if (totalSocKwh - usableCapacityKwh > EPSILON) {
    throw new Error(
      `Battery total SOC (${totalSocKwh} kWh) exceeds usable capacity (${usableCapacityKwh} kWh).`
    );
  }

  // 4. CostBasisState validation
  if (!costBasisState || typeof costBasisState !== 'object') {
    throw new Error('costBasisState must be a valid object.');
  }

  if (
    typeof costBasisState.gridStoredEnergyKwh !== 'number' ||
    !Number.isFinite(costBasisState.gridStoredEnergyKwh) ||
    costBasisState.gridStoredEnergyKwh < 0
  ) {
    throw new Error(
      `Invalid costBasisState.gridStoredEnergyKwh: must be a finite non-negative number. Received: ${costBasisState.gridStoredEnergyKwh}`
    );
  }

  if (
    typeof costBasisState.totalAcquisitionCostUsd !== 'number' ||
    !Number.isFinite(costBasisState.totalAcquisitionCostUsd)
  ) {
    throw new Error(
      `Invalid costBasisState.totalAcquisitionCostUsd: must be a finite number. Received: ${costBasisState.totalAcquisitionCostUsd}`
    );
  }

  // Zero-energy state must have zero acquisition cost
  if (costBasisState.gridStoredEnergyKwh <= ZERO_THRESHOLD) {
    if (Math.abs(costBasisState.totalAcquisitionCostUsd) > ZERO_THRESHOLD) {
      throw new Error(
        `Inconsistent costBasisState: zero gridStoredEnergyKwh (${costBasisState.gridStoredEnergyKwh}) must have zero acquisition cost basis, received ${costBasisState.totalAcquisitionCostUsd}.`
      );
    }
  }

  // 5. State reconciliation
  if (
    Math.abs(batteryState.gridChargedSocKwh - costBasisState.gridStoredEnergyKwh) >
    EPSILON
  ) {
    throw new Error(
      `State reconciliation mismatch: batteryState.gridChargedSocKwh (${batteryState.gridChargedSocKwh}) !== costBasisState.gridStoredEnergyKwh (${costBasisState.gridStoredEnergyKwh}).`
    );
  }

  // 6. Inverter and discharge limits
  const maxDischargeAcKwh = profile.maxContinuousOutputKw * intervalHours;
  if (batteryDeliveredToLoadKwh > maxDischargeAcKwh + EPSILON) {
    throw new Error(
      `batteryDeliveredToLoadKwh (${batteryDeliveredToLoadKwh}) exceeds interval discharge limit (${maxDischargeAcKwh}).`
    );
  }

  const remainingDischargeCapacityAcKwh = Math.max(
    0,
    maxDischargeAcKwh - batteryDeliveredToLoadKwh
  );

  const etaDischarge = calculateDischargeEfficiency(profile);

  // Available AC export from grid SOC
  const availableGridExportAcKwh =
    batteryState.gridChargedSocKwh * etaDischarge;

  // 7. Export economics
  const hasGridSoc =
    batteryState.gridChargedSocKwh > ZERO_THRESHOLD &&
    costBasisState.gridStoredEnergyKwh > ZERO_THRESHOLD;

  let averageAcquisitionCostPerStoredKwh = 0;
  let effectiveDeliveryCostPerAcKwh = 0;
  let exportEconomic = false;

  if (hasGridSoc) {
    averageAcquisitionCostPerStoredKwh =
      costBasisState.totalAcquisitionCostUsd / costBasisState.gridStoredEnergyKwh;
    effectiveDeliveryCostPerAcKwh =
      averageAcquisitionCostPerStoredKwh / etaDischarge;
    // Strict greater-than: equal price is not profitable
    exportEconomic = sellRate > effectiveDeliveryCostPerAcKwh;
  }

  // 8. Eligibility evaluation
  const exportAllowed = Boolean(
    allowExportInInterval && profile.allowGridExport === true
  );

  const isEligible =
    exportAllowed &&
    exportEconomic &&
    hasGridSoc &&
    remainingDischargeCapacityAcKwh > ZERO_THRESHOLD;

  // 9. Dispatch and cost-basis accounting
  let batteryExportAcKwh = 0;
  let gridSocDrainedForExportKwh = 0;
  let gridSocCostRemovedForExportUsd = 0;
  let exportRevenueUsd = 0;
  let exportGrossMarginUsd = 0;

  let gridChargedSocAfter = hasGridSoc ? batteryState.gridChargedSocKwh : 0;
  let gridStoredEnergyAfter = hasGridSoc ? costBasisState.gridStoredEnergyKwh : 0;
  let totalAcquisitionCostAfter = hasGridSoc
    ? costBasisState.totalAcquisitionCostUsd
    : 0;

  if (isEligible) {
    batteryExportAcKwh = Math.min(
      remainingDischargeCapacityAcKwh,
      availableGridExportAcKwh
    );
    gridSocDrainedForExportKwh = batteryExportAcKwh / etaDischarge;

    gridSocCostRemovedForExportUsd =
      gridSocDrainedForExportKwh * averageAcquisitionCostPerStoredKwh;

    exportRevenueUsd = batteryExportAcKwh * sellRate;
    exportGrossMarginUsd =
      exportRevenueUsd - gridSocCostRemovedForExportUsd;

    gridChargedSocAfter =
      batteryState.gridChargedSocKwh - gridSocDrainedForExportKwh;
    gridStoredEnergyAfter =
      costBasisState.gridStoredEnergyKwh - gridSocDrainedForExportKwh;
    totalAcquisitionCostAfter =
      costBasisState.totalAcquisitionCostUsd - gridSocCostRemovedForExportUsd;

    // Normalize to exact zero if remaining stored grid energy is negligible
    if (
      gridChargedSocAfter <= ZERO_THRESHOLD ||
      gridStoredEnergyAfter <= ZERO_THRESHOLD
    ) {
      gridChargedSocAfter = 0;
      gridStoredEnergyAfter = 0;
      totalAcquisitionCostAfter = 0;
    }
  }

  return {
    exportAllowed,
    exportEconomic,
    sellRate,
    averageAcquisitionCostPerStoredKwh,
    effectiveDeliveryCostPerAcKwh,
    remainingDischargeCapacityAcKwh,
    batteryExportAcKwh,
    gridSocDrainedForExportKwh,
    gridSocCostRemovedForExportUsd,
    exportRevenueUsd,
    exportGrossMarginUsd,
    batteryStateBefore: { ...batteryState },
    batteryStateAfter: {
      ...batteryState,
      gridChargedSocKwh: gridChargedSocAfter,
    },
    costBasisStateBefore: { ...costBasisState },
    costBasisStateAfter: {
      gridStoredEnergyKwh: gridStoredEnergyAfter,
      totalAcquisitionCostUsd: totalAcquisitionCostAfter,
    },
  };
}
