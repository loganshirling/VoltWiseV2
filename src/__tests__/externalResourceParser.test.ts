import { describe, it, expect } from 'vitest';
import {
  parseExternalResourceCsv,
  parseSolarIrradianceCsv,
  parseWindSpeedCsv,
} from '../utils/externalResourceParser';

describe('G7A — External Resource CSV Parser', () => {
  describe('1. Valid Ingestion & Schema Support', () => {
    it('parses a valid solar CSV with hourly intervals', () => {
      const csv = [
        'timestamp,ghi_wm2,dni_wm2,dhi_wm2',
        '2026-06-01T12:00:00Z,850.5,720.0,130.5',
        '2026-06-01T13:00:00Z,900.0,780.2,119.8',
        '2026-06-01T14:00:00Z,820.0,700.0,120.0',
      ].join('\n');

      const result = parseSolarIrradianceCsv(csv);

      expect(result.isValid).toBe(true);
      expect(result.errors).toHaveLength(0);
      expect(result.kind).toBe('solar_irradiance');
      expect(result.rowCount).toBe(3);
      expect(result.validRowCount).toBe(3);
      expect(result.intervalHours).toBe(1.0);
      expect(result.startTimestampUtc).toBe('2026-06-01T12:00:00.000Z');
      expect(result.endTimestampUtc).toBe('2026-06-01T14:00:00.000Z');

      const dataset = result.dataset!;
      expect(dataset).toBeDefined();
      expect(dataset.kind).toBe('solar_irradiance');
      expect(dataset.records).toHaveLength(3);
      expect(dataset.records[0]).toEqual({
        timestampUtc: '2026-06-01T12:00:00.000Z',
        ghiWm2: 850.5,
        dniWm2: 720.0,
        dhiWm2: 130.5,
      });
    });

    it('parses a valid wind speed CSV', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,6.5',
        '2026-06-01T13:00:00Z,8.2',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);

      expect(result.isValid).toBe(true);
      expect(result.kind).toBe('wind_speed');
      expect(result.rowCount).toBe(2);
      expect(result.intervalHours).toBe(1.0);
      expect(result.dataset?.records[0]).toEqual({
        timestampUtc: '2026-06-01T12:00:00.000Z',
        windSpeedMps: 6.5,
      });
      expect(result.dataset?.records[1]).toEqual({
        timestampUtc: '2026-06-01T13:00:00.000Z',
        windSpeedMps: 8.2,
      });
    });

    it('supports CRLF (Windows) and LF (Unix) line endings', () => {
      const csvCrlf = 'timestamp,wind_speed_mps\r\n2026-06-01T12:00:00Z,5.0\r\n2026-06-01T13:00:00Z,6.0\r\n';
      const resultCrlf = parseWindSpeedCsv(csvCrlf);
      expect(resultCrlf.isValid).toBe(true);
      expect(resultCrlf.rowCount).toBe(2);

      const csvLf = 'timestamp,wind_speed_mps\n2026-06-01T12:00:00Z,5.0\n2026-06-01T13:00:00Z,6.0\n';
      const resultLf = parseWindSpeedCsv(csvLf);
      expect(resultLf.isValid).toBe(true);
      expect(resultLf.rowCount).toBe(2);
    });

    it('normalizes header casing and handles quoted fields', () => {
      const csv = [
        '"TIMESTAMP","GHI_WM2","DNI_WM2","DHI_WM2"',
        '"2026-06-01T12:00:00Z","100.0","50.0","50.0"',
        '"2026-06-01T13:00:00Z","200.0","120.0","80.0"',
      ].join('\n');

      const result = parseSolarIrradianceCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.dataset?.records[0].ghiWm2).toBe(100.0);
    });

    it('allows and ignores extra columns in the CSV', () => {
      const csv = [
        'timestamp,ambient_temp_c,ghi_wm2,dni_wm2,dhi_wm2,relative_humidity',
        '2026-06-01T12:00:00Z,25.4,800.0,650.0,150.0,45.2',
        '2026-06-01T13:00:00Z,26.1,850.0,700.0,150.0,42.0',
      ].join('\n');

      const result = parseSolarIrradianceCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.dataset?.records[0]).toEqual({
        timestampUtc: '2026-06-01T12:00:00.000Z',
        ghiWm2: 800.0,
        dniWm2: 650.0,
        dhiWm2: 150.0,
      });
    });
  });

  describe('2. Header and Structure Rejections', () => {
    it('rejects empty input', () => {
      const result = parseWindSpeedCsv('');
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors[0]).toMatch(/CSV input is empty/i);
    });

    it('rejects fewer than two data rows (header only)', () => {
      const csv = 'timestamp,wind_speed_mps\n';
      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors[0]).toMatch(/at least two data rows/i);
    });

    it('rejects fewer than two data rows (header + 1 row)', () => {
      const csv = 'timestamp,wind_speed_mps\n2026-06-01T12:00:00Z,5.0\n';
      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors[0]).toMatch(/at least two data rows/i);
    });

    it('rejects missing required columns', () => {
      const csv = [
        'timestamp,ghi_wm2,dni_wm2', // missing dhi_wm2
        '2026-06-01T12:00:00Z,800.0,650.0',
        '2026-06-01T13:00:00Z,850.0,700.0',
      ].join('\n');

      const result = parseSolarIrradianceCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors[0]).toMatch(/Missing required column\(s\): "dhi_wm2"/i);
    });

    it('rejects duplicate required columns', () => {
      const csv = [
        'timestamp,wind_speed_mps,Wind_Speed_Mps',
        '2026-06-01T12:00:00Z,5.0,5.0',
        '2026-06-01T13:00:00Z,6.0,6.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors[0]).toMatch(/Duplicate required column in CSV header: "wind_speed_mps"/i);
    });
  });

  describe('3. Field Value Validation', () => {
    it('rejects blank required values', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,',
        '2026-06-01T13:00:00Z,6.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors.some((e) => e.includes('missing or blank value'))).toBe(true);
    });

    it('rejects negative measurements', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,-1.5',
        '2026-06-01T13:00:00Z,6.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors.some((e) => e.includes('must be non-negative'))).toBe(true);
    });

    it('rejects non-finite measurements (strings, NaN, Infinity)', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,corrupted',
        '2026-06-01T13:00:00Z,Infinity',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors.some((e) => e.includes('must be a finite number'))).toBe(true);
    });
  });

  describe('4. Timestamp Normalization & TimeZone Rules', () => {
    it('accepts absolute UTC timestamps with Z', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-07-15T14:00:00Z,7.0',
        '2026-07-15T15:00:00Z,8.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.dataset?.records[0].timestampUtc).toBe('2026-07-15T14:00:00.000Z');
    });

    it('accepts explicit numeric UTC offsets', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-07-15T10:00:00-04:00,7.0',
        '2026-07-15T11:00:00-04:00,8.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(true);
      // 10:00 -04:00 is 14:00 UTC
      expect(result.dataset?.records[0].timestampUtc).toBe('2026-07-15T14:00:00.000Z');
      expect(result.dataset?.records[1].timestampUtc).toBe('2026-07-15T15:00:00.000Z');
    });

    it('resolves valid local timestamps with a provided sourceTimeZone', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-07-15 10:00,7.0',
        '2026-07-15 11:00,8.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv, { sourceTimeZone: 'America/New_York' });
      expect(result.isValid).toBe(true);
      // EDT is UTC-4 in July -> 14:00 UTC
      expect(result.dataset?.records[0].timestampUtc).toBe('2026-07-15T14:00:00.000Z');
    });

    it('rejects invalid IANA timezone', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-07-15 10:00,7.0',
        '2026-07-15 11:00,8.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv, { sourceTimeZone: 'Mars/Curiosity_Base' });
      expect(result.isValid).toBe(false);
      expect(result.errors[0]).toMatch(/Invalid source timezone/i);
    });

    it('rejects DST nonexistent local time (spring forward gap)', () => {
      // In America/New_York, 2026-03-08 02:30 does not exist
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-03-08 01:30,5.0',
        '2026-03-08 02:30,6.0',
        '2026-03-08 03:30,7.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv, { sourceTimeZone: 'America/New_York' });
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors.some((e) => e.includes('nonexistent local time'))).toBe(true);
    });

    it('rejects DST ambiguous local time without explicit offset (fall back)', () => {
      // In America/New_York, 2026-11-01 01:30 repeats
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-11-01 00:30,5.0',
        '2026-11-01 01:30,6.0',
        '2026-11-01 02:30,7.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv, { sourceTimeZone: 'America/New_York' });
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors.some((e) => e.includes('ambiguous local time'))).toBe(true);
    });

    it('accepts explicit offset to resolve DST ambiguity', () => {
      // Disambiguated via explicit offset
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-11-01T01:30:00-04:00,5.0',
        '2026-11-01T01:30:00-05:00,6.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv, { sourceTimeZone: 'America/New_York' });
      expect(result.isValid).toBe(true);
      expect(result.dataset?.records[0].timestampUtc).toBe('2026-11-01T05:30:00.000Z');
      expect(result.dataset?.records[1].timestampUtc).toBe('2026-11-01T06:30:00.000Z');
    });
  });

  describe('5. Sequence and Interval Validation', () => {
    it('infers hourly interval duration (1.0h)', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,5.0',
        '2026-06-01T13:00:00Z,6.0',
        '2026-06-01T14:00:00Z,7.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.intervalHours).toBe(1.0);
      expect(result.dataset?.intervalHours).toBe(1.0);
    });

    it('infers sub-hourly interval duration (0.25h / 15-minute)', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,5.0',
        '2026-06-01T12:15:00Z,5.5',
        '2026-06-01T12:30:00Z,6.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(true);
      expect(result.intervalHours).toBe(0.25);
      expect(result.dataset?.intervalHours).toBe(0.25);
    });

    it('rejects duplicate UTC instants', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,5.0',
        '2026-06-01T12:00:00Z,6.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors.some((e) => e.includes('Duplicate UTC instant'))).toBe(true);
    });

    it('rejects out-of-order instants', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T13:00:00Z,5.0',
        '2026-06-01T12:00:00Z,6.0',
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors.some((e) => e.includes('Out-of-order instant'))).toBe(true);
    });

    it('rejects irregular interval spacing', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,5.0',
        '2026-06-01T13:00:00Z,6.0', // 1h step
        '2026-06-01T15:00:00Z,7.0', // 2h step (irregular)
      ].join('\n');

      const result = parseWindSpeedCsv(csv);
      expect(result.isValid).toBe(false);
      expect(result.dataset).toBeUndefined();
      expect(result.errors.some((e) => e.includes('Irregular interval spacing'))).toBe(true);
    });
  });

  describe('6. Deterministic Metadata', () => {
    it('uses a deterministic fallback resource ID for identical input', () => {
      const csv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,5.0',
        '2026-06-01T13:00:00Z,6.0',
      ].join('\n');

      const first = parseWindSpeedCsv(csv);
      const second = parseWindSpeedCsv(csv);

      expect(first.isValid).toBe(true);
      expect(second.isValid).toBe(true);
      expect(first.dataset?.id).toBe(second.dataset?.id);
    });

    it('keeps sourceTimeZone null for absolute timestamps and preserves an explicit local timezone', () => {
      const absoluteCsv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,5.0',
        '2026-06-01T13:00:00Z,6.0',
      ].join('\n');
      const localCsv = [
        'timestamp,wind_speed_mps',
        '2026-06-01 08:00,5.0',
        '2026-06-01 09:00,6.0',
      ].join('\n');

      const absolute = parseWindSpeedCsv(absoluteCsv);
      const local = parseWindSpeedCsv(absoluteCsv, { sourceTimeZone: 'America/New_York' });
      const localWallClock = parseWindSpeedCsv(localCsv, { sourceTimeZone: 'America/New_York' });

      expect(absolute.dataset?.sourceTimeZone).toBeNull();
      expect(absolute.sourceTimeZone).toBeNull();
      expect(local.dataset?.sourceTimeZone).toBe('America/New_York');
      expect(localWallClock.dataset?.sourceTimeZone).toBe('America/New_York');
    });
  });

  describe('7. Immutability & Safety', () => {
    it('does not mutate caller options object or input string', () => {
      const originalCsv = [
        'timestamp,wind_speed_mps',
        '2026-06-01T12:00:00Z,5.0',
        '2026-06-01T13:00:00Z,6.0',
      ].join('\n');
      const csvCopy = originalCsv.slice();
      const options = Object.freeze({ sourceTimeZone: 'UTC', id: 'res_fixed' });

      const result = parseExternalResourceCsv(originalCsv, 'wind_speed', options);
      expect(result.isValid).toBe(true);
      expect(originalCsv).toBe(csvCopy);
      expect(options.id).toBe('res_fixed');
    });
  });
});
