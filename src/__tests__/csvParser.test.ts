import { describe, expect, it } from 'vitest';
import { parseAndValidateEnergyCsv } from '../utils/csvParser';

const header = 'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement';

function csvRows(rows: string[]): string {
  return [header, ...rows].join('\n');
}

describe('load CSV validation states and units', () => {
  it('keeps a continuous partial period simulatable without marking it annual eligible', () => {
    const result = parseAndValidateEnergyCsv(csvRows([
      '01/01/2025,12:00 AM,1,24,kWh',
      '01/01/2025,1:00 AM,1,24,kWh',
      '01/01/2025,2:00 AM,1,24,kWh',
    ]));

    expect(result.schemaValid).toBe(true);
    expect(result.chronologicallyValid).toBe(true);
    expect(result.operationallySimulatable).toBe(true);
    expect(result.annualProjectionEligible).toBe(false);
  });

  it('does not claim simulation readiness when one record cannot establish interval spacing', () => {
    const result = parseAndValidateEnergyCsv(csvRows([
      '01/01/2025,12:00 AM,1,24,kWh',
    ]));

    expect(result.schemaValid).toBe(true);
    expect(result.chronologicallyValid).toBe(true);
    expect(result.operationallySimulatable).toBe(false);
    expect(result.annualProjectionEligible).toBe(false);
  });

  it('rejects a one-minute cadence deviation instead of tolerating an irregular interval', () => {
    const result = parseAndValidateEnergyCsv(csvRows([
      '01/01/2025,12:00 AM,0.25,24,kWh',
      '01/01/2025,12:15 AM,0.25,24,kWh',
      '01/01/2025,12:31 AM,0.25,24,kWh',
      '01/01/2025,12:46 AM,0.25,24,kWh',
    ]));

    expect(result.schemaValid).toBe(true);
    expect(result.chronologicallyValid).toBe(true);
    expect(result.operationallySimulatable).toBe(false);
  });

  it('does not treat power in kW as interval energy in kWh', () => {
    const result = parseAndValidateEnergyCsv(csvRows([
      '01/01/2025,12:00 AM,1,96,kW',
      '01/01/2025,12:15 AM,1,96,kW',
    ]));

    expect(result.isValid).toBe(false);
    expect(result.schemaValid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/unit of measurement.*kW.*kWh/i);
  });

  it.each([
    ['12kWh', 'Hourly Total'],
    ['NaN', 'Hourly Total'],
    ['Infinity', 'Hourly Total'],
    ['1.0junk', 'Hourly Total'],
    ['24kWh', 'Daily Total'],
  ])('rejects malformed %s in the %s field', (value, field) => {
    const hourly = field === 'Hourly Total' ? value : '1';
    const daily = field === 'Daily Total' ? value : '24';
    const result = parseAndValidateEnergyCsv(csvRows([
      `01/01/2025,12:00 AM,${hourly},${daily},kWh`,
    ]));

    expect(result.schemaValid).toBe(false);
    expect(result.isValid).toBe(false);
    expect(result.errors.join('\n')).toMatch(/non-numeric/i);
  });

  it('rejects invalid calendar dates instead of normalizing them', () => {
    const result = parseAndValidateEnergyCsv(csvRows([
      '02/30/2025,12:00 AM,1,24,kWh',
    ]));

    expect(result.schemaValid).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it('rejects unsupported date strings instead of accepting JavaScript-normalized dates', () => {
    const result = parseAndValidateEnergyCsv(csvRows([
      'February 30 2025,12:00 AM,1,24,kWh',
    ]));
    expect(result.schemaValid).toBe(false);
  });

  it('rejects an invalid calendar date in the legacy timestamp schema', () => {
    const result = parseAndValidateEnergyCsv([
      'Timestamp,Usage kWh',
      '2025-02-30 00:00,1',
      '2025-02-30 01:00,1',
    ].join('\n'));

    expect(result.schemaValid).toBe(false);
    expect(result.isValid).toBe(false);
  });

  it('keeps legacy offset-bearing annual eligibility independent of the host timezone', () => {
    const rows = ['Timestamp,Usage kWh'];
    for (let hour = 0; hour < 365 * 24; hour += 1) {
      rows.push(`${new Date(Date.UTC(2025, 0, 1, hour)).toISOString()},1`);
    }
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const newYork = parseAndValidateEnergyCsv(rows.join('\n'));
      process.env.TZ = 'Asia/Tokyo';
      const tokyo = parseAndValidateEnergyCsv(rows.join('\n'));
      expect(newYork.annualProjectionEligible).toBe(true);
      expect(tokyo.annualProjectionEligible).toBe(true);
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });

  it('keeps cumulative energy finite when legacy values exceed the numeric sum range', () => {
    const result = parseAndValidateEnergyCsv([
      'Timestamp,Usage kWh',
      '2025-01-01T00:00:00Z,1e308',
      '2025-01-01T01:00:00Z,1e308',
    ].join('\n'));
    expect(result.schemaValid).toBe(false);
    expect(Number.isFinite(result.totalKwh)).toBe(true);
  });

  it('rejects peak power that overflows after interval conversion', () => {
    const result = parseAndValidateEnergyCsv([
      'Timestamp,Usage kWh',
      '2025-01-01T00:00:00Z,1e308',
      '2025-01-01T00:30:00Z,0',
    ].join('\n'));
    expect(result.schemaValid).toBe(false);
    expect(result.operationallySimulatable).toBe(false);
    expect(Number.isFinite(result.peakKw)).toBe(true);
  });

  it('marks a chronological defect separately from schema validity', () => {
    const result = parseAndValidateEnergyCsv(csvRows([
      '01/01/2025,12:00 AM,1,24,kWh',
      '01/01/2025,1:00 AM,1,24,kWh',
      '01/01/2025,1:00 AM,1,24,kWh',
    ]));

    expect(result.schemaValid).toBe(true);
    expect(result.chronologicallyValid).toBe(false);
    expect(result.operationallySimulatable).toBe(false);
    expect(result.annualProjectionEligible).toBe(false);
  });

  it('rejects legacy timestamps that use different text but resolve to the same instant', () => {
    const result = parseAndValidateEnergyCsv([
      'Timestamp,Usage kWh',
      '2025-01-01T00:00:00Z,1',
      '2024-12-31T19:00:00-05:00,1',
    ].join('\n'));

    expect(result.schemaValid).toBe(true);
    expect(result.chronologicallyValid).toBe(false);
    expect(result.operationallySimulatable).toBe(false);
  });

  it('rejects an otherwise continuous dataset shorter than a full calendar year for annual projections', () => {
    const rows: string[] = [];
    for (let hour = 0; hour < 360 * 24; hour += 1) {
      const date = new Date(Date.UTC(2025, 0, 1, hour));
      const day = `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
      const time = `${date.getUTCHours() % 12 || 12}:00 ${date.getUTCHours() < 12 ? 'AM' : 'PM'}`;
      rows.push(`${day},${time},1,24,kWh`);
    }
    const result = parseAndValidateEnergyCsv(csvRows(rows));

    expect(result.schemaValid).toBe(true);
    expect(result.operationallySimulatable).toBe(true);
    expect(result.annualProjectionEligible).toBe(false);
  });

  it('keeps exact calendar-year eligibility independent of the host timezone', () => {
    const rows: string[] = [];
    for (let hour = 0; hour < 365 * 24; hour += 1) {
      const date = new Date(Date.UTC(2025, 0, 1, hour));
      const day = `${String(date.getUTCMonth() + 1).padStart(2, '0')}/${String(date.getUTCDate()).padStart(2, '0')}/${date.getUTCFullYear()}`;
      const time = `${date.getUTCHours() % 12 || 12}:00 ${date.getUTCHours() < 12 ? 'AM' : 'PM'}`;
      rows.push(`${day},${time},1,24,kWh`);
    }
    const originalTz = process.env.TZ;
    try {
      process.env.TZ = 'America/New_York';
      const newYork = parseAndValidateEnergyCsv(csvRows(rows));
      process.env.TZ = 'Asia/Tokyo';
      const tokyo = parseAndValidateEnergyCsv(csvRows(rows));
      expect(newYork.annualProjectionEligible).toBe(true);
      expect(tokyo.annualProjectionEligible).toBe(true);
    } finally {
      if (originalTz === undefined) delete process.env.TZ;
      else process.env.TZ = originalTz;
    }
  });
});
