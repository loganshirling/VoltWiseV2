import {
  BatteryProfile,
  CsvValidationResult,
  ExternalResourceDataset,
  GenerationAsset,
  GenerationConfig,
  LoadDataSource,
  MacroFinancials,
  ProjectArchiveState,
  RateTier,
  TouProfile,
  TouSeason,
  ValidatedProjectState,
} from '../types/energy';
import { parseAndValidateEnergyCsv } from './csvParser';
import { validateGeneratorAsset } from './generatorModel';
import { validateWindGenerationAsset } from './windModel';

export type { ProjectArchiveState, ValidatedProjectState } from '../types/energy';

export const PROJECT_ARCHIVE_FORMAT = 'voltwise-project';
export const CURRENT_PROJECT_ARCHIVE_VERSION = 2;

interface ProjectArchiveV2 {
  format: typeof PROJECT_ARCHIVE_FORMAT;
  schemaVersion: 2;
  project: Omit<ProjectArchiveState, 'loadDataCsv' | 'loadDataSource'> & {
    loadData: { csv: string; source: LoadDataSource | null } | null;
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function fail(path: string, expectation: string): never {
  throw new Error(`Invalid project archive: ${path} ${expectation}.`);
}

function requireRecord(value: unknown, path: string): Record<string, unknown> {
  if (!isRecord(value)) fail(path, 'must be an object');
  return value;
}

function requireString(value: unknown, path: string, allowEmpty = false): string {
  if (typeof value !== 'string' || (!allowEmpty && value.trim() === '')) {
    fail(path, allowEmpty ? 'must be a string' : 'must be a non-empty string');
  }
  return value;
}

function requireBoolean(value: unknown, path: string): boolean {
  if (typeof value !== 'boolean') fail(path, 'must be a boolean');
  return value;
}

function requireFiniteNumber(value: unknown, path: string, nullable = false): number | null {
  if (nullable && value === null) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(path, 'must be a finite number');
  return value;
}

function requireRange(value: unknown, path: string, min: number, max: number): number {
  const number = requireFiniteNumber(value, path)!;
  if (number < min || number > max) fail(path, `must be between ${min} and ${max}`);
  return number;
}

function requireNonNegative(value: unknown, path: string): number {
  const number = requireFiniteNumber(value, path)!;
  if (number < 0) fail(path, 'cannot be negative');
  return number;
}

function requireArray(value: unknown, path: string): unknown[] {
  if (!Array.isArray(value)) fail(path, 'must be an array');
  return value;
}

function requireEnum<T extends string>(value: unknown, values: readonly T[], path: string): T {
  if (typeof value !== 'string' || !values.includes(value as T)) fail(path, 'must be a supported string value');
  return value as T;
}

function validateScheduleReferences(schedule: string[][], tiers: RateTier[], path: string): void {
  const tierIds = new Set(tiers.map((tier) => tier.id));
  schedule.forEach((day, dayIndex) => day.forEach((tierId, hourIndex) => {
    if (!tierIds.has(tierId)) fail(`${path}[${dayIndex}][${hourIndex}]`, `references missing tier ${tierId}`);
  }));
}

function requireUniqueIds(values: Array<{ id: string }>, path: string): void {
  if (new Set(values.map((value) => value.id)).size !== values.length) {
    fail(path, 'contains duplicate ids');
  }
}

function requireTimeZone(value: unknown, path: string, nullable = false): string | null {
  if (nullable && value === null) return null;
  const timeZone = requireString(value, path, true);
  if (!timeZone) return timeZone;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone }).format(0);
  } catch {
    fail(path, 'must be a valid IANA timezone');
  }
  return timeZone;
}

function validateFiniteTree(value: unknown, path: string): void {
  if (typeof value === 'number' && !Number.isFinite(value)) fail(path, 'contains a non-finite number');
  if (Array.isArray(value)) {
    value.forEach((entry, index) => validateFiniteTree(entry, `${path}[${index}]`));
  } else if (isRecord(value)) {
    Object.entries(value).forEach(([key, entry]) => validateFiniteTree(entry, `${path}.${key}`));
  }
}

