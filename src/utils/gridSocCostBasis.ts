/**
 * Grid-Charged SOC Acquisition-Cost Basis Engine (Milestones G3K & G3N)
 *
 * Tracks the weighted-average acquisition cost of ONLY grid-charged energy
 * currently stored in the battery:
 *   - advanceGridSocCostBasis: Reusable pure single-interval state transition primitive (G3N).
 *   - trackGridSocCostBasis: Array-level pipeline accounting and reconciliation engine (G3K).
 *   - Uses G3J's resolved tariff accounting (AC purchase cost of grid imports).
 *   - Accurately tracks weighted-average cost basis on charge additions.
 *   - Removes proportional acquisition cost on G3H grid-SOC provenance depletion.
 *   - Preserves average $/stored-kWh across partial discharges.
 *   - Normalizes to exact zero upon full depletion.
 *   - Supports finite negative electricity prices without artificial clamping.
 *
 * Pure functions: do not mutate inputs. Do not modify physical dispatch,
 * G3J tariff costs, or long-term financial results.
 */

import {
  GridSocCostBasisInterval,
  GridSocCostBasisResult,
  GridSocCostBasisState,
  GridSocCostBasisTransitionResult,
  IntegratedBatteryFlowInterval,
  TariffCostInterval,
} from '../types/energy';

const EPSILON = 1e-6;
const ZERO_THRESHOLD = 1e-9;

/**
 * Pure single-interval state transition primitive for grid-charged SOC cost basis.
 *
 * Adds newly charged grid energy and acquisition cost, computes weighted-average
 * unit cost, subtracts drained grid SOC with proportional cost removal, and normalizes
 * to exact zero upon full depletion.
 *
 * @param currentState Current grid SOC energy and acquisition cost state before transition
 * @param gridEnergyStoredKwh DC energy stored into battery from grid in this interval (kWh)
 * @param gridChargeAcquisitionCostUsd AC cost of electricity purchased from grid for charging ($)
 * @param gridSocDrainedKwh Grid SOC drained from battery in this interval (kWh)
 * @returns Transition result containing before-drain state, drained costs, and stateAfter
 */
