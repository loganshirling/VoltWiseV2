/**
 * LLM JSON Export Builder & Validator for VoltWise
 * Ensures strict consistency between selected projection horizon and exported KPIs.
 */
import {
  AnalysisState,
  BatteryProfile,
  CsvValidationResult,
  GenerationConfig,
  GenerationFinancialAnalysis,
  GenerationOperationalProjection,
  GenerationProjectCostSummary,
  MacroFinancials,
  ProfileFinancialAnalysis,
  RateTier,
  SolarGenerationAsset,
  TouProfile,
  WindGenerationAsset,
  YearProjection,
} from '../types/energy';
import { APP_VERSION } from '../version';
import { deriveHorizonFinancialSummary } from './simulationEngine';
import { deriveGenerationOperationalDisplayMetrics } from './generationResults';
import { deriveGenerationHorizonFinancialSummary } from './generationFinancials';
import { GenerationAwareSimulationResult } from './generationAwareSimulation';

export interface ExportLlmJsonParams {
  activeAnalysis: ProfileFinancialAnalysis;
  projectionHorizon: number;
  tiers: RateTier[];
  activeTouProfile?: TouProfile;
  financials: MacroFinancials;
  csvResult?: CsvValidationResult | null;
}

export interface LlmExportPayload {
  metadata: {
    app_name: string;
    app_version: string;
    export_timestamp: string;
    selected_horizon_years: number;
    currency: string;
    dataset_summary: {
      start_date: string;
      end_date: string;
      total_intervals: number;
      interval_duration_hours: number;
      duration_days: number;
      total_home_load_kwh: number;
      is_suitable_for_annual_projection: boolean;
      completeness_reason: string | null;
    };
  };
  battery_configuration: {
    profile_name: string;
    model: string;
    total_capacity_kwh: number;
    usable_dod_pct: number;
    usable_capacity_kwh: number;
    max_continuous_discharge_kw: number;
    max_continuous_charge_kw: number;
    round_trip_efficiency_pct: number;
    rated_cycle_life: number;
    dispatch_strategy: string;
    charge_tiers: string[];
    discharge_tiers: string[];
    allow_grid_export: boolean;
    installed_cost_usd: number;
  };
  tariff_configuration: {
    profile_name: string;
    utility: string;
    description: string;
    rate_tiers: Array<{
      id: string;
      name: string;
      buy_rate_usd_per_kwh: number;
      sell_rate_usd_per_kwh: number;
      color: string;
    }>;
    seasons: Array<{
      id: string;
      name: string;
      months: number[];
      tier_rates: Record<string, { buyRate: number; sellRate: number }>;
    }>;
    schedule_matrix: string[][];
  };
  financial_assumptions: {
    cost_and_incentives: {
      gross_installed_cost_usd: number;
      immediate_rebates_usd: number;
      upfront_cost_after_immediate_rebates_usd: number;
      cash_due_at_purchase_usd: number;

      federal_tax_credit_pct: number;
      deferred_federal_tax_credit_usd: number;
      federal_tax_credit_realization_year: number;

      net_cost_after_all_incentives_usd: number;
    };
    annual_electricity_inflation_rate_pct: number;
    annual_battery_degradation_rate_pct: number;
    discount_rate_pct: number;
    financing: {
      is_financed: boolean;
      loan_apr_pct: number;
      loan_term_years: number;
      down_payment_pct: number;
      loan_principal_usd: number;
      monthly_loan_payment_usd: number;
      down_payment_usd: number | null;
      total_loan_interest_usd: number | null;
    };
    opportunity_cost: {
      vehicle_name: string;
      benchmark_rate_pct: number;
      horizon_future_value_usd: number;
      horizon_opportunity_profit_usd: number;
    };
    replacement: {
      replacement_enabled: boolean;
      replacement_cost_usd: number | null;
      replacement_year: number | null;
    };
    resilience: {
      critical_home_load_kw: number;
      annual_outage_days: number;
      value_of_lost_load_usd_per_day: number;
      include_voll_in_roi: boolean;
    };
  };
  year_1_results: {
    baseline_electricity_cost_usd: number;
    with_battery_electricity_cost_usd: number;
    net_savings_usd: number;
    savings_percentage: number;
    total_grid_import_kwh: number;
    total_grid_export_kwh: number;
    battery_discharged_energy_kwh: number;
    equivalent_full_cycles: number;
    peak_demand_kw: number;
  };
  horizon_summary_kpis: {
    horizon_years: number;
    horizon_net_present_value_usd: number;
    horizon_cumulative_net_cash_flow_usd: number;
    horizon_cumulative_savings_usd: number;
    horizon_replacement_expenses_usd: number;
    discounted_payback_years: number | null;
    simple_payback_years: number | null;
    end_of_horizon_soh_pct: number;
    end_of_horizon_usable_capacity_kwh: number;
    horizon_cumulative_cycles: number;
    warranted_cycle_limit: number;
    warranty_cycles_exhausted_within_horizon: boolean;
    cycle_warranty_exhaustion_year: number | null;
    levelized_cost_of_storage_usd_per_kwh: number;
    outage_backup_autonomy_hours: number;
    outage_backup_autonomy_days: number;
    net_monthly_cash_flow_year1_usd: number;
  };
  annual_time_series: Array<{
    year: number;
    baseline_electricity_spend_usd: number;
    with_battery_electricity_spend_usd: number;
    annual_net_savings_usd: number;
    cumulative_net_cash_flow_usd: number;
    cumulative_npv_usd: number;
    battery_state_of_health_pct: number;
    usable_capacity_kwh: number;
    annual_cycles: number;
    cumulative_cycles: number;
    replacement_expense_usd: number;
    tax_credit_inflow_usd: number;
    annual_loan_payment_usd: number;
  }>;
}

