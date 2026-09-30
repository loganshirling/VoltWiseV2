/**
 * Generation Project Cost Aggregation & Analysis Routing State Contracts (Milestone G4A)
 *
 * Provides:
 * 1. Authoritative pure aggregation of enabled generation asset CAPEX and annual O&M.
 * 2. Independent solar asset capacity and degradation metadata preservation for future G4 stages.
 * 3. Pure analysis state derivation distinguishing legacy financial, generation-financial-pending,
 *    and partial-period states.
 * 4. Production financial safety gate rules preventing generation savings from entering the
 *    legacy battery-only calculate15YearFinancials() pipeline.
 */

import {
  AnalysisState,
  BatteryProfile,
  DatasetCompleteness,
  GenerationAsset,
  GenerationAssetCostBreakdown,
  GenerationConfig,
  GenerationFinancialAnalysis,
  GenerationHorizonFinancialSummary,
  GenerationOperationalProjection,
  GenerationOperationalYear,
  GenerationProjectCostSummary,
  GenerationProjectFinancialYear,
  GenerationTypeCostBreakdown,
  GenerationTypeCostMap,
  MacroFinancials,
  SolarAssetMetadata,
  SolarGenerationAsset,
} from '../types/energy';
import { UnifiedSimulationResult } from './simulationRouter';
import { calculateIRR } from './simulationEngine';
import { calculateOpportunityCostBenchmark } from './opportunityCost';

export interface DeriveAnalysisStateParams {
  isSuitableForAnnual?: boolean;
  simulationMode?: 'legacy' | 'generation-aware' | null;
  hasEnabledGeneration?: boolean;
  completeness?: DatasetCompleteness | null;
  unifiedResult?: UnifiedSimulationResult | null;
  hasGenerationFinancials?: boolean;
}

export interface CalculateGenerationAwareFinancialsParams {
  batteryProfile: BatteryProfile;
  operationalProjection: GenerationOperationalProjection | GenerationOperationalYear[];
  projectCosts: GenerationProjectCostSummary;
  financials: MacroFinancials;
}

/**
 * Aggregates CAPEX and annual O&M for all enabled generation assets.
 * Disabled assets contribute zero.
 * Reconciles totals against per-asset and per-type breakdowns exactly.
 * Preserves individual solar array metadata (capacity, inverter size, degradation)
 * without fleet-averaging.
 */
