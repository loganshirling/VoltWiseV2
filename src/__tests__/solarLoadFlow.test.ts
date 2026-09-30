import { describe, it, expect } from 'vitest';
import {
  calculateSolarLoadFlow,
  summarizeSolarLoadFlow,
} from '../utils/solarLoadFlow';
import {
  IntervalDataPoint,
  SolarFleetGenerationInterval,
  SolarLoadFlowInterval,
} from '../types/energy';
import { AlignedLoadTimestamp } from '../utils/loadTimeAlignment';

function createMockPoint(
  timestamp: string,
  usageKwh: number
): IntervalDataPoint {
  return {
    timestamp,
    date: new Date(1700000000000),
    hour: 12,
    dayOfWeek: 1,
    month: 5,
    usageKwh,
  };
}

function createMockAligned(
  sourceIndex: number,
  sourceTimestamp: string,
  timestampUtc: string
): AlignedLoadTimestamp {
  return {
    sourceIndex,
    sourceTimestamp,
    instantUtc: new Date(timestampUtc),
    timestampUtc,
  };
}

function createMockSolar(
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

describe('G3A — Solar-to-Load Energy Flow Kernel', () => {
  describe('A. Solar smaller than load', () => {
    it('routes all solar to load, leaving residual load and zero surplus', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', 5)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', 2)];

      const [res] = calculateSolarLoadFlow(dataPoints, aligned, solar);

      expect(res.homeLoadKwh).toBe(5);
      expect(res.solarGenerationKwh).toBe(2);
      expect(res.solarDirectToLoadKwh).toBe(2);
      expect(res.residualHomeLoadKwh).toBe(3);
      expect(res.surplusSolarKwh).toBe(0);
    });
  });

  describe('B. Solar greater than load', () => {
    it('covers all load, leaving zero residual load and surplus solar', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', 2)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', 5)];

      const [res] = calculateSolarLoadFlow(dataPoints, aligned, solar);

      expect(res.homeLoadKwh).toBe(2);
      expect(res.solarGenerationKwh).toBe(5);
      expect(res.solarDirectToLoadKwh).toBe(2);
      expect(res.residualHomeLoadKwh).toBe(0);
      expect(res.surplusSolarKwh).toBe(3);
    });
  });

  describe('C. Exact match', () => {
    it('matches load and solar exactly with zero residual and zero surplus', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', 4)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', 4)];

      const [res] = calculateSolarLoadFlow(dataPoints, aligned, solar);

      expect(res.homeLoadKwh).toBe(4);
      expect(res.solarGenerationKwh).toBe(4);
      expect(res.solarDirectToLoadKwh).toBe(4);
      expect(res.residualHomeLoadKwh).toBe(0);
      expect(res.surplusSolarKwh).toBe(0);
    });
  });

  describe('D. Zero solar', () => {
    it('preserves residual load exactly equal to original load when solar generation is zero', () => {
      const dataPoints = [createMockPoint('2026-06-01 02:00', 3.5)];
      const aligned = [
        createMockAligned(0, '2026-06-01 02:00', '2026-06-01T06:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T06:00:00.000Z', 0)];

      const [res] = calculateSolarLoadFlow(dataPoints, aligned, solar);

      expect(res.homeLoadKwh).toBe(3.5);
      expect(res.solarGenerationKwh).toBe(0);
      expect(res.solarDirectToLoadKwh).toBe(0);
      expect(res.residualHomeLoadKwh).toBe(3.5);
      expect(res.surplusSolarKwh).toBe(0);
    });
  });

  describe('E. Zero load', () => {
    it('routes all solar to surplus when household demand is zero', () => {
      const dataPoints = [createMockPoint('2026-06-01 13:00', 0)];
      const aligned = [
        createMockAligned(0, '2026-06-01 13:00', '2026-06-01T17:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T17:00:00.000Z', 6.2)];

      const [res] = calculateSolarLoadFlow(dataPoints, aligned, solar);

      expect(res.homeLoadKwh).toBe(0);
      expect(res.solarGenerationKwh).toBe(6.2);
      expect(res.solarDirectToLoadKwh).toBe(0);
      expect(res.residualHomeLoadKwh).toBe(0);
      expect(res.surplusSolarKwh).toBe(6.2);
    });
  });

  describe('F. Multi-interval conservation', () => {
    it('satisfies conservation invariants for every interval across mixed scenarios', () => {
      const timestamps = [
        { local: '2026-06-01 08:00', utc: '2026-06-01T12:00:00.000Z', load: 1.5, solar: 0.8 },
        { local: '2026-06-01 09:00', utc: '2026-06-01T13:00:00.000Z', load: 2.0, solar: 3.5 },
        { local: '2026-06-01 10:00', utc: '2026-06-01T14:00:00.000Z', load: 4.0, solar: 4.0 },
        { local: '2026-06-01 11:00', utc: '2026-06-01T15:00:00.000Z', load: 0.0, solar: 5.2 },
        { local: '2026-06-01 12:00', utc: '2026-06-01T16:00:00.000Z', load: 3.8, solar: 0.0 },
      ];

      const dataPoints = timestamps.map((t) => createMockPoint(t.local, t.load));
      const aligned = timestamps.map((t, idx) =>
        createMockAligned(idx, t.local, t.utc)
      );
      const solar = timestamps.map((t) => createMockSolar(t.utc, t.solar));

      const results = calculateSolarLoadFlow(dataPoints, aligned, solar);

      expect(results).toHaveLength(5);

      for (let i = 0; i < results.length; i++) {
        const inv = results[i];
        expect(inv.sourceIndex).toBe(i);
        expect(inv.sourceTimestamp).toBe(timestamps[i].local);
        expect(inv.timestampUtc).toBe(timestamps[i].utc);

        // Conservation Invariant 1: homeLoad = direct + residual
        expect(inv.solarDirectToLoadKwh + inv.residualHomeLoadKwh).toBeCloseTo(
          inv.homeLoadKwh,
          10
        );

        // Conservation Invariant 2: solarGeneration = direct + surplus
        expect(inv.solarDirectToLoadKwh + inv.surplusSolarKwh).toBeCloseTo(
          inv.solarGenerationKwh,
          10
        );

        // Non-negativity
        expect(inv.solarDirectToLoadKwh).toBeGreaterThanOrEqual(0);
        expect(inv.residualHomeLoadKwh).toBeGreaterThanOrEqual(0);
        expect(inv.surplusSolarKwh).toBeGreaterThanOrEqual(0);
      }
    });
  });

  describe('G. Summary reconciliation', () => {
    it('independently sums interval values and computes self-consumption and load coverage', () => {
      const intervals: SolarLoadFlowInterval[] = [
        {
          sourceIndex: 0,
          sourceTimestamp: '2026-06-01 08:00',
          timestampUtc: '2026-06-01T12:00:00.000Z',
          homeLoadKwh: 1.5,
          solarGenerationKwh: 0.8,
          solarDirectToLoadKwh: 0.8,
          residualHomeLoadKwh: 0.7,
          surplusSolarKwh: 0.0,
        },
        {
          sourceIndex: 1,
          sourceTimestamp: '2026-06-01 09:00',
          timestampUtc: '2026-06-01T13:00:00.000Z',
          homeLoadKwh: 2.0,
          solarGenerationKwh: 3.5,
          solarDirectToLoadKwh: 2.0,
          residualHomeLoadKwh: 0.0,
          surplusSolarKwh: 1.5,
        },
        {
          sourceIndex: 2,
          sourceTimestamp: '2026-06-01 10:00',
          timestampUtc: '2026-06-01T14:00:00.000Z',
          homeLoadKwh: 4.0,
          solarGenerationKwh: 4.0,
          solarDirectToLoadKwh: 4.0,
          residualHomeLoadKwh: 0.0,
          surplusSolarKwh: 0.0,
        },
      ];

      const summary = summarizeSolarLoadFlow(intervals);

      expect(summary.intervalCount).toBe(3);
      expect(summary.totalHomeLoadKwh).toBeCloseTo(1.5 + 2.0 + 4.0, 10);
      expect(summary.totalSolarGenerationKwh).toBeCloseTo(0.8 + 3.5 + 4.0, 10);
      expect(summary.totalSolarDirectToLoadKwh).toBeCloseTo(0.8 + 2.0 + 4.0, 10);
      expect(summary.totalResidualHomeLoadKwh).toBeCloseTo(0.7 + 0.0 + 0.0, 10);
      expect(summary.totalSurplusSolarKwh).toBeCloseTo(0.0 + 1.5 + 0.0, 10);

      // Percentage assertions
      // solarSelfConsumption = 6.8 / 8.3 * 100
      const expectedSelfConsumption = (6.8 / 8.3) * 100;
      expect(summary.solarSelfConsumptionPercent).toBeCloseTo(expectedSelfConsumption, 10);

      // solarLoadCoverage = 6.8 / 7.5 * 100
      const expectedCoverage = (6.8 / 7.5) * 100;
      expect(summary.solarLoadCoveragePercent).toBeCloseTo(expectedCoverage, 10);
    });

    it('handles zero solar generation without division by zero', () => {
      const intervals: SolarLoadFlowInterval[] = [
        {
          sourceIndex: 0,
          sourceTimestamp: '2026-06-01 02:00',
          timestampUtc: '2026-06-01T06:00:00.000Z',
          homeLoadKwh: 2.0,
          solarGenerationKwh: 0.0,
          solarDirectToLoadKwh: 0.0,
          residualHomeLoadKwh: 2.0,
          surplusSolarKwh: 0.0,
        },
      ];

      const summary = summarizeSolarLoadFlow(intervals);
      expect(summary.totalSolarGenerationKwh).toBe(0);
      expect(summary.solarSelfConsumptionPercent).toBe(0);
      expect(summary.solarLoadCoveragePercent).toBe(0);
    });

    it('handles zero home load without division by zero', () => {
      const intervals: SolarLoadFlowInterval[] = [
        {
          sourceIndex: 0,
          sourceTimestamp: '2026-06-01 12:00',
          timestampUtc: '2026-06-01T16:00:00.000Z',
          homeLoadKwh: 0.0,
          solarGenerationKwh: 5.0,
          solarDirectToLoadKwh: 0.0,
          residualHomeLoadKwh: 0.0,
          surplusSolarKwh: 5.0,
        },
      ];

      const summary = summarizeSolarLoadFlow(intervals);
      expect(summary.totalHomeLoadKwh).toBe(0);
      expect(summary.solarLoadCoveragePercent).toBe(0);
      expect(summary.solarSelfConsumptionPercent).toBe(0);
    });
  });

  describe('H. Timestamp mismatch', () => {
    it('rejects when solar timestampUtc does not match aligned timestampUtc', () => {
      const dataPoints = [
        createMockPoint('2026-06-01 12:00', 2),
        createMockPoint('2026-06-01 13:00', 3),
      ];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
        createMockAligned(1, '2026-06-01 13:00', '2026-06-01T17:00:00.000Z'),
      ];
      const solar = [
        createMockSolar('2026-06-01T16:00:00.000Z', 2),
        createMockSolar('2026-06-01T18:00:00.000Z', 3), // Mismatch at index 1
      ];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/does not match solar profile timestampUtc/i);
    });
  });

  describe('I. Source-index mismatch', () => {
    it('rejects when aligned timestamp sourceIndex does not equal array index', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', 2)];
      const aligned = [
        createMockAligned(5, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'), // Expected 0
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', 2)];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/mismatched sourceIndex/i);
    });
  });

  describe('J. Source timestamp mismatch', () => {
    it('rejects when aligned sourceTimestamp differs from dataPoint timestamp', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', 2)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:30', '2026-06-01T16:00:00.000Z'), // Mismatch
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', 2)];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/does not match data point timestamp/i);
    });
  });

  describe('K. Length mismatch', () => {
    it('rejects mismatched array lengths', () => {
      const dataPoints = [
        createMockPoint('2026-06-01 12:00', 2),
        createMockPoint('2026-06-01 13:00', 3),
      ];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [
        createMockSolar('2026-06-01T16:00:00.000Z', 2),
        createMockSolar('2026-06-01T17:00:00.000Z', 3),
      ];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/identical length/i);
    });

    it('rejects zero-length arrays', () => {
      expect(() => {
        calculateSolarLoadFlow([], [], []);
      }).toThrow(/non-zero length/i);
    });
  });

  describe('L. Invalid load energy', () => {
    it('rejects negative load energy', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', -1)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', 2)];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/Invalid usageKwh/i);
    });

    it('rejects NaN load energy', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', NaN)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', 2)];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/Invalid usageKwh/i);
    });

    it('rejects Infinity load energy', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', Infinity)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', 2)];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/Invalid usageKwh/i);
    });
  });

  describe('M. Invalid solar energy', () => {
    it('rejects negative solar energy', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', 2)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', -0.5)];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/Invalid totalAcEnergyKwh/i);
    });

    it('rejects NaN solar energy', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', 2)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', NaN)];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/Invalid totalAcEnergyKwh/i);
    });

    it('rejects Infinity solar energy', () => {
      const dataPoints = [createMockPoint('2026-06-01 12:00', 2)];
      const aligned = [
        createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z'),
      ];
      const solar = [createMockSolar('2026-06-01T16:00:00.000Z', Infinity)];

      expect(() => {
        calculateSolarLoadFlow(dataPoints, aligned, solar);
      }).toThrow(/Invalid totalAcEnergyKwh/i);
    });
  });

  describe('N. Input immutability', () => {
    it('proves none of the three input arrays or their objects are mutated', () => {
      const dp = createMockPoint('2026-06-01 12:00', 3.0);
      const al = createMockAligned(0, '2026-06-01 12:00', '2026-06-01T16:00:00.000Z');
      const sol = createMockSolar('2026-06-01T16:00:00.000Z', 4.5);

      const dataPoints = [dp];
      const aligned = [al];
      const solar = [sol];

      // Deep freeze inputs
      Object.freeze(dp);
      Object.freeze(al);
      Object.freeze(sol);
      Object.freeze(dataPoints);
      Object.freeze(aligned);
      Object.freeze(solar);

      const result = calculateSolarLoadFlow(dataPoints, aligned, solar);

      expect(result).toHaveLength(1);
      expect(result[0].solarDirectToLoadKwh).toBe(3.0);
      expect(result[0].surplusSolarKwh).toBe(1.5);
      expect(result[0].residualHomeLoadKwh).toBe(0.0);

      // Verify identities and values
      expect(dataPoints[0].usageKwh).toBe(3.0);
      expect(solar[0].totalAcEnergyKwh).toBe(4.5);
      expect(aligned[0].sourceIndex).toBe(0);
    });
  });
});
