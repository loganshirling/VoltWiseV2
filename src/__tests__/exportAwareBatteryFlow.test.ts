import { describe, it, expect } from 'vitest';
import { routeExportAwareBatteryFlow } from '../utils/exportAwareBatteryFlow';
import { resolveTariffRates } from '../utils/tariffRateResolver';
import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
  BatterySocProvenanceState,
  GridSocCostBasisState,
  RateTier,
  ResolvedTariffRateInterval,
  SolarLoadFlowInterval,
} from '../types/energy';
import { AlignedLoadTimestamp } from '../utils/loadTimeAlignment';

function createDefaultProfile(
  overrides: Partial<BatteryProfile> = {}
): BatteryProfile {
  return {
    id: 'test-battery',
    name: 'Test Battery',
    model: 'VoltCell-10',
    totalCapacityKwh: 10,
    usableDodPercent: 100,
    maxContinuousChargeKw: 5,
    maxContinuousOutputKw: 5,
    roundTripEfficiencyPercent: 100, // 100% RTE => etaDischarge = 1.0
    ratedCycleLife: 4000,
    installedCost: 8000,
    strategy: 'arbitrage',
    chargeTiers: ['off-peak'],
    dischargeTiers: ['on-peak'],
    allowGridExport: true,
    ...overrides,
  };
}

const zeroBatteryState: BatterySocProvenanceState = {
  syntheticSocKwh: 0,
  gridChargedSocKwh: 0,
  renewableChargedSocKwh: 0,
  generatorChargedSocKwh: 0,
};

const zeroCostBasisState: GridSocCostBasisState = {
  gridStoredEnergyKwh: 0,
  totalAcquisitionCostUsd: 0,
};

