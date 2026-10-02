import { describe, it, expect } from 'vitest';
import {
  GeneratorGenerationAsset,
  GeneratorFuelCurvePoint,
} from '../types/energy';
import {
  DEFAULT_GENERATOR_ASSET,
  createDefaultGeneratorAsset,
  createEmptyGeneratorSchedule,
} from '../utils/generationDefaults';
import {
  validateGeneratorAsset,
  validateGeneratorFuelCurve,
  validateGeneratorScheduledHours,
  calculateMinimumStableOutputKw,
  calculateGeneratorMinimumStableOutputKw,
  interpolateGeneratorFuelCurve,
  calculateRunningFuelUnits,
  calculateStartupFuelUnits,
  calculateFuelCostUsd,
  calculateVariableMaintenanceCostUsd,
  calculateGeneratorIntervalOperating,
} from '../utils/generatorModel';

function createValidEnabledGenerator(
  overrides: Partial<GeneratorGenerationAsset> = {}
): GeneratorGenerationAsset {
  return {
    id: 'test-gen-1',
    name: 'Test Standby Generator',
    enabled: true,
    type: 'generator',
    installedCostUsd: 12000,
    annualMaintenanceCostUsd: 250,

    ratedContinuousKw: 10.0,
    minimumStableLoadPercent: 25.0,

    fuelType: 'natural_gas',
    fuelUnit: 'therm',
    customFuelUnitLabel: '',

    fuelPricePerUnit: 1.5,
    variableMaintenanceCostPerHourUsd: 0.75,
    startupFuelUnits: 0.5,

    fuelCurve: [
      { loadPercent: 25.0, fuelUnitsPerHour: 1.0 },
      { loadPercent: 50.0, fuelUnitsPerHour: 1.6 },
      { loadPercent: 75.0, fuelUnitsPerHour: 2.2 },
      { loadPercent: 100.0, fuelUnitsPerHour: 3.0 },
    ],

    dispatchMode: 'standby',
    allowBatteryCharging: true,
    allowGridExport: false,
    scheduledHours: createEmptyGeneratorSchedule(),
    ...overrides,
  };
}

describe('G6A Generator Contracts, Defaults & Harmless Inactive Assets', () => {
  it('DEFAULT_GENERATOR_ASSET has startupFuelUnits === 0', () => {
    expect(DEFAULT_GENERATOR_ASSET.startupFuelUnits).toBe(0);
  });

  it('createDefaultGeneratorAsset carries startupFuelUnits: 0', () => {
    const asset = createDefaultGeneratorAsset('gen-test');
    expect(asset.startupFuelUnits).toBe(0);
    expect(asset.id).toBe('gen-test');
    expect(asset.enabled).toBe(false);
  });

  it('disabled incomplete default generator remains harmless and passes validation', () => {
    // DEFAULT_GENERATOR_ASSET has 0 rated power and empty fuel curve, but enabled is false
    expect(() => validateGeneratorAsset(DEFAULT_GENERATOR_ASSET)).not.toThrow();

    const createdDefault = createDefaultGeneratorAsset('gen-disabled');
    expect(() => validateGeneratorAsset(createdDefault)).not.toThrow();
  });
});

