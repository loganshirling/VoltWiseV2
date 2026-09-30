import { describe, it, expect } from 'vitest';
import { resolveTariffRates } from '../utils/tariffRateResolver';
import { calculateTariffCosts } from '../utils/tariffCostAccounting';
import {
  BatteryDispatchPolicyInterval,
  GridFlowInterval,
  IntegratedBatteryFlowInterval,
  RateTier,
  TariffRateReferenceInterval,
  TouSeason,
} from '../types/energy';
import { AlignedLoadTimestamp } from '../utils/loadTimeAlignment';

function createMockAlignedTimestamp(
  index: number,
  isoUtc: string,
  sourceTimestamp?: string
): AlignedLoadTimestamp {
  const instant = new Date(isoUtc);
  return {
    sourceIndex: index,
    sourceTimestamp:
      sourceTimestamp ??
      isoUtc.slice(0, 16).replace('T', ' '),
    instantUtc: instant,
    timestampUtc: isoUtc,
  };
}

const DEFAULT_TIERS: RateTier[] = [
  {
    id: 'off-peak',
    name: 'Off-Peak Rate',
    buyRate: 0.15,
    sellRate: 0.05,
    color: '#3b82f6',
  },
  {
    id: 'on-peak',
    name: 'On-Peak Rate',
    buyRate: 0.40,
    sellRate: 0.10,
    color: '#ef4444',
  },
];