function validateTier(value: unknown, path: string): RateTier {
  const tier = requireRecord(value, path);
  requireString(tier.id, `${path}.id`);
  requireString(tier.name, `${path}.name`);
  requireString(tier.color, `${path}.color`);
  requireFiniteNumber(tier.buyRate, `${path}.buyRate`);
  requireFiniteNumber(tier.sellRate, `${path}.sellRate`);
  if (tier.isChargeWindow !== undefined) requireBoolean(tier.isChargeWindow, `${path}.isChargeWindow`);
  if (tier.isDischargeWindow !== undefined) requireBoolean(tier.isDischargeWindow, `${path}.isDischargeWindow`);
  return tier as unknown as RateTier;
}

function validateSeasons(value: unknown, path: string): TouSeason[] {
  return requireArray(value, path).map((entry, index) => {
    const seasonPath = `${path}[${index}]`;
    const season = requireRecord(entry, seasonPath);
    requireString(season.id, `${seasonPath}.id`);
    requireString(season.name, `${seasonPath}.name`);
    const months = requireArray(season.months, `${seasonPath}.months`);
    months.forEach((month, monthIndex) => {
      const numericMonth = requireFiniteNumber(month, `${seasonPath}.months[${monthIndex}]`)!;
      if (!Number.isInteger(numericMonth) || numericMonth < 0 || numericMonth > 11) {
        fail(`${seasonPath}.months[${monthIndex}]`, 'must be a month index from 0 through 11');
      }
    });
    const tierRates = requireRecord(season.tierRates, `${seasonPath}.tierRates`);
    Object.entries(tierRates).forEach(([tierId, rates]) => {
      const ratePath = `${seasonPath}.tierRates.${tierId}`;
      const rate = requireRecord(rates, ratePath);
      requireFiniteNumber(rate.buyRate, `${ratePath}.buyRate`);
      requireFiniteNumber(rate.sellRate, `${ratePath}.sellRate`);
    });
    return season as unknown as TouSeason;
  });
}

function validateTouProfile(value: unknown, path: string): TouProfile {
  const profile = requireRecord(value, path);
  requireString(profile.id, `${path}.id`);
  requireString(profile.name, `${path}.name`);
  requireString(profile.utility, `${path}.utility`, true);
  requireString(profile.description, `${path}.description`, true);
  const tiers = requireArray(profile.tiers, `${path}.tiers`).map((tier, index) =>
    validateTier(tier, `${path}.tiers[${index}]`)
  );
  if (tiers.length === 0) fail(`${path}.tiers`, 'must contain at least one rate tier');
  requireUniqueIds(tiers, `${path}.tiers`);
  const schedule = requireArray(profile.scheduleMatrix, `${path}.scheduleMatrix`);
  if (schedule.length !== 7) fail(`${path}.scheduleMatrix`, 'must contain seven days');
  schedule.forEach((day, dayIndex) => {
    const hours = requireArray(day, `${path}.scheduleMatrix[${dayIndex}]`);
    if (hours.length !== 24) fail(`${path}.scheduleMatrix[${dayIndex}]`, 'must contain 24 hours');
    hours.forEach((tierId, hourIndex) => requireString(tierId, `${path}.scheduleMatrix[${dayIndex}][${hourIndex}]`));
  });
  validateScheduleReferences(schedule as string[][], tiers, `${path}.scheduleMatrix`);
  validateSeasons(profile.seasons, `${path}.seasons`);
  return profile as unknown as TouProfile;
}

