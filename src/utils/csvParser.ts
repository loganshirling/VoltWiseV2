/**
 * CSV Parser & Schema Validator for Interval Energy Data.
 * Schema Requirement:
 * Day, Hour of Day, Hourly Total, Daily Total, Unit of Measurement
 * Example:
 * 09/22/2025, 12:00 AM, 1.018, 25.075, kWh
 */
import { CsvValidationResult, DatasetCompleteness, IntervalDataPoint } from '../types/energy';

interface ParsedDay {
  year: number;
  month: number; // 1-12
  day: number; // 1-31
}

interface ParsedTime {
  hour: number; // 0-23
  minute: number; // 0-59
}

/**
 * Robust date parser supporting MM/DD/YYYY, YYYY-MM-DD, M/D/YYYY, etc.
 */
function parseDayString(raw: string): ParsedDay | null {
  const trimmed = raw.trim();
  
  // Format MM/DD/YYYY or M/D/YYYY
  const slashMatch = trimmed.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const day = parseInt(slashMatch[2], 10);
    const year = parseInt(slashMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1970 && year <= 2100) {
      return { year, month, day };
    }
  }

  // Format YYYY-MM-DD or YYYY/MM/DD
  const dashMatch = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (dashMatch) {
    const year = parseInt(dashMatch[1], 10);
    const month = parseInt(dashMatch[2], 10);
    const day = parseInt(dashMatch[3], 10);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31 && year >= 1970 && year <= 2100) {
      return { year, month, day };
    }
  }

  // Fallback JavaScript date parse
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) {
    return {
      year: d.getFullYear(),
      month: d.getMonth() + 1,
      day: d.getDate(),
    };
  }

  return null;
}

/**
 * Robust hour of day parser supporting:
 * "12:00 AM", "1:00 AM", "12:00 PM", "1:00 PM", "11:00 PM"
 * "12 AM", "1 PM", "00:00", "13:00", 0..23
 */
function parseHourOfDay(raw: string): ParsedTime | null {
  const trimmed = raw.trim().toUpperCase();

  // 12-hour format with AM/PM (e.g. "12:00 AM", "1:00 PM", "12 AM", "01:30 PM")
  const match12 = trimmed.match(/^(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(AM|PM)$/);
  if (match12) {
    let h = parseInt(match12[1], 10);
    const m = match12[2] ? parseInt(match12[2], 10) : 0;
    const ampm = match12[4];

    if (h < 1 || h > 12 || m < 0 || m > 59) return null;

    if (ampm === 'AM') {
      h = h === 12 ? 0 : h;
    } else {
      h = h === 12 ? 12 : h + 12;
    }
    return { hour: h, minute: m };
  }

  // 24-hour format (e.g. "00:00", "13:00", "23:59")
  const match24 = trimmed.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (match24) {
    const h = parseInt(match24[1], 10);
    const m = parseInt(match24[2], 10);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return { hour: h, minute: m };
    }
    return null;
  }

  // Integer 0 to 23
  const rawNum = parseInt(trimmed, 10);
  if (!isNaN(rawNum) && rawNum >= 0 && rawNum <= 23 && /^\d+$/.test(trimmed)) {
    return { hour: rawNum, minute: 0 };
  }

  return null;
}

/**
 * Split line by comma or tab, handling quotes
 */