function createMockInterval(
  index: number,
  options: {
    timestampUtc?: string;
    sourceTimestamp?: string;
    homeLoadKwh?: number;
    solarGenerationKwh?: number;
    solarDirectToLoadKwh?: number;
    residualHomeLoadKwh?: number;
    surplusSolarKwh?: number;
  } = {}
): SolarLoadFlowInterval {
  const pad = String(index).padStart(2, '0');
  const timestampUtc =
    options.timestampUtc ?? `2025-06-01T${pad}:00:00.000Z`;
  const sourceTimestamp =
    options.sourceTimestamp ?? `2025-06-01 ${pad}:00`;
  const homeLoadKwh = options.homeLoadKwh ?? 0;
  const solarGenerationKwh = options.solarGenerationKwh ?? 0;
  const solarDirectToLoadKwh = options.solarDirectToLoadKwh ?? 0;
  const residualHomeLoadKwh = options.residualHomeLoadKwh ?? homeLoadKwh;
  const surplusSolarKwh = options.surplusSolarKwh ?? solarGenerationKwh;

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

function createMockPolicy(
  index: number,
  options: {
    timestampUtc?: string;
    tierId?: string;
    allowGridChargeFromGrid?: boolean;
    allowBatteryDischargeToLoad?: boolean;
    dayOfWeek?: number;
    hour?: number;
  } = {}
): BatteryDispatchPolicyInterval {
  const pad = String(index).padStart(2, '0');
  const timestampUtc =
    options.timestampUtc ?? `2025-06-01T${pad}:00:00.000Z`;

  return {
    sourceIndex: index,
    timestampUtc,
    tierId: options.tierId ?? 'off-peak',
    allowGridChargeFromGrid: options.allowGridChargeFromGrid ?? false,
    allowBatteryDischargeToLoad: options.allowBatteryDischargeToLoad ?? false,
    dayOfWeek: options.dayOfWeek ?? 0,
    hour: options.hour ?? index,
  };
}

function createMockRate(
  index: number,
  options: {
    timestampUtc?: string;
    tierId?: string;
    tierName?: string;
    buyRate?: number;
    sellRate?: number;
    localMonth?: number;
  } = {}
): ResolvedTariffRateInterval {
  const pad = String(index).padStart(2, '0');
  const timestampUtc =
    options.timestampUtc ?? `2025-06-01T${pad}:00:00.000Z`;

  return {
    sourceIndex: index,
    timestampUtc,
    tierId: options.tierId ?? 'off-peak',
    tierName: options.tierName ?? 'Off Peak',
    buyRate: options.buyRate ?? 0.1,
    sellRate: options.sellRate ?? 0.05,
    localMonth: options.localMonth ?? 5,
  };
}

describe('Chronological Grid-SOC Battery Export Integration Engine (Milestone G3O)', () => {
  // 1. low-price grid charge -> later profitable grid export
  it('1. charges battery at low price then dispatches profitable grid export later', () => {
    const profile = createDefaultProfile();
    const intervals = [
      createMockInterval(0, { homeLoadKwh: 0, solarGenerationKwh: 0 }),
      createMockInterval(1, { homeLoadKwh: 0, solarGenerationKwh: 0 }),
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'off-peak',
        allowGridChargeFromGrid: true,
        allowBatteryDischargeToLoad: false,
      }),
      createMockPolicy(1, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'off-peak',
        buyRate: 0.1,
        sellRate: 0.02,
      }),
      createMockRate(1, {
        tierId: 'on-peak',
        buyRate: 0.6,
        sellRate: 0.45,
      }),
    ];

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      zeroBatteryState,
      zeroCostBasisState
    );

    expect(result.intervals).toHaveLength(2);

    // Interval 0: grid charging
    const int0 = result.intervals[0];
    expect(int0.gridChargeBranchSelected).toBe(true);
    expect(int0.preExportFlow.gridToBatteryAcKwh).toBe(5);
    expect(int0.preExportFlow.gridEnergyStoredKwh).toBe(5);
    expect(int0.gridChargeAcquisitionCostUsd).toBeCloseTo(0.5, 6);
    expect(int0.costBasisAfterHomeDispatch.gridStoredEnergyKwh).toBe(5);
    expect(int0.costBasisAfterHomeDispatch.totalAcquisitionCostUsd).toBeCloseTo(
      0.5,
      6
    );
    expect(int0.allowBatteryExportInInterval).toBe(false);
    expect(int0.exportResult.batteryExportAcKwh).toBe(0);
    expect(int0.batteryStateAfterExport.gridChargedSocKwh).toBe(5);

    // Interval 1: profitable export
    const int1 = result.intervals[1];
    expect(int1.gridChargeBranchSelected).toBe(false);
    expect(int1.allowBatteryExportInInterval).toBe(true);
    expect(int1.exportResult.exportEconomic).toBe(true);
    expect(int1.exportResult.batteryExportAcKwh).toBe(5);
    expect(int1.exportResult.exportRevenueUsd).toBeCloseTo(5 * 0.45, 6); // $2.25
    expect(int1.exportResult.gridSocCostRemovedForExportUsd).toBeCloseTo(
      0.5,
      6
    );
    expect(int1.exportResult.exportGrossMarginUsd).toBeCloseTo(
      2.25 - 0.5,
      6
    ); // $1.75
    expect(int1.batteryStateAfterExport.gridChargedSocKwh).toBe(0);
    expect(int1.costBasisStateAfterExport.gridStoredEnergyKwh).toBe(0);
    expect(int1.costBasisStateAfterExport.totalAcquisitionCostUsd).toBe(0);

    // Result level totals
    expect(result.totalBatteryExportAcKwh).toBe(5);
    expect(result.totalExportRevenueUsd).toBeCloseTo(2.25, 6);
    expect(result.totalExportGrossMarginUsd).toBeCloseTo(1.75, 6);
    expect(result.totalGridSocCostRemovedForExportUsd).toBeCloseTo(0.5, 6);
    expect(result.finalBatteryState.gridChargedSocKwh).toBe(0);
    expect(result.finalCostBasisState.gridStoredEnergyKwh).toBe(0);
  });

  // 2. unprofitable sell rate -> no export
  it('2. does not export when sell rate is lower than effective delivery cost', () => {
    const profile = createDefaultProfile();
    const intervals = [
      createMockInterval(0, { homeLoadKwh: 0, solarGenerationKwh: 0 }),
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'mid-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'mid-peak',
        buyRate: 0.35,
        sellRate: 0.15, // $0.15 < acquisition cost $0.25
      }),
    ];

    const initialBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 6,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 6,
      totalAcquisitionCostUsd: 1.5, // $0.25/kWh
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    expect(int0.allowBatteryExportInInterval).toBe(true);
    expect(int0.exportResult.exportEconomic).toBe(false);
    expect(int0.exportResult.batteryExportAcKwh).toBe(0);
    expect(int0.exportResult.exportRevenueUsd).toBe(0);
    expect(int0.batteryStateAfterExport.gridChargedSocKwh).toBe(6);
    expect(int0.costBasisStateAfterExport.gridStoredEnergyKwh).toBe(6);
    expect(int0.costBasisStateAfterExport.totalAcquisitionCostUsd).toBe(1.5);
    expect(result.totalBatteryExportAcKwh).toBe(0);
  });

  // 3. household discharge consumes inverter capacity before export
  it('3. household discharge consumes inverter capacity before remaining capacity is exported', () => {
    const profile = createDefaultProfile({
      maxContinuousOutputKw: 5,
    });
    // Inverter limit = 5 kWh
    const intervals = [
      createMockInterval(0, {
        homeLoadKwh: 3,
        solarGenerationKwh: 0,
        residualHomeLoadKwh: 3,
      }),
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'on-peak',
        buyRate: 0.6,
        sellRate: 0.45,
      }),
    ];

    const initialBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 8,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 8,
      totalAcquisitionCostUsd: 0.8, // $0.10/kWh
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    // Household discharge should take 3 kWh
    expect(int0.preExportFlow.batteryDeliveredToLoadKwh).toBe(3);
    expect(int0.preExportFlow.residualHomeLoadAfterBatteryKwh).toBe(0);

    // Remaining inverter capacity is 5 - 3 = 2 kWh
    expect(int0.exportResult.remainingDischargeCapacityAcKwh).toBe(2);
    expect(int0.exportResult.batteryExportAcKwh).toBe(2);

    // Total drain from battery: 3 (home) + 2 (export) = 5 kWh. Remaining = 3 kWh.
    expect(int0.batteryStateAfterExport.gridChargedSocKwh).toBe(3);
    expect(int0.costBasisStateAfterExport.gridStoredEnergyKwh).toBe(3);
    expect(int0.costBasisStateAfterExport.totalAcquisitionCostUsd).toBeCloseTo(
      0.3,
      6
    );
  });

  // 4. full household inverter usage leaves zero export
  it('4. leaves zero export when household load consumes entire inverter discharge capacity', () => {
    const profile = createDefaultProfile({
      maxContinuousOutputKw: 5,
    });
    const intervals = [
      createMockInterval(0, {
        homeLoadKwh: 6, // exceeds 5 kW inverter
        solarGenerationKwh: 0,
        residualHomeLoadKwh: 6,
      }),
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'on-peak',
        buyRate: 0.6,
        sellRate: 0.5,
      }),
    ];

    const initialBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 8,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 8,
      totalAcquisitionCostUsd: 0.8,
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    expect(int0.preExportFlow.batteryDeliveredToLoadKwh).toBe(5);
    expect(int0.exportResult.remainingDischargeCapacityAcKwh).toBe(0);
    expect(int0.exportResult.batteryExportAcKwh).toBe(0);
    expect(int0.batteryStateAfterExport.gridChargedSocKwh).toBe(3);
  });

  // 5. synthetic/renewable/generator SOC never exported
  it('5. never exports synthetic, renewable, or generator SOC even if sell rate is high', () => {
    const profile = createDefaultProfile();
    const intervals = [
      createMockInterval(0, { homeLoadKwh: 0, solarGenerationKwh: 0 }),
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'on-peak',
        buyRate: 0.6,
        sellRate: 0.5,
      }),
    ];

    const initialBattery: BatterySocProvenanceState = {
      syntheticSocKwh: 2,
      renewableChargedSocKwh: 3,
      generatorChargedSocKwh: 2,
      gridChargedSocKwh: 0,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 0,
      totalAcquisitionCostUsd: 0,
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    expect(int0.exportResult.batteryExportAcKwh).toBe(0);
    expect(int0.batteryStateAfterExport.syntheticSocKwh).toBe(2);
    expect(int0.batteryStateAfterExport.renewableChargedSocKwh).toBe(3);
    expect(int0.batteryStateAfterExport.generatorChargedSocKwh).toBe(2);
    expect(int0.batteryStateAfterExport.gridChargedSocKwh).toBe(0);
  });

  // 6. self_consumption mode never exports
  it('6. never exports stored battery energy in self_consumption strategy mode', () => {
    const profile = createDefaultProfile({
      strategy: 'self_consumption',
      allowGridExport: true,
    });
    const intervals = [
      createMockInterval(0, { homeLoadKwh: 0, solarGenerationKwh: 0 }),
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'on-peak',
        buyRate: 0.8,
        sellRate: 0.75, // very lucrative sell rate
      }),
    ];

    const initialBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 6,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 6,
      totalAcquisitionCostUsd: 0.6,
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    expect(int0.allowBatteryExportInInterval).toBe(false);
    expect(int0.exportResult.exportAllowed).toBe(false);
    expect(int0.exportResult.batteryExportAcKwh).toBe(0);
    expect(int0.batteryStateAfterExport.gridChargedSocKwh).toBe(6);
  });

  // 7. overlapping charge/discharge tier with battery room -> charge wins, no export
  it('7. gives precedence to grid charging when both charge and discharge are allowed and battery has room', () => {
    const profile = createDefaultProfile({
      totalCapacityKwh: 10,
    });
    const intervals = [
      createMockInterval(0, { homeLoadKwh: 1, solarGenerationKwh: 0 }),
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'mid-peak',
        allowGridChargeFromGrid: true,
        allowBatteryDischargeToLoad: true, // both active
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'mid-peak',
        buyRate: 0.2,
        sellRate: 0.4,
      }),
    ];

    // Battery at 4 kWh, usable capacity = 10 kWh (room = 6 kWh)
    const initialBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 4,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 4,
      totalAcquisitionCostUsd: 0.4,
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    expect(int0.gridChargeBranchSelected).toBe(true);
    expect(int0.allowBatteryExportInInterval).toBe(false);
    expect(int0.preExportFlow.gridToBatteryAcKwh).toBe(5); // charges 5 kW * 1h
    expect(int0.preExportFlow.batteryDeliveredToLoadKwh).toBe(0); // charge won over load discharge
    expect(int0.exportResult.batteryExportAcKwh).toBe(0);
  });

  // 8. overlapping tier with full battery -> discharge/export may occur
  it('8. allows discharge and export when battery is completely full in overlapping tier', () => {
    const profile = createDefaultProfile({
      totalCapacityKwh: 10,
      usableDodPercent: 100,
    });
    const intervals = [
      createMockInterval(0, { homeLoadKwh: 0, solarGenerationKwh: 0 }),
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'mid-peak',
        allowGridChargeFromGrid: true,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'mid-peak',
        buyRate: 0.2,
        sellRate: 0.4,
      }),
    ];

    // Battery completely full: 10 kWh
    const initialBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 10,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 10,
      totalAcquisitionCostUsd: 1.0, // $0.10/kWh
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    // Because battery was already full, gridChargeBranchSelected is false
    expect(int0.gridChargeBranchSelected).toBe(false);
    expect(int0.allowBatteryExportInInterval).toBe(true);
    expect(int0.exportResult.exportEconomic).toBe(true);
    expect(int0.exportResult.batteryExportAcKwh).toBe(5); // up to 5 kW inverter
    expect(int0.batteryStateAfterExport.gridChargedSocKwh).toBe(5);
  });

  // 9. solar charging blocks battery export in same interval
  it('9. blocks battery export when solar charging occurs in the same interval', () => {
    const profile = createDefaultProfile();
    const intervals = [
      createMockInterval(0, {
        homeLoadKwh: 0,
        solarGenerationKwh: 3,
        surplusSolarKwh: 3,
      }),
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'on-peak',
        buyRate: 0.5,
        sellRate: 0.45,
      }),
    ];

    const initialBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 5,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 5,
      totalAcquisitionCostUsd: 0.5,
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    expect(int0.preExportFlow.solarToBatteryAcKwh).toBe(3);
    // Solar charging must block battery export
    expect(int0.allowBatteryExportInInterval).toBe(false);
    expect(int0.exportResult.batteryExportAcKwh).toBe(0);
    expect(int0.batteryStateAfterExport.gridChargedSocKwh).toBe(5);
    expect(int0.batteryStateAfterExport.renewableChargedSocKwh).toBe(3);
  });

  // 10. grid SOC and cost basis remain synchronized across multiple intervals
  it('10. keeps grid SOC and cost basis perfectly synchronized across multi-interval operations', () => {
    const profile = createDefaultProfile();
    const intervals = [
      createMockInterval(0), // charge 4 kWh
      createMockInterval(1, { homeLoadKwh: 1.5, residualHomeLoadKwh: 1.5 }), // home discharge 1.5 kWh
      createMockInterval(2), // export 1.5 kWh
      createMockInterval(3), // charge 3 kWh
      createMockInterval(4), // export 2 kWh
    ];
    const policy = [
      createMockPolicy(0, {
        tierId: 'off-peak',
        allowGridChargeFromGrid: true,
        allowBatteryDischargeToLoad: false,
      }),
      createMockPolicy(1, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
      createMockPolicy(2, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
      createMockPolicy(3, {
        tierId: 'off-peak',
        allowGridChargeFromGrid: true,
        allowBatteryDischargeToLoad: false,
      }),
      createMockPolicy(4, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, { tierId: 'off-peak', buyRate: 0.1, sellRate: 0.02 }),
      createMockRate(1, { tierId: 'on-peak', buyRate: 0.5, sellRate: 0.05 }), // sellRate low so int1 won't export after home load
      createMockRate(2, { tierId: 'on-peak', buyRate: 0.5, sellRate: 0.4 }),
      createMockRate(3, { tierId: 'off-peak', buyRate: 0.2, sellRate: 0.03 }),
      createMockRate(4, { tierId: 'on-peak', buyRate: 0.6, sellRate: 0.5 }),
    ];

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      zeroBatteryState,
      zeroCostBasisState
    );

    for (let i = 0; i < result.intervals.length; i++) {
      const inv = result.intervals[i];
      expect(
        Math.abs(
          inv.batteryStateAfterExport.gridChargedSocKwh -
            inv.costBasisStateAfterExport.gridStoredEnergyKwh
        )
      ).toBeLessThan(1e-6);
    }

    expect(
      Math.abs(
        result.finalBatteryState.gridChargedSocKwh -
          result.finalCostBasisState.gridStoredEnergyKwh
      )
    ).toBeLessThan(1e-6);
  });

  // 11. partial export preserves weighted-average cost basis
  it('11. partial export preserves unit weighted-average cost basis in remaining stored energy', () => {
    const profile = createDefaultProfile({
      maxContinuousOutputKw: 2, // limits export to 2 kWh
    });
    const intervals = [createMockInterval(0)];
    const policy = [
      createMockPolicy(0, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'on-peak',
        buyRate: 0.5,
        sellRate: 0.35,
      }),
    ];

    // 6 kWh at $0.15/kWh => $0.90 total
    const initialBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 6,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 6,
      totalAcquisitionCostUsd: 0.9,
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    expect(int0.exportResult.batteryExportAcKwh).toBe(2);
    expect(int0.exportResult.gridSocCostRemovedForExportUsd).toBeCloseTo(0.3, 6);

    // Remaining: 4 kWh and $0.60 => $0.15/kWh
    expect(int0.batteryStateAfterExport.gridChargedSocKwh).toBe(4);
    expect(int0.costBasisStateAfterExport.gridStoredEnergyKwh).toBe(4);
    expect(int0.costBasisStateAfterExport.totalAcquisitionCostUsd).toBeCloseTo(
      0.6,
      6
    );

    const unitCost =
      int0.costBasisStateAfterExport.totalAcquisitionCostUsd /
      int0.costBasisStateAfterExport.gridStoredEnergyKwh;
    expect(unitCost).toBeCloseTo(0.15, 6);
  });

  // 12. negative grid acquisition cost supports profitable export
  it('12. supports profitable grid export when grid energy was acquired at negative cost', () => {
    const profile = createDefaultProfile();
    const intervals = [createMockInterval(0)];
    const policy = [
      createMockPolicy(0, {
        tierId: 'on-peak',
        allowGridChargeFromGrid: false,
        allowBatteryDischargeToLoad: true,
      }),
    ];
    const rates = [
      createMockRate(0, {
        tierId: 'on-peak',
        buyRate: 0.05,
        sellRate: 0.02, // positive sell rate
      }),
    ];

    // Stored 5 kWh with negative acquisition cost (-$0.20 => -$0.04/kWh)
    const initialBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 5,
    };
    const initialCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 5,
      totalAcquisitionCostUsd: -0.2,
    };

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      rates,
      1.0,
      profile,
      initialBattery,
      initialCostBasis
    );

    const int0 = result.intervals[0];
    expect(int0.exportResult.exportEconomic).toBe(true);
    expect(int0.exportResult.batteryExportAcKwh).toBe(5);
    expect(int0.exportResult.exportRevenueUsd).toBeCloseTo(0.1, 6); // 5 * 0.02
    expect(int0.exportResult.gridSocCostRemovedForExportUsd).toBeCloseTo(
      -0.2,
      6
    );
    // Gross margin = revenue - cost = 0.10 - (-0.20) = 0.30
    expect(int0.exportResult.exportGrossMarginUsd).toBeCloseTo(0.3, 6);
  });

  // 13. G3M ResolvedTariffRateInterval[] passes directly without remapping
  it('13. accepts G3M resolveTariffRates() output directly without mapping or transformations', () => {
    const profile = createDefaultProfile();
    const tiers: RateTier[] = [
      { id: 'off-peak', name: 'Off Peak', buyRate: 0.12, sellRate: 0.04, color: '#3b82f6' },
      { id: 'on-peak', name: 'On Peak', buyRate: 0.45, sellRate: 0.35, color: '#ef4444' },
    ];

    const alignedTimestamps: AlignedLoadTimestamp[] = [
      {
        sourceIndex: 0,
        sourceTimestamp: '2025-06-01 00:00',
        instantUtc: new Date('2025-06-01T00:00:00.000Z'),
        timestampUtc: '2025-06-01T00:00:00.000Z',
      },
      {
        sourceIndex: 1,
        sourceTimestamp: '2025-06-01 01:00',
        instantUtc: new Date('2025-06-01T01:00:00.000Z'),
        timestampUtc: '2025-06-01T01:00:00.000Z',
      },
    ];

    const refIntervals = [
      { sourceIndex: 0, timestampUtc: '2025-06-01T00:00:00.000Z', tierId: 'off-peak' },
      { sourceIndex: 1, timestampUtc: '2025-06-01T01:00:00.000Z', tierId: 'on-peak' },
    ];

    const resolvedRates = resolveTariffRates(
      refIntervals,
      alignedTimestamps,
      'America/Los_Angeles',
      tiers
    );

    const intervals = [
      createMockInterval(0, { timestampUtc: '2025-06-01T00:00:00.000Z' }),
      createMockInterval(1, { timestampUtc: '2025-06-01T01:00:00.000Z' }),
    ];
    const policy = [
      createMockPolicy(0, {
        timestampUtc: '2025-06-01T00:00:00.000Z',
        tierId: 'off-peak',
        allowGridChargeFromGrid: true,
      }),
      createMockPolicy(1, {
        timestampUtc: '2025-06-01T01:00:00.000Z',
        tierId: 'on-peak',
        allowBatteryDischargeToLoad: true,
      }),
    ];

    const result = routeExportAwareBatteryFlow(
      intervals,
      policy,
      resolvedRates,
      1.0,
      profile,
      zeroBatteryState,
      zeroCostBasisState
    );

    expect(result.intervals).toHaveLength(2);
    expect(result.intervals[0].buyRate).toBe(0.12);
    expect(result.intervals[1].sellRate).toBe(0.35);
    expect(result.intervals[1].exportResult.batteryExportAcKwh).toBe(5);
  });

  // 14. index/timestamp/tier mismatch rejection
  it('14. rejects sourceIndex, timestampUtc, tierId, length, or initial state mismatches', () => {
    const profile = createDefaultProfile();
    const intervals = [createMockInterval(0), createMockInterval(1)];
    const policy = [createMockPolicy(0), createMockPolicy(1)];
    const rates = [createMockRate(0), createMockRate(1)];

    // Empty arrays
    expect(() =>
      routeExportAwareBatteryFlow(
        [],
        policy,
        rates,
        1.0,
        profile,
        zeroBatteryState,
        zeroCostBasisState
      )
    ).toThrow('intervals must be a non-empty array');

    // Length mismatch
    expect(() =>
      routeExportAwareBatteryFlow(
        intervals,
        [policy[0]],
        rates,
        1.0,
        profile,
        zeroBatteryState,
        zeroCostBasisState
      )
    ).toThrow('Policy length');

    // Index mismatch
    const badIndexPolicy = [createMockPolicy(0), createMockPolicy(99)];
    expect(() =>
      routeExportAwareBatteryFlow(
        intervals,
        badIndexPolicy,
        rates,
        1.0,
        profile,
        zeroBatteryState,
        zeroCostBasisState
      )
    ).toThrow('sourceIndex mismatch');

    // Timestamp mismatch
    const badTimestampRates = [
      createMockRate(0),
      createMockRate(1, { timestampUtc: '2099-01-01T00:00:00.000Z' }),
    ];
    expect(() =>
      routeExportAwareBatteryFlow(
        intervals,
        policy,
        badTimestampRates,
        1.0,
        profile,
        zeroBatteryState,
        zeroCostBasisState
      )
    ).toThrow('timestampUtc mismatch');

    // TierId mismatch between policy and rates
    const badTierRates = [
      createMockRate(0, { tierId: 'off-peak' }),
      createMockRate(1, { tierId: 'different-tier' }),
    ];
    expect(() =>
      routeExportAwareBatteryFlow(
        intervals,
        policy,
        badTierRates,
        1.0,
        profile,
        zeroBatteryState,
        zeroCostBasisState
      )
    ).toThrow('Tier mismatch between policy and resolvedRates');

    // Initial state mismatch between battery grid SOC and cost basis
    const mismatchedBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 5,
    };
    const mismatchedCostBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 3, // 3 !== 5
      totalAcquisitionCostUsd: 0.3,
    };
    expect(() =>
      routeExportAwareBatteryFlow(
        intervals,
        policy,
        rates,
        1.0,
        profile,
        mismatchedBattery,
        mismatchedCostBasis
      )
    ).toThrow('Initial state mismatch');
  });

  // 15. input immutability
  it('15. does not mutate input arrays or state objects (deep frozen)', () => {
    const profile = Object.freeze(createDefaultProfile());
    const intervals = Object.freeze([
      Object.freeze(createMockInterval(0)),
      Object.freeze(createMockInterval(1)),
    ]);
    const policy = Object.freeze([
      Object.freeze(
        createMockPolicy(0, {
          allowGridChargeFromGrid: true,
          tierId: 'off-peak',
        })
      ),
      Object.freeze(
        createMockPolicy(1, {
          allowBatteryDischargeToLoad: true,
          tierId: 'on-peak',
        })
      ),
    ]);
    const rates = Object.freeze([
      Object.freeze(
        createMockRate(0, {
          tierId: 'off-peak',
          buyRate: 0.1,
          sellRate: 0.02,
        })
      ),
      Object.freeze(
        createMockRate(1, {
          tierId: 'on-peak',
          buyRate: 0.6,
          sellRate: 0.45,
        })
      ),
    ]);
    const initialBattery = Object.freeze({ ...zeroBatteryState });
    const initialCostBasis = Object.freeze({ ...zeroCostBasisState });

    expect(() =>
      routeExportAwareBatteryFlow(
        intervals as SolarLoadFlowInterval[],
        policy as BatteryDispatchPolicyInterval[],
        rates as ResolvedTariffRateInterval[],
        1.0,
        profile,
        initialBattery,
        initialCostBasis
      )
    ).not.toThrow();

    expect(initialBattery.gridChargedSocKwh).toBe(0);
    expect(initialCostBasis.gridStoredEnergyKwh).toBe(0);
  });
});
