/**
 * Sequential Solar/Battery Flow Kernel (Milestone G3D)
 *
 * Composes G3A (solar-to-load flow), G3B (surplus solar renewable battery charging),
 * and G3C (battery discharge to residual home load) into a pure, sequential interval engine.
 *
 * Chronological flow for each interval:
 *   solar -> home load
 *              |
 *        surplus? -> battery charge (automatic)
 *              OR
 *    residual load? -> optional battery discharge (directive-controlled)
 *
 * Battery state (SOC and provenance breakdown) flows sequentially and chronologically
 * from interval to interval.
 */

import {
  BatteryDischargeDirective,
  BatteryProfile,
  BatterySocProvenanceState,
  SequentialBatteryFlowInterval,
  SequentialBatteryFlowResult,
  SolarLoadFlowInterval,
} from '../types/energy';
import { routeSurplusSolarToBattery } from './solarBatteryCharging';
import { dischargeBatteryToHomeLoad } from './batteryDischarge';

/**
 * Routes solar and battery flow sequentially across intervals.
 *
 * Pure function: does not mutate its inputs or caller state.
 */
export function routeSequentialSolarBatteryFlow(
  intervals: SolarLoadFlowInterval[],
  directives: BatteryDischargeDirective[],
  intervalHours: number,
  profile: BatteryProfile,
  initialState: BatterySocProvenanceState
): SequentialBatteryFlowResult {
  // Validate intervals array
  if (!Array.isArray(intervals)) {
    throw new Error('intervals must be an array.');
  }

  // Validate directives array
  if (!Array.isArray(directives)) {
    throw new Error('directives must be an array.');
  }

  if (directives.length !== intervals.length) {
    throw new Error(
      `Directives length (${directives.length}) must match intervals length (${intervals.length}).`
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

  const usableCapacityKwh =
    profile.totalCapacityKwh * (profile.usableDodPercent / 100);
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
  let totalBatteryDeliveredToLoadKwh = 0;
  let totalStoredEnergyDrainedKwh = 0;
  let totalResidualHomeLoadAfterBatteryKwh = 0;
  let totalRemainingSurplusSolarKwh = 0;

  const resultIntervals: SequentialBatteryFlowInterval[] = new Array(
    intervals.length
  );

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (!inv || typeof inv !== 'object') {
      throw new Error(`Invalid interval at index ${i}: must be an object.`);
    }

    const directive = directives[i];
    if (!directive || typeof directive !== 'object') {
      throw new Error(`Invalid directive at index ${i}: must be an object.`);
    }

    // Directive alignment validation
    if (directive.sourceIndex !== inv.sourceIndex) {
      throw new Error(
        `Directive sourceIndex mismatch at index ${i}: expected ${inv.sourceIndex}, received ${directive.sourceIndex}.`
      );
    }

    if (directive.timestampUtc !== inv.timestampUtc) {
      throw new Error(
        `Directive timestampUtc mismatch at index ${i}: expected "${inv.timestampUtc}", received "${directive.timestampUtc}".`
      );
    }

    if (typeof directive.allowBatteryDischargeToLoad !== 'boolean') {
      throw new Error(
        `Invalid allowBatteryDischargeToLoad at index ${i}: must be a boolean. Received: ${directive.allowBatteryDischargeToLoad}`
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

    let solarToBatteryAcKwh = 0;
    let renewableEnergyStoredKwh = 0;
    let batteryDeliveredToLoadKwh = 0;
    let storedEnergyDrainedKwh = 0;
    let syntheticSocDrainedKwh = 0;
    let renewableSocDrainedKwh = 0;
    let generatorSocDrainedKwh = 0;
    let gridSocDrainedKwh = 0;
    let residualHomeLoadAfterBatteryKwh = 0;
    let remainingSurplusSolarKwh = 0;
    let stateAfter: BatterySocProvenanceState;
    let batterySocAfterKwh: number;

    const hasSurplusSolar = surplusSolarKwh > 1e-12;
    const hasResidualLoad = residualHomeLoadKwh > 1e-12;

    if (hasSurplusSolar) {
      // Case A — surplus solar exists
      // Automatic renewable charging via G3B single-element interval call
      const chargeResult = routeSurplusSolarToBattery(
        [inv],
        intervalHours,
        profile,
        stateBefore
      );
      const chargeInv = chargeResult.intervals[0];

      solarToBatteryAcKwh = chargeInv.solarToBatteryAcKwh;
      renewableEnergyStoredKwh = chargeInv.renewableEnergyStoredKwh;
      remainingSurplusSolarKwh = chargeInv.remainingSurplusSolarKwh;

      batteryDeliveredToLoadKwh = 0;
      storedEnergyDrainedKwh = 0;
      syntheticSocDrainedKwh = 0;
      renewableSocDrainedKwh = 0;
      generatorSocDrainedKwh = 0;
      gridSocDrainedKwh = 0;

      residualHomeLoadAfterBatteryKwh = residualHomeLoadKwh;

      stateAfter = {
        syntheticSocKwh: chargeResult.finalState.syntheticSocKwh,
        gridChargedSocKwh: chargeResult.finalState.gridChargedSocKwh,
        renewableChargedSocKwh: chargeResult.finalState.renewableChargedSocKwh,
        generatorChargedSocKwh: chargeResult.finalState.generatorChargedSocKwh,
      };
      batterySocAfterKwh =
        stateAfter.syntheticSocKwh +
        stateAfter.gridChargedSocKwh +
        stateAfter.renewableChargedSocKwh +
        stateAfter.generatorChargedSocKwh;
    } else if (hasResidualLoad && directive.allowBatteryDischargeToLoad) {
      // Case B — residual home load exists and discharge is allowed
      const dischargeResult = dischargeBatteryToHomeLoad(
        residualHomeLoadKwh,
        intervalHours,
        profile,
        stateBefore
      );

      solarToBatteryAcKwh = 0;
      renewableEnergyStoredKwh = 0;
      remainingSurplusSolarKwh = 0;

      batteryDeliveredToLoadKwh = dischargeResult.batteryDeliveredToLoadKwh;
      storedEnergyDrainedKwh = dischargeResult.storedEnergyDrainedKwh;
      syntheticSocDrainedKwh = dischargeResult.syntheticSocDrainedKwh;
      renewableSocDrainedKwh = dischargeResult.renewableSocDrainedKwh;
      generatorSocDrainedKwh = dischargeResult.generatorSocDrainedKwh;
      gridSocDrainedKwh = dischargeResult.gridSocDrainedKwh;

      residualHomeLoadAfterBatteryKwh = dischargeResult.unmetHomeLoadKwh;

      stateAfter = {
        syntheticSocKwh: dischargeResult.stateAfter.syntheticSocKwh,
        gridChargedSocKwh: dischargeResult.stateAfter.gridChargedSocKwh,
        renewableChargedSocKwh: dischargeResult.stateAfter.renewableChargedSocKwh,
        generatorChargedSocKwh: dischargeResult.stateAfter.generatorChargedSocKwh,
      };
      batterySocAfterKwh = dischargeResult.batterySocAfterKwh;
    } else if (hasResidualLoad && !directive.allowBatteryDischargeToLoad) {
      // Case C — residual home load exists but discharge is forbidden
      solarToBatteryAcKwh = 0;
      renewableEnergyStoredKwh = 0;
      remainingSurplusSolarKwh = 0;

      batteryDeliveredToLoadKwh = 0;
      storedEnergyDrainedKwh = 0;
      syntheticSocDrainedKwh = 0;
      renewableSocDrainedKwh = 0;
      generatorSocDrainedKwh = 0;
      gridSocDrainedKwh = 0;

      residualHomeLoadAfterBatteryKwh = residualHomeLoadKwh;

      stateAfter = { ...stateBefore };
      batterySocAfterKwh = batterySocBeforeKwh;
    } else {
      // Case D — idle interval (neither residual load nor surplus solar)
      solarToBatteryAcKwh = 0;
      renewableEnergyStoredKwh = 0;
      remainingSurplusSolarKwh = 0;

      batteryDeliveredToLoadKwh = 0;
      storedEnergyDrainedKwh = 0;
      syntheticSocDrainedKwh = 0;
      renewableSocDrainedKwh = 0;
      generatorSocDrainedKwh = 0;
      gridSocDrainedKwh = 0;

      residualHomeLoadAfterBatteryKwh = residualHomeLoadKwh;

      stateAfter = { ...stateBefore };
      batterySocAfterKwh = batterySocBeforeKwh;
    }

    currentState = stateAfter;

    totalSolarToBatteryAcKwh += solarToBatteryAcKwh;
    totalRenewableEnergyStoredKwh += renewableEnergyStoredKwh;
    totalBatteryDeliveredToLoadKwh += batteryDeliveredToLoadKwh;
    totalStoredEnergyDrainedKwh += storedEnergyDrainedKwh;
    totalResidualHomeLoadAfterBatteryKwh += residualHomeLoadAfterBatteryKwh;
    totalRemainingSurplusSolarKwh += remainingSurplusSolarKwh;

    resultIntervals[i] = {
      sourceIndex: inv.sourceIndex,
      sourceTimestamp: inv.sourceTimestamp,
      timestampUtc: inv.timestampUtc,

      homeLoadKwh: inv.homeLoadKwh,
      solarGenerationKwh: inv.solarGenerationKwh,
      solarDirectToLoadKwh: inv.solarDirectToLoadKwh,

      residualHomeLoadBeforeBatteryKwh: residualHomeLoadKwh,
      surplusSolarBeforeBatteryKwh: surplusSolarKwh,

      dischargeAllowed: directive.allowBatteryDischargeToLoad,

      solarToBatteryAcKwh,
      renewableEnergyStoredKwh,

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
    totalBatteryDeliveredToLoadKwh,
    totalStoredEnergyDrainedKwh,
    totalResidualHomeLoadAfterBatteryKwh,
    totalRemainingSurplusSolarKwh,
  };
}
