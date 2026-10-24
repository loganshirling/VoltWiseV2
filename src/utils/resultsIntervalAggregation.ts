import { IntervalSimulationResult } from '../types/energy';
import {
  alignLoadTimestampsToSite,
  getSiteLocalCalendarCoordinates,
  SiteLocalCalendarContext,
} from './loadTimeAlignment';

export interface ResultDayInterval {
  result: IntervalSimulationResult;
  instantUtc: Date;
  hour: number;
  minute: number;
  timeLabel: string;
}

export interface ResultIntervalDay {
  dayIndex: number;
  dateKey: string;
  year: number;
  month: number;
  day: number;
  intervals: ResultDayInterval[];
}

export interface DailyIntervalEnergyTotals {
  homeLoadKwh: number;
  gridImportKwh: number;
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
}

export interface MonthlyConsumptionStats {
  months: Array<{
    monthIndex: number;
    shortName: string;
    fullName: string;
    season: string;
    repDayIndex: number | null;
    daysCount: number;
    medianDailyKwh: number;
    meanDailyKwh: number;
    minDailyKwh: number;
    maxDailyKwh: number;
    p25DailyKwh: number;
    p75DailyKwh: number;
    totalMonthlyKwh: number;
    medianWithBatteryKwh: number;
    medianDischargeKwh: number;
    reductionPercent: number;
  }>;
  annualMedian: number;
  annualMean: number;
  peakMonth: MonthlyConsumptionStats['months'][number] | null;
  lowestMonth: MonthlyConsumptionStats['months'][number] | null;
  seasonalSwingPercent: number;
}

/**
 * Groups simulation intervals by the site's actual local calendar dates.
 * Alignment validates cadence and resolves DST transitions using the same
 * timestamp authority used before simulation; no interval is inferred or resampled.
 */
