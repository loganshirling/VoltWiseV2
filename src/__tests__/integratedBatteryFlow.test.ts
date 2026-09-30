import { describe, it, expect } from 'vitest';
import { routeIntegratedBatteryFlow } from '../utils/integratedBatteryFlow';
import { generateBatteryDispatchPolicy } from '../utils/batteryDispatchPolicy';
import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  SolarLoadFlowInterval,
} from '../types/energy';
import { AlignedLoadTimestamp } from '../utils/loadTimeAlignment';

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

function makePolicy(
  interval: SolarLoadFlowInterval,
  tierId: string,
  allowGridChargeFromGrid: boolean,
  allowBatteryDischargeToLoad: boolean,
  dayOfWeek = 0,
  hour = interval.sourceIndex
): BatteryDispatchPolicyInterval {
  return {
    sourceIndex: interval.sourceIndex,
    timestampUtc: interval.timestampUtc,
    tierId,
    allowGridChargeFromGrid,
    allowBatteryDischargeToLoad,
    dayOfWeek,
    hour,
  };
}

describe('G3H — Integrated Sequential Solar/Grid/Battery Flow', () => {
  describe('1. Renewable priority over grid charge', () => {
    it('gives solar first claim on charging power: solar uses 3 kWh of 5 kWh limit, grid uses at most 2 kWh', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      // Load = 1, Solar = 4 -> direct = 1, surplus = 3
      const inv = makeInterval(0, 1, 4);
      const pol = makePolicy(inv, 'off-peak', true, false);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.solarToBatteryAcKwh).toBe(3);
      expect(r.renewableEnergyStoredKwh).toBe(3);
      expect(r.requestedGridChargeAcKwh).toBe(2); // 5 - 3 = 2 kWh remaining
      expect(r.gridToBatteryAcKwh).toBe(2);
      expect(r.gridEnergyStoredKwh).toBe(2);
      expect(r.batterySocAfterKwh).toBe(5);
      expect(r.stateAfter.renewableChargedSocKwh).toBe(3);
      expect(r.stateAfter.gridChargedSocKwh).toBe(2);
    });
  });

  describe('2. Renewable fills capacity', () => {
    it('fills remaining battery room with solar surplus, leaving 0 capacity for grid charge', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 4,
        usableDodPercent: 100,
        maxContinuousChargeKw: 10,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 1 }); // 3 kWh room

      // Surplus solar = 5 kWh (more than 3 kWh room)
      const inv = makeInterval(0, 0, 5);
      const pol = makePolicy(inv, 'off-peak', true, false);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.solarToBatteryAcKwh).toBe(3);
      expect(r.renewableEnergyStoredKwh).toBe(3);
      expect(r.remainingSurplusSolarKwh).toBe(2);
      // Battery is now full (1 + 3 = 4 kWh)
      expect(r.gridToBatteryAcKwh).toBe(0);
      expect(r.gridEnergyStoredKwh).toBe(0);
      expect(r.batterySocAfterKwh).toBe(4);
    });
  });

  describe('3. Grid charge without solar', () => {
    it('charges from grid normally in a permitted tier when no solar is present', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 4,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      const inv = makeInterval(0, 0, 0); // idle solar/load
      const pol = makePolicy(inv, 'off-peak', true, false);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.solarToBatteryAcKwh).toBe(0);
      expect(r.gridToBatteryAcKwh).toBe(4);
      expect(r.gridEnergyStoredKwh).toBe(4);
      expect(r.batterySocAfterKwh).toBe(4);
      expect(r.stateAfter.gridChargedSocKwh).toBe(4);
    });
  });

  describe('4. Exact solar/load match + grid permission', () => {
    it('executes grid charging when solar exactly matches home load and battery has room', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 3,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      const inv = makeInterval(0, 3, 3); // solar direct = 3, residual = 0, surplus = 0
      const pol = makePolicy(inv, 'off-peak', true, false);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.solarDirectToLoadKwh).toBe(3);
      expect(r.solarToBatteryAcKwh).toBe(0);
      expect(r.gridToBatteryAcKwh).toBe(3);
      expect(r.gridEnergyStoredKwh).toBe(3);
      expect(r.batterySocAfterKwh).toBe(3);
    });
  });

  describe('5. Residual load + charge permission', () => {
    it('charges battery from grid while residual household load remains unmet', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 3,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      const inv = makeInterval(0, 4, 0); // residual load = 4
      const pol = makePolicy(inv, 'off-peak', true, false); // charge allowed, discharge false

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.gridToBatteryAcKwh).toBe(3);
      expect(r.batteryDeliveredToLoadKwh).toBe(0);
      expect(r.residualHomeLoadAfterBatteryKwh).toBe(4);
      expect(r.batterySocAfterKwh).toBe(3);
    });
  });

  describe('6. Discharge-only tier', () => {
    it('discharges battery to serve residual load when only discharge is permitted', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 5 });

      const inv = makeInterval(0, 4, 0);
      const pol = makePolicy(inv, 'on-peak', false, true);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.gridToBatteryAcKwh).toBe(0);
      expect(r.batteryDeliveredToLoadKwh).toBe(4);
      expect(r.residualHomeLoadAfterBatteryKwh).toBe(0);
      expect(r.batterySocAfterKwh).toBe(1);
    });
  });

  describe('7. Overlapping charge/discharge tier with room', () => {
    it('gives precedence to grid charging when both permissions are active and battery has room', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 4,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 100,
      });
      // Battery starts with 2 kWh (8 kWh room remaining)
      const initialState = createProvenanceState({ syntheticSocKwh: 2 });

      const inv = makeInterval(0, 3, 0); // 3 kWh residual load
      // Overlapping tier: both true
      const pol = makePolicy(inv, 'shoulder', true, true);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      // Grid charge wins!
      expect(r.gridToBatteryAcKwh).toBe(4);
      expect(r.gridEnergyStoredKwh).toBe(4);
      expect(r.batteryDeliveredToLoadKwh).toBe(0); // no discharge
      expect(r.residualHomeLoadAfterBatteryKwh).toBe(3); // residual load remains
      expect(r.batterySocAfterKwh).toBe(6);
    });
  });

  describe('8. Overlapping tier with full battery', () => {
    it('permits discharge when both permissions are active but battery is already full', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 100,
      });
      // Full battery: 10 kWh
      const initialState = createProvenanceState({ syntheticSocKwh: 10 });

      const inv = makeInterval(0, 3, 0); // 3 kWh residual load
      const pol = makePolicy(inv, 'shoulder', true, true);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      // Charging is unavailable because battery is full
      expect(r.gridToBatteryAcKwh).toBe(0);
      // Discharge occurs
      expect(r.batteryDeliveredToLoadKwh).toBe(3);
      expect(r.residualHomeLoadAfterBatteryKwh).toBe(0);
      expect(r.batterySocAfterKwh).toBe(7);
    });
  });

  describe('9. Alternating chronology', () => {
    it('chronologically routes grid charge -> discharge -> solar charge -> discharge across intervals', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 3,
        maxContinuousOutputKw: 5,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      // Interval 0: grid charge 3 kWh
      const inv0 = makeInterval(0, 0, 0);
      const pol0 = makePolicy(inv0, 'off-peak', true, false);

      // Interval 1: discharge 2 kWh
      const inv1 = makeInterval(1, 2, 0);
      const pol1 = makePolicy(inv1, 'on-peak', false, true);

      // Interval 2: solar charge 3 kWh
      const inv2 = makeInterval(2, 0, 3);
      const pol2 = makePolicy(inv2, 'off-peak', false, false);

      // Interval 3: discharge 2 kWh
      const inv3 = makeInterval(3, 2, 0);
      const pol3 = makePolicy(inv3, 'on-peak', false, true);

      const intervals = [inv0, inv1, inv2, inv3];
      const policies = [pol0, pol1, pol2, pol3];

      const result = routeIntegratedBatteryFlow(
        intervals,
        policies,
        1.0,
        profile,
        initialState
      );

      // Interval 0: SOC 0 -> 3 (grid)
      expect(result.intervals[0].batterySocBeforeKwh).toBe(0);
      expect(result.intervals[0].gridEnergyStoredKwh).toBe(3);
      expect(result.intervals[0].batterySocAfterKwh).toBe(3);

      // Interval 1: SOC 3 -> 1 (discharge)
      expect(result.intervals[1].batterySocBeforeKwh).toBe(3);
      expect(result.intervals[1].batteryDeliveredToLoadKwh).toBe(2);
      expect(result.intervals[1].batterySocAfterKwh).toBe(1);

      // Interval 2: SOC 1 -> 4 (solar)
      expect(result.intervals[2].batterySocBeforeKwh).toBe(1);
      expect(result.intervals[2].renewableEnergyStoredKwh).toBe(3);
      expect(result.intervals[2].batterySocAfterKwh).toBe(4);

      // Interval 3: SOC 4 -> 2 (discharge)
      expect(result.intervals[3].batterySocBeforeKwh).toBe(4);
      expect(result.intervals[3].batteryDeliveredToLoadKwh).toBe(2);
      expect(result.intervals[3].batterySocAfterKwh).toBe(2);

      // Boundary state continuity
      for (let i = 0; i < 3; i++) {
        expect(result.intervals[i].stateAfter).toEqual(
          result.intervals[i + 1].stateBefore
        );
      }
      expect(result.finalState).toEqual(result.intervals[3].stateAfter);
    });
  });

  describe('10. Renewable and grid provenance isolation', () => {
    it('increases renewable SOC from solar and grid SOC from grid without crosstalk', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState({
        syntheticSocKwh: 1,
        generatorChargedSocKwh: 1,
      });

      // Solar surplus = 2, grid charging allowed
      const inv = makeInterval(0, 0, 2);
      const pol = makePolicy(inv, 'off-peak', true, false);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.stateAfter.syntheticSocKwh).toBe(1);
      expect(r.stateAfter.generatorChargedSocKwh).toBe(1);
      expect(r.stateAfter.renewableChargedSocKwh).toBe(2);
      expect(r.stateAfter.gridChargedSocKwh).toBe(3); // 5 kW limit - 2 solar = 3 grid
      expect(r.batterySocAfterKwh).toBe(7);
    });
  });

  describe('11. Shared charge-power limit', () => {
    it('guarantees solarToBatteryAcKwh + gridToBatteryAcKwh never exceeds maxContinuousChargeKw * intervalHours', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 15,
        usableDodPercent: 100,
        maxContinuousChargeKw: 4, // 4 kWh AC max
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState();

      const inv = makeInterval(0, 0, 2.7); // 2.7 kWh solar surplus
      const pol = makePolicy(inv, 'off-peak', true, false);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.solarToBatteryAcKwh).toBe(2.7);
      expect(r.gridToBatteryAcKwh).toBeCloseTo(1.3, 10);
      expect(r.solarToBatteryAcKwh + r.gridToBatteryAcKwh).toBeCloseTo(4.0, 10);
    });
  });

  describe('12. Usable capacity limit', () => {
    it('ensures combined renewable and grid charging never exceeds usable capacity', () => {
      const profile = createMockBatteryProfile({
        totalCapacityKwh: 10,
        usableDodPercent: 80, // 8 kWh usable capacity
        maxContinuousChargeKw: 10,
        roundTripEfficiencyPercent: 100,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 5 }); // 3 kWh room

      const inv = makeInterval(0, 0, 2); // 2 kWh solar surplus
      const pol = makePolicy(inv, 'off-peak', true, false);

      const result = routeIntegratedBatteryFlow(
        [inv],
        [pol],
        1.0,
        profile,
        initialState
      );

      const r = result.intervals[0];
      expect(r.solarToBatteryAcKwh).toBe(2);
      expect(r.gridToBatteryAcKwh).toBe(1); // exactly fills remaining 1 kWh room
      expect(r.batterySocAfterKwh).toBe(8);
    });
  });

  describe('13. No simultaneous charge and discharge', () => {
    it('proves battery never charges and discharges simultaneously in any interval', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 90,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 3 });

      const intervals = [
        makeInterval(0, 0, 5), // solar charge
        makeInterval(1, 4, 0), // discharge
        makeInterval(2, 4, 0), // grid charge
        makeInterval(3, 2, 2), // idle match
        makeInterval(4, 5, 0), // overlapping tier
      ];

      const policies = [
        makePolicy(intervals[0], 'off-peak', false, false),
        makePolicy(intervals[1], 'on-peak', false, true),
        makePolicy(intervals[2], 'off-peak', true, false),
        makePolicy(intervals[3], 'off-peak', true, false),
        makePolicy(intervals[4], 'shoulder', true, true),
      ];

      const result = routeIntegratedBatteryFlow(
        intervals,
        policies,
        1.0,
        profile,
        initialState
      );

      for (const inv of result.intervals) {
        const chargingAc =
          inv.solarToBatteryAcKwh + inv.gridToBatteryAcKwh;
        const discharging = inv.batteryDeliveredToLoadKwh;

        expect(chargingAc === 0 || discharging === 0).toBe(true);
      }
    });
  });

  describe('14. SOC conservation', () => {
    it('verifies SOC delta equals renewable + grid stored minus energy drained', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 88,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 3 });

      const intervals = [
        makeInterval(0, 1, 5),
        makeInterval(1, 4, 0),
        makeInterval(2, 0, 3),
      ];
      const policies = [
        makePolicy(intervals[0], 'off-peak', true, false),
        makePolicy(intervals[1], 'on-peak', false, true),
        makePolicy(intervals[2], 'off-peak', true, false),
      ];

      const result = routeIntegratedBatteryFlow(
        intervals,
        policies,
        1.0,
        profile,
        initialState
      );

      for (const inv of result.intervals) {
        const expectedDelta =
          inv.renewableEnergyStoredKwh +
          inv.gridEnergyStoredKwh -
          inv.storedEnergyDrainedKwh;
        const actualDelta =
          inv.batterySocAfterKwh - inv.batterySocBeforeKwh;
        expect(actualDelta).toBeCloseTo(expectedDelta, 9);
      }
    });
  });

  describe('15. Solar and load conservation', () => {
    it('verifies AC solar balance and household demand balance for every interval', () => {
      const profile = createMockBatteryProfile({
        roundTripEfficiencyPercent: 92,
      });
      const initialState = createProvenanceState({ syntheticSocKwh: 4 });

      const intervals = [
        makeInterval(0, 2, 6),
        makeInterval(1, 5, 0),
        makeInterval(2, 3, 3),
        makeInterval(3, 4, 1),
      ];
      const policies = [
        makePolicy(intervals[0], 'off-peak', true, false),
        makePolicy(intervals[1], 'on-peak', false, true),
        makePolicy(intervals[2], 'off-peak', true, false),
        makePolicy(intervals[3], 'shoulder', true, true),
      ];

      const result = routeIntegratedBatteryFlow(
        intervals,
        policies,
        1.0,
        profile,
        initialState
      );

      for (const inv of result.intervals) {
        // Solar balance
        const solarSum =
          inv.solarDirectToLoadKwh +
          inv.solarToBatteryAcKwh +
          inv.remainingSurplusSolarKwh;
        expect(solarSum).toBeCloseTo(inv.solarGenerationKwh, 9);

        // Load balance
        const loadSum =
          inv.solarDirectToLoadKwh +
          inv.batteryDeliveredToLoadKwh +
          inv.residualHomeLoadAfterBatteryKwh;
        expect(loadSum).toBeCloseTo(inv.homeLoadKwh, 9);
      }
    });
  });

  describe('16. Policy alignment validation', () => {
    const profile = createMockBatteryProfile();
    const initialState = createProvenanceState();

    it('rejects policy length mismatch', () => {
      const inv0 = makeInterval(0, 2, 0);
      const inv1 = makeInterval(1, 2, 0);
      const pol0 = makePolicy(inv0, 'off-peak', true, false);

      expect(() =>
        routeIntegratedBatteryFlow(
          [inv0, inv1],
          [pol0],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/Policy length/i);
    });

    it('rejects sourceIndex mismatch', () => {
      const inv0 = makeInterval(0, 2, 0);
      const badPol = {
        ...makePolicy(inv0, 'off-peak', true, false),
        sourceIndex: 99,
      };

      expect(() =>
        routeIntegratedBatteryFlow(
          [inv0],
          [badPol],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/sourceIndex mismatch/i);
    });

    it('rejects timestampUtc mismatch', () => {
      const inv0 = makeInterval(0, 2, 0);
      const badPol = {
        ...makePolicy(inv0, 'off-peak', true, false),
        timestampUtc: '2099-01-01T00:00:00.000Z',
      };

      expect(() =>
        routeIntegratedBatteryFlow(
          [inv0],
          [badPol],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/timestampUtc mismatch/i);
    });

    it('rejects contradictory upstream flow with simultaneous residual load and surplus solar', () => {
      const badInv: SolarLoadFlowInterval = {
        sourceIndex: 0,
        sourceTimestamp: '2025-06-01 00:00',
        timestampUtc: '2025-06-01T00:00:00.000Z',
        homeLoadKwh: 5,
        solarGenerationKwh: 5,
        solarDirectToLoadKwh: 2,
        residualHomeLoadKwh: 3, // simultaneous positive
        surplusSolarKwh: 3,
      };
      const pol = makePolicy(badInv, 'off-peak', true, false);

      expect(() =>
        routeIntegratedBatteryFlow(
          [badInv],
          [pol],
          1.0,
          profile,
          initialState
        )
      ).toThrow(/contradictory upstream/i);
    });
  });

  describe('17. Input immutability', () => {
    it('does not mutate frozen inputs', () => {
      const profile = Object.freeze(
        createMockBatteryProfile({
          chargeTiers: Object.freeze(['off-peak']) as unknown as string[],
          dischargeTiers: Object.freeze(['on-peak']) as unknown as string[],
        })
      );
      const initialState = Object.freeze(
        createProvenanceState({ syntheticSocKwh: 2 })
      );

      const inv0 = Object.freeze(makeInterval(0, 2, 4));
      const pol0 = Object.freeze(makePolicy(inv0, 'off-peak', true, false));

      const intervals = Object.freeze([inv0]);
      const policies = Object.freeze([pol0]);

      expect(() => {
        routeIntegratedBatteryFlow(
          intervals as unknown as SolarLoadFlowInterval[],
          policies as unknown as BatteryDispatchPolicyInterval[],
          1.0,
          profile,
          initialState
        );
      }).not.toThrow();
    });
  });

  describe('18. Direct G3G compatibility', () => {
    it('accepts output of generateBatteryDispatchPolicy directly without transformation', () => {
      const schedule = Array.from({ length: 7 }, () =>
        Array.from({ length: 24 }, () => 'off-peak')
      );
      // Sunday 17:00 is on-peak
      schedule[0][17] = 'on-peak';

      const timestamps: AlignedLoadTimestamp[] = [
        {
          sourceIndex: 0,
          sourceTimestamp: '2025-06-01 16:00',
          instantUtc: new Date('2025-06-01T16:00:00.000Z'),
          timestampUtc: '2025-06-01T16:00:00.000Z',
        },
        {
          sourceIndex: 1,
          sourceTimestamp: '2025-06-01 17:00',
          instantUtc: new Date('2025-06-01T17:00:00.000Z'),
          timestampUtc: '2025-06-01T17:00:00.000Z',
        },
      ];

      const profile = createMockBatteryProfile({
        chargeTiers: ['off-peak'],
        dischargeTiers: ['on-peak'],
      });

      // Directly generate policy using G3G
      const policies = generateBatteryDispatchPolicy(
        timestamps,
        'UTC',
        schedule,
        profile
      );

      const intervals: SolarLoadFlowInterval[] = [
        makeInterval(0, 0, 0, timestamps[0].timestampUtc, timestamps[0].sourceTimestamp),
        makeInterval(1, 3, 0, timestamps[1].timestampUtc, timestamps[1].sourceTimestamp),
      ];

      const initialState = createProvenanceState();

      // Pass directly to routeIntegratedBatteryFlow
      const result = routeIntegratedBatteryFlow(
        intervals,
        policies,
        1.0,
        profile,
        initialState
      );

      // Interval 0 (off-peak): grid charges
      expect(result.intervals[0].gridToBatteryAcKwh).toBe(5);
      expect(result.intervals[0].batterySocAfterKwh).toBe(5);

      // Interval 1 (on-peak): battery discharges to load
      expect(result.intervals[1].batteryDeliveredToLoadKwh).toBe(3);
      expect(result.intervals[1].residualHomeLoadAfterBatteryKwh).toBe(0);
      expect(result.intervals[1].batterySocAfterKwh).toBe(2);
    });
  });
});