describe('Reusable Tariff Rate Resolution Engine (Milestone G3M)', () => {
  // 1. base tier resolution
  it('1. resolves base RateTier buyRate, sellRate, and tierName when no seasons configured', () => {
    const isoUtc = '2025-06-15T10:00:00.000Z';
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'off-peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    const result = resolveTariffRates(intervals, aligned, 'UTC', DEFAULT_TIERS);

    expect(result).toHaveLength(1);
    expect(result[0].sourceIndex).toBe(0);
    expect(result[0].timestampUtc).toBe(isoUtc);
    expect(result[0].tierId).toBe('off-peak');
    expect(result[0].tierName).toBe('Off-Peak Rate');
    expect(result[0].localMonth).toBe(5); // June = index 5
    expect(result[0].seasonName).toBeUndefined();
    expect(result[0].buyRate).toBe(0.15);
    expect(result[0].sellRate).toBe(0.05);
  });

  // 2. seasonal override
  it('2. overrides buyRate and sellRate when an active season contains a rate entry for the tier', () => {
    const isoUtc = '2025-07-15T14:00:00.000Z'; // July = index 6
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'on-peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    const summerSeason: TouSeason = {
      id: 'summer',
      name: 'Summer Season',
      months: [5, 6, 7, 8],
      tierRates: {
        'on-peak': { buyRate: 0.55, sellRate: 0.18 },
      },
    };

    const result = resolveTariffRates(intervals, aligned, 'UTC', DEFAULT_TIERS, [
      summerSeason,
    ]);

    expect(result[0].seasonName).toBe('Summer Season');
    expect(result[0].buyRate).toBe(0.55);
    expect(result[0].sellRate).toBe(0.18);
    expect(result[0].tierName).toBe('On-Peak Rate');
  });

  // 3. active season without tier override
  it('3. preserves base rates while reporting seasonName when active season has no override for that tier', () => {
    const isoUtc = '2025-07-15T02:00:00.000Z'; // July = index 6
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'off-peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    const summerSeason: TouSeason = {
      id: 'summer',
      name: 'Summer Season',
      months: [5, 6, 7, 8],
      tierRates: {
        'on-peak': { buyRate: 0.55, sellRate: 0.18 }, // No override for 'off-peak'
      },
    };

    const result = resolveTariffRates(intervals, aligned, 'UTC', DEFAULT_TIERS, [
      summerSeason,
    ]);

    expect(result[0].seasonName).toBe('Summer Season');
    expect(result[0].buyRate).toBe(0.15); // base tier rate
    expect(result[0].sellRate).toBe(0.05); // base tier rate
  });

  // 4. first matching overlapping season
  it('4. uses first matching season when multiple seasons include the same month', () => {
    const isoUtc = '2025-07-15T12:00:00.000Z'; // Month 6 (July)
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'on-peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    const overlappingSeasons: TouSeason[] = [
      {
        id: 'broad',
        name: 'Broad Summer',
        months: [5, 6, 7],
        tierRates: { 'on-peak': { buyRate: 0.45, sellRate: 0.12 } },
      },
      {
        id: 'peak',
        name: 'Peak Summer',
        months: [6, 7],
        tierRates: { 'on-peak': { buyRate: 0.65, sellRate: 0.25 } },
      },
    ];

    const result = resolveTariffRates(
      intervals,
      aligned,
      'UTC',
      DEFAULT_TIERS,
      overlappingSeasons
    );

    expect(result[0].seasonName).toBe('Broad Summer');
    expect(result[0].buyRate).toBe(0.45);
    expect(result[0].sellRate).toBe(0.12);
  });

  // 5. local month in site timezone
  it('5. resolves local month according to site IANA timezone, not host timezone', () => {
    // 2025-06-01T02:00:00Z:
    // UTC month = 5 (June)
    // In America/Los_Angeles (UTC-7 DST): 2025-05-31 19:00:00 => month = 4 (May)
    const isoUtc = '2025-06-01T02:00:00.000Z';
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'off-peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    const seasons: TouSeason[] = [
      {
        id: 'may',
        name: 'May Season',
        months: [4],
        tierRates: { 'off-peak': { buyRate: 0.11, sellRate: 0.03 } },
      },
      {
        id: 'june',
        name: 'June Season',
        months: [5],
        tierRates: { 'off-peak': { buyRate: 0.22, sellRate: 0.08 } },
      },
    ];

    const resultLA = resolveTariffRates(
      intervals,
      aligned,
      'America/Los_Angeles',
      DEFAULT_TIERS,
      seasons
    );
    expect(resultLA[0].localMonth).toBe(4);
    expect(resultLA[0].seasonName).toBe('May Season');
    expect(resultLA[0].buyRate).toBe(0.11);

    const resultUTC = resolveTariffRates(
      intervals,
      aligned,
      'UTC',
      DEFAULT_TIERS,
      seasons
    );
    expect(resultUTC[0].localMonth).toBe(5);
    expect(resultUTC[0].seasonName).toBe('June Season');
    expect(resultUTC[0].buyRate).toBe(0.22);
  });

  // 6. UTC/local month boundary difference
  it('6. handles Year/New Year boundary where UTC month differs from site local month', () => {
    // 2025-01-01T03:00:00Z:
    // UTC month = 0 (January 2025)
    // In America/New_York (UTC-5): 2024-12-31 22:00:00 => month = 11 (December 2024)
    const isoUtc = '2025-01-01T03:00:00.000Z';
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'off-peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    const seasons: TouSeason[] = [
      {
        id: 'dec',
        name: 'December Winter',
        months: [11],
        tierRates: { 'off-peak': { buyRate: 0.12, sellRate: 0.04 } },
      },
      {
        id: 'jan',
        name: 'January Freeze',
        months: [0],
        tierRates: { 'off-peak': { buyRate: 0.20, sellRate: 0.08 } },
      },
    ];

    const result = resolveTariffRates(
      intervals,
      aligned,
      'America/New_York',
      DEFAULT_TIERS,
      seasons
    );
    expect(result[0].localMonth).toBe(11);
    expect(result[0].seasonName).toBe('December Winter');
    expect(result[0].buyRate).toBe(0.12);
  });

  // 7. negative finite buy/sell rates
  it('7. accepts finite negative buy and sell rates without clamping', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'negative-tier' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    const negativeTier: RateTier[] = [
      {
        id: 'negative-tier',
        name: 'Negative Spot Tier',
        buyRate: -0.05,
        sellRate: -0.02,
        color: '#10b981',
      },
    ];

    const result = resolveTariffRates(intervals, aligned, 'UTC', negativeTier);

    expect(result[0].buyRate).toBe(-0.05);
    expect(result[0].sellRate).toBe(-0.02);
  });

  // 8. duplicate tier rejection
  it('8. rejects configuration with duplicate RateTier IDs', () => {
    const duplicateTiers: RateTier[] = [
      { id: 'peak', name: 'Peak 1', buyRate: 0.30, sellRate: 0.10, color: '#f00' },
      { id: 'peak', name: 'Peak 2', buyRate: 0.35, sellRate: 0.12, color: '#f00' },
    ];
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    expect(() =>
      resolveTariffRates(intervals, aligned, 'UTC', duplicateTiers)
    ).toThrow(/Duplicate RateTier ID "peak"/);
  });

  // 9. unknown tier rejection
  it('9. rejects interval referencing an unknown tier ID', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'non-existent' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    expect(() =>
      resolveTariffRates(intervals, aligned, 'UTC', DEFAULT_TIERS)
    ).toThrow(/Unknown tier ID "non-existent"/);
  });

  // 10. invalid timezone
  it('10. rejects invalid or unsupported IANA timezone string', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'off-peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    expect(() =>
      resolveTariffRates(intervals, aligned, 'Invalid/Fake_Zone', DEFAULT_TIERS)
    ).toThrow(/Invalid or unsupported IANA timeZone/);
  });

  // 11. invalid tier fields/rates
  it('11. rejects invalid tier fields (empty id/name or non-finite buy/sell rates)', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 't1' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    // Empty ID
    expect(() =>
      resolveTariffRates(intervals, aligned, 'UTC', [
        { id: '', name: 'Empty ID', buyRate: 0.3, sellRate: 0.1, color: '#000' },
      ])
    ).toThrow(/id must be a non-empty string/);

    // Empty Name
    expect(() =>
      resolveTariffRates(intervals, aligned, 'UTC', [
        { id: 't1', name: '  ', buyRate: 0.3, sellRate: 0.1, color: '#000' },
      ])
    ).toThrow(/name must be a non-empty string/);

    // NaN buyRate
    expect(() =>
      resolveTariffRates(intervals, aligned, 'UTC', [
        { id: 't1', name: 'Valid', buyRate: NaN, sellRate: 0.1, color: '#000' },
      ])
    ).toThrow(/buyRate must be a finite number/);

    // Infinite sellRate
    expect(() =>
      resolveTariffRates(intervals, aligned, 'UTC', [
        { id: 't1', name: 'Valid', buyRate: 0.3, sellRate: Infinity, color: '#000' },
      ])
    ).toThrow(/sellRate must be a finite number/);
  });

  // 12. invalid seasonal month/rates
  it('12. rejects invalid seasonal configuration (out-of-range month or non-finite rates)', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc, tierId: 'off-peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc)];

    // Month out of range (12)
    const invalidMonthSeason: TouSeason = {
      id: 'bad-month',
      name: 'Bad Month',
      months: [12],
      tierRates: {},
    };
    expect(() =>
      resolveTariffRates(intervals, aligned, 'UTC', DEFAULT_TIERS, [
        invalidMonthSeason,
      ])
    ).toThrow(/month at index 0 must be an integer between 0 and 11/);

    // Non-finite seasonal sellRate
    const badRateSeason: TouSeason = {
      id: 'bad-rate',
      name: 'Bad Rate',
      months: [5],
      tierRates: {
        'off-peak': { buyRate: 0.20, sellRate: NaN },
      },
    };
    expect(() =>
      resolveTariffRates(intervals, aligned, 'UTC', DEFAULT_TIERS, [
        badRateSeason,
      ])
    ).toThrow(/seasonal sellRate for tier "off-peak"/);
  });

  // 13. index/timestamp/length mismatch
  it('13. rejects array length, sourceIndex, and timestamp mismatches', () => {
    const isoUtc0 = '2025-06-15T10:00:00.000Z';
    const isoUtc1 = '2025-06-15T11:00:00.000Z';

    const intervals: TariffRateReferenceInterval[] = [
      { sourceIndex: 0, timestampUtc: isoUtc0, tierId: 'off-peak' },
    ];
    const aligned = [createMockAlignedTimestamp(0, isoUtc0)];

    // Array length mismatch
    expect(() =>
      resolveTariffRates(
        intervals,
        [...aligned, createMockAlignedTimestamp(1, isoUtc1)],
        'UTC',
        DEFAULT_TIERS
      )
    ).toThrow(/Array length mismatch/);

    // Empty arrays
    expect(() => resolveTariffRates([], [], 'UTC', DEFAULT_TIERS)).toThrow(
      /intervals must be a non-empty array/
    );

    // sourceIndex mismatch
    const badIndex = [
      { sourceIndex: 5, timestampUtc: isoUtc0, tierId: 'off-peak' },
    ];
    expect(() => resolveTariffRates(badIndex, aligned, 'UTC', DEFAULT_TIERS)).toThrow(
      /Alignment error at index 0: intervals sourceIndex is 5, expected 0/
    );

    // Timestamp mismatch
    const badTimestamp = [
      { sourceIndex: 0, timestampUtc: isoUtc1, tierId: 'off-peak' },
    ];
    expect(() =>
      resolveTariffRates(badTimestamp, aligned, 'UTC', DEFAULT_TIERS)
    ).toThrow(/Timestamp mismatch at index 0/);
  });

  // 14. input immutability
  it('14. does not mutate input arrays or objects (verified with Object.freeze)', () => {
    const isoUtc = '2025-06-15T12:00:00.000Z';
    const intervalItem = Object.freeze({
      sourceIndex: 0,
      timestampUtc: isoUtc,
      tierId: 'off-peak',
    });
    const intervals = Object.freeze([intervalItem]);
    const aligned = Object.freeze([
      Object.freeze(createMockAlignedTimestamp(0, isoUtc)),
    ]);
    const tiers = Object.freeze([
      Object.freeze({ ...DEFAULT_TIERS[0] }),
      Object.freeze({ ...DEFAULT_TIERS[1] }),
    ]);
    const season = Object.freeze({
      id: 'summer',
      name: 'Summer Season',
      months: Object.freeze([5, 6, 7]),
      tierRates: Object.freeze({
        'off-peak': Object.freeze({ buyRate: 0.18, sellRate: 0.08 }),
      }),
    });
    const seasons = Object.freeze([season as unknown as TouSeason]);

    expect(() =>
      resolveTariffRates(
        intervals as unknown as TariffRateReferenceInterval[],
        aligned as unknown as AlignedLoadTimestamp[],
        'UTC',
        tiers as unknown as RateTier[],
        seasons as unknown as TouSeason[]
      )
    ).not.toThrow();
  });

  // 15. direct G3G compatibility:
  // pass BatteryDispatchPolicyInterval[] directly to resolveTariffRates()
  it('15. allows BatteryDispatchPolicyInterval[] to be passed directly without adapters (G3G compatibility)', () => {
    const policyIntervals: BatteryDispatchPolicyInterval[] = [
      {
        sourceIndex: 0,
        timestampUtc: '2025-06-15T02:00:00.000Z',
        tierId: 'off-peak',
        allowBatteryDischargeToLoad: false,
        allowGridChargeFromGrid: true,
        dayOfWeek: 0,
        hour: 2,
      },
      {
        sourceIndex: 1,
        timestampUtc: '2025-06-15T18:00:00.000Z',
        tierId: 'on-peak',
        allowBatteryDischargeToLoad: true,
        allowGridChargeFromGrid: false,
        dayOfWeek: 0,
        hour: 18,
      },
    ];

    const aligned = [
      createMockAlignedTimestamp(0, '2025-06-15T02:00:00.000Z'),
      createMockAlignedTimestamp(1, '2025-06-15T18:00:00.000Z'),
    ];

    // Direct invocation with no adapters or casting
    const resolved = resolveTariffRates(
      policyIntervals,
      aligned,
      'UTC',
      DEFAULT_TIERS
    );

    expect(resolved).toHaveLength(2);
    expect(resolved[0].tierId).toBe('off-peak');
    expect(resolved[0].buyRate).toBe(0.15);
    expect(resolved[0].sellRate).toBe(0.05);

    expect(resolved[1].tierId).toBe('on-peak');
    expect(resolved[1].buyRate).toBe(0.40);
    expect(resolved[1].sellRate).toBe(0.10);
  });

  // 16. G3J parity:
  // verify calculateTariffCosts() returns the same resolved rate fields and cost equations using the extracted resolver
  it('16. verifies calculateTariffCosts() returns identical resolved rate fields and cost equations', () => {
    const isoUtc0 = '2025-07-15T02:00:00.000Z';
    const isoUtc1 = '2025-07-15T18:00:00.000Z';

    const aligned = [
      createMockAlignedTimestamp(0, isoUtc0, '2025-07-15 02:00'),
      createMockAlignedTimestamp(1, isoUtc1, '2025-07-15 18:00'),
    ];

    const gridFlows: GridFlowInterval[] = [
      {
        sourceIndex: 0,
        sourceTimestamp: '2025-07-15 02:00',
        timestampUtc: isoUtc0,
        tierId: 'off-peak',
        residualHomeLoadKwh: 2,
        gridBatteryChargeKwh: 3,
        remainingSurplusSolarKwh: 0,
        gridImportForHomeKwh: 2,
        gridImportForBatteryKwh: 3,
        totalGridImportKwh: 5,
        solarExportKwh: 0,
        curtailedSolarKwh: 0,
        batteryExportKwh: 0,
        totalGridExportKwh: 0,
      },
      {
        sourceIndex: 1,
        sourceTimestamp: '2025-07-15 18:00',
        timestampUtc: isoUtc1,
        tierId: 'on-peak',
        residualHomeLoadKwh: 0,
        gridBatteryChargeKwh: 0,
        remainingSurplusSolarKwh: 4,
        gridImportForHomeKwh: 0,
        gridImportForBatteryKwh: 0,
        totalGridImportKwh: 0,
        solarExportKwh: 4,
        curtailedSolarKwh: 0,
        batteryExportKwh: 0,
        totalGridExportKwh: 4,
      },
    ];

    const integrated: IntegratedBatteryFlowInterval[] = [
      {
        sourceIndex: 0,
        sourceTimestamp: '2025-07-15 02:00',
        timestampUtc: isoUtc0,
        tierId: 'off-peak',
        homeLoadKwh: 4,
        solarGenerationKwh: 0,
        solarDirectToLoadKwh: 0,
        residualHomeLoadBeforeBatteryKwh: 4,
        surplusSolarBeforeBatteryKwh: 0,
        gridChargeAllowed: true,
        dischargeAllowed: false,
        solarToBatteryAcKwh: 0,
        renewableEnergyStoredKwh: 0,
        requestedGridChargeAcKwh: 3,
        gridToBatteryAcKwh: 3,
        gridEnergyStoredKwh: 3,
        batteryDeliveredToLoadKwh: 0,
        storedEnergyDrainedKwh: 0,
        syntheticSocDrainedKwh: 0,
        renewableSocDrainedKwh: 0,
        generatorSocDrainedKwh: 0,
        gridSocDrainedKwh: 0,
        residualHomeLoadAfterBatteryKwh: 4,
        remainingSurplusSolarKwh: 0,
        batterySocBeforeKwh: 0,
        batterySocAfterKwh: 3,
        stateBefore: {
          syntheticSocKwh: 0,
          gridChargedSocKwh: 0,
          renewableChargedSocKwh: 0,
          generatorChargedSocKwh: 0,
        },
        stateAfter: {
          syntheticSocKwh: 0,
          gridChargedSocKwh: 3,
          renewableChargedSocKwh: 0,
          generatorChargedSocKwh: 0,
        },
      },
      {
        sourceIndex: 1,
        sourceTimestamp: '2025-07-15 18:00',
        timestampUtc: isoUtc1,
        tierId: 'on-peak',
        homeLoadKwh: 1,
        solarGenerationKwh: 5,
        solarDirectToLoadKwh: 1,
        residualHomeLoadBeforeBatteryKwh: 0,
        surplusSolarBeforeBatteryKwh: 4,
        gridChargeAllowed: false,
        dischargeAllowed: false,
        solarToBatteryAcKwh: 0,
        renewableEnergyStoredKwh: 0,
        requestedGridChargeAcKwh: 0,
        gridToBatteryAcKwh: 0,
        gridEnergyStoredKwh: 0,
        batteryDeliveredToLoadKwh: 0,
        storedEnergyDrainedKwh: 0,
        syntheticSocDrainedKwh: 0,
        renewableSocDrainedKwh: 0,
        generatorSocDrainedKwh: 0,
        gridSocDrainedKwh: 0,
        residualHomeLoadAfterBatteryKwh: 0,
        remainingSurplusSolarKwh: 4,
        batterySocBeforeKwh: 3,
        batterySocAfterKwh: 3,
        stateBefore: {
          syntheticSocKwh: 0,
          gridChargedSocKwh: 3,
          renewableChargedSocKwh: 0,
          generatorChargedSocKwh: 0,
        },
        stateAfter: {
          syntheticSocKwh: 0,
          gridChargedSocKwh: 3,
          renewableChargedSocKwh: 0,
          generatorChargedSocKwh: 0,
        },
      },
    ];

    const seasons: TouSeason[] = [
      {
        id: 'summer',
        name: 'Summer Season',
        months: [5, 6, 7],
        tierRates: {
          'on-peak': { buyRate: 0.60, sellRate: 0.22 },
        },
      },
    ];

    // 1. Direct resolver call
    const directlyResolved = resolveTariffRates(
      gridFlows,
      aligned,
      'UTC',
      DEFAULT_TIERS,
      seasons
    );

    // 2. G3J accounting call
    const tariffResult = calculateTariffCosts(
      gridFlows,
      integrated,
      aligned,
      'UTC',
      DEFAULT_TIERS,
      seasons
    );

    expect(tariffResult.intervals).toHaveLength(2);

    for (let i = 0; i < 2; i++) {
      const tc = tariffResult.intervals[i];
      const dr = directlyResolved[i];

      // Exact parity of resolved rate fields
      expect(tc.tierId).toBe(dr.tierId);
      expect(tc.tierName).toBe(dr.tierName);
      expect(tc.seasonName).toBe(dr.seasonName);
      expect(tc.localMonth).toBe(dr.localMonth);
      expect(tc.buyRate).toBe(dr.buyRate);
      expect(tc.sellRate).toBe(dr.sellRate);

      // Verify cost equations with resolved rates
      expect(tc.baselineCost).toBeCloseTo(tc.homeLoadKwh * dr.buyRate, 8);
      expect(tc.totalGridImportCost).toBeCloseTo(tc.totalGridImportKwh * dr.buyRate, 8);
      expect(tc.gridExportCredit).toBeCloseTo(tc.totalGridExportKwh * dr.sellRate, 8);
      expect(tc.simulatedCost).toBeCloseTo(tc.totalGridImportCost - tc.gridExportCredit, 8);
      expect(tc.netSavings).toBeCloseTo(tc.baselineCost - tc.simulatedCost, 8);
    }
  });
});
