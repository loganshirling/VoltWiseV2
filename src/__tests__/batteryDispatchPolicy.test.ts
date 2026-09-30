import { describe, it, expect } from 'vitest';
import {
  generateBatteryDischargePolicy,
  generateBatteryDispatchPolicy,
} from '../utils/batteryDispatchPolicy';
import { routeSequentialSolarBatteryFlow } from '../utils/sequentialBatteryFlow';
import {
  BatteryProfile,
  BatterySocProvenanceState,
  SolarLoadFlowInterval,
} from '../types/energy';
import { AlignedLoadTimestamp } from '../utils/loadTimeAlignment';

function createUniformScheduleMatrix(defaultTier = 'off-peak'): string[][] {
  return Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, () => defaultTier)
  );
}

function createAlignedTimestamp(
  index: number,
  isoUtc: string
): AlignedLoadTimestamp {
  const instantUtc = new Date(isoUtc);
  return {
    sourceIndex: index,
    sourceTimestamp: isoUtc.replace('T', ' ').substring(0, 16),
    instantUtc,
    timestampUtc: instantUtc.toISOString(),
  };
}

function createMockBatteryProfile(
  overrides: Partial<BatteryProfile> = {}
): BatteryProfile {
  return {
    id: 'test-battery',
    name: 'Test Battery',
    model: 'Test Model',
    totalCapacityKwh: 10,
    usableDodPercent: 100,
    maxContinuousOutputKw: 5,
    maxContinuousChargeKw: 5,
    roundTripEfficiencyPercent: 100,
    ratedCycleLife: 4000,
    installedCost: 10000,
    strategy: 'arbitrage',
    chargeTiers: ['off-peak'],
    dischargeTiers: ['on-peak'],
    ...overrides,
  };
}

