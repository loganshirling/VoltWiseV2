import { performance } from 'node:perf_hooks';
import { DEFAULT_BATTERY_PROFILES, DEFAULT_MACRO_FINANCIALS, DEFAULT_TOU_PROFILES, createDefaultScheduleMatrix } from '../src/utils/simulationEngine';
import { createDefaultGenerationConfig, createDefaultSolarAsset, createDefaultWindAsset } from '../src/utils/generationDefaults';
import { generateRealistic8760Dataset } from '../src/utils/sampleData';
import { runUnifiedSimulation } from '../src/utils/simulationRouter';
import { calculateGenerationOperationalProjection } from '../src/utils/generationProjection';
import { attachGenerationProjection, executeGenerationProjectionYear, executeSimulationJob, SimulationJobInput } from '../src/utils/simulationWorkerJob';
import { aggregateGenerationProjectCosts, calculateGenerationAwareFinancials } from '../src/utils/generationFinancials';
import { validateDirectGenerationBenchmarkResult, validateLegacyUnifiedResult, validateWorkerBaseResult, validateWorkerBenchmarkResult } from './benchmark-validation';

const scenario = process.argv[2] ?? '8760-single';
const runCount = Number(process.argv[3] ?? 6);
const executionPath = process.argv[4] ?? 'direct';
const bunVersion = (process.versions as NodeJS.ProcessVersions & { bun?: string }).bun;
const supportedScenarios = new Set([
  '8760-single', '8760-multi', '35040-single', '35040-multi', '35136-single', '35136-multi',
  'generation-25y', 'generation-25y-mixed', 'generation-25y-leap-mixed',
]);
if (!supportedScenarios.has(scenario)) throw new Error(`Unsupported benchmark scenario '${scenario}'.`);
if (!['direct', 'worker', 'clone'].includes(executionPath)) throw new Error(`Unsupported benchmark execution path '${executionPath}'.`);
if (!Number.isInteger(runCount) || runCount < 1) throw new Error('Run count must be a positive integer.');

const hourly = generateRealistic8760Dataset().dataPoints;
const quarterHour = hourly.flatMap((point) => Array.from({ length: 4 }, (_, quarter) => {
  const date = new Date(point.date.getTime() + quarter * 15 * 60 * 1000);
  return {
    ...point,
    timestamp: `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`,
    date,
    usageKwh: point.usageKwh / 4,
    hourlyTotal: point.usageKwh / 4,
  };
}));
const quarterHourLeapYear = [
  ...quarterHour,
  ...Array.from({ length: 96 }, (_, index) => {
    const previous = quarterHour.at(-1)!;
    const date = new Date(previous.date.getTime() + (index + 1) * 15 * 60 * 1000);
    return {
      ...previous,
      timestamp: `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`,
      date,
      hour: date.getUTCHours(),
    };
  }),
];
const dataPoints = scenario.startsWith('35136') ? quarterHourLeapYear : scenario.startsWith('35040') ? quarterHour : hourly;
const intervalHours = scenario.startsWith('35') ? 0.25 : 1;
const profiles = scenario.endsWith('multi') ? DEFAULT_BATTERY_PROFILES : [DEFAULT_BATTERY_PROFILES[0]];
const isMaximumMeasuredProject = scenario === 'generation-25y-leap-mixed';
const maximumProjectTimestamps = isMaximumMeasuredProject
  ? Array.from({ length: 35_136 }, (_, index) => new Date(Date.UTC(2024, 0, 1) + index * 15 * 60_000))
  : [];
