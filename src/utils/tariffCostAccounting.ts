/**
 * TOU / Seasonal Tariff Cost Accounting Engine (Milestone G3J)
 *
 * Computes interval-level electricity costs and net savings for VoltWise simulations:
 *   - Reuses authoritative tariff rate resolution from Milestone G3M (resolveTariffRates).
 *   - Evaluates baseline electricity cost against original household load.
 *   - Evaluates simulated grid import costs for home and battery AC charging.
 *   - Evaluates solar export feed-in credits and simulated net cost.
 *   - Computes interval-level and aggregate financial savings.
 *
 * Pure function: does not mutate inputs. Does not modify physical dispatch or long-term finances.
 */

import {
  ExportAwareBatteryFlowInterval,
  GridFlowInterval,
  IntegratedBatteryFlowInterval,
  RateTier,
  ResolvedTariffRateInterval,
  TariffCostInterval,
  TariffCostResult,
  TouSeason,
} from '../types/energy';
import { AlignedLoadTimestamp } from './loadTimeAlignment';
import { resolveTariffRates } from './tariffRateResolver';

interface NormalizedTariffCostInput {
  sourceIndex: number;
  sourceTimestamp: string;
  timestampUtc: string;

  tierId: string;
  tierName: string;
  seasonName?: string;
  localMonth: number;

  buyRate: number;
  sellRate: number;

  homeLoadKwh: number;

  gridImportForHomeKwh: number;
  gridImportForBatteryKwh: number;
  totalGridImportKwh: number;

  solarExportKwh: number;
  batteryExportKwh: number;
  totalGridExportKwh: number;
}

/**
 * Shared authoritative internal tariff cost accounting engine.
 */
function computeNormalizedTariffCosts(
  items: NormalizedTariffCostInput[]
): TariffCostResult {
  let totalBaselineCost = 0;
  let totalGridImportForHomeCost = 0;
  let totalGridImportForBatteryCost = 0;
  let totalGridImportCost = 0;
  let totalSolarExportCredit = 0;
  let totalBatteryExportCredit = 0;
  let totalGridExportCredit = 0;
  let totalSimulatedCost = 0;
  let totalNetSavings = 0;

  const length = items.length;
  const resultIntervals: TariffCostInterval[] = new Array(length);

  for (let i = 0; i < length; i++) {
    const item = items[i];

    const baselineCost = item.homeLoadKwh * item.buyRate;

    const gridImportForHomeCost = item.gridImportForHomeKwh * item.buyRate;
    const gridImportForBatteryCost = item.gridImportForBatteryKwh * item.buyRate;
    const totalGridImportCostInterval = item.totalGridImportKwh * item.buyRate;

    const solarExportCredit = item.solarExportKwh * item.sellRate;
    const batteryExportCredit = item.batteryExportKwh * item.sellRate;
    const gridExportCredit = solarExportCredit + batteryExportCredit;

    const simulatedCost = totalGridImportCostInterval - gridExportCredit;
    const netSavings = baselineCost - simulatedCost;

    totalBaselineCost += baselineCost;
    totalGridImportForHomeCost += gridImportForHomeCost;
    totalGridImportForBatteryCost += gridImportForBatteryCost;
    totalGridImportCost += totalGridImportCostInterval;
    totalSolarExportCredit += solarExportCredit;
    totalBatteryExportCredit += batteryExportCredit;
    totalGridExportCredit += gridExportCredit;
    totalSimulatedCost += simulatedCost;
    totalNetSavings += netSavings;

    resultIntervals[i] = {
      sourceIndex: item.sourceIndex,
      sourceTimestamp: item.sourceTimestamp,
      timestampUtc: item.timestampUtc,

      tierId: item.tierId,
      tierName: item.tierName,
      seasonName: item.seasonName,

      localMonth: item.localMonth,

      buyRate: item.buyRate,
      sellRate: item.sellRate,

      homeLoadKwh: item.homeLoadKwh,

      gridImportForHomeKwh: item.gridImportForHomeKwh,
      gridImportForBatteryKwh: item.gridImportForBatteryKwh,
      totalGridImportKwh: item.totalGridImportKwh,

      solarExportKwh: item.solarExportKwh,
      batteryExportKwh: item.batteryExportKwh,
      totalGridExportKwh: item.totalGridExportKwh,

      baselineCost,

      gridImportForHomeCost,
      gridImportForBatteryCost,
      totalGridImportCost: totalGridImportCostInterval,

      solarExportCredit,
      batteryExportCredit,
      gridExportCredit,

      simulatedCost,
      netSavings,
    };
  }

  return {
    intervals: resultIntervals,
    baselineCost: totalBaselineCost,
    gridImportForHomeCost: totalGridImportForHomeCost,
    gridImportForBatteryCost: totalGridImportForBatteryCost,
    totalGridImportCost,
    solarExportCredit: totalSolarExportCredit,
    batteryExportCredit: totalBatteryExportCredit,
    gridExportCredit: totalGridExportCredit,
    totalSolarExportCredit,
    totalBatteryExportCredit,
    totalGridExportCredit,
    simulatedCost: totalSimulatedCost,
    netSavings: totalNetSavings,
  };
}