export function advanceGridSocCostBasis(
  currentState: GridSocCostBasisState,
  gridEnergyStoredKwh: number,
  gridChargeAcquisitionCostUsd: number,
  gridSocDrainedKwh: number
): GridSocCostBasisTransitionResult {
  // 1. Validate currentState
  if (!currentState || typeof currentState !== 'object') {
    throw new Error('currentState must be a valid object.');
  }

  if (
    typeof currentState.gridStoredEnergyKwh !== 'number' ||
    !Number.isFinite(currentState.gridStoredEnergyKwh) ||
    currentState.gridStoredEnergyKwh < 0
  ) {
    throw new Error(
      `currentState.gridStoredEnergyKwh must be a finite non-negative number. Received: ${currentState?.gridStoredEnergyKwh}`
    );
  }

  if (
    typeof currentState.totalAcquisitionCostUsd !== 'number' ||
    !Number.isFinite(currentState.totalAcquisitionCostUsd)
  ) {
    throw new Error(
      `currentState.totalAcquisitionCostUsd must be a finite number. Received: ${currentState?.totalAcquisitionCostUsd}`
    );
  }

  if (currentState.gridStoredEnergyKwh <= ZERO_THRESHOLD) {
    if (Math.abs(currentState.totalAcquisitionCostUsd) > ZERO_THRESHOLD) {
      throw new Error(
        `Inconsistent currentState: zero gridStoredEnergyKwh (${currentState.gridStoredEnergyKwh}) must have zero acquisition cost basis, received ${currentState.totalAcquisitionCostUsd}.`
      );
    }
  }

  // 2. Validate input parameters
  if (
    typeof gridEnergyStoredKwh !== 'number' ||
    !Number.isFinite(gridEnergyStoredKwh) ||
    gridEnergyStoredKwh < 0
  ) {
    throw new Error(
      `gridEnergyStoredKwh must be a finite non-negative number. Received: ${gridEnergyStoredKwh}`
    );
  }

  if (
    typeof gridChargeAcquisitionCostUsd !== 'number' ||
    !Number.isFinite(gridChargeAcquisitionCostUsd)
  ) {
    throw new Error(
      `gridChargeAcquisitionCostUsd must be a finite number. Received: ${gridChargeAcquisitionCostUsd}`
    );
  }

  if (
    typeof gridSocDrainedKwh !== 'number' ||
    !Number.isFinite(gridSocDrainedKwh) ||
    gridSocDrainedKwh < 0
  ) {
    throw new Error(
      `gridSocDrainedKwh must be a finite non-negative number. Received: ${gridSocDrainedKwh}`
    );
  }

  // Effective initial state
  const effectiveStoredEnergyBefore =
    currentState.gridStoredEnergyKwh <= ZERO_THRESHOLD
      ? 0
      : currentState.gridStoredEnergyKwh;
  const effectiveCostBefore =
    currentState.gridStoredEnergyKwh <= ZERO_THRESHOLD
      ? 0
      : currentState.totalAcquisitionCostUsd;

  // 3. Add newly charged grid energy before drain
  const gridStoredEnergyBeforeDrainKwh =
    effectiveStoredEnergyBefore + gridEnergyStoredKwh;
  const acquisitionCostBeforeDrainUsd =
    effectiveCostBefore + gridChargeAcquisitionCostUsd;

  const averageAcquisitionCostPerStoredKwhBeforeDrain =
    gridStoredEnergyBeforeDrainKwh > ZERO_THRESHOLD
      ? acquisitionCostBeforeDrainUsd / gridStoredEnergyBeforeDrainKwh
      : 0;

  // 4. Reject drain exceeding available energy beyond tolerance
  if (gridSocDrainedKwh > gridStoredEnergyBeforeDrainKwh + EPSILON) {
    throw new Error(
      `Grid SOC drain (${gridSocDrainedKwh}) exceeds available grid stored energy (${gridStoredEnergyBeforeDrainKwh}).`
    );
  }

  const effectiveDrain = Math.min(
    gridSocDrainedKwh,
    gridStoredEnergyBeforeDrainKwh
  );
  const gridSocCostRemovedUsd =
    effectiveDrain * averageAcquisitionCostPerStoredKwhBeforeDrain;

  let gridStoredEnergyAfterKwh =
    gridStoredEnergyBeforeDrainKwh - effectiveDrain;
  let acquisitionCostAfterUsd =
    acquisitionCostBeforeDrainUsd - gridSocCostRemovedUsd;

  // Normalize exact zero if remaining energy is effectively zero
  if (gridStoredEnergyAfterKwh <= ZERO_THRESHOLD) {
    gridStoredEnergyAfterKwh = 0;
    acquisitionCostAfterUsd = 0;
  }

  const averageAcquisitionCostPerStoredKwhAfter =
    gridStoredEnergyAfterKwh > ZERO_THRESHOLD
      ? acquisitionCostAfterUsd / gridStoredEnergyAfterKwh
      : 0;

  return {
    stateBefore: {
      gridStoredEnergyKwh: effectiveStoredEnergyBefore,
      totalAcquisitionCostUsd: effectiveCostBefore,
    },
    gridEnergyStoredKwh,
    gridChargeAcquisitionCostUsd,
    gridStoredEnergyBeforeDrainKwh,
    acquisitionCostBeforeDrainUsd,
    averageAcquisitionCostPerStoredKwhBeforeDrain,
    gridSocDrainedKwh,
    gridSocCostRemovedUsd,
    stateAfter: {
      gridStoredEnergyKwh: gridStoredEnergyAfterKwh,
      totalAcquisitionCostUsd: acquisitionCostAfterUsd,
    },
    averageAcquisitionCostPerStoredKwhAfter,
  };
}

