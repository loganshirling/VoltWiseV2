import { describe, it, expect } from 'vitest';
import { runAnnualSimulation, ScheduleMatrix } from '../utils/simulationEngine';
import { BatteryProfile, IntervalDataPoint, RateTier } from '../types/energy';

describe('Dispatch Physics & Bounds Regressions', () => {
  const tiers: RateTier[] = [
    {
      id: 'off-peak',
      name: 'Off-Peak',
      buyRate: 0.15,
      sellRate: 0.05,
      color: '#10b981',
      isChargeWindow: true,
      isDischargeWindow: false,
    },
    {
      id: 'peak',
      name: 'On-Peak',
      buyRate: 0.55,
      sellRate: 0.25,
      color: '#ef4444',
      isChargeWindow: false,
      isDischargeWindow: true,
    },
  ];

  // Schedule matrix: hours 16..20 are 'peak', all others are 'off-peak'
  const scheduleMatrix: ScheduleMatrix = Array.from({ length: 7 }, () =>
    Array.from({ length: 24 }, (_, h) => (h >= 16 && h < 21 ? 'peak' : 'off-peak'))
  );

  // --------------------------------------------------------------------------
  // Group A: Self-Consumption Tier Authority
  // --------------------------------------------------------------------------
  describe('Group A — Self-consumption tier authority', () => {
    it('Test A1: empty discharge tiers blocks discharging even when tariff isDischargeWindow is true', () => {
      const batteryProfile: BatteryProfile = {
        id: 'sc-empty-tiers',
        name: 'Empty Tiers Battery',
        model: '10 kWh',
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 5,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 100,
        ratedCycleLife: 4000,
        installedCost: 8000,
        strategy: 'self_consumption',
        chargeTiers: ['off-peak'],
        dischargeTiers: [], // Explicitly empty: user does NOT want discharging in any tier
        allowGridExport: false,
      };

      // Interval at hour 17 (Peak, where tier.isDischargeWindow === true) with positive home load
      const points: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 17:00',
          date: new Date('2025-01-01T17:00:00Z'),
          hour: 17,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 2.0,
        },
      ];

      const result = runAnnualSimulation(points, 1.0, tiers, scheduleMatrix, batteryProfile);
      const interval = result.intervalResults[0];

      // Battery begins with 50% synthetic SOC (5 kWh) and home load is 2.0 kWh,
      // but because dischargeTiers is empty, battery must not discharge.
      expect(interval.batteryDischargeKwh).toBe(0);
      expect(interval.gridImportKwh).toBe(2.0);
    });

    it('Test A2: allowed discharge tier allows discharge to offset home load up to limits', () => {
      const batteryProfile: BatteryProfile = {
        id: 'sc-peak-tier',
        name: 'Peak Tier Battery',
        model: '10 kWh',
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 5,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 100,
        ratedCycleLife: 4000,
        installedCost: 8000,
        strategy: 'self_consumption',
        chargeTiers: [],
        dischargeTiers: ['peak'], // Configured to discharge during peak
        allowGridExport: false,
      };

      // Interval at hour 17 (Peak tier) with positive home load (2.0 kWh)
      const points: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 17:00',
          date: new Date('2025-01-01T17:00:00Z'),
          hour: 17,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 2.0,
        },
      ];

      const result = runAnnualSimulation(points, 1.0, tiers, scheduleMatrix, batteryProfile);
      const interval = result.intervalResults[0];

      // Battery has 5 kWh synthetic SOC; offsets 2.0 kWh load entirely
      expect(interval.batteryDischargeKwh).toBe(2.0);
      expect(interval.gridImportKwh).toBe(0);
      expect(interval.batterySocKwh).toBe(3.0);
    });

    it('Test A3: disallowed discharge tier prevents discharge during non-configured tiers', () => {
      const batteryProfile: BatteryProfile = {
        id: 'sc-peak-only',
        name: 'Peak Only Battery',
        model: '10 kWh',
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 5,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 100,
        ratedCycleLife: 4000,
        installedCost: 8000,
        strategy: 'self_consumption',
        chargeTiers: [],
        dischargeTiers: ['peak'], // Only peak is configured
        allowGridExport: false,
      };

      // Interval at hour 10 (Off-peak tier) with home load
      const points: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 10:00',
          date: new Date('2025-01-01T10:00:00Z'),
          hour: 10,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 2.5,
        },
      ];

      const result = runAnnualSimulation(points, 1.0, tiers, scheduleMatrix, batteryProfile);
      const interval = result.intervalResults[0];

      // Disallowed tier prevents discharge despite battery having 50% SOC and home having load
      expect(interval.batteryDischargeKwh).toBe(0);
      expect(interval.gridImportKwh).toBe(2.5);
    });
  });

  // --------------------------------------------------------------------------
  // Group B: Synthetic Initial SOC Must Never Be Exported
  // --------------------------------------------------------------------------
  describe('Group B — Synthetic initial SOC must never be exported', () => {
    it('Test B1: synthetic starting energy cannot be sold to grid under arbitrage mode', () => {
      const highSellTiers: RateTier[] = [
        {
          id: 'off-peak',
          name: 'Off-Peak',
          buyRate: 0.10,
          sellRate: 0.05,
          color: '#10b981',
        },
        {
          id: 'peak',
          name: 'Extreme Sell Peak',
          buyRate: 0.60,
          sellRate: 2.50, // Extremely high sell price tempting arbitrage export
          color: '#ef4444',
        },
      ];

      const batteryProfile: BatteryProfile = {
        id: 'arbitrage-export-bat',
        name: 'Arbitrage Export Battery',
        model: '10 kWh',
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 5,
        maxContinuousChargeKw: 5,
        roundTripEfficiencyPercent: 100,
        ratedCycleLife: 4000,
        installedCost: 8000,
        strategy: 'arbitrage',
        chargeTiers: ['off-peak'],
        dischargeTiers: ['peak'],
        allowGridExport: true, // Grid export is enabled
      };

      // Provide exactly one discharge-tier interval, zero home load, very high sell price,
      // and NO prior grid-charging interval.
      const points: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 17:00', // Peak hour
          date: new Date('2025-01-01T17:00:00Z'),
          hour: 17,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 0, // Zero home load
        },
      ];

      const result = runAnnualSimulation(points, 1.0, highSellTiers, scheduleMatrix, batteryProfile);
      const interval = result.intervalResults[0];

      // Synthetic initial SOC has no known acquisition cost; it must NEVER be sold to the grid.
      expect(interval.gridExportKwh).toBe(0);
      expect(interval.batteryDischargeKwh).toBe(0);
      // Battery SOC remains undisturbed at initial 5.0 kWh (50% of 10 kWh)
      expect(interval.batterySocKwh).toBe(5.0);
    });
  });

  // --------------------------------------------------------------------------
  // Group C: State of Charge (SOC) Bounds
  // --------------------------------------------------------------------------
  describe('Group C — State of Charge (SOC) bounds', () => {
    it('Test C1: strict SOC kWh and percentage bounds maintained through aggressive cycling sequence', () => {
      const totalCapacity = 13.5;
      const dodPercent = 90; // 90% DoD -> usableCapacity = 12.15 kWh
      const usableCapacityKwh = totalCapacity * (dodPercent / 100);

      const batteryProfile: BatteryProfile = {
        id: 'cycling-battery',
        name: 'Cycling Battery',
        model: '13.5 kWh',
        totalCapacityKwh: totalCapacity,
        usableDodPercent: dodPercent,
        maxContinuousOutputKw: 5.0,
        maxContinuousChargeKw: 5.0,
        roundTripEfficiencyPercent: 88,
        ratedCycleLife: 4000,
        installedCost: 10000,
        strategy: 'arbitrage',
        chargeTiers: ['off-peak'],
        dischargeTiers: ['peak'],
        allowGridExport: true,
      };

      // Construct a sequence of intervals with alternating aggressive charge and discharge requests:
      // Hours 0..5 (off-peak): aggressive charging (6 hours * 5 kW = 30 kWh attempted charge)
      // Hours 16..21 (peak): aggressive discharging with 10 kWh home load per hour
      // Hours 0..5 (off-peak, next day): aggressive charging
      // Hours 16..21 (peak, next day): aggressive discharging with 0 kWh home load and high export rate
      const points: IntervalDataPoint[] = [];

      // Day 1: 6 hours charging
      for (let h = 0; h < 6; h++) {
        points.push({
          timestamp: `2025-01-01 ${String(h).padStart(2, '0')}:00`,
          date: new Date(`2025-01-01T${String(h).padStart(2, '0')}:00:00Z`),
          hour: h,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 0.1,
        });
      }

      // Day 1: 5 hours aggressive discharging
      for (let h = 16; h < 21; h++) {
        points.push({
          timestamp: `2025-01-01 ${h}:00`,
          date: new Date(`2025-01-01T${h}:00:00Z`),
          hour: h,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 8.0, // Large home load demanding maximum discharge
        });
      }

      // Day 2: 6 hours aggressive charging
      for (let h = 0; h < 6; h++) {
        points.push({
          timestamp: `2025-01-02 ${String(h).padStart(2, '0')}:00`,
          date: new Date(`2025-01-02T${String(h).padStart(2, '0')}:00:00Z`),
          hour: h,
          dayOfWeek: 4,
          month: 0,
          usageKwh: 0.2,
        });
      }

      // Day 2: 5 hours aggressive discharging with export opportunity
      for (let h = 16; h < 21; h++) {
        points.push({
          timestamp: `2025-01-02 ${h}:00`,
          date: new Date(`2025-01-02T${h}:00:00Z`),
          hour: h,
          dayOfWeek: 4,
          month: 0,
          usageKwh: 7.0,
        });
      }

      const result = runAnnualSimulation(points, 1.0, tiers, scheduleMatrix, batteryProfile);

      expect(result.intervalResults.length).toBe(points.length);

      const tolerance = 1e-4;

      // Assert after EVERY interval that SOC remains within strictly valid physics bounds
      result.intervalResults.forEach((interval, idx) => {
        expect(interval.batterySocKwh).toBeGreaterThanOrEqual(-tolerance);
        expect(interval.batterySocKwh).toBeLessThanOrEqual(usableCapacityKwh + tolerance);

        expect(interval.batterySocPercent).toBeGreaterThanOrEqual(-tolerance);
        expect(interval.batterySocPercent).toBeLessThanOrEqual(100.0 + tolerance);

        // Ensure non-negative flows
        expect(interval.batteryChargeKwh).toBeGreaterThanOrEqual(0);
        expect(interval.batteryDischargeKwh).toBeGreaterThanOrEqual(0);
        expect(interval.gridImportKwh).toBeGreaterThanOrEqual(0);
        expect(interval.gridExportKwh).toBeGreaterThanOrEqual(0);
      });
    });
  });

  // --------------------------------------------------------------------------
  // Group D: Power Limits, Round-Trip Efficiency & Economic Sanity
  // --------------------------------------------------------------------------
  describe('Group D — Power Limits, RTE & Economic Invariants', () => {
    it('Item 1: respects charge-power limit with square-root efficiency over 15-minute interval', () => {
      // intervalHours = 0.25, maxContinuousChargeKw = 4, RTE = 81%
      // etaCharge = sqrt(0.81) = 0.9
      // max stored energy = 4 kW * 0.25 h * 0.9 = 0.9 kWh
      const batteryProfile: BatteryProfile = {
        id: 'charge-power-bat',
        name: 'Charge Power Battery',
        model: '20 kWh',
        totalCapacityKwh: 20,
        usableDodPercent: 100, // usable 20 kWh, starts at 10 kWh synthetic SOC, plenty of headroom
        maxContinuousOutputKw: 4,
        maxContinuousChargeKw: 4,
        roundTripEfficiencyPercent: 81,
        ratedCycleLife: 4000,
        installedCost: 10000,
        strategy: 'arbitrage',
        chargeTiers: ['off-peak'],
        dischargeTiers: ['peak'],
        allowGridExport: false,
      };

      const points: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 02:00',
          date: new Date('2025-01-01T02:00:00Z'),
          hour: 2, // Off-peak (charge tier)
          dayOfWeek: 3,
          month: 0,
          usageKwh: 0.5,
        },
      ];

      const result = runAnnualSimulation(points, 0.25, tiers, scheduleMatrix, batteryProfile);
      const interval = result.intervalResults[0];

      expect(interval.batteryChargeKwh).toBeCloseTo(0.9, 4);
      expect(interval.batteryChargeKwh).toBeLessThanOrEqual(0.9 + 1e-6);
    });

    it('Item 2: respects discharge-power limit over 15-minute interval', () => {
      // intervalHours = 0.25, maxContinuousOutputKw = 4 kW
      // Maximum AC energy output = 4 kW * 0.25 h = 1.0 kWh
      const batteryProfile: BatteryProfile = {
        id: 'discharge-power-bat',
        name: 'Discharge Power Battery',
        model: '10 kWh',
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 4,
        maxContinuousChargeKw: 4,
        roundTripEfficiencyPercent: 81,
        ratedCycleLife: 4000,
        installedCost: 8000,
        strategy: 'arbitrage',
        chargeTiers: ['off-peak'],
        dischargeTiers: ['peak'],
        allowGridExport: false,
      };

      const points: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 17:00',
          date: new Date('2025-01-01T17:00:00Z'),
          hour: 17, // Peak (discharge tier)
          dayOfWeek: 3,
          month: 0,
          usageKwh: 5.0, // High demand demanding maximum discharge
        },
      ];

      const result = runAnnualSimulation(points, 0.25, tiers, scheduleMatrix, batteryProfile);
      const interval = result.intervalResults[0];

      expect(interval.batteryDischargeKwh).toBeCloseTo(1.0, 4);
      expect(interval.batteryDischargeKwh).toBeLessThanOrEqual(1.0 + 1e-6);
    });

    it('Item 3: verifies closed-cycle round-trip efficiency of 81% (0.9 charge * 0.9 discharge)', () => {
      const batteryProfile: BatteryProfile = {
        id: 'rte-test-bat',
        name: 'RTE Battery',
        model: '10 kWh',
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 10,
        maxContinuousChargeKw: 10,
        roundTripEfficiencyPercent: 81, // etaCharge = 0.9, etaDischarge = 0.9
        ratedCycleLife: 4000,
        installedCost: 8000,
        strategy: 'arbitrage',
        chargeTiers: ['off-peak'],
        dischargeTiers: ['peak'],
        allowGridExport: false,
      };

      // Interval 0 (Bootstrap): Hour 17 (Peak), large load = 10 kWh to exhaust 5.0 kWh synthetic starting SOC.
      // Available AC from 5 kWh DC synthetic: 5 * 0.9 = 4.5 kWh AC. Battery drained to 0.
      // Interval 1 (Grid-Charge): Hour 2 (Off-peak), load = 0, charges 10 kW * 1 h * 0.9 = 9.0 kWh stored.
      // Grid AC consumed for battery = 9.0 / 0.9 = 10.0 kWh.
      // Interval 2 (Discharge): Hour 17 (Peak), load = 10 kWh.
      // Available AC from 9 kWh DC: 9.0 * 0.9 = 8.1 kWh AC.
      const points: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 17:00',
          date: new Date('2025-01-01T17:00:00Z'),
          hour: 17,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 10.0,
        },
        {
          timestamp: '2025-01-02 02:00',
          date: new Date('2025-01-02T02:00:00Z'),
          hour: 2,
          dayOfWeek: 4,
          month: 0,
          usageKwh: 0,
        },
        {
          timestamp: '2025-01-02 17:00',
          date: new Date('2025-01-02T17:00:00Z'),
          hour: 17,
          dayOfWeek: 4,
          month: 0,
          usageKwh: 10.0,
        },
      ];

      const result = runAnnualSimulation(points, 1.0, tiers, scheduleMatrix, batteryProfile);

      // Verify bootstrap interval exhausted synthetic starting SOC
      expect(result.intervalResults[0].batterySocKwh).toBe(0);

      // Interval 1: Grid charging
      const chargeInterval = result.intervalResults[1];
      const gridAcChargingInput = chargeInterval.gridImportKwh; // load is 0, so import is gridForBat
      expect(gridAcChargingInput).toBeCloseTo(10.0, 4);
      expect(chargeInterval.batteryChargeKwh).toBeCloseTo(9.0, 4);

      // Interval 2: Discharging grid-charged energy
      const dischargeInterval = result.intervalResults[2];
      const acDischargeOutput = dischargeInterval.batteryDischargeKwh;
      expect(acDischargeOutput).toBeCloseTo(8.1, 4);

      // Round-trip efficiency across the closed grid-charged cycle:
      const measuredRte = acDischargeOutput / gridAcChargingInput;
      const expectedRte = 0.81;
      expect(measuredRte).toBeCloseTo(expectedRte, 4);
    });

    it('Item 4: flat-rate economic sanity: closed grid-charged cycle with RTE < 100% must not create savings', () => {
      // Same buy rate during charge and discharge ($0.30/kWh)
      const flatTiers: RateTier[] = [
        {
          id: 'off-peak',
          name: 'Flat Off-Peak',
          buyRate: 0.30,
          sellRate: 0.05,
          color: '#10b981',
        },
        {
          id: 'peak',
          name: 'Flat Peak',
          buyRate: 0.30, // Identical buy rate as off-peak
          sellRate: 0.05,
          color: '#ef4444',
        },
      ];

      const batteryProfile: BatteryProfile = {
        id: 'flat-rate-bat',
        name: 'Flat Rate Battery',
        model: '10 kWh',
        totalCapacityKwh: 10,
        usableDodPercent: 100,
        maxContinuousOutputKw: 10,
        maxContinuousChargeKw: 10,
        roundTripEfficiencyPercent: 81, // 81% RTE introduces 19% energy losses
        ratedCycleLife: 4000,
        installedCost: 8000,
        strategy: 'arbitrage',
        chargeTiers: ['off-peak'],
        dischargeTiers: ['peak'],
        allowGridExport: false,
      };

      // Interval 0: Bootstrap interval to exhaust initial synthetic 50% SOC
      // Interval 1: Grid-charge at $0.30/kWh (10 kWh grid import = $3.00 cost, stores 9.0 kWh)
      // Interval 2: Discharge at $0.30/kWh (delivers 8.1 kWh AC to offset $2.43 load)
      const points: IntervalDataPoint[] = [
        {
          timestamp: '2025-01-01 17:00',
          date: new Date('2025-01-01T17:00:00Z'),
          hour: 17,
          dayOfWeek: 3,
          month: 0,
          usageKwh: 10.0,
        },
        {
          timestamp: '2025-01-02 02:00',
          date: new Date('2025-01-02T02:00:00Z'),
          hour: 2,
          dayOfWeek: 4,
          month: 0,
          usageKwh: 0,
        },
        {
          timestamp: '2025-01-02 17:00',
          date: new Date('2025-01-02T17:00:00Z'),
          hour: 17,
          dayOfWeek: 4,
          month: 0,
          usageKwh: 10.0,
        },
      ];

      const result = runAnnualSimulation(points, 1.0, flatTiers, scheduleMatrix, batteryProfile);

      // Isolate the closed grid-charge and discharge intervals (intervals 1 and 2)
      const closedCycleSavings =
        result.intervalResults[1].netSavings + result.intervalResults[2].netSavings;

      // Because buy rates are equal and RTE < 100%, conversion losses strictly produce negative savings:
      // Interval 1: baseline = $0, simulated = $3.00, savings = -$3.00
      // Interval 2: baseline = $3.00 (10 kWh * $0.30), simulated = 1.9 kWh grid * $0.30 = $0.57, savings = +$2.43
      // Total net savings = -$3.00 + $2.43 = -$0.57
      expect(closedCycleSavings).toBeLessThanOrEqual(0);
      expect(closedCycleSavings).toBeCloseTo(-0.57, 2);
    });
  });
});