export function aggregateGenerationProjectCosts(
  config?: GenerationConfig | GenerationAsset[] | null
): GenerationProjectCostSummary {
  const assets: GenerationAsset[] = Array.isArray(config)
    ? config
    : Array.isArray(config?.assets)
    ? config.assets
    : [];

  const enabledAssets = assets.filter(
    (asset): asset is GenerationAsset => asset != null && asset.enabled === true
  );

  let rawCapex = 0;
  let rawOm = 0;

  const byAsset: GenerationAssetCostBreakdown[] = [];
  const solarMetadata: SolarAssetMetadata[] = [];

  const typeTotals: Record<
    'solar' | 'wind' | 'generator',
    { installedCostUsd: number; annualMaintenanceCostUsd: number; assetCount: number }
  > = {
    solar: { installedCostUsd: 0, annualMaintenanceCostUsd: 0, assetCount: 0 },
    wind: { installedCostUsd: 0, annualMaintenanceCostUsd: 0, assetCount: 0 },
    generator: { installedCostUsd: 0, annualMaintenanceCostUsd: 0, assetCount: 0 },
  };

  for (const asset of enabledAssets) {
    const capex = Number(asset.installedCostUsd) || 0;
    const om = Number(asset.annualMaintenanceCostUsd) || 0;
    const type = asset.type;

    rawCapex += capex;
    rawOm += om;

    byAsset.push({
      id: asset.id,
      name: asset.name,
      type,
      installedCostUsd: capex,
      annualMaintenanceCostUsd: om,
    });

    if (typeTotals[type]) {
      typeTotals[type].installedCostUsd += capex;
      typeTotals[type].annualMaintenanceCostUsd += om;
      typeTotals[type].assetCount += 1;
    }

    if (type === 'solar') {
      const solarAsset = asset as SolarGenerationAsset;
      solarMetadata.push({
        id: solarAsset.id,
        name: solarAsset.name,
        dcCapacityKw: Number(solarAsset.dcCapacityKw) || 0,
        inverterAcCapacityKw: Number(solarAsset.inverterAcCapacityKw) || 0,
        annualDegradationPercent: Number(solarAsset.annualDegradationPercent) || 0,
        tiltDegrees: solarAsset.tiltDegrees,
        azimuthDegrees: solarAsset.azimuthDegrees,
        installedCostUsd: capex,
        annualMaintenanceCostUsd: om,
      });
    }
  }

  const generationCapexUsd = Math.round(rawCapex * 100) / 100;
  const annualGenerationMaintenanceUsd = Math.round(rawOm * 100) / 100;

  const solarBreakdown: GenerationTypeCostBreakdown = {
    type: 'solar',
    installedCostUsd: Math.round(typeTotals.solar.installedCostUsd * 100) / 100,
    annualMaintenanceCostUsd: Math.round(typeTotals.solar.annualMaintenanceCostUsd * 100) / 100,
    assetCount: typeTotals.solar.assetCount,
  };

  const windBreakdown: GenerationTypeCostBreakdown = {
    type: 'wind',
    installedCostUsd: Math.round(typeTotals.wind.installedCostUsd * 100) / 100,
    annualMaintenanceCostUsd: Math.round(typeTotals.wind.annualMaintenanceCostUsd * 100) / 100,
    assetCount: typeTotals.wind.assetCount,
  };

  const generatorBreakdown: GenerationTypeCostBreakdown = {
    type: 'generator',
    installedCostUsd: Math.round(typeTotals.generator.installedCostUsd * 100) / 100,
    annualMaintenanceCostUsd: Math.round(typeTotals.generator.annualMaintenanceCostUsd * 100) / 100,
    assetCount: typeTotals.generator.assetCount,
  };

  const byTypeArray = [
    solarBreakdown,
    windBreakdown,
    generatorBreakdown,
  ] as GenerationTypeCostBreakdown[] & GenerationTypeCostMap;

  byTypeArray.solar = solarBreakdown;
  byTypeArray.wind = windBreakdown;
  byTypeArray.generator = generatorBreakdown;

  return {
    generationCapexUsd,
    annualGenerationMaintenanceUsd,
    byAsset,
    byType: byTypeArray,
    solarMetadata,
  };
}

/** Alias for aggregateGenerationProjectCosts */
export const calculateGenerationProjectCosts = aggregateGenerationProjectCosts;

/**
 * Derives the explicit financial analysis state from dataset suitability and simulation mode.
 * - 'partial-period': Incomplete dataset unsuitable for annual projection.
 * - 'legacy-financial': Full-year dataset with no enabled generation (exact legacy financial path).
 * - 'generation-financial-pending': Full-year dataset with generation-aware simulation active;
 *   lifecycle financials are pending G4C.
 * - 'generation-financial': Reserved for future G4C implementation.
 */
export function deriveAnalysisState(
  isSuitableForAnnualOrParams: boolean | DeriveAnalysisStateParams,
  simulationMode?: 'legacy' | 'generation-aware' | null,
  hasGenerationFinancials?: boolean
): AnalysisState {
  if (typeof isSuitableForAnnualOrParams === 'object' && isSuitableForAnnualOrParams !== null) {
    const params = isSuitableForAnnualOrParams;
    const isSuitable =
      params.completeness != null
        ? Boolean(params.completeness.isSuitableForAnnualProjection)
        : (params.isSuitableForAnnual ?? true);

    if (!isSuitable) {
      return 'partial-period';
    }

    const mode =
      params.simulationMode ??
      params.unifiedResult?.mode ??
      (params.hasEnabledGeneration ? 'generation-aware' : 'legacy');

    if (mode === 'generation-aware') {
      if (params.hasGenerationFinancials) {
        return 'generation-financial';
      }
      return 'generation-financial-pending';
    }
    return 'legacy-financial';
  }

  const isSuitable = Boolean(isSuitableForAnnualOrParams);
  if (!isSuitable) {
    return 'partial-period';
  }
  if (simulationMode === 'generation-aware') {
    if (hasGenerationFinancials) {
      return 'generation-financial';
    }
    return 'generation-financial-pending';
  }
  return 'legacy-financial';
}

