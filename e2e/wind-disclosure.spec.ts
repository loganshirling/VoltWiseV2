import { expect, test } from '@playwright/test';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_TOU_PROFILES,
} from '../src/utils/simulationEngine';
import {
  createDefaultGenerationConfig,
  createDefaultSolarAsset,
  createDefaultWindAsset,
} from '../src/utils/generationDefaults';
import { serializeProjectArchive } from '../src/utils/projectArchive';
import type {
  GenerationAsset,
  ProjectArchiveState,
  WindGenerationAsset,
} from '../src/types/energy';

const fixtureStartUtc = Date.UTC(2025, 5, 15);
const hourlyTimestamps = Array.from({ length: 24 }, (_, hour) =>
  new Date(fixtureStartUtc + hour * 3_600_000).toISOString()
);

function createWindAsset(id: string, resourceMode: WindGenerationAsset['resourceMode'], enabled = true): WindGenerationAsset {
  const asset = createDefaultWindAsset(id, `E2E ${id}`);
  asset.enabled = enabled;
  asset.ratedPowerKw = 5;
  asset.hubHeightM = 20;
  asset.rotorDiameterM = 8;
  asset.cutInWindSpeedMps = 3;
  asset.ratedWindSpeedMps = 11;
  asset.cutOutWindSpeedMps = 25;
  asset.measurementHeightM = 10;
  asset.annualAverageWindSpeedMps = 8;
  asset.monthlyAverageWindSpeedMps = Array(12).fill(8);
  asset.powerCurve = [
    { windSpeedMps: 0, outputKw: 0 },
    { windSpeedMps: 3, outputKw: 0 },
    { windSpeedMps: 7, outputKw: 2 },
    { windSpeedMps: 11, outputKw: 5 },
    { windSpeedMps: 25, outputKw: 5 },
  ];
  asset.resourceMode = resourceMode;
  if (enabled && resourceMode === 'interval_file') asset.externalResourceId = `${id}-resource`;
  return asset;
}

function createSolarAsset(): GenerationAsset {
  const asset = createDefaultSolarAsset('e2e-solar', 'E2E Solar');
  asset.dcCapacityKw = 5;
  asset.inverterAcCapacityKw = 5;
  asset.monthlyPeakSunHoursPerDay = Array(12).fill(4.5);
  return asset;
}

async function createProjectArchive(assets: GenerationAsset[]): Promise<Buffer> {
  const generationConfig = createDefaultGenerationConfig();
  generationConfig.site = { latitude: 37.77, longitude: -122.4, elevationM: 0, timeZone: 'UTC' };
  generationConfig.assets = assets;
  generationConfig.externalResources = assets.flatMap((asset) => {
    if (asset.type !== 'wind' || !asset.enabled || asset.resourceMode !== 'interval_file' || !asset.externalResourceId) {
      return [];
    }
    return [{
      id: asset.externalResourceId,
      name: `Measured resource for ${asset.name}`,
      kind: 'wind_speed' as const,
      sourceTimeZone: 'UTC',
      intervalHours: 1,
      rowCount: hourlyTimestamps.length,
      startTimestampUtc: hourlyTimestamps[0],
      endTimestampUtc: hourlyTimestamps.at(-1)!,
      records: hourlyTimestamps.map((timestampUtc, hour) => ({
        timestampUtc,
        windSpeedMps: hour >= 8 && hour <= 17 ? 8 : 4,
      })),
    }];
  });

  const profile = DEFAULT_BATTERY_PROFILES[0];
  const tou = DEFAULT_TOU_PROFILES[0];
  const state: ProjectArchiveState = {
    profiles: [profile],
    activeProfileId: profile.id,
    touProfiles: [tou],
    activeTouProfileId: tou.id,
    tiers: tou.tiers,
    scheduleMatrix: tou.scheduleMatrix,
    generationConfig,
    allowSolarExport: false,
    financials: DEFAULT_MACRO_FINANCIALS,
    loadDataCsv: [
      'timestamp,usage_kwh',
      ...hourlyTimestamps.map((timestamp) => `${timestamp},1`),
    ].join('\n'),
    loadDataSource: 'uploaded',
  };
  return Buffer.from(await serializeProjectArchive(state).arrayBuffer());
}

type DisclosureScenario = {
  name: string;
  assets: GenerationAsset[];
  operationalMetric: 'Wind Generated' | 'Solar Generated';
  heading?: string;
  description?: RegExp;
  absentHeadings: string[];
};

const disclosureHeadings = [
  'Average-Resource Wind Modeling:',
  'Interval-Resource Wind Modeling:',
  'Mixed Wind Resource Modeling:',
];