function validateBatteryProfile(value: unknown, path: string): BatteryProfile {
  const profile = requireRecord(value, path);
  ['id', 'name', 'model'].forEach((key) => requireString(profile[key], `${path}.${key}`));
  requireRange(profile.totalCapacityKwh, `${path}.totalCapacityKwh`, 1, 100);
  requireRange(profile.usableDodPercent, `${path}.usableDodPercent`, 50, 100);
  requireRange(profile.maxContinuousOutputKw, `${path}.maxContinuousOutputKw`, 0.5, 50);
  requireRange(profile.maxContinuousChargeKw, `${path}.maxContinuousChargeKw`, 0.5, 50);
  requireRange(profile.roundTripEfficiencyPercent, `${path}.roundTripEfficiencyPercent`, 70, 98);
  requireRange(profile.ratedCycleLife, `${path}.ratedCycleLife`, 1_000, 15_000);
  requireRange(profile.installedCost, `${path}.installedCost`, 500, 100_000);
  if (profile.strategy !== 'arbitrage' && profile.strategy !== 'self_consumption') {
    fail(`${path}.strategy`, 'is not a supported battery dispatch strategy');
  }
  ['chargeTiers', 'dischargeTiers'].forEach((key) => {
    requireArray(profile[key], `${path}.${key}`).forEach((tier, index) => requireString(tier, `${path}.${key}[${index}]`));
  });
  if (profile.allowGridExport !== undefined) requireBoolean(profile.allowGridExport, `${path}.allowGridExport`);
  return profile as unknown as BatteryProfile;
}

function validateGridOf<T>(value: unknown, path: string, validateCell: (cell: unknown, cellPath: string) => T): T[][] {
  const grid = requireArray(value, path);
  if (grid.length !== 7) fail(path, 'must contain seven days');
  return grid.map((day, dayIndex) => {
    const cells = requireArray(day, `${path}[${dayIndex}]`);
    if (cells.length !== 24) fail(`${path}[${dayIndex}]`, 'must contain 24 hours');
    return cells.map((cell, hourIndex) => validateCell(cell, `${path}[${dayIndex}][${hourIndex}]`));
  });
}

