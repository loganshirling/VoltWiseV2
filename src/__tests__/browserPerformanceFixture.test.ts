import { describe, expect, it } from 'vitest';
import type { SolarGenerationAsset, SolarIrradianceDataset, WindGenerationAsset, WindSpeedDataset } from '../types/energy';
import { DEFAULT_BATTERY_PROFILES } from '../utils/simulationEngine';
import { MAX_PROJECT_ACCEPTED_ARCHIVE_BYTES, MAX_PROJECT_PERSISTED_DATA_BYTES } from '../utils/importLimits';
import { assertProjectArchiveWithinBudget, parseProjectArchive, serializeProjectArchive } from '../utils/projectArchive';
import { createMaximumLeapYearProjectState } from '../../e2e/helpers/maximumLeapYearProject';
import standardPlaywrightConfig from '../../playwright.config';
import performancePlaywrightConfig from '../../playwright.performance.config';

describe('maximum leap-year browser-performance fixture', () => {
  it('keeps the ordinary smoke archive generation assets disabled', () => {
    const smokeState = createMaximumLeapYearProjectState();
    expect(smokeState.profiles).toHaveLength(DEFAULT_BATTERY_PROFILES.length);
    expect(smokeState.generationConfig.assets.map((asset) => asset.enabled)).toEqual([false, false]);
    expect(smokeState.generationConfig.assets.map((asset) => asset.type)).toEqual(['solar', 'wind']);
  });

  it('builds an enabled, aligned, archive-valid 2024 performance project with one profile', async () => {
    const state = createMaximumLeapYearProjectState('performance');
    expect(state.profiles).toHaveLength(1);
    expect(state.activeProfileId).toBe(state.profiles[0].id);
    expect(state.generationConfig.site.timeZone).toBe('UTC');

    const solar = state.generationConfig.assets.find((asset): asset is SolarGenerationAsset => asset.type === 'solar');
    const wind = state.generationConfig.assets.find((asset): asset is WindGenerationAsset => asset.type === 'wind');
    if (!solar || !wind) throw new Error('Performance fixture must include solar and wind assets.');
    expect(solar.type).toBe('solar');
    expect(solar.enabled).toBe(true);
    expect(solar.resourceMode).toBe('weather_file');
    expect(wind.type).toBe('wind');
    expect(wind.enabled).toBe(true);
    expect(wind.resourceMode).toBe('interval_file');

    const loadTimestamps = state.loadDataCsv!.split('\n').slice(1).map((row) => row.slice(0, row.indexOf(',')));
    expect(loadTimestamps).toHaveLength(35_136);
    expect(loadTimestamps[0]).toBe('2024-01-01T00:00:00.000Z');
    expect(loadTimestamps.at(-1)).toBe('2024-12-31T23:45:00.000Z');
    const resources = state.generationConfig.externalResources ?? [];
    const solarResource = resources.find((resource): resource is SolarIrradianceDataset => resource.kind === 'solar_irradiance');
    const windResource = resources.find((resource): resource is WindSpeedDataset => resource.kind === 'wind_speed');
    expect(solarResource).toBeDefined();
    expect(windResource).toBeDefined();
    for (const resource of [solarResource!, windResource!]) {
      expect(resource.intervalHours).toBe(0.25);
      expect(resource.rowCount).toBe(35_136);
      expect(resource.sourceTimeZone).toBe('UTC');
      expect(resource.records).toHaveLength(35_136);
      expect(resource.records.every((record, index) => record.timestampUtc === loadTimestamps[index])).toBe(true);
    }

    const size = assertProjectArchiveWithinBudget(state);
    expect(size.archiveBytes).toBeLessThanOrEqual(MAX_PROJECT_ACCEPTED_ARCHIVE_BYTES);
    expect(size.persistedDataBytes).toBeLessThanOrEqual(MAX_PROJECT_PERSISTED_DATA_BYTES);
    const validated = await parseProjectArchive(serializeProjectArchive(state));
    expect(validated.csvResult?.totalRows).toBe(35_136);
    expect(validated.csvResult?.intervalHours).toBe(0.25);
    expect(validated.csvResult?.annualProjectionEligible).toBe(true);
  });
});

describe('isolated Playwright performance configuration', () => {
  it('discovers only perf specs in the dedicated single-worker Chromium project', () => {
    expect(standardPlaywrightConfig.testMatch).toBe('**/*.spec.ts');
    expect(performancePlaywrightConfig.testMatch).toBe('**/*.perf.ts');
    expect(performancePlaywrightConfig.projects?.map((project) => project.name)).toEqual(['chromium']);
    expect(performancePlaywrightConfig.fullyParallel).toBe(false);
    expect(performancePlaywrightConfig.workers).toBe(1);
    expect(performancePlaywrightConfig.timeout).toBe(480_000);
    expect(performancePlaywrightConfig.webServer).toEqual(standardPlaywrightConfig.webServer);
    expect(performancePlaywrightConfig.use).toEqual(standardPlaywrightConfig.use);
  });
});