const scenarios: DisclosureScenario[] = [
  {
    name: 'annual-average wind',
    assets: [createWindAsset('annual-wind', 'annual_average')],
    operationalMetric: 'Wind Generated',
    heading: disclosureHeadings[0],
    description: /Output is modeled from configured annual or monthly wind-speed statistics and the configured turbine power curve\./,
    absentHeadings: [disclosureHeadings[1], disclosureHeadings[2]],
  },
  {
    name: 'monthly-average wind',
    assets: [createWindAsset('monthly-wind', 'monthly_average')],
    operationalMetric: 'Wind Generated',
    heading: disclosureHeadings[0],
    description: /Output is modeled from configured annual or monthly wind-speed statistics and the configured turbine power curve\./,
    absentHeadings: [disclosureHeadings[1], disclosureHeadings[2]],
  },
  {
    name: 'interval-file wind',
    assets: [createWindAsset('interval-wind', 'interval_file')],
    operationalMetric: 'Wind Generated',
    heading: disclosureHeadings[1],
    description: /Output uses validated, time-aligned measured wind-speed records and the configured turbine model\. The records describe wind resource; turbine electrical output is modeled\./,
    absentHeadings: [disclosureHeadings[0], disclosureHeadings[2]],
  },
  {
    name: 'mixed statistical and interval-file wind',
    assets: [
      createWindAsset('mixed-average-wind', 'monthly_average'),
      createWindAsset('mixed-interval-wind', 'interval_file'),
    ],
    operationalMetric: 'Wind Generated',
    heading: disclosureHeadings[2],
    description: /This project combines validated, time-aligned measured wind-resource records with annual or monthly statistical inputs\. Turbine electrical output is modeled using the configured turbine models\./,
    absentHeadings: [disclosureHeadings[0], disclosureHeadings[1]],
  },
  {
    name: 'enabled interval wind ignores disabled annual-average wind',
    assets: [
      createWindAsset('enabled-interval-wind', 'interval_file'),
      createWindAsset('disabled-average-wind', 'annual_average', false),
    ],
    operationalMetric: 'Wind Generated',
    heading: disclosureHeadings[1],
    description: /Output uses validated, time-aligned measured wind-speed records/,
    absentHeadings: [disclosureHeadings[0], disclosureHeadings[2]],
  },
  {
    name: 'enabled monthly-average wind ignores unbound disabled interval wind',
    assets: [
      createWindAsset('enabled-average-wind', 'monthly_average'),
      createWindAsset('disabled-interval-wind', 'interval_file', false),
    ],
    operationalMetric: 'Wind Generated',
    heading: disclosureHeadings[0],
    description: /Output is modeled from configured annual or monthly wind-speed statistics/,
    absentHeadings: [disclosureHeadings[1], disclosureHeadings[2]],
  },
  {
    name: 'solar-only with disabled wind assets has no wind disclosure',
    assets: [
      createSolarAsset(),
      createWindAsset('solar-project-disabled-average-wind', 'annual_average', false),
      createWindAsset('solar-project-disabled-interval-wind', 'interval_file', false),
    ],
    operationalMetric: 'Solar Generated',
    absentHeadings: disclosureHeadings,
  },
  {
    name: 'solar-only project with no wind assets has no wind disclosure',
    assets: [createSolarAsset()],
    operationalMetric: 'Solar Generated',
    absentHeadings: disclosureHeadings,
  },
];

for (const scenario of scenarios) {
  test(`Results disclose ${scenario.name}`, async ({ page }) => {
    const filename = `${scenario.name.replaceAll(/[^a-z0-9]+/gi, '-')}.json`;
    const archive = await createProjectArchive(scenario.assets);

    await page.goto('/');
    await page.getByRole('button', { name: '1. Data & TOU Rates', exact: true }).last().click();
    page.once('dialog', (dialog) => dialog.accept());
    await page.locator('input[aria-label="Choose a VoltWise project JSON file"]').setInputFiles({
      name: filename,
      mimeType: 'application/json',
      buffer: archive,
    });
    await expect(page.getByRole('status').filter({ hasText: `Opened ${filename}` })).toBeVisible();

    await page.getByRole('button', { name: '5. Results & Analytics', exact: true }).last().click();
    const results = page.locator('main');
    await expect(results.getByText('Modeled Generation & Grid Dispatch Results')).toBeVisible();
    await expect(results.getByText('1-Day Observed Period', { exact: true })).toBeVisible();
    await expect(results.getByText(scenario.operationalMetric, { exact: true })).toBeVisible();

    if (scenario.heading) {
      await expect(results.getByText(scenario.heading, { exact: true })).toBeVisible();
      await expect(results).toContainText(scenario.description!);
    }
    for (const heading of scenario.absentHeadings) {
      await expect(results.getByText(heading, { exact: true })).toHaveCount(0);
    }
  });
}