function validateGenerationAsset(value: unknown, path: string): GenerationAsset {
  const asset = requireRecord(value, path);
  ['id', 'name'].forEach((key) => requireString(asset[key], `${path}.${key}`));
  requireBoolean(asset.enabled, `${path}.enabled`);
  requireFiniteNumber(asset.installedCostUsd, `${path}.installedCostUsd`);
  requireFiniteNumber(asset.annualMaintenanceCostUsd, `${path}.annualMaintenanceCostUsd`);

  if (asset.type === 'solar') {
    [
      'dcCapacityKw', 'tiltDegrees', 'azimuthDegrees', 'inverterAcCapacityKw',
      'inverterEfficiencyPercent', 'systemLossPercent', 'shadingLossPercent', 'annualDegradationPercent',
    ].forEach((key) => requireFiniteNumber(asset[key], `${path}.${key}`));
    requireNonNegative(asset.installedCostUsd, `${path}.installedCostUsd`);
    requireNonNegative(asset.annualMaintenanceCostUsd, `${path}.annualMaintenanceCostUsd`);
    requireNonNegative(asset.dcCapacityKw, `${path}.dcCapacityKw`);
    requireRange(asset.tiltDegrees, `${path}.tiltDegrees`, 0, 90);
    requireRange(asset.azimuthDegrees, `${path}.azimuthDegrees`, 0, 359);
    requireNonNegative(asset.inverterAcCapacityKw, `${path}.inverterAcCapacityKw`);
    requireRange(asset.inverterEfficiencyPercent, `${path}.inverterEfficiencyPercent`, 50, 100);
    requireRange(asset.systemLossPercent, `${path}.systemLossPercent`, 0, 100);
    requireRange(asset.shadingLossPercent, `${path}.shadingLossPercent`, 0, 100);
    requireRange(asset.annualDegradationPercent, `${path}.annualDegradationPercent`, 0, 50);
    requireEnum(asset.resourceMode, ['clear_sky', 'monthly_peak_sun_hours', 'weather_file'], `${path}.resourceMode`);
    const monthly = requireArray(asset.monthlyPeakSunHoursPerDay, `${path}.monthlyPeakSunHoursPerDay`);
    if (monthly.length !== 12) fail(`${path}.monthlyPeakSunHoursPerDay`, 'must contain 12 months');
    monthly.forEach((entry, index) => requireRange(entry, `${path}.monthlyPeakSunHoursPerDay[${index}]`, 0, 14));
    if (asset.externalResourceId != null) requireString(asset.externalResourceId, `${path}.externalResourceId`);
    return asset as unknown as GenerationAsset;
  }

  if (asset.type === 'wind') {
    [
      'ratedPowerKw', 'hubHeightM', 'rotorDiameterM', 'cutInWindSpeedMps', 'ratedWindSpeedMps',
      'cutOutWindSpeedMps', 'availabilityPercent', 'systemLossPercent', 'measurementHeightM', 'windShearExponent',
    ].forEach((key) => requireFiniteNumber(asset[key], `${path}.${key}`));
    requireNonNegative(asset.installedCostUsd, `${path}.installedCostUsd`);
    requireNonNegative(asset.annualMaintenanceCostUsd, `${path}.annualMaintenanceCostUsd`);
    requireFiniteNumber(asset.annualAverageWindSpeedMps, `${path}.annualAverageWindSpeedMps`, true);
    requireEnum(asset.resourceMode, ['annual_average', 'monthly_average', 'interval_file'], `${path}.resourceMode`);
    const monthly = requireArray(asset.monthlyAverageWindSpeedMps, `${path}.monthlyAverageWindSpeedMps`);
    if (monthly.length !== 12) fail(`${path}.monthlyAverageWindSpeedMps`, 'must contain 12 months');
    monthly.forEach((entry, index) => requireFiniteNumber(entry, `${path}.monthlyAverageWindSpeedMps[${index}]`));
    requireArray(asset.powerCurve, `${path}.powerCurve`).forEach((entry, index) => {
      const point = requireRecord(entry, `${path}.powerCurve[${index}]`);
      requireFiniteNumber(point.windSpeedMps, `${path}.powerCurve[${index}].windSpeedMps`);
      requireFiniteNumber(point.outputKw, `${path}.powerCurve[${index}].outputKw`);
    });
    if (asset.externalResourceId != null) requireString(asset.externalResourceId, `${path}.externalResourceId`);
    if (asset.enabled) {
      try { validateWindGenerationAsset(asset as unknown as GenerationAsset & import('../types/energy').WindGenerationAsset); }
      catch (error) { fail(path, error instanceof Error ? error.message : 'contains an invalid wind asset'); }
    }
    return asset as unknown as GenerationAsset;
  }

  if (asset.type === 'generator') {
    [
      'ratedContinuousKw', 'minimumStableLoadPercent', 'fuelPricePerUnit',
      'variableMaintenanceCostPerHourUsd', 'startupFuelUnits',
    ].forEach((key) => requireFiniteNumber(asset[key], `${path}.${key}`));
    requireNonNegative(asset.installedCostUsd, `${path}.installedCostUsd`);
    requireNonNegative(asset.annualMaintenanceCostUsd, `${path}.annualMaintenanceCostUsd`);
    requireEnum(asset.fuelType, ['natural_gas', 'propane', 'gasoline', 'diesel', 'custom'], `${path}.fuelType`);
    requireEnum(asset.fuelUnit, ['gallon', 'therm', 'ccf', 'mmbtu', 'custom'], `${path}.fuelUnit`);
    requireEnum(asset.dispatchMode, ['standby', 'scheduled', 'economic'], `${path}.dispatchMode`);
    requireString(asset.customFuelUnitLabel, `${path}.customFuelUnitLabel`, true);
    requireBoolean(asset.allowBatteryCharging, `${path}.allowBatteryCharging`);
    requireBoolean(asset.allowGridExport, `${path}.allowGridExport`);
    requireArray(asset.fuelCurve, `${path}.fuelCurve`).forEach((entry, index) => {
      const point = requireRecord(entry, `${path}.fuelCurve[${index}]`);
      requireFiniteNumber(point.loadPercent, `${path}.fuelCurve[${index}].loadPercent`);
      requireFiniteNumber(point.fuelUnitsPerHour, `${path}.fuelCurve[${index}].fuelUnitsPerHour`);
    });
    validateGridOf(asset.scheduledHours, `${path}.scheduledHours`, requireBoolean);
    if (asset.enabled) {
      try { validateGeneratorAsset(asset as unknown as import('../types/energy').GeneratorGenerationAsset); }
      catch (error) { fail(path, error instanceof Error ? error.message : 'contains an invalid generator asset'); }
    }
    return asset as unknown as GenerationAsset;
  }

  return fail(`${path}.type`, 'must be solar, wind, or generator');
}

