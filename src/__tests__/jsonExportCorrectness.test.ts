import { describe, it, expect, vi } from 'vitest';
import {
  buildExportLlmJson,
  buildGenerationExportLlmJson,
  canExportGenerationProjectionsJson,
  canExportProjectionsJson,
} from '../utils/exportJson';
import * as simEngine from '../utils/simulationEngine';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_TOU_PROFILES,
  calculate15YearFinancials,
} from '../utils/simulationEngine';
import {
  aggregateGenerationProjectCosts,
  calculateGenerationAwareFinancials,
  deriveGenerationHorizonFinancialSummary,
} from '../utils/generationFinancials';
import { deriveGenerationOperationalDisplayMetrics } from '../utils/generationResults';
import { createDefaultAsset } from '../utils/generationDefaults';
import {
  AnnualSimulationSummary,
  CsvValidationResult,
  GenerationConfig,
  GenerationOperationalProjection,
  GenerationOperationalYear,
  GeneratorGenerationAsset,
  SolarGenerationAsset,
  WindGenerationAsset,
} from '../types/energy';
import { GenerationAwareSimulationResult } from '../utils/generationAwareSimulation';

describe('Issue 4 — JSON Export Correctness and Consistency', () => {
  const profile = DEFAULT_BATTERY_PROFILES[0]; // Tesla Powerwall 3
  const touProfile = DEFAULT_TOU_PROFILES[0]; // CA EV2-A
  const tiers = touProfile.tiers;

  const dummySummary: AnnualSimulationSummary = {
    profileId: profile.id,
    profileName: profile.name,
    totalIntervals: 8760,
    intervalHours: 1,
    totalHomeLoadKwh: 9000,
    baselineAnnualCost: 2400,
    simulatedAnnualCost: 1400,
    year1Savings: 1000,
    savingsPercentage: 41.7,
    annualGridImportKwh: 5500,
    annualGridExportKwh: 200,
    annualBatteryDischargedKwh: 3500,
    equivalentFullCycles: 260,
    maxPeakDemandKw: 7.2,
    intervalResults: [],
  };

  const mockCsvResult: CsvValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    totalRows: 8760,
    validRows: 8760,
    totalKwh: 9000,
    intervalHours: 1,
    startDate: '2025-01-01 00:00',
    endDate: '2025-12-31 23:00',
    peakKw: 7.2,
    data: [],
    completeness: {
      startDate: '2025-01-01 00:00',
      endDate: '2025-12-31 23:00',
      intervalCount: 8760,
      intervalDurationHours: 1,
      durationDays: 365,
      expectedIntervalCount: 8760,
      missingIntervalCount: 0,
      isLeapYear: false,
      isSuitableForAnnualProjection: true,
    },
  };

  it('ensures 15-year export contains 15-year metrics rather than 25-year metrics', () => {
    const analysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);

    const export15 = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: DEFAULT_MACRO_FINANCIALS,
      csvResult: mockCsvResult,
    });

    expect(export15.metadata.selected_horizon_years).toBe(15);
    expect(export15.annual_time_series).toHaveLength(15);

    const p15 = analysis.projections[14]; // Year 15 projection
    const p25 = analysis.projections[24]; // Year 25 projection

    // NPV in 15-year export must match Year 15 cumulative NPV, NOT Year 25 NPV
    expect(export15.horizon_summary_kpis.horizon_net_present_value_usd).toBe(p15.cumulativeNpv);
    expect(export15.horizon_summary_kpis.horizon_cumulative_net_cash_flow_usd).toBe(p15.cumulativeCashFlow);
    expect(export15.horizon_summary_kpis.end_of_horizon_soh_pct).toBe(p15.sohPercent);
    expect(export15.horizon_summary_kpis.end_of_horizon_usable_capacity_kwh).toBe(p15.usableCapacityKwh);
    expect(export15.horizon_summary_kpis.horizon_cumulative_cycles).toBe(p15.cumulativeCycles);

    // Verify it differs from 25-year values
    expect(export15.horizon_summary_kpis.end_of_horizon_soh_pct).not.toBe(p25.sohPercent);
  });

  it('ensures 25-year export contains 25-year metrics', () => {
    const analysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);

    const export25 = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 25,
      tiers,
      activeTouProfile: touProfile,
      financials: DEFAULT_MACRO_FINANCIALS,
      csvResult: mockCsvResult,
    });

    expect(export25.metadata.selected_horizon_years).toBe(25);
    expect(export25.annual_time_series).toHaveLength(25);

    const p25 = analysis.projections[24];
    expect(export25.horizon_summary_kpis.horizon_net_present_value_usd).toBe(p25.cumulativeNpv);
    expect(export25.horizon_summary_kpis.end_of_horizon_soh_pct).toBe(p25.sohPercent);
    expect(export25.horizon_summary_kpis.horizon_cumulative_cycles).toBe(p25.cumulativeCycles);
  });

  it('ensures disabled replacement does not export replacement values or phantom expenses', () => {
    const noReplacementFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      replacementEnabled: false,
      replacementCost: 2000,
      replacementYear: 10,
    };

    const analysis = calculate15YearFinancials(profile, dummySummary, noReplacementFinancials);

    const exportData = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: noReplacementFinancials,
      csvResult: mockCsvResult,
    });

    expect(exportData.financial_assumptions.replacement.replacement_enabled).toBe(false);
    expect(exportData.financial_assumptions.replacement.replacement_cost_usd).toBeNull();
    expect(exportData.financial_assumptions.replacement.replacement_year).toBeNull();
    expect(exportData.horizon_summary_kpis.horizon_replacement_expenses_usd).toBe(0);

    // Ensure no replacement expense exists in the annual series
    exportData.annual_time_series.forEach((yr) => {
      expect(yr.replacement_expense_usd).toBe(0);
    });
  });

  it('includes complete tariff configuration, battery dispatch configuration, and dataset metadata', () => {
    const analysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);

    const exportData = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: DEFAULT_MACRO_FINANCIALS,
      csvResult: mockCsvResult,
    });

    // Dataset Metadata
    expect(exportData.metadata.dataset_summary.start_date).toBe('2025-01-01 00:00');
    expect(exportData.metadata.dataset_summary.end_date).toBe('2025-12-31 23:00');
    expect(exportData.metadata.dataset_summary.total_intervals).toBe(8760);
    expect(exportData.metadata.dataset_summary.duration_days).toBe(365);
    expect(exportData.metadata.dataset_summary.is_suitable_for_annual_projection).toBe(true);

    // Battery Configuration
    expect(exportData.battery_configuration.profile_name).toBe(profile.name);
    expect(exportData.battery_configuration.total_capacity_kwh).toBe(profile.totalCapacityKwh);
    expect(exportData.battery_configuration.round_trip_efficiency_pct).toBe(profile.roundTripEfficiencyPercent);
    expect(exportData.battery_configuration.charge_tiers).toEqual(profile.chargeTiers);
    expect(exportData.battery_configuration.discharge_tiers).toEqual(profile.dischargeTiers);
    expect(exportData.battery_configuration.installed_cost_usd).toBe(profile.installedCost);

    // Tariff Configuration
    expect(exportData.tariff_configuration.profile_name).toBe(touProfile.name);
    expect(exportData.tariff_configuration.rate_tiers.length).toBeGreaterThanOrEqual(1);
    expect(exportData.tariff_configuration.schedule_matrix).toHaveLength(7);
  });

  it('exports explicit cost_and_incentives block distinguishing upfront, immediate, and deferred incentives', () => {
    const customFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      localRebateFlat: 1500,
      federalTaxCreditPercent: 30,
      federalTaxCreditRealizationYear: 1,
      isFinanced: false,
    };

    const analysis = calculate15YearFinancials(profile, dummySummary, customFinancials);

    const exportData = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: customFinancials,
      csvResult: mockCsvResult,
    });

    const costAndIncentives = exportData.financial_assumptions.cost_and_incentives;
    expect(costAndIncentives).toBeDefined();

    // 1. Gross installed cost
    expect(costAndIncentives.gross_installed_cost_usd).toBe(analysis.grossCost);

    // 2. Immediate rebate amount
    const expectedImmediateRebates = Math.min(
      analysis.grossCost,
      Math.max(0, customFinancials.localRebateFlat)
    );
    expect(costAndIncentives.immediate_rebates_usd).toBe(expectedImmediateRebates);

    // 3. Upfront cost after immediate rebates (acquisition basis before financing)
    const expectedUpfrontCost = Math.max(0, analysis.grossCost - expectedImmediateRebates);
    expect(costAndIncentives.upfront_cost_after_immediate_rebates_usd).toBe(expectedUpfrontCost);

    // 4. Cash due at purchase (for cash purchase = upfront cost after immediate rebates)
    expect(costAndIncentives.cash_due_at_purchase_usd).toBe(analysis.upfrontOutOfPocket);
    expect(costAndIncentives.cash_due_at_purchase_usd).toBe(expectedUpfrontCost);

    // 5. Federal tax credit percentage and realization year
    expect(costAndIncentives.federal_tax_credit_pct).toBe(30);
    expect(costAndIncentives.federal_tax_credit_realization_year).toBe(1);

    // 6. Deferred federal tax credit USD (from full projections cash flow)
    const expectedDeferredTaxCredit = analysis.projections.reduce(
      (sum, p) => sum + (p.taxCreditInflow ?? 0),
      0
    );
    expect(costAndIncentives.deferred_federal_tax_credit_usd).toBe(expectedDeferredTaxCredit);

    // 7. Net cost after all incentives
    expect(costAndIncentives.net_cost_after_all_incentives_usd).toBe(analysis.netInstalledCost);

    // 8. Ensure net_upfront_installed_cost_usd is removed from horizon_summary_kpis
    expect('net_upfront_installed_cost_usd' in exportData.horizon_summary_kpis).toBe(false);

    // 9. Ensure no duplicate incentive assumptions at root of financial_assumptions
    expect('federal_tax_credit_pct' in exportData.financial_assumptions).toBe(false);
    expect('federal_tax_credit_realization_year' in exportData.financial_assumptions).toBe(false);
    expect('local_rebate_flat_usd' in exportData.financial_assumptions).toBe(false);
  });

  it('correctly exports financing reproducibility fields for financed vs cash scenarios', () => {
    // 1. Cash purchase
    const cashFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      isFinanced: false,
    };
    const cashAnalysis = calculate15YearFinancials(profile, dummySummary, cashFinancials);
    const cashExport = buildExportLlmJson({
      activeAnalysis: cashAnalysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: cashFinancials,
      csvResult: mockCsvResult,
    });

    expect(cashExport.financial_assumptions.financing.is_financed).toBe(false);
    expect(cashExport.financial_assumptions.financing.down_payment_usd).toBeNull();
    expect(cashExport.financial_assumptions.financing.total_loan_interest_usd).toBeNull();

    // 2. Financed purchase
    const financedFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      isFinanced: true,
      loanAprPercent: 6.5,
      loanTermYears: 10,
      loanDownPaymentPercent: 20,
    };
    const financedAnalysis = calculate15YearFinancials(profile, dummySummary, financedFinancials);
    const financedExport = buildExportLlmJson({
      activeAnalysis: financedAnalysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: financedFinancials,
      csvResult: mockCsvResult,
    });

    expect(financedExport.financial_assumptions.financing.is_financed).toBe(true);
    expect(financedExport.financial_assumptions.financing.down_payment_usd).toBe(financedAnalysis.upfrontOutOfPocket);
    expect(financedExport.financial_assumptions.financing.total_loan_interest_usd).toBe(financedAnalysis.totalLoanInterestPaid);
    expect(financedExport.financial_assumptions.cost_and_incentives.cash_due_at_purchase_usd).toBe(financedAnalysis.upfrontOutOfPocket);
  });

  it('sources application version directly from package.json without manual duplication', async () => {
    const pkg = await import('../../package.json');
    const { APP_VERSION } = await import('../version');

    expect(APP_VERSION).toBe(pkg.version);

    const analysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);
    const exportData = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: DEFAULT_MACRO_FINANCIALS,
      csvResult: mockCsvResult,
    });

    expect(exportData.metadata.app_version).toBe(pkg.version);
  });

  it('guarantees legacy battery-only export has strictly the established root sections with no generation sections', () => {
    const analysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);
    const exportData = buildExportLlmJson({
      activeAnalysis: analysis,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: DEFAULT_MACRO_FINANCIALS,
      csvResult: mockCsvResult,
    });

    const expectedRootKeys = [
      'metadata',
      'battery_configuration',
      'tariff_configuration',
      'financial_assumptions',
      'year_1_results',
      'horizon_summary_kpis',
      'annual_time_series',
    ];

    expect(Object.keys(exportData).sort()).toEqual(expectedRootKeys.sort());

    const payloadAny = exportData as any;
    expect(payloadAny.generation_configuration).toBeUndefined();
    expect(payloadAny.generation_year_1_results).toBeUndefined();
    expect(payloadAny.generation_project_costs).toBeUndefined();
    expect(payloadAny.generation_horizon_summary_kpis).toBeUndefined();
    expect(payloadAny.generation_annual_projection).toBeUndefined();
  });
});

