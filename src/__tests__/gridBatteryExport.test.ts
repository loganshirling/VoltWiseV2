import { describe, it, expect } from 'vitest';
import { exportGridChargedBatteryEnergy } from '../utils/gridBatteryExport';
import {
  BatteryProfile,
  BatterySocProvenanceState,
  GridSocCostBasisState,
} from '../types/energy';

const defaultProfile: BatteryProfile = {
  id: 'test-battery',
  name: 'Test Battery',
  model: 'Model Standard',
  totalCapacityKwh: 10,
  usableDodPercent: 100,
  maxContinuousChargeKw: 5,
  maxContinuousOutputKw: 5,
  roundTripEfficiencyPercent: 100, // 100% RTE => etaDischarge = 1.0
  ratedCycleLife: 4000,
  installedCost: 10000,
  strategy: 'arbitrage',
  chargeTiers: ['off-peak'],
  dischargeTiers: ['on-peak'],
  allowGridExport: true,
};

const zeroCostBasis: GridSocCostBasisState = {
  gridStoredEnergyKwh: 0,
  totalAcquisitionCostUsd: 0,
};

const zeroBatteryState: BatterySocProvenanceState = {
  syntheticSocKwh: 0,
  gridChargedSocKwh: 0,
  renewableChargedSocKwh: 0,
  generatorChargedSocKwh: 0,
};