function validateExternalResource(value: unknown, path: string): ExternalResourceDataset {
  const resource = requireRecord(value, path);
  ['id', 'name'].forEach((key) => requireString(resource[key], `${path}.${key}`));
  if (resource.kind !== 'solar_irradiance' && resource.kind !== 'wind_speed') {
    fail(`${path}.kind`, 'must be solar_irradiance or wind_speed');
  }
  const sourceTimeZone = resource.sourceTimeZone === undefined
    ? null
    : requireTimeZone(resource.sourceTimeZone, `${path}.sourceTimeZone`, true);
  const intervalHours = requireFiniteNumber(resource.intervalHours, `${path}.intervalHours`)!;
  if (intervalHours <= 0) fail(`${path}.intervalHours`, 'must be positive');
  const rowCount = requireFiniteNumber(resource.rowCount, `${path}.rowCount`)!;
  if (!Number.isInteger(rowCount) || rowCount <= 0) fail(`${path}.rowCount`, 'must be a positive integer');
  const start = requireString(resource.startTimestampUtc, `${path}.startTimestampUtc`);
  const end = requireString(resource.endTimestampUtc, `${path}.endTimestampUtc`);
  const records = requireArray(resource.records, `${path}.records`);
  if (records.length !== rowCount) fail(`${path}.records`, 'count does not match rowCount');
  const timestamps: number[] = [];
  records.forEach((entry, index) => {
    const recordPath = `${path}.records[${index}]`;
    const record = requireRecord(entry, recordPath);
    const timestamp = requireString(record.timestampUtc, `${recordPath}.timestampUtc`);
    const timestampMs = Date.parse(timestamp);
    if (!Number.isFinite(timestampMs) || new Date(timestampMs).toISOString() !== timestamp) {
      fail(`${recordPath}.timestampUtc`, 'must be a canonical UTC timestamp');
    }
    timestamps.push(timestampMs);
    if (resource.kind === 'solar_irradiance') {
      ['ghiWm2', 'dniWm2', 'dhiWm2'].forEach((key) => {
        const numeric = requireFiniteNumber(record[key], `${recordPath}.${key}`)!;
        if (numeric < 0) fail(`${recordPath}.${key}`, 'cannot be negative');
      });
    } else {
      const windSpeed = requireFiniteNumber(record.windSpeedMps, `${recordPath}.windSpeedMps`)!;
      if (windSpeed < 0) fail(`${recordPath}.windSpeedMps`, 'cannot be negative');
    }
  });
  if (timestamps[0] !== Date.parse(start) || timestamps[timestamps.length - 1] !== Date.parse(end)) {
    fail(path, 'start/end metadata does not match its resource records');
  }
  for (let index = 1; index < timestamps.length; index += 1) {
    if (timestamps[index] - timestamps[index - 1] !== intervalHours * 3_600_000) {
      fail(`${path}.records[${index}]`, 'does not align to the resource interval');
    }
  }
  return { ...resource, sourceTimeZone } as unknown as ExternalResourceDataset;
}