const maximumProjectDataPoints = maximumProjectTimestamps.map((date) => ({
  timestamp: `${date.toISOString().slice(0, 10)} ${date.toISOString().slice(11, 16)}`,
  date,
  hour: date.getUTCHours(),
  dayOfWeek: date.getUTCDay(),
  month: date.getUTCMonth(),
  usageKwh: 0.25,
  hourlyTotal: 0.25,
}));
const tou = DEFAULT_TOU_PROFILES[0];
const emptyGenerationConfig = createDefaultGenerationConfig();
emptyGenerationConfig.site = { latitude: 37.7749, longitude: -122.4194, timeZone: 'UTC', elevationM: 16 };
const generationConfig = createDefaultGenerationConfig();
generationConfig.site = { latitude: 37.7749, longitude: -122.4194, timeZone: 'UTC', elevationM: 16 };
const solar = createDefaultSolarAsset('benchmark-solar');
solar.enabled = true;
solar.dcCapacityKw = 5;
solar.inverterAcCapacityKw = 5;
solar.monthlyPeakSunHoursPerDay = Array(12).fill(4);
generationConfig.assets = [solar];
if (isMaximumMeasuredProject) {
  solar.resourceMode = 'weather_file';
  solar.externalResourceId = 'benchmark-max-solar';
  const wind = createDefaultWindAsset('benchmark-wind');
  wind.enabled = true;
  wind.resourceMode = 'interval_file';
  wind.externalResourceId = 'benchmark-max-wind';
  wind.ratedPowerKw = 5;
  wind.hubHeightM = 20;
  wind.measurementHeightM = 10;
  wind.ratedWindSpeedMps = 11;
  wind.cutInWindSpeedMps = 3;
  wind.cutOutWindSpeedMps = 25;
  wind.powerCurve = [
    { windSpeedMps: 0, outputKw: 0 }, { windSpeedMps: 3, outputKw: 0 },
    { windSpeedMps: 7, outputKw: 2 }, { windSpeedMps: 11, outputKw: 5 },
    { windSpeedMps: 25, outputKw: 5 },
  ];
  generationConfig.assets.push(wind);
  generationConfig.externalResources = [
    {
      id: 'benchmark-max-solar', name: 'Maximum 2024 solar', kind: 'solar_irradiance', sourceTimeZone: 'UTC',
      intervalHours: 0.25, rowCount: maximumProjectTimestamps.length,
      startTimestampUtc: maximumProjectTimestamps[0].toISOString(), endTimestampUtc: maximumProjectTimestamps.at(-1)!.toISOString(),
      records: maximumProjectTimestamps.map((date) => ({ timestampUtc: date.toISOString(), ghiWm2: 850.5, dniWm2: 720.25, dhiWm2: 130.25 })),
    },
    {
      id: 'benchmark-max-wind', name: 'Maximum 2024 wind', kind: 'wind_speed', sourceTimeZone: 'UTC',
      intervalHours: 0.25, rowCount: maximumProjectTimestamps.length,
      startTimestampUtc: maximumProjectTimestamps[0].toISOString(), endTimestampUtc: maximumProjectTimestamps.at(-1)!.toISOString(),
      records: maximumProjectTimestamps.map((date) => ({ timestampUtc: date.toISOString(), windSpeedMps: 5.25 })),
    },
  ];
} else if (scenario === 'generation-25y-mixed') {
  const wind = createDefaultWindAsset('benchmark-wind');
  wind.enabled = true;
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
  generationConfig.assets.push(wind);
}
const workerInput: SimulationJobInput = {
  dataPoints: isMaximumMeasuredProject ? maximumProjectDataPoints : scenario.startsWith('generation-25y') ? hourly : dataPoints,
  intervalHours: isMaximumMeasuredProject ? 0.25 : scenario.startsWith('generation-25y') ? 1 : intervalHours,
  profiles,
  activeProfileId: profiles[0].id,
  tiers: tou.tiers,
  scheduleMatrix: createDefaultScheduleMatrix(),
  seasons: tou.seasons,
  generationConfig: scenario.startsWith('generation-25y') ? generationConfig : emptyGenerationConfig,
  allowSolarExport: scenario.startsWith('generation-25y'),
  annualProjectionEligible: scenario.startsWith('generation-25y'),
  preflightError: null,
  financials: DEFAULT_MACRO_FINANCIALS,
};

