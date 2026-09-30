/**
 * Integrated Sequential Solar/Grid/Battery Flow Kernel (Milestone G3H)
 *
 * Chronological physical dispatch kernel combining:
 *   1. Solar directly to home load (G3A upstream input)
 *   2. Surplus solar to battery storage (G3B renewable priority charging)
 *   3. Remaining shared charge power capacity to grid charging (G3F grid charging)
 *   4. Battery discharge to residual home load when permitted (G3C discharge)
 *
 * Precedence rule:
 *   If both grid-charge and discharge permissions are active and battery has room,
 *   GRID CHARGING WINS (discharge is not attempted and residual load remains).
 *   If both permissions are active but battery is full, charging is unavailable
 *   and discharge may proceed.
 *
 * Tracks battery SOC and provenance chronologically across intervals.
 * Makes no economic, tariff, or financial calculations.
 */

import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  IntegratedBatteryFlowInterval,
  IntegratedBatteryFlowResult,
  SolarLoadFlowInterval,
} from '../types/energy';
import {
  calculateUsableCapacityKwh,
  routeSurplusSolarToBattery,
} from './solarBatteryCharging';
import { chargeBatteryFromGrid } from './gridBatteryCharging';
import { dischargeBatteryToHomeLoad } from './batteryDischarge';

/**
 * Routes solar, grid charging, and battery flow sequentially across intervals.
 *
 * Pure function: does not mutate inputs or caller state.
 */
