/**
 * Utilities for generating standard CSV templates and realistic 8,760-hour household datasets
 * matching the 5-column schema:
 * Day, Hour of Day, Hourly Total, Daily Total, Unit of Measurement
 */
import { IntervalDataPoint } from '../types/energy';

/**
 * Format 24h integer hour (0..23) to 12-hour AM/PM string (e.g. "12:00 AM", "1:00 AM", "12:00 PM", "1:00 PM")
 */
export function formatHour12(hour: number): string {
  if (hour === 0) return '12:00 AM';
  if (hour < 12) return `${hour}:00 AM`;
  if (hour === 12) return '12:00 PM';
  return `${hour - 12}:00 PM`;
}

/**
 * Format date to MM/DD/YYYY (e.g. 09/22/2025)
 */
export function formatDayMMDDYYYY(date: Date): string {
  const m = String(date.getUTCMonth() + 1).padStart(2, '0');
  const d = String(date.getUTCDate()).padStart(2, '0');
  const y = date.getUTCFullYear();
  return `${m}/${d}/${y}`;
}

/**
 * Generate standard downloadable CSV template matching the exact schema:
 * Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement
 * Pre-populated with the exact sample data from the schema specification.
 */
export function generateStandardCsvTemplate(): string {
  const lines: string[] = ['Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement'];
  
  // Specific hourly values for Day 1 (09/22/2025) starting with the exact sample values
  const day1Values = [
    1.018, 0.907, 0.958, 0.931, 0.886, 0.942, 1.450, 1.820, 1.340, 1.050,
    0.980, 0.920, 0.890, 0.870, 0.960, 1.150, 1.380, 1.740, 1.890, 1.620,
    1.310, 1.120, 0.883, 0.820
  ];
  const day1Total = day1Values.reduce((a, b) => a + b, 0); // 25.075

  for (let h = 0; h < 24; h++) {
    lines.push(`09/22/2025,${formatHour12(h)},${day1Values[h].toFixed(3)},${day1Total.toFixed(3)},kWh`);
  }

  // Day 2 (09/23/2025)
  const day2Values = day1Values.map((v, i) => Math.round((v * (i >= 16 && i <= 20 ? 1.08 : 0.97)) * 1000) / 1000);
  const day2Total = day2Values.reduce((a, b) => a + b, 0);

  for (let h = 0; h < 24; h++) {
    lines.push(`09/23/2025,${formatHour12(h)},${day2Values[h].toFixed(3)},${day2Total.toFixed(3)},kWh`);
  }

  return lines.join('\n');
}

/**
 * Generate a complete, realistic 8,760-hour residential dataset for a full year (2025).
 * Matches the 5-column schema:
 * Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement
 */
export function generateRealistic8760Dataset(): { rawCsv: string; dataPoints: IntervalDataPoint[] } {
  const dataPoints: IntervalDataPoint[] = [];
  const csvLines: string[] = ['Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement'];
  
  // 365 days in 2025 starting on Wednesday (Jan 1, 2025)
  const startDate = new Date(Date.UTC(2025, 0, 1, 0, 0, 0));
  
  // Deterministic PRNG seed for reproducible yet realistic synthetic data
  let seed = 42;
  function pseudoRandom() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  }

  // Process day by day to calculate accurate Daily Totals
  for (let dayIndex = 0; dayIndex < 365; dayIndex++) {
    const dayDate = new Date(startDate.getTime() + dayIndex * 24 * 3600 * 1000);
    const dayStr = formatDayMMDDYYYY(dayDate);
    const month = dayDate.getUTCMonth(); // 0 - 11
    const dayOfWeek = dayDate.getUTCDay(); // 0 = Sun, 6 = Sat
    const isWeekend = dayOfWeek === 0 || dayOfWeek === 6;

    // Calculate all 24 hours for this day
    const dayHourlyValues: number[] = [];

    for (let hour = 0; hour < 24; hour++) {
      // 1. Base load (standby, refrigerator, WiFi): 0.35 - 0.55 kWh
      let load = 0.42 + pseudoRandom() * 0.15;

      // 2. Diurnal daily profile pattern
      if (hour >= 6 && hour < 9) {
        // Morning wake up & breakfast
        load += isWeekend ? 0.85 : 1.45 + pseudoRandom() * 0.45;
      } else if (hour >= 9 && hour < 16) {
        // Midday
        load += isWeekend ? 1.35 + pseudoRandom() * 0.5 : 0.65 + pseudoRandom() * 0.25;
      } else if (hour >= 16 && hour < 21) {
        // Evening peak (cooking, lighting, AC/heating)
        load += 1.95 + pseudoRandom() * 0.75;
      } else if (hour >= 21 && hour < 23) {
        // Late evening
        load += 0.95 + pseudoRandom() * 0.35;
      } else {
        // Deep night
        load += pseudoRandom() * 0.1;
      }

      // 3. Seasonal HVAC weather component
      if (month >= 5 && month <= 8) {
        // Summer A/C cooling peak
        const summerFactor = month === 6 || month === 7 ? 1.35 : 1.15;
        if (hour >= 13 && hour <= 20) {
          load += (1.3 + pseudoRandom() * 1.4) * summerFactor;
        } else if (hour >= 11 && hour <= 23) {
          load += (0.5 + pseudoRandom() * 0.6) * summerFactor;
        }
      } else if (month === 11 || month === 0 || month === 1) {
        // Winter heating
        if (hour >= 6 && hour <= 9) {
          load += 0.8 + pseudoRandom() * 0.5;
        } else if (hour >= 17 && hour <= 22) {
          load += 1.1 + pseudoRandom() * 0.6;
        }
      }

      // 4. Occasional heavy appliance spike (EV, laundry, oven)
      if (pseudoRandom() > 0.93) {
        load += 1.0 + pseudoRandom() * 1.3;
      }

      const roundedHourly = Math.max(0.1, Math.round(load * 1000) / 1000);
      dayHourlyValues.push(roundedHourly);
    }

    const dailyTotal = Math.round(dayHourlyValues.reduce((a, b) => a + b, 0) * 1000) / 1000;

    for (let hour = 0; hour < 24; hour++) {
      const hourDate = new Date(dayDate.getTime() + hour * 3600 * 1000);
      const hourOfDayStr = formatHour12(hour);
      const hourlyTotal = dayHourlyValues[hour];
      const y = hourDate.getUTCFullYear();
      const m = String(hourDate.getUTCMonth() + 1).padStart(2, '0');
      const d = String(hourDate.getUTCDate()).padStart(2, '0');
      const hStr = String(hour).padStart(2, '0');
      const normalizedTs = `${y}-${m}-${d} ${hStr}:00`;

      csvLines.push(`${dayStr},${hourOfDayStr},${hourlyTotal.toFixed(3)},${dailyTotal.toFixed(3)},kWh`);

      dataPoints.push({
        timestamp: normalizedTs,
        date: hourDate,
        hour,
        dayOfWeek,
        month,
        usageKwh: hourlyTotal,
        dayStr,
        hourOfDayStr,
        hourlyTotal,
        dailyTotal,
        unitOfMeasurement: 'kWh',
      });
    }
  }

  return {
    rawCsv: csvLines.join('\n'),
    dataPoints,
  };
}