describe('G6A Enabled-Generator Validation', () => {
  it('valid enabled generator passes validation', () => {
    const asset = createValidEnabledGenerator();
    expect(() => validateGeneratorAsset(asset)).not.toThrow();
  });

  it('invalid, zero, or negative ratedContinuousKw fails validation', () => {
    expect(() =>
      validateGeneratorAsset(createValidEnabledGenerator({ ratedContinuousKw: 0 }))
    ).toThrow(/ratedContinuousKw/);

    expect(() =>
      validateGeneratorAsset(createValidEnabledGenerator({ ratedContinuousKw: -5 }))
    ).toThrow(/ratedContinuousKw/);

    expect(() =>
      validateGeneratorAsset(createValidEnabledGenerator({ ratedContinuousKw: NaN }))
    ).toThrow(/ratedContinuousKw/);
  });

  it('minimumStableLoadPercent below 0 or above 100 fails validation', () => {
    expect(() =>
      validateGeneratorAsset(
        createValidEnabledGenerator({ minimumStableLoadPercent: -1 })
      )
    ).toThrow(/minimumStableLoadPercent/);

    expect(() =>
      validateGeneratorAsset(
        createValidEnabledGenerator({ minimumStableLoadPercent: 101 })
      )
    ).toThrow(/minimumStableLoadPercent/);

    expect(() =>
      validateGeneratorAsset(
        createValidEnabledGenerator({ minimumStableLoadPercent: Infinity })
      )
    ).toThrow(/minimumStableLoadPercent/);
  });

  it('negative fuelPricePerUnit fails validation', () => {
    expect(() =>
      validateGeneratorAsset(createValidEnabledGenerator({ fuelPricePerUnit: -0.01 }))
    ).toThrow(/fuelPricePerUnit/);

    expect(() =>
      validateGeneratorAsset(createValidEnabledGenerator({ fuelPricePerUnit: NaN }))
    ).toThrow(/fuelPricePerUnit/);
  });

  it('negative variableMaintenanceCostPerHourUsd fails validation', () => {
    expect(() =>
      validateGeneratorAsset(
        createValidEnabledGenerator({ variableMaintenanceCostPerHourUsd: -0.5 })
      )
    ).toThrow(/variableMaintenanceCostPerHourUsd/);

    expect(() =>
      validateGeneratorAsset(
        createValidEnabledGenerator({ variableMaintenanceCostPerHourUsd: NaN }))
    ).toThrow(/variableMaintenanceCostPerHourUsd/);
  });

  it('negative startupFuelUnits fails validation', () => {
    expect(() =>
      validateGeneratorAsset(createValidEnabledGenerator({ startupFuelUnits: -1 }))
    ).toThrow(/startupFuelUnits/);

    expect(() =>
      validateGeneratorAsset(createValidEnabledGenerator({ startupFuelUnits: Infinity }))
    ).toThrow(/startupFuelUnits/);
  });

  it('negative installedCostUsd fails validation', () => {
    expect(() =>
      validateGeneratorAsset(createValidEnabledGenerator({ installedCostUsd: -500 }))
    ).toThrow(/installedCostUsd/);
  });

  it('negative annualMaintenanceCostUsd fails validation', () => {
    expect(() =>
      validateGeneratorAsset(createValidEnabledGenerator({ annualMaintenanceCostUsd: -100 }))
    ).toThrow(/annualMaintenanceCostUsd/);
  });

  it('custom fuel unit with blank label fails, non-empty label passes', () => {
    const blankCustom = createValidEnabledGenerator({
      fuelUnit: 'custom',
      customFuelUnitLabel: '   ',
    });
    expect(() => validateGeneratorAsset(blankCustom)).toThrow(/customFuelUnitLabel/);

    const validCustom = createValidEnabledGenerator({
      fuelUnit: 'custom',
      customFuelUnitLabel: 'liters',
    });
    expect(() => validateGeneratorAsset(validCustom)).not.toThrow();
  });
});

