/**
 * Authoritative Generator-Aware Production Operational Flow Engine (Milestone G6C)
 *
 * Implements pure, deterministic generator production energy routing and integration:
 *   1. Passive renewable priority (solar/wind direct-to-load before generator)
 *   2. Passive renewable surplus to battery charging before generator charging
 *   3. Scheduled generator commitment and residual load service
 *   4. Scheduled generator surplus to battery charging (shared charge constraints)
 *   5. Existing battery policy load discharge & no-generator home import counterfactual
 *   6. Authoritative G6B economic generator dispatch evaluation
 *   7. Committed grid charging suppression when any generator runs
 *   8. Economic same-interval anti-cycling (surplus cannot recharge discharged battery)
 *   9. Economic generator direct-load service and eligible surplus charging
 *  10. Final grid import for residual household load
 *  11. Existing grid-charged battery export (grid-SOC isolated, no arbitrage)
 *  12. Direct renewable and generator export vs curtailment
 *  13. Source-level reconciliation and tariff / operating cost accounting
 *
 * All operations are pure, deterministic, and non-mutating.
 */

import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  ExportAwareBatteryFlowInterval,
  ExportAwareBatteryFlowResult,
  GeneratorAssetAnnualSummary,
  GeneratorGenerationAsset,
  GridBatteryExportResult,
  GridFlowInterval,
  GridFlowResult,
  GridSocCostBasisState,
  IntegratedBatteryFlowInterval,
  IntervalDataPoint,
  RenewableLoadFlowInterval,
  ResolvedTariffRateInterval,
  SolarFleetGenerationInterval,
  SolarLoadFlowInterval,
  TariffCostInterval,
  TariffCostResult,
  WindFleetGenerationInterval,
} from '../types/energy';
import { AlignedLoadTimestamp } from './loadTimeAlignment';
import {
  calculateUsableCapacityKwh,
  calculateChargeEfficiency,
} from './solarBatteryCharging';
import {
  calculateDischargeEfficiency,
  dischargeBatteryToHomeLoad,
} from './batteryDischarge';
import { chargeBatteryFromGrid } from './gridBatteryCharging';
import { advanceGridSocCostBasis } from './gridSocCostBasis';
import { exportGridChargedBatteryEnergy } from './gridBatteryExport';
import {
  allocateScheduledGenerators,
  dispatchGeneratorInterval,
  isGeneratorScheduledForInterval,
  GeneratorFleetDispatchRecord,
} from './generatorDispatch';
import { validateGeneratorAsset } from './generatorModel';
import { summarizeRenewableLoadFlow } from './renewableLoadFlow';

const ZERO_THRESHOLD = 1e-9;

export interface GeneratorAwareOperationalFlowParams {
  dataPoints: IntervalDataPoint[];
  alignedTimestamps: AlignedLoadTimestamp[];
  solarFleetProfile: SolarFleetGenerationInterval[];
  windFleetProfile: WindFleetGenerationInterval[];
  renewableLoadFlow: RenewableLoadFlowInterval[];
  dispatchPolicy: BatteryDispatchPolicyInterval[];
  resolvedRates: ResolvedTariffRateInterval[];
  intervalHours: number;
  batteryProfile: BatteryProfile;
  generatorAssets: GeneratorGenerationAsset[];
  timeZone: string;
  initialBatteryState: BatterySocProvenanceState;
  initialCostBasisState: GridSocCostBasisState;
  allowRenewableExport: boolean;
}

export interface GeneratorAwareOperationalFlowResult {
  // Authoritative stage outputs
  renewableLoadFlow: RenewableLoadFlowInterval[];
  solarLoadFlow: SolarLoadFlowInterval[];
  exportAwareBatteryFlow: ExportAwareBatteryFlowResult;
  gridFlows: GridFlowResult;
  tariffCosts: TariffCostResult;
  generatorFleetRecords: GeneratorFleetDispatchRecord[];
  generatorAssetSummaries: GeneratorAssetAnnualSummary[];

  // Aggregated operational and financial values
  totalHomeLoadKwh: number;

  totalSolarGenerationKwh: number;
  totalSolarDirectToLoadKwh: number;
  totalSolarToBatteryKwh: number;
  totalSolarExportKwh: number;
  totalSolarCurtailedKwh: number;

  totalWindGenerationKwh: number;
  totalWindDirectToLoadKwh: number;
  totalWindToBatteryKwh: number;
  totalWindExportKwh: number;
  totalWindCurtailedKwh: number;

  totalRenewableGenerationKwh: number;
  totalRenewableDirectToLoadKwh: number;
  totalRenewableToBatteryKwh: number;
  totalRenewableExportKwh: number;
  totalRenewableCurtailedKwh: number;

  generatorGeneratedKwh: number;
  generatorDirectToLoadKwh: number;
  generatorToBatteryKwh: number;
  generatorExportKwh: number;
  generatorCurtailedKwh: number;

  totalGeneratorGenerationKwh: number;
  totalGeneratorDirectToLoadKwh: number;
  totalGeneratorToBatteryKwh: number;
  totalGeneratorExportKwh: number;
  totalGeneratorCurtailedKwh: number;

  totalOnsiteGenerationKwh: number;

  generatorRuntimeHours: number;
  generatorStarts: number;

  generatorFuelCostUsd: number;
  generatorVariableMaintenanceCostUsd: number;
  generatorOperatingCostUsd: number;

  totalGridImportKwh: number;
  totalBatteryExportKwh: number;
  totalGridExportKwh: number;

  baselineCost: number;
  simulatedCost: number;
  netSavings: number;

  modeledUtilityCostUsd: number;
  utilityElectricitySavingsUsd: number;
  netOperationalSavingsUsd: number;
  modeledTotalOperatingEnergyCostUsd: number;
}

/**
 * Simulates generator-aware operational flow chronologically across all modeled intervals.
 */