describe('G3E — TOU Battery Discharge Policy', () => {
  describe('A. Explicit discharge tier', () => {
    it('sets allowBatteryDischargeToLoad to true when interval resolves to on-peak in dischargeTiers', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      // Sunday (0), hour 17 is on-peak
      schedule[0][17] = 'on-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T17:00:00.000Z'), // Sunday 17:00 UTC
      ];
      const profile = createMockBatteryProfile({
        dischargeTiers: ['on-peak'],
      });

      const policy = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy).toHaveLength(1);
      expect(policy[0].tierId).toBe('on-peak');
      expect(policy[0].allowBatteryDischargeToLoad).toBe(true);
      expect(policy[0].dayOfWeek).toBe(0);
      expect(policy[0].hour).toBe(17);
    });
  });

  describe('B. Non-discharge tier', () => {
    it('sets allowBatteryDischargeToLoad to false when interval resolves to off-peak', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T10:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        dischargeTiers: ['on-peak'],
      });

      const policy = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].tierId).toBe('off-peak');
      expect(policy[0].allowBatteryDischargeToLoad).toBe(false);
    });
  });

  describe('C. Empty discharge tiers', () => {
    it('sets allowBatteryDischargeToLoad to false for every interval when dischargeTiers is empty', () => {
      const schedule = createUniformScheduleMatrix('on-peak');
      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T13:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        dischargeTiers: [],
      });

      const policy = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].allowBatteryDischargeToLoad).toBe(false);
      expect(policy[1].allowBatteryDischargeToLoad).toBe(false);
    });
  });

  describe('D. Multiple discharge tiers', () => {
    it('allows discharge when interval matches any configured discharge tier', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      schedule[0][12] = 'critical-peak';
      schedule[0][13] = 'shoulder';
      schedule[0][14] = 'off-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T13:00:00.000Z'),
        createAlignedTimestamp(2, '2025-06-01T14:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        dischargeTiers: ['critical-peak', 'shoulder'],
      });

      const policy = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].allowBatteryDischargeToLoad).toBe(true);
      expect(policy[1].allowBatteryDischargeToLoad).toBe(true);
      expect(policy[2].allowBatteryDischargeToLoad).toBe(false);
    });
  });

  describe('E. Arbitrage behavior', () => {
    it('follows configured discharge tiers when strategy is arbitrage', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      schedule[1][18] = 'on-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-02T18:00:00.000Z'), // Monday 18:00 UTC
      ];
      const profile = createMockBatteryProfile({
        strategy: 'arbitrage',
        dischargeTiers: ['on-peak'],
      });

      const policy = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].allowBatteryDischargeToLoad).toBe(true);
    });
  });

  describe('F. Self-consumption parity', () => {
    it('currently follows the same explicit dischargeTiers constraint for self_consumption', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      schedule[1][18] = 'on-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-02T12:00:00.000Z'), // Monday 12:00 (off-peak)
        createAlignedTimestamp(1, '2025-06-02T18:00:00.000Z'), // Monday 18:00 (on-peak)
      ];
      const profile = createMockBatteryProfile({
        strategy: 'self_consumption',
        dischargeTiers: ['on-peak'],
      });

      const policy = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      // Does not discharge in off-peak even though strategy is self_consumption
      expect(policy[0].allowBatteryDischargeToLoad).toBe(false);
      expect(policy[1].allowBatteryDischargeToLoad).toBe(true);
    });
  });

  describe('G. Local timezone', () => {
    it('resolves site wall-clock hour according to the supplied IANA timezone', () => {
      // Instant: 2025-06-01T12:00:00.000Z (Sunday)
      // In UTC: hour 12
      // In America/Detroit (EDT = UTC-4): hour 8
      // In America/Los_Angeles (PDT = UTC-7): hour 5
      const schedule = createUniformScheduleMatrix('default-tier');
      schedule[0][12] = 'tier-utc';
      schedule[0][8] = 'tier-detroit';
      schedule[0][5] = 'tier-la';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        dischargeTiers: ['tier-detroit'],
      });

      const policyUtc = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );
      expect(policyUtc[0].hour).toBe(12);
      expect(policyUtc[0].tierId).toBe('tier-utc');
      expect(policyUtc[0].allowBatteryDischargeToLoad).toBe(false);

      const policyDetroit = generateBatteryDischargePolicy(
        timestamps,
        'America/Detroit',
        schedule,
        profile
      );
      expect(policyDetroit[0].hour).toBe(8);
      expect(policyDetroit[0].tierId).toBe('tier-detroit');
      expect(policyDetroit[0].allowBatteryDischargeToLoad).toBe(true);

      const policyLa = generateBatteryDischargePolicy(
        timestamps,
        'America/Los_Angeles',
        schedule,
        profile
      );
      expect(policyLa[0].hour).toBe(5);
      expect(policyLa[0].tierId).toBe('tier-la');
      expect(policyLa[0].allowBatteryDischargeToLoad).toBe(false);
    });
  });

  describe('H. Canonical weekday/weekend', () => {
    it('correctly maps Saturday=6, Sunday=0, Monday=1 to matrix rows', () => {
      const schedule = createUniformScheduleMatrix('base');
      schedule[6][12] = 'saturday-tier';
      schedule[0][12] = 'sunday-tier';
      schedule[1][12] = 'monday-tier';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-07T12:00:00.000Z'), // Saturday
        createAlignedTimestamp(1, '2025-06-08T12:00:00.000Z'), // Sunday
        createAlignedTimestamp(2, '2025-06-09T12:00:00.000Z'), // Monday
      ];
      const profile = createMockBatteryProfile({
        dischargeTiers: ['saturday-tier', 'monday-tier'],
      });

      const policy = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].dayOfWeek).toBe(6);
      expect(policy[0].tierId).toBe('saturday-tier');
      expect(policy[0].allowBatteryDischargeToLoad).toBe(true);

      expect(policy[1].dayOfWeek).toBe(0);
      expect(policy[1].tierId).toBe('sunday-tier');
      expect(policy[1].allowBatteryDischargeToLoad).toBe(false);

      expect(policy[2].dayOfWeek).toBe(1);
      expect(policy[2].tierId).toBe('monday-tier');
      expect(policy[2].allowBatteryDischargeToLoad).toBe(true);
    });
  });

  describe('I. DST spring-forward', () => {
    it('skips non-existent local hour 02:00 in America/Detroit without error', () => {
      // On March 9, 2025 in America/Detroit:
      // 06:00 UTC is 01:00 EST (hour 1)
      // 07:00 UTC is 03:00 EDT (hour 3) - 02:00 was skipped
      const schedule = createUniformScheduleMatrix('base');
      schedule[0][1] = 'pre-transition';
      schedule[0][3] = 'post-transition';

      const timestamps = [
        createAlignedTimestamp(0, '2025-03-09T06:00:00.000Z'),
        createAlignedTimestamp(1, '2025-03-09T07:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        dischargeTiers: ['post-transition'],
      });

      const policy = generateBatteryDischargePolicy(
        timestamps,
        'America/Detroit',
        schedule,
        profile
      );

      expect(policy[0].hour).toBe(1);
      expect(policy[0].tierId).toBe('pre-transition');
      expect(policy[0].allowBatteryDischargeToLoad).toBe(false);

      expect(policy[1].hour).toBe(3);
      expect(policy[1].tierId).toBe('post-transition');
      expect(policy[1].allowBatteryDischargeToLoad).toBe(true);
    });
  });

  describe('J. DST fall-back', () => {
    it('maps both distinct UTC instants of repeated 01:00 hour to hour 1 and the same tier', () => {
      // On November 2, 2025 in America/Detroit:
      // 05:00 UTC is 01:00 EDT (first hour 1)
      // 06:00 UTC is 01:00 EST (second hour 1)
      const schedule = createUniformScheduleMatrix('base');
      schedule[0][1] = 'repeated-hour-tier';

      const timestamps = [
        createAlignedTimestamp(0, '2025-11-02T05:00:00.000Z'),
        createAlignedTimestamp(1, '2025-11-02T06:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        dischargeTiers: ['repeated-hour-tier'],
      });

      const policy = generateBatteryDischargePolicy(
        timestamps,
        'America/Detroit',
        schedule,
        profile
      );

      expect(policy[0].hour).toBe(1);
      expect(policy[0].tierId).toBe('repeated-hour-tier');
      expect(policy[0].allowBatteryDischargeToLoad).toBe(true);

      expect(policy[1].hour).toBe(1);
      expect(policy[1].tierId).toBe('repeated-hour-tier');
      expect(policy[1].allowBatteryDischargeToLoad).toBe(true);
    });
  });

  describe('K. Invalid timezone', () => {
    const schedule = createUniformScheduleMatrix();
    const timestamps = [
      createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
    ];
    const profile = createMockBatteryProfile();

    it('rejects empty or whitespace timezone', () => {
      expect(() =>
        generateBatteryDischargePolicy(timestamps, '', schedule, profile)
      ).toThrow(/Invalid IANA time zone/i);

      expect(() =>
        generateBatteryDischargePolicy(timestamps, '   ', schedule, profile)
      ).toThrow(/Invalid IANA time zone/i);
    });

    it('rejects invalid timezone string', () => {
      expect(() =>
        generateBatteryDischargePolicy(
          timestamps,
          'Not/A_TimeZone',
          schedule,
          profile
        )
      ).toThrow(/Invalid IANA time zone/i);
    });
  });

  describe('L. Invalid schedule dimensions', () => {
    const timestamps = [
      createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
    ];
    const profile = createMockBatteryProfile();

    it('rejects schedule with 6 days', () => {
      const schedule = Array.from({ length: 6 }, () =>
        Array.from({ length: 24 }, () => 'off-peak')
      );
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profile)
      ).toThrow(/scheduleMatrix must be an array of 7 day rows/i);
    });

    it('rejects schedule with 8 days', () => {
      const schedule = Array.from({ length: 8 }, () =>
        Array.from({ length: 24 }, () => 'off-peak')
      );
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profile)
      ).toThrow(/scheduleMatrix must be an array of 7 day rows/i);
    });

    it('rejects schedule row with 23 hours', () => {
      const schedule = createUniformScheduleMatrix();
      schedule[2] = Array.from({ length: 23 }, () => 'off-peak');
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profile)
      ).toThrow(/scheduleMatrix day row 2 must contain exactly 24 hour entries/i);
    });

    it('rejects schedule row with 25 hours', () => {
      const schedule = createUniformScheduleMatrix();
      schedule[4] = Array.from({ length: 25 }, () => 'off-peak');
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profile)
      ).toThrow(/scheduleMatrix day row 4 must contain exactly 24 hour entries/i);
    });
  });

  describe('M. Invalid schedule cells', () => {
    const timestamps = [
      createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
    ];
    const profile = createMockBatteryProfile();

    it('rejects empty or whitespace cell', () => {
      const scheduleEmpty = createUniformScheduleMatrix();
      scheduleEmpty[1][5] = '';
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', scheduleEmpty, profile)
      ).toThrow(/must be a non-empty string tier ID/i);

      const scheduleWs = createUniformScheduleMatrix();
      scheduleWs[3][8] = '   ';
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', scheduleWs, profile)
      ).toThrow(/must be a non-empty string tier ID/i);
    });

    it('rejects non-string cell', () => {
      const scheduleBad = createUniformScheduleMatrix();
      scheduleBad[0][0] = 123 as unknown as string;
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', scheduleBad, profile)
      ).toThrow(/must be a non-empty string tier ID/i);
    });
  });

  describe('N. Invalid discharge tiers', () => {
    const schedule = createUniformScheduleMatrix();
    const timestamps = [
      createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
    ];

    it('rejects non-array dischargeTiers', () => {
      const profile = createMockBatteryProfile({
        dischargeTiers: 'on-peak' as unknown as string[],
      });
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profile)
      ).toThrow(/dischargeTiers must be an array of strings/i);
    });

    it('rejects empty or whitespace tier in dischargeTiers', () => {
      const profileEmpty = createMockBatteryProfile({
        dischargeTiers: ['on-peak', ''],
      });
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profileEmpty)
      ).toThrow(/must be a non-empty string/i);

      const profileWs = createMockBatteryProfile({
        dischargeTiers: ['   '],
      });
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profileWs)
      ).toThrow(/must be a non-empty string/i);
    });

    it('rejects non-string tier in dischargeTiers', () => {
      const profileNum = createMockBatteryProfile({
        dischargeTiers: [42 as unknown as string],
      });
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profileNum)
      ).toThrow(/must be a non-empty string/i);
    });
  });

  describe('O. Alignment mismatch', () => {
    const schedule = createUniformScheduleMatrix();
    const profile = createMockBatteryProfile();

    it('rejects empty alignedTimestamps array', () => {
      expect(() =>
        generateBatteryDischargePolicy([], 'UTC', schedule, profile)
      ).toThrow(/alignedTimestamps must be a non-empty array/i);
    });

    it('rejects sourceIndex !== array index', () => {
      const timestamps = [
        {
          sourceIndex: 5, // should be 0
          sourceTimestamp: '2025-06-01 12:00',
          instantUtc: new Date('2025-06-01T12:00:00.000Z'),
          timestampUtc: '2025-06-01T12:00:00.000Z',
        },
      ];
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profile)
      ).toThrow(/invalid sourceIndex/i);
    });

    it('rejects invalid instantUtc Date', () => {
      const timestamps = [
        {
          sourceIndex: 0,
          sourceTimestamp: '2025-06-01 12:00',
          instantUtc: new Date('invalid-date'),
          timestampUtc: '2025-06-01T12:00:00.000Z',
        },
      ];
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profile)
      ).toThrow(/invalid instantUtc Date object/i);
    });

    it('rejects timestampUtc inconsistent with instantUtc.toISOString()', () => {
      const timestamps = [
        {
          sourceIndex: 0,
          sourceTimestamp: '2025-06-01 12:00',
          instantUtc: new Date('2025-06-01T12:00:00.000Z'),
          timestampUtc: '2025-06-01T13:00:00.000Z', // mismatched!
        },
      ];
      expect(() =>
        generateBatteryDischargePolicy(timestamps, 'UTC', schedule, profile)
      ).toThrow(/does not match instantUtc.toISOString/i);
    });
  });

  describe('P. G3D compatibility', () => {
    it('passes G3E policy output directly into routeSequentialSolarBatteryFlow without remapping', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      schedule[0][17] = 'on-peak'; // Sunday 17:00 is on-peak
      schedule[0][18] = 'off-peak'; // Sunday 18:00 is off-peak

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T17:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T18:00:00.000Z'),
      ];

      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 5,
        dischargeTiers: ['on-peak'],
      });

      // Generate directives directly using G3E
      const directives = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(directives[0].allowBatteryDischargeToLoad).toBe(true);
      expect(directives[1].allowBatteryDischargeToLoad).toBe(false);

      // Create two intervals with residual home load
      const intervals: SolarLoadFlowInterval[] = [
        {
          sourceIndex: 0,
          sourceTimestamp: '2025-06-01 17:00',
          timestampUtc: '2025-06-01T17:00:00.000Z',
          homeLoadKwh: 3,
          solarGenerationKwh: 0,
          solarDirectToLoadKwh: 0,
          residualHomeLoadKwh: 3,
          surplusSolarKwh: 0,
        },
        {
          sourceIndex: 1,
          sourceTimestamp: '2025-06-01 18:00',
          timestampUtc: '2025-06-01T18:00:00.000Z',
          homeLoadKwh: 3,
          solarGenerationKwh: 0,
          solarDirectToLoadKwh: 0,
          residualHomeLoadKwh: 3,
          surplusSolarKwh: 0,
        },
      ];

      const initialState: BatterySocProvenanceState = {
        syntheticSocKwh: 5,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };

      // Pass directly to G3D without casting or adapter
      const simResult = routeSequentialSolarBatteryFlow(
        intervals,
        directives,
        1.0,
        profile,
        initialState
      );

      // Interval 0 (on-peak -> allowed): battery discharges to serve load
      expect(simResult.intervals[0].dischargeAllowed).toBe(true);
      expect(simResult.intervals[0].batteryDeliveredToLoadKwh).toBe(3);
      expect(simResult.intervals[0].residualHomeLoadAfterBatteryKwh).toBe(0);

      // Interval 1 (off-peak -> forbidden): battery remains idle, residual load preserved
      expect(simResult.intervals[1].dischargeAllowed).toBe(false);
      expect(simResult.intervals[1].batteryDeliveredToLoadKwh).toBe(0);
      expect(simResult.intervals[1].residualHomeLoadAfterBatteryKwh).toBe(3);
    });
  });

  describe('Q. Input immutability', () => {
    it('does not mutate frozen inputs', () => {
      const rawTimestamps = [
        createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T13:00:00.000Z'),
      ];
      const frozenTimestamps = Object.freeze([
        Object.freeze(rawTimestamps[0]),
        Object.freeze(rawTimestamps[1]),
      ]);

      const rawSchedule = createUniformScheduleMatrix('off-peak');
      const frozenSchedule = Object.freeze(
        rawSchedule.map((row) => Object.freeze([...row]))
      );

      const frozenDischargeTiers = Object.freeze(['on-peak']);
      const profile = Object.freeze(
        createMockBatteryProfile({
          dischargeTiers: frozenDischargeTiers as unknown as string[],
        })
      );

      expect(() => {
        generateBatteryDischargePolicy(
          frozenTimestamps as unknown as AlignedLoadTimestamp[],
          'UTC',
          frozenSchedule as unknown as string[][],
          profile
        );
      }).not.toThrow();
    });
  });
});