/**
 * Production financial safety gate:
 * Determines whether a simulation summary may be passed into calculate15YearFinancials().
 *
 * calculate15YearFinancials() must ONLY be invoked for:
 * - Full-year datasets (isSuitableForAnnual === true)
 * - In legacy simulation mode (no enabled generation assets)
 *
 * Returns false for generation-aware results and partial-period datasets.
 */
export function shouldCalculateLegacyFinancials(
  isSuitableForAnnual: boolean,
  simulationMode?: 'legacy' | 'generation-aware' | null
): boolean {
  return Boolean(isSuitableForAnnual) && simulationMode === 'legacy';
}

/**
 * Authoritative lifecycle financial engine for battery + supported solar generation projects (Milestone G4C).
 *
 * Consumes:
 * 1. G4A authoritative project costs (GenerationProjectCostSummary)
 * 2. G4B authoritative multi-year operational projection (GenerationOperationalProjection)
 *
 * Rules:
 * - Pure function.
 * - Does not rerun simulation or modify operational projection values.
 * - G4B electricity savings are authoritative and never scaled by inflation or degradation again.
 * - Project CAPEX includes battery installed cost + enabled generation CAPEX exactly once.
 * - Immediate rebate reduces the upfront project basis.
 * - Deferred federal tax credit is calculated on gross project CAPEX and realized as a cash inflow.
 * - Debt service uses amortized financing on the net upfront basis.
 * - Generation O&M is deducted once per projected year as constant nominal expense.
 * - Net project cash flow feeds cumulative cash flow, simple payback, NPV, IRR, and lifecycle profit.
 * - Opportunity cost benchmark accounts for generation O&M in addition to upfront/debt/replacement.
 */
