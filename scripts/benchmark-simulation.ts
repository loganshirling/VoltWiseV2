import { performance } from 'node:perf_hooks';
import { DEFAULT_BATTERY_PROFILES, DEFAULT_MACRO_FINANCIALS, DEFAULT_TOU_PROFILES, createDefaultScheduleMatrix } from '../src/utils/simulationEngine';
import { createDefaultGenerationConfig, createDefaultSolarAsset } from '../src/utils/generationDefaults';
import { generateRealistic8760Dataset } from '../src/utils/sampleData';
import { runUnifiedSimulation } from '../src/utils/simulationRouter';
import { calculateGenerationOperationalProjection } from '../src/utils/generationProjection';
import { attachGenerationProjection, executeGenerationProjectionYear, executeSimulationJob, SimulationJobInput } from '../src/utils/simulationWorkerJob';

const scenario = process.argv[2] ?? '8760-single';
const runCount = Number(process.argv[3] ?? 6);
const executionPath = process.argv[4] ?? 'direct';
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
const dataPoints = scenario.startsWith('35040') ? quarterHour : hourly;
const intervalHours = scenario.startsWith('35040') ? 0.25 : 1;
const profiles = scenario.endsWith('multi') ? DEFAULT_BATTERY_PROFILES : [DEFAULT_BATTERY_PROFILES[0]];
const tou = DEFAULT_TOU_PROFILES[0];
const generationConfig = createDefaultGenerationConfig();
const solar = createDefaultSolarAsset('benchmark-solar');
solar.enabled = true;
solar.dcCapacityKw = 5;
solar.inverterAcCapacityKw = 5;
solar.monthlyPeakSunHoursPerDay = Array(12).fill(4);
generationConfig.assets = [solar];
generationConfig.site = { latitude: 37.7749, longitude: -122.4194, timeZone: 'UTC', elevationM: 16 };
const workerInput: SimulationJobInput = {
  dataPoints: scenario === 'generation-25y' ? hourly : dataPoints,
  intervalHours: scenario === 'generation-25y' ? 1 : intervalHours,
  profiles,
  activeProfileId: profiles[0].id,
  tiers: tou.tiers,
  scheduleMatrix: createDefaultScheduleMatrix(),
  seasons: tou.seasons,
  generationConfig: scenario === 'generation-25y' ? generationConfig : createDefaultGenerationConfig(),
  allowSolarExport: scenario === 'generation-25y',
  annualProjectionEligible: scenario === 'generation-25y',
  preflightError: null,
  financials: DEFAULT_MACRO_FINANCIALS,
};

function runScenario(): void {
  if (executionPath === 'worker') {
    const result = executeSimulationJob(workerInput);
    if (scenario === 'generation-25y' && result.activeUnifiedResult?.mode === 'generation-aware') {
      const years = Array.from({ length: 25 }, (_, index) => executeGenerationProjectionYear(workerInput, index + 1));
      attachGenerationProjection(result, workerInput, years);
    }
    return;
  }
  if (scenario === 'generation-25y') {
    calculateGenerationOperationalProjection({
      dataPoints: hourly,
      intervalHours: 1,
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
    return;
  }

  for (const batteryProfile of profiles) {
    runUnifiedSimulation({
      dataPoints,
      intervalHours,
      tiers: tou.tiers,
      scheduleMatrix: createDefaultScheduleMatrix(),
      batteryProfile,
      seasons: tou.seasons,
      generationConfig: createDefaultGenerationConfig(),
      allowSolarExport: false,
    });
  }
}

runScenario(); // Warm the JIT before collecting timings.
const timings: number[] = [];
for (let index = 0; index < runCount; index += 1) {
  const start = performance.now();
  runScenario();
  timings.push(performance.now() - start);
}
timings.sort((a, b) => a - b);
const percentileIndex = Math.ceil(timings.length * 0.95) - 1;
console.log(JSON.stringify({
  scenario,
  executionPath,
  runtime: `Bun ${process.env.BUN_VERSION ?? 'version not exposed'} (Node compatibility ${process.version})`,
  intervals: scenario === 'generation-25y' ? hourly.length : dataPoints.length,
  profiles: scenario === 'generation-25y' ? 1 : profiles.length,
  runs: runCount,
  latencyMs: timings.map((value) => Number(value.toFixed(1))),
  p95Ms: Number(timings[percentileIndex].toFixed(1)),
  maxRssMb: Number((process.resourceUsage().maxRSS / 1024).toFixed(1)),
}));
