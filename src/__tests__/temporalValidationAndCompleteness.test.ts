import { describe, it, expect } from 'vitest';
import { parseAndValidateEnergyCsv } from '../utils/csvParser';
import { formatHour12, formatDayMMDDYYYY } from '../utils/sampleData';

describe('Issue 3 — Temporal Validation & Dataset Completeness', () => {
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
    expect(result.errors).toHaveLength(0);
    expect(result.completeness?.isSuitableForAnnualProjection).toBe(true);
    expect(result.completeness?.isLeapYear).toBe(true);
    expect(result.completeness?.intervalCount).toBe(8784);
  });

  it('flags a six-month dataset as NOT suitable for annual financial projection', () => {
    const csvText = generateCsv(180, 2025);
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(true);
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
    expect(result.completeness?.isSuitableForAnnualProjection).toBe(false);
    expect(result.completeness?.missingIntervalCount).toBeGreaterThanOrEqual(600);
    expect(result.completeness?.reason).toContain('missing intervals');
  });

  it('detects materially inconsistent interval spacing', () => {
    const csvText = generateCsv(10, 2025, 0, 1, { irregularMinutes: true });
    const result = parseAndValidateEnergyCsv(csvText);

    expect(result.isValid).toBe(true);
    expect(result.warnings.some((w) => w.includes('Materially inconsistent interval spacing'))).toBe(true);
  });
});