export function buildExportLlmJson(params: ExportLlmJsonParams): LlmExportPayload {
  const {
    activeAnalysis,
    projectionHorizon,
    tiers,
    activeTouProfile,
    financials,
    csvResult,
  } = params;

  if (csvResult?.completeness && !csvResult.completeness.isSuitableForAnnualProjection) {
    throw new Error('Cannot export multi-year financial projections for an incomplete or partial-period dataset.');
  }

  const {
    profile,
    annualSummary,
    netInstalledCost,
    upfrontOutOfPocket,
    isFinanced,
    loanPrincipal,
    monthlyLoanPayment,
    netMonthlyCashFlow,
    lcosPerKwh,
    outageAutonomyHours,
    outageAutonomyDays,
    criticalLoadPowerKw,
    projections,
    replacementEnabled: analysisReplacementEnabled,
    replacementCostTotal,
    replacementYear: analysisReplacementYear,
    opportunityCostRate,
    opportunityCostVehicleName,
  } = activeAnalysis;

  // Replacement settings: explicit handling of replacementEnabled
  const replacementEnabled = financials.replacementEnabled ?? analysisReplacementEnabled ?? true;
  const replacementCost = replacementEnabled
    ? (financials.replacementCost ?? replacementCostTotal ?? 0)
    : null;
  const replacementYear = replacementEnabled
    ? (financials.replacementYear ?? analysisReplacementYear ?? 0)
    : null;

  // Cost and incentives calculations
  const immediateRebates = Math.min(
    activeAnalysis.grossCost,
    Math.max(0, financials.localRebateFlat)
  );

  const upfrontCostAfterImmediateRebates = Math.max(
    0,
    activeAnalysis.grossCost - immediateRebates
  );

  const deferredFederalTaxCredit = (activeAnalysis.projections || []).reduce(
    (sum, p) => sum + (p.taxCreditInflow ?? 0),
    0
  );

  // Horizon-specific projections slicing & authoritative summary
  const safeHorizon = Math.max(1, Math.min(25, projectionHorizon));
  const horizonProjections: YearProjection[] = (projections || []).slice(0, safeHorizon);
  const horizonSummary = deriveHorizonFinancialSummary(activeAnalysis, safeHorizon);

  // Annual time series up to selected horizon
  const annualTimeSeries = horizonProjections.map((p) => ({
    year: p.year,
    baseline_electricity_spend_usd: Math.round(p.baselineCost * 100) / 100,
    with_battery_electricity_spend_usd: Math.round(p.withBatteryCost * 100) / 100,
    annual_net_savings_usd: Math.round(p.annualSavings * 100) / 100,
    cumulative_net_cash_flow_usd: Math.round(p.cumulativeCashFlow * 100) / 100,
    cumulative_npv_usd: Math.round(p.cumulativeNpv * 100) / 100,
    battery_state_of_health_pct: Math.round(p.sohPercent * 10) / 10,
    usable_capacity_kwh: Math.round(p.usableCapacityKwh * 10) / 10,
    annual_cycles: Math.round(p.cyclesThisYear),
    cumulative_cycles: Math.round(p.cumulativeCycles),
    replacement_expense_usd: Math.round(p.replacementExpense * 100) / 100,
    tax_credit_inflow_usd: Math.round((p.taxCreditInflow ?? 0) * 100) / 100,
    annual_loan_payment_usd: Math.round(p.annualLoanPayment * 100) / 100,
  }));

  const usableDod = profile.usableDodPercent;
  const usableCapacity = Math.round(profile.totalCapacityKwh * (usableDod / 100) * 100) / 100;

  const completeness = csvResult?.completeness;

  return {
    metadata: {
      app_name: 'VoltWise',
      app_version: APP_VERSION,
      export_timestamp: new Date().toISOString(),
      selected_horizon_years: safeHorizon,
      currency: 'USD',
      dataset_summary: {
        start_date: completeness?.startDate || csvResult?.startDate || '',
        end_date: completeness?.endDate || csvResult?.endDate || '',
        total_intervals: completeness?.intervalCount || annualSummary.totalIntervals,
        interval_duration_hours: completeness?.intervalDurationHours || annualSummary.intervalHours,
        duration_days: completeness?.durationDays || Math.round(annualSummary.totalIntervals / 24),
        total_home_load_kwh: annualSummary.totalHomeLoadKwh,
        is_suitable_for_annual_projection: completeness?.isSuitableForAnnualProjection ?? true,
        completeness_reason: completeness?.reason ?? null,
      },
    },
    battery_configuration: {
      profile_name: profile.name,
      model: profile.model,
      total_capacity_kwh: profile.totalCapacityKwh,
      usable_dod_pct: usableDod,
      usable_capacity_kwh: usableCapacity,
      max_continuous_discharge_kw: profile.maxContinuousOutputKw,
      max_continuous_charge_kw: profile.maxContinuousChargeKw,
      round_trip_efficiency_pct: profile.roundTripEfficiencyPercent,
      rated_cycle_life: profile.ratedCycleLife,
      dispatch_strategy: profile.strategy,
      charge_tiers: [...profile.chargeTiers],
      discharge_tiers: [...profile.dischargeTiers],
      allow_grid_export: Boolean(profile.allowGridExport),
      installed_cost_usd: profile.installedCost,
    },
    tariff_configuration: {
      profile_name: activeTouProfile?.name || 'Standard TOU',
      utility: activeTouProfile?.utility || 'Utility',
      description: activeTouProfile?.description || '',
      rate_tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        buy_rate_usd_per_kwh: t.buyRate,
        sell_rate_usd_per_kwh: t.sellRate,
        color: t.color,
      })),
      seasons: (activeTouProfile?.seasons || []).map((s) => ({
        id: s.id,
        name: s.name,
        months: [...s.months],
        tier_rates: { ...s.tierRates },
      })),
      schedule_matrix: activeTouProfile?.scheduleMatrix || [],
    },
    financial_assumptions: {
      cost_and_incentives: {
        gross_installed_cost_usd: Math.round(activeAnalysis.grossCost * 100) / 100,
        immediate_rebates_usd: Math.round(immediateRebates * 100) / 100,
        upfront_cost_after_immediate_rebates_usd: Math.round(upfrontCostAfterImmediateRebates * 100) / 100,
        cash_due_at_purchase_usd: Math.round(activeAnalysis.upfrontOutOfPocket * 100) / 100,
        federal_tax_credit_pct: financials.federalTaxCreditPercent,
        deferred_federal_tax_credit_usd: Math.round(deferredFederalTaxCredit * 100) / 100,
        federal_tax_credit_realization_year: financials.federalTaxCreditRealizationYear ?? 1,
        net_cost_after_all_incentives_usd: Math.round(activeAnalysis.netInstalledCost * 100) / 100,
      },
      annual_electricity_inflation_rate_pct: financials.annualElectricityInflationRate,
      annual_battery_degradation_rate_pct: financials.annualBatteryDegradationRate,
      discount_rate_pct: financials.discountRatePercent,
      financing: {
        is_financed: Boolean(isFinanced),
        loan_apr_pct: financials.loanAprPercent ?? 6.99,
        loan_term_years: financials.loanTermYears ?? 10,
        down_payment_pct: financials.loanDownPaymentPercent ?? 0,
        loan_principal_usd: Math.round(loanPrincipal),
        monthly_loan_payment_usd: Math.round(monthlyLoanPayment * 100) / 100,
        down_payment_usd: isFinanced ? Math.round(upfrontOutOfPocket * 100) / 100 : null,
        total_loan_interest_usd: isFinanced ? Math.round(activeAnalysis.totalLoanInterestPaid * 100) / 100 : null,
      },
      opportunity_cost: {
        vehicle_name: opportunityCostVehicleName,
        benchmark_rate_pct: opportunityCostRate,
        horizon_future_value_usd: horizonSummary.opportunityCostFutureValue,
        horizon_opportunity_profit_usd: horizonSummary.opportunityCostProfit,
      },
      replacement: {
        replacement_enabled: replacementEnabled,
        replacement_cost_usd: replacementCost,
        replacement_year: replacementYear,
      },
      resilience: {
        critical_home_load_kw: criticalLoadPowerKw,
        annual_outage_days: financials.annualOutageDays ?? 2.5,
        value_of_lost_load_usd_per_day: financials.valueOfLostLoadPerDay ?? 100,
        include_voll_in_roi: financials.includeVollInRoi ?? false,
      },
    },
    year_1_results: {
      baseline_electricity_cost_usd: annualSummary.baselineAnnualCost,
      with_battery_electricity_cost_usd: annualSummary.simulatedAnnualCost,
      net_savings_usd: annualSummary.year1Savings,
      savings_percentage: annualSummary.savingsPercentage,
      total_grid_import_kwh: annualSummary.annualGridImportKwh,
      total_grid_export_kwh: annualSummary.annualGridExportKwh,
      battery_discharged_energy_kwh: annualSummary.annualBatteryDischargedKwh,
      equivalent_full_cycles: annualSummary.equivalentFullCycles,
      peak_demand_kw: annualSummary.maxPeakDemandKw,
    },
    horizon_summary_kpis: {
      horizon_years: safeHorizon,
      horizon_net_present_value_usd: Math.round(horizonSummary.netPresentValue * 100) / 100,
      horizon_cumulative_net_cash_flow_usd: Math.round(horizonSummary.cumulativeCashFlow * 100) / 100,
      horizon_cumulative_savings_usd: Math.round(horizonSummary.cumulativeSavings * 100) / 100,
      horizon_replacement_expenses_usd: Math.round(horizonSummary.totalReplacementCost * 100) / 100,
      discounted_payback_years: horizonSummary.discountedPaybackYears,
      simple_payback_years: horizonSummary.simplePaybackYears !== null ? Math.round(horizonSummary.simplePaybackYears * 100) / 100 : null,
      end_of_horizon_soh_pct: Math.round(horizonSummary.endOfHorizonSohPercent * 10) / 10,
      end_of_horizon_usable_capacity_kwh: Math.round(horizonSummary.endOfHorizonUsableCapacityKwh * 10) / 10,
      horizon_cumulative_cycles: Math.round(horizonSummary.cumulativeCycles),
      warranted_cycle_limit: profile.ratedCycleLife,
      warranty_cycles_exhausted_within_horizon: horizonSummary.warrantedCyclesExhausted,
      cycle_warranty_exhaustion_year: horizonSummary.cycleExhaustionYear,
      levelized_cost_of_storage_usd_per_kwh: Math.round(lcosPerKwh * 1000) / 1000,
      outage_backup_autonomy_hours: Math.round(outageAutonomyHours * 10) / 10,
      outage_backup_autonomy_days: Math.round(outageAutonomyDays * 10) / 10,
      net_monthly_cash_flow_year1_usd: Math.round(netMonthlyCashFlow * 100) / 100,
    },
    annual_time_series: annualTimeSeries,
  };
}

