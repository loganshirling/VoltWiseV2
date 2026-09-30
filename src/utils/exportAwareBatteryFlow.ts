/**
 * Chronological Grid-SOC Battery Export Integration Engine (Milestone G3O)
 *
 * Chronological orchestration layer combining:
 *   1. Existing G3H physical dispatch (solar to load, surplus solar charging, grid charging, load discharge)
 *   2. G3M resolved tariff buy/sell rates per interval
 *   3. G3N grid-SOC cost-basis transitions tracking weighted-average acquisition cost
 *   4. G3L grid-charged battery export dispatch to the wholesale/retail grid
 *
 * Enforces:
 *   - Strict interval-by-interval state progression (battery SOC & cost basis advance together).
 *   - Upstream G3H/legacy precedence arbitration (grid charging branch precedence).
 *   - Arbitrage-only export permission with strict solar-charging mutual exclusion.
 *   - Authoritative G3L dispatch governing remaining inverter capacity and economic viability.
 *   - Direct carry-forward of post-export states into subsequent intervals.
 *
 * Pure function: does not mutate inputs. Does not yet modify downstream G3I grid-boundary
 * accounting, G3J tariff cost accounting, or annual simulation summaries.
 */

import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  ExportAwareBatteryFlowInterval,
  ExportAwareBatteryFlowResult,
  GridSocCostBasisState,
  ResolvedTariffRateInterval,
  SolarLoadFlowInterval,
} from '../types/energy';
import { calculateUsableCapacityKwh } from './solarBatteryCharging';
import { routeIntegratedBatteryFlow } from './integratedBatteryFlow';
import { advanceGridSocCostBasis } from './gridSocCostBasis';
import { exportGridChargedBatteryEnergy } from './gridBatteryExport';

const RECONCILIATION_EPSILON = 1e-6;
const ZERO_THRESHOLD = 1e-9;

/**
 * Chronologically routes solar/battery dispatch and grid-SOC battery export across intervals.
 *
 * @param intervals Array of upstream SolarLoadFlowInterval records
 * @param policy Array of BatteryDispatchPolicyInterval directives
 * @param resolvedRates Array of ResolvedTariffRateInterval pricing records
 * @param intervalHours Duration of each interval in hours (e.g. 1.0 or 0.25)
 * @param profile Battery specification and hardware capabilities
 * @param initialBatteryState Initial battery SOC provenance state
 * @param initialCostBasisState Initial grid-SOC cost-basis state
 * @returns Result containing chronological export-aware flow intervals, state transitions, and export totals
 */