/**
 * Tracks the weighted-average acquisition cost basis of grid-charged battery energy across an interval series.
 * Delegates interval inventory math to the advanceGridSocCostBasis primitive.
 *
 * @param integratedIntervals Integrated battery flow intervals with provenance state (from G3H)
 * @param tariffIntervals Tariff-accounted cost intervals (from G3J)
 * @param initialState Initial grid-SOC cost basis state
 * @returns Result containing interval cost-basis ledger and summary totals
 */
export function trackGridSocCostBasis(
  integratedIntervals: IntegratedBatteryFlowInterval[],
  tariffIntervals: TariffCostInterval[],
  initialState: GridSocCostBasisState
): GridSocCostBasisResult {
  // 1. Array validation
  if (!Array.isArray(integratedIntervals) || integratedIntervals.length === 0) {
    throw new Error('integratedIntervals must be a non-empty array.');
  }
  if (!Array.isArray(tariffIntervals) || tariffIntervals.length === 0) {
    throw new Error('tariffIntervals must be a non-empty array.');
  }

  const length = integratedIntervals.length;
  if (tariffIntervals.length !== length) {
    throw new Error(
      `Array length mismatch: integratedIntervals has ${length}, tariffIntervals has ${tariffIntervals.length}.`
    );
  }

  // 2. Initial state validation
  if (!initialState || typeof initialState !== 'object') {
    throw new Error('initialState must be a valid object.');
  }
  if (
    typeof initialState.gridStoredEnergyKwh !== 'number' ||
    !Number.isFinite(initialState.gridStoredEnergyKwh)
  ) {
    throw new Error(
      `initialState.gridStoredEnergyKwh must be a finite number. Received: ${initialState.gridStoredEnergyKwh}`
    );
  }
  if (initialState.gridStoredEnergyKwh < 0) {
    throw new Error(
      `initialState.gridStoredEnergyKwh must be non-negative. Received: ${initialState.gridStoredEnergyKwh}`
    );
  }
  if (
    typeof initialState.totalAcquisitionCostUsd !== 'number' ||
    !Number.isFinite(initialState.totalAcquisitionCostUsd)
  ) {
    throw new Error(
      `initialState.totalAcquisitionCostUsd must be a finite number. Received: ${initialState.totalAcquisitionCostUsd}`
    );
  }

  // Zero-energy initial state must have zero acquisition cost
  if (Math.abs(initialState.gridStoredEnergyKwh) < ZERO_THRESHOLD) {
    if (Math.abs(initialState.totalAcquisitionCostUsd) >= ZERO_THRESHOLD) {
      throw new Error(
        `Initial state inconsistency: zero initial gridStoredEnergyKwh (${initialState.gridStoredEnergyKwh}) must have zero acquisition cost basis, received ${initialState.totalAcquisitionCostUsd}.`
      );
    }
  }

  // Verify initial grid energy matches first interval stateBefore.gridChargedSocKwh
  const firstInterval = integratedIntervals[0];
  if (!firstInterval || !firstInterval.stateBefore) {
    throw new Error('Invalid first interval: missing stateBefore.');
  }
  if (
    Math.abs(
      initialState.gridStoredEnergyKwh -
        firstInterval.stateBefore.gridChargedSocKwh
    ) > EPSILON
  ) {
    throw new Error(
      `Initial gridStoredEnergyKwh (${initialState.gridStoredEnergyKwh}) does not match first interval stateBefore.gridChargedSocKwh (${firstInterval.stateBefore.gridChargedSocKwh}).`
    );
  }

  // Ledger tracking state
  let currentGridEnergy =
    Math.abs(initialState.gridStoredEnergyKwh) < ZERO_THRESHOLD
      ? 0
      : initialState.gridStoredEnergyKwh;
  let currentAcquisitionCost =
    Math.abs(initialState.gridStoredEnergyKwh) < ZERO_THRESHOLD
      ? 0
      : initialState.totalAcquisitionCostUsd;

  let totalGridChargeAcquisitionCostUsd = 0;
  let totalGridSocCostRemovedUsd = 0;

  const resultIntervals: GridSocCostBasisInterval[] = new Array(length);

  for (let i = 0; i < length; i++) {
    const inf = integratedIntervals[i];
    const tf = tariffIntervals[i];

    if (!inf || typeof inf !== 'object') {
      throw new Error(
        `Invalid integratedInterval at index ${i}: must be an object.`
      );
    }
    if (!tf || typeof tf !== 'object') {
      throw new Error(`Invalid tariffInterval at index ${i}: must be an object.`);
    }

    // Alignment checks
    if (inf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: integratedIntervals sourceIndex is ${inf.sourceIndex}, expected ${i}.`
      );
    }
    if (tf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: tariffIntervals sourceIndex is ${tf.sourceIndex}, expected ${i}.`
      );
    }
    if (inf.sourceTimestamp !== tf.sourceTimestamp) {
      throw new Error(
        `Source timestamp mismatch at index ${i}: integratedIntervals ("${inf.sourceTimestamp}") !== tariffIntervals ("${tf.sourceTimestamp}").`
      );
    }
    if (inf.timestampUtc !== tf.timestampUtc) {
      throw new Error(
        `Timestamp UTC mismatch at index ${i}: integratedIntervals ("${inf.timestampUtc}") !== tariffIntervals ("${tf.timestampUtc}").`
      );
    }
    if (inf.tierId !== tf.tierId) {
      throw new Error(
        `Tier ID mismatch at index ${i}: integratedIntervals ("${inf.tierId}") !== tariffIntervals ("${tf.tierId}").`
      );
    }

    // Verify grid import energy alignment between tariff and integrated dispatch
    if (
      Math.abs(tf.gridImportForBatteryKwh - inf.gridToBatteryAcKwh) > EPSILON
    ) {
      throw new Error(
        `Tariff battery-import energy mismatch at index ${i}: tariff gridImportForBatteryKwh (${tf.gridImportForBatteryKwh}) !== integrated gridToBatteryAcKwh (${inf.gridToBatteryAcKwh}).`
      );
    }

    // Ledger alignment with G3H stateBefore
    if (
      Math.abs(currentGridEnergy - inf.stateBefore.gridChargedSocKwh) > EPSILON
    ) {
      throw new Error(
        `Physical state-before mismatch at index ${i}: ledger gridStoredEnergyKwh (${currentGridEnergy}) !== integrated stateBefore.gridChargedSocKwh (${inf.stateBefore.gridChargedSocKwh}).`
      );
    }

    const gridEnergyStoredKwh = inf.gridEnergyStoredKwh;
    if (
      typeof gridEnergyStoredKwh !== 'number' ||
      !Number.isFinite(gridEnergyStoredKwh) ||
      gridEnergyStoredKwh < -EPSILON
    ) {
      throw new Error(
        `Invalid gridEnergyStoredKwh at index ${i}: must be a finite non-negative number. Received: ${gridEnergyStoredKwh}`
      );
    }

    const gridChargeAcquisitionCostUsd = tf.gridImportForBatteryCost;
    if (
      typeof gridChargeAcquisitionCostUsd !== 'number' ||
      !Number.isFinite(gridChargeAcquisitionCostUsd)
    ) {
      throw new Error(
        `Invalid gridImportForBatteryCost at index ${i}: must be a finite number. Received: ${gridChargeAcquisitionCostUsd}`
      );
    }

    const gridSocDrainedKwh = inf.gridSocDrainedKwh;
    if (
      typeof gridSocDrainedKwh !== 'number' ||
      !Number.isFinite(gridSocDrainedKwh) ||
      gridSocDrainedKwh < -EPSILON
    ) {
      throw new Error(
        `Invalid gridSocDrainedKwh at index ${i}: must be a finite non-negative number. Received: ${gridSocDrainedKwh}`
      );
    }

    // Authoritative transition calculation via G3N single-interval primitive
    const transition = advanceGridSocCostBasis(
      {
        gridStoredEnergyKwh: currentGridEnergy,
        totalAcquisitionCostUsd: currentAcquisitionCost,
      },
      Math.max(0, gridEnergyStoredKwh),
      gridChargeAcquisitionCostUsd,
      Math.max(0, gridSocDrainedKwh)
    );

    // Ledger alignment with G3H stateAfter
    if (
      Math.abs(
        transition.stateAfter.gridStoredEnergyKwh -
          inf.stateAfter.gridChargedSocKwh
      ) > EPSILON
    ) {
      throw new Error(
        `Physical state-after mismatch at index ${i}: ledger gridStoredEnergyAfterKwh (${transition.stateAfter.gridStoredEnergyKwh}) !== integrated stateAfter.gridChargedSocKwh (${inf.stateAfter.gridChargedSocKwh}).`
      );
    }

    // Physical reconciliation check
    const expectedAfter =
      transition.stateBefore.gridStoredEnergyKwh +
      transition.gridEnergyStoredKwh -
      transition.gridSocDrainedKwh;
    if (
      Math.abs(expectedAfter - transition.stateAfter.gridStoredEnergyKwh) >
        EPSILON &&
      transition.stateAfter.gridStoredEnergyKwh !== 0
    ) {
      throw new Error(
        `Physical reconciliation failed at index ${i}: before (${transition.stateBefore.gridStoredEnergyKwh}) + stored (${transition.gridEnergyStoredKwh}) - drained (${transition.gridSocDrainedKwh}) !== after (${transition.stateAfter.gridStoredEnergyKwh}).`
      );
    }

    // Advance current ledger state
    currentGridEnergy = transition.stateAfter.gridStoredEnergyKwh;
    currentAcquisitionCost = transition.stateAfter.totalAcquisitionCostUsd;

    totalGridChargeAcquisitionCostUsd += transition.gridChargeAcquisitionCostUsd;
    totalGridSocCostRemovedUsd += transition.gridSocCostRemovedUsd;

    resultIntervals[i] = {
      sourceIndex: i,
      sourceTimestamp: inf.sourceTimestamp,
      timestampUtc: inf.timestampUtc,
      tierId: inf.tierId,

      gridStoredEnergyBeforeKwh: transition.stateBefore.gridStoredEnergyKwh,
      acquisitionCostBeforeUsd: transition.stateBefore.totalAcquisitionCostUsd,

      gridEnergyStoredKwh: transition.gridEnergyStoredKwh,
      gridChargeAcquisitionCostUsd: transition.gridChargeAcquisitionCostUsd,

      gridStoredEnergyBeforeDrainKwh: transition.gridStoredEnergyBeforeDrainKwh,
      acquisitionCostBeforeDrainUsd: transition.acquisitionCostBeforeDrainUsd,
      averageAcquisitionCostPerStoredKwhBeforeDrain:
        transition.averageAcquisitionCostPerStoredKwhBeforeDrain,

      gridSocDrainedKwh: transition.gridSocDrainedKwh,
      gridSocCostRemovedUsd: transition.gridSocCostRemovedUsd,

      gridStoredEnergyAfterKwh: transition.stateAfter.gridStoredEnergyKwh,
      acquisitionCostAfterUsd: transition.stateAfter.totalAcquisitionCostUsd,
      averageAcquisitionCostPerStoredKwhAfter:
        transition.averageAcquisitionCostPerStoredKwhAfter,
    };
  }

  return {
    intervals: resultIntervals,
    initialState: {
      gridStoredEnergyKwh: initialState.gridStoredEnergyKwh,
      totalAcquisitionCostUsd: initialState.totalAcquisitionCostUsd,
    },
    finalState: {
      gridStoredEnergyKwh: currentGridEnergy,
      totalAcquisitionCostUsd: currentAcquisitionCost,
    },
    totalGridChargeAcquisitionCostUsd,
    totalGridSocCostRemovedUsd,
  };
}
