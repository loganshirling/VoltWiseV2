import { describe, it, expect } from 'vitest';
import {
  dischargeBatteryToHomeLoad,
  calculateDischargeEfficiency,
} from '../utils/batteryDischarge';
import { BatteryProfile, BatterySocProvenanceState } from '../types/energy';

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

function createProvenanceState(
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

describe('G3C — Provenance-Aware Battery Discharge to Home Load', () => {
  describe('A. Basic discharge', () => {
    it('meets requested home load when battery has ample power and SOC', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 90,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 5.0,
      });

      const result = dischargeBatteryToHomeLoad(2.0, 1.0, profile, initialState);

      expect(result.requestedHomeLoadKwh).toBe(2.0);
      expect(result.batteryDeliveredToLoadKwh).toBe(2.0);
      expect(result.unmetHomeLoadKwh).toBe(0.0);
      expect(result.batterySocAfterKwh).toBeLessThan(result.batterySocBeforeKwh);
    });
  });

  describe('B. Discharge efficiency', () => {
    it('applies square-root discharge efficiency (stored = delivered / sqrt(rte))', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 90,
      });
      const etaDischarge = Math.sqrt(0.9);
      expect(calculateDischargeEfficiency(profile)).toBeCloseTo(etaDischarge, 10);

      const initialState = createProvenanceState({ syntheticSocKwh: 5.0 });
      const result = dischargeBatteryToHomeLoad(1.0, 1.0, profile, initialState);

      expect(result.batteryDeliveredToLoadKwh).toBe(1.0);
      expect(result.storedEnergyDrainedKwh).toBeCloseTo(1.0 / etaDischarge, 10);
      expect(result.batterySocAfterKwh).toBeCloseTo(
        5.0 - 1.0 / etaDischarge,
        10
      );
    });
  });

  describe('C. Power limit', () => {
    it('caps delivered AC energy at maxContinuousOutputKw * intervalHours', () => {
      const profile = createMockBatteryProfile({
        maxContinuousOutputKw: 2.0,
        totalCapacityKwh: 10.0,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 8.0 });

      // Requested load is 5 kWh, but 2 kW * 1 h = 2 kWh max AC output
      const result = dischargeBatteryToHomeLoad(5.0, 1.0, profile, initialState);

      expect(result.batteryDeliveredToLoadKwh).toBe(2.0);
      expect(result.unmetHomeLoadKwh).toBe(3.0);
    });
  });

  describe('D. Sub-hourly power limit', () => {
    it('scales output power limit for sub-hourly intervals (e.g. 0.25h)', () => {
      const profile = createMockBatteryProfile({
        maxContinuousOutputKw: 4.0,
        totalCapacityKwh: 10.0,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 8.0 });

      // 4 kW * 0.25 h = 1.0 kWh max AC output
      const result = dischargeBatteryToHomeLoad(3.0, 0.25, profile, initialState);

      expect(result.batteryDeliveredToLoadKwh).toBe(1.0);
      expect(result.unmetHomeLoadKwh).toBe(2.0);
    });
  });

  describe('E. Empty battery', () => {
    it('delivers 0 AC energy when battery is empty, leaving entire load unmet', () => {
      const profile = createMockBatteryProfile();
      const initialState = createProvenanceState(); // All 0

      const result = dischargeBatteryToHomeLoad(4.0, 1.0, profile, initialState);

      expect(result.batteryDeliveredToLoadKwh).toBe(0.0);
      expect(result.unmetHomeLoadKwh).toBe(4.0);
      expect(result.storedEnergyDrainedKwh).toBe(0.0);
      expect(result.batterySocBeforeKwh).toBe(0.0);
      expect(result.batterySocAfterKwh).toBe(0.0);
      expect(result.stateAfter).toEqual(initialState);
    });
  });

  describe('F. Zero requested load', () => {
    it('does not drain battery when requested load is 0', () => {
      const profile = createMockBatteryProfile();
      const initialState = createProvenanceState({
        syntheticSocKwh: 3.0,
        renewableChargedSocKwh: 2.0,
      });

      const result = dischargeBatteryToHomeLoad(0.0, 1.0, profile, initialState);

      expect(result.batteryDeliveredToLoadKwh).toBe(0.0);
      expect(result.unmetHomeLoadKwh).toBe(0.0);
      expect(result.storedEnergyDrainedKwh).toBe(0.0);
      expect(result.batterySocAfterKwh).toBe(5.0);
      expect(result.stateAfter).toEqual(initialState);
    });
  });

  describe('G. Synthetic-first depletion', () => {
    it('drains synthetic SOC completely before touching renewable SOC', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 100, // 100% RTE: stored = delivered
        maxContinuousOutputKw: 10,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 2.0,
        renewableChargedSocKwh: 4.0,
      });

      // Request 1.5 kWh: should drain only synthetic
      const res1 = dischargeBatteryToHomeLoad(1.5, 1.0, profile, initialState);
      expect(res1.syntheticSocDrainedKwh).toBe(1.5);
      expect(res1.renewableSocDrainedKwh).toBe(0.0);
      expect(res1.stateAfter.syntheticSocKwh).toBe(0.5);
      expect(res1.stateAfter.renewableChargedSocKwh).toBe(4.0);

      // Request 3.0 kWh: should exhaust all 2.0 synthetic and take 1.0 from renewable
      const res2 = dischargeBatteryToHomeLoad(3.0, 1.0, profile, initialState);
      expect(res2.syntheticSocDrainedKwh).toBe(2.0);
      expect(res2.renewableSocDrainedKwh).toBe(1.0);
      expect(res2.stateAfter.syntheticSocKwh).toBe(0.0);
      expect(res2.stateAfter.renewableChargedSocKwh).toBe(3.0);
    });
  });

  describe('H. Renewable before generator/grid', () => {
    it('drains renewable SOC before touching generator or grid', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 100,
        maxContinuousOutputKw: 10,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 1.0,
        renewableChargedSocKwh: 2.0,
        generatorChargedSocKwh: 1.0,
        gridChargedSocKwh: 3.0,
      });

      // Request 2.5 kWh: drains 1.0 synthetic, 1.5 renewable; generator and grid untouched
      const res = dischargeBatteryToHomeLoad(2.5, 1.0, profile, initialState);
      expect(res.syntheticSocDrainedKwh).toBe(1.0);
      expect(res.renewableSocDrainedKwh).toBe(1.5);
      expect(res.generatorSocDrainedKwh).toBe(0.0);
      expect(res.gridSocDrainedKwh).toBe(0.0);

      expect(res.stateAfter.syntheticSocKwh).toBe(0.0);
      expect(res.stateAfter.renewableChargedSocKwh).toBe(0.5);
      expect(res.stateAfter.generatorChargedSocKwh).toBe(1.0);
      expect(res.stateAfter.gridChargedSocKwh).toBe(3.0);
    });
  });

  describe('I. Full provenance order', () => {
    it('drains across all four boundaries in exact priority: synthetic -> renewable -> generator -> grid', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 100,
        maxContinuousOutputKw: 10,
      });
      // Example from specification:
      // synthetic = 1, renewable = 2, generator = 0.5, grid = 3
      // stored energy required = 4 kWh
      // drains: synthetic 1, renewable 2, generator 0.5, grid 0.5 -> remaining grid: 2.5
      const initialState = createProvenanceState({
        syntheticSocKwh: 1.0,
        renewableChargedSocKwh: 2.0,
        generatorChargedSocKwh: 0.5,
        gridChargedSocKwh: 3.0,
      });

      const res = dischargeBatteryToHomeLoad(4.0, 1.0, profile, initialState);

      expect(res.storedEnergyDrainedKwh).toBe(4.0);
      expect(res.syntheticSocDrainedKwh).toBe(1.0);
      expect(res.renewableSocDrainedKwh).toBe(2.0);
      expect(res.generatorSocDrainedKwh).toBe(0.5);
      expect(res.gridSocDrainedKwh).toBe(0.5);

      expect(res.stateAfter.syntheticSocKwh).toBe(0.0);
      expect(res.stateAfter.renewableChargedSocKwh).toBe(0.0);
      expect(res.stateAfter.generatorChargedSocKwh).toBe(0.0);
      expect(res.stateAfter.gridChargedSocKwh).toBe(2.5);
      expect(res.batterySocAfterKwh).toBe(2.5);
    });
  });

  describe('J. Limited available SOC', () => {
    it('delivers all stored SOC when requested load exceeds battery energy', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 90,
        maxContinuousOutputKw: 10,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 1.0,
        renewableChargedSocKwh: 2.0,
      }); // Total SOC = 3.0 kWh
      const etaDischarge = Math.sqrt(0.9);

      // Request 5.0 kWh: battery only has 3.0 * etaDischarge AC kWh
      const res = dischargeBatteryToHomeLoad(5.0, 1.0, profile, initialState);

      expect(res.batteryDeliveredToLoadKwh).toBeCloseTo(3.0 * etaDischarge, 10);
      expect(res.storedEnergyDrainedKwh).toBeCloseTo(3.0, 10);
      expect(res.batterySocAfterKwh).toBe(0.0);
      expect(res.unmetHomeLoadKwh).toBeCloseTo(5.0 - 3.0 * etaDischarge, 10);
      expect(res.unmetHomeLoadKwh).toBeGreaterThan(0);
    });
  });

  describe('K. Provenance conservation', () => {
    it('strictly satisfies conservation: sum of provenance drains = storedEnergyDrained', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 88,
        maxContinuousOutputKw: 6,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 1.2,
        renewableChargedSocKwh: 2.3,
        generatorChargedSocKwh: 0.8,
        gridChargedSocKwh: 2.0,
      });

      const res = dischargeBatteryToHomeLoad(3.5, 1.0, profile, initialState);

      const sumDrains =
        res.syntheticSocDrainedKwh +
        res.renewableSocDrainedKwh +
        res.generatorSocDrainedKwh +
        res.gridSocDrainedKwh;

      expect(sumDrains).toBeCloseTo(res.storedEnergyDrainedKwh, 10);
      expect(res.batterySocBeforeKwh - res.batterySocAfterKwh).toBeCloseTo(
        res.storedEnergyDrainedKwh,
        10
      );
    });
  });

  describe('L. Fresh state objects', () => {
    it('returns freshly allocated stateBefore and stateAfter objects', () => {
      const profile = createMockBatteryProfile();
      const initialState = createProvenanceState({ syntheticSocKwh: 3.0 });

      const res = dischargeBatteryToHomeLoad(1.0, 1.0, profile, initialState);

      expect(res.stateBefore).not.toBe(initialState);
      expect(res.stateAfter).not.toBe(initialState);
      expect(res.stateBefore).not.toBe(res.stateAfter);
    });
  });

  describe('M. TOU/strategy independence', () => {
    it('produces identical results regardless of strategy or TOU tier configuration', () => {
      const profileArb = createMockBatteryProfile({
        strategy: 'arbitrage',
        chargeTiers: ['super-off-peak'],
        dischargeTiers: ['peak'],
      });
      const profileSelf = createMockBatteryProfile({
        strategy: 'self_consumption',
        chargeTiers: [],
        dischargeTiers: [],
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 2.0,
        renewableChargedSocKwh: 2.0,
      });

      const resArb = dischargeBatteryToHomeLoad(2.5, 1.0, profileArb, initialState);
      const resSelf = dischargeBatteryToHomeLoad(2.5, 1.0, profileSelf, initialState);

      expect(resArb.batteryDeliveredToLoadKwh).toBe(resSelf.batteryDeliveredToLoadKwh);
      expect(resArb.storedEnergyDrainedKwh).toBe(resSelf.storedEnergyDrainedKwh);
      expect(resArb.unmetHomeLoadKwh).toBe(resSelf.unmetHomeLoadKwh);
      expect(resArb.stateAfter).toEqual(resSelf.stateAfter);
    });
  });

  describe('N. Invalid state', () => {
    const profile = createMockBatteryProfile({ totalCapacityKwh: 10 });

    it('rejects negative provenance values', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(
          1.0,
          1.0,
          profile,
          createProvenanceState({ syntheticSocKwh: -1 })
        );
      }).toThrow(/Invalid initial state provenance/i);
    });

    it('rejects NaN provenance values', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(
          1.0,
          1.0,
          profile,
          createProvenanceState({ renewableChargedSocKwh: NaN })
        );
      }).toThrow(/Invalid initial state provenance/i);
    });

    it('rejects Infinity provenance values', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(
          1.0,
          1.0,
          profile,
          createProvenanceState({ gridChargedSocKwh: Infinity })
        );
      }).toThrow(/Invalid initial state provenance/i);
    });

    it('rejects initial total SOC exceeding usable capacity', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(
          1.0,
          1.0,
          profile,
          createProvenanceState({ syntheticSocKwh: 6, renewableChargedSocKwh: 5 }) // 11 > 10
        );
      }).toThrow(/exceeds usable capacity/i);
    });
  });

  describe('O. Invalid battery/input values', () => {
    const initialState = createProvenanceState({ syntheticSocKwh: 3 });

    it('rejects negative requested load', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(-1.0, 1.0, createMockBatteryProfile(), initialState);
      }).toThrow(/Invalid requestedHomeLoadKwh/i);
    });

    it('rejects non-positive intervalHours', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(1.0, 0, createMockBatteryProfile(), initialState);
      }).toThrow(/Invalid intervalHours/i);

      expect(() => {
        dischargeBatteryToHomeLoad(1.0, -0.5, createMockBatteryProfile(), initialState);
      }).toThrow(/Invalid intervalHours/i);
    });

    it('rejects invalid capacity', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(
          1.0,
          1.0,
          createMockBatteryProfile({ totalCapacityKwh: -2 }),
          initialState
        );
      }).toThrow(/Invalid battery totalCapacityKwh/i);
    });

    it('rejects invalid usable DoD', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(
          1.0,
          1.0,
          createMockBatteryProfile({ usableDodPercent: 110 }),
          initialState
        );
      }).toThrow(/Invalid battery usableDodPercent/i);
    });

    it('rejects negative max output power', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(
          1.0,
          1.0,
          createMockBatteryProfile({ maxContinuousOutputKw: -1 }),
          initialState
        );
      }).toThrow(/Invalid battery maxContinuousOutputKw/i);
    });

    it('rejects invalid RTE', () => {
      expect(() => {
        dischargeBatteryToHomeLoad(
          1.0,
          1.0,
          createMockBatteryProfile({ roundTripEfficiencyPercent: 0 }),
          initialState
        );
      }).toThrow(/Invalid battery roundTripEfficiencyPercent/i);

      expect(() => {
        dischargeBatteryToHomeLoad(
          1.0,
          1.0,
          createMockBatteryProfile({ roundTripEfficiencyPercent: 105 }),
          initialState
        );
      }).toThrow(/Invalid battery roundTripEfficiencyPercent/i);
    });
  });

  describe('P. Input immutability', () => {
    it('proves profile and initialState are not mutated', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 90,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 2.0,
        renewableChargedSocKwh: 3.0,
        generatorChargedSocKwh: 1.0,
        gridChargedSocKwh: 1.0,
      });

      Object.freeze(profile);
      Object.freeze(profile.chargeTiers);
      Object.freeze(profile.dischargeTiers);
      Object.freeze(initialState);

      const result = dischargeBatteryToHomeLoad(3.0, 1.0, profile, initialState);

      expect(initialState.syntheticSocKwh).toBe(2.0);
      expect(initialState.renewableChargedSocKwh).toBe(3.0);
      expect(initialState.generatorChargedSocKwh).toBe(1.0);
      expect(initialState.gridChargedSocKwh).toBe(1.0);

      expect(result.stateAfter.syntheticSocKwh).toBeLessThan(2.0);
    });
  });
});
