import { describe, it, expect } from 'vitest';
import { chargeBatteryFromGrid } from '../utils/gridBatteryCharging';
import {
  BatteryProfile,
  BatterySocProvenanceState,
} from '../types/energy';
import { calculateChargeEfficiency } from '../utils/solarBatteryCharging';

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

describe('G3F — Grid-to-Battery Charging Primitive', () => {
  describe('A. Basic grid charge', () => {
    it('increases grid SOC when room and requested grid energy are available', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      const result = chargeBatteryFromGrid(3.0, 1.0, profile, initialState);

      expect(result.requestedGridChargeAcKwh).toBe(3.0);
      expect(result.gridToBatteryAcKwh).toBe(3.0);
      expect(result.gridEnergyStoredKwh).toBe(3.0);
      expect(result.unfulfilledGridChargeRequestKwh).toBe(0.0);
      expect(result.gridSocBeforeKwh).toBe(0.0);
      expect(result.gridSocAfterKwh).toBe(3.0);
      expect(result.batterySocBeforeKwh).toBe(0.0);
      expect(result.batterySocAfterKwh).toBe(3.0);
      expect(result.stateAfter.gridChargedSocKwh).toBe(3.0);
    });
  });

  describe('B. Charge efficiency', () => {
    it('applies square-root charge efficiency at 90% RTE', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 90,
      });
      const initialState = createProvenanceState();

      const eta = calculateChargeEfficiency(profile);
      expect(eta).toBeCloseTo(Math.sqrt(0.9), 6);

      const result = chargeBatteryFromGrid(2.0, 1.0, profile, initialState);

      expect(result.gridToBatteryAcKwh).toBe(2.0);
      expect(result.gridEnergyStoredKwh).toBeCloseTo(2.0 * Math.sqrt(0.9), 6);
      expect(result.batterySocAfterKwh).toBeCloseTo(2.0 * Math.sqrt(0.9), 6);
      expect(result.stateAfter.gridChargedSocKwh).toBeCloseTo(
        2.0 * Math.sqrt(0.9),
        6
      );
    });
  });

  describe('C. Requested-energy limit', () => {
    it('takes no more energy than requested when requested amount is less than physical limits', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 20,
        usableDodPercent: 100,
        maxContinuousChargeKw: 10,
      });
      const initialState = createProvenanceState();

      const result = chargeBatteryFromGrid(1.5, 1.0, profile, initialState);

      expect(result.gridToBatteryAcKwh).toBe(1.5);
      expect(result.unfulfilledGridChargeRequestKwh).toBe(0.0);
    });
  });

  describe('D. Charge-power limit', () => {
    it('restricts AC charge to maxContinuousChargeKw * intervalHours and leaves rest unfulfilled', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 15,
        usableDodPercent: 100,
        maxContinuousChargeKw: 2,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      // Request 5 kWh with 2 kW continuous limit over 1 hour
      const result = chargeBatteryFromGrid(5.0, 1.0, profile, initialState);

      expect(result.gridToBatteryAcKwh).toBe(2.0);
      expect(result.unfulfilledGridChargeRequestKwh).toBe(3.0);
      expect(result.gridEnergyStoredKwh).toBe(2.0);
      expect(result.batterySocAfterKwh).toBe(2.0);
    });
  });

  describe('E. Sub-hourly limit', () => {
    it('scales maximum charging power by fractional interval duration (4 kW * 0.25 h = 1 kWh)', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 4,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      const result = chargeBatteryFromGrid(3.0, 0.25, profile, initialState);

      expect(result.gridToBatteryAcKwh).toBe(1.0);
      expect(result.unfulfilledGridChargeRequestKwh).toBe(2.0);
    });
  });

  describe('F. Capacity limit', () => {
    it('stops exactly at usable capacity when battery is nearly full', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 90, // 9 kWh usable capacity
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 81, // sqrt(0.81) = 0.90 charge efficiency
      });
      // Start with 8.1 kWh total SOC (0.9 kWh room remaining)
      const initialState = createProvenanceState({
        syntheticSocKwh: 8.1,
      });

      // 0.9 kWh room / 0.90 charge efficiency = 1.0 kWh AC needed
      // Request 3.0 kWh AC
      const result = chargeBatteryFromGrid(3.0, 1.0, profile, initialState);

      expect(result.gridToBatteryAcKwh).toBeCloseTo(1.0, 6);
      expect(result.gridEnergyStoredKwh).toBeCloseTo(0.9, 6);
      expect(result.batterySocAfterKwh).toBeCloseTo(9.0, 6);
      expect(result.unfulfilledGridChargeRequestKwh).toBeCloseTo(2.0, 6);
    });
  });

  describe('G. Full battery', () => {
    it('leaves all requested grid charge unfulfilled when battery is completely full', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
      });
      const initialState = createProvenanceState({
        renewableChargedSocKwh: 10,
      });

      const result = chargeBatteryFromGrid(4.0, 1.0, profile, initialState);

      expect(result.gridToBatteryAcKwh).toBe(0.0);
      expect(result.gridEnergyStoredKwh).toBe(0.0);
      expect(result.unfulfilledGridChargeRequestKwh).toBe(4.0);
      expect(result.batterySocBeforeKwh).toBe(10.0);
      expect(result.batterySocAfterKwh).toBe(10.0);
      expect(result.gridSocAfterKwh).toBe(0.0);
    });
  });

  describe('H. Zero request', () => {
    it('keeps state unchanged when 0 AC charge is requested', () => {
      const profile = createMockBatteryProfile();
      const initialState = createProvenanceState({
        gridChargedSocKwh: 2.5,
      });

      const result = chargeBatteryFromGrid(0.0, 1.0, profile, initialState);

      expect(result.gridToBatteryAcKwh).toBe(0.0);
      expect(result.gridEnergyStoredKwh).toBe(0.0);
      expect(result.unfulfilledGridChargeRequestKwh).toBe(0.0);
      expect(result.batterySocBeforeKwh).toBe(2.5);
      expect(result.batterySocAfterKwh).toBe(2.5);
      expect(result.stateAfter).toEqual(initialState);
    });
  });

  describe('I. Provenance isolation', () => {
    it('increases only gridChargedSocKwh and leaves synthetic, renewable, and generator untouched', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 12,
        usableDodPercent: 100,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 2.0,
        renewableChargedSocKwh: 3.0,
        generatorChargedSocKwh: 1.0,
        gridChargedSocKwh: 0.0,
      });

      const result = chargeBatteryFromGrid(2.5, 1.0, profile, initialState);

      expect(result.stateAfter.syntheticSocKwh).toBe(2.0);
      expect(result.stateAfter.renewableChargedSocKwh).toBe(3.0);
      expect(result.stateAfter.generatorChargedSocKwh).toBe(1.0);
      expect(result.stateAfter.gridChargedSocKwh).toBe(2.5);
    });
  });

  describe('J. Existing grid SOC accumulation', () => {
    it('adds new stored grid energy to existing gridChargedSocKwh', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState({
        gridChargedSocKwh: 1.5,
      });

      const result = chargeBatteryFromGrid(2.0, 1.0, profile, initialState);

      expect(result.gridSocBeforeKwh).toBe(1.5);
      expect(result.gridSocAfterKwh).toBe(3.5);
      expect(result.stateAfter.gridChargedSocKwh).toBe(3.5);
      expect(result.batterySocAfterKwh).toBe(3.5);
    });
  });

  describe('K. Strategy and tier independence', () => {
    it('executes identical physical charging regardless of strategy or chargeTiers settings', () => {
      const baseInitial = createProvenanceState({ gridChargedSocKwh: 1.0 });

      const profileArbitrage = createMockBatteryProfile({
        strategy: 'arbitrage',
        chargeTiers: ['off-peak'],
        roundTripEfficiencyPercent: 90,
      });

      const profileSelfConsumption = createMockBatteryProfile({
        strategy: 'self_consumption',
        chargeTiers: [], // empty charge tiers
        roundTripEfficiencyPercent: 90,
      });

      const res1 = chargeBatteryFromGrid(2.0, 1.0, profileArbitrage, baseInitial);
      const res2 = chargeBatteryFromGrid(
        2.0,
        1.0,
        profileSelfConsumption,
        baseInitial
      );

      expect(res1.gridToBatteryAcKwh).toBe(res2.gridToBatteryAcKwh);
      expect(res1.gridEnergyStoredKwh).toBe(res2.gridEnergyStoredKwh);
      expect(res1.unfulfilledGridChargeRequestKwh).toBe(
        res2.unfulfilledGridChargeRequestKwh
      );
      expect(res1.stateAfter).toEqual(res2.stateAfter);
    });
  });

  describe('L. Conservation', () => {
    it('preserves AC request balance and DC energy storage balance', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 90,
        maxContinuousChargeKw: 3.5,
        roundTripEfficiencyPercent: 88,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 3.0,
        gridChargedSocKwh: 1.0,
      });

      const result = chargeBatteryFromGrid(4.5, 1.0, profile, initialState);

      // AC balance: request = accepted + unfulfilled
      expect(
        result.gridToBatteryAcKwh + result.unfulfilledGridChargeRequestKwh
      ).toBeCloseTo(result.requestedGridChargeAcKwh, 10);

      // DC balance: SOC gain = gridEnergyStored
      const socGain = result.batterySocAfterKwh - result.batterySocBeforeKwh;
      expect(socGain).toBeCloseTo(result.gridEnergyStoredKwh, 10);

      // Conversion loss: accepted AC - stored DC >= 0
      const loss = result.gridToBatteryAcKwh - result.gridEnergyStoredKwh;
      expect(loss).toBeGreaterThanOrEqual(0);
    });
  });

  describe('M. Invalid state/input', () => {
    const profile = createMockBatteryProfile();
    const initialState = createProvenanceState();

    it('rejects negative, NaN, or Infinity requestedGridChargeAcKwh', () => {
      expect(() =>
        chargeBatteryFromGrid(-1, 1.0, profile, initialState)
      ).toThrow(/Invalid requestedGridChargeAcKwh/i);

      expect(() =>
        chargeBatteryFromGrid(NaN, 1.0, profile, initialState)
      ).toThrow(/Invalid requestedGridChargeAcKwh/i);

      expect(() =>
        chargeBatteryFromGrid(Infinity, 1.0, profile, initialState)
      ).toThrow(/Invalid requestedGridChargeAcKwh/i);
    });

    it('rejects invalid intervalHours', () => {
      expect(() =>
        chargeBatteryFromGrid(1.0, 0, profile, initialState)
      ).toThrow(/Invalid intervalHours/i);

      expect(() =>
        chargeBatteryFromGrid(1.0, -0.5, profile, initialState)
      ).toThrow(/Invalid intervalHours/i);

      expect(() =>
        chargeBatteryFromGrid(1.0, NaN, profile, initialState)
      ).toThrow(/Invalid intervalHours/i);
    });

    it('rejects invalid battery parameters', () => {
      const badCapacity = createMockBatteryProfile({ totalCapacityKwh: -5 });
      expect(() =>
        chargeBatteryFromGrid(1.0, 1.0, badCapacity, initialState)
      ).toThrow(/Invalid battery totalCapacityKwh/i);

      const badDod = createMockBatteryProfile({ usableDodPercent: 120 });
      expect(() =>
        chargeBatteryFromGrid(1.0, 1.0, badDod, initialState)
      ).toThrow(/Invalid battery usableDodPercent/i);

      const badChargeKw = createMockBatteryProfile({
        maxContinuousChargeKw: -2,
      });
      expect(() =>
        chargeBatteryFromGrid(1.0, 1.0, badChargeKw, initialState)
      ).toThrow(/Invalid battery maxContinuousChargeKw/i);

      const badRte = createMockBatteryProfile({
        roundTripEfficiencyPercent: 0,
      });
      expect(() =>
        chargeBatteryFromGrid(1.0, 1.0, badRte, initialState)
      ).toThrow(/Invalid battery roundTripEfficiencyPercent/i);
    });

    it('rejects invalid provenance state', () => {
      const badState = {
        syntheticSocKwh: -1,
        gridChargedSocKwh: 0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      };
      expect(() =>
        chargeBatteryFromGrid(1.0, 1.0, profile, badState)
      ).toThrow(/Invalid initial state provenance for syntheticSocKwh/i);
    });

    it('rejects initial SOC exceeding usable capacity', () => {
      const smallBattery = createMockBatteryProfile({
        totalCapacityKwh: 5,
        usableDodPercent: 100, // 5 kWh usable
      });
      const overfilledState = createProvenanceState({
        gridChargedSocKwh: 5.5,
      });
      expect(() =>
        chargeBatteryFromGrid(1.0, 1.0, smallBattery, overfilledState)
      ).toThrow(/exceeds usable capacity/i);
    });
  });

  describe('N. Fresh states / immutability', () => {
    it('returns brand-new state instances and leaves frozen inputs completely unmutated', () => {
      const profile = Object.freeze(
        createMockBatteryProfile({
          chargeTiers: Object.freeze(['off-peak']) as unknown as string[],
          dischargeTiers: Object.freeze(['on-peak']) as unknown as string[],
        })
      );
      const initialState = Object.freeze(
        createProvenanceState({ gridChargedSocKwh: 2.0 })
      );

      const result = chargeBatteryFromGrid(1.5, 1.0, profile, initialState);

      // Reference inequality checks
      expect(result.stateBefore).not.toBe(initialState);
      expect(result.stateAfter).not.toBe(initialState);
      expect(result.stateBefore).not.toBe(result.stateAfter);

      // Verify values
      expect(result.stateBefore).toEqual({
        syntheticSocKwh: 0,
        gridChargedSocKwh: 2.0,
        renewableChargedSocKwh: 0,
        generatorChargedSocKwh: 0,
      });
      expect(result.stateAfter.gridChargedSocKwh).toBe(3.5);
    });
  });
});
