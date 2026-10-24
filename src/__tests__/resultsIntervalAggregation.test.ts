import { describe, expect, it } from 'vitest';
import {
  calculateMonthlyConsumptionStats,
  findNearestSeasonDayIndex,
  groupResultIntervalsBySiteDay,
  sumResultIntervalEnergy,
} from '../utils/resultsIntervalAggregation';
import { IntervalSimulationResult } from '../types/energy';

const HOUR_MS = 60 * 60 * 1000;

function createInterval(timestamp: string, homeLoadKwh = 0.25): IntervalSimulationResult {
  return {
    timestamp,
    hour: 0,
    dayOfWeek: 0,
    homeLoadKwh,
    tierId: 'off-peak',
    tierName: 'Off peak',
    buyRate: 0.2,
    sellRate: 0.05,
    batteryChargeKwh: 0.125,
    batteryDischargeKwh: 0.0625,
    batterySocKwh: 5,
    batterySocPercent: 50,
    gridImportKwh: 0.125,
    gridExportKwh: 0,
    baselineCost: 0.05,
    simulatedCost: 0.04,
    netSavings: 0.01,
  };
}

function createUtcIntervals(start: string, count: number, intervalHours: number): IntervalSimulationResult[] {
  const startMs = Date.parse(start);
  const stepMs = intervalHours * HOUR_MS;
  return Array.from({ length: count }, (_, index) =>
    createInterval(new Date(startMs + index * stepMs).toISOString())
  );
}

describe('Results interval aggregation', () => {
  it('groups 48 hourly intervals into two complete local days', () => {
    const intervals = createUtcIntervals('2025-01-01T00:00:00Z', 48, 1);
    const days = groupResultIntervalsBySiteDay(intervals, 1, 'UTC');

    expect(days.map((day) => day.intervals.length)).toEqual([24, 24]);
    expect(days.map((day) => day.dateKey)).toEqual(['2025-01-01', '2025-01-02']);
  });

  it('groups all 192 quarter-hour intervals into two days without resampling', () => {
    const intervals = createUtcIntervals('2025-01-01T00:00:00Z', 192, 0.25);
    const days = groupResultIntervalsBySiteDay(intervals, 0.25, 'UTC');

    expect(days.map((day) => day.intervals.length)).toEqual([96, 96]);
    expect(days.flatMap((day) => day.intervals.map((interval) => interval.result))).toEqual(intervals);
    expect(days[0].intervals[1].timeLabel).toBe('12:15 AM');
    expect(sumResultIntervalEnergy(days[0].intervals)).toEqual({
      homeLoadKwh: 24,
      gridImportKwh: 12,
      batteryChargeKwh: 12,
      batteryDischargeKwh: 6,
    });
  });

  it('groups a complete ordinary-year quarter-hour dataset by calendar day', () => {
    const intervals = createUtcIntervals('2025-01-01T00:00:00Z', 365 * 96, 0.25);
    const days = groupResultIntervalsBySiteDay(intervals, 0.25, 'UTC');

    expect(days).toHaveLength(365);
    expect(days.every((day) => day.intervals.length === 96)).toBe(true);
    expect(days.at(-1)?.dateKey).toBe('2025-12-31');
  });

  it('preserves February 29 at a leap-year boundary', () => {
    const intervals = createUtcIntervals('2024-02-28T00:00:00Z', 72, 1);
    const days = groupResultIntervalsBySiteDay(intervals, 1, 'UTC');

    expect(days.map((day) => [day.dateKey, day.intervals.length])).toEqual([
      ['2024-02-28', 24],
      ['2024-02-29', 24],
      ['2024-03-01', 24],
    ]);
  });

  it('keeps spring-forward and fall-back local days at 23 and 25 hours', () => {
    const spring = createUtcIntervals('2024-03-10T08:00:00Z', 92, 0.25);
    const fall = createUtcIntervals('2024-11-03T07:00:00Z', 100, 0.25);
    const springDays = groupResultIntervalsBySiteDay(spring, 0.25, 'America/Los_Angeles');
    const fallDays = groupResultIntervalsBySiteDay(fall, 0.25, 'America/Los_Angeles');

    expect(springDays.map((day) => [day.dateKey, day.intervals.length])).toEqual([
      ['2024-03-10', 92],
    ]);
    expect(fallDays.map((day) => [day.dateKey, day.intervals.length])).toEqual([
      ['2024-11-03', 100],
    ]);
    expect(fallDays[0].intervals.filter((interval) => interval.timeLabel.startsWith('1:15 AM')))
      .toHaveLength(2);
    expect(new Set(fallDays[0].intervals
      .filter((interval) => interval.timeLabel.startsWith('1:15 AM'))
      .map((interval) => interval.timeLabel))).toEqual(new Set(['1:15 AM PDT', '1:15 AM PST']));
  });

  it('sums daily interval energy exactly and does not annualize partial days', () => {
    const intervals = createUtcIntervals('2025-05-01T23:00:00Z', 8, 0.25);
    const days = groupResultIntervalsBySiteDay(intervals, 0.25, 'UTC');

    expect(days.map((day) => day.intervals.length)).toEqual([4, 4]);
    expect(sumResultIntervalEnergy(days[0].intervals)).toEqual({
      homeLoadKwh: 1,
      gridImportKwh: 0.5,
      batteryChargeKwh: 0.5,
      batteryDischargeKwh: 0.25,
    });
    const monthly = calculateMonthlyConsumptionStats(days);
    expect(monthly.months[4].daysCount).toBe(2);
    expect(monthly.months[4].meanDailyKwh).toBe(1);
    expect(monthly.months[4].totalMonthlyKwh).toBe(2);
  });

  it('aggregates each actual day once and chooses an observed median-representative day', () => {
    const loads = [10, 20, 30, 40];
    const days = loads.map((load, dayIndex) => ({
      dayIndex,
      year: 2025,
      month: 6,
      day: dayIndex + 1,
      dateKey: `2025-07-0${dayIndex + 1}`,
      intervals: [
        {
          result: createInterval(`2025-07-0${dayIndex + 1}T00:00:00Z`, load),
          instantUtc: new Date(`2025-07-0${dayIndex + 1}T00:00:00Z`),
          hour: 0,
          minute: 0,
          timeLabel: '12:00 AM',
        },
      ],
    }));
    const monthly = calculateMonthlyConsumptionStats(days);

    expect(monthly.months[6].daysCount).toBe(4);
    expect(monthly.months[6].medianDailyKwh).toBe(25);
    expect(monthly.months[6].meanDailyKwh).toBe(25);
    expect(monthly.months[6].totalMonthlyKwh).toBe(100);
    expect(monthly.months[6].repDayIndex).toBe(1);
    expect(monthly.months[5].repDayIndex).toBeNull();
  });

  it('only selects seasonal navigation dates that exist in the observed dataset', () => {
    const intervals = createUtcIntervals('2025-02-01T00:00:00Z', 48, 1);
    const days = groupResultIntervalsBySiteDay(intervals, 1, 'UTC');

    expect(findNearestSeasonDayIndex(days, [11, 0, 1], 0, 15)).toBe(0);
    expect(findNearestSeasonDayIndex(days, [2, 3, 4], 2, 20)).toBeNull();
  });

  it('rejects interval sequences with a missing or duplicate timestamp', () => {
    const intervals = createUtcIntervals('2025-01-01T00:00:00Z', 3, 0.25);
    intervals[2] = { ...intervals[2], timestamp: intervals[1].timestamp };

    expect(() => groupResultIntervalsBySiteDay(intervals, 0.25, 'UTC')).toThrow(/Duplicate instant/);
  });
});
