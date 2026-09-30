/**
 * Grid Boundary Flow Accounting Engine (Milestone G3I)
 *
 * Models physical grid-boundary energy exchange around G3H integrated battery flow output:
 *   1. Grid import required for remaining household load
 *   2. Grid import required for battery charging (AC)
 *   3. Total grid import
 *   4. Remaining surplus solar exported to grid OR curtailed
 *
 * Does not calculate tariffs, electricity costs, savings, battery export, or finances.
 */

import {
  ExportAwareBatteryFlowInterval,
  GridFlowInterval,
  GridFlowResult,
  IntegratedBatteryFlowInterval,
} from '../types/energy';

interface NormalizedGridFlowItem {
  sourceIndex: number;
  sourceTimestamp: string;
  timestampUtc: string;
  tierId: string;
  residualHomeLoadAfterBatteryKwh: number;
  gridToBatteryAcKwh: number;
  remainingSurplusSolarKwh: number;
  batteryExportKwh: number;
}

/**
 * Shared authoritative internal grid boundary flow accounting.
 */
function computeNormalizedGridFlows(
  items: NormalizedGridFlowItem[],
  allowSolarExport: boolean
): GridFlowResult {
  let totalGridImportForHomeKwh = 0;
  let totalGridImportForBatteryKwh = 0;
  let totalGridImportKwh = 0;
  let totalSolarExportKwh = 0;
  let totalCurtailedSolarKwh = 0;
  let totalBatteryExportKwh = 0;
  let totalGridExportKwh = 0;

  const resultIntervals: GridFlowInterval[] = new Array(items.length);

  for (let i = 0; i < items.length; i++) {
    const item = items[i];

    const residualHomeLoadKwh = item.residualHomeLoadAfterBatteryKwh;
    const gridBatteryChargeKwh = item.gridToBatteryAcKwh;
    const remainingSurplusSolarKwh = item.remainingSurplusSolarKwh;

    const gridImportForHomeKwh = residualHomeLoadKwh;
    const gridImportForBatteryKwh = gridBatteryChargeKwh;
    const intervalTotalGridImportKwh =
      gridImportForHomeKwh + gridImportForBatteryKwh;

    let solarExportKwh = 0;
    let curtailedSolarKwh = 0;

    if (allowSolarExport) {
      solarExportKwh = remainingSurplusSolarKwh;
      curtailedSolarKwh = 0;
    } else {
      solarExportKwh = 0;
      curtailedSolarKwh = remainingSurplusSolarKwh;
    }

    const batteryExportKwh = item.batteryExportKwh;
    const totalGridExportKwhInterval = solarExportKwh + batteryExportKwh;

    totalGridImportForHomeKwh += gridImportForHomeKwh;
    totalGridImportForBatteryKwh += gridImportForBatteryKwh;
    totalGridImportKwh += intervalTotalGridImportKwh;
    totalSolarExportKwh += solarExportKwh;
    totalCurtailedSolarKwh += curtailedSolarKwh;
    totalBatteryExportKwh += batteryExportKwh;
    totalGridExportKwh += totalGridExportKwhInterval;

    resultIntervals[i] = {
      sourceIndex: item.sourceIndex,
      sourceTimestamp: item.sourceTimestamp,
      timestampUtc: item.timestampUtc,
      tierId: item.tierId,

      residualHomeLoadKwh,
      gridBatteryChargeKwh,
      remainingSurplusSolarKwh,

      gridImportForHomeKwh,
      gridImportForBatteryKwh,
      totalGridImportKwh: intervalTotalGridImportKwh,

      solarExportKwh,
      curtailedSolarKwh,
      batteryExportKwh,
      totalGridExportKwh: totalGridExportKwhInterval,
    };
  }

  return {
    intervals: resultIntervals,
    totalGridImportForHomeKwh,
    totalGridImportForBatteryKwh,
    totalGridImportKwh,
    totalSolarExportKwh,
    totalCurtailedSolarKwh,
    totalBatteryExportKwh,
    totalGridExportKwh,
  };
}

/**
 * Calculates physical grid import and export/curtailment flows for each interval (Milestone G3I).
 * Backwards-compatible entry point setting batteryExportKwh = 0 and totalBatteryExportKwh = 0.
 *
 * Pure function: does not mutate inputs.
 */
