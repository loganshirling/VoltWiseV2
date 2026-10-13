import { describe, expect, it } from 'vitest';
import {
  BatteryProfile, BatterySocProvenanceState, GenerationConfig, GenerationSite, GridSocCostBasisState, IntervalDataPoint, RateTier,
  SolarGenerationAsset, SolarIrradianceDataset, WindGenerationAsset, WindSpeedDataset,
} from '../types/energy';
import { DEFAULT_WIND_ASSET, createDefaultSolarAsset } from '../utils/generationDefaults';
import { runGenerationAwareSimulation } from '../utils/generationAwareSimulation';

const site: GenerationSite = { latitude: 37.7749, longitude: -122.4194, elevationM: 16, timeZone: 'UTC' };
const tiers: RateTier[] = [
  { id: 'off', name: 'Off peak', buyRate: 0.2, sellRate: 0.05, color: '#00aa88' },
  { id: 'peak', name: 'Peak', buyRate: 0.5, sellRate: 0.1, color: '#cc8844' },
];
const schedule = Array.from({ length: 7 }, () => Array.from({ length: 24 }, (_, hour) => hour >= 16 && hour <= 20 ? 'peak' : 'off'));
const initialBatteryState: BatterySocProvenanceState = {
  syntheticSocKwh: 0, gridChargedSocKwh: 0, renewableChargedSocKwh: 0, generatorChargedSocKwh: 0,
};
const initialCostBasisState: GridSocCostBasisState = { gridStoredEnergyKwh: 0, totalAcquisitionCostUsd: 0 };
const battery: BatteryProfile = {
  id: 'golden-battery', name: 'Golden Battery', model: 'test', totalCapacityKwh: 10,
  usableDodPercent: 100, maxContinuousChargeKw: 5, maxContinuousOutputKw: 5,
  roundTripEfficiencyPercent: 100, ratedCycleLife: 4000, installedCost: 0,
  strategy: 'self_consumption', chargeTiers: [], dischargeTiers: [], allowGridExport: false,
};

function measuredFixture() {
  const dataPoints: IntervalDataPoint[] = [];
  const starts = Array.from({ length: 24 }, (_, hour) => {
    const date = new Date(Date.UTC(2025, 5, 15, hour));
    return date.toISOString();
  });
  for (let hour = 0; hour < starts.length; hour += 1) {
    const date = new Date(starts[hour]);
    dataPoints.push({
      timestamp: starts[hour].slice(0, 16).replace('T', ' '), date,
      hour: date.getUTCHours(), dayOfWeek: date.getUTCDay(), month: date.getUTCMonth(), usageKwh: 1,
    });
  }

  const solarRecords = starts.map((timestampUtc, hour) => {
    const ghiWm2 = hour === 12 ? 600 : hour === 13 ? 800 : hour === 14 ? 300 : 0;
    return { timestampUtc, ghiWm2, dniWm2: ghiWm2 * 0.75, dhiWm2: ghiWm2 * 0.25 };
  });
  const windRecords = starts.map((timestampUtc, hour) => ({ timestampUtc, windSpeedMps: hour >= 8 && hour <= 17 ? 8 : 0 }));
  const solarResource: SolarIrradianceDataset = {
    id: 'golden-solar', name: 'Curated measured solar', kind: 'solar_irradiance', sourceTimeZone: 'UTC',
    intervalHours: 1, rowCount: solarRecords.length, startTimestampUtc: starts[0], endTimestampUtc: starts.at(-1)!, records: solarRecords,
  };
  const windResource: WindSpeedDataset = {
    id: 'golden-wind', name: 'Curated measured wind', kind: 'wind_speed', sourceTimeZone: 'UTC',
    intervalHours: 1, rowCount: windRecords.length, startTimestampUtc: starts[0], endTimestampUtc: starts.at(-1)!, records: windRecords,
  };
  const solar: SolarGenerationAsset = {
    ...createDefaultSolarAsset('golden-solar-array'), enabled: true, dcCapacityKw: 4,
    tiltDegrees: 20, azimuthDegrees: 180, inverterAcCapacityKw: 4, inverterEfficiencyPercent: 100,
    systemLossPercent: 0, shadingLossPercent: 0, resourceMode: 'weather_file', externalResourceId: solarResource.id,
  };
  const wind: WindGenerationAsset = {
    ...DEFAULT_WIND_ASSET, id: 'golden-wind-turbine', enabled: true, ratedPowerKw: 5,
    hubHeightM: 20, measurementHeightM: 10, annualAverageWindSpeedMps: null,
    cutInWindSpeedMps: 3, ratedWindSpeedMps: 11, cutOutWindSpeedMps: 25,
    resourceMode: 'interval_file', externalResourceId: windResource.id,
    powerCurve: [
      { windSpeedMps: 0, outputKw: 0 }, { windSpeedMps: 3, outputKw: 0 },
      { windSpeedMps: 7, outputKw: 2 }, { windSpeedMps: 11, outputKw: 5 },
      { windSpeedMps: 25, outputKw: 5 },
    ],
  };
  const generationConfig: GenerationConfig = { site, assets: [solar, wind], externalResources: [solarResource, windResource] };
  return { dataPoints, generationConfig, starts };
}

describe('curated measured-resource numerical golden', () => {
  it('aligns measured solar and wind intervals and reproduces authoritative period totals', () => {
    const { dataPoints, generationConfig } = measuredFixture();
    const result = runGenerationAwareSimulation({
      dataPoints, intervalHours: 1, generationConfig, tiers, scheduleMatrix: schedule,
      batteryProfile: battery, allowSolarExport: false, initialBatteryState, initialCostBasisState,
    });
    expect(result.alignedTimestamps).toHaveLength(24);
    expect(result.resolvedRates[15].buyRate).toBe(0.2);
    expect(result.resolvedRates[16].buyRate).toBe(0.5);
    expect({
      load: Number(result.totalHomeLoadKwh.toFixed(6)),
      solar: Number(result.totalSolarGenerationKwh.toFixed(6)),
      wind: Number(result.totalWindGenerationKwh.toFixed(6)),
      renewable: Number(result.totalRenewableGenerationKwh.toFixed(6)),
      gridImport: Number(result.gridFlows.totalGridImportKwh.toFixed(6)),
      gridExport: Number(result.gridFlows.totalGridExportKwh.toFixed(6)),
      baselineCost: Number(result.baselineCost.toFixed(6)),
      simulatedCost: Number(result.simulatedCost.toFixed(6)),
      netSavings: Number(result.netSavings.toFixed(6)),
    }).toMatchInlineSnapshot(`
      {
        "baselineCost": 6.3,
        "gridExport": 0,
        "gridImport": 14,
        "load": 24,
        "netSavings": 2.6,
        "renewable": 34.749071,
        "simulatedCost": 3.7,
        "solar": 1.168613,
        "wind": 33.580458,
      }
    `);
  });
});
