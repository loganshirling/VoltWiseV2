import { describe, it, expect } from 'vitest';
import { calculate15YearFinancials, DEFAULT_MACRO_FINANCIALS } from '../utils/simulationEngine';
import { BatteryProfile, AnnualSimulationSummary } from '../types/energy';

describe('Issue 6 — Financing & Deferred Tax Credit Realization', () => {
  const profile: BatteryProfile = {
    id: 'test-powerwall',
    name: 'Test Battery',
    model: '13.5 kWh',
    totalCapacityKwh: 13.5,
    usableDodPercent: 100,
    maxContinuousOutputKw: 5.0,
    maxContinuousChargeKw: 5.0,
    roundTripEfficiencyPercent: 90,
    ratedCycleLife: 4000,
    installedCost: 12000,
    strategy: 'arbitrage',
    chargeTiers: [],
    dischargeTiers: [],
  };

  const summary: AnnualSimulationSummary = {
    profileId: profile.id,
    profileName: profile.name,
    totalIntervals: 8760,
    intervalHours: 1,
    totalHomeLoadKwh: 8000,
    baselineAnnualCost: 2400,
    simulatedAnnualCost: 1400,
    year1Savings: 1000,
    savingsPercentage: 41.7,
    annualGridImportKwh: 5000,
    annualGridExportKwh: 0,
    annualBatteryDischargedKwh: 3000,
    equivalentFullCycles: 222,
    maxPeakDemandKw: 5.0,
    intervalResults: [],
  };

  it('ensures deferred federal tax credit does not artificially reduce loan principal on day 1', () => {
    // Gross: $12,000, Local flat rebate: $2,000, Federal tax credit: 30% ($3,600)
    // Upfront net outlay = $12,000 - $2,000 = $10,000.
    // Financed with 10% down ($1,000) -> Loan principal must be $9,000.
    // (If the tax credit had been deducted upfront, principal would incorrectly be $12,000 - $2,000 - $3,600 = $6,400 - $640 = $5,760).
    const financedSettings = {
      ...DEFAULT_MACRO_FINANCIALS,
      federalTaxCreditPercent: 30,
      localRebateFlat: 2000,
      federalTaxCreditRealizationYear: 1,
      isFinanced: true,
      loanAprPercent: 6.0,
      loanTermYears: 10,
      loanDownPaymentPercent: 10,
    };

    const analysis = calculate15YearFinancials(profile, summary, financedSettings);

    expect(analysis.grossCost).toBe(12000);
    expect(analysis.upfrontOutOfPocket).toBe(1000); // 10% down payment
    expect(analysis.loanPrincipal).toBe(9000); // $10,000 - $1,000 down payment
  });

  it('realizes tax credit cash inflow in Year 1 (or configured realization year)', () => {
    const financialsYear1 = {
      ...DEFAULT_MACRO_FINANCIALS,
      federalTaxCreditPercent: 30,
      localRebateFlat: 1000,
      federalTaxCreditRealizationYear: 1,
      isFinanced: false,
    };

    const analysis = calculate15YearFinancials(profile, summary, financialsYear1);
    const taxCreditVal = 12000 * 0.30; // $3,600

    // In Year 1, tax credit inflow is realized
    expect(analysis.projections[0].taxCreditInflow).toBe(taxCreditVal);
    // In Year 2, tax credit inflow is 0
    expect(analysis.projections[1].taxCreditInflow).toBe(0);

    // If configured for Year 2 realization
    const financialsYear2 = {
      ...financialsYear1,
      federalTaxCreditRealizationYear: 2,
    };
    const analysis2 = calculate15YearFinancials(profile, summary, financialsYear2);
    expect(analysis2.projections[0].taxCreditInflow).toBe(0);
    expect(analysis2.projections[1].taxCreditInflow).toBe(taxCreditVal);
  });

  it('Section 5: calculates exact 0% APR financing with zero interest and principal/term monthly payments', () => {
    // Principal = $12,000, 0% down, 0 rebate -> principal = $12,000
    // APR = 0%, Term = 10 years (120 months)
    const zeroAprFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      isFinanced: true,
      loanAprPercent: 0,
      loanTermYears: 10,
      loanDownPaymentPercent: 0,
      localRebateFlat: 0,
      federalTaxCreditPercent: 0,
    };

    const analysis = calculate15YearFinancials(profile, summary, zeroAprFinancials);

    expect(analysis.loanPrincipal).toBe(12000);
    // 12000 / 120 = $100/mo
    expect(analysis.monthlyLoanPayment).toBe(100.0);
    expect(analysis.totalLoanInterestPaid).toBe(0);
    expect(analysis.totalLoanPaymentLifetime).toBe(12000);
  });

  it('Section 6: verifies positive-APR financing against independent amortization formula to cents', () => {
    // Loan: Principal = $10,000, APR = 6.99%, Term = 10 years (120 months)
    const testProfile: BatteryProfile = {
      ...profile,
      installedCost: 10000,
    };

    const positiveAprFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      isFinanced: true,
      loanAprPercent: 6.99,
      loanTermYears: 10,
      loanDownPaymentPercent: 0,
      localRebateFlat: 0,
      federalTaxCreditPercent: 0,
    };

    const analysis = calculate15YearFinancials(testProfile, summary, positiveAprFinancials);

    // Independent calculation:
    // P = 10000, r = 0.0699 / 12, n = 120
    const P = 10000;
    const r = (6.99 / 100) / 12;
    const n = 120;
    const numerator = r * Math.pow(1 + r, n);
    const denominator = Math.pow(1 + r, n) - 1;
    const expectedMonthlyPayment = Math.round((P * (numerator / denominator)) * 100) / 100;
    const expectedTotalInterest = Math.round(expectedMonthlyPayment * n - P);

    expect(analysis.loanPrincipal).toBe(10000);
    expect(analysis.monthlyLoanPayment).toBe(expectedMonthlyPayment);
    expect(analysis.totalLoanInterestPaid).toBe(expectedTotalInterest);
  });
});