describe('Grid-Charged Battery Export Primitive (Milestone G3L)', () => {
  // 1. profitable export from grid SOC
  it('1. dispatches profitable export from grid SOC when sell rate exceeds delivery cost', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 4,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 4,
      totalAcquisitionCostUsd: 0.60, // $0.15/kWh
    };

    const result = exportGridChargedBatteryEnergy(
      true, // allowExportInInterval
      0.40, // sellRate ($0.40 > $0.15)
      0, // batteryDeliveredToLoadKwh
      1.0, // intervalHours
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.exportAllowed).toBe(true);
    expect(result.exportEconomic).toBe(true);
    expect(result.averageAcquisitionCostPerStoredKwh).toBeCloseTo(0.15, 8);
    expect(result.effectiveDeliveryCostPerAcKwh).toBeCloseTo(0.15, 8);
    expect(result.remainingDischargeCapacityAcKwh).toBe(5);
    expect(result.batteryExportAcKwh).toBe(4);
    expect(result.gridSocDrainedForExportKwh).toBe(4);
    expect(result.gridSocCostRemovedForExportUsd).toBeCloseTo(0.60, 8);
    expect(result.exportRevenueUsd).toBeCloseTo(1.60, 8); // 4 * 0.40
    expect(result.exportGrossMarginUsd).toBeCloseTo(1.00, 8); // 1.60 - 0.60

    expect(result.batteryStateAfter.gridChargedSocKwh).toBe(0);
    expect(result.costBasisStateAfter.gridStoredEnergyKwh).toBe(0);
    expect(result.costBasisStateAfter.totalAcquisitionCostUsd).toBe(0);
  });

  // 2. unprofitable export produces zero export
  it('2. produces zero export when sell rate is below effective delivery cost', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 4,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 4,
      totalAcquisitionCostUsd: 0.80, // $0.20/kWh
    };

    const result = exportGridChargedBatteryEnergy(
      true,
      0.15, // sellRate ($0.15 < $0.20)
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.exportAllowed).toBe(true);
    expect(result.exportEconomic).toBe(false);
    expect(result.batteryExportAcKwh).toBe(0);
    expect(result.gridSocDrainedForExportKwh).toBe(0);
    expect(result.gridSocCostRemovedForExportUsd).toBe(0);
    expect(result.exportRevenueUsd).toBe(0);
    expect(result.exportGrossMarginUsd).toBe(0);

    // State is preserved
    expect(result.batteryStateAfter.gridChargedSocKwh).toBe(4);
    expect(result.costBasisStateAfter.gridStoredEnergyKwh).toBe(4);
    expect(result.costBasisStateAfter.totalAcquisitionCostUsd).toBe(0.80);
  });

  // 3. sell rate exactly equals delivery cost -> zero export
  it('3. produces zero export when sell rate exactly equals delivery cost (strict inequality)', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 2,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 2,
      totalAcquisitionCostUsd: 0.50, // exactly $0.25/kWh
    };

    const result = exportGridChargedBatteryEnergy(
      true,
      0.25, // sellRate exactly equals $0.25/kWh (effectiveDeliveryCostPerAcKwh)
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.exportAllowed).toBe(true);
    expect(result.effectiveDeliveryCostPerAcKwh).toBe(0.25);
    expect(result.sellRate === result.effectiveDeliveryCostPerAcKwh).toBe(true);
    expect(result.exportEconomic).toBe(false);
    expect(result.batteryExportAcKwh).toBe(0);
    expect(result.gridSocDrainedForExportKwh).toBe(0);
  });

  // 3b. micro-margins below 1e-9 tolerance are profitable under strict numerical ordering
  it('3b. confirms strict inequality with no epsilon deadband: micro-margin (+1e-10) is profitable, (-1e-10) is not', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 2,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 2,
      totalAcquisitionCostUsd: 0.50, // exactly $0.25/kWh
    };

    const deliveryCost = 0.25;

    // Positive micro-margin below old 1e-9 tolerance (+1e-10)
    const resultProfitable = exportGridChargedBatteryEnergy(
      true,
      deliveryCost + 1e-10,
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(resultProfitable.exportEconomic).toBe(true);
    expect(resultProfitable.batteryExportAcKwh).toBe(2);
    expect(resultProfitable.exportGrossMarginUsd).toBeGreaterThan(0);

    // Negative micro-margin (-1e-10)
    const resultUnprofitable = exportGridChargedBatteryEnergy(
      true,
      deliveryCost - 1e-10,
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(resultUnprofitable.exportEconomic).toBe(false);
    expect(resultUnprofitable.batteryExportAcKwh).toBe(0);
  });

  // 4. profile.allowGridExport=false -> zero export
  it('4. produces zero export when profile.allowGridExport is false', () => {
    const noExportProfile: BatteryProfile = {
      ...defaultProfile,
      allowGridExport: false,
    };

    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 4,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 4,
      totalAcquisitionCostUsd: 0.40, // $0.10/kWh
    };

    const result = exportGridChargedBatteryEnergy(
      true, // interval allows export
      0.40, // very profitable
      0,
      1.0,
      noExportProfile,
      batteryState,
      costBasis
    );

    expect(result.exportAllowed).toBe(false);
    expect(result.exportEconomic).toBe(true);
    expect(result.batteryExportAcKwh).toBe(0);
    expect(result.gridSocDrainedForExportKwh).toBe(0);
    expect(result.batteryStateAfter.gridChargedSocKwh).toBe(4);
  });

  // 5. allowExportInInterval=false -> zero export
  it('5. produces zero export when allowExportInInterval is false', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 4,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 4,
      totalAcquisitionCostUsd: 0.40,
    };

    const result = exportGridChargedBatteryEnergy(
      false, // interval does NOT allow export
      0.40,
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.exportAllowed).toBe(false);
    expect(result.exportEconomic).toBe(true);
    expect(result.batteryExportAcKwh).toBe(0);
    expect(result.gridSocDrainedForExportKwh).toBe(0);
    expect(result.batteryStateAfter.gridChargedSocKwh).toBe(4);
  });

  // 6. remaining inverter capacity after home discharge limits export
  it('6. limits export to remaining inverter capacity after household load discharge', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 5,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 5,
      totalAcquisitionCostUsd: 0.75, // $0.15/kWh
    };

    // Max inverter output = 5 kW * 1 h = 5 kWh
    // Home load consumed 3.5 kWh AC
    // Remaining inverter capacity = 1.5 kWh AC
    const result = exportGridChargedBatteryEnergy(
      true,
      0.40,
      3.5,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.remainingDischargeCapacityAcKwh).toBeCloseTo(1.5, 8);
    expect(result.batteryExportAcKwh).toBeCloseTo(1.5, 8);
    expect(result.gridSocDrainedForExportKwh).toBeCloseTo(1.5, 8);
    expect(result.batteryStateAfter.gridChargedSocKwh).toBeCloseTo(3.5, 8); // 5.0 - 1.5
    expect(result.costBasisStateAfter.gridStoredEnergyKwh).toBeCloseTo(3.5, 8);
  });

  // 7. full inverter usage by home load leaves zero export capacity
  it('7. produces zero export when home load consumes 100% of inverter capacity', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 4,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 4,
      totalAcquisitionCostUsd: 0.60,
    };

    // Home load consumed full 5.0 kWh capacity
    const result = exportGridChargedBatteryEnergy(
      true,
      0.50,
      5.0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.remainingDischargeCapacityAcKwh).toBe(0);
    expect(result.batteryExportAcKwh).toBe(0);
    expect(result.gridSocDrainedForExportKwh).toBe(0);
    expect(result.batteryStateAfter.gridChargedSocKwh).toBe(4);
  });

  // 8. grid SOC availability limits export
  it('8. limits export to available grid SOC when inverter capacity exceeds stored grid energy', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 2.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 2.0,
      totalAcquisitionCostUsd: 0.30,
    };

    // Remaining inverter capacity = 5.0 kWh, but only 2.0 kWh grid SOC available
    const result = exportGridChargedBatteryEnergy(
      true,
      0.45,
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.batteryExportAcKwh).toBe(2.0);
    expect(result.gridSocDrainedForExportKwh).toBe(2.0);
    expect(result.batteryStateAfter.gridChargedSocKwh).toBe(0);
  });

  // 9. only grid provenance is drained
  it('9. drains ONLY grid-charged SOC and preserves synthetic, renewable, and generator SOC', () => {
    const batteryState: BatterySocProvenanceState = {
      syntheticSocKwh: 2.0,
      renewableChargedSocKwh: 1.5,
      generatorChargedSocKwh: 0.5,
      gridChargedSocKwh: 4.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 4.0,
      totalAcquisitionCostUsd: 0.80, // $0.20/kWh
    };

    const result = exportGridChargedBatteryEnergy(
      true,
      0.40,
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.batteryExportAcKwh).toBe(4.0);
    expect(result.gridSocDrainedForExportKwh).toBe(4.0);

    // Grid SOC is depleted
    expect(result.batteryStateAfter.gridChargedSocKwh).toBe(0);
    // All other provenances remain strictly untouched!
    expect(result.batteryStateAfter.syntheticSocKwh).toBe(2.0);
    expect(result.batteryStateAfter.renewableChargedSocKwh).toBe(1.5);
    expect(result.batteryStateAfter.generatorChargedSocKwh).toBe(0.5);
  });

  // 10. proportional cost-basis removal
  it('10. removes proportional cost basis from ledger during export', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 5.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 5.0,
      totalAcquisitionCostUsd: 1.25, // $0.25/kWh
    };

    // Export 2.0 kWh
    const result = exportGridChargedBatteryEnergy(
      true,
      0.40,
      3.0, // leaving 2.0 kWh inverter capacity
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.batteryExportAcKwh).toBe(2.0);
    expect(result.gridSocDrainedForExportKwh).toBe(2.0);
    expect(result.gridSocCostRemovedForExportUsd).toBeCloseTo(2.0 * 0.25, 8); // $0.50
    expect(result.costBasisStateAfter.gridStoredEnergyKwh).toBeCloseTo(3.0, 8);
    expect(result.costBasisStateAfter.totalAcquisitionCostUsd).toBeCloseTo(0.75, 8);
  });

  // 11. full depletion resets grid SOC/cost to exact zero
  it('11. resets remaining grid SOC and cost basis to exactly zero upon full depletion', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 3.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 3.0,
      totalAcquisitionCostUsd: 0.60,
    };

    const result = exportGridChargedBatteryEnergy(
      true,
      0.40,
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.batteryExportAcKwh).toBe(3.0);
    expect(result.batteryStateAfter.gridChargedSocKwh).toBe(0);
    expect(result.costBasisStateAfter.gridStoredEnergyKwh).toBe(0);
    expect(result.costBasisStateAfter.totalAcquisitionCostUsd).toBe(0);
  });

  // 12. partial depletion preserves weighted-average cost
  it('12. preserves unit acquisition cost per stored kWh across partial depletion', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 6.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 6.0,
      totalAcquisitionCostUsd: 1.80, // $0.30/kWh
    };

    const result = exportGridChargedBatteryEnergy(
      true,
      0.50,
      3.0, // Remaining capacity = 2.0 kWh
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.batteryExportAcKwh).toBe(2.0);
    expect(result.costBasisStateAfter.gridStoredEnergyKwh).toBeCloseTo(4.0, 8);
    expect(result.costBasisStateAfter.totalAcquisitionCostUsd).toBeCloseTo(1.20, 8);
    // Unit cost remains 1.20 / 4.0 = 0.30
    const remainingUnitCost =
      result.costBasisStateAfter.totalAcquisitionCostUsd /
      result.costBasisStateAfter.gridStoredEnergyKwh;
    expect(remainingUnitCost).toBeCloseTo(0.30, 8);
  });

  // 13. negative acquisition cost handled correctly
  it('13. correctly handles negative acquisition cost and calculates profitable export at negative rates', () => {
    // Battery charged at -$0.10/kWh (e.g. paid to consume energy)
    // 2.0 kWh stored with -$0.20 acquisition cost
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 2.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 2.0,
      totalAcquisitionCostUsd: -0.20, // -$0.10/kWh
    };

    // Sell rate is -$0.05/kWh
    // Since -0.05 > -0.10, export is economically profitable!
    const result = exportGridChargedBatteryEnergy(
      true,
      -0.05,
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );

    expect(result.averageAcquisitionCostPerStoredKwh).toBeCloseTo(-0.10, 8);
    expect(result.effectiveDeliveryCostPerAcKwh).toBeCloseTo(-0.10, 8);
    expect(result.exportEconomic).toBe(true);
    expect(result.batteryExportAcKwh).toBe(2.0);
    expect(result.exportRevenueUsd).toBeCloseTo(2.0 * -0.05, 8); // -$0.10
    expect(result.gridSocCostRemovedForExportUsd).toBeCloseTo(2.0 * -0.10, 8); // -$0.20
    expect(result.exportGrossMarginUsd).toBeCloseTo(-0.10 - -0.20, 8); // +$0.10 positive gross margin!
  });

  // 14. zero acquisition cost handled correctly
  it('14. correctly handles zero acquisition cost (free charging)', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 3.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 3.0,
      totalAcquisitionCostUsd: 0,
    };

    // With sell rate = $0.05 > 0, export occurs
    const resultPos = exportGridChargedBatteryEnergy(
      true,
      0.05,
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );
    expect(resultPos.exportEconomic).toBe(true);
    expect(resultPos.batteryExportAcKwh).toBe(3.0);
    expect(resultPos.exportGrossMarginUsd).toBeCloseTo(0.15, 8);

    // With sell rate = $0.00, strict inequality 0 > 0 is false -> zero export
    const resultZero = exportGridChargedBatteryEnergy(
      true,
      0.00,
      0,
      1.0,
      defaultProfile,
      batteryState,
      costBasis
    );
    expect(resultZero.exportEconomic).toBe(false);
    expect(resultZero.batteryExportAcKwh).toBe(0);
  });

  // 15. sub-hourly discharge capacity
  it('15. correctly scales inverter discharge capacity for sub-hourly intervals (15 min)', () => {
    // 15-minute interval: intervalHours = 0.25
    // Max inverter output = 4 kW * 0.25 h = 1.0 kWh AC
    const profile4Kw: BatteryProfile = {
      ...defaultProfile,
      maxContinuousOutputKw: 4,
    };

    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 3.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 3.0,
      totalAcquisitionCostUsd: 0.30, // $0.10/kWh
    };

    // Home load discharged 0.3 kWh AC
    // Remaining capacity = 1.0 - 0.3 = 0.7 kWh AC
    const result = exportGridChargedBatteryEnergy(
      true,
      0.40,
      0.3,
      0.25,
      profile4Kw,
      batteryState,
      costBasis
    );

    expect(result.remainingDischargeCapacityAcKwh).toBeCloseTo(0.7, 8);
    expect(result.batteryExportAcKwh).toBeCloseTo(0.7, 8);
    expect(result.gridSocDrainedForExportKwh).toBeCloseTo(0.7, 8);
  });

  // 16. battery/cost-basis state mismatch rejected
  it('16. rejects state reconciliation mismatch between batteryState and costBasisState', () => {
    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 4.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 2.0, // Mismatched!
      totalAcquisitionCostUsd: 0.40,
    };

    expect(() =>
      exportGridChargedBatteryEnergy(
        true,
        0.40,
        0,
        1.0,
        defaultProfile,
        batteryState,
        costBasis
      )
    ).toThrow(/State reconciliation mismatch/);
  });

  // 17. invalid rate/power/SOC/input validation
  it('17. rejects invalid input parameters (types, ranges, limits)', () => {
    const validBattery: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 2.0,
    };
    const validCost: GridSocCostBasisState = {
      gridStoredEnergyKwh: 2.0,
      totalAcquisitionCostUsd: 0.40,
    };

    // allowExportInInterval not boolean
    expect(() =>
      exportGridChargedBatteryEnergy(
        'yes' as unknown as boolean,
        0.40,
        0,
        1.0,
        defaultProfile,
        validBattery,
        validCost
      )
    ).toThrow(/Invalid allowExportInInterval/);

    // sellRate NaN
    expect(() =>
      exportGridChargedBatteryEnergy(
        true,
        NaN,
        0,
        1.0,
        defaultProfile,
        validBattery,
        validCost
      )
    ).toThrow(/Invalid sellRate/);

    // batteryDeliveredToLoadKwh negative
    expect(() =>
      exportGridChargedBatteryEnergy(
        true,
        0.40,
        -1,
        1.0,
        defaultProfile,
        validBattery,
        validCost
      )
    ).toThrow(/Invalid batteryDeliveredToLoadKwh/);

    // batteryDeliveredToLoadKwh exceeds max discharge limit
    expect(() =>
      exportGridChargedBatteryEnergy(
        true,
        0.40,
        10.0, // > 5 kW * 1 h
        1.0,
        defaultProfile,
        validBattery,
        validCost
      )
    ).toThrow(/exceeds interval discharge limit/);

    // intervalHours <= 0
    expect(() =>
      exportGridChargedBatteryEnergy(
        true,
        0.40,
        0,
        0,
        defaultProfile,
        validBattery,
        validCost
      )
    ).toThrow(/Invalid intervalHours/);

    // zero energy with non-zero acquisition cost
    expect(() =>
      exportGridChargedBatteryEnergy(
        true,
        0.40,
        0,
        1.0,
        defaultProfile,
        zeroBatteryState,
        { gridStoredEnergyKwh: 0, totalAcquisitionCostUsd: 10 }
      )
    ).toThrow(/zero gridStoredEnergyKwh.*must have zero acquisition cost basis/);
  });

  // 18. input immutability and physical constraints verification
  it('18. preserves input immutability and verifies export limits and discharge efficiency', () => {
    // 81% RTE => etaDischarge = sqrt(0.81) = 0.9
    const profile81: BatteryProfile = {
      ...defaultProfile,
      roundTripEfficiencyPercent: 81,
    };

    const batteryState: BatterySocProvenanceState = {
      ...zeroBatteryState,
      gridChargedSocKwh: 3.0,
    };
    const costBasis: GridSocCostBasisState = {
      gridStoredEnergyKwh: 3.0,
      totalAcquisitionCostUsd: 0.60, // $0.20/kWh stored
    };

    const frozenProfile = Object.freeze({ ...profile81 });
    const frozenBattery = Object.freeze({ ...batteryState });
    const frozenCost = Object.freeze({ ...costBasis });

    const result = exportGridChargedBatteryEnergy(
      true,
      0.40,
      1.0,
      1.0,
      frozenProfile,
      frozenBattery,
      frozenCost
    );

    // Inverter max = 5 kW * 1 h = 5 kWh
    // Delivered to load = 1.0 kWh
    // Remaining discharge capacity = 4.0 kWh AC
    // Grid SOC = 3.0 kWh DC => Available AC export = 3.0 * 0.9 = 2.7 kWh AC
    // batteryExportAcKwh = min(4.0, 2.7) = 2.7 kWh AC
    expect(result.batteryExportAcKwh).toBeCloseTo(2.7, 8);

    // Required constraint: batteryExportAcKwh <= maxDischargeAcKwh - batteryDeliveredToLoadKwh
    const maxDischargeAcKwh = frozenProfile.maxContinuousOutputKw * 1.0;
    expect(result.batteryExportAcKwh).toBeLessThanOrEqual(
      maxDischargeAcKwh - 1.0 + 1e-9
    );

    // Required constraint: gridSocDrainedForExportKwh ≈ batteryExportAcKwh / etaDischarge
    const etaDischarge = Math.sqrt(0.81);
    expect(result.gridSocDrainedForExportKwh).toBeCloseTo(
      result.batteryExportAcKwh / etaDischarge,
      8
    );
    expect(result.gridSocDrainedForExportKwh).toBeCloseTo(3.0, 8);

    // Delivery cost = 0.20 / 0.9 = $0.22222.../kWh AC
    expect(result.effectiveDeliveryCostPerAcKwh).toBeCloseTo(0.20 / 0.9, 8);
    expect(result.exportRevenueUsd).toBeCloseTo(2.7 * 0.40, 8); // 1.08
    expect(result.gridSocCostRemovedForExportUsd).toBeCloseTo(3.0 * 0.20, 8); // 0.60
    expect(result.exportGrossMarginUsd).toBeCloseTo(1.08 - 0.60, 8); // 0.48
  });
});
