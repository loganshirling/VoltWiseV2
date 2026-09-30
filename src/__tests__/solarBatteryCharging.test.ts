import { describe, it, expect } from 'vitest';
import {
  routeSurplusSolarToBattery,
  calculateUsableCapacityKwh,
  calculateChargeEfficiency,
} from '../utils/solarBatteryCharging';
import {
  BatteryProfile,
  BatterySocProvenanceState,
  SolarLoadFlowInterval,
} from '../types/energy';

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
    roundTripEfficiencyPercent: 90,
    ratedCycleLife: 4000,
    installedCost: 10000,
    strategy: 'arbitrage',
    chargeTiers: ['off-peak'],
    dischargeTiers: ['on-peak'],
    ...overrides,
  };
}

function createMockFlowInterval(
  overrides: Partial<SolarLoadFlowInterval> = {}
): SolarLoadFlowInterval {
  return {
    sourceIndex: 0,
    sourceTimestamp: '2026-06-01 12:00',
    timestampUtc: '2026-06-01T16:00:00.000Z',
    homeLoadKwh: 1.0,
    solarGenerationKwh: 4.0,
    solarDirectToLoadKwh: 1.0,
    residualHomeLoadKwh: 0.0,
    surplusSolarKwh: 3.0,
    ...overrides,
  };
}

function createEmptyInitialState(
  overrides: Partial<BatterySocProvenanceState> = {}
): BatterySocProvenanceState {
  return {
    syntheticSocKwh: 0,
    gridChargedSocKwh: 0,
    renewableChargedSocKwh: 0,
    generatorChargedSocKwh: 0,
    ...overrides,
  };
}