function runScenario(): (() => void) | undefined {
  if (executionPath === 'clone') {
    // Projection workers receive the complete input once for each projected year.
    const messages = scenario.startsWith('generation-25y') ? 25 : 1;
    for (let index = 0; index < messages; index += 1) structuredClone(workerInput);
    return;
  }
  if (executionPath === 'worker') {
    const result = executeSimulationJob(workerInput);
    validateWorkerBaseResult(result, scenario);
    if (scenario.startsWith('generation-25y')) {
      const years = Array.from({ length: 25 }, (_, index) => executeGenerationProjectionYear(workerInput, index + 1));
      attachGenerationProjection(result, workerInput, years);
    }
    return () => validateWorkerBenchmarkResult(result, scenario, scenario === 'generation-25y-leap-mixed' ? workerInput : undefined);
  }
  if (scenario.startsWith('generation-25y')) {
    const operationalProjection = calculateGenerationOperationalProjection({
      dataPoints: isMaximumMeasuredProject ? maximumProjectDataPoints : hourly,
      intervalHours: isMaximumMeasuredProject ? 0.25 : 1,
      tiers: tou.tiers,
      scheduleMatrix: createDefaultScheduleMatrix(),
      batteryProfile: DEFAULT_BATTERY_PROFILES[0],
      seasons: tou.seasons,
      generationConfig,
      allowSolarExport: true,
      annualElectricityInflationRate: DEFAULT_MACRO_FINANCIALS.annualElectricityInflationRate,
      annualBatteryDegradationRate: DEFAULT_MACRO_FINANCIALS.annualBatteryDegradationRate,
      projectionYears: 25,
      isSuitableForAnnual: true,
    });
    // Keep the direct-path timing comparable with historical projection-only runs.
    // The financial validation still runs for every warm-up and measured trial, outside its timer.
    return () => {
      const financialAnalysis = calculateGenerationAwareFinancials({
        batteryProfile: DEFAULT_BATTERY_PROFILES[0],
        operationalProjection,
        projectCosts: aggregateGenerationProjectCosts(generationConfig),
        financials: DEFAULT_MACRO_FINANCIALS,
      });
      validateDirectGenerationBenchmarkResult(operationalProjection, financialAnalysis, scenario, workerInput);
    };
  }

  for (const batteryProfile of profiles) {
    const result = runUnifiedSimulation({
      dataPoints,
      intervalHours,
      tiers: tou.tiers,
      scheduleMatrix: createDefaultScheduleMatrix(),
      batteryProfile,
      seasons: tou.seasons,
      generationConfig: emptyGenerationConfig,
      allowSolarExport: false,
    });
    validateLegacyUnifiedResult(result);
  }
}

function runStage(stage: string): (() => void) | undefined {
  try {
    return runScenario();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Benchmark scenario '${scenario}' failed during ${stage}: ${message}`, { cause: error });
  }
}

function validateStage(stage: string, validate: (() => void) | undefined): void {
  if (!validate) return;
  try {
    validate();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`Benchmark scenario '${scenario}' failed during ${stage}: ${message}`, { cause: error });
  }
}

validateStage('warm-up validation', runStage('warm-up')); // Warm the JIT before collecting timings.
const timings: number[] = [];
for (let index = 0; index < runCount; index += 1) {
  const start = performance.now();
  const validate = runStage(`measured trial ${index + 1}/${runCount}`);
  timings.push(performance.now() - start);
  validateStage(`measured trial ${index + 1}/${runCount} validation`, validate);
}
timings.sort((a, b) => a - b);
const percentileIndex = Math.ceil(timings.length * 0.95) - 1;
console.log(JSON.stringify({
  scenario,
  executionPath,
  runtime: bunVersion ? `Bun ${bunVersion} (Node compatibility ${process.version})` : `Node.js ${process.version}`,
  intervals: isMaximumMeasuredProject ? maximumProjectDataPoints.length : scenario.startsWith('generation-25y') ? hourly.length : dataPoints.length,
  profiles: scenario.startsWith('generation-25y') ? 1 : profiles.length,
  structuredCloneMessagesPerRun: executionPath === 'clone' && scenario.startsWith('generation-25y') ? 25 : executionPath === 'clone' ? 1 : undefined,
  runs: runCount,
  latencyMs: timings.map((value) => Number(value.toFixed(1))),
  p95Ms: Number(timings[percentileIndex].toFixed(1)),
  maxRssMb: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
}));
