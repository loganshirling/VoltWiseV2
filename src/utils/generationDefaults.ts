/**
 * On-Site Power Generation Default Constants and Factory Helpers (G1 Milestone)
 */
import {
  GenerationConfig,
  GenerationSite,
  SolarGenerationAsset,
  WindGenerationAsset,
  GeneratorGenerationAsset,
  GenerationAsset,
} from '../types/energy';

export const DEFAULT_GENERATION_SITE: GenerationSite = {
  latitude: null,
  longitude: null,
  timeZone: '',
  elevationM: null,
};

export const DEFAULT_SOLAR_ASSET: SolarGenerationAsset = {
  id: 'solar-default',
  name: 'Rooftop Solar PV Array',
  enabled: true,
  type: 'solar',
  installedCostUsd: 0,
  annualMaintenanceCostUsd: 0,

  dcCapacityKw: 0,
  tiltDegrees: 20,
  azimuthDegrees: 180, // South

  inverterAcCapacityKw: 0,
  inverterEfficiencyPercent: 96.0,

  systemLossPercent: 14.0,
  shadingLossPercent: 0,

  annualDegradationPercent: 0.5,

  resourceMode: 'monthly_peak_sun_hours',
  monthlyPeakSunHoursPerDay: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
};

export const DEFAULT_WIND_ASSET: WindGenerationAsset = {
  id: 'wind-default',
  name: 'Residential Wind Turbine',
  enabled: false,
  type: 'wind',
  installedCostUsd: 0,
  annualMaintenanceCostUsd: 0,

  ratedPowerKw: 0,
  hubHeightM: 10,
  rotorDiameterM: 0,

  cutInWindSpeedMps: 0,
  ratedWindSpeedMps: 0,
  cutOutWindSpeedMps: 0,

  availabilityPercent: 100.0,
  systemLossPercent: 0,

  resourceMode: 'annual_average',

  measurementHeightM: 10,
  windShearExponent: 0.14,

  annualAverageWindSpeedMps: null,
  monthlyAverageWindSpeedMps: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0],

  powerCurve: [],
};

export function createEmptyGeneratorSchedule(): boolean[][] {
  return Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => false));
}

export const DEFAULT_GENERATOR_ASSET: GeneratorGenerationAsset = {
  id: 'generator-default',
  name: 'Standby Generator',
  enabled: false,
  type: 'generator',
  installedCostUsd: 0,
  annualMaintenanceCostUsd: 0,

  ratedContinuousKw: 0,
  minimumStableLoadPercent: 0,

  fuelType: 'natural_gas',
  fuelUnit: 'therm',
  customFuelUnitLabel: '',

  fuelPricePerUnit: 0,
  variableMaintenanceCostPerHourUsd: 0,

  fuelCurve: [],

  dispatchMode: 'standby',

  allowBatteryCharging: true,
  allowGridExport: false,

  scheduledHours: createEmptyGeneratorSchedule(),
};

export const DEFAULT_GENERATION_CONFIG: GenerationConfig = {
  site: DEFAULT_GENERATION_SITE,
  assets: [],
};

export function createDefaultGenerationConfig(): GenerationConfig {
  return {
    site: {
      latitude: null,
      longitude: null,
      timeZone: '',
      elevationM: null,
    },
    assets: [],
  };
}

export function createDefaultSolarAsset(
  id: string,
  name?: string
): SolarGenerationAsset {
  return {
    ...DEFAULT_SOLAR_ASSET,
    id,
    name: name || 'Solar Array',
    monthlyPeakSunHoursPerDay: [...DEFAULT_SOLAR_ASSET.monthlyPeakSunHoursPerDay],
  };
}

export function createDefaultWindAsset(
  id: string,
  name?: string
): WindGenerationAsset {
  return {
    ...DEFAULT_WIND_ASSET,
    id,
    name: name || 'Wind Turbine',
    monthlyAverageWindSpeedMps: [...DEFAULT_WIND_ASSET.monthlyAverageWindSpeedMps],
    powerCurve: DEFAULT_WIND_ASSET.powerCurve.map((pt) => ({ ...pt })),
  };
}

export function createDefaultGeneratorAsset(
  id: string,
  name?: string
): GeneratorGenerationAsset {
  return {
    ...DEFAULT_GENERATOR_ASSET,
    id,
    name: name || 'Generator',
    fuelCurve: DEFAULT_GENERATOR_ASSET.fuelCurve.map((pt) => ({ ...pt })),
    scheduledHours: createEmptyGeneratorSchedule(),
  };
}

export function createDefaultAsset(
  type: 'solar' | 'wind' | 'generator',
  id: string,
  name?: string
): GenerationAsset {
  switch (type) {
    case 'solar':
      return createDefaultSolarAsset(id, name);
    case 'wind':
      return createDefaultWindAsset(id, name);
    case 'generator':
      return createDefaultGeneratorAsset(id, name);
  }
}