export function calculateGenerationAwareFinancials(
  params: CalculateGenerationAwareFinancialsParams
): GenerationFinancialAnalysis {
  if (!params || typeof params !== 'object') {
    throw new Error('Simulation parameters must be provided as an object.');
  }

  const { batteryProfile, operationalProjection, projectCosts, financials } = params;

  if (!batteryProfile || typeof batteryProfile !== 'object') {
    throw new Error('A valid BatteryProfile must be provided.');
  }
  if (!Number.isFinite(batteryProfile.installedCost) || batteryProfile.installedCost < 0) {
    throw new Error('Battery installed cost must be a finite, non-negative number.');
  }

  if (!projectCosts || typeof projectCosts !== 'object') {
    throw new Error('A valid GenerationProjectCostSummary must be provided.');
  }
  if (!Number.isFinite(projectCosts.generationCapexUsd) || projectCosts.generationCapexUsd < 0) {
    throw new Error('Generation CAPEX must be a finite, non-negative number.');
  }
  if (
    !Number.isFinite(projectCosts.annualGenerationMaintenanceUsd) ||
    projectCosts.annualGenerationMaintenanceUsd < 0
  ) {
    throw new Error('Annual generation maintenance must be a finite, non-negative number.');
  }

  if (!financials || typeof financials !== 'object') {
    throw new Error('Valid MacroFinancials must be provided.');
  }

  if (!operationalProjection || typeof operationalProjection !== 'object') {
    throw new Error('A valid GenerationOperationalProjection must be provided.');
  }

  const years: GenerationOperationalYear[] = Array.isArray(operationalProjection)
    ? (operationalProjection as unknown as GenerationOperationalProjection).years ?? operationalProjection
    : operationalProjection.years;

  if (!Array.isArray(years) || years.length === 0) {
    throw new Error('Operational projection must contain at least one projected year.');
  }

  const horizonYears =
    ('horizonYears' in operationalProjection && typeof operationalProjection.horizonYears === 'number'
      ? operationalProjection.horizonYears
      : undefined) ?? years.length;
  if (!Number.isInteger(horizonYears) || horizonYears < 1 || horizonYears > 25) {
    throw new Error(
      `Projection horizon must be an integer between 1 and 25 years. Received: ${horizonYears}`
    );
  }

  if (years.length !== horizonYears) {
    throw new Error(
      `Operational projection years length (${years.length}) does not match horizon (${horizonYears}).`
    );
  }

  // Validate contiguous chronological years and finite values
  for (let i = 0; i < years.length; i++) {
    const y = years[i];
    if (!y || typeof y !== 'object') {
      throw new Error(`Operational projection missing data for year index ${i}.`);
    }
    if (y.year !== i + 1) {
      throw new Error(
        `Operational projection years must be contiguous and 1-indexed. Expected year ${i + 1}, found ${y.year}.`
      );
    }
    if (
      !Number.isFinite(y.electricitySavingsUsd) ||
      !Number.isFinite(y.baselineElectricityCostUsd) ||
      !Number.isFinite(y.simulatedElectricityCostUsd)
    ) {
      throw new Error(
        `Operational projection year ${y.year} contains invalid or non-finite electricity cost/savings values.`
      );
    }
  }

  // 1. Combined project CAPEX
  const batteryCapexUsd = Math.round(batteryProfile.installedCost * 100) / 100;
  const generationCapexUsd = Math.round(projectCosts.generationCapexUsd * 100) / 100;
  const grossProjectCapexUsd = Math.round((batteryCapexUsd + generationCapexUsd) * 100) / 100;

  // 2. Incentive semantics
  const flatRebate = Math.max(0, financials.localRebateFlat ?? 0);
  const immediateRebateUsd = Math.round(Math.min(grossProjectCapexUsd, flatRebate) * 100) / 100;
  const upfrontProjectBasis = Math.max(
    0,
    Math.round((grossProjectCapexUsd - immediateRebateUsd) * 100) / 100
  );

  const taxCreditPercent = Math.max(0, financials.federalTaxCreditPercent ?? 0);
  const deferredFederalTaxCreditUsd =
    Math.round((grossProjectCapexUsd * (taxCreditPercent / 100)) * 100) / 100;
  const taxCreditRealizationYear = Math.max(1, financials.federalTaxCreditRealizationYear ?? 1);

  const incentivesAmountUsd =
    Math.round(
      Math.min(grossProjectCapexUsd, immediateRebateUsd + deferredFederalTaxCreditUsd) * 100
    ) / 100;
  const netInstalledProjectCostUsd =
    Math.max(0, Math.round((grossProjectCapexUsd - incentivesAmountUsd) * 100) / 100);

  // 3. Financing basis
  const isFinanced = Boolean(financials.isFinanced);
  let loanPrincipalUsd = 0;
  let monthlyLoanPaymentUsd = 0;
  let upfrontOutOfPocketUsd = upfrontProjectBasis;
  let totalLoanPaymentsUsd = 0;
  let totalLoanInterestUsd = 0;

  if (isFinanced) {
    const downPaymentPercent = financials.loanDownPaymentPercent ?? 0;
    const downPaymentRatio = Math.max(0, Math.min(1.0, downPaymentPercent / 100));
    const downPaymentAmount = Math.round((upfrontProjectBasis * downPaymentRatio) * 100) / 100;
    loanPrincipalUsd = Math.round(Math.max(0, upfrontProjectBasis - downPaymentAmount) * 100) / 100;
    upfrontOutOfPocketUsd = downPaymentAmount;

    const apr = Math.max(0, financials.loanAprPercent ?? 0);
    const monthlyRate = apr / 100 / 12;
    const numMonths = Math.max(12, Math.round((financials.loanTermYears ?? 1) * 12));

    if (loanPrincipalUsd > 0) {
      if (monthlyRate > 0) {
        monthlyLoanPaymentUsd =
          (loanPrincipalUsd * (monthlyRate * Math.pow(1 + monthlyRate, numMonths))) /
          (Math.pow(1 + monthlyRate, numMonths) - 1);
      } else {
        monthlyLoanPaymentUsd = loanPrincipalUsd / numMonths;
      }
      monthlyLoanPaymentUsd = Math.round(monthlyLoanPaymentUsd * 100) / 100;
      totalLoanPaymentsUsd = Math.round((monthlyLoanPaymentUsd * numMonths) * 100) / 100;
      totalLoanInterestUsd = Math.round(Math.max(0, totalLoanPaymentsUsd - loanPrincipalUsd) * 100) / 100;
    }
  }

  // 4. Annual generation O&M (constant nominal annual expense)
  const annualGenerationMaintenanceUsd =
    Math.round(projectCosts.annualGenerationMaintenanceUsd * 100) / 100;

  // 5. Replacement expense
  const replacementEnabled = Boolean(financials.replacementEnabled);
  const replacementCost = replacementEnabled ? Math.max(0, financials.replacementCost ?? 0) : 0;
  const replacementYear = replacementEnabled ? Math.max(1, financials.replacementYear ?? 0) : 0;

  // 6. Opportunity cost benchmark
  const discountRate = (financials.discountRatePercent ?? 5.0) / 100;
  const opportunityRate = financials.opportunityCostRatePercent ?? 4.5;
  const additionalContributions = Array.from(
    { length: horizonYears },
    () => annualGenerationMaintenanceUsd
  );

  const opportunityBenchmark = calculateOpportunityCostBenchmark({
    horizonYears,
    annualRatePercent: opportunityRate,
    upfrontContribution: upfrontOutOfPocketUsd,
    monthlyLoanPayment: monthlyLoanPaymentUsd,
    loanTermYears: isFinanced ? (financials.loanTermYears ?? 0) : 0,
    replacementEnabled,
    replacementCost,
    replacementYear,
    additionalAnnualContributions: additionalContributions,
  });

  // 7. Multi-Year Cash Flow Projection
  const projections: GenerationProjectFinancialYear[] = [];
  const cashFlowsForIrr: number[] = [-upfrontOutOfPocketUsd];

  let cumulativeCashFlow = -upfrontOutOfPocketUsd;
  let cumulativeNpv = -upfrontOutOfPocketUsd;
  let paybackYears: number | null = upfrontOutOfPocketUsd === 0 ? 0 : null;

  let totalLoanPaymentsInHorizon = 0;
  let totalReplacementInHorizon = 0;
  let totalMaintenanceInHorizon = 0;

  for (let y = 1; y <= horizonYears; y++) {
    const yearData = years[y - 1];

    // G4B electricity savings are authoritative
    const electricitySavingsUsd = yearData.electricitySavingsUsd;
    const modeledProjectElectricityCostUsd = yearData.simulatedElectricityCostUsd;
    const baselineElectricityCostUsd = yearData.baselineElectricityCostUsd;

    const generationMaintenanceUsd = annualGenerationMaintenanceUsd;
    totalMaintenanceInHorizon += generationMaintenanceUsd;

    const replacementExpenseUsd =
      replacementEnabled && y === replacementYear ? replacementCost : 0;
    totalReplacementInHorizon += replacementExpenseUsd;

    const annualLoanPaymentUsd =
      isFinanced && y <= (financials.loanTermYears ?? 0)
        ? Math.round(monthlyLoanPaymentUsd * 12 * 100) / 100
        : 0;
    totalLoanPaymentsInHorizon += annualLoanPaymentUsd;

    const taxCreditInflowUsd =
      y === taxCreditRealizationYear ? deferredFederalTaxCreditUsd : 0;

    const netProjectCashFlowUsd = Math.round(
      (electricitySavingsUsd -
        generationMaintenanceUsd -
        replacementExpenseUsd -
        annualLoanPaymentUsd +
        taxCreditInflowUsd) * 100
    ) / 100;

    cashFlowsForIrr.push(netProjectCashFlowUsd);

    const prevCumulative = cumulativeCashFlow;
    cumulativeCashFlow = Math.round((cumulativeCashFlow + netProjectCashFlowUsd) * 100) / 100;

    // Simple payback interpolation
    if (paybackYears === null && prevCumulative < 0 && cumulativeCashFlow >= 0) {
      const deficit = -prevCumulative;
      const fraction = netProjectCashFlowUsd > 0 ? deficit / netProjectCashFlowUsd : 1;
      paybackYears = (y - 1) + fraction;
    }

    const rawDiscounted = netProjectCashFlowUsd / Math.pow(1 + discountRate, y);
    cumulativeNpv += rawDiscounted;
    const discountedCashFlowUsd = Math.round(rawDiscounted * 100) / 100;
    const cumulativeNpvUsd = Math.round(cumulativeNpv * 100) / 100;

    const opportunityCostValueUsd =
      opportunityBenchmark.yearly[y - 1]?.futureValue ?? upfrontOutOfPocketUsd;

    projections.push({
      year: y,
      baselineElectricityCostUsd,
      modeledProjectElectricityCostUsd,
      electricitySavingsUsd,
      generationMaintenanceUsd,
      replacementExpenseUsd,
      annualLoanPaymentUsd,
      taxCreditInflowUsd,
      netProjectCashFlowUsd,
      cumulativeCashFlowUsd: cumulativeCashFlow,
      discountedCashFlowUsd,
      cumulativeNpvUsd,
      opportunityCostValueUsd,
      batteryCapacityRetentionFactor: yearData.batteryCapacityRetentionFactor,
      batteryUsableCapacityKwh: yearData.batteryUsableCapacityKwh,
      equivalentFullCycles: yearData.equivalentFullCycles,
      solarGeneratedKwh: yearData.solarGeneratedKwh,
    });
  }

  // 8. Lifecycle Metrics
  const lifetimeNetProfitUsd = cumulativeCashFlow;
  const npvUsd = Math.round(cumulativeNpv * 100) / 100;
  const irrPercent = calculateIRR(cashFlowsForIrr);

  let paybackFormatted = `Over ${horizonYears} Years`;
  if (paybackYears !== null) {
    const fullYears = Math.floor(paybackYears);
    const months = Math.round((paybackYears - fullYears) * 12);
    if (months === 12) {
      paybackFormatted = `${fullYears + 1} yrs`;
    } else if (months === 0) {
      paybackFormatted = `${fullYears} yrs`;
    } else {
      paybackFormatted = `${fullYears} yrs ${months} mos`;
    }
  }
  const finalPaybackYears = paybackYears !== null ? Math.round(paybackYears * 10) / 10 : null;

  // 9. ROI (Documented total project cash outlay denominator)
  const totalProjectCashOutlaysUsd = Math.round(
    (upfrontOutOfPocketUsd +
      totalLoanPaymentsInHorizon +
      totalReplacementInHorizon +
      totalMaintenanceInHorizon) * 100
  ) / 100;

  const lifetimeRoiPercent =
    totalProjectCashOutlaysUsd > 0
      ? Math.round(((lifetimeNetProfitUsd / totalProjectCashOutlaysUsd) * 100) * 10) / 10
      : 0;

  // 10. Opportunity Cost Summary
  let opportunityCostVehicleName = `High-Yield Savings Account (${opportunityRate}% APY)`;
  if (financials.opportunityCostVehicle === 'index_fund') {
    opportunityCostVehicleName = 'S&P 500 Index Fund (7.0% Return)';
  } else if (financials.opportunityCostVehicle === 'custom') {
    opportunityCostVehicleName = `Custom Asset (${opportunityRate}%)`;
  }

  const opportunityCostFutureValueUsd = Math.round(opportunityBenchmark.futureValue * 100) / 100;
  const opportunityCostProfitUsd = Math.round(opportunityBenchmark.profit * 100) / 100;
  const opportunityCostDiffUsd =
    Math.round((lifetimeNetProfitUsd - opportunityCostProfitUsd) * 100) / 100;
  const projectOutperformsAlternative = lifetimeNetProfitUsd >= opportunityCostProfitUsd;

  // 11. Companion VOLL / Resilience Metrics
  const annualVollValue = Math.max(
    0,
    (financials.annualOutageDays ?? 0) * (financials.valueOfLostLoadPerDay ?? 0)
  );
  const lifetimeResilienceValueUsd = Math.round(annualVollValue * horizonYears * 100) / 100;
  let discountedResilienceTotal = 0;
  for (let y = 1; y <= horizonYears; y++) {
    discountedResilienceTotal += annualVollValue / Math.pow(1 + discountRate, y);
  }
  const npvWithVollUsd =
    Math.round((npvUsd + (financials.includeVollInRoi ? discountedResilienceTotal : 0)) * 100) / 100;
  const lifetimeNetProfitWithVollUsd =
    Math.round((lifetimeNetProfitUsd + lifetimeResilienceValueUsd) * 100) / 100;
  const lifetimeRoiWithVollPercent =
    totalProjectCashOutlaysUsd > 0
      ? Math.round(((lifetimeNetProfitWithVollUsd / totalProjectCashOutlaysUsd) * 100) * 10) / 10
      : 0;

  return {
    batteryProfile,
    operationalProjection: {
      horizonYears,
      years,
    },
    projectCosts,
    horizonYears,
    batteryCapexUsd,
    generationCapexUsd,
    grossProjectCapexUsd,
    immediateRebateUsd,
    deferredFederalTaxCreditUsd,
    incentivesAmountUsd,
    netInstalledProjectCostUsd,
    upfrontOutOfPocketUsd,
    isFinanced,
    loanPrincipalUsd,
    monthlyLoanPaymentUsd,
    totalLoanPaymentsUsd,
    totalLoanInterestUsd,
    annualGenerationMaintenanceUsd,
    year1ElectricitySavingsUsd: projections[0]?.electricitySavingsUsd ?? 0,
    year1NetProjectCashFlowUsd: projections[0]?.netProjectCashFlowUsd ?? 0,
    paybackYears: finalPaybackYears,
    paybackFormatted,
    npvUsd,
    irrPercent,
    lifetimeNetProfitUsd,
    lifetimeRoiPercent,
    totalProjectCashOutlaysUsd,
    opportunityCostVehicleName,
    opportunityCostRatePercent: opportunityRate,
    opportunityCostFutureValueUsd,
    opportunityCostProfitUsd,
    opportunityCostDiffUsd,
    projectOutperformsAlternative,
    projections,
    annualResilienceValueUsd: Math.round(annualVollValue * 100) / 100,
    lifetimeResilienceValueUsd,
    npvWithVollUsd,
    lifetimeNetProfitWithVollUsd,
    lifetimeRoiWithVollPercent,
  };
}