function validateGenerationConfig(value: unknown): GenerationConfig {
  const config = requireRecord(value, 'project.generationConfig');
  const site = requireRecord(config.site, 'project.generationConfig.site');
  const latitude = requireFiniteNumber(site.latitude, 'project.generationConfig.site.latitude', true);
  if (latitude !== null && (latitude < -90 || latitude > 90)) fail('project.generationConfig.site.latitude', 'must be between -90 and 90');
  const longitude = requireFiniteNumber(site.longitude, 'project.generationConfig.site.longitude', true);
  if (longitude !== null && (longitude < -180 || longitude > 180)) fail('project.generationConfig.site.longitude', 'must be between -180 and 180');
  requireFiniteNumber(site.elevationM, 'project.generationConfig.site.elevationM', true);
  requireTimeZone(site.timeZone, 'project.generationConfig.site.timeZone');
  const assets = requireArray(config.assets, 'project.generationConfig.assets').map((asset, index) =>
    validateGenerationAsset(asset, `project.generationConfig.assets[${index}]`)
  );
  requireUniqueIds(assets, 'project.generationConfig.assets');
  const resources = config.externalResources === undefined
    ? []
    : requireArray(config.externalResources, 'project.generationConfig.externalResources').map((resource, index) =>
        validateExternalResource(resource, `project.generationConfig.externalResources[${index}]`)
      );
  const resourceIds = resources.map((resource) => resource.id);
  if (new Set(resourceIds).size !== resourceIds.length) fail('project.generationConfig.externalResources', 'contains duplicate ids');
  const resourceById = new Map(resources.map((resource) => [resource.id, resource]));
  assets.forEach((asset, index) => {
    if (!asset.enabled) return;
    if (asset.type === 'generator') return;
    const expectedKind = asset.type === 'solar' && asset.resourceMode === 'weather_file'
      ? 'solar_irradiance'
      : asset.type === 'wind' && asset.resourceMode === 'interval_file'
        ? 'wind_speed'
        : null;
    if (!expectedKind) return;
    const resourceId = asset.externalResourceId;
    // A deliberately unbound measured mode is a valid saved configuration;
    // simulation remains blocked until the user reattaches data or changes mode.
    if (!resourceId) return;
    if (!resourceById.has(resourceId)) {
      fail(`project.generationConfig.assets[${index}].externalResourceId`, `must reference an available ${expectedKind} resource`);
    }
    if (resourceById.get(resourceId)!.kind !== expectedKind) {
      fail(`project.generationConfig.assets[${index}].externalResourceId`, `must reference a ${expectedKind === 'solar_irradiance' ? 'solar irradiance' : 'wind speed'} resource`);
    }
  });
  return config.externalResources === undefined
    ? { site: site as unknown as GenerationConfig['site'], assets }
    : { site: site as unknown as GenerationConfig['site'], assets, externalResources: resources };
}

function validateFinancials(value: unknown): MacroFinancials {
  const financials = requireRecord(value, 'project.financials');
  [
    'federalTaxCreditPercent', 'localRebateFlat', 'annualElectricityInflationRate',
    'annualBatteryDegradationRate', 'discountRatePercent', 'opportunityCostRatePercent',
    'replacementCost', 'replacementYear', 'loanAprPercent', 'loanTermYears',
    'loanDownPaymentPercent', 'criticalLoadPowerKw', 'annualOutageDays', 'valueOfLostLoadPerDay',
  ].forEach((key) => requireFiniteNumber(financials[key], `project.financials.${key}`));
  requireRange(financials.federalTaxCreditPercent, 'project.financials.federalTaxCreditPercent', 0, 50);
  requireNonNegative(financials.localRebateFlat, 'project.financials.localRebateFlat');
  requireRange(financials.annualElectricityInflationRate, 'project.financials.annualElectricityInflationRate', 0, 10);
  requireRange(financials.annualBatteryDegradationRate, 'project.financials.annualBatteryDegradationRate', 0.5, 5);
  requireRange(financials.discountRatePercent, 'project.financials.discountRatePercent', 1, 12);
  requireRange(financials.opportunityCostRatePercent, 'project.financials.opportunityCostRatePercent', 1, 15);
  requireRange(financials.replacementCost, 'project.financials.replacementCost', 500, 5_000);
  requireRange(financials.replacementYear, 'project.financials.replacementYear', 5, 15);
  requireRange(financials.loanAprPercent, 'project.financials.loanAprPercent', 0, 15);
  if (![5, 10, 15, 20, 25].includes(financials.loanTermYears as number)) fail('project.financials.loanTermYears', 'must be one of 5, 10, 15, 20, or 25');
  requireRange(financials.loanDownPaymentPercent, 'project.financials.loanDownPaymentPercent', 0, 50);
  requireRange(financials.criticalLoadPowerKw, 'project.financials.criticalLoadPowerKw', 0.3, 4);
  requireRange(financials.annualOutageDays, 'project.financials.annualOutageDays', 0.5, 14);
  requireRange(financials.valueOfLostLoadPerDay, 'project.financials.valueOfLostLoadPerDay', 25, 300);
  if (financials.federalTaxCreditRealizationYear !== undefined) {
    const year = requireFiniteNumber(financials.federalTaxCreditRealizationYear, 'project.financials.federalTaxCreditRealizationYear');
    if (year !== 1 && year !== 2) fail('project.financials.federalTaxCreditRealizationYear', 'must be 1 or 2');
  }
  requireEnum(financials.opportunityCostVehicle, ['hysa', 'index_fund', 'custom'], 'project.financials.opportunityCostVehicle');
  ['replacementEnabled', 'isFinanced', 'includeVollInRoi'].forEach((key) => requireBoolean(financials[key], `project.financials.${key}`));
  return financials as unknown as MacroFinancials;
}