export function routeExportAwareBatteryFlow(
  intervals: SolarLoadFlowInterval[],
  policy: BatteryDispatchPolicyInterval[],
  resolvedRates: ResolvedTariffRateInterval[],
  intervalHours: number,
  profile: BatteryProfile,
  initialBatteryState: BatterySocProvenanceState,
  initialCostBasisState: GridSocCostBasisState
): ExportAwareBatteryFlowResult {
  // 1. Array existence and non-emptiness validations
  if (!Array.isArray(intervals) || intervals.length === 0) {
    throw new Error('intervals must be a non-empty array.');
  }

  if (!Array.isArray(policy) || policy.length === 0) {
    throw new Error('policy must be a non-empty array.');
  }

  if (!Array.isArray(resolvedRates) || resolvedRates.length === 0) {
    throw new Error('resolvedRates must be a non-empty array.');
  }

  // 2. Length equality check
  const length = intervals.length;
  if (policy.length !== length) {
    throw new Error(
      `Policy length (${policy.length}) must match intervals length (${length}).`
    );
  }

  if (resolvedRates.length !== length) {
    throw new Error(
      `ResolvedRates length (${resolvedRates.length}) must match intervals length (${length}).`
    );
  }

  // 3. Interval duration validation
  if (
    typeof intervalHours !== 'number' ||
    !Number.isFinite(intervalHours) ||
    intervalHours <= 0
  ) {
    throw new Error(
      `intervalHours must be a finite positive number. Received: ${intervalHours}`
    );
  }

  // 4. Battery profile validation
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

  if (
    profile.strategy !== 'arbitrage' &&
    profile.strategy !== 'self_consumption'
  ) {
    throw new Error(
      `Invalid battery strategy: must be "arbitrage" or "self_consumption". Received: ${profile.strategy}`
    );
  }

  // 5. Initial battery state validation
  if (!initialBatteryState || typeof initialBatteryState !== 'object') {
    throw new Error('initialBatteryState must be a valid object.');
  }

  const provenanceKeys: (keyof BatterySocProvenanceState)[] = [
    'syntheticSocKwh',
    'gridChargedSocKwh',
    'renewableChargedSocKwh',
    'generatorChargedSocKwh',
  ];

  for (let k = 0; k < provenanceKeys.length; k++) {
    const key = provenanceKeys[k];
    const val = initialBatteryState[key];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      throw new Error(
        `Invalid initial battery state provenance for ${key}: must be a finite non-negative number. Received: ${val}`
      );
    }
  }

  const usableCapacityKwh = calculateUsableCapacityKwh(profile);
  const totalInitialSoc =
    initialBatteryState.syntheticSocKwh +
    initialBatteryState.gridChargedSocKwh +
    initialBatteryState.renewableChargedSocKwh +
    initialBatteryState.generatorChargedSocKwh;

  if (totalInitialSoc - usableCapacityKwh > ZERO_THRESHOLD) {
    throw new Error(
      `Initial total SOC (${totalInitialSoc} kWh) exceeds usable capacity (${usableCapacityKwh} kWh).`
    );
  }

  // 6. Initial cost-basis state validation
  if (!initialCostBasisState || typeof initialCostBasisState !== 'object') {
    throw new Error('initialCostBasisState must be a valid object.');
  }

  if (
    typeof initialCostBasisState.gridStoredEnergyKwh !== 'number' ||
    !Number.isFinite(initialCostBasisState.gridStoredEnergyKwh) ||
    initialCostBasisState.gridStoredEnergyKwh < 0
  ) {
    throw new Error(
      `Invalid initialCostBasisState.gridStoredEnergyKwh: must be a finite non-negative number. Received: ${initialCostBasisState.gridStoredEnergyKwh}`
    );
  }

  if (
    typeof initialCostBasisState.totalAcquisitionCostUsd !== 'number' ||
    !Number.isFinite(initialCostBasisState.totalAcquisitionCostUsd)
  ) {
    throw new Error(
      `Invalid initialCostBasisState.totalAcquisitionCostUsd: must be a finite number. Received: ${initialCostBasisState.totalAcquisitionCostUsd}`
    );
  }

  if (initialCostBasisState.gridStoredEnergyKwh <= ZERO_THRESHOLD) {
    if (
      Math.abs(initialCostBasisState.totalAcquisitionCostUsd) > ZERO_THRESHOLD
    ) {
      throw new Error(
        `Inconsistent initialCostBasisState: zero gridStoredEnergyKwh (${initialCostBasisState.gridStoredEnergyKwh}) must have zero acquisition cost basis, received ${initialCostBasisState.totalAcquisitionCostUsd}.`
      );
    }
  }

  // 7. Initial state reconciliation check
  if (
    Math.abs(
      initialBatteryState.gridChargedSocKwh -
        initialCostBasisState.gridStoredEnergyKwh
    ) > RECONCILIATION_EPSILON
  ) {
    throw new Error(
      `Initial state mismatch: initialBatteryState.gridChargedSocKwh (${initialBatteryState.gridChargedSocKwh}) !== initialCostBasisState.gridStoredEnergyKwh (${initialCostBasisState.gridStoredEnergyKwh}).`
    );
  }

  // State variables for chronological carry-forward
  let currentBatteryState: BatterySocProvenanceState = {
    syntheticSocKwh: initialBatteryState.syntheticSocKwh,
    gridChargedSocKwh: initialBatteryState.gridChargedSocKwh,
    renewableChargedSocKwh: initialBatteryState.renewableChargedSocKwh,
    generatorChargedSocKwh: initialBatteryState.generatorChargedSocKwh,
  };

  let currentCostBasisState: GridSocCostBasisState = {
    gridStoredEnergyKwh: initialCostBasisState.gridStoredEnergyKwh,
    totalAcquisitionCostUsd: initialCostBasisState.totalAcquisitionCostUsd,
  };

  const resultIntervals: ExportAwareBatteryFlowInterval[] = new Array(length);

  let totalBatteryExportAcKwh = 0;
  let totalExportRevenueUsd = 0;
  let totalExportGrossMarginUsd = 0;
  let totalGridSocCostRemovedForExportUsd = 0;

  for (let i = 0; i < length; i++) {
    const inv = intervals[i];
    if (!inv || typeof inv !== 'object') {
      throw new Error(`Invalid interval at index ${i}: must be an object.`);
    }

    const pol = policy[i];
    if (!pol || typeof pol !== 'object') {
      throw new Error(`Invalid policy at index ${i}: must be an object.`);
    }

    const rate = resolvedRates[i];
    if (!rate || typeof rate !== 'object') {
      throw new Error(`Invalid resolvedRate at index ${i}: must be an object.`);
    }

    // Alignment validations
    if (pol.sourceIndex !== inv.sourceIndex) {
      throw new Error(
        `Policy sourceIndex mismatch at index ${i}: expected ${inv.sourceIndex}, received ${pol.sourceIndex}.`
      );
    }

    if (pol.timestampUtc !== inv.timestampUtc) {
      throw new Error(
        `Policy timestampUtc mismatch at index ${i}: expected "${inv.timestampUtc}", received "${pol.timestampUtc}".`
      );
    }

    if (rate.sourceIndex !== inv.sourceIndex) {
      throw new Error(
        `ResolvedRate sourceIndex mismatch at index ${i}: expected ${inv.sourceIndex}, received ${rate.sourceIndex}.`
      );
    }

    if (rate.timestampUtc !== inv.timestampUtc) {
      throw new Error(
        `ResolvedRate timestampUtc mismatch at index ${i}: expected "${inv.timestampUtc}", received "${rate.timestampUtc}".`
      );
    }

    if (pol.tierId !== rate.tierId) {
      throw new Error(
        `Tier mismatch between policy and resolvedRates at index ${i}: policy has "${pol.tierId}", resolvedRates has "${rate.tierId}".`
      );
    }

    if (typeof rate.buyRate !== 'number' || !Number.isFinite(rate.buyRate)) {
      throw new Error(
        `Invalid buyRate at index ${i}: must be a finite number. Received: ${rate.buyRate}`
      );
    }

    if (typeof rate.sellRate !== 'number' || !Number.isFinite(rate.sellRate)) {
      throw new Error(
        `Invalid sellRate at index ${i}: must be a finite number. Received: ${rate.sellRate}`
      );
    }

    // Step 1: Run existing G3H physics
    const integratedResult = routeIntegratedBatteryFlow(
      [inv],
      [pol],
      intervalHours,
      profile,
      currentBatteryState
    );
    const flow = integratedResult.intervals[0];

    // Step 2: Advance grid-SOC cost basis
    const gridChargeAcquisitionCostUsd =
      flow.gridToBatteryAcKwh * rate.buyRate;

    const costBasisTransition = advanceGridSocCostBasis(
      currentCostBasisState,
      flow.gridEnergyStoredKwh,
      gridChargeAcquisitionCostUsd,
      flow.gridSocDrainedKwh
    );

    // Reconcile cost basis with battery state before export
    if (
      Math.abs(
        costBasisTransition.stateAfter.gridStoredEnergyKwh -
          flow.stateAfter.gridChargedSocKwh
      ) > RECONCILIATION_EPSILON
    ) {
      throw new Error(
        `Reconciliation mismatch before export at index ${i}: cost basis gridStoredEnergyKwh (${costBasisTransition.stateAfter.gridStoredEnergyKwh}) !== battery gridChargedSocKwh (${flow.stateAfter.gridChargedSocKwh}).`
      );
    }

    const costBasisAfterHomeDispatch = costBasisTransition.stateAfter;

    // Step 3: Determine whether the grid-charge branch won
    const socAfterRenewable =
      flow.batterySocBeforeKwh + flow.renewableEnergyStoredKwh;
    const gridChargeBranchSelected =
      pol.allowGridChargeFromGrid &&
      usableCapacityKwh - socAfterRenewable > ZERO_THRESHOLD;

    // Step 4: Determine export permission
    const allowBatteryExportInInterval =
      profile.strategy === 'arbitrage' &&
      pol.allowBatteryDischargeToLoad === true &&
      !gridChargeBranchSelected &&
      flow.solarToBatteryAcKwh <= ZERO_THRESHOLD;

    // Step 5: Invoke G3L
    const exportResult = exportGridChargedBatteryEnergy(
      allowBatteryExportInInterval,
      rate.sellRate,
      flow.batteryDeliveredToLoadKwh,
      intervalHours,
      profile,
      flow.stateAfter,
      costBasisTransition.stateAfter
    );

    // Step 6: Carry state forward
    currentBatteryState = exportResult.batteryStateAfter;
    currentCostBasisState = exportResult.costBasisStateAfter;

    // Record interval result
    resultIntervals[i] = {
      sourceIndex: inv.sourceIndex,
      sourceTimestamp: inv.sourceTimestamp,
      timestampUtc: inv.timestampUtc,
      tierId: pol.tierId,
      buyRate: rate.buyRate,
      sellRate: rate.sellRate,
      preExportFlow: flow,
      integratedBatteryFlow: flow,
      gridChargeBranchSelected,
      gridChargeAcquisitionCostUsd,
      costBasisAfterHomeDispatch,
      allowBatteryExportInInterval,
      exportResult,
      gridBatteryExport: exportResult,
      batteryStateAfterExport: exportResult.batteryStateAfter,
      costBasisStateAfterExport: exportResult.costBasisStateAfter,
    };

    // Accumulate result totals
    totalBatteryExportAcKwh += exportResult.batteryExportAcKwh;
    totalExportRevenueUsd += exportResult.exportRevenueUsd;
    totalExportGrossMarginUsd += exportResult.exportGrossMarginUsd;
    totalGridSocCostRemovedForExportUsd +=
      exportResult.gridSocCostRemovedForExportUsd;
  }

  return {
    intervals: resultIntervals,
    initialBatteryState: { ...initialBatteryState },
    finalBatteryState: { ...currentBatteryState },
    initialCostBasisState: { ...initialCostBasisState },
    finalCostBasisState: { ...currentCostBasisState },
    initialState: { ...initialBatteryState },
    finalState: { ...currentBatteryState },
    totalBatteryExportAcKwh,
    totalExportRevenueUsd,
    totalExportGrossMarginUsd,
    totalGridSocCostRemovedForExportUsd,
    batteryExportAcKwh: totalBatteryExportAcKwh,
    exportRevenueUsd: totalExportRevenueUsd,
    exportGrossMarginUsd: totalExportGrossMarginUsd,
    gridSocCostRemovedForExportUsd: totalGridSocCostRemovedForExportUsd,
  };
}
