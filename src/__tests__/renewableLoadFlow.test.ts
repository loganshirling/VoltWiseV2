import { describe, it, expect } from 'vitest';
import {
  calculateRenewableLoadFlow,
  summarizeRenewableLoadFlow,
} from '../utils/renewableLoadFlow';
import {
  IntervalDataPoint,
  SolarFleetGenerationInterval,
  WindFleetGenerationInterval,
} from '../types/energy';
import { AlignedLoadTimestamp } from '../utils/loadTimeAlignment';

describe('G5C — Renewable Load Flow Layer', () => {
  function makeDataPoint(
    index: number,
    usageKwh: number,
    timestamp = `2025-06-15 ${String(index).padStart(2, '0')}:00`
  ): IntervalDataPoint {
    const d = new Date(`2025-06-15T${String(index).padStart(2, '0')}:00:00Z`);
    return {
      timestamp,
      date: d,
      hour: index % 24,
      dayOfWeek: 0,
      month: 5,
      usageKwh,
    };
  }

  function makeAlignedTimestamp(
    index: number,
    sourceTimestamp = `2025-06-15 ${String(index).padStart(2, '0')}:00`,
    timestampUtc = `2025-06-15T${String(index).padStart(2, '0')}:00:00.000Z`
  ): AlignedLoadTimestamp {
    return {
      sourceIndex: index,
      sourceTimestamp,
      timestampUtc,
      instantUtc: new Date(timestampUtc),
    };
  }

  function makeSolarInterval(
    timestampUtc: string,
    totalAcEnergyKwh: number
  ): SolarFleetGenerationInterval {
    return {
      timestampUtc,
      totalRawDcPowerKw: totalAcEnergyKwh,
      totalDcPowerAfterLossesKw: totalAcEnergyKwh,
      totalUnclippedAcPowerKw: totalAcEnergyKwh,
      totalAcPowerKw: totalAcEnergyKwh,
      totalDcEnergyKwh: totalAcEnergyKwh,
      totalAcEnergyKwh,
      totalClippedEnergyKwh: 0,
    };
  }

  function makeWindInterval(
    timestampUtc: string,
    totalEnergyKwh: number
  ): WindFleetGenerationInterval {
    return {
      timestampUtc,
      totalExpectedPowerKw: totalEnergyKwh,
      totalEnergyKwh,
    };
  }

  // 1. Solar-only below load
  it('1. solar-only below load serves portion of load with zero surplus and residual load', () => {
    const dp = [makeDataPoint(0, 5.0)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 3.0)];
    const wind = [makeWindInterval(at[0].timestampUtc, 0.0)];

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    expect(result).toHaveLength(1);
    const inv = result[0];

    expect(inv.homeLoadKwh).toBe(5.0);
    expect(inv.solarGenerationKwh).toBe(3.0);
    expect(inv.windGenerationKwh).toBe(0.0);
    expect(inv.totalRenewableGenerationKwh).toBe(3.0);

    expect(inv.solarDirectToLoadKwh).toBe(3.0);
    expect(inv.windDirectToLoadKwh).toBe(0.0);
    expect(inv.totalRenewableDirectToLoadKwh).toBe(3.0);

    expect(inv.residualHomeLoadKwh).toBe(2.0);
    expect(inv.surplusSolarKwh).toBe(0.0);
    expect(inv.surplusWindKwh).toBe(0.0);
    expect(inv.totalRenewableSurplusKwh).toBe(0.0);
  });

  // 2. Solar-only above load
  it('2. solar-only above load completely covers load with surplus solar and zero residual load', () => {
    const dp = [makeDataPoint(0, 2.5)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 6.0)];
    const wind = [makeWindInterval(at[0].timestampUtc, 0.0)];

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    const inv = result[0];

    expect(inv.solarDirectToLoadKwh).toBe(2.5);
    expect(inv.windDirectToLoadKwh).toBe(0.0);
    expect(inv.totalRenewableDirectToLoadKwh).toBe(2.5);

    expect(inv.residualHomeLoadKwh).toBe(0.0);
    expect(inv.surplusSolarKwh).toBe(3.5);
    expect(inv.surplusWindKwh).toBe(0.0);
    expect(inv.totalRenewableSurplusKwh).toBe(3.5);
  });

  // 3. Wind-only below load
  it('3. wind-only below load serves portion of load with zero surplus and residual load', () => {
    const dp = [makeDataPoint(0, 4.0)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 0.0)];
    const wind = [makeWindInterval(at[0].timestampUtc, 1.5)];

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    const inv = result[0];

    expect(inv.homeLoadKwh).toBe(4.0);
    expect(inv.solarGenerationKwh).toBe(0.0);
    expect(inv.windGenerationKwh).toBe(1.5);
    expect(inv.totalRenewableGenerationKwh).toBe(1.5);

    expect(inv.solarDirectToLoadKwh).toBe(0.0);
    expect(inv.windDirectToLoadKwh).toBe(1.5);
    expect(inv.totalRenewableDirectToLoadKwh).toBe(1.5);

    expect(inv.residualHomeLoadKwh).toBe(2.5);
    expect(inv.surplusSolarKwh).toBe(0.0);
    expect(inv.surplusWindKwh).toBe(0.0);
    expect(inv.totalRenewableSurplusKwh).toBe(0.0);
  });

  // 4. Wind-only above load
  it('4. wind-only above load completely covers load with surplus wind and zero residual load', () => {
    const dp = [makeDataPoint(0, 1.2)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 0.0)];
    const wind = [makeWindInterval(at[0].timestampUtc, 4.8)];

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    const inv = result[0];

    expect(inv.solarDirectToLoadKwh).toBe(0.0);
    expect(inv.windDirectToLoadKwh).toBe(1.2);
    expect(inv.totalRenewableDirectToLoadKwh).toBe(1.2);

    expect(inv.residualHomeLoadKwh).toBe(0.0);
    expect(inv.surplusSolarKwh).toBe(0.0);
    expect(inv.surplusWindKwh).toBeCloseTo(3.6, 10);
    expect(inv.totalRenewableSurplusKwh).toBeCloseTo(3.6, 10);
  });

  // 5. Mixed solar + wind below load
  it('5. mixed solar + wind below load allocates direct load proportionally and leaves zero surplus', () => {
    // Load = 10, Solar = 3, Wind = 1 -> Total Gen = 4 < 10
    // Solar share = 3/4 = 75%, Wind share = 1/4 = 25%
    // Solar direct = 3, Wind direct = 1, Residual load = 6
    const dp = [makeDataPoint(0, 10.0)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 3.0)];
    const wind = [makeWindInterval(at[0].timestampUtc, 1.0)];

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    const inv = result[0];

    expect(inv.solarDirectToLoadKwh).toBe(3.0);
    expect(inv.windDirectToLoadKwh).toBe(1.0);
    expect(inv.totalRenewableDirectToLoadKwh).toBe(4.0);

    expect(inv.residualHomeLoadKwh).toBe(6.0);
    expect(inv.surplusSolarKwh).toBe(0.0);
    expect(inv.surplusWindKwh).toBe(0.0);
    expect(inv.totalRenewableSurplusKwh).toBe(0.0);
  });

  // 6. Mixed solar + wind above load
  it('6. mixed solar + wind above load allocates direct load and surplus proportionally', () => {
    // Load = 4, Solar = 6, Wind = 2 -> Total Gen = 8 > 4
    // Solar share = 6/8 = 75%, Wind share = 2/8 = 25%
    // Total direct = 4 -> Solar direct = 3, Wind direct = 1
    // Solar surplus = 6 - 3 = 3, Wind surplus = 2 - 1 = 1, Total surplus = 4
    const dp = [makeDataPoint(0, 4.0)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 6.0)];
    const wind = [makeWindInterval(at[0].timestampUtc, 2.0)];

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    const inv = result[0];

    expect(inv.solarDirectToLoadKwh).toBe(3.0);
    expect(inv.windDirectToLoadKwh).toBe(1.0);
    expect(inv.totalRenewableDirectToLoadKwh).toBe(4.0);

    expect(inv.residualHomeLoadKwh).toBe(0.0);
    expect(inv.surplusSolarKwh).toBe(3.0);
    expect(inv.surplusWindKwh).toBe(1.0);
    expect(inv.totalRenewableSurplusKwh).toBe(4.0);
  });

  // 7. Exact proportional direct-load allocation
  it('7. exact proportional direct-load allocation with arbitrary fractional values', () => {
    // Load = 5.5, Solar = 3.3, Wind = 7.7 -> Total Gen = 11.0
    // Solar share = 3.3 / 11.0 = 0.3 (30%)
    // Wind share  = 7.7 / 11.0 = 0.7 (70%)
    // Total direct = 5.5
    // Solar direct = 5.5 * 0.3 = 1.65
    // Wind direct  = 5.5 * 0.7 = 3.85
    // Solar surplus = 3.3 - 1.65 = 1.65
    // Wind surplus  = 7.7 - 3.85 = 3.85
    const dp = [makeDataPoint(0, 5.5)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 3.3)];
    const wind = [makeWindInterval(at[0].timestampUtc, 7.7)];

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    const inv = result[0];

    expect(inv.solarDirectToLoadKwh).toBeCloseTo(1.65, 10);
    expect(inv.windDirectToLoadKwh).toBeCloseTo(3.85, 10);
    expect(inv.totalRenewableDirectToLoadKwh).toBeCloseTo(5.5, 10);

    expect(inv.residualHomeLoadKwh).toBe(0.0);
    expect(inv.surplusSolarKwh).toBeCloseTo(1.65, 10);
    expect(inv.surplusWindKwh).toBeCloseTo(3.85, 10);
    expect(inv.totalRenewableSurplusKwh).toBeCloseTo(5.5, 10);

    // Exact reconciliation
    expect(inv.solarDirectToLoadKwh + inv.surplusSolarKwh).toBeCloseTo(inv.solarGenerationKwh, 10);
    expect(inv.windDirectToLoadKwh + inv.surplusWindKwh).toBeCloseTo(inv.windGenerationKwh, 10);
  });

  // 8. Zero-generation interval
  it('8. zero-generation interval preserves entire load as residual without surplus', () => {
    const dp = [makeDataPoint(0, 3.5)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 0.0)];
    const wind = [makeWindInterval(at[0].timestampUtc, 0.0)];

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    const inv = result[0];

    expect(inv.totalRenewableGenerationKwh).toBe(0.0);
    expect(inv.solarDirectToLoadKwh).toBe(0.0);
    expect(inv.windDirectToLoadKwh).toBe(0.0);
    expect(inv.totalRenewableDirectToLoadKwh).toBe(0.0);
    expect(inv.residualHomeLoadKwh).toBe(3.5);
    expect(inv.surplusSolarKwh).toBe(0.0);
    expect(inv.surplusWindKwh).toBe(0.0);
    expect(inv.totalRenewableSurplusKwh).toBe(0.0);
  });

  // 9. Zero-load interval
  it('9. zero-load interval routes all generation into surplus', () => {
    const dp = [makeDataPoint(0, 0.0)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 4.0)];
    const wind = [makeWindInterval(at[0].timestampUtc, 2.0)];

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    const inv = result[0];

    expect(inv.homeLoadKwh).toBe(0.0);
    expect(inv.solarDirectToLoadKwh).toBe(0.0);
    expect(inv.windDirectToLoadKwh).toBe(0.0);
    expect(inv.totalRenewableDirectToLoadKwh).toBe(0.0);
    expect(inv.residualHomeLoadKwh).toBe(0.0);
    expect(inv.surplusSolarKwh).toBe(4.0);
    expect(inv.surplusWindKwh).toBe(2.0);
    expect(inv.totalRenewableSurplusKwh).toBe(6.0);
  });

  // 10. Sub-hourly intervals remain energy-consistent
  it('10. sub-hourly intervals remain energy-consistent across 15-minute intervals', () => {
    const count = 4;
    const dp = Array.from({ length: count }, (_, i) =>
      makeDataPoint(i, 0.5, `2025-06-15 12:${String(i * 15).padStart(2, '0')}`)
    );
    const at = Array.from({ length: count }, (_, i) =>
      makeAlignedTimestamp(
        i,
        dp[i].timestamp,
        `2025-06-15T12:${String(i * 15).padStart(2, '0')}:00.000Z`
      )
    );
    const solar = Array.from({ length: count }, (_, i) =>
      makeSolarInterval(at[i].timestampUtc, 0.8 + i * 0.1)
    );
    const wind = Array.from({ length: count }, (_, i) =>
      makeWindInterval(at[i].timestampUtc, 0.2 + i * 0.05)
    );

    const result = calculateRenewableLoadFlow(dp, at, solar, wind);
    expect(result).toHaveLength(4);

    for (let i = 0; i < count; i++) {
      const inv = result[i];
      expect(inv.solarDirectToLoadKwh + inv.surplusSolarKwh).toBeCloseTo(
        inv.solarGenerationKwh,
        10
      );
      expect(inv.windDirectToLoadKwh + inv.surplusWindKwh).toBeCloseTo(
        inv.windGenerationKwh,
        10
      );
      expect(
        inv.totalRenewableDirectToLoadKwh + inv.totalRenewableSurplusKwh
      ).toBeCloseTo(inv.totalRenewableGenerationKwh, 10);
      expect(
        inv.totalRenewableDirectToLoadKwh + inv.residualHomeLoadKwh
      ).toBeCloseTo(inv.homeLoadKwh, 10);
    }
  });

  // 11. Timestamp mismatch rejected
  it('11. rejects timestamp or length mismatches explicitly', () => {
    const dp = [makeDataPoint(0, 1.0)];
    const at = [makeAlignedTimestamp(0)];
    const solar = [makeSolarInterval(at[0].timestampUtc, 2.0)];
    const wind = [makeWindInterval(at[0].timestampUtc, 1.0)];

    // Mismatched length
    expect(() => calculateRenewableLoadFlow(dp, at, solar, [])).toThrow(
      /Input arrays must have non-zero length/
    );
    expect(() =>
      calculateRenewableLoadFlow(dp, at, solar, [
        wind[0],
        makeWindInterval('2025-06-15T01:00:00.000Z', 1.0),
      ])
    ).toThrow(/identical length/);

    // Mismatched timestampUtc
    const mismatchedWind = [
      makeWindInterval('2025-06-15T05:00:00.000Z', 1.0),
    ];
    expect(() =>
      calculateRenewableLoadFlow(dp, at, solar, mismatchedWind)
    ).toThrow(/timestampUtc/);

    // Mismatched sourceIndex
    const mismatchedAt = [{ ...at[0], sourceIndex: 99 }];
    expect(() =>
      calculateRenewableLoadFlow(dp, mismatchedAt, solar, wind)
    ).toThrow(/sourceIndex/);

    // Negative load
    const negDp = [{ ...dp[0], usageKwh: -1.0 }];
    expect(() =>
      calculateRenewableLoadFlow(negDp, at, solar, wind)
    ).toThrow(/usageKwh/);
  });

  // 12. Inputs not mutated
  it('12. inputs are strictly preserved without mutation', () => {
    const dp = [makeDataPoint(0, 5.0), makeDataPoint(1, 3.0)];
    const at = [makeAlignedTimestamp(0), makeAlignedTimestamp(1)];
    const solar = [
      makeSolarInterval(at[0].timestampUtc, 4.0),
      makeSolarInterval(at[1].timestampUtc, 1.0),
    ];
    const wind = [
      makeWindInterval(at[0].timestampUtc, 2.0),
      makeWindInterval(at[1].timestampUtc, 3.0),
    ];

    const dpSnapshot = dp.map((p) => ({ ...p, date: new Date(p.date.getTime()) }));
    const atSnapshot = at.map((a) => ({
      ...a,
      instantUtc: new Date(a.instantUtc.getTime()),
    }));
    const solarSnapshot = JSON.parse(JSON.stringify(solar));
    const windSnapshot = JSON.parse(JSON.stringify(wind));

    calculateRenewableLoadFlow(dp, at, solar, wind);

    expect(dp).toEqual(dpSnapshot);
    expect(at).toEqual(atSnapshot);
    expect(solar).toEqual(solarSnapshot);
    expect(wind).toEqual(windSnapshot);
  });

  // Summary calculation test
  it('summarizeRenewableLoadFlow computes self-consumption and load coverage percentages', () => {
    const dp = [makeDataPoint(0, 10.0), makeDataPoint(1, 10.0)];
    const at = [makeAlignedTimestamp(0), makeAlignedTimestamp(1)];
    const solar = [
      makeSolarInterval(at[0].timestampUtc, 4.0),
      makeSolarInterval(at[1].timestampUtc, 6.0),
    ];
    const wind = [
      makeWindInterval(at[0].timestampUtc, 2.0),
      makeWindInterval(at[1].timestampUtc, 2.0),
    ];

    const intervals = calculateRenewableLoadFlow(dp, at, solar, wind);
    const summary = summarizeRenewableLoadFlow(intervals);

    expect(summary.totalHomeLoadKwh).toBe(20.0);
    expect(summary.totalSolarGenerationKwh).toBe(10.0);
    expect(summary.totalWindGenerationKwh).toBe(4.0);
    expect(summary.totalRenewableGenerationKwh).toBe(14.0);

    // All 14 kWh generation was consumed directly because 4+2=6 < 10 and 6+2=8 < 10
    expect(summary.totalSolarDirectToLoadKwh).toBe(10.0);
    expect(summary.totalWindDirectToLoadKwh).toBe(4.0);
    expect(summary.totalRenewableDirectToLoadKwh).toBe(14.0);

    expect(summary.solarSelfConsumptionPercent).toBe(100.0);
    expect(summary.windSelfConsumptionPercent).toBe(100.0);
    expect(summary.renewableSelfConsumptionPercent).toBe(100.0);

    expect(summary.solarLoadCoveragePercent).toBe(50.0);
    expect(summary.windLoadCoveragePercent).toBe(20.0);
    expect(summary.renewableLoadCoveragePercent).toBe(70.0);
  });
});
