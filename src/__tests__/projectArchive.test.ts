import { describe, expect, it } from 'vitest';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_TOU_PROFILES,
  createDefaultScheduleMatrix,
} from '../utils/simulationEngine';
import {
  createDefaultGenerationConfig,
  createDefaultGeneratorAsset,
  createDefaultSolarAsset,
  createDefaultWindAsset,
} from '../utils/generationDefaults';
import { generateStandardCsvTemplate } from '../utils/sampleData';
import { runUnifiedSimulation } from '../utils/simulationRouter';
import { buildAcceptedDteImport, inspectDteImport } from '../utils/guidedCsvImport';
import {
  ProjectArchiveState,
  assertProjectArchiveWithinBudget,
  parseProjectArchive,
  serializeProjectArchive,
} from '../utils/projectArchive';
import {
  MAX_GENERATION_ASSETS,
  MAX_LOAD_CSV_BYTES,
  MAX_PROJECT_ARCHIVE_BYTES,
  MAX_PROJECT_PERSISTED_DATA_BYTES,
} from '../utils/importLimits';

function makeProjectState(): ProjectArchiveState {
  const touProfile = DEFAULT_TOU_PROFILES[0];
  const generationConfig = createDefaultGenerationConfig();
  generationConfig.site = {
    latitude: 37.7749,
    longitude: -122.4194,
    timeZone: 'America/New_York',
    elevationM: 16,
  };
  generationConfig.assets = [
    createDefaultSolarAsset('solar-archive'),
    createDefaultWindAsset('wind-archive'),
    createDefaultGeneratorAsset('generator-archive'),
  ];
  generationConfig.externalResources = [{
    id: 'solar-resource-archive',
    name: 'Solar interval resource',
    kind: 'solar_irradiance',
    sourceTimeZone: 'America/Los_Angeles',
    intervalHours: 1,
    rowCount: 2,
    startTimestampUtc: '2025-09-22T07:00:00.000Z',
    endTimestampUtc: '2025-09-22T08:00:00.000Z',
    records: [
      { timestampUtc: '2025-09-22T07:00:00.000Z', ghiWm2: 500, dniWm2: 400, dhiWm2: 100 },
      { timestampUtc: '2025-09-22T08:00:00.000Z', ghiWm2: 600, dniWm2: 450, dhiWm2: 150 },
    ],
  }];

  return {
    profiles: DEFAULT_BATTERY_PROFILES,
    activeProfileId: DEFAULT_BATTERY_PROFILES[0].id,
    touProfiles: DEFAULT_TOU_PROFILES,
    activeTouProfileId: touProfile.id,
    tiers: touProfile.tiers,
    scheduleMatrix: createDefaultScheduleMatrix(),
    generationConfig,
    allowSolarExport: true,
    financials: DEFAULT_MACRO_FINANCIALS,
    loadDataCsv: generateStandardCsvTemplate(),
    loadDataSource: 'uploaded',
  };
}

async function encodeArchive(state = makeProjectState()): Promise<string> {
  return serializeProjectArchive(state).text();
}

function makeMaximumLeapYearProjectState(): ProjectArchiveState {
  const state = makeProjectState();
  const start = Date.UTC(2024, 0, 1);
  const timestamps = Array.from({ length: 35_136 }, (_, index) =>
    new Date(start + index * 15 * 60_000).toISOString()
  );
  const solarId = 'solar-max-resource';
  const windId = 'wind-max-resource';
  const solar = createDefaultSolarAsset('solar-max');
  solar.resourceMode = 'weather_file';
  solar.externalResourceId = solarId;
  const wind = createDefaultWindAsset('wind-max');
  wind.resourceMode = 'interval_file';
  wind.externalResourceId = windId;
  const generationConfig = createDefaultGenerationConfig();
  generationConfig.site = { latitude: 37.77, longitude: -122.4, elevationM: 10, timeZone: 'UTC' };
  generationConfig.assets = [solar, wind];
  generationConfig.externalResources = [
    {
      id: solarId, name: 'Maximum quarter-hour solar', kind: 'solar_irradiance', sourceTimeZone: 'UTC',
      intervalHours: 0.25, rowCount: timestamps.length, startTimestampUtc: timestamps[0], endTimestampUtc: timestamps.at(-1)!,
      records: timestamps.map((timestampUtc) => ({ timestampUtc, ghiWm2: 850.5, dniWm2: 720.25, dhiWm2: 130.25 })),
    },
    {
      id: windId, name: 'Maximum quarter-hour wind', kind: 'wind_speed', sourceTimeZone: 'UTC',
      intervalHours: 0.25, rowCount: timestamps.length, startTimestampUtc: timestamps[0], endTimestampUtc: timestamps.at(-1)!,
      records: timestamps.map((timestampUtc) => ({ timestampUtc, windSpeedMps: 5.25 })),
    },
  ];
  state.generationConfig = generationConfig;
  state.loadDataCsv = ['timestamp,usage_kwh', ...timestamps.map((timestamp) => `${timestamp},0.25`)].join('\n');
  state.loadDataSource = 'uploaded';
  return state;
}