/**
 * Validates whether an analysis can be exported to projection JSON.
 * Projections cannot be exported for incomplete/partial datasets.
 */
export function canExportProjectionsJson(
  analysis: ProfileFinancialAnalysis | null,
  csvResult?: CsvValidationResult | null
): boolean {
  if (!analysis) return false;
  if (csvResult?.completeness && !csvResult.completeness.isSuitableForAnnualProjection) {
    return false;
  }
  return true;
}

/**
 * Validates whether an analysis can be exported to projection CSV.
 * Projections cannot be exported for incomplete/partial datasets.
 */
export function canExportProjectionsCsv(
  analysis: ProfileFinancialAnalysis | null,
  csvResult?: CsvValidationResult | null
): boolean {
  if (!analysis) return false;
  if (csvResult?.completeness && !csvResult.completeness.isSuitableForAnnualProjection) {
    return false;
  }
  return true;
}

/**
 * Generates projection CSV content from authoritative financial analysis.
 * Throws an error if called on an incomplete or unsuitable dataset.
 */
export function generateProjectionsCsv(
  analysis: ProfileFinancialAnalysis | null,
  horizon: number,
  csvResult?: CsvValidationResult | null
): string {
  if (!canExportProjectionsCsv(analysis, csvResult) || !analysis) {
    throw new Error('Cannot export projection CSV for an incomplete or unsuitable dataset.');
  }

  const safeHorizon = Math.max(1, Math.min(25, horizon));
  const projections = (analysis.projections || []).slice(0, safeHorizon);

  const headers = [
    'Year',
    'Baseline Spend ($)',
    'With Battery Spend ($)',
    'Annual Savings ($)',
    'Replacement Expense ($)',
    'Tax Credit Inflow ($)',
    'Annual Loan Payment ($)',
    'Net Cash Flow ($)',
    'Cumulative Cash Flow ($)',
    'Discounted NPV ($)',
    'SoH (%)',
    'Usable Capacity (kWh)',
    'Annual Cycles',
    'Cumulative Cycles',
  ];

  const rows = projections.map((p) => [
    p.year,
    p.baselineCost,
    p.withBatteryCost,
    p.annualSavings,
    p.replacementExpense,
    p.taxCreditInflow || 0,
    p.annualLoanPayment,
    p.netCashFlow,
    p.cumulativeCashFlow,
    p.cumulativeNpv,
    p.sohPercent,
    p.usableCapacityKwh,
    p.cyclesThisYear,
    p.cumulativeCycles,
  ]);

  return [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
}

// ============================================================================
// Generation-Aware LLM JSON Export Contracts & Builder (Milestone G4E)
// ============================================================================

export interface GenerationExportSolarArray {
  id: string;
  name: string;
  resource_mode: string;
  dc_capacity_kw: number;
  inverter_ac_capacity_kw: number;
  inverter_efficiency_pct: number;
  tilt_degrees: number;
  azimuth_degrees: number;
  system_loss_pct: number;
  shading_loss_pct: number;
  annual_degradation_pct: number;
  monthly_peak_sun_hours_per_day?: number[];
}

export interface GenerationExportWindTurbine {
  id: string;
  name: string;
  resource_mode: 'annual_average' | 'monthly_average';
  rated_power_kw: number;
  hub_height_m: number;
  rotor_diameter_m: number;
  cut_in_wind_speed_mps: number;
  rated_wind_speed_mps: number;
  cut_out_wind_speed_mps: number;
  availability_pct: number;
  system_loss_pct: number;
  measurement_height_m: number;
  wind_shear_exponent: number;
  annual_average_wind_speed_mps?: number;
  monthly_average_wind_speed_mps?: number[];
  power_curve: Array<{
    wind_speed_mps: number;
    output_kw: number;
  }>;
  installed_cost_usd: number;
  annual_maintenance_cost_usd: number;
}

export interface GenerationExportAnnualProjectionRow {
  year: number;
  solar_generation_kwh: number;
  solar_assets: Array<{
    asset_id: string;
    capacity_retention_factor: number;
    effective_dc_capacity_kw: number;
  }>;
  battery_capacity_retention_factor: number;
  battery_usable_capacity_kwh: number;
  baseline_electricity_cost_usd: number;
  modeled_project_electricity_cost_usd: number;
  electricity_savings_usd: number;
  generation_om_usd: number;
  replacement_expense_usd: number;
  annual_loan_payment_usd: number;
  tax_credit_inflow_usd: number;
  project_annual_cash_flow_usd: number;
  cumulative_project_cash_flow_usd: number;
  cumulative_npv_usd: number;

  solar_direct_to_load_kwh: number;
  solar_to_battery_kwh: number;
  solar_export_kwh: number;
  solar_curtailed_kwh: number;
  grid_import_kwh: number;
  grid_export_kwh: number;
  battery_export_kwh: number;
  battery_discharged_kwh: number;
  equivalent_full_cycles: number;

  wind_generation_kwh?: number;
  wind_direct_to_load_kwh?: number;
  wind_to_battery_kwh?: number;
  wind_export_kwh?: number;
  wind_curtailed_kwh?: number;

  renewable_generation_kwh?: number;
  renewable_direct_to_load_kwh?: number;
  renewable_to_battery_kwh?: number;
  renewable_export_kwh?: number;
  renewable_curtailed_kwh?: number;
}

export interface GenerationLlmExportPayload {
  metadata: {
    app_name: string;
    app_version: string;
    export_timestamp: string;
    selected_horizon_years: number;
    currency: string;
    dataset_summary: {
      start_date: string;
      end_date: string;
      total_intervals: number;
      interval_duration_hours: number;
      duration_days: number;
      total_home_load_kwh: number;
      is_suitable_for_annual_projection: boolean;
      completeness_reason: string | null;
    };
  };
  battery_configuration: {
    profile_name: string;
    model: string;
    total_capacity_kwh: number;
    usable_dod_pct: number;
    usable_capacity_kwh: number;
    max_continuous_discharge_kw: number;
    max_continuous_charge_kw: number;
    round_trip_efficiency_pct: number;
    rated_cycle_life: number;
    dispatch_strategy: string;
    charge_tiers: string[];
    discharge_tiers: string[];
    allow_grid_export: boolean;
    battery_grid_export_permission: boolean;
    installed_cost_usd: number;
  };
  tariff_configuration: {
    profile_name: string;
    utility: string;
    description: string;
    rate_tiers: Array<{
      id: string;
      name: string;
      buy_rate_usd_per_kwh: number;
      sell_rate_usd_per_kwh: number;
      color: string;
    }>;
    seasons: Array<{
      id: string;
      name: string;
      months: number[];
      tier_rates: Record<string, { buyRate: number; sellRate: number }>;
    }>;
    schedule_matrix: string[][];
  };
  financial_assumptions: {
    annual_electricity_inflation_rate_pct: number;
    annual_battery_degradation_rate_pct: number;
    discount_rate_pct: number;
    federal_tax_credit_pct: number;
    federal_tax_credit_realization_year: number;
    local_rebate_flat_usd: number;
    financing: {
      is_financed: boolean;
      loan_apr_pct: number;
      loan_term_years: number;
      down_payment_pct: number;
      loan_principal_usd: number;
      monthly_loan_payment_usd: number;
      down_payment_usd: number | null;
      total_loan_interest_usd: number | null;
    };
    opportunity_cost: {
      vehicle: string;
      vehicle_name: string;
      benchmark_rate_pct: number;
      horizon_future_value_usd: number;
      horizon_opportunity_profit_usd: number;
    };
    replacement: {
      replacement_enabled: boolean;
      replacement_cost_usd: number | null;
      replacement_year: number | null;
    };
    resilience: {
      critical_home_load_kw: number;
      annual_outage_days: number;
      value_of_lost_load_usd_per_day: number;
      include_voll_in_roi: boolean;
    };
  };
  generation_configuration: {
    site: {
      latitude: number | null;
      longitude: number | null;
      time_zone: string;
      elevation_m: number | null;
    };
    allow_solar_export: boolean;
    solar_export_permission: boolean;
    solar_arrays: GenerationExportSolarArray[];
    enabled_solar_arrays: GenerationExportSolarArray[];
    allow_renewable_export?: boolean;
    wind_turbines?: GenerationExportWindTurbine[];
  };
  generation_year_1_results: {
    total_home_load_kwh: number;
    solar_generated_kwh: number;
    solar_direct_to_load_kwh: number;
    solar_to_battery_ac_kwh: number;
    solar_export_kwh: number;
    solar_curtailed_kwh: number;
    grid_import_kwh: number;
    grid_export_kwh: number;
    battery_export_kwh: number;
    baseline_electricity_cost_usd: number;
    modeled_project_electricity_cost_usd: number;
    electricity_savings_usd: number;

    wind_generated_kwh?: number;
    wind_direct_to_load_kwh?: number;
    wind_to_battery_ac_kwh?: number;
    wind_export_kwh?: number;
    wind_curtailed_kwh?: number;

    renewable_generated_kwh?: number;
    renewable_direct_to_load_kwh?: number;
    renewable_to_battery_ac_kwh?: number;
    renewable_export_kwh?: number;
    renewable_curtailed_kwh?: number;
  };
  generation_project_costs: {
    battery_capex_usd: number;
    generation_capex_usd: number;
    gross_project_capex_usd: number;
    annual_generation_om_usd: number;
    immediate_rebate_usd: number;
    deferred_federal_tax_credit_usd: number;
    total_incentives_usd: number;
    net_installed_project_cost_usd: number;
    upfront_out_of_pocket_usd: number;
    is_financed: boolean;
    loan_principal_usd: number;
    monthly_loan_payment_usd: number;
    total_loan_payments_usd: number;
    total_loan_interest_usd: number;
    generation_assets: Array<{
      id: string;
      name: string;
      type: string;
      installed_cost_usd: number;
      annual_maintenance_cost_usd: number;
    }>;
  };
  generation_horizon_summary_kpis: {
    horizon_years: number;
    horizon_net_present_value_usd: number;
    horizon_cumulative_project_cash_flow_usd: number;
    horizon_cumulative_electricity_savings_usd: number;
    horizon_generation_maintenance_usd: number;
    horizon_replacement_expenses_usd: number;
    horizon_loan_payments_usd: number;
    horizon_tax_credit_inflows_usd: number;
    simple_payback_years: number | null;
    discounted_payback_years: number | null;
    horizon_roi_pct: number;
    total_project_cash_outlays_usd: number;
    opportunity_cost_future_value_usd: number;
    opportunity_cost_profit_usd: number;
    project_vs_opportunity_cost_usd: number;
  };
  generation_annual_projection: GenerationExportAnnualProjectionRow[];
}

export interface BuildGenerationExportLlmJsonParams {
  generationConfig: GenerationConfig;
  allowSolarExport?: boolean;
  allowRenewableExport?: boolean;
  generationAwareResult: GenerationAwareSimulationResult;
  operationalProjection: GenerationOperationalProjection;
  generationAnalysis: GenerationFinancialAnalysis;
  generationProjectCosts: GenerationProjectCostSummary;
  projectionHorizon: number;
  tiers: RateTier[];
  activeTouProfile?: TouProfile;
  financials: MacroFinancials;
  csvResult?: CsvValidationResult | null;
}

export interface CanExportGenerationProjectionsJsonParams {
  generationAnalysis?: GenerationFinancialAnalysis | null;
  operationalProjection?: GenerationOperationalProjection | null;
  generationAwareResult?: GenerationAwareSimulationResult | null;
  generationProjectCosts?: GenerationProjectCostSummary | null;
  generationConfig?: GenerationConfig | null;
  csvResult?: CsvValidationResult | null;
  analysisState?: AnalysisState;
}

/**
 * Validates whether a generation analysis can be exported to projection JSON.
 * Returns false if any required authoritative inputs are missing, or if dataset is partial-period,
 * or if generation financial analysis is in a pending state, or if unsupported active assets exist.
 */
export function canExportGenerationProjectionsJson(
  params: CanExportGenerationProjectionsJsonParams
): boolean {
  const {
    generationAnalysis,
    operationalProjection,
    generationAwareResult,
    generationProjectCosts,
    generationConfig,
    csvResult,
    analysisState,
  } = params;

  if (analysisState === 'generation-financial-pending' || analysisState === 'partial-period') {
    return false;
  }

  if (csvResult?.completeness && !csvResult.completeness.isSuitableForAnnualProjection) {
    return false;
  }

  if (
    !generationAnalysis ||
    !operationalProjection ||
    !generationAwareResult ||
    !generationProjectCosts
  ) {
    return false;
  }

  if (generationConfig?.assets && Array.isArray(generationConfig.assets)) {
    const hasUnsupportedAsset = generationConfig.assets.some((a) => {
      if (!a || !a.enabled) return false;
      if (a.type === 'generator') return true;
      if (a.type === 'wind') {
        const windAsset = a as WindGenerationAsset;
        if (windAsset.resourceMode === 'interval_file') return true;
        if (
          windAsset.resourceMode !== 'annual_average' &&
          windAsset.resourceMode !== 'monthly_average'
        ) {
          return true;
        }
      }
      return false;
    });
    if (hasUnsupportedAsset) {
      return false;
    }
  }

  return true;
}

/**
 * Builds an authoritative Generation Project LLM JSON export payload.
 * Consumes existing G3/G4 engines exclusively; performs zero independent physical or financial recalculation.
 */
export function buildGenerationExportLlmJson(
  params: BuildGenerationExportLlmJsonParams
): GenerationLlmExportPayload {
  const {
    generationConfig,
    allowSolarExport,
    allowRenewableExport,
    generationAwareResult,
    operationalProjection,
    generationAnalysis,
    generationProjectCosts,
    projectionHorizon,
    tiers,
    activeTouProfile,
    financials,
    csvResult,
  } = params;

  if (csvResult?.completeness && !csvResult.completeness.isSuitableForAnnualProjection) {
    throw new Error('Cannot export multi-year generation projections for an incomplete or partial-period dataset.');
  }

  if (
    !generationConfig ||
    !generationAwareResult ||
    !operationalProjection ||
    !generationAnalysis ||
    !generationProjectCosts
  ) {
    throw new Error('All authoritative generation simulation, operational, cost, and financial outputs must be provided.');
  }

  // Reject unsupported active assets
  const enabledAssets = (generationConfig.assets || []).filter((a) => a && a.enabled);
  for (const asset of enabledAssets) {
    if (asset.type === 'generator') {
      throw new Error('Enabled generator assets are not supported for generation export.');
    }
    if (asset.type === 'wind') {
      const windAsset = asset as WindGenerationAsset;
      if (windAsset.resourceMode === 'interval_file') {
        throw new Error('Enabled wind assets with interval_file resource mode are not supported for generation export.');
      }
      if (windAsset.resourceMode !== 'annual_average' && windAsset.resourceMode !== 'monthly_average') {
        throw new Error(`Unsupported wind resource mode: ${windAsset.resourceMode}`);
      }
    }
  }

  const enabledSolarAssets = enabledAssets.filter(
    (a): a is SolarGenerationAsset => a.type === 'solar'
  );
  const enabledWindAssets = enabledAssets.filter(
    (a): a is WindGenerationAsset => a.type === 'wind'
  );
  const hasEnabledWind = enabledWindAssets.length > 0;

  const effectiveAllowRenewableExport =
    allowRenewableExport !== undefined
      ? Boolean(allowRenewableExport)
      : Boolean(allowSolarExport);

  const safeHorizon = Math.max(1, Math.min(25, Math.round(projectionHorizon || 0)));

  const opYears = operationalProjection.years || [];
  const finYears = generationAnalysis.projections || [];

  if (opYears.length < safeHorizon || finYears.length < safeHorizon) {
    throw new Error(`Insufficient projection rows for selected horizon of ${safeHorizon} years.`);
  }

  // Strict check: operational and financial projections must pair on identical years
  for (let i = 0; i < safeHorizon; i++) {
    const opYear = opYears[i];
    const finYear = finYears[i];
    if (!opYear || !finYear || opYear.year !== finYear.year) {
      throw new Error(
        `Operational year (${opYear?.year}) and financial year (${finYear?.year}) mismatch at index ${i}.`
      );
    }
  }

  // Authoritative presentation metrics from G4D/G5E adapter
  const opDisplay = deriveGenerationOperationalDisplayMetrics(generationAwareResult);

  // Authoritative horizon summary from G4C engine
  const horizonSummary = deriveGenerationHorizonFinancialSummary(generationAnalysis, safeHorizon);

  // Battery configuration context
  const batteryProfile = generationAnalysis.batteryProfile;
  const usableDod = batteryProfile.usableDodPercent;
  const usableCapacity = Math.round(batteryProfile.totalCapacityKwh * (usableDod / 100) * 100) / 100;

  const solarArraysExport: GenerationExportSolarArray[] = enabledSolarAssets.map((asset) => {
    const entry: GenerationExportSolarArray = {
      id: asset.id,
      name: asset.name,
      resource_mode: asset.resourceMode,
      dc_capacity_kw: asset.dcCapacityKw,
      inverter_ac_capacity_kw: asset.inverterAcCapacityKw,
      inverter_efficiency_pct: asset.inverterEfficiencyPercent,
      tilt_degrees: asset.tiltDegrees,
      azimuth_degrees: asset.azimuthDegrees,
      system_loss_pct: asset.systemLossPercent,
      shading_loss_pct: asset.shadingLossPercent,
      annual_degradation_pct: asset.annualDegradationPercent,
    };
    if (asset.monthlyPeakSunHoursPerDay && asset.monthlyPeakSunHoursPerDay.length > 0) {
      entry.monthly_peak_sun_hours_per_day = [...asset.monthlyPeakSunHoursPerDay];
    }
    return entry;
  });

  const windTurbinesExport: GenerationExportWindTurbine[] = enabledWindAssets.map((asset) => {
    const entry: GenerationExportWindTurbine = {
      id: asset.id,
      name: asset.name,
      resource_mode: asset.resourceMode as 'annual_average' | 'monthly_average',
      rated_power_kw: asset.ratedPowerKw,
      hub_height_m: asset.hubHeightM,
      rotor_diameter_m: asset.rotorDiameterM,
      cut_in_wind_speed_mps: asset.cutInWindSpeedMps,
      rated_wind_speed_mps: asset.ratedWindSpeedMps,
      cut_out_wind_speed_mps: asset.cutOutWindSpeedMps,
      availability_pct: asset.availabilityPercent,
      system_loss_pct: asset.systemLossPercent,
      measurement_height_m: asset.measurementHeightM,
      wind_shear_exponent: asset.windShearExponent,
      power_curve: (asset.powerCurve || []).map((pt) => ({
        wind_speed_mps: pt.windSpeedMps,
        output_kw: pt.outputKw,
      })),
      installed_cost_usd: asset.installedCostUsd,
      annual_maintenance_cost_usd: asset.annualMaintenanceCostUsd,
    };

    if (asset.resourceMode === 'annual_average') {
      if (asset.annualAverageWindSpeedMps !== null && asset.annualAverageWindSpeedMps !== undefined) {
        entry.annual_average_wind_speed_mps = asset.annualAverageWindSpeedMps;
      }
    } else if (asset.resourceMode === 'monthly_average') {
      if (asset.monthlyAverageWindSpeedMps && Array.isArray(asset.monthlyAverageWindSpeedMps)) {
        entry.monthly_average_wind_speed_mps = [...asset.monthlyAverageWindSpeedMps];
      }
    }

    return entry;
  });

  // Annual projection time series
  const annualProjection: GenerationExportAnnualProjectionRow[] = [];
  for (let i = 0; i < safeHorizon; i++) {
    const opYear = opYears[i];
    const finYear = finYears[i];

    const row: GenerationExportAnnualProjectionRow = {
      year: opYear.year,
      solar_generation_kwh: opYear.solarGeneratedKwh,
      solar_assets: (opYear.solarAssets || []).map((sa) => ({
        asset_id: sa.assetId,
        capacity_retention_factor: sa.capacityRetentionFactor,
        effective_dc_capacity_kw: sa.effectiveDcCapacityKw,
      })),
      battery_capacity_retention_factor: opYear.batteryCapacityRetentionFactor,
      battery_usable_capacity_kwh: opYear.batteryUsableCapacityKwh,
      baseline_electricity_cost_usd: finYear.baselineElectricityCostUsd,
      modeled_project_electricity_cost_usd: finYear.modeledProjectElectricityCostUsd,
      electricity_savings_usd: finYear.electricitySavingsUsd,
      generation_om_usd: finYear.generationMaintenanceUsd,
      replacement_expense_usd: finYear.replacementExpenseUsd,
      annual_loan_payment_usd: finYear.annualLoanPaymentUsd,
      tax_credit_inflow_usd: finYear.taxCreditInflowUsd,
      project_annual_cash_flow_usd: finYear.netProjectCashFlowUsd,
      cumulative_project_cash_flow_usd: finYear.cumulativeCashFlowUsd,
      cumulative_npv_usd: finYear.cumulativeNpvUsd,

      // Additional G4B operational aggregates
      solar_direct_to_load_kwh: opYear.solarDirectToLoadKwh,
      solar_to_battery_kwh: opYear.solarToBatteryKwh,
      solar_export_kwh: opYear.solarExportKwh,
      solar_curtailed_kwh: opYear.solarCurtailedKwh,
      grid_import_kwh: opYear.gridImportKwh,
      grid_export_kwh: opYear.gridExportKwh,
      battery_export_kwh: opYear.batteryExportKwh,
      battery_discharged_kwh: opYear.batteryDischargedKwh,
      equivalent_full_cycles: opYear.equivalentFullCycles,
    };

    if (hasEnabledWind) {
      row.wind_generation_kwh = opYear.windGeneratedKwh;
      row.wind_direct_to_load_kwh = opYear.windDirectToLoadKwh;
      row.wind_to_battery_kwh = opYear.windToBatteryKwh;
      row.wind_export_kwh = opYear.windExportKwh;
      row.wind_curtailed_kwh = opYear.windCurtailedKwh;

      row.renewable_generation_kwh = opYear.renewableGeneratedKwh;
      row.renewable_direct_to_load_kwh = opYear.renewableDirectToLoadKwh;
      row.renewable_to_battery_kwh = opYear.renewableToBatteryKwh;
      row.renewable_export_kwh = opYear.renewableExportKwh;
      row.renewable_curtailed_kwh = opYear.renewableCurtailedKwh;
    }

    annualProjection.push(row);
  }

  const completeness = csvResult?.completeness;
  const isFinanced = Boolean(generationAnalysis.isFinanced);

  const replacementEnabled = financials.replacementEnabled ?? true;
  const replacementCost = replacementEnabled ? (financials.replacementCost ?? 0) : null;
  const replacementYear = replacementEnabled ? (financials.replacementYear ?? 10) : null;

  const totalIntervals =
    completeness?.intervalCount ||
    generationAwareResult.totalIntervals ||
    generationAwareResult.alignedTimestamps?.length ||
    8760;
  const intervalDurationHours = completeness?.intervalDurationHours || 1;
  const durationDays =
    completeness?.durationDays ||
    Math.round((totalIntervals * intervalDurationHours) / 24);

  return {
    metadata: {
      app_name: 'VoltWise',
      app_version: APP_VERSION,
      export_timestamp: new Date().toISOString(),
      selected_horizon_years: safeHorizon,
      currency: 'USD',
      dataset_summary: {
        start_date: completeness?.startDate || csvResult?.startDate || '',
        end_date: completeness?.endDate || csvResult?.endDate || '',
        total_intervals: totalIntervals,
        interval_duration_hours: intervalDurationHours,
        duration_days: durationDays,
        total_home_load_kwh: opDisplay.totalHomeLoadKwh,
        is_suitable_for_annual_projection: true,
        completeness_reason: completeness?.reason ?? null,
      },
    },
    battery_configuration: {
      profile_name: batteryProfile.name,
      model: batteryProfile.model,
      total_capacity_kwh: batteryProfile.totalCapacityKwh,
      usable_dod_pct: usableDod,
      usable_capacity_kwh: usableCapacity,
      max_continuous_discharge_kw: batteryProfile.maxContinuousOutputKw,
      max_continuous_charge_kw: batteryProfile.maxContinuousChargeKw,
      round_trip_efficiency_pct: batteryProfile.roundTripEfficiencyPercent,
      rated_cycle_life: batteryProfile.ratedCycleLife,
      dispatch_strategy: batteryProfile.strategy,
      charge_tiers: [...batteryProfile.chargeTiers],
      discharge_tiers: [...batteryProfile.dischargeTiers],
      allow_grid_export: Boolean(batteryProfile.allowGridExport),
      battery_grid_export_permission: Boolean(batteryProfile.allowGridExport),
      installed_cost_usd: batteryProfile.installedCost,
    },
    tariff_configuration: {
      profile_name: activeTouProfile?.name || 'Standard TOU',
      utility: activeTouProfile?.utility || 'Utility',
      description: activeTouProfile?.description || '',
      rate_tiers: tiers.map((t) => ({
        id: t.id,
        name: t.name,
        buy_rate_usd_per_kwh: t.buyRate,
        sell_rate_usd_per_kwh: t.sellRate,
        color: t.color,
      })),
      seasons: (activeTouProfile?.seasons || []).map((s) => ({
        id: s.id,
        name: s.name,
        months: [...s.months],
        tier_rates: { ...s.tierRates },
      })),
      schedule_matrix: activeTouProfile?.scheduleMatrix || [],
    },
    financial_assumptions: {
      annual_electricity_inflation_rate_pct: financials.annualElectricityInflationRate,
      annual_battery_degradation_rate_pct: financials.annualBatteryDegradationRate,
      discount_rate_pct: financials.discountRatePercent,
      federal_tax_credit_pct: financials.federalTaxCreditPercent,
      federal_tax_credit_realization_year: financials.federalTaxCreditRealizationYear ?? 1,
      local_rebate_flat_usd: financials.localRebateFlat,
      financing: {
        is_financed: isFinanced,
        loan_apr_pct: financials.loanAprPercent ?? 6.99,
        loan_term_years: financials.loanTermYears ?? 10,
        down_payment_pct: financials.loanDownPaymentPercent ?? 0,
        loan_principal_usd: generationAnalysis.loanPrincipalUsd,
        monthly_loan_payment_usd: generationAnalysis.monthlyLoanPaymentUsd,
        down_payment_usd: isFinanced ? generationAnalysis.upfrontOutOfPocketUsd : null,
        total_loan_interest_usd: isFinanced ? generationAnalysis.totalLoanInterestUsd : null,
      },
      opportunity_cost: {
        vehicle: financials.opportunityCostVehicle || generationAnalysis.opportunityCostVehicleName,
        vehicle_name: generationAnalysis.opportunityCostVehicleName,
        benchmark_rate_pct: generationAnalysis.opportunityCostRatePercent,
        horizon_future_value_usd: horizonSummary.opportunityCostFutureValue,
        horizon_opportunity_profit_usd: horizonSummary.opportunityCostProfit,
      },
      replacement: {
        replacement_enabled: replacementEnabled,
        replacement_cost_usd: replacementCost,
        replacement_year: replacementYear,
      },
      resilience: {
        critical_home_load_kw: financials.criticalLoadPowerKw,
        annual_outage_days: financials.annualOutageDays ?? 2.5,
        value_of_lost_load_usd_per_day: financials.valueOfLostLoadPerDay ?? 100,
        include_voll_in_roi: financials.includeVollInRoi ?? false,
      },
    },
    generation_configuration: {
      site: {
        latitude: generationConfig.site?.latitude ?? null,
        longitude: generationConfig.site?.longitude ?? null,
        time_zone: generationConfig.site?.timeZone ?? 'UTC',
        elevation_m: generationConfig.site?.elevationM ?? null,
      },
      allow_solar_export: effectiveAllowRenewableExport,
      solar_export_permission: effectiveAllowRenewableExport,
      solar_arrays: solarArraysExport,
      enabled_solar_arrays: solarArraysExport,
      ...(hasEnabledWind
        ? {
            allow_renewable_export: effectiveAllowRenewableExport,
            wind_turbines: windTurbinesExport,
          }
        : {}),
    },
    generation_year_1_results: {
      total_home_load_kwh: opDisplay.totalHomeLoadKwh,
      solar_generated_kwh: opDisplay.solarGeneratedKwh,
      solar_direct_to_load_kwh: opDisplay.solarDirectToLoadKwh,
      solar_to_battery_ac_kwh: opDisplay.solarToBatteryAcKwh,
      solar_export_kwh: opDisplay.solarExportKwh,
      solar_curtailed_kwh: opDisplay.solarCurtailedKwh,
      grid_import_kwh: opDisplay.gridImportKwh,
      grid_export_kwh: opDisplay.gridExportKwh,
      battery_export_kwh: opDisplay.batteryExportKwh,
      baseline_electricity_cost_usd: opDisplay.baselineCostUsd,
      modeled_project_electricity_cost_usd: opDisplay.modeledProjectCostUsd,
      electricity_savings_usd: opDisplay.electricitySavingsUsd,
      ...(hasEnabledWind
        ? {
            wind_generated_kwh: opDisplay.windGeneratedKwh,
            wind_direct_to_load_kwh: opDisplay.windDirectToLoadKwh,
            wind_to_battery_ac_kwh: opDisplay.windToBatteryAcKwh,
            wind_export_kwh: opDisplay.windExportKwh,
            wind_curtailed_kwh: opDisplay.windCurtailedKwh,

            renewable_generated_kwh: opDisplay.renewableGeneratedKwh,
            renewable_direct_to_load_kwh: opDisplay.renewableDirectToLoadKwh,
            renewable_to_battery_ac_kwh: opDisplay.renewableToBatteryAcKwh,
            renewable_export_kwh: opDisplay.renewableExportKwh,
            renewable_curtailed_kwh: opDisplay.renewableCurtailedKwh,
          }
        : {}),
    },
    generation_project_costs: {
      battery_capex_usd: generationAnalysis.batteryCapexUsd,
      generation_capex_usd: generationAnalysis.generationCapexUsd,
      gross_project_capex_usd: generationAnalysis.grossProjectCapexUsd,
      annual_generation_om_usd: generationAnalysis.annualGenerationMaintenanceUsd,
      immediate_rebate_usd: generationAnalysis.immediateRebateUsd,
      deferred_federal_tax_credit_usd: generationAnalysis.deferredFederalTaxCreditUsd,
      total_incentives_usd: generationAnalysis.incentivesAmountUsd,
      net_installed_project_cost_usd: generationAnalysis.netInstalledProjectCostUsd,
      upfront_out_of_pocket_usd: generationAnalysis.upfrontOutOfPocketUsd,
      is_financed: isFinanced,
      loan_principal_usd: generationAnalysis.loanPrincipalUsd,
      monthly_loan_payment_usd: generationAnalysis.monthlyLoanPaymentUsd,
      total_loan_payments_usd: generationAnalysis.totalLoanPaymentsUsd,
      total_loan_interest_usd: generationAnalysis.totalLoanInterestUsd,
      generation_assets: (generationProjectCosts.byAsset || []).map((a) => ({
        id: a.id,
        name: a.name,
        type: a.type,
        installed_cost_usd: a.installedCostUsd,
        annual_maintenance_cost_usd: a.annualMaintenanceCostUsd,
      })),
    },
    generation_horizon_summary_kpis: {
      horizon_years: safeHorizon,
      horizon_net_present_value_usd: horizonSummary.netPresentValue,
      horizon_cumulative_project_cash_flow_usd: horizonSummary.cumulativeCashFlow,
      horizon_cumulative_electricity_savings_usd: horizonSummary.cumulativeElectricitySavings,
      horizon_generation_maintenance_usd: horizonSummary.totalGenerationMaintenance,
      horizon_replacement_expenses_usd: horizonSummary.totalReplacementExpense,
      horizon_loan_payments_usd: horizonSummary.totalLoanPayments,
      horizon_tax_credit_inflows_usd: horizonSummary.taxCreditInflows,
      simple_payback_years: horizonSummary.simplePaybackYears,
      discounted_payback_years: horizonSummary.discountedPaybackYears,
      horizon_roi_pct: horizonSummary.horizonRoiPercent,
      total_project_cash_outlays_usd: horizonSummary.totalProjectCashOutlays ?? 0,
      opportunity_cost_future_value_usd: horizonSummary.opportunityCostFutureValue,
      opportunity_cost_profit_usd: horizonSummary.opportunityCostProfit,
      project_vs_opportunity_cost_usd: horizonSummary.opportunityCostDiff,
    },
    generation_annual_projection: annualProjection,
  };
}
