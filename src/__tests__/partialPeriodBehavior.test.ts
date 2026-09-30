import { describe, it, expect } from 'vitest';
import {
  derivePartialPeriodDisplayMetrics,
  isDatasetSuitableForAnnualProjections,
  calculate15YearFinancials,
  DEFAULT_MACRO_FINANCIALS,
} from '../utils/simulationEngine';
import {
  canExportProjectionsJson,
  canExportProjectionsCsv,
  generateProjectionsCsv,
} from '../utils/exportJson';
import {
  BatteryProfile,
  AnnualSimulationSummary,
  DatasetCompleteness,
  CsvValidationResult,
} from '../types/energy';

describe('Partial-Period Behavior and Export Guards', () => {
  const mockProfile: BatteryProfile = {
    id: 'partial-bat',
    name: 'Partial Battery',
    model: '13.5 kWh',
    totalCapacityKwh: 13.5,
    usableDodPercent: 100,
    maxContinuousOutputKw: 5.0,
    maxContinuousChargeKw: 5.0,
    roundTripEfficiencyPercent: 90,
    ratedCycleLife: 4000,
    installedCost: 11500, // Explicit installed cost = $11,500
    strategy: 'arbitrage',
    chargeTiers: [],
    dischargeTiers: [],
  };

  const mockCompleteness: DatasetCompleteness = {
    startDate: '2025-01-01 00:00',
    endDate: '2025-06-30 23:00',
    intervalCount: 4320,
    intervalDurationHours: 1,
    durationDays: 180, // Explicit duration = 180 days
    expectedIntervalCount: 8760,
    missingIntervalCount: 4440,
    isLeapYear: false,
    isSuitableForAnnualProjection: false,
    reason: 'Dataset covers only 180 days. Minimum 364 days required for annual projection.',
  };

  const mockSummary: AnnualSimulationSummary = {
    profileId: mockProfile.id,
    profileName: mockProfile.name,
    totalIntervals: 4320,
    intervalHours: 1,
    durationDays: 180,
    totalHomeLoadKwh: 4500,
    baselineAnnualCost: 1000,
    simulatedAnnualCost: 800,
    year1Savings: 200,
    baselinePeriodCost: 1000, // Explicit baseline cost = $1,000
    simulatedPeriodCost: 800,  // Explicit simulated cost = $800
    periodSavings: 200,        // Explicit period savings = $200
    savingsPercentage: 20.0,   // Explicit savings percentage = 20%
    annualGridImportKwh: 3200, // Explicit grid import
    annualGridExportKwh: 150,  // Explicit grid export
    annualBatteryDischargedKwh: 1800, // Explicit discharged energy
    equivalentFullCycles: 133.3, // Explicit equivalent cycles
    maxPeakDemandKw: 6.4,      // Explicit peak demand
    intervalResults: [],
  };

  // --------------------------------------------------------------------------
  // 9A: Observed partial-period metrics derivation
  // --------------------------------------------------------------------------
  describe('9A — Observed partial-period display metrics', () => {
    it('derives observed metrics directly without annualizing period savings', () => {
      const metrics = derivePartialPeriodDisplayMetrics(
        mockProfile,
        mockSummary,
        mockCompleteness
      );

      // Verify every returned field matches explicit non-annualized fixture values:
      expect(metrics.configuredInstalledCostUsd).toBe(11500);
      expect(metrics.durationDays).toBe(180);
      expect(metrics.baselinePeriodCostUsd).toBe(1000);
      expect(metrics.simulatedPeriodCostUsd).toBe(800);
      expect(metrics.periodSavingsUsd).toBe(200); // Critical: period savings must be $200, NOT annualized to $405+
      expect(metrics.savingsPercentage).toBe(20.0);
      expect(metrics.totalHomeLoadKwh).toBe(4500);
      expect(metrics.gridImportKwh).toBe(3200);
      expect(metrics.gridExportKwh).toBe(150);
      expect(metrics.batteryDischargedKwh).toBe(1800);
      expect(metrics.equivalentFullCycles).toBe(133.3);
      expect(metrics.peakDemandKw).toBe(6.4);
    });
  });

  // --------------------------------------------------------------------------
  // 9B: Projection suitability helper
  // --------------------------------------------------------------------------
  describe('9B — Projection suitability helper', () => {
    it('returns false for partial datasets and true for complete annual datasets', () => {
      expect(isDatasetSuitableForAnnualProjections(mockCompleteness)).toBe(false);

      const completeCompleteness: DatasetCompleteness = {
        ...mockCompleteness,
        durationDays: 365,
        intervalCount: 8760,
        expectedIntervalCount: 8760,
        missingIntervalCount: 0,
        isSuitableForAnnualProjection: true,
        reason: undefined,
      };
      expect(isDatasetSuitableForAnnualProjections(completeCompleteness)).toBe(true);

      expect(isDatasetSuitableForAnnualProjections(null)).toBe(false);
      expect(isDatasetSuitableForAnnualProjections(undefined)).toBe(false);
    });
  });

  // --------------------------------------------------------------------------
  // 9C, 9D, 9E: Export guards for partial datasets
  // --------------------------------------------------------------------------
  describe('9C, 9D, 9E — Export guards and generation refusal', () => {
    const partialCsvResult: CsvValidationResult = {
      isValid: true,
      errors: [],
      warnings: [],
      totalRows: 4320,
      validRows: 4320,
      totalKwh: 4500,
      intervalHours: 1,
      startDate: '2025-01-01 00:00',
      endDate: '2025-06-30 23:00',
      peakKw: 6.4,
      data: [],
      completeness: mockCompleteness,
    };

    const analysis = calculate15YearFinancials(
      mockProfile,
      mockSummary,
      DEFAULT_MACRO_FINANCIALS
    );

    it('9C: canExportProjectionsJson returns false for a partial dataset', () => {
      expect(canExportProjectionsJson(analysis, partialCsvResult)).toBe(false);
    });

    it('9D: canExportProjectionsCsv returns false for a partial dataset', () => {
      expect(canExportProjectionsCsv(analysis, partialCsvResult)).toBe(false);
    });

    it('9E: generateProjectionsCsv throws an error when called on a partial dataset', () => {
      expect(() => {
        generateProjectionsCsv(analysis, 15, partialCsvResult);
      }).toThrow('Cannot export projection CSV for an incomplete or unsuitable dataset.');
    });
  });
});
