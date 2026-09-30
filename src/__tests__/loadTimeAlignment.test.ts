import { describe, it, expect } from 'vitest';
import {
  alignLoadTimestampsToSite,
  resolveTimestampToUtc,
  isValidIanaTimeZone,
  parseTimestampString,
} from '../utils/loadTimeAlignment';
import { IntervalDataPoint } from '../types/energy';

function createMockPoint(
  timestamp: string,
  date: Date = new Date(1700000000000),
  usageKwh = 1.0
): IntervalDataPoint {
  return {
    timestamp,
    date,
    hour: 0,
    dayOfWeek: 1,
    month: 6,
    usageKwh,
  };
}

describe('G2D — Load/Solar Timestamp Alignment', () => {
  describe('1. UTC wall clock', () => {
    it('resolves 2026-07-15 14:00 with timezone UTC to 2026-07-15T14:00:00.000Z', () => {
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-07-15 14:00'),
      ];

      const result = alignLoadTimestampsToSite(dataPoints, 1, 'UTC');

      expect(result).toHaveLength(1);
      expect(result[0].sourceIndex).toBe(0);
      expect(result[0].sourceTimestamp).toBe('2026-07-15 14:00');
      expect(result[0].timestampUtc).toBe('2026-07-15T14:00:00.000Z');
      expect(result[0].instantUtc.toISOString()).toBe('2026-07-15T14:00:00.000Z');
    });

    it('resolves ISO-T formatted wall-clock timestamp with timezone UTC', () => {
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-07-15T14:00'),
      ];

      const result = alignLoadTimestampsToSite(dataPoints, 1, 'UTC');
      expect(result[0].timestampUtc).toBe('2026-07-15T14:00:00.000Z');
    });
  });

  describe('2. America/Detroit normal time', () => {
    it('resolves a normal summer timestamp (EDT, UTC-4) away from DST transition', () => {
      // 2026-07-15 14:00 in America/Detroit is EDT (UTC-4), which is 18:00 UTC
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-07-15 14:00'),
      ];

      const result = alignLoadTimestampsToSite(dataPoints, 1, 'America/Detroit');

      expect(result[0].timestampUtc).toBe('2026-07-15T18:00:00.000Z');
      expect(result[0].instantUtc.getUTCHours()).toBe(18);
    });

    it('resolves a normal winter timestamp (EST, UTC-5) away from DST transition', () => {
      // 2026-01-15 14:00 in America/Detroit is EST (UTC-5), which is 19:00 UTC
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-01-15 14:00'),
      ];

      const result = alignLoadTimestampsToSite(dataPoints, 1, 'America/Detroit');

      expect(result[0].timestampUtc).toBe('2026-01-15T19:00:00.000Z');
      expect(result[0].instantUtc.getUTCHours()).toBe(19);
    });
  });

  describe('3. Explicit UTC timestamp', () => {
    it('timestamp ending in Z remains the same instant regardless of site timezone', () => {
      const ts = '2026-07-15T18:00:00Z';
      const dataPoints: IntervalDataPoint[] = [createMockPoint(ts)];

      const resultDetroit = alignLoadTimestampsToSite(dataPoints, 1, 'America/Detroit');
      const resultLA = alignLoadTimestampsToSite(dataPoints, 1, 'America/Los_Angeles');
      const resultTokyo = alignLoadTimestampsToSite(dataPoints, 1, 'Asia/Tokyo');
      const resultUtc = alignLoadTimestampsToSite(dataPoints, 1, 'UTC');

      expect(resultDetroit[0].timestampUtc).toBe('2026-07-15T18:00:00.000Z');
      expect(resultLA[0].timestampUtc).toBe('2026-07-15T18:00:00.000Z');
      expect(resultTokyo[0].timestampUtc).toBe('2026-07-15T18:00:00.000Z');
      expect(resultUtc[0].timestampUtc).toBe('2026-07-15T18:00:00.000Z');

      // Instants are identical in epoch millisecond value
      expect(resultDetroit[0].instantUtc.getTime()).toBe(resultLA[0].instantUtc.getTime());
      expect(resultDetroit[0].instantUtc.getTime()).toBe(resultTokyo[0].instantUtc.getTime());
    });
  });

  describe('4. Explicit numeric offset', () => {
    it('resolves 2026-07-15T14:00:00-04:00 to 2026-07-15T18:00:00.000Z', () => {
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-07-15T14:00:00-04:00'),
      ];

      const result = alignLoadTimestampsToSite(dataPoints, 1, 'America/Los_Angeles');

      // The explicit offset of -04:00 must be honored, not reinterpreted through site timezone
      expect(result[0].timestampUtc).toBe('2026-07-15T18:00:00.000Z');
      expect(result[0].instantUtc.toISOString()).toBe('2026-07-15T18:00:00.000Z');
    });

    it('resolves positive and non-hour offsets accurately', () => {
      const dpPositive = [createMockPoint('2026-07-15T18:00:00+02:00')];
      const resultPos = alignLoadTimestampsToSite(dpPositive, 1, 'UTC');
      expect(resultPos[0].timestampUtc).toBe('2026-07-15T16:00:00.000Z');

      const dpIndia = [createMockPoint('2026-07-15T14:00:00+05:30')];
      const resultIndia = alignLoadTimestampsToSite(dpIndia, 1, 'UTC');
      expect(resultIndia[0].timestampUtc).toBe('2026-07-15T08:30:00.000Z');
    });
  });

  describe('5. Nonexistent DST timestamp', () => {
    it('rejects spring-forward nonexistent local time in America/Detroit', () => {
      // In America/Detroit, clocks jump from 01:59:59 EST to 03:00:00 EDT on 2026-03-08.
      // 02:00 does not exist.
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-03-08 02:00'),
      ];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 1, 'America/Detroit');
      }).toThrow(/nonexistent local time/i);
    });

    it('rejects nonexistent sub-hour timestamp during spring-forward', () => {
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-03-08 02:30'),
      ];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 1, 'America/Detroit');
      }).toThrow(/nonexistent local time/i);
    });
  });

  describe('6. Ambiguous DST timestamp', () => {
    it('rejects fall-back ambiguous local time without explicit offset in America/Detroit', () => {
      // In America/Detroit, clocks fall back from 01:59:59 EDT to 01:00:00 EST on 2026-11-01.
      // 01:00 occurs twice.
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-11-01 01:00'),
      ];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 1, 'America/Detroit');
      }).toThrow(/ambiguous local time/i);
    });

    it('accepts fall-back timestamp when explicit offset is provided', () => {
      // Explicit offsets make both occurrences unambiguous
      const dpFirst = [createMockPoint('2026-11-01T01:00:00-04:00')];
      const dpSecond = [createMockPoint('2026-11-01T01:00:00-05:00')];

      const resFirst = alignLoadTimestampsToSite(dpFirst, 1, 'America/Detroit');
      const resSecond = alignLoadTimestampsToSite(dpSecond, 1, 'America/Detroit');

      expect(resFirst[0].timestampUtc).toBe('2026-11-01T05:00:00.000Z');
      expect(resSecond[0].timestampUtc).toBe('2026-11-01T06:00:00.000Z');
    });
  });

  describe('7. Regular sequence', () => {
    it('resolves a valid sequence to regularly spaced UTC instants', () => {
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-06-01 00:00'),
        createMockPoint('2026-06-01 01:00'),
        createMockPoint('2026-06-01 02:00'),
        createMockPoint('2026-06-01 03:00'),
      ];

      const result = alignLoadTimestampsToSite(dataPoints, 1, 'America/Detroit');

      expect(result).toHaveLength(4);
      expect(result.map((r) => r.sourceIndex)).toEqual([0, 1, 2, 3]);

      // Spacing between consecutive points must strictly equal 1 hour (3600000 ms)
      for (let i = 1; i < result.length; i++) {
        const diffMs =
          result[i].instantUtc.getTime() - result[i - 1].instantUtc.getTime();
        expect(diffMs).toBe(3600000);
      }
    });

    it('supports fractional intervalHours (e.g., 15-minute / 0.25h interval)', () => {
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-06-01 10:00'),
        createMockPoint('2026-06-01 10:15'),
        createMockPoint('2026-06-01 10:30'),
        createMockPoint('2026-06-01 10:45'),
      ];

      const result = alignLoadTimestampsToSite(dataPoints, 0.25, 'UTC');

      expect(result).toHaveLength(4);
      for (let i = 1; i < result.length; i++) {
        const diffMs =
          result[i].instantUtc.getTime() - result[i - 1].instantUtc.getTime();
        expect(diffMs).toBe(15 * 60 * 1000);
      }
    });
  });

  describe('8. Irregular sequence', () => {
    it('rejects sequence with a gap between intervals', () => {
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-06-01 00:00'),
        createMockPoint('2026-06-01 01:00'),
        createMockPoint('2026-06-01 03:00'), // Gap: 02:00 skipped
      ];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 1, 'UTC');
      }).toThrow(/irregular spacing or gap/i);
    });

    it('rejects sequence with duplicate timestamps', () => {
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-06-01 00:00'),
        createMockPoint('2026-06-01 01:00'),
        createMockPoint('2026-06-01 01:00'), // Duplicate
      ];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 1, 'UTC');
      }).toThrow(/duplicate instant/i);
    });

    it('rejects sequence with out-of-order timestamps', () => {
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-06-01 02:00'),
        createMockPoint('2026-06-01 01:00'), // Out-of-order
      ];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 1, 'UTC');
      }).toThrow(/out-of-order/i);
    });

    it('rejects sequence when intervalHours parameter does not match actual spacing', () => {
      // Actual spacing is 1 hour, but caller passed 0.5 hours
      const dataPoints: IntervalDataPoint[] = [
        createMockPoint('2026-06-01 00:00'),
        createMockPoint('2026-06-01 01:00'),
      ];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 0.5, 'UTC');
      }).toThrow(/spacing inconsistent with intervalHours/i);
    });
  });

  describe('9. Invalid timezone', () => {
    it('rejects empty timezone for local wall-clock timestamps', () => {
      const dataPoints = [createMockPoint('2026-07-15 14:00')];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 1, '');
      }).toThrow(/invalid iana timezone/i);
    });

    it('rejects whitespace-only timezone for local wall-clock timestamps', () => {
      const dataPoints = [createMockPoint('2026-07-15 14:00')];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 1, '   ');
      }).toThrow(/invalid iana timezone/i);
    });

    it('rejects invalid IANA timezone string for local wall-clock timestamps', () => {
      const dataPoints = [createMockPoint('2026-07-15 14:00')];

      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 1, 'Not/A_TimeZone');
      }).toThrow(/invalid iana timezone/i);
    });

    it('validates IANA timezone helper function correctly', () => {
      expect(isValidIanaTimeZone('UTC')).toBe(true);
      expect(isValidIanaTimeZone('America/Detroit')).toBe(true);
      expect(isValidIanaTimeZone('America/Los_Angeles')).toBe(true);
      expect(isValidIanaTimeZone('')).toBe(false);
      expect(isValidIanaTimeZone('Not/A_TimeZone')).toBe(false);
    });
  });

  describe('10. Input immutability', () => {
    it('proves dataPoints, timestamp strings, and existing Date objects remain unchanged', () => {
      const initialDate1 = new Date(1700000000000);
      const initialDate2 = new Date(1700003600000);
      const initialDate1Millis = initialDate1.getTime();
      const initialDate2Millis = initialDate2.getTime();

      const dp1: IntervalDataPoint = {
        timestamp: '2026-06-01 00:00',
        date: initialDate1,
        hour: 0,
        dayOfWeek: 1,
        month: 5,
        usageKwh: 2.5,
      };

      const dp2: IntervalDataPoint = {
        timestamp: '2026-06-01 01:00',
        date: initialDate2,
        hour: 1,
        dayOfWeek: 1,
        month: 5,
        usageKwh: 3.1,
      };

      const dataPoints: IntervalDataPoint[] = [dp1, dp2];

      // Deep freeze the inputs to strictly guarantee no mutations occur
      Object.freeze(dp1);
      Object.freeze(dp2);
      Object.freeze(dataPoints);

      const result = alignLoadTimestampsToSite(dataPoints, 1, 'UTC');

      // Verify outputs are generated correctly
      expect(result).toHaveLength(2);

      // Verify inputs remain completely untouched
      expect(dp1.timestamp).toBe('2026-06-01 00:00');
      expect(dp2.timestamp).toBe('2026-06-01 01:00');
      expect(dp1.date.getTime()).toBe(initialDate1Millis);
      expect(dp2.date.getTime()).toBe(initialDate2Millis);
      expect(dp1.date).toBe(initialDate1); // Reference equality preserved
      expect(dp2.date).toBe(initialDate2);
      expect(dataPoints[0]).toBe(dp1);
      expect(dataPoints[1]).toBe(dp2);
      expect(dataPoints).toHaveLength(2);
    });
  });

  describe('Input validation edge cases', () => {
    it('rejects empty dataPoints array', () => {
      expect(() => {
        alignLoadTimestampsToSite([], 1, 'UTC');
      }).toThrow(/dataPoints must be a non-empty array/i);
    });

    it('rejects non-positive intervalHours', () => {
      const dataPoints = [createMockPoint('2026-06-01 00:00')];
      expect(() => {
        alignLoadTimestampsToSite(dataPoints, 0, 'UTC');
      }).toThrow(/intervalHours must be a positive number/i);
      expect(() => {
        alignLoadTimestampsToSite(dataPoints, -1, 'UTC');
      }).toThrow(/intervalHours must be a positive number/i);
    });

    it('rejects invalid calendar dates like Feb 30', () => {
      expect(() => {
        parseTimestampString('2026-02-30 12:00');
      }).toThrow(/invalid day of month/i);
    });

    it('rejects malformed timestamp format', () => {
      expect(() => {
        parseTimestampString('not-a-timestamp');
      }).toThrow(/invalid timestamp format/i);
    });
  });
});