/**
 * Calculates interval-by-interval tariff costs, export credits, simulated costs, and net savings.
 *
 * @param gridFlows Physical grid-boundary exchange intervals (from G3I)
 * @param integratedIntervals Integrated solar/load/battery intervals (from G3H)
 * @param alignedTimestamps Authoritative aligned timestamps (from G2D)
 * @param timeZone Site IANA timezone string
 * @param tiers Non-empty array of base RateTier definitions
 * @param seasons Optional array of seasonal TOU overrides
 * @returns TariffCostResult containing interval accounting and reconciled totals
 */
export function calculateTariffCosts(
  gridFlows: GridFlowInterval[],
  integratedIntervals: IntegratedBatteryFlowInterval[],
  alignedTimestamps: AlignedLoadTimestamp[],
  timeZone: string,
  tiers: RateTier[],
  seasons?: TouSeason[]
): TariffCostResult {
  // 1. Array existence and non-emptiness checks
  if (!Array.isArray(gridFlows) || gridFlows.length === 0) {
    throw new Error('gridFlows must be a non-empty array.');
  }

  if (!Array.isArray(integratedIntervals) || integratedIntervals.length === 0) {
    throw new Error('integratedIntervals must be a non-empty array.');
  }

  if (!Array.isArray(alignedTimestamps) || alignedTimestamps.length === 0) {
    throw new Error('alignedTimestamps must be a non-empty array.');
  }

  // 2. Length equality check
  const length = gridFlows.length;
  if (
    integratedIntervals.length !== length ||
    alignedTimestamps.length !== length
  ) {
    throw new Error(
      `Array length mismatch: gridFlows has ${length}, integratedIntervals has ${integratedIntervals.length}, alignedTimestamps has ${alignedTimestamps.length}.`
    );
  }

  // Energy-flow specific alignment check for gridFlows sourceIndex
  for (let i = 0; i < length; i++) {
    const gf = gridFlows[i];
    if (!gf || typeof gf !== 'object') {
      throw new Error(`Invalid gridFlow interval at index ${i}: must be an object.`);
    }
    if (gf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: gridFlows sourceIndex is ${gf.sourceIndex}, expected ${i}.`
      );
    }
  }

  // 3. Authoritative tariff rate resolution via G3M reusable resolver
  const resolvedRates = resolveTariffRates(
    gridFlows,
    alignedTimestamps,
    timeZone,
    tiers,
    seasons
  );

  const items: NormalizedTariffCostInput[] = new Array(length);

  for (let i = 0; i < length; i++) {
    const gf = gridFlows[i];
    const inf = integratedIntervals[i];
    const at = alignedTimestamps[i];
    const rr = resolvedRates[i];

    if (!inf || typeof inf !== 'object') {
      throw new Error(
        `Invalid integrated interval at index ${i}: must be an object.`
      );
    }

    if (inf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: integratedIntervals sourceIndex is ${inf.sourceIndex}, expected ${i}.`
      );
    }

    if (gf.timestampUtc !== inf.timestampUtc) {
      throw new Error(
        `Timestamp mismatch at index ${i}: gridFlows timestampUtc ("${gf.timestampUtc}") !== integratedIntervals timestampUtc ("${inf.timestampUtc}").`
      );
    }
    if (inf.timestampUtc !== at.timestampUtc) {
      throw new Error(
        `Timestamp mismatch at index ${i}: integratedIntervals timestampUtc ("${inf.timestampUtc}") !== alignedTimestamps timestampUtc ("${at.timestampUtc}").`
      );
    }

    if (gf.sourceTimestamp !== inf.sourceTimestamp) {
      throw new Error(
        `Source timestamp mismatch at index ${i}: gridFlows sourceTimestamp ("${gf.sourceTimestamp}") !== integratedIntervals sourceTimestamp ("${inf.sourceTimestamp}").`
      );
    }

    const homeLoadKwh = inf.homeLoadKwh;
    if (typeof homeLoadKwh !== 'number' || !Number.isFinite(homeLoadKwh)) {
      throw new Error(
        `Invalid homeLoadKwh at index ${i}: must be a finite number. Received: ${homeLoadKwh}`
      );
    }

    const gridImportForHomeKwh = gf.gridImportForHomeKwh;
    if (
      typeof gridImportForHomeKwh !== 'number' ||
      !Number.isFinite(gridImportForHomeKwh)
    ) {
      throw new Error(
        `Invalid gridImportForHomeKwh at index ${i}: must be a finite number. Received: ${gridImportForHomeKwh}`
      );
    }

    const gridImportForBatteryKwh = gf.gridImportForBatteryKwh;
    if (
      typeof gridImportForBatteryKwh !== 'number' ||
      !Number.isFinite(gridImportForBatteryKwh)
    ) {
      throw new Error(
        `Invalid gridImportForBatteryKwh at index ${i}: must be a finite number. Received: ${gridImportForBatteryKwh}`
      );
    }

    const totalGridImportKwh = gf.totalGridImportKwh;
    if (
      typeof totalGridImportKwh !== 'number' ||
      !Number.isFinite(totalGridImportKwh)
    ) {
      throw new Error(
        `Invalid totalGridImportKwh at index ${i}: must be a finite number. Received: ${totalGridImportKwh}`
      );
    }

    const totalGridExportKwh = gf.totalGridExportKwh;
    if (
      typeof totalGridExportKwh !== 'number' ||
      !Number.isFinite(totalGridExportKwh)
    ) {
      throw new Error(
        `Invalid totalGridExportKwh at index ${i}: must be a finite number. Received: ${totalGridExportKwh}`
      );
    }

    const batteryExportKwh =
      typeof gf.batteryExportKwh === 'number' && Number.isFinite(gf.batteryExportKwh)
        ? gf.batteryExportKwh
        : 0;

    const solarExportKwh =
      typeof gf.solarExportKwh === 'number' && Number.isFinite(gf.solarExportKwh)
        ? gf.solarExportKwh
        : totalGridExportKwh - batteryExportKwh;

    items[i] = {
      sourceIndex: i,
      sourceTimestamp: gf.sourceTimestamp,
      timestampUtc: gf.timestampUtc,
      tierId: rr.tierId,
      tierName: rr.tierName,
      seasonName: rr.seasonName,
      localMonth: rr.localMonth,
      buyRate: rr.buyRate,
      sellRate: rr.sellRate,
      homeLoadKwh,
      gridImportForHomeKwh,
      gridImportForBatteryKwh,
      totalGridImportKwh,
      solarExportKwh,
      batteryExportKwh,
      totalGridExportKwh,
    };
  }

  return computeNormalizedTariffCosts(items);
}