describe('G4E — Generation JSON Export & Final Feature Integration', () => {
  const profile = DEFAULT_BATTERY_PROFILES[0];
  const touProfile = DEFAULT_TOU_PROFILES[0];
  const tiers = touProfile.tiers;

  const dummySummary: AnnualSimulationSummary = {
    profileId: profile.id,
    profileName: profile.name,
    totalIntervals: 8760,
    intervalHours: 1,
    totalHomeLoadKwh: 9000,
    baselineAnnualCost: 2400,
    simulatedAnnualCost: 1400,
    year1Savings: 1000,
    savingsPercentage: 41.7,
    annualGridImportKwh: 5500,
    annualGridExportKwh: 200,
    annualBatteryDischargedKwh: 3500,
    equivalentFullCycles: 260,
    maxPeakDemandKw: 7.2,
    intervalResults: [],
  };

  const mockCsvResult: CsvValidationResult = {
    isValid: true,
    errors: [],
    warnings: [],
    totalRows: 8760,
    validRows: 8760,
    totalKwh: 10000,
    intervalHours: 1,
    startDate: '2025-01-01 00:00',
    endDate: '2025-12-31 23:00',
    peakKw: 7.2,
    data: [],
    completeness: {
      startDate: '2025-01-01 00:00',
      endDate: '2025-12-31 23:00',
      intervalCount: 8760,
      intervalDurationHours: 1,
      durationDays: 365,
      expectedIntervalCount: 8760,
      missingIntervalCount: 0,
      isLeapYear: false,
      isSuitableForAnnualProjection: true,
    },
  };

  const solarArray1: SolarGenerationAsset = {
    ...(createDefaultAsset('solar', 'solar-array-1') as SolarGenerationAsset),
    name: 'Main Roof Array',
    enabled: true,
    resourceMode: 'monthly_peak_sun_hours',
    dcCapacityKw: 8.0,
    inverterAcCapacityKw: 7.6,
    inverterEfficiencyPercent: 96.5,
    tiltDegrees: 22,
    azimuthDegrees: 180,
    systemLossPercent: 14.0,
    shadingLossPercent: 2.0,
    annualDegradationPercent: 0.5,
    monthlyPeakSunHoursPerDay: [3.5, 4.0, 5.0, 6.0, 6.5, 7.0, 7.0, 6.5, 5.5, 4.5, 3.5, 3.0],
    installedCostUsd: 16000,
    annualMaintenanceCostUsd: 200,
  };

  const solarArray2: SolarGenerationAsset = {
    ...(createDefaultAsset('solar', 'solar-array-2') as SolarGenerationAsset),
    name: 'Garage Ground Mount',
    enabled: true,
    resourceMode: 'clear_sky',
    dcCapacityKw: 4.0,
    inverterAcCapacityKw: 3.8,
    inverterEfficiencyPercent: 97.0,
    tiltDegrees: 30,
    azimuthDegrees: 195,
    systemLossPercent: 10.0,
    shadingLossPercent: 0.0,
    annualDegradationPercent: 0.4,
    monthlyPeakSunHoursPerDay: [],
    installedCostUsd: 8000,
    annualMaintenanceCostUsd: 100,
  };

  const disabledSolarArray: SolarGenerationAsset = {
    ...(createDefaultAsset('solar', 'solar-array-disabled') as SolarGenerationAsset),
    name: 'Future Expansion Array',
    enabled: false,
    resourceMode: 'clear_sky',
    dcCapacityKw: 5.0,
    inverterAcCapacityKw: 4.5,
    inverterEfficiencyPercent: 96.0,
    tiltDegrees: 20,
    azimuthDegrees: 180,
    systemLossPercent: 14.0,
    shadingLossPercent: 0.0,
    annualDegradationPercent: 0.5,
    monthlyPeakSunHoursPerDay: [],
    installedCostUsd: 10000,
    annualMaintenanceCostUsd: 150,
  };

  const sampleGenerationConfig: GenerationConfig = {
    site: {
      latitude: 37.7749,
      longitude: -122.4194,
      timeZone: 'America/Los_Angeles',
      elevationM: 16,
    },
    assets: [solarArray1, solarArray2, disabledSolarArray],
  };

  const generationProjectCosts = aggregateGenerationProjectCosts(sampleGenerationConfig);

  const mockGenerationAwareResult: GenerationAwareSimulationResult = {
    totalIntervals: 8760,
    totalHomeLoadKwh: 10000,
    totalSolarGenerationKwh: 14500,
    totalSolarDirectToLoadKwh: 5200,
    totalSolarExportKwh: 4800,
    totalBatteryExportKwh: 350,
    totalGridImportKwh: 3600,
    totalGridExportKwh: 5150, // 4800 solar export + 350 battery export
    baselineCost: 3200,
    simulatedCost: 1100,
    netSavings: 2100,
    gridFlows: { totalCurtailedSolarKwh: 600 } as any,
    exportAwareBatteryFlow: {
      intervals: [
        { preExportFlow: { solarToBatteryAcKwh: 3900 } } as any,
      ],
    } as any,
  } as any;

  function createMockOperationalProjection(horizon = 25): GenerationOperationalProjection {
    const years: GenerationOperationalYear[] = [];
    for (let y = 1; y <= horizon; y++) {
      const degFactor1 = 1 - 0.005 * (y - 1);
      const degFactor2 = 1 - 0.004 * (y - 1);
      const battRetention = Math.max(0.7, 1 - 0.02 * (y - 1));

      years.push({
        year: y,
        baselineElectricityCostUsd: Math.round(3200 * Math.pow(1.03, y - 1) * 100) / 100,
        simulatedElectricityCostUsd: Math.round(1100 * Math.pow(1.03, y - 1) * 100) / 100,
        electricitySavingsUsd: Math.round(2100 * Math.pow(1.03, y - 1) * 100) / 100,
        solarGeneratedKwh: Math.round(14500 * degFactor1 * 10) / 10,
        solarDirectToLoadKwh: Math.round(5200 * degFactor1 * 10) / 10,
        solarToBatteryKwh: Math.round(3900 * degFactor1 * 10) / 10,
        solarExportKwh: Math.round(4800 * degFactor1 * 10) / 10,
        solarCurtailedKwh: 600,
        windGeneratedKwh: 0,
        windDirectToLoadKwh: 0,
        windToBatteryKwh: 0,
        windExportKwh: 0,
        windCurtailedKwh: 0,
        renewableGeneratedKwh: Math.round(14500 * degFactor1 * 10) / 10,
        renewableDirectToLoadKwh: Math.round(5200 * degFactor1 * 10) / 10,
        renewableToBatteryKwh: Math.round(3900 * degFactor1 * 10) / 10,
        renewableExportKwh: Math.round(4800 * degFactor1 * 10) / 10,
        renewableCurtailedKwh: 600,
        gridImportKwh: 3600,
        gridExportKwh: 5150,
        batteryExportKwh: 350,
        batteryDischargedKwh: 3200,
        equivalentFullCycles: 235,
        batteryCapacityRetentionFactor: battRetention,
        batteryUsableCapacityKwh: Math.round(13.5 * battRetention * 10) / 10,
        solarAssets: [
          { assetId: solarArray1.id, capacityRetentionFactor: degFactor1, effectiveDcCapacityKw: Math.round(8.0 * degFactor1 * 100) / 100 },
          { assetId: solarArray2.id, capacityRetentionFactor: degFactor2, effectiveDcCapacityKw: Math.round(4.0 * degFactor2 * 100) / 100 },
        ],
      });
    }
    return {
      horizonYears: horizon,
      years,
    };
  }

  const mockOperationalProjection25 = createMockOperationalProjection(25);

  const sampleFinancials = {
    ...DEFAULT_MACRO_FINANCIALS,
    localRebateFlat: 1000,
    federalTaxCreditPercent: 30,
    federalTaxCreditRealizationYear: 1,
    isFinanced: false,
  };

  const generationFinancialAnalysis = calculateGenerationAwareFinancials({
    batteryProfile: profile,
    operationalProjection: mockOperationalProjection25,
    projectCosts: generationProjectCosts,
    financials: sampleFinancials,
  });

  describe('Configuration', () => {
    it('1. Full-year generation export contains generation_configuration', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_configuration).toBeDefined();
    });

    it('1b. Metadata dataset summary reconciles with completeness or generationAwareResult', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.metadata.dataset_summary.total_intervals).toBe(8760);
      expect(exportData.metadata.dataset_summary.interval_duration_hours).toBe(1);
      expect(exportData.metadata.dataset_summary.duration_days).toBe(365);
      expect(exportData.metadata.dataset_summary.is_suitable_for_annual_projection).toBe(true);
    });

    it('2. Site values match GenerationConfig', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_configuration.site.latitude).toBe(37.7749);
      expect(exportData.generation_configuration.site.longitude).toBe(-122.4194);
      expect(exportData.generation_configuration.site.time_zone).toBe('America/Los_Angeles');
      expect(exportData.generation_configuration.site.elevation_m).toBe(16);
    });

    it('3. Solar export permission matches allowSolarExport', () => {
      const exportTrue = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });
      expect(exportTrue.generation_configuration.allow_solar_export).toBe(true);

      const exportFalse = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: false,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });
      expect(exportFalse.generation_configuration.allow_solar_export).toBe(false);
    });

    it('4. Enabled solar assets export their configured fields', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const a1 = exportData.generation_configuration.solar_arrays.find((a) => a.id === solarArray1.id);
      expect(a1).toBeDefined();
      expect(a1?.name).toBe('Main Roof Array');
      expect(a1?.resource_mode).toBe('monthly_peak_sun_hours');
      expect(a1?.dc_capacity_kw).toBe(8.0);
      expect(a1?.inverter_ac_capacity_kw).toBe(7.6);
      expect(a1?.inverter_efficiency_pct).toBe(96.5);
      expect(a1?.tilt_degrees).toBe(22);
      expect(a1?.azimuth_degrees).toBe(180);
      expect(a1?.system_loss_pct).toBe(14.0);
      expect(a1?.shading_loss_pct).toBe(2.0);
      expect(a1?.annual_degradation_pct).toBe(0.5);
    });

    it('5. Disabled solar assets are excluded from active generation configuration', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const disabled = exportData.generation_configuration.solar_arrays.find((a) => a.id === disabledSolarArray.id);
      expect(disabled).toBeUndefined();
      expect(exportData.generation_configuration.solar_arrays).toHaveLength(2);
    });

    it('6. Multiple enabled solar arrays remain distinct', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_configuration.solar_arrays).toHaveLength(2);
      expect(exportData.generation_configuration.solar_arrays[0].id).toBe(solarArray1.id);
      expect(exportData.generation_configuration.solar_arrays[1].id).toBe(solarArray2.id);
    });

    it('7. Monthly PSH values are preserved for monthly-PSH assets', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const a1 = exportData.generation_configuration.solar_arrays.find((a) => a.id === solarArray1.id);
      expect(a1?.monthly_peak_sun_hours_per_day).toEqual(solarArray1.monthlyPeakSunHoursPerDay);
    });
  });

  describe('Year 1 Operational Results', () => {
    const exportData = buildGenerationExportLlmJson({
      generationConfig: sampleGenerationConfig,
      allowSolarExport: true,
      generationAwareResult: mockGenerationAwareResult,
      operationalProjection: mockOperationalProjection25,
      generationAnalysis: generationFinancialAnalysis,
      generationProjectCosts,
      projectionHorizon: 15,
      tiers,
      activeTouProfile: touProfile,
      financials: sampleFinancials,
      csvResult: mockCsvResult,
    });

    const opDisplay = deriveGenerationOperationalDisplayMetrics(mockGenerationAwareResult);

    it('8. Solar generation matches the G3 result/adapter', () => {
      expect(exportData.generation_year_1_results.solar_generated_kwh).toBe(opDisplay.solarGeneratedKwh);
      expect(exportData.generation_year_1_results.solar_generated_kwh).toBe(14500);
    });

    it('9. Solar direct-to-load matches G3', () => {
      expect(exportData.generation_year_1_results.solar_direct_to_load_kwh).toBe(opDisplay.solarDirectToLoadKwh);
      expect(exportData.generation_year_1_results.solar_direct_to_load_kwh).toBe(5200);
    });

    it('10. Solar-to-battery matches authoritative interval-derived AC flow', () => {
      expect(exportData.generation_year_1_results.solar_to_battery_ac_kwh).toBe(opDisplay.solarToBatteryAcKwh);
      expect(exportData.generation_year_1_results.solar_to_battery_ac_kwh).toBe(3900);
    });

    it('11. Solar export matches G3', () => {
      expect(exportData.generation_year_1_results.solar_export_kwh).toBe(opDisplay.solarExportKwh);
      expect(exportData.generation_year_1_results.solar_export_kwh).toBe(4800);
    });

    it('12. Solar curtailment matches G3', () => {
      expect(exportData.generation_year_1_results.solar_curtailed_kwh).toBe(opDisplay.solarCurtailedKwh);
      expect(exportData.generation_year_1_results.solar_curtailed_kwh).toBe(600);
    });

    it('13. Grid import matches G3', () => {
      expect(exportData.generation_year_1_results.grid_import_kwh).toBe(opDisplay.gridImportKwh);
      expect(exportData.generation_year_1_results.grid_import_kwh).toBe(3600);
    });

    it('14. Total grid export matches G3', () => {
      expect(exportData.generation_year_1_results.grid_export_kwh).toBe(opDisplay.gridExportKwh);
      expect(exportData.generation_year_1_results.grid_export_kwh).toBe(5150);
    });

    it('15. Battery export matches G3 and remains distinct from solar export', () => {
      expect(exportData.generation_year_1_results.battery_export_kwh).toBe(opDisplay.batteryExportKwh);
      expect(exportData.generation_year_1_results.battery_export_kwh).toBe(350);
      expect(exportData.generation_year_1_results.battery_export_kwh).not.toBe(exportData.generation_year_1_results.solar_export_kwh);
    });

    it('16. Year-1 electricity savings matches G3', () => {
      expect(exportData.generation_year_1_results.electricity_savings_usd).toBe(opDisplay.electricitySavingsUsd);
      expect(exportData.generation_year_1_results.electricity_savings_usd).toBe(2100);
    });
  });

  describe('Costs and Financing', () => {
    it('17. Battery CAPEX matches G4C', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_project_costs.battery_capex_usd).toBe(generationFinancialAnalysis.batteryCapexUsd);
      expect(exportData.generation_project_costs.battery_capex_usd).toBe(profile.installedCost);
    });

    it('18. Generation CAPEX matches G4C/G4A', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_project_costs.generation_capex_usd).toBe(generationFinancialAnalysis.generationCapexUsd);
      expect(exportData.generation_project_costs.generation_capex_usd).toBe(24000); // 16000 + 8000
    });

    it('19. Gross project CAPEX matches G4C and counts generation exactly once', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const costs = exportData.generation_project_costs;
      expect(costs.gross_project_capex_usd).toBe(generationFinancialAnalysis.grossProjectCapexUsd);
      expect(costs.gross_project_capex_usd).toBe(costs.battery_capex_usd + costs.generation_capex_usd);
    });

    it('20. Disabled asset costs do not enter generation CAPEX', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_project_costs.generation_capex_usd).toBe(24000);
      const disabledInBreakdown = exportData.generation_project_costs.generation_assets.find(
        (a) => a.id === disabledSolarArray.id
      );
      expect(disabledInBreakdown).toBeUndefined();
    });

    it('21. Annual generation O&M matches G4C/G4A', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_project_costs.annual_generation_om_usd).toBe(generationFinancialAnalysis.annualGenerationMaintenanceUsd);
      expect(exportData.generation_project_costs.annual_generation_om_usd).toBe(300); // 200 + 100
    });

    it('22. Net installed cost matches G4C', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_project_costs.net_installed_project_cost_usd).toBe(
        generationFinancialAnalysis.netInstalledProjectCostUsd
      );
    });

    it('23. Financing values match G4C for financed project', () => {
      const financedFinancials = {
        ...sampleFinancials,
        isFinanced: true,
        loanAprPercent: 6.5,
        loanTermYears: 10,
        loanDownPaymentPercent: 15,
      };

      const financedAnalysis = calculateGenerationAwareFinancials({
        batteryProfile: profile,
        operationalProjection: mockOperationalProjection25,
        projectCosts: generationProjectCosts,
        financials: financedFinancials,
      });

      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: financedAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: financedFinancials,
        csvResult: mockCsvResult,
      });

      const costs = exportData.generation_project_costs;
      expect(costs.is_financed).toBe(true);
      expect(costs.loan_principal_usd).toBe(financedAnalysis.loanPrincipalUsd);
      expect(costs.monthly_loan_payment_usd).toBe(financedAnalysis.monthlyLoanPaymentUsd);
      expect(costs.total_loan_payments_usd).toBe(financedAnalysis.totalLoanPaymentsUsd);
      expect(costs.total_loan_interest_usd).toBe(financedAnalysis.totalLoanInterestUsd);
    });

    it('24. Incentive values match G4C', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const costs = exportData.generation_project_costs;
      expect(costs.immediate_rebate_usd).toBe(generationFinancialAnalysis.immediateRebateUsd);
      expect(costs.deferred_federal_tax_credit_usd).toBe(generationFinancialAnalysis.deferredFederalTaxCreditUsd);
      expect(costs.total_incentives_usd).toBe(generationFinancialAnalysis.incentivesAmountUsd);
    });
  });

  describe('Annual Projection', () => {
    it('25. Selected horizon controls annual row count', () => {
      const export15 = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });
      expect(export15.generation_annual_projection).toHaveLength(15);

      const export25 = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 25,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });
      expect(export25.generation_annual_projection).toHaveLength(25);
    });

    it('26. G4B solar generation is exported unchanged', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        expect(row.solar_generation_kwh).toBe(mockOperationalProjection25.years[idx].solarGeneratedKwh);
      });
    });

    it('27. Per-array solar retention is exported without fleet averaging', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const year5 = exportData.generation_annual_projection[4];
      expect(year5.solar_assets).toHaveLength(2);
      expect(year5.solar_assets[0].asset_id).toBe(solarArray1.id);
      expect(year5.solar_assets[0].capacity_retention_factor).toBe(1 - 0.005 * 4);
      expect(year5.solar_assets[1].asset_id).toBe(solarArray2.id);
      expect(year5.solar_assets[1].capacity_retention_factor).toBe(1 - 0.004 * 4);
      expect(year5.solar_assets[0].capacity_retention_factor).not.toBe(year5.solar_assets[1].capacity_retention_factor);
    });

    it('28. Battery retention is exported unchanged', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        const opY = mockOperationalProjection25.years[idx];
        expect(row.battery_capacity_retention_factor).toBe(opY.batteryCapacityRetentionFactor);
        expect(row.battery_usable_capacity_kwh).toBe(opY.batteryUsableCapacityKwh);
      });
    });

    it('29. Baseline and modeled electricity costs match G4B/G4C', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        const finY = generationFinancialAnalysis.projections[idx];
        expect(row.baseline_electricity_cost_usd).toBe(finY.baselineElectricityCostUsd);
        expect(row.modeled_project_electricity_cost_usd).toBe(finY.modeledProjectElectricityCostUsd);
      });
    });

    it('30. Electricity savings match G4B/G4C', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        const finY = generationFinancialAnalysis.projections[idx];
        expect(row.electricity_savings_usd).toBe(finY.electricitySavingsUsd);
      });
    });

    it('31. Generation O&M matches G4C annual financial row', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        const finY = generationFinancialAnalysis.projections[idx];
        expect(row.generation_om_usd).toBe(finY.generationMaintenanceUsd);
      });
    });

    it('32. Project annual cash flow matches G4C', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        const finY = generationFinancialAnalysis.projections[idx];
        expect(row.project_annual_cash_flow_usd).toBe(finY.netProjectCashFlowUsd);
      });
    });

    it('33. Cumulative cash flow matches G4C', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        const finY = generationFinancialAnalysis.projections[idx];
        expect(row.cumulative_project_cash_flow_usd).toBe(finY.cumulativeCashFlowUsd);
      });
    });

    it('34. Cumulative NPV matches G4C', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        const finY = generationFinancialAnalysis.projections[idx];
        expect(row.cumulative_npv_usd).toBe(finY.cumulativeNpvUsd);
      });
    });

    it('35. Mismatched operational/financial year records are rejected rather than silently paired', () => {
      const corruptedOperational = createMockOperationalProjection(25);
      // Offset year on index 2 to year 4 instead of 3
      corruptedOperational.years[2].year = 4;

      expect(() => {
        buildGenerationExportLlmJson({
          generationConfig: sampleGenerationConfig,
          allowSolarExport: true,
          generationAwareResult: mockGenerationAwareResult,
          operationalProjection: corruptedOperational,
          generationAnalysis: generationFinancialAnalysis,
          generationProjectCosts,
          projectionHorizon: 15,
          tiers,
          activeTouProfile: touProfile,
          financials: sampleFinancials,
          csvResult: mockCsvResult,
        });
      }).toThrow(/mismatch at index 2/i);
    });
  });

  describe('Horizon Summary', () => {
    it('36. 15-year generation export uses Year-15 selected-horizon values', () => {
      const export15 = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const y15 = generationFinancialAnalysis.projections[14];
      expect(export15.generation_horizon_summary_kpis.horizon_years).toBe(15);
      expect(export15.generation_horizon_summary_kpis.horizon_net_present_value_usd).toBe(y15.cumulativeNpvUsd);
      expect(export15.generation_horizon_summary_kpis.horizon_cumulative_project_cash_flow_usd).toBe(y15.cumulativeCashFlowUsd);
    });

    it('37. 25-year generation export uses Year-25 values', () => {
      const export25 = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 25,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const y25 = generationFinancialAnalysis.projections[24];
      expect(export25.generation_horizon_summary_kpis.horizon_years).toBe(25);
      expect(export25.generation_horizon_summary_kpis.horizon_net_present_value_usd).toBe(y25.cumulativeNpvUsd);
      expect(export25.generation_horizon_summary_kpis.horizon_cumulative_project_cash_flow_usd).toBe(y25.cumulativeCashFlowUsd);
    });

    it('38. Horizon NPV reconciles with deriveGenerationHorizonFinancialSummary(...)', () => {
      const export15 = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const summary15 = deriveGenerationHorizonFinancialSummary(generationFinancialAnalysis, 15);
      expect(export15.generation_horizon_summary_kpis.horizon_net_present_value_usd).toBe(summary15.netPresentValue);
    });

    it('39. Horizon ROI reconciles with the same helper', () => {
      const export15 = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const summary15 = deriveGenerationHorizonFinancialSummary(generationFinancialAnalysis, 15);
      expect(export15.generation_horizon_summary_kpis.horizon_roi_pct).toBe(summary15.horizonRoiPercent);
    });

    it('40. Opportunity-cost values reconcile with the same helper', () => {
      const export15 = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const summary15 = deriveGenerationHorizonFinancialSummary(generationFinancialAnalysis, 15);
      expect(export15.generation_horizon_summary_kpis.opportunity_cost_future_value_usd).toBe(summary15.opportunityCostFutureValue);
      expect(export15.generation_horizon_summary_kpis.opportunity_cost_profit_usd).toBe(summary15.opportunityCostProfit);
      expect(export15.generation_horizon_summary_kpis.project_vs_opportunity_cost_usd).toBe(summary15.opportunityCostDiff);
    });
  });

  describe('Guards / Compatibility', () => {
    it('41. Partial-period generation export is rejected/disabled', () => {
      const partialCsvResult: CsvValidationResult = {
        ...mockCsvResult,
        completeness: {
          ...mockCsvResult.completeness!,
          isSuitableForAnnualProjection: false,
          reason: 'Dataset is only 30 days',
        },
      };

      expect(
        canExportGenerationProjectionsJson({
          generationAnalysis: generationFinancialAnalysis,
          operationalProjection: mockOperationalProjection25,
          generationAwareResult: mockGenerationAwareResult,
          generationProjectCosts,
          csvResult: partialCsvResult,
          analysisState: 'partial-period',
        })
      ).toBe(false);

      expect(() => {
        buildGenerationExportLlmJson({
          generationConfig: sampleGenerationConfig,
          allowSolarExport: true,
          generationAwareResult: mockGenerationAwareResult,
          operationalProjection: mockOperationalProjection25,
          generationAnalysis: generationFinancialAnalysis,
          generationProjectCosts,
          projectionHorizon: 15,
          tiers,
          activeTouProfile: touProfile,
          financials: sampleFinancials,
          csvResult: partialCsvResult,
        });
      }).toThrow(/incomplete or partial-period/i);
    });

    it('42. generation-financial-pending cannot produce a generation lifecycle export', () => {
      expect(
        canExportGenerationProjectionsJson({
          generationAnalysis: null,
          operationalProjection: mockOperationalProjection25,
          generationAwareResult: mockGenerationAwareResult,
          generationProjectCosts,
          csvResult: mockCsvResult,
          analysisState: 'generation-financial-pending',
        })
      ).toBe(false);
    });

    it('43. Legacy battery-only export shape remains unchanged', () => {
      const legacyAnalysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);
      const legacyExport = buildExportLlmJson({
        activeAnalysis: legacyAnalysis,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: DEFAULT_MACRO_FINANCIALS,
        csvResult: mockCsvResult,
      });

      expect(Object.keys(legacyExport)).toEqual([
        'metadata',
        'battery_configuration',
        'tariff_configuration',
        'financial_assumptions',
        'year_1_results',
        'horizon_summary_kpis',
        'annual_time_series',
      ]);
    });

    it('44. Legacy battery-only value tests continue passing', () => {
      const legacyAnalysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);
      const legacyExport = buildExportLlmJson({
        activeAnalysis: legacyAnalysis,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: DEFAULT_MACRO_FINANCIALS,
        csvResult: mockCsvResult,
      });

      expect(legacyExport.year_1_results.baseline_electricity_cost_usd).toBe(dummySummary.baselineAnnualCost);
      expect(legacyExport.battery_configuration.profile_name).toBe(profile.name);
    });

    it('45. Generation export does not invoke or depend on calculate15YearFinancials()', () => {
      const spy = vi.spyOn(simEngine, 'calculate15YearFinancials');

      buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    });

    it('46. Resilience critical_home_load_kw comes directly from financials and remains distinct from battery max continuous discharge', () => {
      const customBatteryProfile = {
        ...profile,
        maxContinuousOutputKw: 11.5,
      };

      const customFinancials = {
        ...sampleFinancials,
        criticalLoadPowerKw: 2.75,
      };

      const customAnalysis = calculateGenerationAwareFinancials({
        batteryProfile: customBatteryProfile,
        operationalProjection: mockOperationalProjection25,
        projectCosts: generationProjectCosts,
        financials: customFinancials,
      });

      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: customAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: customFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.battery_configuration.max_continuous_discharge_kw).toBe(11.5);
      expect(exportData.financial_assumptions.resilience.critical_home_load_kw).toBe(2.75);
      expect(exportData.financial_assumptions.resilience.critical_home_load_kw).not.toBe(
        exportData.battery_configuration.max_continuous_discharge_kw
      );
    });
  });

  describe('G5F — Wind JSON Export & Final Feature Integration', () => {
    const sampleWindTurbineAnnual: WindGenerationAsset = {
      id: 'wind-turbine-1',
      name: 'North Ridge Turbine',
      enabled: true,
      type: 'wind',
      installedCostUsd: 15000,
      annualMaintenanceCostUsd: 300,
      ratedPowerKw: 6.0,
      hubHeightM: 18,
      rotorDiameterM: 5.5,
      cutInWindSpeedMps: 2.5,
      ratedWindSpeedMps: 11.0,
      cutOutWindSpeedMps: 22.0,
      availabilityPercent: 97.5,
      systemLossPercent: 12.0,
      resourceMode: 'annual_average',
      measurementHeightM: 10,
      windShearExponent: 0.16,
      annualAverageWindSpeedMps: 6.2,
      monthlyAverageWindSpeedMps: [6.0, 6.1, 6.3, 6.4, 6.2, 5.8, 5.5, 5.7, 6.0, 6.3, 6.5, 6.6],
      powerCurve: [
        { windSpeedMps: 0, outputKw: 0 },
        { windSpeedMps: 2.5, outputKw: 0.1 },
        { windSpeedMps: 5.0, outputKw: 1.2 },
        { windSpeedMps: 8.0, outputKw: 3.5 },
        { windSpeedMps: 11.0, outputKw: 6.0 },
        { windSpeedMps: 15.0, outputKw: 6.0 },
        { windSpeedMps: 22.0, outputKw: 0 },
      ],
    };

    const sampleWindTurbineMonthly: WindGenerationAsset = {
      ...sampleWindTurbineAnnual,
      id: 'wind-turbine-monthly',
      name: 'Coastal Monthly Turbine',
      resourceMode: 'monthly_average',
      annualAverageWindSpeedMps: null,
      monthlyAverageWindSpeedMps: [5.2, 5.4, 5.9, 6.1, 5.8, 4.9, 4.5, 4.7, 5.1, 5.6, 6.0, 6.2],
    };

    const sampleWindConfigAnnual: GenerationConfig = {
      site: {
        latitude: 42.123,
        longitude: -71.456,
        timeZone: 'America/New_York',
        elevationM: 120,
      },
      assets: [sampleWindTurbineAnnual],
    };

    const sampleWindConfigMonthly: GenerationConfig = {
      site: {
        latitude: 42.123,
        longitude: -71.456,
        timeZone: 'America/New_York',
        elevationM: 120,
      },
      assets: [sampleWindTurbineMonthly],
    };

    const sampleMixedConfig: GenerationConfig = {
      site: {
        latitude: 37.7749,
        longitude: -122.4194,
        timeZone: 'America/Los_Angeles',
        elevationM: 16,
      },
      assets: [solarArray1, solarArray2, sampleWindTurbineAnnual, disabledSolarArray],
    };

    const mockMixedGenerationAwareResult: GenerationAwareSimulationResult = {
      totalIntervals: 8760,
      totalHomeLoadKwh: 12000,

      totalSolarGenerationKwh: 14000,
      totalSolarDirectToLoadKwh: 5000,
      totalSolarExportKwh: 4500,
      totalSolarCurtailedKwh: 500,
      totalSolarToBatteryKwh: 4000,

      totalWindGenerationKwh: 8000,
      totalWindDirectToLoadKwh: 3500,
      totalWindExportKwh: 2000,
      totalWindCurtailedKwh: 300,
      totalWindToBatteryKwh: 2200,

      totalRenewableGenerationKwh: 22000,
      totalRenewableDirectToLoadKwh: 8500,
      totalRenewableExportKwh: 6500,
      totalRenewableCurtailedKwh: 800,
      totalRenewableToBatteryKwh: 6200,

      totalBatteryExportKwh: 400,
      totalGridImportKwh: 3500,
      totalGridExportKwh: 6900,

      baselineCost: 3600,
      simulatedCost: 1200,
      netSavings: 2400,
      gridFlows: {
        totalCurtailedSolarKwh: 500,
        totalCurtailedWindKwh: 300,
        totalCurtailedRenewableKwh: 800,
      } as any,
      exportAwareBatteryFlow: {
        intervals: [
          { preExportFlow: { solarToBatteryAcKwh: 4000, windToBatteryAcKwh: 2200, renewableToBatteryAcKwh: 6200 } } as any,
        ],
      } as any,
    } as any;

    const mockWindOnlyGenerationAwareResult: GenerationAwareSimulationResult = {
      totalIntervals: 8760,
      totalHomeLoadKwh: 10000,

      totalSolarGenerationKwh: 0,
      totalSolarDirectToLoadKwh: 0,
      totalSolarExportKwh: 0,
      totalSolarCurtailedKwh: 0,
      totalSolarToBatteryKwh: 0,

      totalWindGenerationKwh: 9500,
      totalWindDirectToLoadKwh: 4200,
      totalWindExportKwh: 2500,
      totalWindCurtailedKwh: 400,
      totalWindToBatteryKwh: 2400,

      totalRenewableGenerationKwh: 9500,
      totalRenewableDirectToLoadKwh: 4200,
      totalRenewableExportKwh: 2500,
      totalRenewableCurtailedKwh: 400,
      totalRenewableToBatteryKwh: 2400,

      totalBatteryExportKwh: 300,
      totalGridImportKwh: 3400,
      totalGridExportKwh: 2800,

      baselineCost: 3000,
      simulatedCost: 1100,
      netSavings: 1900,
      gridFlows: {
        totalCurtailedSolarKwh: 0,
        totalCurtailedWindKwh: 400,
        totalCurtailedRenewableKwh: 400,
      } as any,
      exportAwareBatteryFlow: {
        intervals: [
          { preExportFlow: { solarToBatteryAcKwh: 0, windToBatteryAcKwh: 2400, renewableToBatteryAcKwh: 2400 } } as any,
        ],
      } as any,
    } as any;

    function createMockMixedOperationalProjection(horizon = 25): GenerationOperationalProjection {
      const years: GenerationOperationalYear[] = [];
      for (let y = 1; y <= horizon; y++) {
        const degFactorSolar = 1 - 0.005 * (y - 1);
        const battRetention = Math.max(0.7, 1 - 0.02 * (y - 1));

        const solarGen = Math.round(14000 * degFactorSolar * 10) / 10;
        const solarDirect = Math.round(5000 * degFactorSolar * 10) / 10;
        const solarBatt = Math.round(4000 * degFactorSolar * 10) / 10;
        const solarExport = Math.round(4500 * degFactorSolar * 10) / 10;
        const solarCurt = 500;

        const windGen = 8000;
        const windDirect = 3500;
        const windBatt = 2200;
        const windExport = 2000;
        const windCurt = 300;

        const renewGen = Math.round((solarGen + windGen) * 10) / 10;
        const renewDirect = Math.round((solarDirect + windDirect) * 10) / 10;
        const renewBatt = Math.round((solarBatt + windBatt) * 10) / 10;
        const renewExport = Math.round((solarExport + windExport) * 10) / 10;
        const renewCurt = solarCurt + windCurt;

        years.push({
          year: y,
          baselineElectricityCostUsd: Math.round(3600 * Math.pow(1.03, y - 1) * 100) / 100,
          simulatedElectricityCostUsd: Math.round(1200 * Math.pow(1.03, y - 1) * 100) / 100,
          electricitySavingsUsd: Math.round(2400 * Math.pow(1.03, y - 1) * 100) / 100,
          solarGeneratedKwh: solarGen,
          solarDirectToLoadKwh: solarDirect,
          solarToBatteryKwh: solarBatt,
          solarExportKwh: solarExport,
          solarCurtailedKwh: solarCurt,
          windGeneratedKwh: windGen,
          windDirectToLoadKwh: windDirect,
          windToBatteryKwh: windBatt,
          windExportKwh: windExport,
          windCurtailedKwh: windCurt,
          renewableGeneratedKwh: renewGen,
          renewableDirectToLoadKwh: renewDirect,
          renewableToBatteryKwh: renewBatt,
          renewableExportKwh: renewExport,
          renewableCurtailedKwh: renewCurt,
          gridImportKwh: 3500,
          gridExportKwh: Math.round((renewExport + 400) * 10) / 10,
          batteryExportKwh: 400,
          batteryDischargedKwh: 3600,
          equivalentFullCycles: 260,
          batteryCapacityRetentionFactor: battRetention,
          batteryUsableCapacityKwh: Math.round(13.5 * battRetention * 10) / 10,
          solarAssets: [
            { assetId: solarArray1.id, capacityRetentionFactor: degFactorSolar, effectiveDcCapacityKw: Math.round(8.0 * degFactorSolar * 100) / 100 },
          ],
        });
      }
      return { horizonYears: horizon, years };
    }

    function createMockWindOnlyOperationalProjection(horizon = 25): GenerationOperationalProjection {
      const years: GenerationOperationalYear[] = [];
      for (let y = 1; y <= horizon; y++) {
        const battRetention = Math.max(0.7, 1 - 0.02 * (y - 1));
        years.push({
          year: y,
          baselineElectricityCostUsd: Math.round(3000 * Math.pow(1.03, y - 1) * 100) / 100,
          simulatedElectricityCostUsd: Math.round(1100 * Math.pow(1.03, y - 1) * 100) / 100,
          electricitySavingsUsd: Math.round(1900 * Math.pow(1.03, y - 1) * 100) / 100,
          solarGeneratedKwh: 0,
          solarDirectToLoadKwh: 0,
          solarToBatteryKwh: 0,
          solarExportKwh: 0,
          solarCurtailedKwh: 0,
          windGeneratedKwh: 9500,
          windDirectToLoadKwh: 4200,
          windToBatteryKwh: 2400,
          windExportKwh: 2500,
          windCurtailedKwh: 400,
          renewableGeneratedKwh: 9500,
          renewableDirectToLoadKwh: 4200,
          renewableToBatteryKwh: 2400,
          renewableExportKwh: 2500,
          renewableCurtailedKwh: 400,
          gridImportKwh: 3400,
          gridExportKwh: 2800,
          batteryExportKwh: 300,
          batteryDischargedKwh: 3000,
          equivalentFullCycles: 220,
          batteryCapacityRetentionFactor: battRetention,
          batteryUsableCapacityKwh: Math.round(13.5 * battRetention * 10) / 10,
          solarAssets: [],
        });
      }
      return { horizonYears: horizon, years };
    }

    const mockMixedOperationalProjection25 = createMockMixedOperationalProjection(25);
    const mockWindOnlyOperationalProjection25 = createMockWindOnlyOperationalProjection(25);

    const mixedProjectCosts = aggregateGenerationProjectCosts(sampleMixedConfig);
    const mixedFinancialAnalysis = calculateGenerationAwareFinancials({
      batteryProfile: profile,
      operationalProjection: mockMixedOperationalProjection25,
      projectCosts: mixedProjectCosts,
      financials: sampleFinancials,
    });

    const windOnlyProjectCosts = aggregateGenerationProjectCosts(sampleWindConfigAnnual);
    const windOnlyFinancialAnalysis = calculateGenerationAwareFinancials({
      batteryProfile: profile,
      operationalProjection: mockWindOnlyOperationalProjection25,
      projectCosts: windOnlyProjectCosts,
      financials: sampleFinancials,
    });

    it('1. Legacy no-generation export unchanged', () => {
      const legacyAnalysis = calculate15YearFinancials(profile, dummySummary, DEFAULT_MACRO_FINANCIALS);
      const legacyExport = buildExportLlmJson({
        activeAnalysis: legacyAnalysis,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: DEFAULT_MACRO_FINANCIALS,
        csvResult: mockCsvResult,
      });

      expect((legacyExport as any).wind_turbines).toBeUndefined();
      expect((legacyExport.year_1_results as any).wind_generated_kwh).toBeUndefined();
      expect((legacyExport.year_1_results as any).renewable_generated_kwh).toBeUndefined();
      expect(legacyExport.battery_configuration.profile_name).toBe(profile.name);
      expect(legacyExport.annual_time_series).toHaveLength(15);
    });

    it('2. Solar-only generation export compatibility', () => {
      const solarExport = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(solarExport.generation_configuration.solar_arrays).toHaveLength(2);
      expect(solarExport.generation_configuration.allow_solar_export).toBe(true);
      expect(solarExport.generation_year_1_results.solar_generated_kwh).toBe(14500);
      expect(solarExport.generation_year_1_results.solar_direct_to_load_kwh).toBe(5200);
      expect(solarExport.generation_annual_projection).toHaveLength(15);
      expect(solarExport.generation_annual_projection[0].solar_generation_kwh).toBe(14500);
    });

    it('3. Solar-only export does not emit unnecessary wind sections', () => {
      const solarExport = buildGenerationExportLlmJson({
        generationConfig: sampleGenerationConfig,
        allowSolarExport: true,
        generationAwareResult: mockGenerationAwareResult,
        operationalProjection: mockOperationalProjection25,
        generationAnalysis: generationFinancialAnalysis,
        generationProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(solarExport.generation_configuration.wind_turbines).toBeUndefined();
      expect(solarExport.generation_configuration.allow_renewable_export).toBeUndefined();
      expect(solarExport.generation_year_1_results.wind_generated_kwh).toBeUndefined();
      expect(solarExport.generation_year_1_results.wind_direct_to_load_kwh).toBeUndefined();
      expect(solarExport.generation_year_1_results.wind_export_kwh).toBeUndefined();
      expect(solarExport.generation_year_1_results.wind_curtailed_kwh).toBeUndefined();
      expect(solarExport.generation_year_1_results.renewable_generated_kwh).toBeUndefined();

      solarExport.generation_annual_projection.forEach((row) => {
        expect(row.wind_generation_kwh).toBeUndefined();
        expect(row.wind_direct_to_load_kwh).toBeUndefined();
        expect(row.renewable_generation_kwh).toBeUndefined();
      });
    });

    it('4. Wind-only configuration export', () => {
      const windExport = buildGenerationExportLlmJson({
        generationConfig: sampleWindConfigAnnual,
        allowRenewableExport: true,
        generationAwareResult: mockWindOnlyGenerationAwareResult,
        operationalProjection: mockWindOnlyOperationalProjection25,
        generationAnalysis: windOnlyFinancialAnalysis,
        generationProjectCosts: windOnlyProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(windExport.generation_configuration.solar_arrays).toEqual([]);
      expect(windExport.generation_configuration.enabled_solar_arrays).toEqual([]);
      expect(windExport.generation_configuration.wind_turbines).toHaveLength(1);
      expect(windExport.generation_configuration.allow_renewable_export).toBe(true);

      const turbine = windExport.generation_configuration.wind_turbines![0];
      expect(turbine.id).toBe('wind-turbine-1');
      expect(turbine.name).toBe('North Ridge Turbine');
      expect(turbine.rated_power_kw).toBe(6.0);
      expect(turbine.hub_height_m).toBe(18);
      expect(turbine.rotor_diameter_m).toBe(5.5);
      expect(turbine.cut_in_wind_speed_mps).toBe(2.5);
      expect(turbine.rated_wind_speed_mps).toBe(11.0);
      expect(turbine.cut_out_wind_speed_mps).toBe(22.0);
      expect(turbine.availability_pct).toBe(97.5);
      expect(turbine.system_loss_pct).toBe(12.0);
      expect(turbine.measurement_height_m).toBe(10);
      expect(turbine.wind_shear_exponent).toBe(0.16);
    });

    it('5. Mixed solar/wind configuration export', () => {
      const mixedExport = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(mixedExport.generation_configuration.solar_arrays).toHaveLength(2);
      expect(mixedExport.generation_configuration.wind_turbines).toHaveLength(1);
      expect(mixedExport.generation_configuration.wind_turbines![0].id).toBe('wind-turbine-1');
    });

    it('6. Annual-average resource faithfully exported', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleWindConfigAnnual,
        allowRenewableExport: true,
        generationAwareResult: mockWindOnlyGenerationAwareResult,
        operationalProjection: mockWindOnlyOperationalProjection25,
        generationAnalysis: windOnlyFinancialAnalysis,
        generationProjectCosts: windOnlyProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const turbine = exportData.generation_configuration.wind_turbines![0];
      expect(turbine.resource_mode).toBe('annual_average');
      expect(turbine.annual_average_wind_speed_mps).toBe(6.2);
      expect(turbine.monthly_average_wind_speed_mps).toBeUndefined();
    });

    it('7. Monthly-average 12-value resource faithfully exported', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleWindConfigMonthly,
        allowRenewableExport: true,
        generationAwareResult: mockWindOnlyGenerationAwareResult,
        operationalProjection: mockWindOnlyOperationalProjection25,
        generationAnalysis: windOnlyFinancialAnalysis,
        generationProjectCosts: windOnlyProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const turbine = exportData.generation_configuration.wind_turbines![0];
      expect(turbine.resource_mode).toBe('monthly_average');
      expect(turbine.monthly_average_wind_speed_mps).toEqual([
        5.2, 5.4, 5.9, 6.1, 5.8, 4.9, 4.5, 4.7, 5.1, 5.6, 6.0, 6.2,
      ]);
      expect(turbine.annual_average_wind_speed_mps).toBeUndefined();
    });

    it('8. Manufacturer power curve faithfully exported', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleWindConfigAnnual,
        allowRenewableExport: true,
        generationAwareResult: mockWindOnlyGenerationAwareResult,
        operationalProjection: mockWindOnlyOperationalProjection25,
        generationAnalysis: windOnlyFinancialAnalysis,
        generationProjectCosts: windOnlyProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const turbine = exportData.generation_configuration.wind_turbines![0];
      expect(turbine.power_curve).toEqual([
        { wind_speed_mps: 0, output_kw: 0 },
        { wind_speed_mps: 2.5, output_kw: 0.1 },
        { wind_speed_mps: 5.0, output_kw: 1.2 },
        { wind_speed_mps: 8.0, output_kw: 3.5 },
        { wind_speed_mps: 11.0, output_kw: 6.0 },
        { wind_speed_mps: 15.0, output_kw: 6.0 },
        { wind_speed_mps: 22.0, output_kw: 0 },
      ]);
    });

    it('9. Wind installed cost exported from configuration', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleWindConfigAnnual,
        allowRenewableExport: true,
        generationAwareResult: mockWindOnlyGenerationAwareResult,
        operationalProjection: mockWindOnlyOperationalProjection25,
        generationAnalysis: windOnlyFinancialAnalysis,
        generationProjectCosts: windOnlyProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const turbine = exportData.generation_configuration.wind_turbines![0];
      expect(turbine.installed_cost_usd).toBe(15000);
    });

    it('10. Wind annual maintenance exported from configuration', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleWindConfigAnnual,
        allowRenewableExport: true,
        generationAwareResult: mockWindOnlyGenerationAwareResult,
        operationalProjection: mockWindOnlyOperationalProjection25,
        generationAnalysis: windOnlyFinancialAnalysis,
        generationProjectCosts: windOnlyProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const turbine = exportData.generation_configuration.wind_turbines![0];
      expect(turbine.annual_maintenance_cost_usd).toBe(300);
    });

    it('11. Renewable export permission represented correctly for wind-enabled project', () => {
      // Precedence: allowRenewableExport takes precedence over allowSolarExport
      const exportFalse = buildGenerationExportLlmJson({
        generationConfig: sampleWindConfigAnnual,
        allowSolarExport: true,
        allowRenewableExport: false,
        generationAwareResult: mockWindOnlyGenerationAwareResult,
        operationalProjection: mockWindOnlyOperationalProjection25,
        generationAnalysis: windOnlyFinancialAnalysis,
        generationProjectCosts: windOnlyProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });
      expect(exportFalse.generation_configuration.allow_renewable_export).toBe(false);
      expect(exportFalse.generation_configuration.allow_solar_export).toBe(false);

      // Backwards-compatible fallback to allowSolarExport when allowRenewableExport not passed
      const exportFallback = buildGenerationExportLlmJson({
        generationConfig: sampleWindConfigAnnual,
        allowSolarExport: true,
        generationAwareResult: mockWindOnlyGenerationAwareResult,
        operationalProjection: mockWindOnlyOperationalProjection25,
        generationAnalysis: windOnlyFinancialAnalysis,
        generationProjectCosts: windOnlyProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });
      expect(exportFallback.generation_configuration.allow_renewable_export).toBe(true);
    });

    it('12. Year-1 wind generation matches authoritative output', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_year_1_results.wind_generated_kwh).toBe(8000);
    });

    it('13. Year-1 wind direct-to-load matches authoritative output', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_year_1_results.wind_direct_to_load_kwh).toBe(3500);
    });

    it('14. Year-1 wind-to-battery matches authoritative output', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_year_1_results.wind_to_battery_ac_kwh).toBe(2200);
    });

    it('15. Year-1 wind export matches authoritative output', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_year_1_results.wind_export_kwh).toBe(2000);
    });

    it('16. Year-1 wind curtailment matches authoritative output', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_year_1_results.wind_curtailed_kwh).toBe(300);
    });

    it('17. Year-1 renewable totals match authoritative output', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_year_1_results.renewable_generated_kwh).toBe(22000);
      expect(exportData.generation_year_1_results.renewable_direct_to_load_kwh).toBe(8500);
      expect(exportData.generation_year_1_results.renewable_to_battery_ac_kwh).toBe(6200);
      expect(exportData.generation_year_1_results.renewable_export_kwh).toBe(6500);
      expect(exportData.generation_year_1_results.renewable_curtailed_kwh).toBe(800);
    });

    it('18. Wind export remains distinct from battery export', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_year_1_results.wind_export_kwh).toBe(2000);
      expect(exportData.generation_year_1_results.battery_export_kwh).toBe(400);
      expect(exportData.generation_year_1_results.grid_export_kwh).toBe(6900);
    });

    it('19. Mixed Year-1 source reconciliation', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const y1 = exportData.generation_year_1_results;
      expect(y1.renewable_generated_kwh).toBe(y1.solar_generated_kwh + y1.wind_generated_kwh!);
      expect(y1.renewable_direct_to_load_kwh).toBe(y1.solar_direct_to_load_kwh + y1.wind_direct_to_load_kwh!);
      expect(y1.renewable_to_battery_ac_kwh).toBe(y1.solar_to_battery_ac_kwh + y1.wind_to_battery_ac_kwh!);
      expect(y1.renewable_export_kwh).toBe(y1.solar_export_kwh + y1.wind_export_kwh!);
      expect(y1.renewable_curtailed_kwh).toBe(y1.solar_curtailed_kwh + y1.wind_curtailed_kwh!);
      expect(y1.grid_export_kwh).toBe(y1.renewable_export_kwh! + y1.battery_export_kwh);
    });

    it('20. Annual wind projection matches GenerationOperationalYear', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        const expectedOpYear = mockMixedOperationalProjection25.years[idx];
        expect(row.wind_generation_kwh).toBe(expectedOpYear.windGeneratedKwh);
        expect(row.wind_direct_to_load_kwh).toBe(expectedOpYear.windDirectToLoadKwh);
        expect(row.wind_to_battery_kwh).toBe(expectedOpYear.windToBatteryKwh);
        expect(row.wind_export_kwh).toBe(expectedOpYear.windExportKwh);
        expect(row.wind_curtailed_kwh).toBe(expectedOpYear.windCurtailedKwh);
      });
    });

    it('21. Annual renewable projection matches GenerationOperationalYear', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      exportData.generation_annual_projection.forEach((row, idx) => {
        const expectedOpYear = mockMixedOperationalProjection25.years[idx];
        expect(row.renewable_generation_kwh).toBe(expectedOpYear.renewableGeneratedKwh);
        expect(row.renewable_direct_to_load_kwh).toBe(expectedOpYear.renewableDirectToLoadKwh);
        expect(row.renewable_to_battery_kwh).toBe(expectedOpYear.renewableToBatteryKwh);
        expect(row.renewable_export_kwh).toBe(expectedOpYear.renewableExportKwh);
        expect(row.renewable_curtailed_kwh).toBe(expectedOpYear.renewableCurtailedKwh);
      });
    });

    it('22. Selected horizon still truncates projection rows correctly', () => {
      const export10 = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 10,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(export10.metadata.selected_horizon_years).toBe(10);
      expect(export10.generation_annual_projection).toHaveLength(10);
      expect(export10.generation_annual_projection[9].year).toBe(10);
      expect(export10.generation_annual_projection[9].wind_generation_kwh).toBe(8000);
    });

    it('23. Wind generation asset appears exactly once in cost breakdown', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const windAssetsInCosts = exportData.generation_project_costs.generation_assets.filter(
        (a) => a.type === 'wind'
      );
      expect(windAssetsInCosts).toHaveLength(1);
      expect(windAssetsInCosts[0].id).toBe('wind-turbine-1');
      expect(windAssetsInCosts[0].installed_cost_usd).toBe(15000);
      expect(windAssetsInCosts[0].annual_maintenance_cost_usd).toBe(300);
    });

    it('24. Mixed solar/wind CAPEX is not duplicated', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_project_costs.generation_capex_usd).toBe(
        mixedFinancialAnalysis.generationCapexUsd
      );
      expect(exportData.generation_project_costs.gross_project_capex_usd).toBe(
        mixedFinancialAnalysis.grossProjectCapexUsd
      );
    });

    it('25. Mixed solar/wind O&M is not duplicated', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_project_costs.annual_generation_om_usd).toBe(
        mixedFinancialAnalysis.annualGenerationMaintenanceUsd
      );
    });

    it('26. Lifecycle financial values exactly match GenerationFinancialAnalysis', () => {
      const exportData = buildGenerationExportLlmJson({
        generationConfig: sampleMixedConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      const summary15 = deriveGenerationHorizonFinancialSummary(mixedFinancialAnalysis, 15);
      const kpis = exportData.generation_horizon_summary_kpis;

      expect(kpis.horizon_years).toBe(15);
      expect(kpis.horizon_net_present_value_usd).toBe(summary15.netPresentValue);
      expect(kpis.horizon_cumulative_project_cash_flow_usd).toBe(summary15.cumulativeCashFlow);
      expect(kpis.horizon_cumulative_electricity_savings_usd).toBe(summary15.cumulativeElectricitySavings);
      expect(kpis.horizon_generation_maintenance_usd).toBe(summary15.totalGenerationMaintenance);
      expect(kpis.simple_payback_years).toBe(summary15.simplePaybackYears);
      expect(kpis.discounted_payback_years).toBe(summary15.discountedPaybackYears);
      expect(kpis.horizon_roi_pct).toBe(summary15.horizonRoiPercent);
    });

    it('27. Partial-period generation lifecycle export remains blocked', () => {
      const partialCsvResult: CsvValidationResult = {
        ...mockCsvResult,
        completeness: {
          ...mockCsvResult.completeness!,
          isSuitableForAnnualProjection: false,
          reason: 'Partial dataset',
        },
      };

      expect(
        canExportGenerationProjectionsJson({
          generationAnalysis: mixedFinancialAnalysis,
          operationalProjection: mockMixedOperationalProjection25,
          generationAwareResult: mockMixedGenerationAwareResult,
          generationProjectCosts: mixedProjectCosts,
          generationConfig: sampleMixedConfig,
          csvResult: partialCsvResult,
          analysisState: 'partial-period',
        })
      ).toBe(false);

      expect(() =>
        buildGenerationExportLlmJson({
          generationConfig: sampleMixedConfig,
          allowRenewableExport: true,
          generationAwareResult: mockMixedGenerationAwareResult,
          operationalProjection: mockMixedOperationalProjection25,
          generationAnalysis: mixedFinancialAnalysis,
          generationProjectCosts: mixedProjectCosts,
          projectionHorizon: 15,
          tiers,
          activeTouProfile: touProfile,
          financials: sampleFinancials,
          csvResult: partialCsvResult,
        })
      ).toThrow('Cannot export multi-year generation projections for an incomplete or partial-period dataset.');
    });

    it('28. Enabled generator cannot masquerade as supported export', () => {
      const configWithActiveGenerator: GenerationConfig = {
        site: sampleMixedConfig.site,
        assets: [
          sampleWindTurbineAnnual,
          {
            id: 'gen-1',
            name: 'Gas Generator',
            enabled: true,
            type: 'generator',
            installedCostUsd: 8000,
            annualMaintenanceCostUsd: 200,
            ratedContinuousKw: 10,
            minimumStableLoadPercent: 20,
            fuelType: 'natural_gas',
            fuelUnit: 'therm',
            customFuelUnitLabel: '',
            fuelPricePerUnit: 1.5,
            variableMaintenanceCostPerHourUsd: 0.5,
            startupFuelUnits: 0,
            fuelCurve: [],
            dispatchMode: 'standby',
            allowBatteryCharging: false,
            allowGridExport: false,
            scheduledHours: [],
          } as GeneratorGenerationAsset,
        ],
      };

      expect(
        canExportGenerationProjectionsJson({
          generationAnalysis: windOnlyFinancialAnalysis,
          operationalProjection: mockWindOnlyOperationalProjection25,
          generationAwareResult: mockWindOnlyGenerationAwareResult,
          generationProjectCosts: windOnlyProjectCosts,
          generationConfig: configWithActiveGenerator,
          csvResult: mockCsvResult,
        })
      ).toBe(false);

      expect(() =>
        buildGenerationExportLlmJson({
          generationConfig: configWithActiveGenerator,
          allowRenewableExport: true,
          generationAwareResult: mockWindOnlyGenerationAwareResult,
          operationalProjection: mockWindOnlyOperationalProjection25,
          generationAnalysis: windOnlyFinancialAnalysis,
          generationProjectCosts: windOnlyProjectCosts,
          projectionHorizon: 15,
          tiers,
          activeTouProfile: touProfile,
          financials: sampleFinancials,
          csvResult: mockCsvResult,
        })
      ).toThrow('Enabled generator assets are not supported for generation export.');
    });

    it('29. Enabled wind interval_file cannot masquerade as supported export', () => {
      const configWithIntervalFileWind: GenerationConfig = {
        site: sampleMixedConfig.site,
        assets: [
          {
            ...sampleWindTurbineAnnual,
            resourceMode: 'interval_file',
          },
        ],
      };

      expect(
        canExportGenerationProjectionsJson({
          generationAnalysis: windOnlyFinancialAnalysis,
          operationalProjection: mockWindOnlyOperationalProjection25,
          generationAwareResult: mockWindOnlyGenerationAwareResult,
          generationProjectCosts: windOnlyProjectCosts,
          generationConfig: configWithIntervalFileWind,
          csvResult: mockCsvResult,
        })
      ).toBe(false);

      expect(() =>
        buildGenerationExportLlmJson({
          generationConfig: configWithIntervalFileWind,
          allowRenewableExport: true,
          generationAwareResult: mockWindOnlyGenerationAwareResult,
          operationalProjection: mockWindOnlyOperationalProjection25,
          generationAnalysis: windOnlyFinancialAnalysis,
          generationProjectCosts: windOnlyProjectCosts,
          projectionHorizon: 15,
          tiers,
          activeTouProfile: touProfile,
          financials: sampleFinancials,
          csvResult: mockCsvResult,
        })
      ).toThrow('Enabled wind assets with interval_file resource mode are not supported for generation export.');
    });

    it('30. Disabled unsupported assets do not block supported export', () => {
      const configWithDisabledUnsupportedAssets: GenerationConfig = {
        site: sampleMixedConfig.site,
        assets: [
          sampleWindTurbineAnnual,
          {
            id: 'gen-disabled',
            name: 'Disabled Generator',
            enabled: false,
            type: 'generator',
            installedCostUsd: 8000,
            annualMaintenanceCostUsd: 200,
          } as any,
          {
            ...sampleWindTurbineAnnual,
            id: 'wind-disabled-interval',
            enabled: false,
            resourceMode: 'interval_file',
          },
        ],
      };

      expect(
        canExportGenerationProjectionsJson({
          generationAnalysis: windOnlyFinancialAnalysis,
          operationalProjection: mockWindOnlyOperationalProjection25,
          generationAwareResult: mockWindOnlyGenerationAwareResult,
          generationProjectCosts: windOnlyProjectCosts,
          generationConfig: configWithDisabledUnsupportedAssets,
          csvResult: mockCsvResult,
        })
      ).toBe(true);

      const exportData = buildGenerationExportLlmJson({
        generationConfig: configWithDisabledUnsupportedAssets,
        allowRenewableExport: true,
        generationAwareResult: mockWindOnlyGenerationAwareResult,
        operationalProjection: mockWindOnlyOperationalProjection25,
        generationAnalysis: windOnlyFinancialAnalysis,
        generationProjectCosts: windOnlyProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(exportData.generation_configuration.wind_turbines).toHaveLength(1);
      expect(exportData.generation_configuration.wind_turbines![0].id).toBe('wind-turbine-1');
    });

    it('31. Inputs are not mutated', () => {
      const frozenConfig: GenerationConfig = JSON.parse(JSON.stringify(sampleMixedConfig));
      const configSnapshot = JSON.parse(JSON.stringify(frozenConfig));
      const monthlyArrayRef = (frozenConfig.assets[2] as WindGenerationAsset).monthlyAverageWindSpeedMps;
      const powerCurveRef = (frozenConfig.assets[2] as WindGenerationAsset).powerCurve;

      buildGenerationExportLlmJson({
        generationConfig: frozenConfig,
        allowRenewableExport: true,
        generationAwareResult: mockMixedGenerationAwareResult,
        operationalProjection: mockMixedOperationalProjection25,
        generationAnalysis: mixedFinancialAnalysis,
        generationProjectCosts: mixedProjectCosts,
        projectionHorizon: 15,
        tiers,
        activeTouProfile: touProfile,
        financials: sampleFinancials,
        csvResult: mockCsvResult,
      });

      expect(frozenConfig).toEqual(configSnapshot);
      expect((frozenConfig.assets[2] as WindGenerationAsset).monthlyAverageWindSpeedMps).toBe(monthlyArrayRef);
      expect((frozenConfig.assets[2] as WindGenerationAsset).powerCurve).toBe(powerCurveRef);
    });
  });
});