export function simulateGeneratorAwareOperationalFlow(
  params: GeneratorAwareOperationalFlowParams
): GeneratorAwareOperationalFlowResult {
  const {
    dataPoints,
    alignedTimestamps,
    solarFleetProfile,
    windFleetProfile,
    renewableLoadFlow,
    dispatchPolicy,
    resolvedRates,
    intervalHours,
    batteryProfile,
    generatorAssets,
    timeZone,
    initialBatteryState,
    initialCostBasisState,
    allowRenewableExport,
  } = params;

  // Validate inputs
  if (!Array.isArray(generatorAssets) || generatorAssets.length === 0) {
    throw new Error('generatorAssets must be a non-empty array of enabled assets.');
  }

  for (const asset of generatorAssets) {
    validateGeneratorAsset(asset);
  }

  const count = dataPoints.length;
  if (
    alignedTimestamps.length !== count ||
    renewableLoadFlow.length !== count ||
    dispatchPolicy.length !== count ||
    resolvedRates.length !== count
  ) {
    throw new Error('Array lengths across simulation stages must match dataPoints length.');
  }

  // Pre-calculate battery hardware constants
  const usableCapacityKwh = calculateUsableCapacityKwh(batteryProfile);
  const etaCharge = calculateChargeEfficiency(batteryProfile);
  const maxChargeAcKwh = batteryProfile.maxContinuousChargeKw * intervalHours;
  const isArbitrageStrategy = batteryProfile.strategy === 'arbitrage';
  const profileAllowsBatteryExport = Boolean(batteryProfile.allowGridExport);

  // Initialize chronological states
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

  const runningStateMap = new Map<string, boolean>();
  for (const asset of generatorAssets) {
    runningStateMap.set(asset.id, false);
  }

  // Per-asset accumulator structures for annual aggregation
  const assetSummaryMap = new Map<
    string,
    {
      asset: GeneratorGenerationAsset;
      generatedKwh: number;
      directToLoadKwh: number;
      toBatteryAcKwh: number;
      directExportKwh: number;
      curtailedKwh: number;
      runtimeHours: number;
      startCount: number;
      runningFuelUnits: number;
      startupFuelUnits: number;
      totalFuelUnits: number;
      fuelCostUsd: number;
      variableMaintenanceCostUsd: number;
      operatingCostUsd: number;
    }
  >();

  for (const asset of generatorAssets) {
    assetSummaryMap.set(asset.id, {
      asset,
      generatedKwh: 0,
      directToLoadKwh: 0,
      toBatteryAcKwh: 0,
      directExportKwh: 0,
      curtailedKwh: 0,
      runtimeHours: 0,
      startCount: 0,
      runningFuelUnits: 0,
      startupFuelUnits: 0,
      totalFuelUnits: 0,
      fuelCostUsd: 0,
      variableMaintenanceCostUsd: 0,
      operatingCostUsd: 0,
    });
  }

  // Result interval arrays
  const exportAwareIntervals: ExportAwareBatteryFlowInterval[] = new Array(count);
  const gridFlowIntervals: GridFlowInterval[] = new Array(count);
  const tariffCostIntervals: TariffCostInterval[] = new Array(count);
  const generatorFleetRecords: GeneratorFleetDispatchRecord[] = new Array(count);

  let totalSolarToBatteryAcKwh = 0;
  let totalWindToBatteryAcKwh = 0;
  let totalRenewableToBatteryAcKwh = 0;
  let totalRenewableEnergyStoredKwh = 0;

  let totalBatteryDeliveredToLoadKwh = 0;
  let totalStoredEnergyDrainedKwh = 0;

  let totalGridToBatteryAcKwh = 0;
  let totalGridEnergyStoredKwh = 0;

  let totalBatteryExportAcKwh = 0;
  let totalBatteryExportRevenueUsd = 0;
  let totalBatteryExportGrossMarginUsd = 0;
  let totalGridSocCostRemovedForExportUsd = 0;

  let totalGridImportForHomeKwh = 0;
  let totalGridImportForBatteryKwh = 0;
  let totalGridImportKwh = 0;

  let totalSolarExportKwh = 0;
  let totalWindExportKwh = 0;
  let totalRenewableExportKwh = 0;
  let totalGeneratorExportKwh = 0;
  let totalCurtailedSolarKwh = 0;
  let totalCurtailedWindKwh = 0;
  let totalCurtailedRenewableKwh = 0;
  let totalCurtailedGeneratorKwh = 0;
  let totalGridExportKwh = 0;

  let totalBaselineCost = 0;
  let totalGridImportForHomeCost = 0;
  let totalGridImportForBatteryCost = 0;
  let totalGridImportCost = 0;
  let totalSolarExportCredit = 0;
  let totalWindExportCredit = 0;
  let totalRenewableExportCredit = 0;
  let totalGeneratorExportCredit = 0;
  let totalBatteryExportCredit = 0;
  let totalGridExportCredit = 0;
  let totalSimulatedCost = 0;
  let totalNetSavings = 0;

  // Chronological interval simulation loop
  for (let i = 0; i < count; i++) {
    const pt = dataPoints[i];
    const al = alignedTimestamps[i];
    const ren = renewableLoadFlow[i];
    const pol = dispatchPolicy[i];
    const rate = resolvedRates[i];
    const instantUtc = new Date(al.instantUtc);
    const homeLoadKwh = ren.homeLoadKwh;

    // Snapshot state before interval
    const stateBefore: BatterySocProvenanceState = { ...currentBatteryState };
    const batterySocBeforeKwh =
      stateBefore.syntheticSocKwh +
      stateBefore.gridChargedSocKwh +
      stateBefore.renewableChargedSocKwh +
      stateBefore.generatorChargedSocKwh;

    // ------------------------------------------------------------------------
    // Step 1 & 2: Passive Renewable Priority & Surplus Charging
    // ------------------------------------------------------------------------
    const capacityRoomKwh = Math.max(0, usableCapacityKwh - batterySocBeforeKwh);
    const maxAcByCapacity = capacityRoomKwh / etaCharge;

    const totalRenSurplus = ren.totalRenewableSurplusKwh;
    let renewableToBatteryAcKwh = Math.min(
      totalRenSurplus,
      maxChargeAcKwh,
      maxAcByCapacity
    );
    if (renewableToBatteryAcKwh < 1e-12) {
      renewableToBatteryAcKwh = 0;
    }

    let solarToBatteryAcKwh = 0;
    let windToBatteryAcKwh = 0;
    if (totalRenSurplus > 1e-12 && renewableToBatteryAcKwh > 0) {
      solarToBatteryAcKwh =
        (ren.surplusSolarKwh / totalRenSurplus) * renewableToBatteryAcKwh;
      windToBatteryAcKwh = renewableToBatteryAcKwh - solarToBatteryAcKwh;
    }

    const renEnergyStoredKwh = renewableToBatteryAcKwh * etaCharge;
    const remainingSurplusSolar = Math.max(
      0,
      ren.surplusSolarKwh - solarToBatteryAcKwh
    );
    const remainingSurplusWind = Math.max(
      0,
      ren.surplusWindKwh - windToBatteryAcKwh
    );
    const remainingSurplusRen = remainingSurplusSolar + remainingSurplusWind;

    // State after renewable charging
    const socAfterRen = batterySocBeforeKwh + renEnergyStoredKwh;
    let remainingChargePowerAcKwh = Math.max(
      0,
      maxChargeAcKwh - renewableToBatteryAcKwh
    );
    let remainingCapacityRoomKwh = Math.max(0, usableCapacityKwh - socAfterRen);
    let remainingChargeHeadroomAcKwh = Math.min(
      remainingChargePowerAcKwh,
      remainingCapacityRoomKwh / etaCharge
    );

    // ------------------------------------------------------------------------
    // Step 3: Scheduled Generator Commitment & Output Allocation
    // ------------------------------------------------------------------------
    const committedScheduled = generatorAssets.filter(
      (a) =>
        a.enabled &&
        a.dispatchMode === 'scheduled' &&
        isGeneratorScheduledForInterval(a, instantUtc, timeZone)
    );

    const residualHomeLoadBeforeScheduled = ren.residualHomeLoadKwh;
    const scheduledOutputKwMap = new Map<string, number>();
    const scheduledDirectLoadMap = new Map<string, number>();
    const scheduledSurplusMap = new Map<string, number>();
    let totalScheduledGenKwh = 0;
    let totalScheduledDirectLoadKwh = 0;

    if (committedScheduled.length > 0) {
      const residualDemandKw =
        Math.max(0, residualHomeLoadBeforeScheduled) / intervalHours;
      const alloc = allocateScheduledGenerators(committedScheduled, residualDemandKw);

      for (const asset of committedScheduled) {
        const kw = alloc.get(asset.id) ?? 0;
        scheduledOutputKwMap.set(asset.id, kw);
        totalScheduledGenKwh += kw * intervalHours;
      }

      const homeLoadToServe = Math.max(0, residualHomeLoadBeforeScheduled);
      for (const asset of committedScheduled) {
        const genKwh = (scheduledOutputKwMap.get(asset.id) ?? 0) * intervalHours;
        if (genKwh <= 0) {
          scheduledDirectLoadMap.set(asset.id, 0);
          scheduledSurplusMap.set(asset.id, 0);
        } else if (totalScheduledGenKwh <= homeLoadToServe) {
          scheduledDirectLoadMap.set(asset.id, genKwh);
          scheduledSurplusMap.set(asset.id, 0);
          totalScheduledDirectLoadKwh += genKwh;
        } else {
          const share = totalScheduledGenKwh > 0 ? genKwh / totalScheduledGenKwh : 0;
          const direct = share * homeLoadToServe;
          const surplus = Math.max(0, genKwh - direct);
          scheduledDirectLoadMap.set(asset.id, direct);
          scheduledSurplusMap.set(asset.id, surplus);
          totalScheduledDirectLoadKwh += direct;
        }
      }
    }

    const residualHomeLoadAfterScheduled = Math.max(
      0,
      residualHomeLoadBeforeScheduled - totalScheduledDirectLoadKwh
    );

    // ------------------------------------------------------------------------
    // Step 4: Scheduled Generator Surplus Charging (Priority 2)
    // ------------------------------------------------------------------------
    const scheduledToBatteryMap = new Map<string, number>();
    let totalScheduledEligibleSurplus = 0;
    for (const asset of committedScheduled) {
      const surplus = scheduledSurplusMap.get(asset.id) ?? 0;
      if (asset.allowBatteryCharging && surplus > 1e-12) {
        totalScheduledEligibleSurplus += surplus;
      }
    }

    let acceptedScheduledAcCharge = Math.min(
      totalScheduledEligibleSurplus,
      remainingChargeHeadroomAcKwh
    );
    if (acceptedScheduledAcCharge < 1e-12) {
      acceptedScheduledAcCharge = 0;
    }

    for (const asset of committedScheduled) {
      const surplus = scheduledSurplusMap.get(asset.id) ?? 0;
      if (
        asset.allowBatteryCharging &&
        surplus > 1e-12 &&
        totalScheduledEligibleSurplus > 0
      ) {
        const toBat =
          (surplus / totalScheduledEligibleSurplus) * acceptedScheduledAcCharge;
        scheduledToBatteryMap.set(asset.id, toBat);
      } else {
        scheduledToBatteryMap.set(asset.id, 0);
      }
    }

    const totalScheduledStoredKwh = acceptedScheduledAcCharge * etaCharge;
    const socAfterScheduledCharge = socAfterRen + totalScheduledStoredKwh;
    remainingChargePowerAcKwh = Math.max(
      0,
      remainingChargePowerAcKwh - acceptedScheduledAcCharge
    );
    remainingCapacityRoomKwh = Math.max(
      0,
      usableCapacityKwh - socAfterScheduledCharge
    );
    remainingChargeHeadroomAcKwh = Math.min(
      remainingChargePowerAcKwh,
      remainingCapacityRoomKwh / etaCharge
    );

    // ------------------------------------------------------------------------
    // Step 5: Battery Policy & No-Economic-Generator Counterfactual Evaluation
    // ------------------------------------------------------------------------
    const scheduledRan = committedScheduled.length > 0;
    const socStateAtBatteryStep: BatterySocProvenanceState = {
      syntheticSocKwh: stateBefore.syntheticSocKwh,
      gridChargedSocKwh: stateBefore.gridChargedSocKwh,
      renewableChargedSocKwh:
        stateBefore.renewableChargedSocKwh + renEnergyStoredKwh,
      generatorChargedSocKwh:
        stateBefore.generatorChargedSocKwh + totalScheduledStoredKwh,
    };

    const hasRoomForGridCharge =
      usableCapacityKwh - socAfterScheduledCharge > 1e-9;
    const gridChargeSelectedInCounterfactual =
      pol.allowGridChargeFromGrid && hasRoomForGridCharge && !scheduledRan;

    const canDischarge =
      residualHomeLoadAfterScheduled > 1e-12 &&
      pol.allowBatteryDischargeToLoad &&
      !gridChargeSelectedInCounterfactual;

    let batteryDeliveredToLoadKwh = 0;
    let storedEnergyDrainedKwh = 0;
    let syntheticSocDrainedKwh = 0;
    let renewableSocDrainedKwh = 0;
    let generatorSocDrainedKwh = 0;
    let gridSocDrainedKwh = 0;
    let socStateAfterDischarge = socStateAtBatteryStep;
    let counterfactualGridImportForHomeKwh = residualHomeLoadAfterScheduled;

    if (canDischarge) {
      const dischargeResult = dischargeBatteryToHomeLoad(
        residualHomeLoadAfterScheduled,
        intervalHours,
        batteryProfile,
        socStateAtBatteryStep
      );
      batteryDeliveredToLoadKwh = dischargeResult.batteryDeliveredToLoadKwh;
      storedEnergyDrainedKwh = dischargeResult.storedEnergyDrainedKwh;
      syntheticSocDrainedKwh = dischargeResult.syntheticSocDrainedKwh;
      renewableSocDrainedKwh = dischargeResult.renewableSocDrainedKwh;
      generatorSocDrainedKwh = dischargeResult.generatorSocDrainedKwh;
      gridSocDrainedKwh = dischargeResult.gridSocDrainedKwh;
      socStateAfterDischarge = dischargeResult.stateAfter;
      counterfactualGridImportForHomeKwh = dischargeResult.unmetHomeLoadKwh;
    }

    // ------------------------------------------------------------------------
    // Step 6: Authoritative G6B Generator Dispatch Evaluation
    // ------------------------------------------------------------------------
    const fleetRecord = dispatchGeneratorInterval({
      assets: generatorAssets,
      priorStates: runningStateMap,
      intervalHours,
      timeZone,
      instantUtc,
      residualHomeLoadKwh: residualHomeLoadBeforeScheduled,
      counterfactualGridImportForHomeKwh,
      buyRate: rate.buyRate,
      sellRate: rate.sellRate,
    });

    generatorFleetRecords[i] = fleetRecord;
    for (const s of fleetRecord.finalStates) {
      runningStateMap.set(s.assetId, s.running);
    }

    const anyGeneratorRan = fleetRecord.intervals.some((r) => r.running);

    // ------------------------------------------------------------------------
    // Step 7: Actual Committed Grid Charging (Suppressed if any generator runs)
    // ------------------------------------------------------------------------
    let gridToBatteryAcKwh = 0;
    let gridEnergyStoredKwh = 0;
    let currentSocState: BatterySocProvenanceState;

    if (anyGeneratorRan) {
      gridToBatteryAcKwh = 0;
      gridEnergyStoredKwh = 0;
      currentSocState = { ...socStateAfterDischarge };
    } else {
      if (gridChargeSelectedInCounterfactual) {
        const requestedGridChargeAcKwh = remainingChargePowerAcKwh;
        const gridResult = chargeBatteryFromGrid(
          requestedGridChargeAcKwh,
          intervalHours,
          batteryProfile,
          socStateAtBatteryStep
        );
        gridToBatteryAcKwh = gridResult.gridToBatteryAcKwh;
        gridEnergyStoredKwh = gridResult.gridEnergyStoredKwh;
        currentSocState = gridResult.stateAfter;
      } else {
        gridToBatteryAcKwh = 0;
        gridEnergyStoredKwh = 0;
        currentSocState = { ...socStateAfterDischarge };
      }
    }

    // ------------------------------------------------------------------------
    // Step 8: Economic Generator Surplus Routing & Anti-Cycling Protection
    // ------------------------------------------------------------------------
    const economicToBatteryMap = new Map<string, number>();
    let totalEconomicDirectLoadKwh = 0;

    for (const asset of generatorAssets) {
      if (asset.dispatchMode === 'economic') {
        const rec = fleetRecord.intervals.find((r) => r.assetId === asset.id);
        if (rec && rec.running) {
          totalEconomicDirectLoadKwh += rec.directLoadTargetKwh;
        }
      }
    }

    const antiCyclingActive = batteryDeliveredToLoadKwh > 1e-12;
    let acceptedEconomicAcCharge = 0;

    if (!antiCyclingActive) {
      let totalEconomicEligibleSurplus = 0;
      for (const asset of generatorAssets) {
        if (asset.dispatchMode === 'economic') {
          const rec = fleetRecord.intervals.find((r) => r.assetId === asset.id);
          if (
            rec &&
            rec.running &&
            asset.allowBatteryCharging &&
            rec.unavoidableSurplusKwh > 1e-12
          ) {
            totalEconomicEligibleSurplus += rec.unavoidableSurplusKwh;
          }
        }
      }

      acceptedEconomicAcCharge = Math.min(
        totalEconomicEligibleSurplus,
        remainingChargeHeadroomAcKwh
      );
      if (acceptedEconomicAcCharge < 1e-12) {
        acceptedEconomicAcCharge = 0;
      }

      for (const asset of generatorAssets) {
        if (asset.dispatchMode === 'economic') {
          const rec = fleetRecord.intervals.find((r) => r.assetId === asset.id);
          if (
            rec &&
            rec.running &&
            asset.allowBatteryCharging &&
            rec.unavoidableSurplusKwh > 1e-12 &&
            totalEconomicEligibleSurplus > 0
          ) {
            const toBat =
              (rec.unavoidableSurplusKwh / totalEconomicEligibleSurplus) *
              acceptedEconomicAcCharge;
            economicToBatteryMap.set(asset.id, toBat);
          } else {
            economicToBatteryMap.set(asset.id, 0);
          }
        }
      }

      const economicStoredKwh = acceptedEconomicAcCharge * etaCharge;
      currentSocState.generatorChargedSocKwh += economicStoredKwh;
    } else {
      for (const asset of generatorAssets) {
        if (asset.dispatchMode === 'economic') {
          economicToBatteryMap.set(asset.id, 0);
        }
      }
    }

    // ------------------------------------------------------------------------
    // Step 9: Per-Generator Output Allocation & Accounting
    // ------------------------------------------------------------------------
    let intervalGenGeneratedKwh = 0;
    let intervalGenDirectToLoadKwh = 0;
    let intervalGenToBatteryKwh = 0;
    let intervalGenExportKwh = 0;
    let intervalGenCurtailedKwh = 0;

    for (const asset of generatorAssets) {
      const rec = fleetRecord.intervals.find((r) => r.assetId === asset.id)!;
      const genKwh = rec.generatedKwh;
      let directToLoadKwh = 0;
      let toBatteryAcKwh = 0;

      if (asset.dispatchMode === 'scheduled') {
        directToLoadKwh = scheduledDirectLoadMap.get(asset.id) ?? 0;
        toBatteryAcKwh = scheduledToBatteryMap.get(asset.id) ?? 0;
      } else if (asset.dispatchMode === 'economic') {
        directToLoadKwh = rec.directLoadTargetKwh ?? 0;
        toBatteryAcKwh = economicToBatteryMap.get(asset.id) ?? 0;
      }

      const surplusAfterBattery = Math.max(
        0,
        genKwh - directToLoadKwh - toBatteryAcKwh
      );
      let directExportKwh = 0;
      let curtailedKwh = 0;

      if (asset.allowGridExport) {
        directExportKwh = surplusAfterBattery;
        curtailedKwh = 0;
      } else {
        directExportKwh = 0;
        curtailedKwh = surplusAfterBattery;
      }

      intervalGenGeneratedKwh += genKwh;
      intervalGenDirectToLoadKwh += directToLoadKwh;
      intervalGenToBatteryKwh += toBatteryAcKwh;
      intervalGenExportKwh += directExportKwh;
      intervalGenCurtailedKwh += curtailedKwh;

      // Accumulate per-asset summary
      const acc = assetSummaryMap.get(asset.id)!;
      acc.generatedKwh += genKwh;
      acc.directToLoadKwh += directToLoadKwh;
      acc.toBatteryAcKwh += toBatteryAcKwh;
      acc.directExportKwh += directExportKwh;
      acc.curtailedKwh += curtailedKwh;
      acc.runtimeHours += rec.runtimeHours;
      if (rec.startedThisInterval) {
        acc.startCount += 1;
      }
      acc.runningFuelUnits += rec.runningFuelUnits;
      acc.startupFuelUnits += rec.startupFuelUnits;
      acc.totalFuelUnits += rec.totalFuelUnits;
      acc.fuelCostUsd += rec.fuelCostUsd;
      acc.variableMaintenanceCostUsd += rec.variableMaintenanceCostUsd;
      acc.operatingCostUsd += rec.operatingCostUsd;
    }

    // ------------------------------------------------------------------------
    // Step 10: Grid-SOC Cost Basis Transition after Home Load Service
    // ------------------------------------------------------------------------
    let costBasisAfterHomeDispatch = { ...currentCostBasisState };
    if (gridEnergyStoredKwh > 0) {
      const transition = advanceGridSocCostBasis(
        currentCostBasisState,
        gridEnergyStoredKwh,
        rate.buyRate,
        0
      );
      costBasisAfterHomeDispatch = transition.stateAfter;
    } else if (gridSocDrainedKwh > 0) {
      const transition = advanceGridSocCostBasis(
        currentCostBasisState,
        0,
        0,
        gridSocDrainedKwh
      );
      costBasisAfterHomeDispatch = transition.stateAfter;
    }

    // ------------------------------------------------------------------------
    // Step 11: Grid-Charged Battery Export to Grid (Restricted to Grid-SOC)
    // ------------------------------------------------------------------------
    const hasRenewableChargeInInterval = renEnergyStoredKwh > ZERO_THRESHOLD;
    const hasGeneratorChargeInInterval = intervalGenToBatteryKwh > ZERO_THRESHOLD;

    const allowBatteryExportInInterval =
      isArbitrageStrategy &&
      profileAllowsBatteryExport &&
      !hasRenewableChargeInInterval &&
      !hasGeneratorChargeInInterval &&
      gridToBatteryAcKwh <= ZERO_THRESHOLD;

    const exportResult: GridBatteryExportResult = exportGridChargedBatteryEnergy(
      allowBatteryExportInInterval,
      rate.sellRate,
      batteryDeliveredToLoadKwh,
      intervalHours,
      batteryProfile,
      currentSocState,
      costBasisAfterHomeDispatch
    );

    const batteryStateAfterExport = exportResult.batteryStateAfter;
    const costBasisStateAfterExport = exportResult.costBasisStateAfter;
    const batteryExportKwh = exportResult.batteryExportAcKwh;

    // Advance chronological state for subsequent intervals
    currentBatteryState = { ...batteryStateAfterExport };
    currentCostBasisState = { ...costBasisStateAfterExport };

    // ------------------------------------------------------------------------
    // Step 12: Integrated Battery Flow & Export-Aware Records
    // ------------------------------------------------------------------------
    const residualHomeLoadFinalKwh = Math.max(
      0,
      counterfactualGridImportForHomeKwh - totalEconomicDirectLoadKwh
    );

    const preExportFlow: IntegratedBatteryFlowInterval = {
      sourceIndex: i,
      sourceTimestamp: pt.timestamp,
      timestampUtc: al.timestampUtc,
      tierId: pol.tierId,
      homeLoadKwh,
      solarGenerationKwh: ren.solarGenerationKwh,
      solarDirectToLoadKwh: ren.solarDirectToLoadKwh,
      windGenerationKwh: ren.windGenerationKwh,
      totalRenewableGenerationKwh: ren.totalRenewableGenerationKwh,
      windDirectToLoadKwh: ren.windDirectToLoadKwh,
      totalRenewableDirectToLoadKwh: ren.totalRenewableDirectToLoadKwh,
      residualHomeLoadBeforeBatteryKwh: ren.residualHomeLoadKwh,
      surplusSolarBeforeBatteryKwh: ren.surplusSolarKwh,
      surplusWindBeforeBatteryKwh: ren.surplusWindKwh,
      totalRenewableSurplusBeforeBatteryKwh: ren.totalRenewableSurplusKwh,
      gridChargeAllowed: pol.allowGridChargeFromGrid,
      dischargeAllowed: pol.allowBatteryDischargeToLoad,
      solarToBatteryAcKwh,
      windToBatteryAcKwh,
      totalRenewableToBatteryAcKwh: renewableToBatteryAcKwh,
      renewableEnergyStoredKwh: renEnergyStoredKwh,
      generatorToBatteryAcKwh: intervalGenToBatteryKwh,
      generatorEnergyStoredKwh:
        totalScheduledStoredKwh + acceptedEconomicAcCharge * etaCharge,
      requestedGridChargeAcKwh: remainingChargePowerAcKwh,
      gridToBatteryAcKwh,
      gridEnergyStoredKwh,
      batteryDeliveredToLoadKwh,
      storedEnergyDrainedKwh,
      syntheticSocDrainedKwh,
      renewableSocDrainedKwh,
      generatorSocDrainedKwh,
      gridSocDrainedKwh,
      residualHomeLoadAfterBatteryKwh: residualHomeLoadFinalKwh,
      remainingSurplusSolarKwh: remainingSurplusSolar,
      remainingSurplusWindKwh: remainingSurplusWind,
      remainingSurplusRenewableKwh: remainingSurplusRen,
      batterySocBeforeKwh,
      batterySocAfterKwh:
        currentSocState.syntheticSocKwh +
        currentSocState.gridChargedSocKwh +
        currentSocState.renewableChargedSocKwh +
        currentSocState.generatorChargedSocKwh,
      stateBefore,
      stateAfter: currentSocState,
    };

    exportAwareIntervals[i] = {
      sourceIndex: i,
      sourceTimestamp: pt.timestamp,
      timestampUtc: al.timestampUtc,
      tierId: pol.tierId,
      buyRate: rate.buyRate,
      sellRate: rate.sellRate,
      preExportFlow,
      gridChargeBranchSelected:
        gridChargeSelectedInCounterfactual && !anyGeneratorRan,
      gridChargeAcquisitionCostUsd: gridEnergyStoredKwh * rate.buyRate,
      costBasisAfterHomeDispatch,
      allowBatteryExportInInterval,
      exportResult,
      batteryStateAfterExport,
      costBasisStateAfterExport,
    };

    // ------------------------------------------------------------------------
    // Step 13: Grid Boundary Flow Accounting
    // ------------------------------------------------------------------------
    const gridImportForHomeKwh = residualHomeLoadFinalKwh;
    const gridImportForBatteryKwh = gridToBatteryAcKwh;
    const intervalTotalGridImportKwh =
      gridImportForHomeKwh + gridImportForBatteryKwh;

    let solarExportKwh = 0;
    let curtailedSolarKwh = 0;
    let windExportKwh = 0;
    let curtailedWindKwh = 0;

    if (allowRenewableExport) {
      solarExportKwh = remainingSurplusSolar;
      windExportKwh = remainingSurplusWind;
    } else {
      curtailedSolarKwh = remainingSurplusSolar;
      curtailedWindKwh = remainingSurplusWind;
    }

    const renewableExportKwh = solarExportKwh + windExportKwh;
    const curtailedRenewableKwh = curtailedSolarKwh + curtailedWindKwh;
    const generatorExportKwh = intervalGenExportKwh;
    const curtailedGeneratorKwh = intervalGenCurtailedKwh;
    const intervalTotalGridExportKwh =
      renewableExportKwh + batteryExportKwh + generatorExportKwh;

    gridFlowIntervals[i] = {
      sourceIndex: i,
      sourceTimestamp: pt.timestamp,
      timestampUtc: al.timestampUtc,
      tierId: pol.tierId,
      residualHomeLoadKwh: residualHomeLoadFinalKwh,
      gridBatteryChargeKwh: gridToBatteryAcKwh,
      remainingSurplusSolarKwh: remainingSurplusSolar,
      remainingSurplusWindKwh: remainingSurplusWind,
      remainingSurplusRenewableKwh: remainingSurplusRen,
      gridImportForHomeKwh,
      gridImportForBatteryKwh,
      totalGridImportKwh: intervalTotalGridImportKwh,
      solarExportKwh,
      windExportKwh,
      renewableExportKwh,
      curtailedSolarKwh,
      curtailedWindKwh,
      curtailedRenewableKwh,
      generatorExportKwh,
      curtailedGeneratorKwh,
      batteryExportKwh,
      totalGridExportKwh: intervalTotalGridExportKwh,
    };

    // ------------------------------------------------------------------------
    // Step 14: Tariff Cost Accounting
    // ------------------------------------------------------------------------
    const baselineCost = homeLoadKwh * rate.buyRate;
    const gridImportForHomeCost = gridImportForHomeKwh * rate.buyRate;
    const gridImportForBatteryCost = gridImportForBatteryKwh * rate.buyRate;
    const intervalTotalGridImportCost = intervalTotalGridImportKwh * rate.buyRate;

    const solarExportCredit = solarExportKwh * rate.sellRate;
    const windExportCredit = windExportKwh * rate.sellRate;
    const renewableExportCredit = solarExportCredit + windExportCredit;
    const generatorExportCredit = generatorExportKwh * rate.sellRate;
    const batteryExportCredit = batteryExportKwh * rate.sellRate;
    const intervalGridExportCredit =
      renewableExportCredit + batteryExportCredit + generatorExportCredit;

    const simulatedCost = intervalTotalGridImportCost - intervalGridExportCredit;
    const netSavings = baselineCost - simulatedCost;

    tariffCostIntervals[i] = {
      sourceIndex: i,
      sourceTimestamp: pt.timestamp,
      timestampUtc: al.timestampUtc,
      tierId: rate.tierId,
      tierName: rate.tierName,
      seasonName: rate.seasonName,
      localMonth: rate.localMonth,
      buyRate: rate.buyRate,
      sellRate: rate.sellRate,
      homeLoadKwh,
      gridImportForHomeKwh,
      gridImportForBatteryKwh,
      totalGridImportKwh: intervalTotalGridImportKwh,
      solarExportKwh,
      windExportKwh,
      renewableExportKwh,
      generatorExportKwh,
      batteryExportKwh,
      totalGridExportKwh: intervalTotalGridExportKwh,
      baselineCost,
      gridImportForHomeCost,
      gridImportForBatteryCost,
      totalGridImportCost: intervalTotalGridImportCost,
      solarExportCredit,
      windExportCredit,
      renewableExportCredit,
      generatorExportCredit,
      batteryExportCredit,
      gridExportCredit: intervalGridExportCredit,
      simulatedCost,
      netSavings,
    };

    // ------------------------------------------------------------------------
    // Step 15: Aggregate Running Totals
    // ------------------------------------------------------------------------
    totalSolarToBatteryAcKwh += solarToBatteryAcKwh;
    totalWindToBatteryAcKwh += windToBatteryAcKwh;
    totalRenewableToBatteryAcKwh += renewableToBatteryAcKwh;
    totalRenewableEnergyStoredKwh += renEnergyStoredKwh;

    totalBatteryDeliveredToLoadKwh += batteryDeliveredToLoadKwh;
    totalStoredEnergyDrainedKwh += storedEnergyDrainedKwh;

    totalGridToBatteryAcKwh += gridToBatteryAcKwh;
    totalGridEnergyStoredKwh += gridEnergyStoredKwh;

    totalBatteryExportAcKwh += batteryExportKwh;
    totalBatteryExportRevenueUsd += exportResult.exportRevenueUsd;
    totalBatteryExportGrossMarginUsd += exportResult.exportGrossMarginUsd;
    totalGridSocCostRemovedForExportUsd +=
      exportResult.gridSocCostRemovedForExportUsd;

    totalGridImportForHomeKwh += gridImportForHomeKwh;
    totalGridImportForBatteryKwh += gridImportForBatteryKwh;
    totalGridImportKwh += intervalTotalGridImportKwh;

    totalSolarExportKwh += solarExportKwh;
    totalWindExportKwh += windExportKwh;
    totalRenewableExportKwh += renewableExportKwh;
    totalGeneratorExportKwh += generatorExportKwh;
    totalCurtailedSolarKwh += curtailedSolarKwh;
    totalCurtailedWindKwh += curtailedWindKwh;
    totalCurtailedRenewableKwh += curtailedRenewableKwh;
    totalCurtailedGeneratorKwh += curtailedGeneratorKwh;
    totalGridExportKwh += intervalTotalGridExportKwh;

    totalBaselineCost += baselineCost;
    totalGridImportForHomeCost += gridImportForHomeCost;
    totalGridImportForBatteryCost += gridImportForBatteryCost;
    totalGridImportCost += intervalTotalGridImportCost;
    totalSolarExportCredit += solarExportCredit;
    totalWindExportCredit += windExportCredit;
    totalRenewableExportCredit += renewableExportCredit;
    totalGeneratorExportCredit += generatorExportCredit;
    totalBatteryExportCredit += batteryExportCredit;
    totalGridExportCredit += intervalGridExportCredit;
    totalSimulatedCost += simulatedCost;
    totalNetSavings += netSavings;
  }

  // Final grid SOC and final cost-basis energy reconciliation
  const finalGridSoc = currentBatteryState.gridChargedSocKwh;
  const finalCostBasisEnergy = currentCostBasisState.gridStoredEnergyKwh;
  if (Math.abs(finalGridSoc - finalCostBasisEnergy) > 1e-6) {
    throw new Error(
      `Completion invariant violated: final grid SOC (${finalGridSoc} kWh) does not reconcile with final cost-basis energy (${finalCostBasisEnergy} kWh).`
    );
  }

  // Assemble composite result structures
  const exportAwareBatteryFlow: ExportAwareBatteryFlowResult = {
    intervals: exportAwareIntervals,
    initialBatteryState,
    finalBatteryState: currentBatteryState,
    initialCostBasisState,
    finalCostBasisState: currentCostBasisState,
    totalBatteryExportAcKwh,
    totalExportRevenueUsd: totalBatteryExportRevenueUsd,
    totalExportGrossMarginUsd: totalBatteryExportGrossMarginUsd,
    totalGridSocCostRemovedForExportUsd,
    batteryExportAcKwh: totalBatteryExportAcKwh,
    exportRevenueUsd: totalBatteryExportRevenueUsd,
    exportGrossMarginUsd: totalBatteryExportGrossMarginUsd,
    gridSocCostRemovedForExportUsd: totalGridSocCostRemovedForExportUsd,
  };

  const gridFlows: GridFlowResult = {
    intervals: gridFlowIntervals,
    totalGridImportForHomeKwh,
    totalGridImportForBatteryKwh,
    totalGridImportKwh,
    totalSolarExportKwh,
    totalWindExportKwh,
    totalRenewableExportKwh,
    totalGeneratorExportKwh,
    totalCurtailedSolarKwh,
    totalCurtailedWindKwh,
    totalCurtailedRenewableKwh,
    totalCurtailedGeneratorKwh,
    totalBatteryExportKwh: totalBatteryExportAcKwh,
    totalGridExportKwh,
  };

  const tariffCosts: TariffCostResult = {
    intervals: tariffCostIntervals,
    baselineCost: totalBaselineCost,
    gridImportForHomeCost: totalGridImportForHomeCost,
    gridImportForBatteryCost: totalGridImportForBatteryCost,
    totalGridImportCost,
    solarExportCredit: totalSolarExportCredit,
    windExportCredit: totalWindExportCredit,
    renewableExportCredit: totalRenewableExportCredit,
    generatorExportCredit: totalGeneratorExportCredit,
    batteryExportCredit: totalBatteryExportCredit,
    gridExportCredit: totalGridExportCredit,
    totalSolarExportCredit,
    totalWindExportCredit,
    totalRenewableExportCredit,
    totalGeneratorExportCredit,
    totalBatteryExportCredit,
    totalGridExportCredit,
    simulatedCost: totalSimulatedCost,
    netSavings: totalNetSavings,
  };

  // Build per-asset summaries preserving physical fuel unit context
  const generatorAssetSummaries: GeneratorAssetAnnualSummary[] = [];
  let fleetGeneratedKwh = 0;
  let fleetDirectToLoadKwh = 0;
  let fleetToBatteryKwh = 0;
  let fleetExportKwh = 0;
  let fleetCurtailedKwh = 0;
  let fleetRuntimeHours = 0;
  let fleetStarts = 0;
  let fleetFuelCostUsd = 0;
  let fleetVariableMaintenanceCostUsd = 0;
  let fleetOperatingCostUsd = 0;

  for (const asset of generatorAssets) {
    const acc = assetSummaryMap.get(asset.id)!;
    const summary: GeneratorAssetAnnualSummary = {
      assetId: asset.id,
      assetName: asset.name,
      dispatchMode: asset.dispatchMode,
      generatedKwh: acc.generatedKwh,
      directToLoadKwh: acc.directToLoadKwh,
      toBatteryAcKwh: acc.toBatteryAcKwh,
      directExportKwh: acc.directExportKwh,
      curtailedKwh: acc.curtailedKwh,
      runtimeHours: acc.runtimeHours,
      startCount: acc.startCount,
      runningFuelUnits: acc.runningFuelUnits,
      startupFuelUnits: acc.startupFuelUnits,
      totalFuelUnits: acc.totalFuelUnits,
      fuelUnit: asset.fuelUnit,
      fuelType: asset.fuelType,
      customFuelUnitLabel: asset.customFuelUnitLabel,
      fuelCostUsd: acc.fuelCostUsd,
      variableMaintenanceCostUsd: acc.variableMaintenanceCostUsd,
      operatingCostUsd: acc.operatingCostUsd,
    };
    generatorAssetSummaries.push(summary);

    fleetGeneratedKwh += acc.generatedKwh;
    fleetDirectToLoadKwh += acc.directToLoadKwh;
    fleetToBatteryKwh += acc.toBatteryAcKwh;
    fleetExportKwh += acc.directExportKwh;
    fleetCurtailedKwh += acc.curtailedKwh;
    fleetRuntimeHours += acc.runtimeHours;
    fleetStarts += acc.startCount;
    fleetFuelCostUsd += acc.fuelCostUsd;
    fleetVariableMaintenanceCostUsd += acc.variableMaintenanceCostUsd;
    fleetOperatingCostUsd += acc.operatingCostUsd;
  }

  // Solar-only compatibility adapter
  const solarLoadFlow: SolarLoadFlowInterval[] = renewableLoadFlow.map((r) => ({
    sourceIndex: r.sourceIndex,
    sourceTimestamp: r.sourceTimestamp,
    timestampUtc: r.timestampUtc,
    homeLoadKwh: r.homeLoadKwh,
    solarGenerationKwh: r.solarGenerationKwh,
    solarDirectToLoadKwh: r.solarDirectToLoadKwh,
    residualHomeLoadKwh: r.residualHomeLoadKwh,
    surplusSolarKwh: r.surplusSolarKwh,
  }));

  const renewableSummary = summarizeRenewableLoadFlow(renewableLoadFlow);

  // Authoritative operational financial semantics
  const modeledUtilityCostUsd = totalSimulatedCost;
  const utilityElectricitySavingsUsd = totalBaselineCost - modeledUtilityCostUsd;
  const netOperationalSavingsUsd =
    utilityElectricitySavingsUsd - fleetOperatingCostUsd;
  const modeledTotalOperatingEnergyCostUsd =
    modeledUtilityCostUsd + fleetOperatingCostUsd;

  const totalOnsiteGenerationKwh =
    renewableSummary.totalRenewableGenerationKwh + fleetGeneratedKwh;

  return {
    renewableLoadFlow,
    solarLoadFlow,
    exportAwareBatteryFlow,
    gridFlows,
    tariffCosts,
    generatorFleetRecords,
    generatorAssetSummaries,

    totalHomeLoadKwh: renewableSummary.totalHomeLoadKwh,

    totalSolarGenerationKwh: renewableSummary.totalSolarGenerationKwh,
    totalSolarDirectToLoadKwh: renewableSummary.totalSolarDirectToLoadKwh,
    totalSolarToBatteryKwh: totalSolarToBatteryAcKwh,
    totalSolarExportKwh,
    totalSolarCurtailedKwh: totalCurtailedSolarKwh,

    totalWindGenerationKwh: renewableSummary.totalWindGenerationKwh,
    totalWindDirectToLoadKwh: renewableSummary.totalWindDirectToLoadKwh,
    totalWindToBatteryKwh: totalWindToBatteryAcKwh,
    totalWindExportKwh,
    totalWindCurtailedKwh: totalCurtailedWindKwh,

    totalRenewableGenerationKwh: renewableSummary.totalRenewableGenerationKwh,
    totalRenewableDirectToLoadKwh: renewableSummary.totalRenewableDirectToLoadKwh,
    totalRenewableToBatteryKwh: totalRenewableToBatteryAcKwh,
    totalRenewableExportKwh,
    totalRenewableCurtailedKwh: totalCurtailedRenewableKwh,

    generatorGeneratedKwh: fleetGeneratedKwh,
    generatorDirectToLoadKwh: fleetDirectToLoadKwh,
    generatorToBatteryKwh: fleetToBatteryKwh,
    generatorExportKwh: fleetExportKwh,
    generatorCurtailedKwh: fleetCurtailedKwh,

    totalGeneratorGenerationKwh: fleetGeneratedKwh,
    totalGeneratorDirectToLoadKwh: fleetDirectToLoadKwh,
    totalGeneratorToBatteryKwh: fleetToBatteryKwh,
    totalGeneratorExportKwh: fleetExportKwh,
    totalGeneratorCurtailedKwh: fleetCurtailedKwh,

    totalOnsiteGenerationKwh,

    generatorRuntimeHours: fleetRuntimeHours,
    generatorStarts: fleetStarts,

    generatorFuelCostUsd: fleetFuelCostUsd,
    generatorVariableMaintenanceCostUsd: fleetVariableMaintenanceCostUsd,
    generatorOperatingCostUsd: fleetOperatingCostUsd,

    totalGridImportKwh,
    totalBatteryExportKwh: totalBatteryExportAcKwh,
    totalGridExportKwh,

    baselineCost: totalBaselineCost,
    simulatedCost: totalSimulatedCost,
    netSavings: totalNetSavings,

    modeledUtilityCostUsd,
    utilityElectricitySavingsUsd,
    netOperationalSavingsUsd,
    modeledTotalOperatingEnergyCostUsd,
  };
}
