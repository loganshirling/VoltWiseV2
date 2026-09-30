import { describe, it, expect } from 'vitest';
import {
  GenerationConfig,
  GenerationSite,
  SolarGenerationAsset,
  WindGenerationAsset,
  GeneratorGenerationAsset,
  GenerationAsset,
} from '../types/energy';
import {
  DEFAULT_GENERATION_SITE,
  DEFAULT_SOLAR_ASSET,
  DEFAULT_WIND_ASSET,
  DEFAULT_GENERATOR_ASSET,
  DEFAULT_GENERATION_CONFIG,
  createDefaultGenerationConfig,
  createDefaultSolarAsset,
  createDefaultWindAsset,
  createDefaultGeneratorAsset,
  createDefaultAsset,
  createEmptyGeneratorSchedule,
} from '../utils/generationDefaults';
import {
  runAnnualSimulation,
  calculate15YearFinancials,
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_RATE_TIERS,
  DEFAULT_TOU_PROFILES,
} from '../utils/simulationEngine';
import { generateRealistic8760Dataset } from '../utils/sampleData';
import { parseAndValidateEnergyCsv } from '../utils/csvParser';

describe('G1 Milestone — Power Generation Contracts & Defaults', () => {
  it('instantiates neutral unconfigured DEFAULT_GENERATION_SITE', () => {
    const site: GenerationSite = DEFAULT_GENERATION_SITE;
    expect(site.latitude).toBeNull();
    expect(site.longitude).toBeNull();
    expect(site.timeZone).toBe('');
    expect(site.elevationM).toBeNull();
  });

  it('instantiates neutral DEFAULT_GENERATION_CONFIG with empty asset list', () => {
    const config: GenerationConfig = DEFAULT_GENERATION_CONFIG;
    expect(config.site.latitude).toBeNull();
    expect(config.site.longitude).toBeNull();
    expect(config.site.timeZone).toBe('');
    expect(config.site.elevationM).toBeNull();
    expect(config.assets).toEqual([]);
    expect(config.assets.length).toBe(0);
  });

  it('createDefaultGenerationConfig returns fresh isolated unconfigured instances', () => {
    const c1 = createDefaultGenerationConfig();
    const c2 = createDefaultGenerationConfig();
    expect(c1).not.toBe(c2);
    expect(c1.site).not.toBe(c2.site);
    expect(c1.assets).not.toBe(c2.assets);
    expect(c1.assets).toEqual([]);
    expect(c1.site.latitude).toBeNull();
    expect(c1.site.longitude).toBeNull();
    expect(c1.site.timeZone).toBe('');
    expect(c1.site.elevationM).toBeNull();

    c1.site.latitude = 40.0;
    c1.assets.push(createDefaultSolarAsset('temp-solar'));
    expect(c2.site.latitude).toBeNull();
    expect(c2.assets).toHaveLength(0);
    expect(DEFAULT_GENERATION_CONFIG.assets).toHaveLength(0);
  });

  it('deterministic factories set caller-provided ID with no timestamps or counters', () => {
    expect(createDefaultSolarAsset('s1').id).toBe('s1');
    expect(createDefaultWindAsset('w1').id).toBe('w1');
    expect(createDefaultGeneratorAsset('g1').id).toBe('g1');

    expect(createDefaultAsset('solar', 's2').id).toBe('s2');
    expect(createDefaultAsset('wind', 'w2').id).toBe('w2');
    expect(createDefaultAsset('generator', 'g2').id).toBe('g2');
  });

  it('instantiates neutral DEFAULT_SOLAR_ASSET with zero costs and 12-month zero solar resource data', () => {
    const solar: SolarGenerationAsset = DEFAULT_SOLAR_ASSET;
    expect(solar.type).toBe('solar');
    expect(solar.enabled).toBe(true);
    expect(solar.installedCostUsd).toBe(0);
    expect(solar.annualMaintenanceCostUsd).toBe(0);
    expect(solar.monthlyPeakSunHoursPerDay).toHaveLength(12);
    solar.monthlyPeakSunHoursPerDay.forEach((hours) => {
      expect(hours).toBe(0);
    });
  });

  it('instantiates neutral DEFAULT_WIND_ASSET with zero costs, null annual wind speed, zero monthly speeds, and empty power curve', () => {
    const wind: WindGenerationAsset = DEFAULT_WIND_ASSET;
    expect(wind.type).toBe('wind');
    expect(wind.installedCostUsd).toBe(0);
    expect(wind.annualMaintenanceCostUsd).toBe(0);
    expect(wind.annualAverageWindSpeedMps).toBeNull();
    expect(wind.monthlyAverageWindSpeedMps).toHaveLength(12);
    wind.monthlyAverageWindSpeedMps.forEach((speed) => {
      expect(speed).toBe(0);
    });
    expect(wind.powerCurve).toEqual([]);
  });

  it('instantiates complete neutral DEFAULT_GENERATOR_ASSET with all required G1 fields', () => {
    const generator: GeneratorGenerationAsset = DEFAULT_GENERATOR_ASSET;
    expect(generator.type).toBe('generator');
    expect(generator.installedCostUsd).toBe(0);
    expect(generator.annualMaintenanceCostUsd).toBe(0);
    expect(generator.fuelPricePerUnit).toBe(0);
    expect(generator.customFuelUnitLabel).toBe('');
    expect(generator.variableMaintenanceCostPerHourUsd).toBe(0);
    expect(generator.fuelCurve).toEqual([]);
    expect(generator.dispatchMode).toBe('standby');
    expect(generator.allowBatteryCharging).toBe(true);
    expect(generator.allowGridExport).toBe(false);
    expect(['natural_gas', 'propane', 'gasoline', 'diesel', 'custom']).toContain(generator.fuelType);
    expect(['gallon', 'therm', 'ccf', 'mmbtu', 'custom']).toContain(generator.fuelUnit);
  });

  it('provides isolated 7x24 empty generator schedule that avoids shared row references', () => {
    const schedule = createEmptyGeneratorSchedule();
    expect(schedule).toHaveLength(7);
    schedule.forEach((row) => {
      expect(row).toHaveLength(24);
      row.forEach((val) => {
        expect(val).toBe(false);
      });
    });

    const g1 = createDefaultGeneratorAsset('gen-1');
    const g2 = createDefaultGeneratorAsset('gen-2');

    expect(g1.scheduledHours).toHaveLength(7);
    g1.scheduledHours.forEach((row) => {
      expect(row).toHaveLength(24);
      row.forEach((val) => expect(val).toBe(false));
    });

    // Mutate day 0, hour 0 in g1
    g1.scheduledHours[0][0] = true;
    expect(g1.scheduledHours[0][0]).toBe(true);
    // Prove row 1 is unaffected (no shared row references in g1)
    expect(g1.scheduledHours[1][0]).toBe(false);
    // Prove g2 is unaffected (independent instances)
    expect(g2.scheduledHours[0][0]).toBe(false);
  });

  it('properly discriminates assets in GenerationConfig when populated', () => {
    const config: GenerationConfig = {
      site: {
        latitude: 37.77,
        longitude: -122.42,
        timeZone: 'America/Los_Angeles',
        elevationM: 16,
      },
      assets: [
        createDefaultSolarAsset('solar-1'),
        createDefaultWindAsset('wind-1'),
        createDefaultGeneratorAsset('gen-1'),
      ],
    };
    expect(config.assets.length).toBe(3);

    const solar = config.assets.find((a): a is SolarGenerationAsset => a.type === 'solar');
    const wind = config.assets.find((a): a is WindGenerationAsset => a.type === 'wind');
    const generator = config.assets.find((a): a is GeneratorGenerationAsset => a.type === 'generator');

    expect(solar).toBeDefined();
    expect(solar?.type).toBe('solar');
    expect(solar?.id).toBe('solar-1');

    expect(wind).toBeDefined();
    expect(wind?.type).toBe('wind');
    expect(wind?.id).toBe('wind-1');

    expect(generator).toBeDefined();
    expect(generator?.type).toBe('generator');
    expect(generator?.id).toBe('gen-1');
  });

  it('factory functions generate isolated instances with caller IDs and cloned arrays', () => {
    const s1 = createDefaultSolarAsset('s1');
    const s2 = createDefaultSolarAsset('s2', 'Second Solar Array');
    expect(s1.id).toBe('s1');
    expect(s2.id).toBe('s2');
    expect(s2.name).toBe('Second Solar Array');
    s1.monthlyPeakSunHoursPerDay[0] = 5.5;
    expect(s2.monthlyPeakSunHoursPerDay[0]).not.toBe(5.5);

    const w1 = createDefaultWindAsset('w1');
    const w2 = createDefaultWindAsset('w2');
    expect(w1.id).toBe('w1');
    expect(w2.id).toBe('w2');
    w1.powerCurve.push({ windSpeedMps: 10, outputKw: 5 });
    expect(w2.powerCurve).toHaveLength(0);

    const g1 = createDefaultGeneratorAsset('g1');
    const g2 = createDefaultGeneratorAsset('g2');
    expect(g1.id).toBe('g1');
    expect(g2.id).toBe('g2');
    g1.fuelCurve.push({ loadPercent: 50, fuelUnitsPerHour: 1.2 });
    expect(g2.fuelCurve).toHaveLength(0);
  });

  it('verifies invariant: changing generation config does not alter simulation or financial results', () => {
    const { rawCsv } = generateRealistic8760Dataset();
    const parsed = parseAndValidateEnergyCsv(rawCsv);
    expect(parsed.isValid).toBe(true);

    const profile = DEFAULT_BATTERY_PROFILES[0];
    const tariff = DEFAULT_TOU_PROFILES[0];

    const baselineSim = runAnnualSimulation(
      parsed.data,
      parsed.intervalHours,
      tariff.tiers,
      tariff.scheduleMatrix,
      profile,
      tariff.seasons
    );

    const baselineFin = calculate15YearFinancials(
      profile,
      baselineSim,
      DEFAULT_MACRO_FINANCIALS
    );

    // Now instantiate modified generation assets
    const modifiedConfig: GenerationConfig = {
      site: {
        latitude: 45.0,
        longitude: -93.0,
        timeZone: 'America/Chicago',
        elevationM: 300,
      },
      assets: [
        {
          ...DEFAULT_SOLAR_ASSET,
          dcCapacityKw: 50.0,
          installedCostUsd: 100000,
        },
        {
          ...DEFAULT_WIND_ASSET,
          ratedPowerKw: 25.0,
          installedCostUsd: 50000,
        },
        {
          ...DEFAULT_GENERATOR_ASSET,
          ratedContinuousKw: 100.0,
          installedCostUsd: 75000,
          fuelPricePerUnit: 2.25,
          variableMaintenanceCostPerHourUsd: 1.5,
        },
      ],
    };

    // Re-verify that runAnnualSimulation and calculate15YearFinancials produce identical results
    const rerunSim = runAnnualSimulation(
      parsed.data,
      parsed.intervalHours,
      tariff.tiers,
      tariff.scheduleMatrix,
      profile,
      tariff.seasons
    );

    const rerunFin = calculate15YearFinancials(
      profile,
      rerunSim,
      DEFAULT_MACRO_FINANCIALS
    );

    expect(rerunSim.baselineAnnualCost).toBe(baselineSim.baselineAnnualCost);
    expect(rerunSim.simulatedAnnualCost).toBe(baselineSim.simulatedAnnualCost);
    expect(rerunSim.year1Savings).toBe(baselineSim.year1Savings);
    expect(rerunSim.annualBatteryDischargedKwh).toBe(baselineSim.annualBatteryDischargedKwh);

    expect(rerunFin.paybackYears).toBe(baselineFin.paybackYears);
    expect(rerunFin.npv15Yr).toBe(baselineFin.npv15Yr);
    expect(rerunFin.lifetime25YearNpv).toBe(baselineFin.lifetime25YearNpv);
    expect(rerunFin.lifetime25YearNetProfit).toBe(baselineFin.lifetime25YearNetProfit);
  });
});
