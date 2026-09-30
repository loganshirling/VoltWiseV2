import { describe, it, expect } from 'vitest';
import { runAnnualSimulation } from '../utils/simulationEngine';
import { BatteryProfile, IntervalDataPoint, RateTier } from '../types/energy';

describe('Issue 5 — Authoritative Dispatch Controls & Grid Export Logic', () => {
  const tiers: RateTier[] = [
    {
      id: 'super-off-peak',
      name: 'Super Off-Peak',
      buyRate: 0.10,
      sellRate: 0.02,
      color: '#06b6d4',
      isChargeWindow: true, // Tariff suggestion flag
      isDischargeWindow: false,
    },
    {
      id: 'on-peak',
      name: 'On-Peak',
      buyRate: 0.60,
      sellRate: 0.20,
      color: '#ef4444',
      isChargeWindow: false,
      isDischargeWindow: true, // Tariff suggestion flag
    },
  ];

  // Schedule matrix: hour 0..5 is super-off-peak, 16..20 is on-peak
  const scheduleMatrix: string[][] = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, (_, h) => (h >= 16 && h < 21 ? 'on-peak' : 'super-off-peak'))
  );

  it('Problem A: User charge/discharge controls are authoritative and override tariff flags', () => {
    // Battery profile where user has explicitly UNCHECKED chargeTiers and dischargeTiers
    const batteryWithoutTiers: BatteryProfile = {
      id: 'no-tiers-battery',
      name: 'No Tiers Battery',
      model: '10 kWh',
      totalCapacityKwh: 10,
      usableDodPercent: 100,
      maxContinuousOutputKw: 5,
      maxContinuousChargeKw: 5,
      roundTripEfficiencyPercent: 90,
      ratedCycleLife: 4000,
      installedCost: 8000,
      strategy: 'arbitrage',
      chargeTiers: [], // Explicitly empty: user does NOT want charging here
      dischargeTiers: [], // Explicitly empty: user does NOT want discharging here
      allowGridExport: false,
    };

    const points: IntervalDataPoint[] = [
      {
        timestamp: '2025-01-01 02:00', // Super off-peak (tier.isChargeWindow is true)
        date: new Date('2025-01-01T02:00:00'),
        hour: 2,
        dayOfWeek: 3,
        month: 0,
        usageKwh: 1.0,
      },
      {
        timestamp: '2025-01-01 17:00', // On-peak (tier.isDischargeWindow is true)
        date: new Date('2025-01-01T17:00:00'),
        hour: 17,
        dayOfWeek: 3,
        month: 0,
        usageKwh: 1.0,
      },
    ];

    const result = runAnnualSimulation(points, 1.0, tiers, scheduleMatrix, batteryWithoutTiers);

    // Battery must NOT charge in interval 0 despite tier.isChargeWindow === true
    expect(result.intervalResults[0].batteryChargeKwh).toBe(0);

    // Battery must NOT discharge in interval 1 despite tier.isDischargeWindow === true
    expect(result.intervalResults[1].batteryDischargeKwh).toBe(0);
  });

  it('Problem B: Battery does NOT export to grid when allowGridExport is false', () => {
    const batteryNoExport: BatteryProfile = {
      id: 'no-export-bat',
      name: 'No Export Battery',
      model: '10 kWh',
      totalCapacityKwh: 10,
      usableDodPercent: 100,
      maxContinuousOutputKw: 5,
      maxContinuousChargeKw: 5,
      roundTripEfficiencyPercent: 100,
      ratedCycleLife: 4000,
      installedCost: 8000,
      strategy: 'arbitrage',
      chargeTiers: ['super-off-peak'],
      dischargeTiers: ['on-peak'],
      allowGridExport: false, // Disabled
    };

    // Low load interval (0.2 kWh) during peak with high sellRate ($0.20)
    const points: IntervalDataPoint[] = [
      {
        timestamp: '2025-01-01 02:00',
        date: new Date('2025-01-01T02:00:00'),
        hour: 2,
        dayOfWeek: 3,
        month: 0,
        usageKwh: 0.2,
      },
      {
        timestamp: '2025-01-01 17:00',
        date: new Date('2025-01-01T17:00:00'),
        hour: 17,
        dayOfWeek: 3,
        month: 0,
        usageKwh: 0.2,
      },
    ];

    const result = runAnnualSimulation(points, 1.0, tiers, scheduleMatrix, batteryNoExport);

    // In interval 1 (hour 17), home load is 0.2 kWh. Discharge covers home load, but grid export must be 0.
    expect(result.intervalResults[1].batteryDischargeKwh).toBe(0.2);
    expect(result.intervalResults[1].gridExportKwh).toBe(0);
  });

  it('Problem B: Battery only exports to grid when allowGridExport is true AND export is economically profitable', () => {
    // Case 1: Unprofitable export (sellRate = $0.05, but charged at $0.20 with 80% RTE)
    const expensiveTiers: RateTier[] = [
      {
        id: 'super-off-peak',
        name: 'Super Off-Peak',
        buyRate: 0.20,
        sellRate: 0.02,
        color: '#06b6d4',
      },
      {
        id: 'on-peak',
        name: 'On-Peak',
        buyRate: 0.50,
        sellRate: 0.05, // Unprofitable export ($0.05 < stored cost of ~$0.25)
        color: '#ef4444',
      },
    ];

    const batteryWithExport: BatteryProfile = {
      id: 'export-bat',
      name: 'Export Battery',
      model: '10 kWh',
      totalCapacityKwh: 10,
      usableDodPercent: 100,
      maxContinuousOutputKw: 5,
      maxContinuousChargeKw: 5,
      roundTripEfficiencyPercent: 80,
      ratedCycleLife: 4000,
      installedCost: 8000,
      strategy: 'arbitrage',
      chargeTiers: ['super-off-peak'],
      dischargeTiers: ['on-peak'],
      allowGridExport: true, // Enabled
    };

    const points: IntervalDataPoint[] = [
      {
        timestamp: '2025-01-01 02:00',
        date: new Date('2025-01-01T02:00:00'),
        hour: 2,
        dayOfWeek: 3,
        month: 0,
        usageKwh: 0.5,
      },
      {
        timestamp: '2025-01-01 17:00',
        date: new Date('2025-01-01T17:00:00'),
        hour: 17,
        dayOfWeek: 3,
        month: 0,
        usageKwh: 0.5,
      },
    ];

    const resultUnprofitable = runAnnualSimulation(points, 1.0, expensiveTiers, scheduleMatrix, batteryWithExport);
    // Grid export should be 0 because sell rate $0.05 is below stored energy cost
    expect(resultUnprofitable.intervalResults[1].gridExportKwh).toBe(0);

    // Case 2: Profitable export (sellRate = $0.40, charged at $0.05)
    const profitableTiers: RateTier[] = [
      {
        id: 'super-off-peak',
        name: 'Super Off-Peak',
        buyRate: 0.05,
        sellRate: 0.02,
        color: '#06b6d4',
      },
      {
        id: 'on-peak',
        name: 'On-Peak',
        buyRate: 0.60,
        sellRate: 0.40, // Highly profitable export
        color: '#ef4444',
      },
    ];

    const resultProfitable = runAnnualSimulation(points, 1.0, profitableTiers, scheduleMatrix, batteryWithExport);
    // Battery discharges for home load (0.5 kWh) and exports remaining capacity to grid
    expect(resultProfitable.intervalResults[1].gridExportKwh).toBeGreaterThan(0);
  });
});