/** Alias for calculateGenerationAwareFinancials */
export const calculateGenerationFinancials = calculateGenerationAwareFinancials;

/**
 * Derives selected-horizon financial metrics from an existing GenerationFinancialAnalysis.
 * Pure accessor / rollup helper; does not re-simulate or re-run financial iteration.
 */
export function deriveGenerationHorizonFinancialSummary(
  analysis: GenerationFinancialAnalysis,
  horizonYears: number
): GenerationHorizonFinancialSummary {
  if (!analysis || typeof analysis !== 'object' || !Array.isArray(analysis.projections)) {
    throw new Error('Valid GenerationFinancialAnalysis must be provided.');
  }

  const safeHorizon = Math.max(1, Math.min(analysis.projections.length, Math.round(horizonYears || 0)));
  const horizonProjections = analysis.projections.slice(0, safeHorizon);
  const lastProj = horizonProjections[safeHorizon - 1];

  const cumulativeElectricitySavings = Math.round(
    horizonProjections.reduce((sum, p) => sum + p.electricitySavingsUsd, 0) * 100
  ) / 100;
  const totalGenerationMaintenance = Math.round(
    horizonProjections.reduce((sum, p) => sum + p.generationMaintenanceUsd, 0) * 100
  ) / 100;
  const totalReplacementExpense = Math.round(
    horizonProjections.reduce((sum, p) => sum + p.replacementExpenseUsd, 0) * 100
  ) / 100;
  const totalLoanPayments = Math.round(
    horizonProjections.reduce((sum, p) => sum + p.annualLoanPaymentUsd, 0) * 100
  ) / 100;
  const taxCreditInflows = Math.round(
    horizonProjections.reduce((sum, p) => sum + p.taxCreditInflowUsd, 0) * 100
  ) / 100;

  const cumulativeCashFlow = lastProj
    ? lastProj.cumulativeCashFlowUsd
    : -analysis.upfrontOutOfPocketUsd;
  const netPresentValue = lastProj ? lastProj.cumulativeNpvUsd : analysis.npvUsd;

  const simplePaybackYears =
    analysis.paybackYears !== null && analysis.paybackYears <= safeHorizon
      ? analysis.paybackYears
      : null;

  let discountedPaybackYears: number | null = null;
  for (let i = 0; i < horizonProjections.length; i++) {
    const p = horizonProjections[i];
    if (p.cumulativeNpvUsd >= 0) {
      if (i === 0) {
        discountedPaybackYears = 1.0;
      } else {
        const prev = horizonProjections[i - 1];
        const denom = p.cumulativeNpvUsd - prev.cumulativeNpvUsd;
        const fraction = denom !== 0 ? (0 - prev.cumulativeNpvUsd) / denom : 0;
        discountedPaybackYears = Math.round((prev.year + fraction) * 10) / 10;
      }
      break;
    }
  }

  const totalCapitalOutlay = Math.round(
    (analysis.upfrontOutOfPocketUsd +
      totalLoanPayments +
      totalReplacementExpense +
      totalGenerationMaintenance) * 100
  ) / 100;

  const horizonRoiPercent =
    totalCapitalOutlay > 0
      ? Math.round(((cumulativeCashFlow / totalCapitalOutlay) * 100) * 10) / 10
      : 0;

  const opportunityCostFutureValue = lastProj
    ? Math.round(lastProj.opportunityCostValueUsd * 100) / 100
    : analysis.upfrontOutOfPocketUsd;
  const opportunityCostProfit = Math.round((opportunityCostFutureValue - totalCapitalOutlay) * 100) / 100;
  const opportunityCostDiff = Math.round((cumulativeCashFlow - opportunityCostProfit) * 100) / 100;

  return {
    horizonYears: safeHorizon,
    cumulativeCashFlow,
    netPresentValue,
    cumulativeElectricitySavings,
    totalGenerationMaintenance,
    totalReplacementExpense,
    totalLoanPayments,
    taxCreditInflows,
    simplePaybackYears,
    discountedPaybackYears,
    horizonRoiPercent,
    totalProjectCashOutlays: totalCapitalOutlay,
    opportunityCostFutureValue,
    opportunityCostProfit,
    opportunityCostDiff,
  };
}

/** Alias matching prompt specifications */
export const deriveHorizonGenerationFinancialSummary = deriveGenerationHorizonFinancialSummary;
