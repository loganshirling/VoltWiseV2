import { describe, it, expect } from 'vitest';
import {
  CANONICAL_DAYS,
  UI_DAY_ORDER,
  UI_DAY_NAMES,
  uiRowIndexToDayOfWeek,
  dayOfWeekToUiRowIndex,
  isWeekendDay,
  IntervalDataPoint,
  RateTier,
  BatteryProfile,
} from '../types/energy';
import {
  createDefaultScheduleMatrix,
  DEFAULT_TOU_PROFILES,
  runAnnualSimulation,
} from '../utils/simulationEngine';

describe('Issue 1 — Sunday/Monday Canonical Day-of-Week Schedule Indexing', () => {
  it('correctly maps canonical day of week representation (0=Sun, 1=Mon, ..., 6=Sat)', () => {
    expect(CANONICAL_DAYS[0]).toEqual({ dayOfWeek: 0, name: 'Sunday', shortName: 'Sun', isWeekend: true });
    expect(CANONICAL_DAYS[1]).toEqual({ dayOfWeek: 1, name: 'Monday', shortName: 'Mon', isWeekend: false });
    expect(CANONICAL_DAYS[6]).toEqual({ dayOfWeek: 6, name: 'Saturday', shortName: 'Sat', isWeekend: true });
  });

  it('recognizes Saturday and Sunday as weekends and weekdays as non-weekends', () => {
    expect(isWeekendDay(0)).toBe(true); // Sunday
    expect(isWeekendDay(6)).toBe(true); // Saturday
    expect(isWeekendDay(1)).toBe(false); // Monday
    expect(isWeekendDay(2)).toBe(false); // Tuesday
    expect(isWeekendDay(3)).toBe(false); // Wednesday
    expect(isWeekendDay(4)).toBe(false); // Thursday
    expect(isWeekendDay(5)).toBe(false); // Friday
  });

  it('correctly translates between UI row indices (Mon..Sun) and canonical day of week', () => {
    // UI Row 0 = Monday (canonical 1)
    expect(uiRowIndexToDayOfWeek(0)).toBe(1);
    expect(dayOfWeekToUiRowIndex(1)).toBe(0);

    // UI Row 5 = Saturday (canonical 6)
    expect(uiRowIndexToDayOfWeek(5)).toBe(6);
    expect(dayOfWeekToUiRowIndex(6)).toBe(5);

    // UI Row 6 = Sunday (canonical 0)
    expect(uiRowIndexToDayOfWeek(6)).toBe(0);
    expect(dayOfWeekToUiRowIndex(0)).toBe(6);

    expect(UI_DAY_NAMES[0]).toBe('Monday');
    expect(UI_DAY_NAMES[6]).toBe('Sunday');
  });

  it('ensures default schedule matrix assigns peak hours only on weekdays and mid-peak on weekends', () => {
    const matrix = createDefaultScheduleMatrix();
    expect(matrix).toHaveLength(7);

    // Sunday (index 0) is a weekend: hour 17 (5 PM) should be mid-peak
    expect(matrix[0][17]).toBe('mid-peak');
    // Saturday (index 6) is a weekend: hour 17 (5 PM) should be mid-peak
    expect(matrix[6][17]).toBe('mid-peak');

    // Monday (index 1) to Friday (index 5) are weekdays: hour 17 should be on-peak
    for (let dow = 1; dow <= 5; dow++) {
      expect(matrix[dow][17]).toBe('on-peak');
    }

    // Super off-peak nights (0-5) across all days
    for (let dow = 0; dow < 7; dow++) {
      for (let h = 0; h < 6; h++) {
        expect(matrix[dow][h]).toBe('super-off-peak');
      }
    }
  });

  it('ensures Monday usage uses Monday tariff and Sunday usage uses Sunday tariff in simulation', () => {
    const tiers: RateTier[] = [
      { id: 'mon-tier', name: 'Monday Only Tier', buyRate: 0.80, sellRate: 0.10, color: '#ef4444' },
      { id: 'sun-tier', name: 'Sunday Only Tier', buyRate: 0.10, sellRate: 0.05, color: '#10b981' },
      { id: 'other-tier', name: 'Other Days Tier', buyRate: 0.30, sellRate: 0.08, color: '#f59e0b' },
    ];

    // Create schedule matrix: Monday (1) gets 'mon-tier', Sunday (0) gets 'sun-tier', others get 'other-tier'
    const matrix: string[][] = [];
    for (let dow = 0; dow < 7; dow++) {
      const row: string[] = [];
      for (let h = 0; h < 24; h++) {
        if (dow === 1) row.push('mon-tier');
        else if (dow === 0) row.push('sun-tier');
        else row.push('other-tier');
      }
      matrix.push(row);
    }

    const testBattery: BatteryProfile = {
      id: 'test-bat',
      name: 'Test Bat',
      model: 'Test Model',
      totalCapacityKwh: 10,
      usableDodPercent: 100,
      maxContinuousOutputKw: 5,
      maxContinuousChargeKw: 5,
      roundTripEfficiencyPercent: 100,
      ratedCycleLife: 5000,
      installedCost: 5000,
      strategy: 'arbitrage',
      chargeTiers: [],
      dischargeTiers: [],
    };

    // Construct two interval data points: one on Sunday (dow 0), one on Monday (dow 1)
    const points: IntervalDataPoint[] = [
      {
        timestamp: '2025-09-21 12:00', // Sunday
        date: new Date('2025-09-21T12:00:00'),
        hour: 12,
        dayOfWeek: 0, // Sunday
        month: 8,
        usageKwh: 2.0,
      },
      {
        timestamp: '2025-09-22 12:00', // Monday
        date: new Date('2025-09-22T12:00:00'),
        hour: 12,
        dayOfWeek: 1, // Monday
        month: 8,
        usageKwh: 2.0,
      },
    ];

    const result = runAnnualSimulation(points, 1.0, tiers, matrix, testBattery);
    expect(result.intervalResults).toHaveLength(2);

    // Sunday interval should resolve to 'sun-tier' with buyRate 0.10, baseline cost 2.0 * 0.10 = 0.20
    expect(result.intervalResults[0].tierId).toBe('sun-tier');
    expect(result.intervalResults[0].buyRate).toBe(0.10);
    expect(result.intervalResults[0].baselineCost).toBe(0.20);

    // Monday interval should resolve to 'mon-tier' with buyRate 0.80, baseline cost 2.0 * 0.80 = 1.60
    expect(result.intervalResults[1].tierId).toBe('mon-tier');
    expect(result.intervalResults[1].buyRate).toBe(0.80);
    expect(result.intervalResults[1].baselineCost).toBe(1.60);
  });

  it('ensures weekday-only peak schedule does not affect Saturday or Sunday', () => {
    const defaultProfile = DEFAULT_TOU_PROFILES[0];
    const matrix = defaultProfile.scheduleMatrix;

    // Hours 16..20 on Sunday (0) should NOT have 'on-peak'
    for (let h = 16; h < 21; h++) {
      expect(matrix[0][h]).not.toBe('on-peak');
      expect(matrix[6][h]).not.toBe('on-peak');
      expect(matrix[1][h]).toBe('on-peak'); // Monday has on-peak
    }
  });
});
