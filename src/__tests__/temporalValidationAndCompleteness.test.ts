import { describe, it, expect } from 'vitest';
import { parseAndValidateEnergyCsv } from '../utils/csvParser';
import { formatHour12, formatDayMMDDYYYY } from '../utils/sampleData';

describe('Temporal validation and timezone-independent dataset completeness', () => {
  function generateQuarterHourCsv(year: number, omitIndex?: number) {
    const leapYear = new Date(Date.UTC(year, 1, 29)).getUTCMonth() === 1;
    const intervalCount = (leapYear ? 366 : 365) * 96;
    const lines = ['Timestamp,Usage kWh'];
    for (let index = 0; index < intervalCount; index += 1) {
      if (index === omitIndex) continue;
      lines.push(`${new Date(Date.UTC(year, 0, 1) + index * 15 * 60_000).toISOString()},0.25`);
    }
    return lines.join('\n');
  }

  function generateCsv(days: number, startYear = 2025, startMonth = 0, startDay = 1, options: {
    duplicateRowIndex?: number;
    outOfOrderIndex?: number;
    skipIntervalIndex?: number;
    skipIntervalCount?: number;
    irregularMinutes?: boolean;
  } = {}) {
    const lines = ['Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement'];
    const startDate = new Date(Date.UTC(startYear, startMonth, startDay, 0, 0, 0));
    let totalIntervals = days * 24;

    for (let i = 0; i < totalIntervals; i++) {
      if (options.skipIntervalIndex !== undefined && i >= options.skipIntervalIndex && i < options.skipIntervalIndex + (options.skipIntervalCount || 1)) {
        continue;
      }

      let intervalDate = new Date(startDate.getTime() + i * 3600 * 1000);

      if (options.outOfOrderIndex !== undefined && i === options.outOfOrderIndex) {
        // Make this timestamp 2 hours earlier than previous
        intervalDate = new Date(startDate.getTime() + (i - 2) * 3600 * 1000);
      }

      const dayStr = formatDayMMDDYYYY(intervalDate);
      let hourStr = formatHour12(intervalDate.getUTCHours());

      if (options.irregularMinutes && i === 10) {
        hourStr = '10:23 AM'; // irregular minute spacing
      }

      lines.push(`${dayStr},${hourStr},1.000,24.000,kWh`);

      if (options.duplicateRowIndex !== undefined && i === options.duplicateRowIndex) {
        // push an exact duplicate row
        lines.push(`${dayStr},${hourStr},1.000,24.000,kWh`);
      }
    }

    return lines.join('\n');
  }

  it('validates a complete normal year (365 days, 8760 intervals) as suitable for annual projection', () => {
    const csvText = generateCsv(365, 2025); // 2025 is a non-leap year
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(true);
    expect(result.schemaValid).toBe(true);
    expect(result.chronologicallyValid).toBe(true);
    expect(result.operationallySimulatable).toBe(true);
    expect(result.annualProjectionEligible).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.completeness?.isSuitableForAnnualProjection).toBe(true);
    expect(result.completeness?.isLeapYear).toBe(false);
    expect(result.completeness?.durationDays).toBeGreaterThanOrEqual(364);
    expect(result.completeness?.durationDays).toBeLessThanOrEqual(366);
    expect(result.completeness?.intervalCount).toBe(8760);
  });

  it('validates a complete leap year (366 days spanning Feb 29, 2024) as suitable for annual projection', () => {
    const csvText = generateCsv(366, 2024); // 2024 is a leap year
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(true);
    expect(result.annualProjectionEligible).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.completeness?.isSuitableForAnnualProjection).toBe(true);
    expect(result.completeness?.isLeapYear).toBe(true);
    expect(result.completeness?.intervalCount).toBe(8784);
  });

  it('accepts exact full quarter-hour calendar years in leap and non-leap years', () => {
    const leap = parseAndValidateEnergyCsv(generateQuarterHourCsv(2024));
    const common = parseAndValidateEnergyCsv(generateQuarterHourCsv(2025));

    expect(leap.annualProjectionEligible).toBe(true);
    expect(leap.completeness?.intervalCount).toBe(35_136);
    expect(leap.completeness?.isLeapYear).toBe(true);
    expect(common.annualProjectionEligible).toBe(true);
    expect(common.completeness?.intervalCount).toBe(35_040);
    expect(common.completeness?.isLeapYear).toBe(false);
  });

  it('marks complete August-to-August rolling years as parser candidates without claiming site-timezone authority', () => {
    const rolling = parseAndValidateEnergyCsv(generateCsv(365, 2025, 7, 1));
    expect(rolling.schemaValid).toBe(true);
    expect(rolling.operationallySimulatable).toBe(true);
    expect(rolling.annualProjectionEligible).toBe(true);
    expect(rolling.completeness?.isSuitableForAnnualProjection).toBe(true);
    expect(rolling.completeness?.durationDays).toBe(365);
  });

  it('does not let parser candidate metadata validate No Data consumption', () => {
    const valid = generateCsv(365, 2025, 7, 1);
    const invalid = valid.replace('1.000,24.000,kWh', 'No Data,24.000,kWh');
    const result = parseAndValidateEnergyCsv(invalid);
    expect(result.schemaValid).toBe(false);
    expect(result.operationallySimulatable).toBe(false);
    expect(result.annualProjectionEligible).toBe(false);
    expect(result.errors.join(' ')).toMatch(/Non-numeric Hourly Total "No Data"/i);
  });

  it('rejects a quarter-hour leap year with a missing row instead of treating it as a complete year', () => {
    const missing = parseAndValidateEnergyCsv(generateQuarterHourCsv(2024, 96));

    expect(missing.operationallySimulatable).toBe(false);
    expect(missing.annualProjectionEligible).toBe(false);
    expect(missing.completeness?.reason).toMatch(/missing or irregular intervals/i);
  });

  it('flags a six-month dataset as NOT suitable for annual financial projection', () => {
    const csvText = generateCsv(180, 2025);
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(true);
    expect(result.operationallySimulatable).toBe(true);
    expect(result.annualProjectionEligible).toBe(false);
    expect(result.completeness?.isSuitableForAnnualProjection).toBe(false);
    expect(result.completeness?.durationDays).toBe(180);
    expect(result.completeness?.reason).toContain('covers only 180 days');
    expect(result.warnings.some((w) => w.includes('covers only 180 days'))).toBe(true);
  });

  it('flags a one-month dataset as NOT suitable for annual financial projection', () => {
    const csvText = generateCsv(30, 2025);
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(true);
    expect(result.completeness?.isSuitableForAnnualProjection).toBe(false);
    expect(result.completeness?.durationDays).toBe(30);
    expect(result.completeness?.reason).toContain('covers only 30 days');
  });

  it('detects duplicate timestamps and raises validation error', () => {
    const csvText = generateCsv(10, 2025, 0, 1, { duplicateRowIndex: 5 });
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(false);
    expect(result.schemaValid).toBe(true);
    expect(result.chronologicallyValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Duplicate timestamp detected'))).toBe(true);
  });

  it('detects out-of-order timestamps and raises validation error', () => {
    // Normal CSV with two rows swapped (row 5 and row 4)
    const lines = [
      'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
      '01/01/2025,12:00 AM,1.000,24.000,kWh',
      '01/01/2025,1:00 AM,1.000,24.000,kWh',
      '01/01/2025,2:00 AM,1.000,24.000,kWh',
      '01/01/2025,4:00 AM,1.000,24.000,kWh', // 4:00 AM comes before 3:00 AM
      '01/01/2025,3:00 AM,1.000,24.000,kWh', // 3:00 AM comes after 4:00 AM
      '01/01/2025,5:00 AM,1.000,24.000,kWh',
    ];
    const csvText = lines.join('\n');
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(false);
    expect(result.schemaValid).toBe(true);
    expect(result.chronologicallyValid).toBe(false);
    expect(result.errors.some((e) => e.includes('Out-of-order timestamp detected'))).toBe(true);
  });

  it('detects significant gaps and flags completeness threshold exceedance', () => {
    // 365 days with 600 missing intervals (> 5% of 8760)
    const csvText = generateCsv(365, 2025, 0, 1, {
      skipIntervalIndex: 1000,
      skipIntervalCount: 600,
    });
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(true);
    expect(result.operationallySimulatable).toBe(false);
    expect(result.annualProjectionEligible).toBe(false);
    expect(result.completeness?.isSuitableForAnnualProjection).toBe(false);
    expect(result.completeness?.missingIntervalCount).toBeGreaterThanOrEqual(600);
    expect(result.completeness?.reason).toContain('missing or irregular intervals');
    expect(result.operationallySimulatable).toBe(false);
    expect(result.annualProjectionEligible).toBe(false);
  });

  it('rejects an annual projection when even one interval is missing', () => {
    const csvText = generateCsv(365, 2025, 0, 1, {
      skipIntervalIndex: 1000,
      skipIntervalCount: 1,
    });
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(true);
    expect(result.operationallySimulatable).toBe(false);
    expect(result.annualProjectionEligible).toBe(false);
    expect(result.completeness?.missingIntervalCount).toBe(1);
  });

  it('detects materially inconsistent interval spacing', () => {
    const csvText = generateCsv(10, 2025, 0, 1, { irregularMinutes: true });
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(true);
    expect(result.operationallySimulatable).toBe(false);
    expect(result.warnings.some((w) => w.includes('Inconsistent interval spacing'))).toBe(true);
  });
});