describe('G6A Fuel-Curve Validation', () => {
  it('too-short fuel curve (< 2 points) fails', () => {
    expect(() => validateGeneratorFuelCurve([], 25)).toThrow(/at least two points/);
    expect(() =>
      validateGeneratorFuelCurve([{ loadPercent: 100, fuelUnitsPerHour: 3.0 }], 25)
    ).toThrow(/at least two points/);
  });

  it('duplicate load percentages fail', () => {
    const curve: GeneratorFuelCurvePoint[] = [
      { loadPercent: 25, fuelUnitsPerHour: 1.0 },
      { loadPercent: 50, fuelUnitsPerHour: 1.6 },
      { loadPercent: 50, fuelUnitsPerHour: 1.8 },
      { loadPercent: 100, fuelUnitsPerHour: 3.0 },
    ];
    expect(() => validateGeneratorFuelCurve(curve, 25)).toThrow(/strictly increasing/);
  });

  it('decreasing/non-increasing load percentages fail', () => {
    const curve: GeneratorFuelCurvePoint[] = [
      { loadPercent: 25, fuelUnitsPerHour: 1.0 },
      { loadPercent: 60, fuelUnitsPerHour: 1.6 },
      { loadPercent: 50, fuelUnitsPerHour: 1.8 },
      { loadPercent: 100, fuelUnitsPerHour: 3.0 },
    ];
    expect(() => validateGeneratorFuelCurve(curve, 25)).toThrow(/strictly increasing/);
  });

  it('negative fuel consumption fails', () => {
    const curve: GeneratorFuelCurvePoint[] = [
      { loadPercent: 25, fuelUnitsPerHour: -0.5 },
      { loadPercent: 100, fuelUnitsPerHour: 3.0 },
    ];
    expect(() => validateGeneratorFuelCurve(curve, 25)).toThrow(/fuelUnitsPerHour/);
  });

  it('non-finite curve values fail', () => {
    expect(() =>
      validateGeneratorFuelCurve(
        [
          { loadPercent: NaN, fuelUnitsPerHour: 1.0 },
          { loadPercent: 100, fuelUnitsPerHour: 3.0 },
        ],
        25
      )
    ).toThrow(/loadPercent/);

    expect(() =>
      validateGeneratorFuelCurve(
        [
          { loadPercent: 25, fuelUnitsPerHour: Infinity },
          { loadPercent: 100, fuelUnitsPerHour: 3.0 },
        ],
        25
      )
    ).toThrow(/fuelUnitsPerHour/);
  });

  it('curve must cover minimum stable load', () => {
    // minimum stable load is 20%, but curve starts at 30%
    const curve: GeneratorFuelCurvePoint[] = [
      { loadPercent: 30, fuelUnitsPerHour: 1.2 },
      { loadPercent: 100, fuelUnitsPerHour: 3.0 },
    ];
    expect(() => validateGeneratorFuelCurve(curve, 20)).toThrow(
      /must cover minimum stable load/
    );

    // minimum stable load 20% and curve starts at 20% -> passes
    const validCurve: GeneratorFuelCurvePoint[] = [
      { loadPercent: 20, fuelUnitsPerHour: 0.9 },
      { loadPercent: 100, fuelUnitsPerHour: 3.0 },
    ];
    expect(() => validateGeneratorFuelCurve(validCurve, 20)).not.toThrow();
  });

  it('curve must terminate at 100%', () => {
    const curve: GeneratorFuelCurvePoint[] = [
      { loadPercent: 25, fuelUnitsPerHour: 1.0 },
      { loadPercent: 90, fuelUnitsPerHour: 2.8 },
    ];
    expect(() => validateGeneratorFuelCurve(curve, 25)).toThrow(
      /must terminate at 100%/
    );
  });

  it('minimumStableLoadPercent = 0 requires curve coverage at 0%', () => {
    const curveStartingAt10: GeneratorFuelCurvePoint[] = [
      { loadPercent: 10, fuelUnitsPerHour: 0.5 },
      { loadPercent: 100, fuelUnitsPerHour: 3.0 },
    ];
    expect(() => validateGeneratorFuelCurve(curveStartingAt10, 0)).toThrow(
      /must cover minimum stable load/
    );

    const curveStartingAt0: GeneratorFuelCurvePoint[] = [
      { loadPercent: 0, fuelUnitsPerHour: 0.2 },
      { loadPercent: 100, fuelUnitsPerHour: 3.0 },
    ];
    expect(() => validateGeneratorFuelCurve(curveStartingAt0, 0)).not.toThrow();
  });
});

describe('G6A Scheduled Mode Shape Validation', () => {
  it('valid 7x24 boolean schedule passes', () => {
    const schedule = createEmptyGeneratorSchedule();
    expect(() => validateGeneratorScheduledHours(schedule)).not.toThrow();

    const asset = createValidEnabledGenerator({
      dispatchMode: 'scheduled',
      scheduledHours: schedule,
    });
    expect(() => validateGeneratorAsset(asset)).not.toThrow();
  });

  it('incorrect day count fails', () => {
    const badDays = createEmptyGeneratorSchedule().slice(0, 6); // 6 days
    expect(() => validateGeneratorScheduledHours(badDays)).toThrow(
      /exactly 7 day rows/
    );

    const asset = createValidEnabledGenerator({
      dispatchMode: 'scheduled',
      scheduledHours: badDays,
    });
    expect(() => validateGeneratorAsset(asset)).toThrow(/exactly 7 day rows/);
  });

  it('incorrect hour count fails', () => {
    const badHours = createEmptyGeneratorSchedule();
    badHours[2] = badHours[2].slice(0, 23); // 23 hours on Tuesday
    expect(() => validateGeneratorScheduledHours(badHours)).toThrow(
      /exactly 24 hour cells/
    );
  });

  it('non-boolean schedule values fail', () => {
    const badCells = createEmptyGeneratorSchedule();
    (badCells[0] as unknown as (boolean | number)[])[5] = 1;
    expect(() => validateGeneratorScheduledHours(badCells)).toThrow(
      /must be a boolean/
    );
  });
});

describe('G6A Minimum Stable Output Helper', () => {
  it('calculates minimum stable output correctly from values and asset', () => {
    // 10 kW @ 25% min load = 2.5 kW
    expect(calculateMinimumStableOutputKw(10.0, 25.0)).toBe(2.5);

    // 20 kW @ 30% min load = 6.0 kW
    expect(calculateMinimumStableOutputKw(20.0, 30.0)).toBe(6.0);

    // 15 kW @ 0% min load = 0 kW
    expect(calculateMinimumStableOutputKw(15.0, 0)).toBe(0);

    const asset = createValidEnabledGenerator({
      ratedContinuousKw: 12.0,
      minimumStableLoadPercent: 20.0,
    });
    expect(calculateGeneratorMinimumStableOutputKw(asset)).toBe(2.4);
  });
});

