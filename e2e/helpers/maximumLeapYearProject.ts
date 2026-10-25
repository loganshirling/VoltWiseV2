import { DEFAULT_BATTERY_PROFILES, DEFAULT_MACRO_FINANCIALS, DEFAULT_TOU_PROFILES, createDefaultScheduleMatrix } from '../../src/utils/simulationEngine';
import { createDefaultGenerationConfig, createDefaultSolarAsset, createDefaultWindAsset } from '../../src/utils/generationDefaults';
import { serializeProjectArchive } from '../../src/utils/projectArchive';
import type { ProjectArchiveState } from '../../src/types/energy';

export type MaximumLeapYearProjectMode = 'smoke' | 'performance';

export function createMaximumLeapYearProjectState(mode: MaximumLeapYearProjectMode = 'smoke'): ProjectArchiveState {
  const performance = mode === 'performance';
  const timestamps = Array.from({ length: 35_136 }, (_, index) =>
    new Date(Date.UTC(2024, 0, 1) + index * 15 * 60_000).toISOString()
  );
  const solarId = 'max-solar-resource';
  const windId = 'max-wind-resource';
  const solar = createDefaultSolarAsset('max-solar');
  solar.enabled = performance;
  solar.resourceMode = 'weather_file';
  solar.externalResourceId = solarId;
  if (performance) {
    solar.dcCapacityKw = 5;
    solar.inverterAcCapacityKw = 5;
  }
  const wind = createDefaultWindAsset('max-wind');
  wind.enabled = performance;
  wind.resourceMode = 'interval_file';
  wind.externalResourceId = windId;
  if (performance) {
    wind.ratedPowerKw = 5;
    wind.hubHeightM = 20;
    wind.measurementHeightM = 10;
    wind.annualAverageWindSpeedMps = 8;
    wind.cutInWindSpeedMps = 3;
    wind.ratedWindSpeedMps = 11;
    wind.cutOutWindSpeedMps = 25;
    wind.powerCurve = [
      { windSpeedMps: 0, outputKw: 0 }, { windSpeedMps: 3, outputKw: 0 },
      { windSpeedMps: 7, outputKw: 2 }, { windSpeedMps: 11, outputKw: 5 },
      { windSpeedMps: 25, outputKw: 5 },
    ];
  }

  const generationConfig = createDefaultGenerationConfig();
  generationConfig.site = { latitude: 37.7749, longitude: -122.4194, elevationM: 16, timeZone: 'UTC' };
  generationConfig.assets = [solar, wind];
  generationConfig.externalResources = [
    {
      id: solarId, name: 'Maximum 2024 solar', kind: 'solar_irradiance', sourceTimeZone: 'UTC',
      intervalHours: 0.25, rowCount: timestamps.length, startTimestampUtc: timestamps[0], endTimestampUtc: timestamps.at(-1)!,
      records: timestamps.map((timestampUtc) => ({ timestampUtc, ghiWm2: 850.5, dniWm2: 720.25, dhiWm2: 130.25 })),
    },
    {
      id: windId, name: 'Maximum 2024 wind', kind: 'wind_speed', sourceTimeZone: 'UTC',
      intervalHours: 0.25, rowCount: timestamps.length, startTimestampUtc: timestamps[0], endTimestampUtc: timestamps.at(-1)!,
      records: timestamps.map((timestampUtc) => ({ timestampUtc, windSpeedMps: 5.25 })),
    },
  ];

  const tou = DEFAULT_TOU_PROFILES[0];
  const profiles = performance ? [DEFAULT_BATTERY_PROFILES[0]] : DEFAULT_BATTERY_PROFILES;
  return {
    profiles,
    activeProfileId: profiles[0].id,
    touProfiles: DEFAULT_TOU_PROFILES,
    activeTouProfileId: tou.id,
    tiers: tou.tiers,
    scheduleMatrix: createDefaultScheduleMatrix(),
    generationConfig,
    allowSolarExport: performance,
    financials: DEFAULT_MACRO_FINANCIALS,
    loadDataCsv: ['timestamp,usage_kwh', ...timestamps.map((timestamp) => `${timestamp},0.25`)].join('\n'),
    loadDataSource: 'uploaded',
  };
}

export async function createMaximumLeapYearProjectArchive(mode: MaximumLeapYearProjectMode = 'smoke'): Promise<Buffer> {
  return Buffer.from(await serializeProjectArchive(createMaximumLeapYearProjectState(mode)).arrayBuffer());
}