describe('G3G — Unified TOU Grid-Charge / Battery-Discharge Policy', () => {
  describe('A. Explicit charge tier', () => {
    it('sets allowGridChargeFromGrid to true when interval resolves to tier in chargeTiers', () => {
      const schedule = createUniformScheduleMatrix('on-peak');
      schedule[0][3] = 'off-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T03:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        chargeTiers: ['off-peak'],
        dischargeTiers: ['on-peak'],
      });

      const policy = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy).toHaveLength(1);
      expect(policy[0].tierId).toBe('off-peak');
      expect(policy[0].allowGridChargeFromGrid).toBe(true);
      expect(policy[0].allowBatteryDischargeToLoad).toBe(false);
    });
  });

  describe('B. Non-charge tier', () => {
    it('sets allowGridChargeFromGrid to false when interval resolves to tier not in chargeTiers', () => {
      const schedule = createUniformScheduleMatrix('on-peak');

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T15:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        chargeTiers: ['off-peak'],
      });

      const policy = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].tierId).toBe('on-peak');
      expect(policy[0].allowGridChargeFromGrid).toBe(false);
    });
  });

  describe('C. Empty charge tiers', () => {
    it('sets allowGridChargeFromGrid to false for every interval when chargeTiers is empty', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T01:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T02:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        chargeTiers: [],
      });

      const policy = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].allowGridChargeFromGrid).toBe(false);
      expect(policy[1].allowGridChargeFromGrid).toBe(false);
    });
  });

  describe('D. Multiple charge tiers', () => {
    it('allows grid charging when interval matches any configured charge tier', () => {
      const schedule = createUniformScheduleMatrix('peak');
      schedule[0][1] = 'super-off-peak';
      schedule[0][2] = 'off-peak';
      schedule[0][3] = 'shoulder';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T01:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T02:00:00.000Z'),
        createAlignedTimestamp(2, '2025-06-01T03:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        chargeTiers: ['super-off-peak', 'off-peak'],
      });

      const policy = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].allowGridChargeFromGrid).toBe(true);
      expect(policy[1].allowGridChargeFromGrid).toBe(true);
      expect(policy[2].allowGridChargeFromGrid).toBe(false);
    });
  });

  describe('E. Arbitrage charge policy', () => {
    it('follows configured charge tiers when strategy is arbitrage', () => {
      const schedule = createUniformScheduleMatrix('on-peak');
      schedule[0][4] = 'off-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T04:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        strategy: 'arbitrage',
        chargeTiers: ['off-peak'],
      });

      const policy = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].allowGridChargeFromGrid).toBe(true);
    });
  });

  describe('F. Self-consumption charge-policy parity', () => {
    it('currently follows the same explicit chargeTiers constraint for self_consumption', () => {
      const schedule = createUniformScheduleMatrix('on-peak');
      schedule[0][4] = 'off-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T04:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T12:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        strategy: 'self_consumption',
        chargeTiers: ['off-peak'],
      });

      const policy = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].allowGridChargeFromGrid).toBe(true);
      expect(policy[1].allowGridChargeFromGrid).toBe(false);
    });
  });

  describe('G. Independent charge/discharge permissions', () => {
    it('reports charge and discharge permissions independently per configured tiers', () => {
      const schedule = createUniformScheduleMatrix('shoulder');
      schedule[0][2] = 'off-peak';
      schedule[0][18] = 'on-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T02:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T18:00:00.000Z'),
        createAlignedTimestamp(2, '2025-06-01T12:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        chargeTiers: ['off-peak'],
        dischargeTiers: ['on-peak'],
      });

      const policy = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      // off-peak: charge = true, discharge = false
      expect(policy[0].tierId).toBe('off-peak');
      expect(policy[0].allowGridChargeFromGrid).toBe(true);
      expect(policy[0].allowBatteryDischargeToLoad).toBe(false);

      // on-peak: charge = false, discharge = true
      expect(policy[1].tierId).toBe('on-peak');
      expect(policy[1].allowGridChargeFromGrid).toBe(false);
      expect(policy[1].allowBatteryDischargeToLoad).toBe(true);

      // shoulder: charge = false, discharge = false
      expect(policy[2].tierId).toBe('shoulder');
      expect(policy[2].allowGridChargeFromGrid).toBe(false);
      expect(policy[2].allowBatteryDischargeToLoad).toBe(false);
    });
  });

  describe('H. Overlapping tier', () => {
    it('returns true for both permissions when a tier is configured in both chargeTiers and dischargeTiers', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      schedule[0][14] = 'shoulder';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T14:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        chargeTiers: ['shoulder'],
        dischargeTiers: ['shoulder'],
      });

      const policy = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(policy[0].tierId).toBe('shoulder');
      expect(policy[0].allowGridChargeFromGrid).toBe(true);
      expect(policy[0].allowBatteryDischargeToLoad).toBe(true);
    });
  });

  describe('I. Backwards-compatible wrapper', () => {
    it('produces identical results from generateBatteryDischargePolicy and generateBatteryDispatchPolicy', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      schedule[0][17] = 'on-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T04:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T17:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        chargeTiers: ['off-peak'],
        dischargeTiers: ['on-peak'],
      });

      const dispatchPolicy = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );
      const dischargePolicy = generateBatteryDischargePolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      expect(dispatchPolicy).toEqual(dischargePolicy);
    });
  });

  describe('J. G3D compatibility', () => {
    it('allows output of generateBatteryDispatchPolicy to pass directly into G3D routeSequentialSolarBatteryFlow', () => {
      const schedule = createUniformScheduleMatrix('off-peak');
      schedule[0][17] = 'on-peak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T17:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T18:00:00.000Z'),
      ];

      const profile = createMockBatteryProfile({
        chargeTiers: ['off-peak'],
        dischargeTiers: ['on-peak'],
      });

      // generateBatteryDispatchPolicy returns BatteryDispatchPolicyInterval[]
      // which implements both BatteryDischargeDirective and BatteryGridChargeDirective
      const directives = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      const intervals: SolarLoadFlowInterval[] = [
        {
          sourceIndex: 0,
          sourceTimestamp: '2025-06-01 17:00',
          timestampUtc: '2025-06-01T17:00:00.000Z',
          homeLoadKwh: 2,
          solarGenerationKwh: 0,
          solarDirectToLoadKwh: 0,
          residualHomeLoadKwh: 2,
          surplusSolarKwh: 0,
        },
        {
          sourceIndex: 1,
          sourceTimestamp: '2025-06-01 18:00',
          timestampUtc: '2025-06-01T18:00:00.000Z',
          homeLoadKwh: 2,
          solarGenerationKwh: 0,
          solarDirectToLoadKwh: 0,
          residualHomeLoadKwh: 2,
          surplusSolarKwh: 0,
        },
      ];

      const initialState: BatterySocProvenanceState = {
        syntheticSocKwh: 5,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };

      const result = routeSequentialSolarBatteryFlow(
        intervals,
        directives,
        1.0,
        profile,
        initialState
      );

      // On-peak: discharge was permitted by G3D
      expect(result.intervals[0].dischargeAllowed).toBe(true);
      expect(result.intervals[0].batteryDeliveredToLoadKwh).toBe(2);

      // Off-peak: discharge was forbidden
      expect(result.intervals[1].dischargeAllowed).toBe(false);
      expect(result.intervals[1].batteryDeliveredToLoadKwh).toBe(0);
    });
  });

  describe('K. Invalid charge tiers', () => {
    const schedule = createUniformScheduleMatrix();
    const timestamps = [
      createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
    ];

    it('rejects non-array chargeTiers', () => {
      const profile = createMockBatteryProfile({
        chargeTiers: 'off-peak' as unknown as string[],
      });
      expect(() =>
        generateBatteryDispatchPolicy(timestamps, 'UTC', schedule, profile)
      ).toThrow(/chargeTiers must be an array of strings/i);
    });

    it('rejects empty or whitespace tier in chargeTiers', () => {
      const profileEmpty = createMockBatteryProfile({
        chargeTiers: ['off-peak', ''],
      });
      expect(() =>
        generateBatteryDispatchPolicy(timestamps, 'UTC', schedule, profileEmpty)
      ).toThrow(/must be a non-empty string/i);

      const profileWs = createMockBatteryProfile({
        chargeTiers: ['   '],
      });
      expect(() =>
        generateBatteryDispatchPolicy(timestamps, 'UTC', schedule, profileWs)
      ).toThrow(/must be a non-empty string/i);
    });

    it('rejects non-string tier in chargeTiers', () => {
      const profileNum = createMockBatteryProfile({
        chargeTiers: [99 as unknown as string],
      });
      expect(() =>
        generateBatteryDispatchPolicy(timestamps, 'UTC', schedule, profileNum)
      ).toThrow(/must be a non-empty string/i);
    });

    it('accepts empty array for chargeTiers', () => {
      const profileEmptyArr = createMockBatteryProfile({
        chargeTiers: [],
      });
      expect(() =>
        generateBatteryDispatchPolicy(timestamps, 'UTC', schedule, profileEmptyArr)
      ).not.toThrow();
    });
  });

  describe('L. Existing timezone/DST regressions', () => {
    it('evaluates grid charging against the local wall-clock tier in America/Detroit', () => {
      // 2025-06-01T12:00:00.000Z is 08:00 EDT (hour 8)
      const schedule = createUniformScheduleMatrix('peak');
      schedule[0][8] = 'detroit-morning-offpeak';

      const timestamps = [
        createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
      ];
      const profile = createMockBatteryProfile({
        chargeTiers: ['detroit-morning-offpeak'],
      });

      const policy = generateBatteryDispatchPolicy(
        timestamps,
        'America/Detroit',
        schedule,
        profile
      );

      expect(policy[0].hour).toBe(8);
      expect(policy[0].tierId).toBe('detroit-morning-offpeak');
      expect(policy[0].allowGridChargeFromGrid).toBe(true);
    });
  });

  describe('M. Input immutability', () => {
    it('does not mutate frozen inputs including chargeTiers and dischargeTiers', () => {
      const rawTimestamps = [
        createAlignedTimestamp(0, '2025-06-01T12:00:00.000Z'),
        createAlignedTimestamp(1, '2025-06-01T13:00:00.000Z'),
      ];
      const frozenTimestamps = Object.freeze([
        Object.freeze(rawTimestamps[0]),
        Object.freeze(rawTimestamps[1]),
      ]);

      const rawSchedule = createUniformScheduleMatrix('off-peak');
      const frozenSchedule = Object.freeze(
        rawSchedule.map((row) => Object.freeze([...row]))
      );

      const frozenChargeTiers = Object.freeze(['off-peak']);
      const frozenDischargeTiers = Object.freeze(['on-peak']);
      const profile = Object.freeze(
        createMockBatteryProfile({
          chargeTiers: frozenChargeTiers as unknown as string[],
          dischargeTiers: frozenDischargeTiers as unknown as string[],
        })
      );

      expect(() => {
        generateBatteryDispatchPolicy(
          frozenTimestamps as unknown as AlignedLoadTimestamp[],
          'UTC',
          frozenSchedule as unknown as string[][],
          profile
        );
      }).not.toThrow();
    });
  });
});