describe('G3B — Surplus Solar → Battery Charging', () => {
  describe('A. Basic renewable charge', () => {
    it('charges battery when room and surplus solar exist', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 90,
      });
      const initialState = createEmptyInitialState();
      const interval = createMockFlowInterval({ surplusSolarKwh: 3.0 });

      const result = routeSurplusSolarToBattery(
        [interval],
        1,
        profile,
        initialState
      );

      expect(result.intervals).toHaveLength(1);
      const inv = result.intervals[0];

      expect(inv.solarToBatteryAcKwh).toBe(3.0);
      expect(inv.renewableEnergyStoredKwh).toBeGreaterThan(0);
      expect(inv.remainingSurplusSolarKwh).toBe(0);
      expect(inv.batterySocAfterKwh).toBeGreaterThan(inv.batterySocBeforeKwh);
      expect(inv.renewableSocAfterKwh).toBeGreaterThan(inv.renewableSocBeforeKwh);

      expect(result.finalState.renewableChargedSocKwh).toBe(
        inv.renewableEnergyStoredKwh
      );
    });
  });

  describe('B. Charge efficiency', () => {
    it('applies square root of round-trip efficiency during charging', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 90,
      });
      const initialState = createEmptyInitialState();
      const interval = createMockFlowInterval({ surplusSolarKwh: 2.0 });

      const etaExpected = Math.sqrt(0.9);
      expect(calculateChargeEfficiency(profile)).toBeCloseTo(etaExpected, 10);

      const result = routeSurplusSolarToBattery(
        [interval],
        1,
        profile,
        initialState
      );

      const inv = result.intervals[0];
      expect(inv.renewableEnergyStoredKwh).toBeCloseTo(
        inv.solarToBatteryAcKwh * etaExpected,
        10
      );
    });
  });

  describe('C. Charge-power limit', () => {
    it('caps solar AC charge rate at maxContinuousChargeKw * intervalHours', () => {
      const profile = createMockBatteryProfile({
        maxContinuousChargeKw: 2.0,
        totalCapacityKwh: 20.0,
      });
      const initialState = createEmptyInitialState();
      const interval = createMockFlowInterval({ surplusSolarKwh: 10.0 });

      const result = routeSurplusSolarToBattery(
        [interval],
        1,
        profile,
        initialState
      );

      const inv = result.intervals[0];
      expect(inv.solarToBatteryAcKwh).toBe(2.0);
      expect(inv.remainingSurplusSolarKwh).toBe(8.0);
    });
  });

  describe('D. Sub-hourly charge-power limit', () => {
    it('scales charge energy correctly for sub-hourly intervals (e.g. 0.25h)', () => {
      const profile = createMockBatteryProfile({
        maxContinuousChargeKw: 4.0,
        totalCapacityKwh: 20.0,
      });
      const initialState = createEmptyInitialState();
      const interval = createMockFlowInterval({ surplusSolarKwh: 10.0 });

      // 4 kW * 0.25 h = 1.0 kWh max AC charge
      const result = routeSurplusSolarToBattery(
        [interval],
        0.25,
        profile,
        initialState
      );

      const inv = result.intervals[0];
      expect(inv.solarToBatteryAcKwh).toBe(1.0);
      expect(inv.remainingSurplusSolarKwh).toBe(9.0);
    });
  });

  describe('E. Capacity limit', () => {
    it('stops charging exactly at usable capacity after efficiency accounting', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10.0,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5.0,
        roundTripEfficiencyPercent: 90,
      });
      // Start with 9.5 kWh stored, so remaining room is exactly 0.5 kWh
      const initialState = createEmptyInitialState({
        renewableChargedSocKwh: 9.5,
      });
      const interval = createMockFlowInterval({ surplusSolarKwh: 5.0 });

      const eta = Math.sqrt(0.9);
      const expectedAcFor0_5Kwh = 0.5 / eta;

      const result = routeSurplusSolarToBattery(
        [interval],
        1,
        profile,
        initialState
      );

      const inv = result.intervals[0];
      expect(inv.solarToBatteryAcKwh).toBeCloseTo(expectedAcFor0_5Kwh, 10);
      expect(inv.renewableEnergyStoredKwh).toBeCloseTo(0.5, 10);
      expect(inv.batterySocAfterKwh).toBeCloseTo(10.0, 10);
      expect(inv.remainingSurplusSolarKwh).toBeCloseTo(
        5.0 - expectedAcFor0_5Kwh,
        10
      );
    });
  });

  describe('F. Full battery', () => {
    it('does not charge when battery is already at usable capacity', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10.0,
        usableDodPercent: 100,
      });
      const initialState = createEmptyInitialState({
        renewableChargedSocKwh: 10.0,
      });
      const interval = createMockFlowInterval({ surplusSolarKwh: 4.0 });

      const result = routeSurplusSolarToBattery(
        [interval],
        1,
        profile,
        initialState
      );

      const inv = result.intervals[0];
      expect(inv.solarToBatteryAcKwh).toBe(0);
      expect(inv.renewableEnergyStoredKwh).toBe(0);
      expect(inv.remainingSurplusSolarKwh).toBe(4.0);
      expect(inv.batterySocAfterKwh).toBe(10.0);
      expect(result.finalState.renewableChargedSocKwh).toBe(10.0);
    });
  });

  describe('G. Zero surplus', () => {
    it('leaves battery state unchanged when surplus solar is zero', () => {
      const profile = createMockBatteryProfile();
      const initialState = createEmptyInitialState({
        renewableChargedSocKwh: 4.0,
      });
      const interval = createMockFlowInterval({ surplusSolarKwh: 0.0 });

      const result = routeSurplusSolarToBattery(
        [interval],
        1,
        profile,
        initialState
      );

      const inv = result.intervals[0];
      expect(inv.solarToBatteryAcKwh).toBe(0);
      expect(inv.renewableEnergyStoredKwh).toBe(0);
      expect(inv.remainingSurplusSolarKwh).toBe(0);
      expect(inv.batterySocAfterKwh).toBe(4.0);
      expect(inv.batterySocBeforeKwh).toBe(4.0);
    });
  });

  describe('H. TOU charge tiers ignored', () => {
    it('charges from surplus solar even when profile chargeTiers is empty', () => {
      const profile = createMockBatteryProfile({
        chargeTiers: [], // No grid charge tiers
        totalCapacityKwh: 10,
      });
      const initialState = createEmptyInitialState();
      const interval = createMockFlowInterval({ surplusSolarKwh: 3.0 });

      const result = routeSurplusSolarToBattery(
        [interval],
        1,
        profile,
        initialState
      );

      expect(result.intervals[0].solarToBatteryAcKwh).toBe(3.0);
      expect(result.intervals[0].renewableEnergyStoredKwh).toBeGreaterThan(0);
    });
  });

  describe('I. Strategy does not block renewable charging', () => {
    it('produces identical charging behavior for arbitrage and self_consumption', () => {
      const profileArb = createMockBatteryProfile({ strategy: 'arbitrage' });
      const profileSelf = createMockBatteryProfile({
        strategy: 'self_consumption',
      });
      const initialState = createEmptyInitialState({
        renewableChargedSocKwh: 2.0,
      });
      const interval = createMockFlowInterval({ surplusSolarKwh: 3.5 });

      const resArb = routeSurplusSolarToBattery(
        [interval],
        1,
        profileArb,
        initialState
      );
      const resSelf = routeSurplusSolarToBattery(
        [interval],
        1,
        profileSelf,
        initialState
      );

      expect(resArb.intervals[0].solarToBatteryAcKwh).toBe(
        resSelf.intervals[0].solarToBatteryAcKwh
      );
      expect(resArb.intervals[0].renewableEnergyStoredKwh).toBe(
        resSelf.intervals[0].renewableEnergyStoredKwh
      );
      expect(resArb.finalState.renewableChargedSocKwh).toBe(
        resSelf.finalState.renewableChargedSocKwh
      );
    });
  });

  describe('J. Provenance isolation', () => {
    it('never modifies synthetic, grid, or generator SOC; only renewable SOC increases', () => {
      const profile = createMockBatteryProfile({ totalCapacityKwh: 10.0 });
      const initialState: BatterySocProvenanceState = {
        syntheticSocKwh: 2.0,
        gridChargedSocKwh: 3.0,
        renewableChargedSocKwh: 1.0,
        generatorChargedSocKwh: 0.5,
      };
      // Total initial SOC = 6.5 kWh, room = 3.5 kWh
      const interval = createMockFlowInterval({ surplusSolarKwh: 2.0 });

      const result = routeSurplusSolarToBattery(
        [interval],
        1,
        profile,
        initialState
      );

      expect(result.finalState.syntheticSocKwh).toBe(2.0);
      expect(result.finalState.gridChargedSocKwh).toBe(3.0);
      expect(result.finalState.generatorChargedSocKwh).toBe(0.5);
      expect(result.finalState.renewableChargedSocKwh).toBeGreaterThan(1.0);
    });
  });

  describe('K. Sequential filling', () => {
    it('chains battery SOC sequentially across intervals and stops when full', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 5.0,
        usableDodPercent: 100,
        maxContinuousChargeKw: 3.0,
        roundTripEfficiencyPercent: 100, // 100% RTE to simplify exact addition
      });
      const initialState = createEmptyInitialState();

      const intervals = [
        createMockFlowInterval({ sourceIndex: 0, surplusSolarKwh: 2.0 }),
        createMockFlowInterval({ sourceIndex: 1, surplusSolarKwh: 2.0 }),
        createMockFlowInterval({ sourceIndex: 2, surplusSolarKwh: 2.0 }),
      ];

      const result = routeSurplusSolarToBattery(
        intervals,
        1,
        profile,
        initialState
      );

      expect(result.intervals).toHaveLength(3);

      // Interval 0: 0 -> 2
      expect(result.intervals[0].batterySocBeforeKwh).toBe(0);
      expect(result.intervals[0].solarToBatteryAcKwh).toBe(2);
      expect(result.intervals[0].batterySocAfterKwh).toBe(2);
      expect(result.intervals[0].remainingSurplusSolarKwh).toBe(0);

      // Interval 1: 2 -> 4
      expect(result.intervals[1].batterySocBeforeKwh).toBe(
        result.intervals[0].batterySocAfterKwh
      );
      expect(result.intervals[1].batterySocBeforeKwh).toBe(2);
      expect(result.intervals[1].solarToBatteryAcKwh).toBe(2);
      expect(result.intervals[1].batterySocAfterKwh).toBe(4);
      expect(result.intervals[1].remainingSurplusSolarKwh).toBe(0);

      // Interval 2: 4 -> 5 (capacity full, only 1 kWh room)
      expect(result.intervals[2].batterySocBeforeKwh).toBe(
        result.intervals[1].batterySocAfterKwh
      );
      expect(result.intervals[2].batterySocBeforeKwh).toBe(4);
      expect(result.intervals[2].solarToBatteryAcKwh).toBe(1);
      expect(result.intervals[2].batterySocAfterKwh).toBe(5);
      expect(result.intervals[2].remainingSurplusSolarKwh).toBe(1);

      expect(result.finalState.renewableChargedSocKwh).toBe(5);
    });
  });

  describe('L. Solar conservation', () => {
    it('conserves solar energy: available surplus = battery AC input + remaining surplus', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10.0,
        usableDodPercent: 100,
        maxContinuousChargeKw: 2.5,
        roundTripEfficiencyPercent: 88,
      });
      const initialState = createEmptyInitialState({
        renewableChargedSocKwh: 8.0,
      });

      const intervals = [
        createMockFlowInterval({ sourceIndex: 0, surplusSolarKwh: 1.5 }),
        createMockFlowInterval({ sourceIndex: 1, surplusSolarKwh: 3.5 }),
        createMockFlowInterval({ sourceIndex: 2, surplusSolarKwh: 4.0 }),
      ];

      const result = routeSurplusSolarToBattery(
        intervals,
        1,
        profile,
        initialState
      );

      for (let i = 0; i < result.intervals.length; i++) {
        const inv = result.intervals[i];
        expect(inv.surplusSolarAvailableKwh).toBeCloseTo(
          inv.solarToBatteryAcKwh + inv.remainingSurplusSolarKwh,
          10
        );
      }
    });
  });

  describe('M. Result totals', () => {
    it('independently reconciles summary totals with interval sums', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 15.0,
        maxContinuousChargeKw: 3.0,
        roundTripEfficiencyPercent: 92,
      });
      const initialState = createEmptyInitialState();

      const intervals = [
        createMockFlowInterval({ sourceIndex: 0, surplusSolarKwh: 2.0 }),
        createMockFlowInterval({ sourceIndex: 1, surplusSolarKwh: 4.0 }),
        createMockFlowInterval({ sourceIndex: 2, surplusSolarKwh: 1.0 }),
      ];

      const result = routeSurplusSolarToBattery(
        intervals,
        1,
        profile,
        initialState
      );

      let sumAc = 0;
      let sumStored = 0;
      let sumRemaining = 0;

      for (let i = 0; i < result.intervals.length; i++) {
        sumAc += result.intervals[i].solarToBatteryAcKwh;
        sumStored += result.intervals[i].renewableEnergyStoredKwh;
        sumRemaining += result.intervals[i].remainingSurplusSolarKwh;
      }

      expect(result.totalSolarToBatteryAcKwh).toBeCloseTo(sumAc, 10);
      expect(result.totalRenewableEnergyStoredKwh).toBeCloseTo(sumStored, 10);
      expect(result.totalRemainingSurplusSolarKwh).toBeCloseTo(sumRemaining, 10);
    });
  });

  describe('N. Invalid initial state', () => {
    const profile = createMockBatteryProfile({ totalCapacityKwh: 10 });

    it('rejects negative provenance values', () => {
      expect(() => {
        routeSurplusSolarToBattery(
          [createMockFlowInterval()],
          1,
          profile,
          createEmptyInitialState({ renewableChargedSocKwh: -0.5 })
        );
      }).toThrow(/Invalid initial state provenance/i);
    });

    it('rejects NaN provenance values', () => {
      expect(() => {
        routeSurplusSolarToBattery(
          [createMockFlowInterval()],
          1,
          profile,
          createEmptyInitialState({ syntheticSocKwh: NaN })
        );
      }).toThrow(/Invalid initial state provenance/i);
    });

    it('rejects Infinity provenance values', () => {
      expect(() => {
        routeSurplusSolarToBattery(
          [createMockFlowInterval()],
          1,
          profile,
          createEmptyInitialState({ gridChargedSocKwh: Infinity })
        );
      }).toThrow(/Invalid initial state provenance/i);
    });

    it('rejects initial total SOC exceeding usable capacity', () => {
      expect(() => {
        routeSurplusSolarToBattery(
          [createMockFlowInterval()],
          1,
          profile,
          createEmptyInitialState({
            syntheticSocKwh: 6,
            renewableChargedSocKwh: 5,
          }) // Total 11 kWh > 10 kWh
        );
      }).toThrow(/exceeds usable capacity/i);
    });
  });

  describe('O. Invalid battery parameters', () => {
    const initialState = createEmptyInitialState();
    const interval = [createMockFlowInterval()];

    it('rejects negative capacity', () => {
      const p = createMockBatteryProfile({ totalCapacityKwh: -5 });
      expect(() => {
        routeSurplusSolarToBattery(interval, 1, p, initialState);
      }).toThrow(/Invalid battery totalCapacityKwh/i);
    });

    it('rejects usableDodPercent out of [0, 100]', () => {
      const p1 = createMockBatteryProfile({ usableDodPercent: -1 });
      expect(() => {
        routeSurplusSolarToBattery(interval, 1, p1, initialState);
      }).toThrow(/Invalid battery usableDodPercent/i);

      const p2 = createMockBatteryProfile({ usableDodPercent: 105 });
      expect(() => {
        routeSurplusSolarToBattery(interval, 1, p2, initialState);
      }).toThrow(/Invalid battery usableDodPercent/i);
    });

    it('rejects negative max charge power', () => {
      const p = createMockBatteryProfile({ maxContinuousChargeKw: -2 });
      expect(() => {
        routeSurplusSolarToBattery(interval, 1, p, initialState);
      }).toThrow(/Invalid battery maxContinuousChargeKw/i);
    });

    it('rejects invalid round-trip efficiency', () => {
      const p1 = createMockBatteryProfile({ roundTripEfficiencyPercent: 0 });
      expect(() => {
        routeSurplusSolarToBattery(interval, 1, p1, initialState);
      }).toThrow(/Invalid battery roundTripEfficiencyPercent/i);

      const p2 = createMockBatteryProfile({ roundTripEfficiencyPercent: 120 });
      expect(() => {
        routeSurplusSolarToBattery(interval, 1, p2, initialState);
      }).toThrow(/Invalid battery roundTripEfficiencyPercent/i);
    });

    it('rejects non-positive intervalHours', () => {
      const p = createMockBatteryProfile();
      expect(() => {
        routeSurplusSolarToBattery(interval, 0, p, initialState);
      }).toThrow(/intervalHours must be a finite positive number/i);

      expect(() => {
        routeSurplusSolarToBattery(interval, -0.5, p, initialState);
      }).toThrow(/intervalHours must be a finite positive number/i);
    });
  });

  describe('P. Input immutability', () => {
    it('proves inputs and initial state are never mutated', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 90,
      });
      const initialState = createEmptyInitialState({
        syntheticSocKwh: 1.0,
        gridChargedSocKwh: 2.0,
        renewableChargedSocKwh: 0.5,
        generatorChargedSocKwh: 0.5,
      });
      const interval = createMockFlowInterval({ surplusSolarKwh: 3.0 });
      const intervals = [interval];

      Object.freeze(profile);
      Object.freeze(profile.chargeTiers);
      Object.freeze(profile.dischargeTiers);
      Object.freeze(initialState);
      Object.freeze(interval);
      Object.freeze(intervals);

      const result = routeSurplusSolarToBattery(
        intervals,
        1,
        profile,
        initialState
      );

      // Caller state untouched
      expect(initialState.syntheticSocKwh).toBe(1.0);
      expect(initialState.gridChargedSocKwh).toBe(2.0);
      expect(initialState.renewableChargedSocKwh).toBe(0.5);
      expect(initialState.generatorChargedSocKwh).toBe(0.5);

      // Interval untouched
      expect(interval.surplusSolarKwh).toBe(3.0);
      expect(interval.homeLoadKwh).toBe(1.0);

      // Output state is freshly allocated
      expect(result.initialState).not.toBe(initialState);
      expect(result.finalState).not.toBe(initialState);
      expect(result.finalState.renewableChargedSocKwh).toBeGreaterThan(0.5);
    });
  });
});
