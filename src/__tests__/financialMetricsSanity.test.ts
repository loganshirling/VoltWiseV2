import { describe, it, expect } from 'vitest';
import {
  calculateIRR,
  calculate15YearFinancials,
  DEFAULT_MACRO_FINANCIALS,
} from '../utils/simulationEngine';
import { BatteryProfile, AnnualSimulationSummary } from '../types/energy';

describe('Financial Metrics Sanity Tests', () => {
  const baseProfile: BatteryProfile = {
    id: 'sanity-bat',
    name: 'Sanity Battery',
    model: '10 kWh',
    totalCapacityKwh: 10,
    usableDodPercent: 100,
    maxContinuousOutputKw: 5,
    maxContinuousChargeKw: 5,
    roundTripEfficiencyPercent: 90,
    ratedCycleLife: 4000,
    installedCost: 1000,
    strategy: 'arbitrage',
    chargeTiers: [],
    dischargeTiers: [],
  };

  const createSummary = (annualSavings: number): AnnualSimulationSummary => ({
    profileId: baseProfile.id,
    profileName: baseProfile.name,
    totalIntervals: 8760,
    intervalHours: 1,
    totalHomeLoadKwh: 5000,
    baselineAnnualCost: 2000,
    simulatedAnnualCost: 2000 - annualSavings,
    year1Savings: annualSavings,
    savingsPercentage: 20,
    annualGridImportKwh: 3000,
    annualGridExportKwh: 0,
    annualBatteryDischargedKwh: 2000,
    equivalentFullCycles: 200,
    maxPeakDemandKw: 5,
    intervalResults: [],
  });

  // --------------------------------------------------------------------------
  // 7A: Known IRR solver behavior
  // --------------------------------------------------------------------------
  describe('7A — Known IRR solver test', () => {
    it('calculates exact 10% IRR for [-1000, 1100]', () => {
      // Outflow of -1000 at t=0, inflow of 1100 at t=1:
      // -1000 + 1100 / (1 + r) = 0 => 1 + r = 1.10 => r = 10%
      const irr = calculateIRR([-1000, 1100]);
      expect(irr).toBe(10);
    });

    it('returns null when nominal inflows do not recover initial investment', () => {
      // Nominal inflows sum to 900 <= 1000, net nominal = -100 <= 0
      const irr = calculateIRR([-1000, 500, 400]);
      expect(irr).toBeNull();
    });
  });

  // --------------------------------------------------------------------------
  // 7B: Exact Simple Payback
  // --------------------------------------------------------------------------
  describe('7B — Exact Simple Payback', () => {
    it('calculates exactly 4 years simple payback for $1,000 cost and $250 annual savings', () => {
      const summary = createSummary(250);
      const financials = {
        ...DEFAULT_MACRO_FINANCIALS,
        federalTaxCreditPercent: 0,
        localRebateFlat: 0,
        annualElectricityInflationRate: 0,
        annualBatteryDegradationRate: 0,
        replacementEnabled: false,
        isFinanced: false,
      };

      const analysis = calculate15YearFinancials(baseProfile, summary, financials);

      expect(analysis.grossCost).toBe(1000);
      expect(analysis.upfrontOutOfPocket).toBe(1000);
      expect(analysis.paybackYears).toBeCloseTo(4.0, 4);
      expect(analysis.paybackFormatted).toBe('4 yrs');
    });
  });

  // --------------------------------------------------------------------------
  // 7C: Independently Calculated NPV
  // --------------------------------------------------------------------------
  describe('7C — Independently Calculated NPV', () => {
    it('verifies 25-year NPV against independent discounted cash flow sum', () => {
      const summary = createSummary(100); // $100 annual savings
      const financials = {
        ...DEFAULT_MACRO_FINANCIALS,
        federalTaxCreditPercent: 0,
        localRebateFlat: 0,
        annualElectricityInflationRate: 0,
        annualBatteryDegradationRate: 0,
        discountRatePercent: 10.0, // 10% discount rate
        replacementEnabled: false,
        isFinanced: false,
      };

      const analysis = calculate15YearFinancials(baseProfile, summary, financials);

      // Independent formula: NPV = -1000 + Σ(y=1..25) [100 / (1.10)^y]
      let expectedDiscountedSum = 0;
      for (let y = 1; y <= 25; y++) {
        expectedDiscountedSum += 100 / Math.pow(1.10, y);
      }
      const expectedNpv = Math.round(-1000 + expectedDiscountedSum);

      expect(analysis.npv).toBe(expectedNpv);
    });
  });

  // --------------------------------------------------------------------------
  // 8: Valid 0% Discount Rate
  // --------------------------------------------------------------------------
  describe('8 — Valid 0% Discount Rate', () => {
    it('ensures legitimate 0% discount rate is not replaced by default 5%', () => {
      const summary = createSummary(100);
      const financials = {
        ...DEFAULT_MACRO_FINANCIALS,
        federalTaxCreditPercent: 0,
        localRebateFlat: 0,
        annualElectricityInflationRate: 0,
        annualBatteryDegradationRate: 0,
        discountRatePercent: 0, // Explicit 0% discount rate
        replacementEnabled: false,
        isFinanced: false,
      };

      const analysis = calculate15YearFinancials(baseProfile, summary, financials);

      // At 0% discount rate:
      // Discount factor = 1.0 for every year.
      // 25 years * $100/yr = $2,500 nominal savings.
      // Net nominal cash flow = -1000 + 2500 = $1,500.
      // Therefore, NPV at 0% discount rate must equal nominal cumulative cash flow (lifetimeNetProfit = $1,500).
      expect(analysis.discountRatePercent).toBe(0);
      expect(analysis.lifetimeNetProfit).toBe(1500);
      expect(analysis.npv).toBe(analysis.lifetimeNetProfit);
    });
  });
});
