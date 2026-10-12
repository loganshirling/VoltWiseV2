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
import {
  ProjectArchiveState,
  parseProjectArchive,
  serializeProjectArchive,
} from '../utils/projectArchive';

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

describe('versioned local project archives', () => {
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
