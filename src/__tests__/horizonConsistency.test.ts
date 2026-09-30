import { describe, it, expect } from 'vitest';
import {
  calculate15YearFinancials,
  deriveHorizonFinancialSummary,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_BATTERY_PROFILES,
} from '../utils/simulationEngine';
import { AnnualSimulationSummary, BatteryProfile } from '../types/energy';

describe('Selected-Horizon vs 25-Year Lifetime Financial Consistency', () => {
  const profile: BatteryProfile = {
    ...DEFAULT_BATTERY_PROFILES[0],
    installedCost: 10000,
  };

  const summary: AnnualSimulationSummary = {
    profileId: profile.id,
    profileName: profile.name,
    totalIntervals: 8760,
    intervalHours: 1,
    totalHomeLoadKwh: 8000,
    baselineAnnualCost: 2500,
    simulatedAnnualCost: 1500,
    year1Savings: 1000,
    savingsPercentage: 40,
    annualGridImportKwh: 5000,
    annualGridExportKwh: 0,
    annualBatteryDischargedKwh: 3000,
    equivalentFullCycles: 220,
    maxPeakDemandKw: 6.0,
    intervalResults: [],
  };

  // Test 1 — 15-year horizon
  it('returns Year-15 cumulative NPV, cash flow, and savings rather than Year-25 values', () => {
    const analysis = calculate15YearFinancials(profile, summary, DEFAULT_MACRO_FINANCIALS);
    const horizon15 = deriveHorizonFinancialSummary(analysis, 15);

    const p15 = analysis.projections[14];
    const p25 = analysis.projections[24];

    expect(horizon15.horizonYears).toBe(15);
    expect(horizon15.netPresentValue).toBe(p15.cumulativeNpv);
    expect(horizon15.cumulativeCashFlow).toBe(p15.cumulativeCashFlow);

    const sumSavings15 = analysis.projections.slice(0, 15).reduce((acc, p) => acc + p.annualSavings, 0);
    expect(horizon15.cumulativeSavings).toBe(sumSavings15);

    // Verify it is strictly different from 25-year values
    expect(horizon15.netPresentValue).not.toBe(p25.cumulativeNpv);
    expect(horizon15.cumulativeCashFlow).not.toBe(p25.cumulativeCashFlow);
    expect(horizon15.cumulativeSavings).not.toBe(analysis.lifetimeTotalSavings);
  });

  // Test 2 — 25-year horizon
  it('returns Year-25 values matching full lifetime analysis when horizon is 25 years', () => {
    const analysis = calculate15YearFinancials(profile, summary, DEFAULT_MACRO_FINANCIALS);
    const horizon25 = deriveHorizonFinancialSummary(analysis, 25);

    expect(horizon25.horizonYears).toBe(25);
    expect(horizon25.netPresentValue).toBe(analysis.npv);
    expect(horizon25.cumulativeCashFlow).toBe(analysis.lifetimeNetProfit);
    expect(horizon25.cumulativeSavings).toBe(analysis.lifetimeTotalSavings);
    expect(horizon25.horizonRoiPercent).toBe(analysis.lifetimeRoiPercent);
  });

  // Test 3 — tax credit
  it('includes deferred tax credit realized in Year 1 exactly once in a 15-year horizon', () => {
    const creditPercent = 30; // $3,000 on $10,000
    const financialsWithCredit = {
      ...DEFAULT_MACRO_FINANCIALS,
      federalTaxCreditPercent: creditPercent,
      federalTaxCreditRealizationYear: 1,
      replacementEnabled: false,
    };
    const financialsWithoutCredit = {
      ...DEFAULT_MACRO_FINANCIALS,
      federalTaxCreditPercent: 0,
      replacementEnabled: false,
    };

    const analysisWithCredit = calculate15YearFinancials(profile, summary, financialsWithCredit);
    const analysisWithoutCredit = calculate15YearFinancials(profile, summary, financialsWithoutCredit);

    const horizon15WithCredit = deriveHorizonFinancialSummary(analysisWithCredit, 15);
    const horizon15WithoutCredit = deriveHorizonFinancialSummary(analysisWithoutCredit, 15);

    const expectedCreditAmount = 10000 * (creditPercent / 100);
    expect(horizon15WithCredit.taxCreditInflows).toBe(expectedCreditAmount);
    expect(horizon15WithoutCredit.taxCreditInflows).toBe(0);

    // Net profit difference should be exactly the tax credit amount
    expect(horizon15WithCredit.cumulativeCashFlow - horizon15WithoutCredit.cumulativeCashFlow).toBe(
      expectedCreditAmount
    );
  });

  // Test 4 — replacement outside horizon
  it('excludes replacement expense from 15-year summary when replacement occurs in Year 20', () => {
    const financialsReplacementYear20 = {
      ...DEFAULT_MACRO_FINANCIALS,
      replacementEnabled: true,
      replacementCost: 2500,
      replacementYear: 20,
    };
    const financialsNoReplacement = {
      ...DEFAULT_MACRO_FINANCIALS,
      replacementEnabled: false,
    };

    const analysisYr20 = calculate15YearFinancials(profile, summary, financialsReplacementYear20);
    const analysisNoRep = calculate15YearFinancials(profile, summary, financialsNoReplacement);

    const horizon15 = deriveHorizonFinancialSummary(analysisYr20, 15);
    const horizon15NoRep = deriveHorizonFinancialSummary(analysisNoRep, 15);

    expect(horizon15.totalReplacementCost).toBe(0);
    expect(horizon15.cumulativeCashFlow).toBe(horizon15NoRep.cumulativeCashFlow);
    expect(horizon15.netPresentValue).toBe(horizon15NoRep.netPresentValue);
  });

  // Test 5 — replacement inside horizon
  it('includes replacement expense in 15-year summary when replacement occurs in Year 10', () => {
    const replacementCost = 2500;
    const financialsReplacementYear10 = {
      ...DEFAULT_MACRO_FINANCIALS,
      replacementEnabled: true,
      replacementCost,
      replacementYear: 10,
    };
    const financialsNoReplacement = {
      ...DEFAULT_MACRO_FINANCIALS,
      replacementEnabled: false,
    };

    const analysisYr10 = calculate15YearFinancials(profile, summary, financialsReplacementYear10);
    const analysisNoRep = calculate15YearFinancials(profile, summary, financialsNoReplacement);

    const horizon15 = deriveHorizonFinancialSummary(analysisYr10, 15);
    const horizon15NoRep = deriveHorizonFinancialSummary(analysisNoRep, 15);

    expect(horizon15.totalReplacementCost).toBe(replacementCost);
    expect(horizon15.cumulativeCashFlow).toBe(horizon15NoRep.cumulativeCashFlow - replacementCost);
  });

  // Test 6 — genuine 15-year aliases
  it('verifies legacy *15Yr fields correspond to Year 15 rather than Year 25', () => {
    const analysis = calculate15YearFinancials(profile, summary, DEFAULT_MACRO_FINANCIALS);

    expect(analysis.projections15Yr).toHaveLength(15);
    expect(analysis.projections15Yr[14].year).toBe(15);

    const p15 = analysis.projections[14];
    const p25 = analysis.projections[24];

    expect(analysis.npv15Yr).toBe(p15.cumulativeNpv);
    expect(analysis.lifetimeNetProfit15Yr).toBe(p15.cumulativeCashFlow);

    const sumSavings15 = analysis.projections.slice(0, 15).reduce((acc, p) => acc + p.annualSavings, 0);
    expect(analysis.lifetimeTotalSavings15Yr).toBe(sumSavings15);

    // Explicitly verify they are distinct from Year 25 lifetime values
    expect(analysis.npv15Yr).not.toBe(p25.cumulativeNpv);
    expect(analysis.lifetimeNetProfit15Yr).not.toBe(p25.cumulativeCashFlow);
    expect(analysis.lifetimeTotalSavings15Yr).not.toBe(analysis.lifetimeTotalSavings);
  });

  // Test 7 — 13A: payback inside selected horizon
  it('13A: returns simplePaybackYears when payback occurs inside the selected horizon', () => {
    // Fast payback profile: $6,000 cost, $1,500 annual savings => ~4-5 years payback
    const fastProfile: BatteryProfile = {
      ...profile,
      installedCost: 6000,
    };
    const fastSummary: AnnualSimulationSummary = {
      ...summary,
      year1Savings: 1500,
      baselineAnnualCost: 3000,
      simulatedAnnualCost: 1500,
    };

    const analysis = calculate15YearFinancials(fastProfile, fastSummary, DEFAULT_MACRO_FINANCIALS);
    expect(analysis.paybackYears).not.toBeNull();
    expect(analysis.paybackYears!).toBeLessThan(15);

    const horizon15 = deriveHorizonFinancialSummary(analysis, 15);
    expect(horizon15.simplePaybackYears).not.toBeNull();
    expect(horizon15.simplePaybackYears).toBe(analysis.paybackYears);
  });

  // Test 8 — 13B: payback outside selected horizon
  it('13B: returns null for simplePaybackYears when full payback occurs after selected horizon', () => {
    // Slow payback profile: $15,000 cost, $850 annual savings => payback ~18 years
    const slowProfile: BatteryProfile = {
      ...profile,
      installedCost: 15000,
    };
    const slowSummary: AnnualSimulationSummary = {
      ...summary,
      year1Savings: 850,
      baselineAnnualCost: 2500,
      simulatedAnnualCost: 1650,
    };

    const analysis = calculate15YearFinancials(slowProfile, slowSummary, DEFAULT_MACRO_FINANCIALS);
    expect(analysis.paybackYears).not.toBeNull();
    expect(analysis.paybackYears!).toBeGreaterThan(15);
    expect(analysis.paybackYears!).toBeLessThanOrEqual(25);

    // Selected horizon = 15 years: payback is beyond horizon, so simplePaybackYears must be null
    const horizon15 = deriveHorizonFinancialSummary(analysis, 15);
    expect(horizon15.simplePaybackYears).toBeNull();

    // In 25-year horizon, payback is within horizon
    const horizon25 = deriveHorizonFinancialSummary(analysis, 25);
    expect(horizon25.simplePaybackYears).not.toBeNull();
    expect(horizon25.simplePaybackYears).toBe(analysis.paybackYears);
  });
});
