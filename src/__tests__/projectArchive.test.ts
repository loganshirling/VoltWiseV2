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
    timeZone: 'America/Los_Angeles',
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
    expect(restored.loadDataSource).toBe('uploaded');
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
});