/**
 * Calculates interval-by-interval tariff costs, export credits, simulated costs, and net savings
 * using authoritative G3O export-aware intervals and pre-resolved tariff rates.
 *
 * Bypasses re-resolution of rates to ensure 100% pricing consistency with G3O export decisions.
 *
 * Pure function: does not mutate inputs.
 */
export function calculateExportAwareTariffCosts(
  gridFlows: GridFlowInterval[],
  exportAwareIntervals: ExportAwareBatteryFlowInterval[],
  resolvedRates: ResolvedTariffRateInterval[]
): TariffCostResult {
  // 1. Array existence and non-emptiness checks
  if (!Array.isArray(gridFlows) || gridFlows.length === 0) {
    throw new Error('gridFlows must be a non-empty array.');
  }

  if (
    !Array.isArray(exportAwareIntervals) ||
    exportAwareIntervals.length === 0
  ) {
    throw new Error('exportAwareIntervals must be a non-empty array.');
  }

  if (!Array.isArray(resolvedRates) || resolvedRates.length === 0) {
    throw new Error('resolvedRates must be a non-empty array.');
  }

  // 2. Length equality check
  const length = gridFlows.length;
  if (
    exportAwareIntervals.length !== length ||
    resolvedRates.length !== length
  ) {
    throw new Error(
      `Array length mismatch: gridFlows has ${length}, exportAwareIntervals has ${exportAwareIntervals.length}, resolvedRates has ${resolvedRates.length}.`
    );
  }

  const items: NormalizedTariffCostInput[] = new Array(length);

  for (let i = 0; i < length; i++) {
    const gf = gridFlows[i];
    const eai = exportAwareIntervals[i];
    const rr = resolvedRates[i];

    if (!gf || typeof gf !== 'object') {
      throw new Error(`Invalid gridFlow interval at index ${i}: must be an object.`);
    }

    if (!eai || typeof eai !== 'object') {
      throw new Error(
        `Invalid exportAware interval at index ${i}: must be an object.`
      );
    }

    if (!rr || typeof rr !== 'object') {
      throw new Error(
        `Invalid resolvedRate at index ${i}: must be an object.`
      );
    }

    // Source index alignment
    if (gf.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: gridFlows sourceIndex is ${gf.sourceIndex}, expected ${i}.`
      );
    }

    if (eai.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: exportAwareIntervals sourceIndex is ${eai.sourceIndex}, expected ${i}.`
      );
    }

    if (rr.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: resolvedRates sourceIndex is ${rr.sourceIndex}, expected ${i}.`
      );
    }

    // Timestamp alignment
    if (gf.timestampUtc !== eai.timestampUtc) {
      throw new Error(
        `Timestamp mismatch at index ${i}: gridFlows timestampUtc ("${gf.timestampUtc}") !== exportAwareIntervals timestampUtc ("${eai.timestampUtc}").`
      );
    }

    if (eai.timestampUtc !== rr.timestampUtc) {
      throw new Error(
        `Timestamp mismatch at index ${i}: exportAwareIntervals timestampUtc ("${eai.timestampUtc}") !== resolvedRates timestampUtc ("${rr.timestampUtc}").`
      );
    }

    if (gf.sourceTimestamp !== eai.sourceTimestamp) {
      throw new Error(
        `Source timestamp mismatch at index ${i}: gridFlows sourceTimestamp ("${gf.sourceTimestamp}") !== exportAwareIntervals sourceTimestamp ("${eai.sourceTimestamp}").`
      );
    }

    // Tier alignment
    if (gf.tierId !== eai.tierId) {
      throw new Error(
        `Tier mismatch at index ${i}: gridFlows tierId ("${gf.tierId}") !== exportAwareIntervals tierId ("${eai.tierId}").`
      );
    }

    if (eai.tierId !== rr.tierId) {
      throw new Error(
        `Tier mismatch at index ${i}: exportAwareIntervals tierId ("${eai.tierId}") !== resolvedRates tierId ("${rr.tierId}").`
      );
    }

    // Explicitly reject non-finite G3O rates before comparison
    if (typeof eai.buyRate !== 'number' || !Number.isFinite(eai.buyRate)) {
      throw new Error(
        `Invalid buyRate in exportAwareIntervals at index ${i}: must be a finite number. Received: ${eai.buyRate}`
      );
    }

    if (typeof eai.sellRate !== 'number' || !Number.isFinite(eai.sellRate)) {
      throw new Error(
        `Invalid sellRate in exportAwareIntervals at index ${i}: must be a finite number. Received: ${eai.sellRate}`
      );
    }

    // Require exact rate equality with authoritative resolved rates (no tolerance/epsilon)
    if (eai.buyRate !== rr.buyRate || eai.sellRate !== rr.sellRate) {
      throw new Error(
        `Resolved-rate mismatch at index ${i}: exportAwareIntervals rate (buy: ${eai.buyRate}, sell: ${eai.sellRate}) !== resolvedRates (buy: ${rr.buyRate}, sell: ${rr.sellRate}).`
      );
    }

    const flow = eai.preExportFlow;
    if (!flow || typeof flow !== 'object') {
      throw new Error(
        `Invalid preExportFlow in exportAwareIntervals at index ${i}: must be an object.`
      );
    }

    const homeLoadKwh = flow.homeLoadKwh;
    if (typeof homeLoadKwh !== 'number' || !Number.isFinite(homeLoadKwh)) {
      throw new Error(
        `Invalid homeLoadKwh at index ${i}: must be a finite number. Received: ${homeLoadKwh}`
      );
    }

    const gridImportForHomeKwh = gf.gridImportForHomeKwh;
    if (
      typeof gridImportForHomeKwh !== 'number' ||
      !Number.isFinite(gridImportForHomeKwh)
    ) {
      throw new Error(
        `Invalid gridImportForHomeKwh at index ${i}: must be a finite number. Received: ${gridImportForHomeKwh}`
      );
    }

    const gridImportForBatteryKwh = gf.gridImportForBatteryKwh;
    if (
      typeof gridImportForBatteryKwh !== 'number' ||
      !Number.isFinite(gridImportForBatteryKwh)
    ) {
      throw new Error(
        `Invalid gridImportForBatteryKwh at index ${i}: must be a finite number. Received: ${gridImportForBatteryKwh}`
      );
    }

    const totalGridImportKwh = gf.totalGridImportKwh;
    if (
      typeof totalGridImportKwh !== 'number' ||
      !Number.isFinite(totalGridImportKwh)
    ) {
      throw new Error(
        `Invalid totalGridImportKwh at index ${i}: must be a finite number. Received: ${totalGridImportKwh}`
      );
    }

    const solarExportKwh = gf.solarExportKwh;
    if (
      typeof solarExportKwh !== 'number' ||
      !Number.isFinite(solarExportKwh)
    ) {
      throw new Error(
        `Invalid solarExportKwh at index ${i}: must be a finite number. Received: ${solarExportKwh}`
      );
    }

    const batteryExportKwh = gf.batteryExportKwh;
    if (
      typeof batteryExportKwh !== 'number' ||
      !Number.isFinite(batteryExportKwh)
    ) {
      throw new Error(
        `Invalid batteryExportKwh at index ${i}: must be a finite number. Received: ${batteryExportKwh}`
      );
    }

    const totalGridExportKwh = gf.totalGridExportKwh;
    if (
      typeof totalGridExportKwh !== 'number' ||
      !Number.isFinite(totalGridExportKwh)
    ) {
      throw new Error(
        `Invalid totalGridExportKwh at index ${i}: must be a finite number. Received: ${totalGridExportKwh}`
      );
    }

    const exportResult = eai.exportResult;
    if (
      exportResult &&
      typeof exportResult.batteryExportAcKwh === 'number' &&
      Math.abs(batteryExportKwh - exportResult.batteryExportAcKwh) > 1e-6
    ) {
      throw new Error(
        `Battery export mismatch at index ${i}: gridFlows batteryExportKwh (${batteryExportKwh}) !== exportAwareIntervals exportResult.batteryExportAcKwh (${exportResult.batteryExportAcKwh}).`
      );
    }

    items[i] = {
      sourceIndex: i,
      sourceTimestamp: gf.sourceTimestamp,
      timestampUtc: gf.timestampUtc,
      tierId: rr.tierId,
      tierName: rr.tierName,
      seasonName: rr.seasonName,
      localMonth: rr.localMonth,
      buyRate: rr.buyRate,
      sellRate: rr.sellRate,
      homeLoadKwh,
      gridImportForHomeKwh,
      gridImportForBatteryKwh,
      totalGridImportKwh,
      solarExportKwh,
      batteryExportKwh,
      totalGridExportKwh,
    };
  }

  return computeNormalizedTariffCosts(items);
}