function splitCsvLine(line: string): string[] {
  // If line contains tabs and no commas outside tabs, split by tab
  if (line.includes('\t') && !line.includes(',')) {
    return line.split('\t').map(c => c.trim().replace(/^["']|["']$/g, ''));
  }

  // Otherwise split by comma, respecting quotes
  const result: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^["']|["']$/g, ''));
      current = '';
    } else {
      current += char;
    }
  }
  result.push(current.trim().replace(/^["']|["']$/g, ''));
  return result;
}

export function parseAndValidateEnergyCsv(csvText: string): CsvValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const dataPoints: IntervalDataPoint[] = [];

  if (!csvText || !csvText.trim()) {
    return {
      isValid: false,
      errors: ['The uploaded file is empty.'],
      warnings: [],
      totalRows: 0,
      validRows: 0,
      totalKwh: 0,
      intervalHours: 1,
      peakKw: 0,
      data: [],
    };
  }

  // Split lines (handling both CRLF and LF)
  const lines = csvText.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
  
  if (lines.length < 2) {
    return {
      isValid: false,
      errors: ['File must contain a header row and at least one data row.'],
      warnings: [],
      totalRows: lines.length,
      validRows: 0,
      totalKwh: 0,
      intervalHours: 1,
      peakKw: 0,
      data: [],
    };
  }

  // Step 1: Header Validation & Schema Identification
  const headerCols = splitCsvLine(lines[0]).map(c => c.toLowerCase().replace(/[^a-z0-9]/g, ''));

  // Check 5-column schema:
  // Expected headers: "Day", "Hour of Day", "Hourly Total", "Daily Total", "Unit of Measurement"
  const isColDay = (col: string) => col.includes('day') || col.includes('date');
  const isColHour = (col: string) => col.includes('hour') || col.includes('time');
  const isColHourlyTotal = (col: string) => (col.includes('hourly') && col.includes('total')) || col.includes('usage') || col.includes('kwh');
  const isColDailyTotal = (col: string) => col.includes('daily') && col.includes('total');
  const isColUnit = (col: string) => col.includes('unit') || col.includes('measurement') || col === 'uom';

  const matches5ColSchema =
    headerCols.length >= 5 &&
    (isColDay(headerCols[0]) || headerCols[0].includes('day')) &&
    (isColHour(headerCols[1]) || headerCols[1].includes('hour')) &&
    (isColHourlyTotal(headerCols[2]) || headerCols[2].includes('hourly')) &&
    (isColDailyTotal(headerCols[3]) || headerCols[3].includes('daily')) &&
    (isColUnit(headerCols[4]) || headerCols[4].includes('unit'));

  // Legacy 2-column schema fallback: "timestamp, usage_kwh"
  const matchesLegacy2Col =
    headerCols.length === 2 &&
    (headerCols[0].includes('timestamp') || headerCols[0].includes('time') || headerCols[0].includes('date')) &&
    (headerCols[1].includes('usage') || headerCols[1].includes('kwh') || headerCols[1].includes('total'));

  if (!matches5ColSchema && !matchesLegacy2Col) {
    return {
      isValid: false,
      errors: [
        `Strict schema violation: File header does not match required schema.`,
        `Expected schema: "Day, Hour of Day, Hourly Total, Daily Total, Unit of Measurement"`,
        `Received header: "${lines[0]}"`,
        `Example row: "09/22/2025, 12:00 AM, 1.018, 25.075, kWh"`,
      ],
      warnings: [],
      totalRows: lines.length - 1,
      validRows: 0,
      totalKwh: 0,
      intervalHours: 1,
      peakKw: 0,
      data: [],
    };
  }

  const schemaDetected = matches5ColSchema ? 'standard_5col' : 'legacy_2col';
  if (schemaDetected === 'legacy_2col') {
    warnings.push(
      'Detected legacy 2-column format (timestamp, usage_kwh). Standard schema "Day, Hour of Day, Hourly Total, Daily Total, Unit of Measurement" is recommended.'
    );
  }

  // Step 2: Row by Row Validation & Ingestion
  let totalKwh = 0;
  let maxUsageKwh = 0;
  const maxErrorsToCollect = 10;
  let errorCount = 0;

  // Track daily sums to validate reported Daily Total
  const dayGroupTotals = new Map<string, { reportedDaily: number; calculatedSum: number; count: number }>();

  // Temporal validation trackers
  const seenTimestamps = new Set<string>();
  let lastTimestampMs: number | null = null;

  for (let i = 1; i < lines.length; i++) {
    const rowNum = i + 1;
    const line = lines[i];
    const cols = splitCsvLine(line);

    if (schemaDetected === 'standard_5col') {
      if (cols.length < 5) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Expected 5 columns (Day, Hour of Day, Hourly Total, Daily Total, Unit of Measurement), found ${cols.length}: "${line}"`);
        }
        errorCount++;
        continue;
      }

      const [rawDay, rawHour, rawHourlyTotal, rawDailyTotal, rawUnit] = cols;

      // 1. Validate Day
      const parsedDay = parseDayString(rawDay);
      if (!parsedDay) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Invalid Day format "${rawDay}". Expected MM/DD/YYYY (e.g. 09/22/2025).`);
        }
        errorCount++;
        continue;
      }

      // 2. Validate Hour of Day
      const parsedTime = parseHourOfDay(rawHour);
      if (!parsedTime) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Invalid Hour of Day format "${rawHour}". Expected format like "12:00 AM", "1:00 AM", or "2:00 PM".`);
        }
        errorCount++;
        continue;
      }

      // 3. Validate Hourly Total
      const hourlyVal = parseFloat(rawHourlyTotal);
      if (isNaN(hourlyVal) || !isFinite(hourlyVal)) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Non-numeric Hourly Total "${rawHourlyTotal}". Must be a valid positive number.`);
        }
        errorCount++;
        continue;
      }
      if (hourlyVal < 0) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Negative Hourly Total "${rawHourlyTotal}". Usage cannot be negative.`);
        }
        errorCount++;
        continue;
      }

      // 4. Validate Daily Total
      const dailyVal = parseFloat(rawDailyTotal);
      if (isNaN(dailyVal) || !isFinite(dailyVal)) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Non-numeric Daily Total "${rawDailyTotal}". Must be a valid positive number.`);
        }
        errorCount++;
        continue;
      }
      if (dailyVal < 0) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Negative Daily Total "${rawDailyTotal}". Daily consumption cannot be negative.`);
        }
        errorCount++;
        continue;
      }

      // 5. Validate Unit of Measurement
      const unitClean = rawUnit ? rawUnit.trim() : 'kWh';
      let multiplier = 1.0;
      const unitLower = unitClean.toLowerCase();
      if (unitLower === 'kwh' || unitLower === 'kw') {
        multiplier = 1.0;
      } else if (unitLower === 'wh') {
        multiplier = 0.001;
      } else if (unitLower === 'mwh') {
        multiplier = 1000.0;
      } else {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Unrecognized Unit of Measurement "${rawUnit}". Expected "kWh" (or "Wh", "MWh").`);
        }
        errorCount++;
        continue;
      }

      const usageKwh = hourlyVal * multiplier;
      const reportedDailyKwh = dailyVal * multiplier;

      // Construct Date
      const dateObj = new Date(
        parsedDay.year,
        parsedDay.month - 1,
        parsedDay.day,
        parsedTime.hour,
        parsedTime.minute,
        0
      );

      const normalizedTs = `${parsedDay.year}-${String(parsedDay.month).padStart(2, '0')}-${String(parsedDay.day).padStart(2, '0')} ${String(parsedTime.hour).padStart(2, '0')}:${String(parsedTime.minute).padStart(2, '0')}`;
      const timeMs = dateObj.getTime();

      // Temporal validation: detect duplicates
      if (seenTimestamps.has(normalizedTs)) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Duplicate timestamp detected: "${normalizedTs}".`);
        }
        errorCount++;
        continue;
      }
      seenTimestamps.add(normalizedTs);

      // Temporal validation: detect out-of-order timestamps
      if (lastTimestampMs !== null && timeMs < lastTimestampMs) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Out-of-order timestamp detected. Timestamp "${normalizedTs}" is earlier than previous timestamp.`);
        }
        errorCount++;
        continue;
      }
      lastTimestampMs = timeMs;

      const dayKey = `${parsedDay.year}-${String(parsedDay.month).padStart(2, '0')}-${String(parsedDay.day).padStart(2, '0')}`;

      // Aggregate day validation
      const existingDay = dayGroupTotals.get(dayKey);
      if (existingDay) {
        existingDay.calculatedSum += usageKwh;
        existingDay.count += 1;
      } else {
        dayGroupTotals.set(dayKey, {
          reportedDaily: reportedDailyKwh,
          calculatedSum: usageKwh,
          count: 1,
        });
      }

      totalKwh += usageKwh;
      if (usageKwh > maxUsageKwh) maxUsageKwh = usageKwh;

      dataPoints.push({
        timestamp: normalizedTs,
        date: dateObj,
        hour: parsedTime.hour,
        dayOfWeek: dateObj.getDay(),
        month: dateObj.getMonth(),
        usageKwh: Math.round(usageKwh * 1000) / 1000,
        dayStr: rawDay,
        hourOfDayStr: rawHour,
        hourlyTotal: hourlyVal,
        dailyTotal: dailyVal,
        unitOfMeasurement: unitClean,
      });

    } else {
      // Legacy 2-column parser
      if (cols.length < 2) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Expected 2 values (timestamp, usage_kwh), found ${cols.length}`);
        }
        errorCount++;
        continue;
      }

      const [rawTs, rawUsage] = cols;
      const normalizedTs = rawTs.replace(' ', 'T');
      const parsedDate = new Date(normalizedTs);

      if (isNaN(parsedDate.getTime())) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Invalid timestamp "${rawTs}". Format must be YYYY-MM-DD HH:mm.`);
        }
        errorCount++;
        continue;
      }

      const timeMs = parsedDate.getTime();
      const canonicalKey = rawTs.trim();

      if (seenTimestamps.has(canonicalKey)) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Duplicate timestamp detected: "${rawTs}".`);
        }
        errorCount++;
        continue;
      }
      seenTimestamps.add(canonicalKey);

      if (lastTimestampMs !== null && timeMs < lastTimestampMs) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Out-of-order timestamp detected. Timestamp "${rawTs}" is earlier than previous timestamp.`);
        }
        errorCount++;
        continue;
      }
      lastTimestampMs = timeMs;

      const usage = Number(rawUsage);
      if (isNaN(usage) || !isFinite(usage) || usage < 0) {
        if (errorCount < maxErrorsToCollect) {
          errors.push(`Row ${rowNum}: Invalid usage_kwh "${rawUsage}". Must be a positive number.`);
        }
        errorCount++;
        continue;
      }

      totalKwh += usage;
      if (usage > maxUsageKwh) maxUsageKwh = usage;

      const hour12 = parsedDate.getHours() % 12 || 12;
      const ampm = parsedDate.getHours() >= 12 ? 'PM' : 'AM';
      const m = String(parsedDate.getMonth() + 1).padStart(2, '0');
      const d = String(parsedDate.getDate()).padStart(2, '0');
      const y = parsedDate.getFullYear();

      dataPoints.push({
        timestamp: rawTs,
        date: parsedDate,
        hour: parsedDate.getHours(),
        dayOfWeek: parsedDate.getDay(),
        month: parsedDate.getMonth(),
        usageKwh: usage,
        dayStr: `${m}/${d}/${y}`,
        hourOfDayStr: `${hour12}:00 ${ampm}`,
        hourlyTotal: usage,
        dailyTotal: 0,
        unitOfMeasurement: 'kWh',
      });
    }
  }

  if (errorCount > maxErrorsToCollect) {
    errors.push(`... and ${errorCount - maxErrorsToCollect} more row validation errors.`);
  }

  if (errors.length > 0) {
    return {
      isValid: false,
      errors,
      warnings,
      totalRows: lines.length - 1,
      validRows: dataPoints.length,
      totalKwh: Math.round(totalKwh * 100) / 100,
      intervalHours: 1,
      peakKw: 0,
      data: [],
      schemaDetected,
    };
  }

  // Cross-check reported Daily Total vs Calculated Sum for completed days
  let dailyDiscrepancyCount = 0;
  for (const [dayKey, stats] of dayGroupTotals.entries()) {
    if (stats.count === 24) {
      const diff = Math.abs(stats.calculatedSum - stats.reportedDaily);
      // If discrepancy is noticeable (> 0.2 kWh or > 2%)
      if (diff > 0.2 && diff / (stats.reportedDaily || 1) > 0.02) {
        dailyDiscrepancyCount++;
        if (dailyDiscrepancyCount <= 2) {
          warnings.push(
            `Notice for ${dayKey}: Sum of 24 hourly intervals (${stats.calculatedSum.toFixed(3)} kWh) differs slightly from reported Daily Total (${stats.reportedDaily.toFixed(3)} kWh). Simulation uses the precise hourly interval totals.`
          );
        }
      }
    }
  }

  // Detect interval duration Δt in hours & analyze temporal spacing
  let intervalHours = 1.0;
  let totalMissingIntervals = 0;
  let inconsistentIntervalsCount = 0;

  if (dataPoints.length >= 2) {
    // Determine most common step interval (mode)
    const stepCounts = new Map<number, number>();
    for (let i = 1; i < dataPoints.length; i++) {
      const diffMs = dataPoints[i].date.getTime() - dataPoints[i - 1].date.getTime();
      if (diffMs > 0) {
        stepCounts.set(diffMs, (stepCounts.get(diffMs) || 0) + 1);
      }
    }

    let modalStepMs = 3600 * 1000;
    let maxCount = 0;
    for (const [stepMs, count] of stepCounts.entries()) {
      if (count > maxCount) {
        maxCount = count;
        modalStepMs = stepMs;
      }
    }

    intervalHours = modalStepMs / (3600 * 1000);

    // Analyze gaps and inconsistent spacing
    for (let i = 1; i < dataPoints.length; i++) {
      const diffMs = dataPoints[i].date.getTime() - dataPoints[i - 1].date.getTime();
      const ratio = diffMs / modalStepMs;
      const nearestMultiple = Math.round(ratio);
      const remainderMs = Math.abs(diffMs - nearestMultiple * modalStepMs);

      if (remainderMs > 60 * 1000) {
        inconsistentIntervalsCount++;
      } else if (nearestMultiple > 1) {
        const missingInGap = nearestMultiple - 1;
        totalMissingIntervals += missingInGap;
        if (diffMs >= 24 * 3600 * 1000 && warnings.length < 5) {
          const gapHours = Math.round(diffMs / (3600 * 1000));
          warnings.push(
            `Significant data gap of ~${gapHours} hours detected between ${dataPoints[i - 1].timestamp} and ${dataPoints[i].timestamp}.`
          );
        }
      }
    }

    if (inconsistentIntervalsCount > 0) {
      warnings.push(
        `Materially inconsistent interval spacing detected across ${inconsistentIntervalsCount} intervals.`
      );
    }
  }

  // Dataset completeness evaluation
  const firstDate = dataPoints[0]?.date;
  const lastDate = dataPoints[dataPoints.length - 1]?.date;
  const modalStepMs = intervalHours * 3600 * 1000;

  let durationDays = 0;
  let expectedIntervalCount = 0;
  let isLeapYear = false;
  let isSuitableForAnnualProjection = false;
  let unsuitabilityReason: string | undefined = undefined;

  if (firstDate && lastDate) {
    const totalSpanMs = lastDate.getTime() - firstDate.getTime() + modalStepMs;
    durationDays = Math.round((totalSpanMs / (24 * 3600 * 1000)) * 10) / 10;
    expectedIntervalCount = Math.round(totalSpanMs / modalStepMs);

    // Check if the range spans a leap day (Feb 29)
    for (let y = firstDate.getFullYear(); y <= lastDate.getFullYear(); y++) {
      const isYearLeap = (y % 4 === 0 && y % 100 !== 0) || (y % 400 === 0);
      if (isYearLeap) {
        const feb29 = new Date(y, 1, 29, 12, 0, 0);
        if (feb29 >= firstDate && feb29 <= lastDate) {
          isLeapYear = true;
          break;
        }
      }
    }

    const expectedFullYearDays = isLeapYear ? 366 : 365;
    const expectedAnnualIntervals = Math.round((expectedFullYearDays * 24) / intervalHours);

    // Suitability check for annual financial projection
    if (durationDays < 360) {
      isSuitableForAnnualProjection = false;
      const approxMonths = (durationDays / 30.4).toFixed(1);
      unsuitabilityReason = `Dataset covers only ${durationDays} days (~${approxMonths} months). Annual financial projections require approximately one full year (~${expectedFullYearDays} days) of continuous data.`;
      warnings.push(unsuitabilityReason);
    } else if (durationDays > 370) {
      isSuitableForAnnualProjection = false;
      unsuitabilityReason = `Dataset duration is ${durationDays} days, which exceeds a single annual cycle (~${expectedFullYearDays} days).`;
      warnings.push(unsuitabilityReason);
    } else if (totalMissingIntervals > expectedAnnualIntervals * 0.05) {
      isSuitableForAnnualProjection = false;
      const missingPct = ((totalMissingIntervals / expectedAnnualIntervals) * 100).toFixed(1);
      unsuitabilityReason = `Dataset has ${totalMissingIntervals} missing intervals (${missingPct}% missing), exceeding the 5% data gap threshold for annual financial projections.`;
      warnings.push(unsuitabilityReason);
    } else if (inconsistentIntervalsCount > 50) {
      isSuitableForAnnualProjection = false;
      unsuitabilityReason = `Dataset contains materially inconsistent interval spacing (${inconsistentIntervalsCount} irregular intervals).`;
      warnings.push(unsuitabilityReason);
    } else {
      isSuitableForAnnualProjection = true;
    }
  }

  const completeness: DatasetCompleteness = {
    startDate: dataPoints[0]?.timestamp || '',
    endDate: dataPoints[dataPoints.length - 1]?.timestamp || '',
    intervalCount: dataPoints.length,
    intervalDurationHours: intervalHours,
    durationDays,
    expectedIntervalCount,
    missingIntervalCount: totalMissingIntervals,
    isLeapYear,
    isSuitableForAnnualProjection,
    reason: unsuitabilityReason,
    totalIntervals: dataPoints.length,
    intervalHours,
    expectedIntervals: expectedIntervalCount,
    isCompleteYear: isSuitableForAnnualProjection,
    isAnnualProjectionSuitable: isSuitableForAnnualProjection,
    unsuitabilityReason,
  };

  const peakKw = intervalHours > 0 ? maxUsageKwh / intervalHours : maxUsageKwh;

  return {
    isValid: true,
    errors: [],
    warnings,
    totalRows: lines.length - 1,
    validRows: dataPoints.length,
    totalKwh: Math.round(totalKwh * 100) / 100,
    intervalHours,
    startDate: dataPoints[0]?.timestamp,
    endDate: dataPoints[dataPoints.length - 1]?.timestamp,
    peakKw: Math.round(peakKw * 100) / 100,
    data: dataPoints,
    schemaDetected,
    completeness,
  };
}