export function calculateGridFlows(
  intervals: IntegratedBatteryFlowInterval[],
  allowSolarExport: boolean
): GridFlowResult {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    throw new Error('intervals must be a non-empty array.');
  }

  if (typeof allowSolarExport !== 'boolean') {
    throw new Error('allowSolarExport must be a boolean.');
  }

  const items: NormalizedGridFlowItem[] = new Array(intervals.length);

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (!inv || typeof inv !== 'object') {
      throw new Error(`Invalid interval at index ${i}: must be an object.`);
    }

    if (!Number.isInteger(inv.sourceIndex) || inv.sourceIndex !== i) {
      throw new Error(
        `Invalid sourceIndex at index ${i}: expected integer ${i}, received ${inv.sourceIndex}.`
      );
    }

    if (
      typeof inv.sourceTimestamp !== 'string' ||
      inv.sourceTimestamp.trim() === ''
    ) {
      throw new Error(
        `Invalid sourceTimestamp at index ${i}: must be a non-empty string.`
      );
    }

    if (
      typeof inv.timestampUtc !== 'string' ||
      inv.timestampUtc.trim() === ''
    ) {
      throw new Error(
        `Invalid timestampUtc at index ${i}: must be a non-empty string.`
      );
    }

    if (typeof inv.tierId !== 'string' || inv.tierId.trim() === '') {
      throw new Error(
        `Invalid tierId at index ${i}: must be a non-empty string.`
      );
    }

    if (
      typeof inv.residualHomeLoadAfterBatteryKwh !== 'number' ||
      !Number.isFinite(inv.residualHomeLoadAfterBatteryKwh) ||
      inv.residualHomeLoadAfterBatteryKwh < 0
    ) {
      throw new Error(
        `Invalid residualHomeLoadAfterBatteryKwh at index ${i}: must be a finite non-negative number. Received: ${inv.residualHomeLoadAfterBatteryKwh}`
      );
    }

    if (
      typeof inv.gridToBatteryAcKwh !== 'number' ||
      !Number.isFinite(inv.gridToBatteryAcKwh) ||
      inv.gridToBatteryAcKwh < 0
    ) {
      throw new Error(
        `Invalid gridToBatteryAcKwh at index ${i}: must be a finite non-negative number. Received: ${inv.gridToBatteryAcKwh}`
      );
    }

    if (
      typeof inv.remainingSurplusSolarKwh !== 'number' ||
      !Number.isFinite(inv.remainingSurplusSolarKwh) ||
      inv.remainingSurplusSolarKwh < 0
    ) {
      throw new Error(
        `Invalid remainingSurplusSolarKwh at index ${i}: must be a finite non-negative number. Received: ${inv.remainingSurplusSolarKwh}`
      );
    }

    items[i] = {
      sourceIndex: inv.sourceIndex,
      sourceTimestamp: inv.sourceTimestamp,
      timestampUtc: inv.timestampUtc,
      tierId: inv.tierId,
      residualHomeLoadAfterBatteryKwh: inv.residualHomeLoadAfterBatteryKwh,
      gridToBatteryAcKwh: inv.gridToBatteryAcKwh,
      remainingSurplusSolarKwh: inv.remainingSurplusSolarKwh,
      batteryExportKwh: 0,
    };
  }

  return computeNormalizedGridFlows(items, allowSolarExport);
}

/**
 * Calculates physical grid import and export/curtailment flows including G3O grid-SOC battery export.
 * Battery export quantity is taken strictly from interval.exportResult.batteryExportAcKwh without recalculation.
 *
 * Pure function: does not mutate inputs.
 */
