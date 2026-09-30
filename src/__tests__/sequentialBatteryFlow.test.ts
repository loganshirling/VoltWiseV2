import { describe, it, expect } from 'vitest';
import { routeSequentialSolarBatteryFlow } from '../utils/sequentialBatteryFlow';
import {
  BatteryDischargeDirective,
  BatteryProfile,
  BatterySocProvenanceState,
  SolarLoadFlowInterval,
} from '../types/energy';
import { calculateChargeEfficiency } from '../utils/solarBatteryCharging';
import { calculateDischargeEfficiency } from '../utils/batteryDischarge';

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

function makeInterval(
  index: number,
  homeLoadKwh: number,
  solarGenerationKwh: number,
  timestampUtc = `2025-06-01T${String(index).padStart(2, '0')}:00:00.000Z`,
  sourceTimestamp = `2025-06-01 ${String(index).padStart(2, '0')}:00`
): SolarLoadFlowInterval {
  const solarDirectToLoadKwh = Math.min(homeLoadKwh, solarGenerationKwh);
  const residualHomeLoadKwh = Math.max(0, homeLoadKwh - solarDirectToLoadKwh);
  const surplusSolarKwh = Math.max(0, solarGenerationKwh - solarDirectToLoadKwh);
  return {
    sourceIndex: index,
    sourceTimestamp,
    timestampUtc,
    homeLoadKwh,
    solarGenerationKwh,
    solarDirectToLoadKwh,
    residualHomeLoadKwh,
    surplusSolarKwh,
  };
}

function makeDirective(
  interval: SolarLoadFlowInterval,
  allowBatteryDischargeToLoad: boolean
): BatteryDischargeDirective {
  return {
    sourceIndex: interval.sourceIndex,
    timestampUtc: interval.timestampUtc,
    allowBatteryDischargeToLoad,
  };
}