export function routeIntegratedBatteryFlow(
  intervals: SolarLoadFlowInterval[],
  policy: BatteryDispatchPolicyInterval[],
  intervalHours: number,
  profile: BatteryProfile,
  initialState: BatterySocProvenanceState
): IntegratedBatteryFlowResult {
  // Validate intervals array
  if (!Array.isArray(intervals)) {
    throw new Error('intervals must be an array.');
  }

  // Validate policy array
  if (!Array.isArray(policy)) {
    throw new Error('policy must be an array.');
  }

  if (policy.length !== intervals.length) {
    throw new Error(
      `Policy length (${policy.length}) must match intervals length (${intervals.length}).`
    );
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

  let currentState: BatterySocProvenanceState = {
    syntheticSocKwh: initialState.syntheticSocKwh,
    gridChargedSocKwh: initialState.gridChargedSocKwh,
    renewableChargedSocKwh: initialState.renewableChargedSocKwh,
    generatorChargedSocKwh: initialState.generatorChargedSocKwh,
  };

  let totalSolarToBatteryAcKwh = 0;
  let totalRenewableEnergyStoredKwh = 0;
  let totalGridToBatteryAcKwh = 0;
  let totalGridEnergyStoredKwh = 0;
  let totalBatteryDeliveredToLoadKwh = 0;
  let totalStoredEnergyDrainedKwh = 0;
  let totalResidualHomeLoadAfterBatteryKwh = 0;
  let totalRemainingSurplusSolarKwh = 0;

  const resultIntervals: IntegratedBatteryFlowInterval[] = new Array(
    intervals.length
  );

  const maxChargeAcKwh = profile.maxContinuousChargeKw * intervalHours;

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (!inv || typeof inv !== 'object') {
      throw new Error(`Invalid interval at index ${i}: must be an object.`);
    }

    const pol = policy[i];
    if (!pol || typeof pol !== 'object') {
      throw new Error(`Invalid policy at index ${i}: must be an object.`);
    }

    // Alignment validation
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

    if (typeof pol.allowGridChargeFromGrid !== 'boolean') {
      throw new Error(
        `Invalid allowGridChargeFromGrid at index ${i}: must be a boolean.`
      );
    }

    if (typeof pol.allowBatteryDischargeToLoad !== 'boolean') {
      throw new Error(
        `Invalid allowBatteryDischargeToLoad at index ${i}: must be a boolean.`
      );
    }

    if (typeof pol.tierId !== 'string' || pol.tierId.trim() === '') {
      throw new Error(
        `Invalid tierId at index ${i}: must be a non-empty string. Received: ${pol.tierId}`
      );
    }

    // Upstream flow validation
    if (
      typeof inv.homeLoadKwh !== 'number' ||
      !Number.isFinite(inv.homeLoadKwh) ||
      inv.homeLoadKwh < 0
    ) {
      throw new Error(
        `Invalid homeLoadKwh at index ${i}: must be a finite non-negative number. Received: ${inv.homeLoadKwh}`
      );
    }

    if (
      typeof inv.solarGenerationKwh !== 'number' ||
      !Number.isFinite(inv.solarGenerationKwh) ||
      inv.solarGenerationKwh < 0
    ) {
      throw new Error(
        `Invalid solarGenerationKwh at index ${i}: must be a finite non-negative number. Received: ${inv.solarGenerationKwh}`
      );
    }

    if (
      typeof inv.solarDirectToLoadKwh !== 'number' ||
      !Number.isFinite(inv.solarDirectToLoadKwh) ||
      inv.solarDirectToLoadKwh < 0
    ) {
      throw new Error(
        `Invalid solarDirectToLoadKwh at index ${i}: must be a finite non-negative number. Received: ${inv.solarDirectToLoadKwh}`
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

    const surplusSolarKwh = inv.surplusSolarKwh;
    if (
      typeof surplusSolarKwh !== 'number' ||
      !Number.isFinite(surplusSolarKwh) ||
      surplusSolarKwh < 0
    ) {
      throw new Error(
        `Invalid surplusSolarKwh at index ${i}: must be a finite non-negative number. Received: ${surplusSolarKwh}`
      );
    }

    // Reject contradictory upstream flow
    if (residualHomeLoadKwh > 1e-9 && surplusSolarKwh > 1e-9) {
      throw new Error(
        `Contradictory upstream solar-load flow at index ${i}: simultaneous residual load (${residualHomeLoadKwh} kWh) and surplus solar (${surplusSolarKwh} kWh).`
      );
    }

    const stateBefore: BatterySocProvenanceState = {
      syntheticSocKwh: currentState.syntheticSocKwh,
      gridChargedSocKwh: currentState.gridChargedSocKwh,
      renewableChargedSocKwh: currentState.renewableChargedSocKwh,
      generatorChargedSocKwh: currentState.generatorChargedSocKwh,
    };

    const batterySocBeforeKwh =
      stateBefore.syntheticSocKwh +
      stateBefore.gridChargedSocKwh +
      stateBefore.renewableChargedSocKwh +
      stateBefore.generatorChargedSocKwh;

    // Stage 1: Renewable charging first
    let solarToBatteryAcKwh = 0;
    let renewableEnergyStoredKwh = 0;
    let remainingSurplusSolarKwh = surplusSolarKwh;

    if (surplusSolarKwh > 1e-12) {
      const chargeResult = routeSurplusSolarToBattery(
        [inv],
        intervalHours,
        profile,
        currentState
      );
      const chargeInv = chargeResult.intervals[0];

      solarToBatteryAcKwh = chargeInv.solarToBatteryAcKwh;
      renewableEnergyStoredKwh = chargeInv.renewableEnergyStoredKwh;
      remainingSurplusSolarKwh = chargeInv.remainingSurplusSolarKwh;

      currentState = {
        syntheticSocKwh: chargeResult.finalState.syntheticSocKwh,
        gridChargedSocKwh: chargeResult.finalState.gridChargedSocKwh,
        renewableChargedSocKwh: chargeResult.finalState.renewableChargedSocKwh,
        generatorChargedSocKwh: chargeResult.finalState.generatorChargedSocKwh,
      };
    }

    // Stage 2: Remaining shared charge-power capacity
    const remainingChargePowerAcKwh = Math.max(
      0,
      maxChargeAcKwh - solarToBatteryAcKwh
    );

    // Stage 3: Grid charging & Precedence Arbitration
    const currentSocAfterRenewable =
      currentState.syntheticSocKwh +
      currentState.gridChargedSocKwh +
      currentState.renewableChargedSocKwh +
      currentState.generatorChargedSocKwh;

    const hasRoomForGridCharge =
      usableCapacityKwh - currentSocAfterRenewable > 1e-9;

    const gridChargeSelected =
      pol.allowGridChargeFromGrid && hasRoomForGridCharge;

    let requestedGridChargeAcKwh = 0;
    let gridToBatteryAcKwh = 0;
    let gridEnergyStoredKwh = 0;

    if (gridChargeSelected) {
      requestedGridChargeAcKwh = remainingChargePowerAcKwh;
      const gridResult = chargeBatteryFromGrid(
        requestedGridChargeAcKwh,
        intervalHours,
        profile,
        currentState
      );

      gridToBatteryAcKwh = gridResult.gridToBatteryAcKwh;
      gridEnergyStoredKwh = gridResult.gridEnergyStoredKwh;

      currentState = {
        syntheticSocKwh: gridResult.stateAfter.syntheticSocKwh,
        gridChargedSocKwh: gridResult.stateAfter.gridChargedSocKwh,
        renewableChargedSocKwh: gridResult.stateAfter.renewableChargedSocKwh,
        generatorChargedSocKwh: gridResult.stateAfter.generatorChargedSocKwh,
      };
    }

    // Stage 4: Battery discharge to residual home load
    let batteryDeliveredToLoadKwh = 0;
    let storedEnergyDrainedKwh = 0;
    let syntheticSocDrainedKwh = 0;
    let renewableSocDrainedKwh = 0;
    let generatorSocDrainedKwh = 0;
    let gridSocDrainedKwh = 0;
    let residualHomeLoadAfterBatteryKwh = residualHomeLoadKwh;

    const canDischarge =
      residualHomeLoadKwh > 1e-12 &&
      pol.allowBatteryDischargeToLoad &&
      !gridChargeSelected;

    if (canDischarge) {
      const dischargeResult = dischargeBatteryToHomeLoad(
        residualHomeLoadKwh,
        intervalHours,
        profile,
        currentState
      );

      batteryDeliveredToLoadKwh = dischargeResult.batteryDeliveredToLoadKwh;
      storedEnergyDrainedKwh = dischargeResult.storedEnergyDrainedKwh;
      syntheticSocDrainedKwh = dischargeResult.syntheticSocDrainedKwh;
      renewableSocDrainedKwh = dischargeResult.renewableSocDrainedKwh;
      generatorSocDrainedKwh = dischargeResult.generatorSocDrainedKwh;
      gridSocDrainedKwh = dischargeResult.gridSocDrainedKwh;
      residualHomeLoadAfterBatteryKwh = dischargeResult.unmetHomeLoadKwh;

      currentState = {
        syntheticSocKwh: dischargeResult.stateAfter.syntheticSocKwh,
        gridChargedSocKwh: dischargeResult.stateAfter.gridChargedSocKwh,
        renewableChargedSocKwh: dischargeResult.stateAfter.renewableChargedSocKwh,
        generatorChargedSocKwh: dischargeResult.stateAfter.generatorChargedSocKwh,
      };
    }

    const stateAfter: BatterySocProvenanceState = {
      syntheticSocKwh: currentState.syntheticSocKwh,
      gridChargedSocKwh: currentState.gridChargedSocKwh,
      renewableChargedSocKwh: currentState.renewableChargedSocKwh,
      generatorChargedSocKwh: currentState.generatorChargedSocKwh,
    };

    const batterySocAfterKwh =
      stateAfter.syntheticSocKwh +
      stateAfter.gridChargedSocKwh +
      stateAfter.renewableChargedSocKwh +
      stateAfter.generatorChargedSocKwh;

    totalSolarToBatteryAcKwh += solarToBatteryAcKwh;
    totalRenewableEnergyStoredKwh += renewableEnergyStoredKwh;
    totalGridToBatteryAcKwh += gridToBatteryAcKwh;
    totalGridEnergyStoredKwh += gridEnergyStoredKwh;
    totalBatteryDeliveredToLoadKwh += batteryDeliveredToLoadKwh;
    totalStoredEnergyDrainedKwh += storedEnergyDrainedKwh;
    totalResidualHomeLoadAfterBatteryKwh += residualHomeLoadAfterBatteryKwh;
    totalRemainingSurplusSolarKwh += remainingSurplusSolarKwh;

    resultIntervals[i] = {
      sourceIndex: inv.sourceIndex,
      sourceTimestamp: inv.sourceTimestamp,
      timestampUtc: inv.timestampUtc,
      tierId: pol.tierId,

      homeLoadKwh: inv.homeLoadKwh,
      solarGenerationKwh: inv.solarGenerationKwh,
      solarDirectToLoadKwh: inv.solarDirectToLoadKwh,

      residualHomeLoadBeforeBatteryKwh: residualHomeLoadKwh,
      surplusSolarBeforeBatteryKwh: surplusSolarKwh,

      gridChargeAllowed: pol.allowGridChargeFromGrid,
      dischargeAllowed: pol.allowBatteryDischargeToLoad,

      solarToBatteryAcKwh,
      renewableEnergyStoredKwh,

      requestedGridChargeAcKwh,
      gridToBatteryAcKwh,
      gridEnergyStoredKwh,

      batteryDeliveredToLoadKwh,
      storedEnergyDrainedKwh,

      syntheticSocDrainedKwh,
      renewableSocDrainedKwh,
      generatorSocDrainedKwh,
      gridSocDrainedKwh,

      residualHomeLoadAfterBatteryKwh,
      remainingSurplusSolarKwh,

      batterySocBeforeKwh,
      batterySocAfterKwh,

      stateBefore,
      stateAfter,
    };
  }

  return {
    intervals: resultIntervals,
    initialState: {
      syntheticSocKwh: initialState.syntheticSocKwh,
      gridChargedSocKwh: initialState.gridChargedSocKwh,
      renewableChargedSocKwh: initialState.renewableChargedSocKwh,
      generatorChargedSocKwh: initialState.generatorChargedSocKwh,
    },
    finalState: {
      syntheticSocKwh: currentState.syntheticSocKwh,
      gridChargedSocKwh: currentState.gridChargedSocKwh,
      renewableChargedSocKwh: currentState.renewableChargedSocKwh,
      generatorChargedSocKwh: currentState.generatorChargedSocKwh,
    },
    totalSolarToBatteryAcKwh,
    totalRenewableEnergyStoredKwh,
    totalGridToBatteryAcKwh,
    totalGridEnergyStoredKwh,
    totalBatteryDeliveredToLoadKwh,
    totalStoredEnergyDrainedKwh,
    totalResidualHomeLoadAfterBatteryKwh,
    totalRemainingSurplusSolarKwh,
  };
}