function validateStateFields(projectValue: unknown, legacyV1: boolean): ValidatedProjectState {
  const project = requireRecord(projectValue, 'project');
  const profiles = requireArray(project.profiles, 'project.profiles').map((profile, index) =>
    validateBatteryProfile(profile, `project.profiles[${index}]`)
  );
  if (profiles.length === 0) fail('project.profiles', 'must contain at least one battery profile');
  requireUniqueIds(profiles, 'project.profiles');
  const activeProfileId = requireString(project.activeProfileId, 'project.activeProfileId');
  if (!profiles.some((profile) => profile.id === activeProfileId)) fail('project.activeProfileId', 'does not match an available battery profile');

  const touProfiles = requireArray(project.touProfiles, 'project.touProfiles').map((profile, index) =>
    validateTouProfile(profile, `project.touProfiles[${index}]`)
  );
  if (touProfiles.length === 0) fail('project.touProfiles', 'must contain at least one tariff profile');
  requireUniqueIds(touProfiles, 'project.touProfiles');
  const activeTouProfileId = requireString(project.activeTouProfileId, 'project.activeTouProfileId');
  if (!touProfiles.some((profile) => profile.id === activeTouProfileId)) fail('project.activeTouProfileId', 'does not match an available tariff profile');

  const tiers = requireArray(project.tiers, 'project.tiers').map((tier, index) => validateTier(tier, `project.tiers[${index}]`));
  if (tiers.length === 0) fail('project.tiers', 'must contain at least one rate tier');
  requireUniqueIds(tiers, 'project.tiers');
  const scheduleMatrix = requireArray(project.scheduleMatrix, 'project.scheduleMatrix');
  if (scheduleMatrix.length !== 7) fail('project.scheduleMatrix', 'must contain seven days');
  scheduleMatrix.forEach((day, dayIndex) => {
    const hours = requireArray(day, `project.scheduleMatrix[${dayIndex}]`);
    if (hours.length !== 24) fail(`project.scheduleMatrix[${dayIndex}]`, 'must contain 24 hours');
    hours.forEach((tierId, hourIndex) => requireString(tierId, `project.scheduleMatrix[${dayIndex}][${hourIndex}]`));
  });
  validateScheduleReferences(scheduleMatrix as string[][], tiers, 'project.scheduleMatrix');

  const loadData = legacyV1
    ? (() => {
        if (!Object.prototype.hasOwnProperty.call(project, 'loadDataCsv')) fail('project.loadDataCsv', 'is required by schema version 1');
        return project.loadDataCsv == null
          ? null
          : { csv: requireString(project.loadDataCsv, 'project.loadDataCsv', true), source: null };
      })()
    : (() => {
        if (project.loadData === null) return null;
        const input = requireRecord(project.loadData, 'project.loadData');
        const csv = requireString(input.csv, 'project.loadData.csv', true);
        const source = input.source;
        if (source !== null && source !== 'synthetic_sample' && source !== 'uploaded') {
          fail('project.loadData.source', 'must be synthetic_sample, uploaded, or null');
        }
        return { csv, source: source as LoadDataSource | null };
      })();
  const loadDataCsv = loadData?.csv ?? null;
  const loadDataSource = loadData?.source ?? null;
  if (loadDataCsv === null && loadDataSource !== null) fail('project.loadData.source', 'cannot be set without load data');
  let csvResult: CsvValidationResult | null = null;
  if (loadDataCsv !== null) {
    try {
      csvResult = parseAndValidateEnergyCsv(loadDataCsv);
      if (!csvResult.schemaValid || !csvResult.chronologicallyValid) {
        fail('project.loadData.csv', 'failed schema or chronology validation');
      }
    } catch (error) {
      throw new Error(`Invalid project archive: project.loadData.csv could not be parsed: ${error instanceof Error ? error.message : 'invalid CSV'}`);
    }
  }

  return {
    profiles,
    activeProfileId,
    touProfiles,
    activeTouProfileId,
    tiers,
    scheduleMatrix: scheduleMatrix as string[][],
    generationConfig: validateGenerationConfig(project.generationConfig),
    allowSolarExport: requireBoolean(project.allowSolarExport, 'project.allowSolarExport'),
    financials: validateFinancials(project.financials),
    loadDataCsv,
    loadDataSource,
    csvResult,
  };
}