export function calculateExportAwareGridFlows(
  intervals: ExportAwareBatteryFlowInterval[],
  allowSolarExport: boolean
): GridFlowResult {
  if (!Array.isArray(intervals) || intervals.length === 0) {
    throw new Error('intervals must be a non-empty array.');
  }

  if (typeof allowSolarExport !== 'boolean') {
    throw new Error('allowSolarExport must be a boolean.');
  }

  const items: NormalizedGridFlowItem[] = new Array(intervals.length);

  for (let i = 0; i < intervals.length; i++) {
    const inv = intervals[i];
    if (!inv || typeof inv !== 'object') {
      throw new Error(`Invalid interval at index ${i}: must be an object.`);
    }

    if (!Number.isInteger(inv.sourceIndex) || inv.sourceIndex !== i) {
      throw new Error(
        `Invalid sourceIndex at index ${i}: expected integer ${i}, received ${inv.sourceIndex}.`
      );
    }

    if (
      typeof inv.sourceTimestamp !== 'string' ||
      inv.sourceTimestamp.trim() === ''
    ) {
      throw new Error(
        `Invalid sourceTimestamp at index ${i}: must be a non-empty string.`
      );
    }

    if (
      typeof inv.timestampUtc !== 'string' ||
      inv.timestampUtc.trim() === ''
    ) {
      throw new Error(
        `Invalid timestampUtc at index ${i}: must be a non-empty string.`
      );
    }

    if (typeof inv.tierId !== 'string' || inv.tierId.trim() === '') {
      throw new Error(
        `Invalid tierId at index ${i}: must be a non-empty string.`
      );
    }

    const flow = inv.preExportFlow;
    if (!flow || typeof flow !== 'object') {
      throw new Error(
        `Invalid preExportFlow at index ${i}: must be an object.`
      );
    }

    if (flow.sourceIndex !== inv.sourceIndex) {
      throw new Error(
        `Alignment error at index ${i}: preExportFlow sourceIndex (${flow.sourceIndex}) !== interval sourceIndex (${inv.sourceIndex}).`
      );
    }

    if (flow.sourceTimestamp !== inv.sourceTimestamp) {
      throw new Error(
        `Alignment error at index ${i}: preExportFlow sourceTimestamp ("${flow.sourceTimestamp}") !== interval sourceTimestamp ("${inv.sourceTimestamp}").`
      );
    }

    if (flow.timestampUtc !== inv.timestampUtc) {
      throw new Error(
        `Alignment error at index ${i}: preExportFlow timestampUtc ("${flow.timestampUtc}") !== interval timestampUtc ("${inv.timestampUtc}").`
      );
    }

    if (flow.tierId !== inv.tierId) {
      throw new Error(
        `Alignment error at index ${i}: preExportFlow tierId ("${flow.tierId}") !== interval tierId ("${inv.tierId}").`
      );
    }

    if (
      typeof flow.residualHomeLoadAfterBatteryKwh !== 'number' ||
      !Number.isFinite(flow.residualHomeLoadAfterBatteryKwh) ||
      flow.residualHomeLoadAfterBatteryKwh < 0
    ) {
      throw new Error(
        `Invalid residualHomeLoadAfterBatteryKwh at index ${i}: must be a finite non-negative number. Received: ${flow.residualHomeLoadAfterBatteryKwh}`
      );
    }

    if (
      typeof flow.gridToBatteryAcKwh !== 'number' ||
      !Number.isFinite(flow.gridToBatteryAcKwh) ||
      flow.gridToBatteryAcKwh < 0
    ) {
      throw new Error(
        `Invalid gridToBatteryAcKwh at index ${i}: must be a finite non-negative number. Received: ${flow.gridToBatteryAcKwh}`
      );
    }

    if (
      typeof flow.remainingSurplusSolarKwh !== 'number' ||
      !Number.isFinite(flow.remainingSurplusSolarKwh) ||
      flow.remainingSurplusSolarKwh < 0
    ) {
      throw new Error(
        `Invalid remainingSurplusSolarKwh at index ${i}: must be a finite non-negative number. Received: ${flow.remainingSurplusSolarKwh}`
      );
    }

    const exportResult = inv.exportResult;
    if (!exportResult || typeof exportResult !== 'object') {
      throw new Error(
        `Invalid exportResult at index ${i}: must be an object.`
      );
    }

    if (
      typeof exportResult.batteryExportAcKwh !== 'number' ||
      !Number.isFinite(exportResult.batteryExportAcKwh) ||
      exportResult.batteryExportAcKwh < 0
    ) {
      throw new Error(
        `Invalid batteryExportAcKwh at index ${i}: must be a finite non-negative number. Received: ${exportResult.batteryExportAcKwh}`
      );
    }

    items[i] = {
      sourceIndex: inv.sourceIndex,
      sourceTimestamp: inv.sourceTimestamp,
      timestampUtc: inv.timestampUtc,
      tierId: inv.tierId,
      residualHomeLoadAfterBatteryKwh: flow.residualHomeLoadAfterBatteryKwh,
      gridToBatteryAcKwh: flow.gridToBatteryAcKwh,
      remainingSurplusSolarKwh: flow.remainingSurplusSolarKwh,
      batteryExportKwh: exportResult.batteryExportAcKwh,
    };
  }

  return computeNormalizedGridFlows(items, allowSolarExport);
}