describe('G3D — Sequential Solar/Battery Flow Kernel', () => {
  describe('A. Charge then discharge', () => {
    it('stores renewable SOC in interval 1 and makes it available to discharge in interval 2', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 100, // 100% for simple arithmetic
      });
      const initialState = createProvenanceState();

      // Interval 0: 5 kWh solar surplus, 0 load
      const inv0 = makeInterval(0, 0, 5);
      // Interval 1: 0 solar, 3 kWh load
      const inv1 = makeInterval(1, 3, 0);

      const intervals = [inv0, inv1];
      const directives = [
        makeDirective(inv0, false),
        makeDirective(inv1, true),
      ];

      const result = routeSequentialSolarBatteryFlow(
        intervals,
        directives,
        1.0,
        profile,
        initialState
      );

      expect(result.intervals).toHaveLength(2);

      // Interval 0: Charged 5 kWh
      const r0 = result.intervals[0];
      expect(r0.solarToBatteryAcKwh).toBe(5);
      expect(r0.renewableEnergyStoredKwh).toBe(5);
      expect(r0.stateAfter.renewableChargedSocKwh).toBe(5);
      expect(r0.batterySocAfterKwh).toBe(5);

      // Interval 1: Discharged 3 kWh from the renewable SOC created in interval 0
      const r1 = result.intervals[1];
      expect(r1.batteryDeliveredToLoadKwh).toBe(3);
      expect(r1.storedEnergyDrainedKwh).toBe(3);
      expect(r1.renewableSocDrainedKwh).toBe(3);
      expect(r1.syntheticSocDrainedKwh).toBe(0);
      expect(r1.residualHomeLoadAfterBatteryKwh).toBe(0);
      expect(r1.stateAfter.renewableChargedSocKwh).toBe(2);
      expect(r1.batterySocAfterKwh).toBe(2);
      expect(result.finalState.renewableChargedSocKwh).toBe(2);
    });
  });

  describe('B. Discharge then recharge', () => {
    it('discharges battery to free capacity and refuels it with subsequent solar surplus', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 100,
      });
      // Start with 10 kWh synthetic SOC (full battery)
      const initialState = createProvenanceState({ syntheticSocKwh: 10 });

      // Interval 0: discharge 4 kWh to load
      const inv0 = makeInterval(0, 4, 0);
      // Interval 1: recharge with 4 kWh surplus solar
      const inv1 = makeInterval(1, 0, 4);

      const intervals = [inv0, inv1];
      const directives = [
        makeDirective(inv0, true),
        makeDirective(inv1, false), // renewable charging ignores directive
      ];

      const result = routeSequentialSolarBatteryFlow(
        intervals,
        directives,
        1.0,
        profile,
        initialState
      );

      const r0 = result.intervals[0];
      expect(r0.batteryDeliveredToLoadKwh).toBe(4);
      expect(r0.syntheticSocDrainedKwh).toBe(4);
      expect(r0.stateAfter.syntheticSocKwh).toBe(6);
      expect(r0.batterySocAfterKwh).toBe(6);

      const r1 = result.intervals[1];
      // Freed 4 kWh room is refilled by renewable charging
      expect(r1.solarToBatteryAcKwh).toBe(4);
      expect(r1.renewableEnergyStoredKwh).toBe(4);
      expect(r1.stateAfter.syntheticSocKwh).toBe(6);
      expect(r1.stateAfter.renewableChargedSocKwh).toBe(4);
      expect(r1.batterySocAfterKwh).toBe(10);
      expect(
        result.finalState.syntheticSocKwh +
          result.finalState.renewableChargedSocKwh
      ).toBe(10);
    });
  });

  describe('C. Alternating sequence', () => {
    it('correctly handles charge -> discharge -> charge -> discharge across 4 intervals', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      const inv0 = makeInterval(0, 0, 4); // charge 4
      const inv1 = makeInterval(1, 2, 0); // discharge 2
      const inv2 = makeInterval(2, 0, 5); // charge 5
      const inv3 = makeInterval(3, 3, 0); // discharge 3

      const intervals = [inv0, inv1, inv2, inv3];
      const directives = [
        makeDirective(inv0, false),
        makeDirective(inv1, true),
        makeDirective(inv2, false),
        makeDirective(inv3, true),
      ];

      const result = routeSequentialSolarBatteryFlow(
        intervals,
        directives,
        1.0,
        profile,
        initialState
      );

      // Boundary 0 -> 1
      expect(result.intervals[0].batterySocAfterKwh).toBe(4);
      expect(result.intervals[1].batterySocBeforeKwh).toBe(4);
      expect(result.intervals[0].stateAfter).toEqual(
        result.intervals[1].stateBefore
      );

      // Boundary 1 -> 2
      expect(result.intervals[1].batterySocAfterKwh).toBe(2);
      expect(result.intervals[2].batterySocBeforeKwh).toBe(2);
      expect(result.intervals[1].stateAfter).toEqual(
        result.intervals[2].stateBefore
      );

      // Boundary 2 -> 3
      expect(result.intervals[2].batterySocAfterKwh).toBe(7);
      expect(result.intervals[3].batterySocBeforeKwh).toBe(7);
      expect(result.intervals[2].stateAfter).toEqual(
        result.intervals[3].stateBefore
      );

      // Final boundary
      expect(result.intervals[3].batterySocAfterKwh).toBe(4);
      expect(result.finalState).toEqual(result.intervals[3].stateAfter);
    });
  });

  describe('D. Discharge forbidden', () => {
    it('leaves battery state untouched and keeps residual load when directive is false', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 5 });

      const inv = makeInterval(0, 3, 0);
      const directive = makeDirective(inv, false); // discharge forbidden

      const result = routeSequentialSolarBatteryFlow(
        [inv],
        [directive],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.dischargeAllowed).toBe(false);
      expect(r.batteryDeliveredToLoadKwh).toBe(0);
      expect(r.storedEnergyDrainedKwh).toBe(0);
      expect(r.residualHomeLoadAfterBatteryKwh).toBe(3);
      expect(r.batterySocBeforeKwh).toBe(5);
      expect(r.batterySocAfterKwh).toBe(5);
      expect(r.stateAfter).toEqual(r.stateBefore);
    });
  });

  describe('E. Renewable charging ignores directive', () => {
    it('charges the battery from solar surplus even if allowBatteryDischargeToLoad is false', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      const inv = makeInterval(0, 0, 4);
      const directive = makeDirective(inv, false); // false directive

      const result = routeSequentialSolarBatteryFlow(
        [inv],
        [directive],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.solarToBatteryAcKwh).toBe(4);
      expect(r.renewableEnergyStoredKwh).toBe(4);
      expect(r.batterySocAfterKwh).toBe(4);
    });
  });

  describe('F. Empty battery + allowed discharge', () => {
    it('delivers 0 kWh and leaves residual load intact when battery is completely empty', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
      });
      const initialState = createProvenanceState(); // all 0

      const inv = makeInterval(0, 4, 0);
      const directive = makeDirective(inv, true); // discharge allowed

      const result = routeSequentialSolarBatteryFlow(
        [inv],
        [directive],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.batteryDeliveredToLoadKwh).toBe(0);
      expect(r.storedEnergyDrainedKwh).toBe(0);
      expect(r.residualHomeLoadAfterBatteryKwh).toBe(4);
      expect(r.batterySocAfterKwh).toBe(0);
    });
  });

  describe('G. Full battery + solar surplus', () => {
    it('performs zero charging and leaves all surplus available when battery is already full', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 10 });

      const inv = makeInterval(0, 0, 6);
      const directive = makeDirective(inv, false);

      const result = routeSequentialSolarBatteryFlow(
        [inv],
        [directive],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.solarToBatteryAcKwh).toBe(0);
      expect(r.renewableEnergyStoredKwh).toBe(0);
      expect(r.remainingSurplusSolarKwh).toBe(6);
      expect(r.batterySocAfterKwh).toBe(10);
    });
  });

  describe('H. Charge power limit survives composition', () => {
    it('limits charging to maxContinuousChargeKw * intervalHours', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 15,
        usableDodPercent: 100,
        maxContinuousChargeKw: 3,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      const inv = makeInterval(0, 0, 8); // 8 kWh surplus available
      const directive = makeDirective(inv, false);

      const result = routeSequentialSolarBatteryFlow(
        [inv],
        [directive],
        1.0, // 1 hour -> max 3 kWh
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.solarToBatteryAcKwh).toBe(3);
      expect(r.renewableEnergyStoredKwh).toBe(3);
      expect(r.remainingSurplusSolarKwh).toBe(5);
    });
  });

  describe('I. Discharge power limit survives composition', () => {
    it('limits discharge to maxContinuousOutputKw * intervalHours', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 15,
        usableDodPercent: 100,
        maxContinuousOutputKw: 2.5,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 10 });

      const inv = makeInterval(0, 6, 0); // 6 kWh residual load
      const directive = makeDirective(inv, true);

      const result = routeSequentialSolarBatteryFlow(
        [inv],
        [directive],
        1.0, // 1 hour -> max 2.5 kWh
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.batteryDeliveredToLoadKwh).toBe(2.5);
      expect(r.residualHomeLoadAfterBatteryKwh).toBe(3.5);
    });
  });

  describe('J. Provenance depletion survives composition', () => {
    it('depletes provenance in exact priority order: synthetic -> renewable -> generator -> grid', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 10,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 1,
        renewableChargedSocKwh: 1,
        generatorChargedSocKwh: 1,
        gridChargedSocKwh: 1,
      });

      // Interval 0: requested load 1.5 -> drains 1.0 synthetic + 0.5 renewable
      const inv0 = makeInterval(0, 1.5, 0);
      // Interval 1: requested load 1.0 -> drains 0.5 renewable + 0.5 generator
      const inv1 = makeInterval(1, 1.0, 0);
      // Interval 2: requested load 1.0 -> drains 0.5 generator + 0.5 grid
      const inv2 = makeInterval(2, 1.0, 0);

      const intervals = [inv0, inv1, inv2];
      const directives = intervals.map((inv) => makeDirective(inv, true));

      const result = routeSequentialSolarBatteryFlow(
        intervals,
        directives,
        1.0,
        profile,
        initialState
      );

      const r0 = result.intervals[0];
      expect(r0.syntheticSocDrainedKwh).toBe(1.0);
      expect(r0.renewableSocDrainedKwh).toBe(0.5);
      expect(r0.generatorSocDrainedKwh).toBe(0);
      expect(r0.gridSocDrainedKwh).toBe(0);
      expect(r0.stateAfter.syntheticSocKwh).toBe(0);
      expect(r0.stateAfter.renewableChargedSocKwh).toBe(0.5);

      const r1 = result.intervals[1];
      expect(r1.syntheticSocDrainedKwh).toBe(0);
      expect(r1.renewableSocDrainedKwh).toBe(0.5);
      expect(r1.generatorSocDrainedKwh).toBe(0.5);
      expect(r1.gridSocDrainedKwh).toBe(0);
      expect(r1.stateAfter.renewableChargedSocKwh).toBe(0);
      expect(r1.stateAfter.generatorChargedSocKwh).toBe(0.5);

      const r2 = result.intervals[2];
      expect(r2.syntheticSocDrainedKwh).toBe(0);
      expect(r2.renewableSocDrainedKwh).toBe(0);
      expect(r2.generatorSocDrainedKwh).toBe(0.5);
      expect(r2.gridSocDrainedKwh).toBe(0.5);
      expect(r2.stateAfter.generatorChargedSocKwh).toBe(0);
      expect(r2.stateAfter.gridChargedSocKwh).toBe(0.5);
    });
  });

  describe('K. Flow conservation', () => {
    it('preserves solar and household demand flow conservation across all intervals', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 12,
        usableDodPercent: 90,
        maxContinuousChargeKw: 4,
        maxContinuousOutputKw: 4,
        roundTripEfficiencyPercent: 88,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 4 });

      const intervals = [
        makeInterval(0, 2, 6), // solar surplus
        makeInterval(1, 5, 1), // residual load, allow discharge
        makeInterval(2, 6, 0), // residual load, forbid discharge
        makeInterval(3, 3, 3), // direct match (idle)
        makeInterval(4, 0, 7), // full solar surplus
        makeInterval(5, 8, 0), // heavy load, allow discharge
      ];

      const directives = [
        makeDirective(intervals[0], true),
        makeDirective(intervals[1], true),
        makeDirective(intervals[2], false),
        makeDirective(intervals[3], true),
        makeDirective(intervals[4], false),
        makeDirective(intervals[5], true),
      ];

      const result = routeSequentialSolarBatteryFlow(
        intervals,
        directives,
        1.0,
        profile,
        initialState
      );

      for (let i = 0; i < result.intervals.length; i++) {
        const inv = result.intervals[i];

        // AC Solar conservation:
        // solarGeneration = solarDirectToLoad + solarToBatteryAc + remainingSurplusSolar
        const solarSum =
          inv.solarDirectToLoadKwh +
          inv.solarToBatteryAcKwh +
          inv.remainingSurplusSolarKwh;
        expect(solarSum).toBeCloseTo(inv.solarGenerationKwh, 9);

        // Home Load conservation:
        // homeLoad = solarDirectToLoad + batteryDeliveredToLoad + residualHomeLoadAfterBattery
        const loadSum =
          inv.solarDirectToLoadKwh +
          inv.batteryDeliveredToLoadKwh +
          inv.residualHomeLoadAfterBatteryKwh;
        expect(loadSum).toBeCloseTo(inv.homeLoadKwh, 9);

        // Efficiency loss representation:
        const chargeLoss =
          inv.solarToBatteryAcKwh - inv.renewableEnergyStoredKwh;
        expect(chargeLoss).toBeGreaterThanOrEqual(-1e-12);
      }
    });
  });

  describe('L. State continuity', () => {
    it('guarantees intervals[i].stateAfter equals intervals[i+1].stateBefore by value across full sequence', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 85,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 3 });

      const intervals = Array.from({ length: 8 }, (_, i) =>
        makeInterval(i, (i % 3) * 2, ((i + 1) % 4) * 2)
      );
      const directives = intervals.map((inv, idx) =>
        makeDirective(inv, idx % 2 === 0)
      );

      const result = routeSequentialSolarBatteryFlow(
        intervals,
        directives,
        1.0,
        profile,
        initialState
      );

      for (let i = 0; i < result.intervals.length - 1; i++) {
        const current = result.intervals[i];
        const next = result.intervals[i + 1];

        expect(current.stateAfter).toEqual(next.stateBefore);
        expect(current.batterySocAfterKwh).toBeCloseTo(
          next.batterySocBeforeKwh,
          10
        );
      }

      // Final state matches last interval's stateAfter
      const last = result.intervals[result.intervals.length - 1];
      expect(result.finalState).toEqual(last.stateAfter);
    });
  });

  describe('M. Directive mismatch', () => {
    const profile = createMockBatteryProfile();
    const initialState = createProvenanceState();

    it('rejects length mismatch between intervals and directives', () => {
      const inv0 = makeInterval(0, 2, 0);
      const inv1 = makeInterval(1, 2, 0);
      const dir0 = makeDirective(inv0, true);

      expect(() =>
        routeSequentialSolarBatteryFlow(
          [inv0, inv1],
          [dir0],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/Directives length/i);
    });

    it('rejects sourceIndex mismatch', () => {
      const inv0 = makeInterval(0, 2, 0);
      const badDir = {
        sourceIndex: 1, // should be 0
        timestampUtc: inv0.timestampUtc,
        allowBatteryDischargeToLoad: true,
      };

      expect(() =>
        routeSequentialSolarBatteryFlow(
          [inv0],
          [badDir],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/sourceIndex mismatch/i);
    });

    it('rejects timestampUtc mismatch', () => {
      const inv0 = makeInterval(0, 2, 0);
      const badDir = {
        sourceIndex: 0,
        timestampUtc: '2099-01-01T00:00:00.000Z', // wrong
        allowBatteryDischargeToLoad: true,
      };

      expect(() =>
        routeSequentialSolarBatteryFlow(
          [inv0],
          [badDir],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/timestampUtc mismatch/i);
    });

    it('rejects non-boolean allowBatteryDischargeToLoad', () => {
      const inv0 = makeInterval(0, 2, 0);
      const badDir = {
        sourceIndex: 0,
        timestampUtc: inv0.timestampUtc,
        allowBatteryDischargeToLoad: 'true' as unknown as boolean,
      };

      expect(() =>
        routeSequentialSolarBatteryFlow(
          [inv0],
          [badDir],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/must be a boolean/i);
    });
  });

  describe('N. Contradictory upstream flow', () => {
    const profile = createMockBatteryProfile();
    const initialState = createProvenanceState();

    it('rejects interval with simultaneous positive residual load and surplus solar', () => {
      const contradictoryInv: SolarLoadFlowInterval = {
        sourceIndex: 0,
        sourceTimestamp: '2025-06-01 00:00',
        timestampUtc: '2025-06-01T00:00:00.000Z',
        homeLoadKwh: 5,
        solarGenerationKwh: 5,
        solarDirectToLoadKwh: 2,
        residualHomeLoadKwh: 3, // positive
        surplusSolarKwh: 3, // simultaneous positive!
      };
      const dir = makeDirective(contradictoryInv, true);

      expect(() =>
        routeSequentialSolarBatteryFlow(
          [contradictoryInv],
          [dir],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/contradictory upstream/i);
    });

    it('rejects negative residualHomeLoadKwh or surplusSolarKwh', () => {
      const invalidInv: SolarLoadFlowInterval = {
        sourceIndex: 0,
        sourceTimestamp: '2025-06-01 00:00',
        timestampUtc: '2025-06-01T00:00:00.000Z',
        homeLoadKwh: 5,
        solarGenerationKwh: 5,
        solarDirectToLoadKwh: 5,
        residualHomeLoadKwh: -1,
        surplusSolarKwh: 0,
      };
      const dir = makeDirective(invalidInv, true);

      expect(() =>
        routeSequentialSolarBatteryFlow(
          [invalidInv],
          [dir],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/Invalid residualHomeLoadKwh/i);
    });
  });

  describe('O. Result totals', () => {
    it('matches independent manual summation of interval quantities without rounding', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        roundTripEfficiencyPercent: 92,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 3 });

      const intervals = [
        makeInterval(0, 1, 5),
        makeInterval(1, 4, 0),
        makeInterval(2, 0, 6),
        makeInterval(3, 5, 2),
      ];
      const directives = [
        makeDirective(intervals[0], false),
        makeDirective(intervals[1], true),
        makeDirective(intervals[2], false),
        makeDirective(intervals[3], true),
      ];

      const result = routeSequentialSolarBatteryFlow(
        intervals,
        directives,
        1.0,
        profile,
        initialState
      );

      let sumSolarToBatteryAc = 0;
      let sumRenewableEnergyStored = 0;
      let sumBatteryDeliveredToLoad = 0;
      let sumStoredEnergyDrained = 0;
      let sumResidualHomeLoadAfterBattery = 0;
      let sumRemainingSurplusSolar = 0;

      for (const r of result.intervals) {
        sumSolarToBatteryAc += r.solarToBatteryAcKwh;
        sumRenewableEnergyStored += r.renewableEnergyStoredKwh;
        sumBatteryDeliveredToLoad += r.batteryDeliveredToLoadKwh;
        sumStoredEnergyDrained += r.storedEnergyDrainedKwh;
        sumResidualHomeLoadAfterBattery += r.residualHomeLoadAfterBatteryKwh;
        sumRemainingSurplusSolar += r.remainingSurplusSolarKwh;
      }

      expect(result.totalSolarToBatteryAcKwh).toBe(sumSolarToBatteryAc);
      expect(result.totalRenewableEnergyStoredKwh).toBe(
        sumRenewableEnergyStored
      );
      expect(result.totalBatteryDeliveredToLoadKwh).toBe(
        sumBatteryDeliveredToLoad
      );
      expect(result.totalStoredEnergyDrainedKwh).toBe(sumStoredEnergyDrained);
      expect(result.totalResidualHomeLoadAfterBatteryKwh).toBe(
        sumResidualHomeLoadAfterBattery
      );
      expect(result.totalRemainingSurplusSolarKwh).toBe(
        sumRemainingSurplusSolar
      );
    });
  });

  describe('P. Input immutability', () => {
    it('does not mutate frozen input intervals, directives, profile, or initialState', () => {
      const profile = Object.freeze(
        createMockBatteryProfile({
          chargeTiers: Object.freeze(['off-peak']) as unknown as string[],
          dischargeTiers: Object.freeze(['on-peak']) as unknown as string[],
        })
      );
      const initialState = Object.freeze(
        createProvenanceState({ syntheticSocKwh: 4 })
      );

      const inv0 = Object.freeze(makeInterval(0, 1, 4));
      const inv1 = Object.freeze(makeInterval(1, 3, 0));
      const dir0 = Object.freeze(makeDirective(inv0, false));
      const dir1 = Object.freeze(makeDirective(inv1, true));

      const intervals = Object.freeze([inv0, inv1]);
      const directives = Object.freeze([dir0, dir1]);

      expect(() => {
        routeSequentialSolarBatteryFlow(
          intervals as unknown as SolarLoadFlowInterval[],
          directives as unknown as BatteryDischargeDirective[],
          1.0,
          profile,
          initialState
        );
      }).not.toThrow();

      // State objects returned must be new instances
      const result = routeSequentialSolarBatteryFlow(
        intervals as unknown as SolarLoadFlowInterval[],
        directives as unknown as BatteryDischargeDirective[],
        1.0,
        profile,
        initialState
      );

      expect(result.initialState).not.toBe(initialState);
      expect(result.finalState).not.toBe(initialState);
      expect(result.intervals[0].stateBefore).not.toBe(initialState);
      expect(result.intervals[0].stateAfter).not.toBe(result.finalState);
    });
  });
});