export function groupResultIntervalsBySiteDay(
  intervals: IntervalSimulationResult[],
  intervalHours: number,
  timeZone: string
): ResultIntervalDay[] {
  if (intervals.length === 0) return [];

  const calendarContext = new SiteLocalCalendarContext(timeZone);
  const aligned = alignLoadTimestampsToSite(
    intervals,
    intervalHours,
    calendarContext.timeZone,
    calendarContext
  );
  const days = new Map<string, Omit<ResultIntervalDay, 'dayIndex'>>();

  for (const { sourceIndex, instantUtc } of aligned) {
    const result = intervals[sourceIndex];
    if (!result) {
      throw new Error(`Timestamp alignment returned an unknown interval index: ${sourceIndex}.`);
    }

    const local = getSiteLocalCalendarCoordinates(instantUtc, calendarContext);
    const dateKey = `${local.year}-${String(local.month + 1).padStart(2, '0')}-${String(local.day).padStart(2, '0')}`;
    let group = days.get(dateKey);
    if (!group) {
      group = {
        dateKey,
        year: local.year,
        month: local.month,
        day: local.day,
        intervals: [],
      };
      days.set(dateKey, group);
    }

    group.intervals.push({
      result,
      instantUtc,
      hour: local.hour,
      minute: local.minute,
      timeLabel: '',
    });
  }

  return [...days.values()].map((group, dayIndex) => {
    const repeatedWallTimes = new Set<string>();
    const counts = new Map<string, number>();
    for (const interval of group.intervals) {
      const key = `${interval.hour}:${interval.minute}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    for (const [key, count] of counts) {
      if (count > 1) repeatedWallTimes.add(key);
    }

    const zoneNameFormatter = repeatedWallTimes.size > 0
      ? new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' })
      : null;

    for (const interval of group.intervals) {
      const hour12 = interval.hour % 12 || 12;
      const suffix = interval.hour < 12 ? 'AM' : 'PM';
      const minute = String(interval.minute).padStart(2, '0');
      const wallTimeKey = `${interval.hour}:${interval.minute}`;
      const zoneName = repeatedWallTimes.has(wallTimeKey)
        ? zoneNameFormatter?.formatToParts(interval.instantUtc)
            .find((part) => part.type === 'timeZoneName')?.value
        : undefined;
      interval.timeLabel = `${hour12}:${minute} ${suffix}${zoneName ? ` ${zoneName}` : ''}`;
    }

    return { ...group, dayIndex };
  });
}

type IntervalEntry = IntervalSimulationResult | Pick<ResultDayInterval, 'result'>;

/** Sums observed interval energy without extrapolating partial days. */
export function sumResultIntervalEnergy(intervals: IntervalEntry[]): DailyIntervalEnergyTotals {
  return intervals.reduce<DailyIntervalEnergyTotals>((totals, entry) => {
    const result = 'result' in entry ? entry.result : entry;
    totals.homeLoadKwh += result.homeLoadKwh;
    totals.gridImportKwh += result.gridImportKwh;
    totals.batteryChargeKwh += result.batteryChargeKwh;
    totals.batteryDischargeKwh += result.batteryDischargeKwh;
    return totals;
  }, {
    homeLoadKwh: 0,
    gridImportKwh: 0,
    batteryChargeKwh: 0,
    batteryDischargeKwh: 0,
  });
}

/** Finds the closest observed date within a season; returns null when the period is absent. */
export function findNearestSeasonDayIndex(
  days: Array<Pick<ResultIntervalDay, 'dayIndex' | 'year' | 'month' | 'day'>>,
  seasonMonths: number[],
  targetMonth: number,
  targetDay: number
): number | null {
  const candidates = days.filter((day) => seasonMonths.includes(day.month));
  if (candidates.length === 0) return null;

  return candidates.reduce((best, candidate) => {
    const candidateTarget = Date.UTC(candidate.year, targetMonth, targetDay);
    const candidateDistance = Math.abs(Date.UTC(candidate.year, candidate.month, candidate.day) - candidateTarget);
    const bestTarget = Date.UTC(best.year, targetMonth, targetDay);
    const bestDistance = Math.abs(Date.UTC(best.year, best.month, best.day) - bestTarget);
    return candidateDistance < bestDistance ? candidate : best;
  }).dayIndex;
}

function calculateStats(values: number[]) {
  if (values.length === 0) {
    return { median: 0, mean: 0, min: 0, max: 0, p25: 0, p75: 0, total: 0, count: 0 };
  }

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((total, value) => total + value, 0);
  const mean = Math.round((sum / count) * 10) / 10;
  const middle = Math.floor(count / 2);
  const median = count % 2 !== 0
    ? sorted[middle]
    : Math.round(((sorted[middle - 1] + sorted[middle]) / 2) * 10) / 10;

  return {
    median,
    mean,
    min: sorted[0],
    max: sorted[count - 1],
    p25: sorted[Math.floor(count * 0.25)],
    p75: sorted[Math.floor(count * 0.75)],
    total: Math.round(sum),
    count,
  };
}

/** Computes monthly statistics from actual observed calendar-day energy totals. */
export function calculateMonthlyConsumptionStats(
  days: Array<Pick<ResultIntervalDay, 'dayIndex' | 'month' | 'intervals'>>
): MonthlyConsumptionStats {
  const monthDailyLoads: number[][] = Array.from({ length: 12 }, () => []);
  const monthDailyWithBattery: number[][] = Array.from({ length: 12 }, () => []);
  const monthDailyDischarge: number[][] = Array.from({ length: 12 }, () => []);
  const monthDayIndices: number[][] = Array.from({ length: 12 }, () => []);
  const allDailyLoads: number[] = [];

  for (const day of days) {
    if (day.month < 0 || day.month > 11) continue;
    const totals = sumResultIntervalEnergy(day.intervals);
    const dailyLoad = Math.round(totals.homeLoadKwh * 100) / 100;
    monthDailyLoads[day.month].push(dailyLoad);
    monthDailyWithBattery[day.month].push(Math.round(totals.gridImportKwh * 100) / 100);
    monthDailyDischarge[day.month].push(Math.round(totals.batteryDischargeKwh * 100) / 100);
    monthDayIndices[day.month].push(day.dayIndex);
    allDailyLoads.push(dailyLoad);
  }

  const shortNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const fullNames = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  const seasons = [
    'Winter', 'Winter', 'Spring', 'Spring', 'Spring', 'Summer',
    'Summer', 'Summer', 'Autumn', 'Autumn', 'Autumn', 'Winter',
  ];

  const months = shortNames.map((shortName, monthIndex) => {
    const loads = monthDailyLoads[monthIndex];
    const loadStats = calculateStats(loads);
    const batteryStats = calculateStats(monthDailyWithBattery[monthIndex]);
    const dischargeStats = calculateStats(monthDailyDischarge[monthIndex]);
    let representativeDayIndex: number | null = null;
    if (loads.length > 0) {
      const bestDayOffset = loads.reduce((best, value, index) =>
        Math.abs(value - loadStats.median) < Math.abs(loads[best] - loadStats.median) ? index : best, 0);
      representativeDayIndex = monthDayIndices[monthIndex][bestDayOffset];
    }

    return {
      monthIndex,
      shortName,
      fullName: fullNames[monthIndex],
      season: seasons[monthIndex],
      repDayIndex: representativeDayIndex,
      daysCount: loadStats.count,
      medianDailyKwh: loadStats.median,
      meanDailyKwh: loadStats.mean,
      minDailyKwh: loadStats.min,
      maxDailyKwh: loadStats.max,
      p25DailyKwh: loadStats.p25,
      p75DailyKwh: loadStats.p75,
      totalMonthlyKwh: loadStats.total,
      medianWithBatteryKwh: batteryStats.median,
      medianDischargeKwh: dischargeStats.median,
      reductionPercent: loadStats.median > 0
        ? Math.max(0, Math.round(((loadStats.median - batteryStats.median) / loadStats.median) * 100))
        : 0,
    };
  });

  const annualStats = calculateStats(allDailyLoads);
  const validMonths = months.filter((month) => month.daysCount > 0);
  const peakMonth = validMonths.length > 0
    ? [...validMonths].sort((a, b) => b.medianDailyKwh - a.medianDailyKwh)[0]
    : null;
  const lowestMonth = validMonths.length > 0
    ? [...validMonths].sort((a, b) => a.medianDailyKwh - b.medianDailyKwh)[0]
    : null;
  const seasonalSwingPercent = lowestMonth && lowestMonth.medianDailyKwh > 0 && peakMonth
    ? Math.round(((peakMonth.medianDailyKwh - lowestMonth.medianDailyKwh) / lowestMonth.medianDailyKwh) * 100)
    : 0;

  return {
    months,
    annualMedian: annualStats.median,
    annualMean: annualStats.mean,
    peakMonth,
    lowestMonth,
    seasonalSwingPercent,
  };
}