function makeNearBudgetLeapYearProjectState(): ProjectArchiveState {
  const state = makeMaximumLeapYearProjectState();
  const windSource = state.generationConfig.externalResources!.find((resource) => resource.kind === 'wind_speed')!;
  const extraWindId = 'wind-near-budget-resource';
  const extraWind = createDefaultWindAsset('wind-near-budget');
  extraWind.resourceMode = 'interval_file';
  extraWind.externalResourceId = extraWindId;
  state.generationConfig.assets.push(extraWind);
  state.generationConfig.externalResources!.push({
    ...windSource,
    id: extraWindId,
    name: 'Second measured wind station',
    records: windSource.records.map((record) => ({ ...record, windSpeedMps: record.windSpeedMps + 0.25 })),
  });
  return state;
}

describe('versioned local project archives', () => {
  it('round-trips a maximum leap-year load with measured solar and wind while reserving metadata headroom', async () => {
    const state = makeMaximumLeapYearProjectState();
    const size = assertProjectArchiveWithinBudget(state);

    expect(size.archiveBytes).toBeLessThan(MAX_PROJECT_ARCHIVE_BYTES - 1024 * 1024);
    const archive = serializeProjectArchive(state);
    const restored = await parseProjectArchive(archive);
    expect(restored.csvResult?.data).toHaveLength(35_136);
    expect(restored.generationConfig.externalResources?.map((resource) => resource.records.length)).toEqual([35_136, 35_136]);
  });

  it('rejects a resource combination beyond the measured aggregate persisted-data budget', () => {
    const state = makeMaximumLeapYearProjectState();
    const source = state.generationConfig.externalResources![0];
    const assets = Array.from({ length: 3 }, (_, index) => {
      const asset = createDefaultSolarAsset(`solar-budget-${index + 1}`);
      asset.resourceMode = 'weather_file';
      asset.externalResourceId = `solar-budget-resource-${index + 1}`;
      return asset;
    });
    state.generationConfig.assets = assets;
    state.generationConfig.externalResources = assets.map((asset, index) => ({
      ...source,
      id: asset.externalResourceId!,
      name: `Solar budget ${index + 1}`,
    }));

    expect(() => assertProjectArchiveWithinBudget(state)).toThrow(/aggregate persisted data.*9 MiB/i);
  });

  it('keeps an ordinary asset-name edit saveable on an accepted near-budget leap-year project', async () => {
    const state = makeNearBudgetLeapYearProjectState();
    const beforeEdit = assertProjectArchiveWithinBudget(state);
    expect(beforeEdit.persistedDataBytes).toBeGreaterThan(8 * 1024 * 1024);
    expect(beforeEdit.persistedDataBytes).toBeLessThan(MAX_PROJECT_PERSISTED_DATA_BYTES);
    expect(beforeEdit.archiveBytes).toBeLessThan(MAX_PROJECT_ARCHIVE_BYTES - 1024 * 1024);

    const solar = state.generationConfig.assets.find((asset) => asset.type === 'solar')!;
    solar.name = 'Updated roof solar array';
    const afterEdit = assertProjectArchiveWithinBudget(state);
    expect(afterEdit.persistedDataBytes).toBe(beforeEdit.persistedDataBytes);
    expect(afterEdit.archiveBytes).toBeLessThan(MAX_PROJECT_ARCHIVE_BYTES);

    const reopened = await parseProjectArchive(serializeProjectArchive(state));
    expect(reopened.generationConfig.assets.find((asset) => asset.type === 'solar')?.name)
      .toBe('Updated roof solar array');
    expect(reopened.generationConfig.externalResources).toHaveLength(3);
  });

  it('round-trips editable settings, load input provenance, and external resource records', async () => {
    const state = makeProjectState();
    const restored = await parseProjectArchive(await encodeArchive(state));

    expect(restored).toMatchObject(state);
    expect(restored.csvResult?.data).toHaveLength(48);
    expect(restored.generationConfig.externalResources).toEqual(state.generationConfig.externalResources);
    expect(restored.generationConfig.externalResources?.[0].sourceTimeZone).toBe('America/Los_Angeles');
    expect(restored.generationConfig.externalResources?.[0].records[0].timestampUtc).toBe('2025-09-22T07:00:00.000Z');
    expect(restored.loadDataSource).toBe('uploaded');
  });

  it('saves and reopens the unchanged DTE source CSV with accepted DST choices and correction provenance', async () => {
    const sourceCsv = [
      'Day,Hour of Day,Hourly Total,Daily Total,Unit of Measurement',
      '11/02/2025,12:00 AM,1.25,20,kWh',
      '11/02/2025,1:00 AM,No Data,20,kWh',
      '11/02/2025,2:00 AM,3.5,20,kWh',
    ].join('\n');
    const review = inspectDteImport(sourceCsv, 'America/New_York', 'dte-fallback.csv');
    const accepted = buildAcceptedDteImport(review, {
      timeChoices: { 3: '2025-11-02T05:00:00.000Z' },
      sourceRowCorrections: { 3: { usageKwh: 2.75, method: 'manual', approved: true } },
      missingIntervalCorrections: { '2025-11-02T06:00:00.000Z': { usageKwh: 2.9, method: 'manual', approved: true } },
    });
    const state = makeProjectState();
    state.loadDataCsv = accepted.originalCsv;
    state.loadResolvedCsv = accepted.normalizedCsv;
    state.loadImportProvenance = accepted.provenance;
    const restored = await parseProjectArchive(await encodeArchive(state));

    expect(restored.loadDataCsv).toBe(sourceCsv);
    expect(restored.loadResolvedCsv).toBe(accepted.normalizedCsv);
    expect(restored.loadImportProvenance).toEqual(accepted.provenance);
    expect(restored.csvResult?.operationallySimulatable).toBe(true);
    expect(restored.csvResult?.data.map((row) => row.usageKwh)).toEqual([1.25, 2.75, 2.9, 3.5]);
  });

  it('preserves an intentionally unbound measured mode across project archive round-trip', async () => {
    const state = makeProjectState();
    const solar = state.generationConfig.assets.find((asset) => asset.type === 'solar')!;
    solar.resourceMode = 'weather_file';
    solar.externalResourceId = undefined;
    state.generationConfig.externalResources = [];
    const restored = await parseProjectArchive(await encodeArchive(state));
    const restoredSolar = restored.generationConfig.assets.find((asset) => asset.type === 'solar')!;
    expect(restoredSolar.resourceMode).toBe('weather_file');
    expect(restoredSolar.externalResourceId).toBeUndefined();
    expect(restored.generationConfig.externalResources).toEqual([]);
  });

  it('restores identical re-simulation inputs and deterministic battery results', async () => {
    const state = makeProjectState();
    const restored = await parseProjectArchive(await encodeArchive(state));
    const options = (project: ProjectArchiveState, dataPoints: NonNullable<typeof restored.csvResult>['data']) => ({
      dataPoints,
      intervalHours: 1,
      tiers: project.tiers,
      scheduleMatrix: project.scheduleMatrix,
      batteryProfile: project.profiles.find((profile) => profile.id === project.activeProfileId)!,
      seasons: project.touProfiles.find((profile) => profile.id === project.activeTouProfileId)!.seasons,
      generationConfig: project.generationConfig,
      allowSolarExport: project.allowSolarExport,
    });
    const originalCsv = (await import('../utils/csvParser')).parseAndValidateEnergyCsv(state.loadDataCsv!);

    const originalResult = runUnifiedSimulation(options(state, originalCsv.data));
    const restoredResult = runUnifiedSimulation(options(restored, restored.csvResult!.data));

    expect(restoredResult.annualSummary).toEqual(originalResult.annualSummary);
  });

  it('rejects an archive with required project fields missing', async () => {
    const archive = JSON.parse(await encodeArchive());
    delete archive.project.financials;

    await expect(parseProjectArchive(JSON.stringify(archive))).rejects.toThrow(/financials/i);
  });

  it('rejects project content beyond supported load and asset limits', async () => {
    const oversizedLoad = JSON.parse(await encodeArchive());
    oversizedLoad.project.loadData = { csv: 'x'.repeat(MAX_LOAD_CSV_BYTES + 1), source: 'uploaded' };
    await expect(parseProjectArchive(JSON.stringify(oversizedLoad))).rejects.toThrow(/project\.loadData\.csv.*2 MiB/i);

    const tooManyAssets = JSON.parse(await encodeArchive());
    tooManyAssets.project.generationConfig.assets = Array.from({ length: MAX_GENERATION_ASSETS + 1 }, (_, index) => ({
      ...tooManyAssets.project.generationConfig.assets[0], id: `solar-${index}`,
    }));
    await expect(parseProjectArchive(JSON.stringify(tooManyAssets))).rejects.toThrow(/assets.*more than 10/i);
  });

  it.each([
    ['negative project cost', (archive: any) => { archive.project.profiles[0].installedCost = -1; }],
    ['battery capacity outside editor bounds', (archive: any) => { archive.project.profiles[0].totalCapacityKwh = 0; }],
    ['battery efficiency outside editor bounds', (archive: any) => { archive.project.profiles[0].roundTripEfficiencyPercent = 101; }],
    ['battery depth of discharge outside editor bounds', (archive: any) => { archive.project.profiles[0].usableDodPercent = 101; }],
    ['site coordinates outside physical bounds', (archive: any) => { archive.project.generationConfig.site.latitude = 91; }],
    ['wind power curve is non-monotonic', (archive: any) => {
      const wind = archive.project.generationConfig.assets.find((asset: any) => asset.type === 'wind');
      wind.enabled = true;
      wind.ratedPowerKw = 5;
      wind.hubHeightM = 30;
      wind.measurementHeightM = 10;
      wind.cutInWindSpeedMps = 3;
      wind.ratedWindSpeedMps = 12;
      wind.cutOutWindSpeedMps = 25;
      wind.resourceMode = 'annual_average';
      wind.annualAverageWindSpeedMps = 7;
      wind.powerCurve = [
        { windSpeedMps: 0, outputKw: 0 },
        { windSpeedMps: 2, outputKw: 0 },
      ];
      wind.powerCurve[1].windSpeedMps = -1;
    }],
    ['generator fuel curve is non-monotonic', (archive: any) => {
      const generator = archive.project.generationConfig.assets.find((asset: any) => asset.type === 'generator');
      generator.enabled = true;
      generator.ratedContinuousKw = 5;
      generator.minimumStableLoadPercent = 25;
      generator.fuelCurve = [
        { loadPercent: 25, fuelUnitsPerHour: 1 },
        { loadPercent: 20, fuelUnitsPerHour: 2 },
        { loadPercent: 100, fuelUnitsPerHour: 5 },
      ];
    }],
    ['financial assumptions outside UI bounds', (archive: any) => { archive.project.financials.federalTaxCreditPercent = 51; }],
  ])('rejects %s before accepting the project', async (_name, corrupt) => {
    const archive = JSON.parse(await encodeArchive());
    corrupt(archive);
    await expect(parseProjectArchive(JSON.stringify(archive))).rejects.toThrow(/invalid project archive/i);
  });

  it('rejects active tariff schedules with empty or unresolved rate tiers', async () => {
    const emptyTiers = JSON.parse(await encodeArchive());
    emptyTiers.project.tiers = [];
    await expect(parseProjectArchive(JSON.stringify(emptyTiers))).rejects.toThrow(/project\.tiers.*at least one/i);

    const unresolvedSchedule = JSON.parse(await encodeArchive());
    unresolvedSchedule.project.scheduleMatrix[0][0] = 'missing-tier';
    await expect(parseProjectArchive(JSON.stringify(unresolvedSchedule))).rejects.toThrow(/scheduleMatrix.*missing-tier/i);
  });

  it('rejects saved tariff profiles whose schedules reference missing rates', async () => {
    const archive = JSON.parse(await encodeArchive());
    archive.project.touProfiles[0].scheduleMatrix[0][0] = 'deleted-rate';

    await expect(parseProjectArchive(JSON.stringify(archive))).rejects.toThrow(/touProfiles\[0\].*scheduleMatrix.*deleted-rate/i);
  });

  it('rejects malformed load CSV while preserving valid partial-period datasets', async () => {
    const valid = JSON.parse(await encodeArchive());
    for (const invalidValue of ['12kWh', 'Infinity']) {
      const malformed = structuredClone(valid);
      malformed.project.loadData.csv = generateStandardCsvTemplate().replace('1.018', invalidValue);
      await expect(parseProjectArchive(JSON.stringify(malformed))).rejects.toThrow(/loadData\.csv.*schema/i);
    }
    await expect(parseProjectArchive(JSON.stringify(valid))).resolves.toMatchObject({
      csvResult: { data: expect.any(Array), annualProjectionEligible: false },
    });
  });

  it('rejects enabled measured assets with missing or wrong-kind resource references', async () => {
    const missing = JSON.parse(await encodeArchive());
    missing.project.generationConfig.assets[0].resourceMode = 'weather_file';
    missing.project.generationConfig.assets[0].externalResourceId = 'missing-solar-resource';
    await expect(parseProjectArchive(JSON.stringify(missing))).rejects.toThrow(/externalResourceId.*available/i);

    const wrongKind = JSON.parse(await encodeArchive());
    wrongKind.project.generationConfig.assets[0].resourceMode = 'weather_file';
    wrongKind.project.generationConfig.assets[0].externalResourceId = 'wind-resource';
    wrongKind.project.generationConfig.externalResources.push({
      id: 'wind-resource', name: 'Wind records', kind: 'wind_speed', sourceTimeZone: null,
      intervalHours: 1, rowCount: 2,
      startTimestampUtc: '2025-09-22T07:00:00.000Z', endTimestampUtc: '2025-09-22T08:00:00.000Z',
      records: [
        { timestampUtc: '2025-09-22T07:00:00.000Z', windSpeedMps: 3 },
        { timestampUtc: '2025-09-22T08:00:00.000Z', windSpeedMps: 4 },
      ],
    });
    await expect(parseProjectArchive(JSON.stringify(wrongKind))).rejects.toThrow(/solar irradiance resource/i);
  });

  it('rejects enum arrays instead of coercing them to supported strings', async () => {
    const archive = JSON.parse(await encodeArchive());
    archive.project.generationConfig.assets[0].resourceMode = ['clear_sky'];

    await expect(parseProjectArchive(JSON.stringify(archive))).rejects.toThrow(/resourceMode.*string/i);
  });

  it('rejects malformed JSON with an actionable error', async () => {
    await expect(parseProjectArchive('{"format":')).rejects.toThrow(/valid JSON/i);
  });

  it('rejects corrupt solar or wind resource records', async () => {
    const archive = JSON.parse(await encodeArchive());
    archive.project.generationConfig.externalResources[0].records[0].ghiWm2 = 'bright';

    await expect(parseProjectArchive(JSON.stringify(archive))).rejects.toThrow(/records\[0\]\.ghiWm2 must be a finite number/i);
  });

  it('rejects unsupported future schema versions', async () => {
    const archive = JSON.parse(await encodeArchive());
    archive.schemaVersion = 999;

    await expect(parseProjectArchive(JSON.stringify(archive))).rejects.toThrow(/unsupported project archive version/i);
  });

  it('migrates v1 archives without inventing data provenance', async () => {
    const archive = JSON.parse(await encodeArchive());
    archive.schemaVersion = 1;
    archive.project.loadDataCsv = archive.project.loadData.csv;
    delete archive.project.loadData;

    const restored = await parseProjectArchive(JSON.stringify(archive));

    expect(restored.loadDataCsv).toBe(makeProjectState().loadDataCsv);
    expect(restored.loadDataSource).toBeNull();
    expect(restored.csvResult?.data).toHaveLength(48);
  });

  it('migrates legacy resource archives without a source timezone as unknown', async () => {
    const archive = JSON.parse(await encodeArchive());
    archive.schemaVersion = 1;
    archive.project.loadDataCsv = archive.project.loadData.csv;
    delete archive.project.loadData;
    delete archive.project.generationConfig.externalResources[0].sourceTimeZone;
    const restored = await parseProjectArchive(JSON.stringify(archive));
    expect(restored.generationConfig.externalResources?.[0].sourceTimeZone).toBeNull();
  });
});