export function serializeProjectArchive(state: ProjectArchiveState): Blob {
  if (!state || typeof state !== 'object') fail('project state', 'must be an object');
  validateFiniteTree(state, 'project');
  const archive: ProjectArchiveV2 = {
    format: PROJECT_ARCHIVE_FORMAT,
    schemaVersion: CURRENT_PROJECT_ARCHIVE_VERSION,
    project: {
      profiles: state.profiles,
      activeProfileId: state.activeProfileId,
      touProfiles: state.touProfiles,
      activeTouProfileId: state.activeTouProfileId,
      tiers: state.tiers,
      scheduleMatrix: state.scheduleMatrix,
      generationConfig: state.generationConfig,
      allowSolarExport: state.allowSolarExport,
      financials: state.financials,
      loadData: state.loadDataCsv === null ? null : {
        csv: state.loadDataCsv,
        source: state.loadDataSource,
      },
    },
  };
  validateStateFields(archive.project, false);
  return new Blob([JSON.stringify(archive, null, 2)], { type: 'application/json;charset=utf-8' });
}

export async function parseProjectArchive(input: string | Blob | ArrayBuffer): Promise<ValidatedProjectState> {
  let rawText: string;
  try {
    rawText = typeof input === 'string'
      ? input
      : input instanceof Blob
      ? await input.text()
      : new TextDecoder().decode(input);
  } catch {
    throw new Error('Project archive could not be read. Choose a readable VoltWise project JSON file.');
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error('Project archive is not valid JSON. Choose an intact VoltWise project file.');
  }
  const archive = requireRecord(parsed, 'archive');
  if (archive.format !== PROJECT_ARCHIVE_FORMAT) fail('format', `must be ${PROJECT_ARCHIVE_FORMAT}`);
  if (typeof archive.schemaVersion !== 'number' || !Number.isInteger(archive.schemaVersion)) {
    fail('schemaVersion', 'must be an integer');
  }
  if (archive.schemaVersion > CURRENT_PROJECT_ARCHIVE_VERSION || archive.schemaVersion < 1) {
    throw new Error(`Unsupported project archive version: ${String(archive.schemaVersion)}.`);
  }
  if (archive.schemaVersion === 1) {
    return validateStateFields(archive.project, true);
  }
  if (archive.schemaVersion !== CURRENT_PROJECT_ARCHIVE_VERSION) {
    throw new Error(`Unsupported project archive version: ${String(archive.schemaVersion)}.`);
  }

  const project = requireRecord(archive.project, 'project');
  validateFiniteTree(project, 'project');
  return validateStateFields(project, false);
}