describe('G6A Fuel-Curve Interpolation & Fuel Model', () => {
  const testCurve: GeneratorFuelCurvePoint[] = [
    { loadPercent: 25.0, fuelUnitsPerHour: 1.0 },
    { loadPercent: 50.0, fuelUnitsPerHour: 1.6 },
    { loadPercent: 75.0, fuelUnitsPerHour: 2.4 },
    { loadPercent: 100.0, fuelUnitsPerHour: 3.6 },
  ];

  it('exact curve-point values are preserved identically', () => {
    expect(interpolateGeneratorFuelCurve(testCurve, 25.0)).toBe(1.0);
    expect(interpolateGeneratorFuelCurve(testCurve, 50.0)).toBe(1.6);
    expect(interpolateGeneratorFuelCurve(testCurve, 75.0)).toBe(2.4);
    expect(interpolateGeneratorFuelCurve(testCurve, 100.0)).toBe(3.6);
  });

  it('linear interpolation between points is deterministic and exact', () => {
    // Midpoint between 25% (1.0) and 50% (1.6) -> 37.5% -> 1.3
    expect(interpolateGeneratorFuelCurve(testCurve, 37.5)).toBeCloseTo(1.3, 10);

    // Quarter point between 50% (1.6) and 75% (2.4) -> 56.25%
    // 1.6 + 0.25 * (2.4 - 1.6) = 1.6 + 0.2 = 1.8
    expect(interpolateGeneratorFuelCurve(testCurve, 56.25)).toBeCloseTo(1.8, 10);

    // Midpoint between 75% (2.4) and 100% (3.6) -> 87.5%
    // 2.4 + 0.5 * 1.2 = 3.0
    expect(interpolateGeneratorFuelCurve(testCurve, 87.5)).toBeCloseTo(3.0, 10);
  });

  it('no extrapolation occurs beyond configured curve boundaries', () => {
    // Below 25%
    expect(() => interpolateGeneratorFuelCurve(testCurve, 20.0)).toThrow(
      /Cannot extrapolate fuel consumption/
    );

    // Above 100%
    expect(() => interpolateGeneratorFuelCurve(testCurve, 105.0)).toThrow(
      /Cannot extrapolate fuel consumption/
    );
  });

  it('hourly and sub-hourly running fuel scaling is correct', () => {
    // 2.0 fuel units/hr for 1 hour = 2.0 units
    expect(calculateRunningFuelUnits(2.0, 1.0)).toBe(2.0);

    // 2.0 fuel units/hr for 15-minute sub-hourly (0.25h) = 0.5 units
    expect(calculateRunningFuelUnits(2.0, 0.25)).toBe(0.5);

    // 3.6 fuel units/hr for 30-minute sub-hourly (0.5h) = 1.8 units
    expect(calculateRunningFuelUnits(3.6, 0.5)).toBe(1.8);
  });

  it('startup fuel is zero when no start requested, and applied once when requested', () => {
    expect(calculateStartupFuelUnits(0.75, false)).toBe(0);
    expect(calculateStartupFuelUnits(0.75, true)).toBe(0.75);
    expect(calculateStartupFuelUnits(0, true)).toBe(0);
  });

  it('fuel cost includes running + startup fuel exactly once at configured price', () => {
    // Total fuel = 2.5 units, price = $2.00/unit -> $5.00
    expect(calculateFuelCostUsd(2.5, 2.0)).toBe(5.0);

    // 0 fuel -> $0.00
    expect(calculateFuelCostUsd(0, 2.0)).toBe(0);
  });

  it('variable maintenance uses runtime hours and is distinct from fixed annual O&M', () => {
    // $1.20/operating hour for 1 hour = $1.20
    expect(calculateVariableMaintenanceCostUsd(1.2, 1.0, true)).toBe(1.2);

    // $1.20/operating hour for 15-min interval (0.25h) = $0.30
    expect(calculateVariableMaintenanceCostUsd(1.2, 0.25, true)).toBe(0.3);

    // When not running (standby/off) -> $0.00
    expect(calculateVariableMaintenanceCostUsd(1.2, 1.0, false)).toBe(0);
  });

  it('operating cost equals fuel cost + variable maintenance in structured interval result', () => {
    const asset = createValidEnabledGenerator({
      ratedContinuousKw: 10.0,
      fuelPricePerUnit: 2.0,
      variableMaintenanceCostPerHourUsd: 1.0,
      startupFuelUnits: 0.5,
      fuelCurve: testCurve,
    });

    // 1) Running at 50% load (5 kW) for 1 hour, without start
    // 50% load -> 1.6 fuelUnits/hr
    // runningFuel = 1.6 * 1.0 = 1.6 units
    // startupFuel = 0
    // totalFuel = 1.6 units
    // fuelCost = 1.6 * 2.0 = $3.20
    // varMaint = 1.0 * 1.0 = $1.00
    // operatingCost = $4.20
    const resNoStart = calculateGeneratorIntervalOperating({
      asset,
      outputKw: 5.0,
      intervalHours: 1.0,
      startedThisInterval: false,
    });

    expect(resNoStart.loadPercent).toBe(50.0);
    expect(resNoStart.fuelUnitsPerHour).toBe(1.6);
    expect(resNoStart.runningFuelUnits).toBe(1.6);
    expect(resNoStart.startupFuelUnits).toBe(0);
    expect(resNoStart.totalFuelUnits).toBe(1.6);
    expect(resNoStart.fuelCostUsd).toBe(3.2);
    expect(resNoStart.variableMaintenanceCostUsd).toBe(1.0);
    expect(resNoStart.operatingCostUsd).toBe(4.2);

    // 2) Running at 50% load (5 kW) for 1 hour WITH start
    // startupFuel = 0.5 units
    // totalFuel = 1.6 + 0.5 = 2.1 units
    // fuelCost = 2.1 * 2.0 = $4.20
    // varMaint = 1.0 * 1.0 = $1.00
    // operatingCost = $5.20
    const resWithStart = calculateGeneratorIntervalOperating({
      asset,
      outputKw: 5.0,
      intervalHours: 1.0,
      startedThisInterval: true,
    });

    expect(resWithStart.startupFuelUnits).toBe(0.5);
    expect(resWithStart.totalFuelUnits).toBe(2.1);
    expect(resWithStart.fuelCostUsd).toBe(4.2);
    expect(resWithStart.variableMaintenanceCostUsd).toBe(1.0);
    expect(resWithStart.operatingCostUsd).toBe(5.2);

    // 3) Sub-hourly 15-minute interval (0.25h) at 75% load (7.5 kW)
    // 75% load -> 2.4 fuelUnits/hr
    // runningFuel = 2.4 * 0.25 = 0.6 units
    // startupFuel = 0
    // fuelCost = 0.6 * 2.0 = $1.20
    // varMaint = 1.0 * 0.25 = $0.25
    // operatingCost = $1.45
    const resSubHourly = calculateGeneratorIntervalOperating({
      asset,
      outputKw: 7.5,
      intervalHours: 0.25,
      startedThisInterval: false,
    });

    expect(resSubHourly.loadPercent).toBe(75.0);
    expect(resSubHourly.fuelUnitsPerHour).toBe(2.4);
    expect(resSubHourly.runningFuelUnits).toBe(0.6);
    expect(resSubHourly.totalFuelUnits).toBe(0.6);
    expect(resSubHourly.fuelCostUsd).toBe(1.2);
    expect(resSubHourly.variableMaintenanceCostUsd).toBe(0.25);
    expect(resSubHourly.operatingCostUsd).toBe(1.45);

    // 4) Off / 0 kW output
    const resOff = calculateGeneratorIntervalOperating({
      asset,
      outputKw: 0,
      intervalHours: 1.0,
      startedThisInterval: false,
    });

    expect(resOff.loadPercent).toBe(0);
    expect(resOff.fuelUnitsPerHour).toBe(0);
    expect(resOff.runningFuelUnits).toBe(0);
    expect(resOff.startupFuelUnits).toBe(0);
    expect(resOff.totalFuelUnits).toBe(0);
    expect(resOff.fuelCostUsd).toBe(0);
    expect(resOff.variableMaintenanceCostUsd).toBe(0);
    expect(resOff.operatingCostUsd).toBe(0);
  });
});

describe('G6A Immutability and Safety', () => {
  it('input generator asset, fuel curve, and schedule are never mutated', () => {
    const originalAsset = createValidEnabledGenerator();
    const assetCopy = JSON.parse(JSON.stringify(originalAsset));

    validateGeneratorAsset(originalAsset);
    calculateGeneratorMinimumStableOutputKw(originalAsset);
    calculateGeneratorIntervalOperating({
      asset: originalAsset,
      outputKw: 5.0,
      intervalHours: 1.0,
      startedThisInterval: true,
    });

    expect(originalAsset).toEqual(assetCopy);
  });
});
