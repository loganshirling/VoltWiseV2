import { describe, it, expect } from 'vitest';
import {
  DEFAULT_MACRO_FINANCIALS,
  calculate15YearFinancials,
} from '../utils/simulationEngine';
import { BatteryProfile, AnnualSimulationSummary } from '../types/energy';

describe('Issue 2 — Incentive Defaults & Explicit Input Handling', () => {
  const dummyBattery: BatteryProfile = {
    id: 'test-powerwall',
    name: 'Test Battery',
    model: '13.5 kWh',
    totalCapacityKwh: 13.5,
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

  const dummySummary: AnnualSimulationSummary = {
    profileId: dummyBattery.id,
    profileName: dummyBattery.name,
    totalIntervals: 8760,
    intervalHours: 1,
    totalHomeLoadKwh: 8000,
    baselineAnnualCost: 2000,
    simulatedAnnualCost: 1200,
    year1Savings: 800,
    savingsPercentage: 40,
    annualGridImportKwh: 5000,
    annualGridExportKwh: 0,
    annualBatteryDischargedKwh: 3000,
    equivalentFullCycles: 222,
    maxPeakDemandKw: 5.5,
    intervalResults: [],
  };

  it('ensures default federal tax credit is 0% and local rebate is $0', () => {
    expect(DEFAULT_MACRO_FINANCIALS.federalTaxCreditPercent).toBe(0);
    expect(DEFAULT_MACRO_FINANCIALS.localRebateFlat).toBe(0);
  });

  it('calculates gross cost equals net installed cost when defaults (0%, $0) are used', () => {
    const analysis = calculate15YearFinancials(dummyBattery, dummySummary, DEFAULT_MACRO_FINANCIALS);
    expect(analysis.grossCost).toBe(10000);
    expect(analysis.incentivesAmount).toBe(0);
    expect(analysis.netInstalledCost).toBe(10000);
    expect(analysis.upfrontOutOfPocket).toBe(10000);
  });

  it('correctly reflects user-entered incentives in net installed cost and upfront basis', () => {
    // 30% federal credit on $10,000 = $3,000, plus $1,000 flat rebate = $4,000 total incentives
    const customFinancials = {
      ...DEFAULT_MACRO_FINANCIALS,
      federalTaxCreditPercent: 30,
      localRebateFlat: 1000,
      federalTaxCreditRealizationYear: 1,
    };

    const analysis = calculate15YearFinancials(dummyBattery, dummySummary, customFinancials);
    expect(analysis.grossCost).toBe(10000);
    expect(analysis.incentivesAmount).toBe(4000);
    expect(analysis.netInstalledCost).toBe(6000);

    // Immediate rebate ($1,000) reduces upfront outlay to $9,000.
    // The $3,000 tax credit is realized as Year 1 cash inflow.
    expect(analysis.upfrontOutOfPocket).toBe(9000);
    expect(analysis.projections[0].taxCreditInflow).toBe(3000);
  });
});
