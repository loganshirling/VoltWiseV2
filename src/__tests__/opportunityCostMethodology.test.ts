import { describe, it, expect } from 'vitest';
import {
  calculateOpportunityCostBenchmark,
  OpportunityCostBenchmarkInput,
} from '../utils/opportunityCost';
import {
  calculate15YearFinancials,
  deriveHorizonFinancialSummary,
  DEFAULT_MACRO_FINANCIALS,
} from '../utils/simulationEngine';
import { BatteryProfile, AnnualSimulationSummary } from '../types/energy';

describe('Opportunity Cost Methodology & Counterfactual Benchmark', () => {
  const mockProfile: BatteryProfile = {
    id: 'test-battery',
    name: 'Standard Battery',
    model: '10 kWh',
    totalCapacityKwh: 10,
    usableDodPercent: 100,
    maxContinuousOutputKw: 5.0,
    maxContinuousChargeKw: 5.0,
    roundTripEfficiencyPercent: 90,
    ratedCycleLife: 4000,
    installedCost: 10000,
    strategy: 'arbitrage',
    chargeTiers: [],
    dischargeTiers: [],
  };

  const mockSummary: AnnualSimulationSummary = {
    profileId: mockProfile.id,
    profileName: mockProfile.name,
    totalIntervals: 8760,
    intervalHours: 1,
    totalHomeLoadKwh: 8000,
    baselineAnnualCost: 2000,
    simulatedAnnualCost: 1200,
    year1Savings: 800,
    savingsPercentage: 40.0,
    annualGridImportKwh: 4500,
    annualGridExportKwh: 0,
    annualBatteryDischargedKwh: 2500,
    equivalentFullCycles: 250,
    maxPeakDemandKw: 5.0,
    intervalResults: [],
  };

  it('Test 1 — Simple cash purchase', () => {
    // Input:
    // upfront contribution = $1,000, benchmark rate = 10%, horizon = 2 years, no loan, no replacement
    const input: OpportunityCostBenchmarkInput = {
      horizonYears: 2,
      annualRatePercent: 10,
      upfrontContribution: 1000,
      monthlyLoanPayment: 0,
      loanTermYears: 0,
      replacementEnabled: false,
      replacementCost: 0,
      replacementYear: 0,
    };

    const result = calculateOpportunityCostBenchmark(input);

    expect(result.yearly).toHaveLength(2);
    expect(result.yearly[0].futureValue).toBeCloseTo(1100, 2);
    expect(result.yearly[1].futureValue).toBeCloseTo(1210, 2);
    expect(result.totalContributions).toBeCloseTo(1000, 2);
    expect(result.profit).toBeCloseTo(210, 2);
    expect(result.futureValue).toBeCloseTo(1210, 2);
  });

  it('Test 2 — Financed purchase includes debt service', () => {
    // Input:
    // upfront contribution = $2,000, monthly loan payment = $100, loan term = 2 years,
    // benchmark rate = 10%, horizon = 2 years, no replacement
    // Year 1: $2,000 * 1.10 + $1,200 = $3,400
    // Year 2: $3,400 * 1.10 + $1,200 = $4,940
    // Total contributions: $4,400; Profit: $540
    const input: OpportunityCostBenchmarkInput = {
      horizonYears: 2,
      annualRatePercent: 10,
      upfrontContribution: 2000,
      monthlyLoanPayment: 100,
      loanTermYears: 2,
      replacementEnabled: false,
      replacementCost: 0,
      replacementYear: 0,
    };

    const result = calculateOpportunityCostBenchmark(input);

    expect(result.yearly).toHaveLength(2);
    expect(result.yearly[0].futureValue).toBeCloseTo(3400, 2);
    expect(result.yearly[0].cumulativeContributions).toBeCloseTo(3200, 2);
    expect(result.yearly[0].profit).toBeCloseTo(200, 2);

    expect(result.yearly[1].futureValue).toBeCloseTo(4940, 2);
    expect(result.totalContributions).toBeCloseTo(4400, 2);
    expect(result.futureValue).toBeCloseTo(4940, 2);
    expect(result.profit).toBeCloseTo(540, 2);
  });

  it('Test 3 — Replacement contribution', () => {
    // Base financed purchase with $1,000 inverter replacement in Year 2
    const inputWithReplacement: OpportunityCostBenchmarkInput = {
      horizonYears: 2,
      annualRatePercent: 10,
      upfrontContribution: 2000,
      monthlyLoanPayment: 100,
      loanTermYears: 2,
      replacementEnabled: true,
      replacementCost: 1000,
      replacementYear: 2,
    };

    const result = calculateOpportunityCostBenchmark(inputWithReplacement);

    // Year 1 is unaffected by Year 2 replacement
    expect(result.yearly[0].futureValue).toBeCloseTo(3400, 2);
    expect(result.yearly[0].annualContribution).toBeCloseTo(1200, 2);

    // Year 2 includes the $1,000 replacement expense
    // Prior balance $3,400 * 1.10 = $3,740 + $1,200 loan + $1,000 replacement = $5,940
    expect(result.yearly[1].annualContribution).toBeCloseTo(2200, 2);
    expect(result.yearly[1].futureValue).toBeCloseTo(5940, 2);
    expect(result.totalContributions).toBeCloseTo(5400, 2);
    expect(result.futureValue).toBeCloseTo(5940, 2);
    expect(result.profit).toBeCloseTo(540, 2);
  });

  it('Test 4 — Horizon before replacement', () => {
    // Replacement year = 20, selected horizon = 15
    const input15: OpportunityCostBenchmarkInput = {
      horizonYears: 15,
      annualRatePercent: 5,
      upfrontContribution: 5000,
      monthlyLoanPayment: 50,
      loanTermYears: 10,
      replacementEnabled: true,
      replacementCost: 2000,
      replacementYear: 20,
    };

    const inputNoReplacement: OpportunityCostBenchmarkInput = {
      ...input15,
      replacementEnabled: false,
    };

    const res15 = calculateOpportunityCostBenchmark(input15);
    const resNoRep = calculateOpportunityCostBenchmark(inputNoReplacement);

    // The Year-20 replacement must NOT affect the 15-year benchmark
    expect(res15.futureValue).toBeCloseTo(resNoRep.futureValue, 4);
    expect(res15.totalContributions).toBeCloseTo(resNoRep.totalContributions, 4);
    expect(res15.profit).toBeCloseTo(resNoRep.profit, 4);
  });

  it('Test 5 — Horizon shorter than loan term', () => {
    // Loan term = 10 years, horizon = 5 years
    const input5: OpportunityCostBenchmarkInput = {
      horizonYears: 5,
      annualRatePercent: 6,
      upfrontContribution: 2000,
      monthlyLoanPayment: 100,
      loanTermYears: 10,
      replacementEnabled: false,
      replacementCost: 0,
      replacementYear: 0,
    };

    const res5 = calculateOpportunityCostBenchmark(input5);

    // Only 5 years of loan payments ($1,200/yr * 5 = $6,000) plus $2,000 upfront = $8,000
    expect(res5.totalContributions).toBeCloseTo(8000, 2);
    expect(res5.yearly).toHaveLength(5);
  });

  it('Test 6 — Zero-percent benchmark', () => {
    // Benchmark rate = 0%
    const input0: OpportunityCostBenchmarkInput = {
      horizonYears: 10,
      annualRatePercent: 0,
      upfrontContribution: 3000,
      monthlyLoanPayment: 80,
      loanTermYears: 5,
      replacementEnabled: true,
      replacementCost: 1500,
      replacementYear: 7,
    };

    const res0 = calculateOpportunityCostBenchmark(input0);

    // With 0% benchmark return: FV = total contributions, profit = 0 exactly
    expect(res0.profit).toBe(0);
    expect(res0.futureValue).toBe(res0.totalContributions);
    expect(res0.yearly.every((y) => y.profit === 0)).toBe(true);
  });

  it('Test 7 — Engine integration', () => {
    const financedFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      isFinanced: true,
      loanDownPaymentPercent: 20,
      loanAprPercent: 6.5,
      loanTermYears: 10,
      opportunityCostRatePercent: 5.5,
      replacementEnabled: true,
      replacementCost: 2000,
      replacementYear: 10,
    };

    const analysis = calculate15YearFinancials(mockProfile, mockSummary, financedFinancials);

    const helperResult = calculateOpportunityCostBenchmark({
      horizonYears: 25,
      annualRatePercent: financedFinancials.opportunityCostRatePercent,
      upfrontContribution: analysis.upfrontOutOfPocket,
      monthlyLoanPayment: analysis.monthlyLoanPayment,
      loanTermYears: financedFinancials.loanTermYears,
      replacementEnabled: financedFinancials.replacementEnabled,
      replacementCost: financedFinancials.replacementCost,
      replacementYear: financedFinancials.replacementYear,
    });

    // Every projection year's opportunityCostValue must match the helper
    for (let year = 1; year <= 25; year++) {
      expect(analysis.projections[year - 1].opportunityCostValue).toBe(
        helperResult.yearly[year - 1].futureValue
      );
    }

    // 25-year top-level fields must match helper
    expect(analysis.opportunityCostFutureValue).toBe(helperResult.futureValue);
    expect(analysis.opportunityCostProfit).toBe(helperResult.profit);
    expect(analysis.opportunityCostDiff).toBe(analysis.lifetimeNetProfit - helperResult.profit);
  });

  it('Test 8 — Horizon summary integration', () => {
    const financedFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      isFinanced: true,
      loanDownPaymentPercent: 20,
      loanAprPercent: 6.5,
      loanTermYears: 12,
      opportunityCostRatePercent: 5.0,
      replacementEnabled: true,
      replacementCost: 2500,
      replacementYear: 15, // Replacement is in Year 15
    };

    const analysis = calculate15YearFinancials(mockProfile, mockSummary, financedFinancials);
    const horizon10 = deriveHorizonFinancialSummary(analysis, 10);

    // Uses analysis.projections[9].opportunityCostValue
    expect(horizon10.opportunityCostFutureValue).toBe(analysis.projections[9].opportunityCostValue);

    // Capital contributions through Year 10: upfront cash + loan payments through Year 10 + replacement costs through Year 10
    const totalLoanPayments10 = horizon10.totalLoanPayments;
    const totalReplacement10 = horizon10.totalReplacementCost;
    expect(totalReplacement10).toBe(0); // Year 15 replacement is not included in Year 10
    expect(totalLoanPayments10).toBeGreaterThan(0);

    const expectedContributions10 =
      analysis.upfrontOutOfPocket + totalLoanPayments10 + totalReplacement10;

    expect(horizon10.opportunityCostProfit).toBe(
      analysis.projections[9].opportunityCostValue - expectedContributions10
    );
    expect(horizon10.opportunityCostDiff).toBe(
      horizon10.cumulativeCashFlow - horizon10.opportunityCostProfit
    );
  });

  it('Test 9 — Deferred tax credit does not alter benchmark contributions', () => {
    const financialsNoTaxCredit = {
      ...DEFAULT_MACRO_FINANCIALS,
      federalTaxCreditPercent: 0,
      localRebateFlat: 1000,
      isFinanced: true,
      loanDownPaymentPercent: 20,
      loanAprPercent: 6.0,
      loanTermYears: 10,
      opportunityCostRatePercent: 7.0,
    };

    const financialsWithTaxCredit = {
      ...financialsNoTaxCredit,
      federalTaxCreditPercent: 30, // 30% deferred tax credit
      federalTaxCreditRealizationYear: 1,
    };

    const analysisA = calculate15YearFinancials(mockProfile, mockSummary, financialsNoTaxCredit);
    const analysisB = calculate15YearFinancials(mockProfile, mockSummary, financialsWithTaxCredit);

    // Upfront cash outlays and financing terms are identical
    expect(analysisA.upfrontOutOfPocket).toBe(analysisB.upfrontOutOfPocket);
    expect(analysisA.monthlyLoanPayment).toBe(analysisB.monthlyLoanPayment);

    // Opportunity-cost future value, contributions, and profit must be IDENTICAL
    expect(analysisA.opportunityCostFutureValue).toBe(analysisB.opportunityCostFutureValue);
    expect(analysisA.opportunityCostProfit).toBe(analysisB.opportunityCostProfit);

    for (let y = 0; y < 25; y++) {
      expect(analysisA.projections[y].opportunityCostValue).toBe(
        analysisB.projections[y].opportunityCostValue
      );
    }

    // Battery cash flows must differ because of the tax credit
    expect(analysisA.lifetimeNetProfit).not.toBe(analysisB.lifetimeNetProfit);
    expect(analysisB.lifetimeNetProfit).toBeGreaterThan(analysisA.lifetimeNetProfit);
  });

  it('Test 10 — Additional annual contributions (generation O&M) are added at year end after growth', () => {
    // Upfront: $1,000, 10% rate, 2 years, no loan, no replacement, $200/yr additional outlays
    // Year 1: $1,000 * 1.10 = $1,100 + $200 = $1,300. Contributions = $1,000 + $200 = $1,200. Profit = $100.
    // Year 2: $1,300 * 1.10 = $1,430 + $200 = $1,630. Contributions = $1,200 + $200 = $1,400. Profit = $230.
    const input: OpportunityCostBenchmarkInput = {
      horizonYears: 2,
      annualRatePercent: 10,
      upfrontContribution: 1000,
      monthlyLoanPayment: 0,
      loanTermYears: 0,
      replacementEnabled: false,
      replacementCost: 0,
      replacementYear: 0,
      additionalAnnualContributions: [200, 200],
    };

    const result = calculateOpportunityCostBenchmark(input);

    expect(result.yearly).toHaveLength(2);
    expect(result.yearly[0].futureValue).toBeCloseTo(1300, 2);
    expect(result.yearly[0].cumulativeContributions).toBeCloseTo(1200, 2);
    expect(result.yearly[0].profit).toBeCloseTo(100, 2);

    expect(result.yearly[1].futureValue).toBeCloseTo(1630, 2);
    expect(result.yearly[1].cumulativeContributions).toBeCloseTo(1400, 2);
    expect(result.yearly[1].profit).toBeCloseTo(230, 2);

    expect(result.totalContributions).toBeCloseTo(1400, 2);
    expect(result.futureValue).toBeCloseTo(1630, 2);
    expect(result.profit).toBeCloseTo(230, 2);
  });

  it('Test 11 — Backward compatibility: omitting additionalAnnualContributions produces identical results', () => {
    const baseInput: OpportunityCostBenchmarkInput = {
      horizonYears: 5,
      annualRatePercent: 6,
      upfrontContribution: 5000,
      monthlyLoanPayment: 150,
      loanTermYears: 3,
      replacementEnabled: true,
      replacementCost: 1500,
      replacementYear: 4,
    };

    const resultWithout = calculateOpportunityCostBenchmark(baseInput);
    const resultWithUndefined = calculateOpportunityCostBenchmark({
      ...baseInput,
      additionalAnnualContributions: undefined,
    });
    const resultWithEmpty = calculateOpportunityCostBenchmark({
      ...baseInput,
      additionalAnnualContributions: [],
    });

    expect(resultWithout.futureValue).toBe(resultWithUndefined.futureValue);
    expect(resultWithout.totalContributions).toBe(resultWithUndefined.totalContributions);
    expect(resultWithout.profit).toBe(resultWithUndefined.profit);

    expect(resultWithout.futureValue).toBe(resultWithEmpty.futureValue);
    expect(resultWithout.totalContributions).toBe(resultWithEmpty.totalContributions);
    expect(resultWithout.profit).toBe(resultWithEmpty.profit);
  });
});
