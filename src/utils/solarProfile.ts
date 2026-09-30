/**
 * Monthly Peak-Sun-Hour Solar Profile & Summary Engine (Milestone G2B)
 *
 * Implements deterministic monthly solar-resource scaling:
 * 1. Requires valid, non-empty IANA time zone for local calendar alignment.
 * 2. Requires asset.resourceMode === 'monthly_peak_sun_hours' and a valid 12-element PSH array.
 * 3. Consumes normalized Date[] interval sequences that are strictly increasing, regularly spaced,
 *    and form complete local calendar days (supporting 23h, 24h, and 25h DST days).
 * 4. Normalizes horizontal solar resource (GHI) against the user's monthly peak sun hours (kWh/m²/day)
 *    using the actual supplied intervals for each local day.
 * 5. Scales DNI and POA by the identical horizontal resource scale factor, preserving the effects
 *    of site latitude, season, daylight duration, panel tilt, and panel azimuth.
 * 6. Applies STC DC capacity, system & shading losses, and inverter AC clipping.
 * 7. Computes monthly and annual generation profile summaries.
 */

import {
  GenerationSite,
  SolarGenerationAsset,
  MonthlyPeakSunHourSolarInterval,
  SolarMonthlyGenerationSummary,
  SolarGenerationProfileSummary,
} from '../types/energy';
import {
  calculateSolarPosition,
  calculateClearSkySolarInterval,
  calculatePvOutputFromPoa,
} from './solarModel';

/**
 * Validates site coordinates according to standard domain contracts.
 */
function validateSiteCoordinates(site: GenerationSite): void {
  if (
    site.latitude === null ||
    site.latitude === undefined ||
    site.longitude === null ||
    site.longitude === undefined
  ) {
    throw new Error('Site coordinates unconfigured: latitude and longitude must not be null.');
  }

  if (site.latitude < -90 || site.latitude > 90) {
    throw new Error(`Invalid latitude: ${site.latitude}. Must be between -90 and 90 degrees.`);
  }

  if (site.longitude < -180 || site.longitude > 180) {
    throw new Error(`Invalid longitude: ${site.longitude}. Must be between -180 and 180 degrees.`);
  }
}

/**
 * Validates that site.timeZone is a non-empty, valid IANA timezone string.
 *
 * Throws a clear error if empty or unrecognized by the runtime.
 */
export function validateTimeZone(timeZone?: string): string {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.trim() === '') {
    throw new Error('Site timeZone must be a non-empty, valid IANA timezone string.');
  }

  const trimmed = timeZone.trim();
  try {
    new Intl.DateTimeFormat(undefined, { timeZone: trimmed });
    return trimmed;
  } catch {
    throw new Error(`Invalid IANA timeZone: "${timeZone}". Must be a recognized IANA timezone.`);
  }
}

/**
 * Validates that an asset is correctly configured for the monthly_peak_sun_hours resource model.
 */
export function validateAssetForMonthlyPsh(asset: SolarGenerationAsset): void {
  if (!asset) {
    throw new Error('Asset must be defined.');
  }

  if (asset.resourceMode !== 'monthly_peak_sun_hours') {
    throw new Error(
      `Invalid resourceMode: "${asset.resourceMode}". Expected "monthly_peak_sun_hours".`
    );
  }

  if (
    !Array.isArray(asset.monthlyPeakSunHoursPerDay) ||
    asset.monthlyPeakSunHoursPerDay.length !== 12
  ) {
    throw new Error(
      `Invalid monthlyPeakSunHoursPerDay: expected an array of exactly 12 values, but got ${
        Array.isArray(asset.monthlyPeakSunHoursPerDay)
          ? asset.monthlyPeakSunHoursPerDay.length
          : typeof asset.monthlyPeakSunHoursPerDay
      }.`
    );
  }

  for (let i = 0; i < 12; i++) {
    const val = asset.monthlyPeakSunHoursPerDay[i];
    if (typeof val !== 'number' || !Number.isFinite(val) || val < 0) {
      throw new Error(
        `Invalid monthly peak-sun-hour entry at month index ${i}: ${val}. Must be a finite number >= 0.`
      );
    }
  }
}

/**
 * Extracts local calendar date (YYYY-MM-DD), month index (0-11), year, and day for a given instant.
 *
 * Mandatory timeZone parameter: throws if empty or not a valid IANA timezone.
 */
export function getLocalDateAndMonth(
  instantUtc: Date,
  timeZone: string
): { localDate: string; monthIndex: number; year: number; day: number } {
  if (!instantUtc || isNaN(instantUtc.getTime())) {
    throw new Error('Invalid instantUtc: must be a valid Date object.');
  }

  const tz = validateTimeZone(timeZone);

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  const localDate = formatter.format(instantUtc);
  const [yStr, mStr, dStr] = localDate.split('-');
  const year = parseInt(yStr, 10);
  const monthIndex = parseInt(mStr, 10) - 1;
  const day = parseInt(dStr, 10);

  return { localDate, monthIndex, year, day };
}

/**
 * Extracts detailed local date and time parts (year, month, day, hour, minute, second) for a Date.
 */
function getLocalTimeParts(
  date: Date,
  timeZone: string
): {
  localDate: string;
  monthIndex: number;
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
} {
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });

  const parts = dtf.formatToParts(date);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }

  const year = parseInt(map.year, 10);
  const month = parseInt(map.month, 10);
  const day = parseInt(map.day, 10);
  const hour = parseInt(map.hour, 10);
  const minute = parseInt(map.minute, 10);
  const second = parseInt(map.second, 10);
  const localDate = `${map.year}-${map.month}-${map.day}`;
  const monthIndex = month - 1;

  return { localDate, monthIndex, year, month, day, hour, minute, second };
}

/**
 * Converts a local calendar date and time (hours, minutes, seconds) into a UTC Date object.
 */
export function localTimeToUtc(
  year: number,
  month1Indexed: number,
  day: number,
  hour: number,
  minute: number,
  second: number,
  timeZone: string
): Date {
  const tz = validateTimeZone(timeZone);

  if (tz === 'UTC' || tz === 'Etc/UTC') {
    return new Date(Date.UTC(year, month1Indexed - 1, day, hour, minute, second));
  }

  const approx = new Date(Date.UTC(year, month1Indexed - 1, day, hour, minute, second));
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    hourCycle: 'h23',
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    minute: 'numeric',
    second: 'numeric',
  });
  const parts = dtf.formatToParts(approx);
  const map: Record<string, string> = {};
  for (const p of parts) {
    map[p.type] = p.value;
  }
  const asTz = new Date(
    Date.UTC(
      parseInt(map.year, 10),
      parseInt(map.month, 10) - 1,
      parseInt(map.day, 10),
      parseInt(map.hour, 10),
      parseInt(map.minute, 10),
      parseInt(map.second, 10)
    )
  );
  const diffMs = approx.getTime() - asTz.getTime();
  return new Date(approx.getTime() + diffMs);
}

/**
 * Calculates horizontal clear-sky GHI (kW/m²) at a specific UTC instant and site.
 */
function getClearSkyGhiAtInstant(instantUtc: Date, site: GenerationSite): number {
  const position = calculateSolarPosition(instantUtc, site);
  if (!position.isDaylight || position.elevationDegrees <= 0) {
    return 0;
  }

  const elevDeg = position.elevationDegrees;
  const elevRad = elevDeg * (Math.PI / 180);

  const airMass =
    1 /
    (Math.sin(elevRad) +
      0.50572 * Math.pow(elevDeg + 6.07995, -1.6364));

  const elevationM = site.elevationM ?? 0;
  const pressureRatio = Math.exp(-elevationM / 8434.5);
  const correctedAirMass = airMass * pressureRatio;

  const dni = Math.max(0, 1.353 * Math.pow(0.7, Math.pow(correctedAirMass, 0.678)));
  const beamHorizontal = dni * Math.sin(elevRad);
  const diffuseHorizontal = 0.1 * beamHorizontal;

  return beamHorizontal + diffuseHorizontal;
}

/**
 * Standalone utility to calculate clear-sky daily horizontal solar energy (GHI) integral
 * for a given local date.
 *
 * Result is in kWh/m²/day.
 */
export function calculateDailyClearSkyGhiKwhPerM2(
  localDateStr: string,
  site: GenerationSite,
  options?: { stepMinutes?: number; timeZone?: string }
): number {
  validateSiteCoordinates(site);
  const tz = validateTimeZone(options?.timeZone || site.timeZone);

  const [yearStr, monthStr, dayStr] = localDateStr.split('-');
  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  if (isNaN(year) || isNaN(month) || isNaN(day)) {
    throw new Error(`Invalid localDateStr: ${localDateStr}. Must be YYYY-MM-DD.`);
  }

  const stepMinutes = options?.stepMinutes ?? 15;
  if (stepMinutes <= 0 || !Number.isFinite(stepMinutes)) {
    throw new Error(`Invalid stepMinutes: ${stepMinutes}. Must be greater than 0.`);
  }

  const dt = stepMinutes / 60;
  const steps = Math.floor(1440 / stepMinutes);

  let totalDailyGhi = 0;
  for (let i = 0; i < steps; i++) {
    const minsFromMidnight = (i + 0.5) * stepMinutes;
    const hour = Math.floor(minsFromMidnight / 60);
    const minute = Math.floor(minsFromMidnight % 60);
    const instantUtc = localTimeToUtc(year, month, day, hour, minute, 0, tz);

    const ghiKwPerM2 = getClearSkyGhiAtInstant(instantUtc, site);
    totalDailyGhi += ghiKwPerM2 * dt;
  }

  return totalDailyGhi;
}

export interface SolarIntervalCalculationOptions {
  dailyClearSkyGhiKwhPerM2?: number;
  resourceScaleFactor?: number;
}

/**
 * Calculates interval solar generation under the monthly_peak_sun_hours resource model.
 *
 * Implements:
 * 1. NOAA clear-sky geometry to determine sun position and clear-sky irradiances (GHI, DNI, POA).
 * 2. Normalization of horizontal irradiance (GHI) against the user's monthly peak sun hours (kWh/m²/day).
 * 3. Scaling of DNI and POA by the identical resource scale factor.
 * 4. Application of system losses, shading losses, and inverter clipping via calculatePvOutputFromPoa.
 */
export function calculateMonthlyPeakSunHourSolarInterval(
  instantUtc: Date,
  intervalHours: number,
  site: GenerationSite,
  asset: SolarGenerationAsset,
  optionsOrDailyGhi?: SolarIntervalCalculationOptions | number
): MonthlyPeakSunHourSolarInterval {
  if (intervalHours <= 0 || !Number.isFinite(intervalHours)) {
    throw new Error(`Invalid intervalHours: ${intervalHours}. Must be greater than 0.`);
  }

  validateSiteCoordinates(site);
  const tz = validateTimeZone(site.timeZone);
  validateAssetForMonthlyPsh(asset);

  const { localDate, monthIndex } = getLocalDateAndMonth(instantUtc, tz);
  const targetPeakSunHoursPerDay = asset.monthlyPeakSunHoursPerDay[monthIndex];

  let resourceScaleFactor = 0;

  if (typeof optionsOrDailyGhi === 'number') {
    const dailyGhi = optionsOrDailyGhi;
    resourceScaleFactor =
      dailyGhi > 0 && targetPeakSunHoursPerDay > 0 ? targetPeakSunHoursPerDay / dailyGhi : 0;
  } else if (optionsOrDailyGhi && typeof optionsOrDailyGhi.resourceScaleFactor === 'number') {
    resourceScaleFactor = Math.max(0, optionsOrDailyGhi.resourceScaleFactor);
  } else if (optionsOrDailyGhi && typeof optionsOrDailyGhi.dailyClearSkyGhiKwhPerM2 === 'number') {
    const dailyGhi = optionsOrDailyGhi.dailyClearSkyGhiKwhPerM2;
    resourceScaleFactor =
      dailyGhi > 0 && targetPeakSunHoursPerDay > 0 ? targetPeakSunHoursPerDay / dailyGhi : 0;
  } else {
    const dailyClearSkyGhi = calculateDailyClearSkyGhiKwhPerM2(localDate, site, { timeZone: tz });
    resourceScaleFactor =
      dailyClearSkyGhi > 0 && targetPeakSunHoursPerDay > 0
        ? targetPeakSunHoursPerDay / dailyClearSkyGhi
        : 0;
  }

  // Clear-sky calculation for geometry and baseline irradiance
  const clearSky = calculateClearSkySolarInterval(instantUtc, intervalHours, site, asset);
  const clearSkyPoaKwPerM2 = clearSky.planeOfArrayIrradianceKwPerM2;

  // Scale GHI, DNI, and POA by identical horizontal resource scale factor
  const modeledGhiKwPerM2 = clearSky.clearSkyGhiKwPerM2 * resourceScaleFactor;
  const modeledDniKwPerM2 = clearSky.clearSkyDniKwPerM2 * resourceScaleFactor;
  const modeledPoaKwPerM2 = clearSkyPoaKwPerM2 * resourceScaleFactor;

  // Calculate electrical conversion from modeled POA irradiance
  const pvOutput = calculatePvOutputFromPoa(modeledPoaKwPerM2, intervalHours, asset);

  return {
    timestampUtc: instantUtc.toISOString(),
    localDate,
    monthIndex,
    targetPeakSunHoursPerDay,
    resourceScaleFactor,
    position: clearSky.position,
    clearSkyGhiKwPerM2: clearSky.clearSkyGhiKwPerM2,
    clearSkyDniKwPerM2: clearSky.clearSkyDniKwPerM2,
    clearSkyPoaKwPerM2,
    modeledGhiKwPerM2,
    modeledDniKwPerM2,
    modeledPoaKwPerM2,
    ...pvOutput,
  };
}

interface LocalIntervalData {
  instant: Date;
  localDate: string;
  monthIndex: number;
  hour: number;
  minute: number;
  second: number;
}

interface LocalDayGroup {
  localDate: string;
  monthIndex: number;
  intervals: LocalIntervalData[];
}

/**
 * Validates interval sequence and complete local calendar days, grouping intervals by day.
 */
function validateAndGroupCompleteLocalDays(
  instantsUtc: Date[],
  intervalHours: number,
  timeZone: string
): LocalDayGroup[] {
  if (!instantsUtc || instantsUtc.length === 0) {
    throw new Error('instantsUtc must contain at least one timestamp.');
  }

  if (intervalHours <= 0 || !Number.isFinite(intervalHours)) {
    throw new Error(`Invalid intervalHours: ${intervalHours}. Must be greater than 0.`);
  }

  const expectedStepMs = Math.round(intervalHours * 3600 * 1000);

  // 1. Validate Date objects, strict monotonicity, and regular spacing
  for (let i = 0; i < instantsUtc.length; i++) {
    const d = instantsUtc[i];
    if (!(d instanceof Date) || isNaN(d.getTime())) {
      throw new Error(`Invalid Date object at index ${i}.`);
    }

    if (i > 0) {
      const diffMs = d.getTime() - instantsUtc[i - 1].getTime();
      if (diffMs <= 0) {
        throw new Error(
          `Timestamps must be strictly increasing. Duplicate or out-of-order timestamp at index ${i}: ${d.toISOString()}.`
        );
      }
      if (Math.abs(diffMs - expectedStepMs) > 1) {
        throw new Error(
          `Irregular interval spacing at index ${i}: expected step of ${expectedStepMs}ms (${intervalHours}h), but got ${diffMs}ms.`
        );
      }
    }
  }

  // 2. Extract local time parts in the validated timezone
  const intervalDataList: LocalIntervalData[] = instantsUtc.map((instant) => {
    const parts = getLocalTimeParts(instant, timeZone);
    return {
      instant,
      localDate: parts.localDate,
      monthIndex: parts.monthIndex,
      hour: parts.hour,
      minute: parts.minute,
      second: parts.second,
    };
  });

  // 3. Group consecutive intervals into local calendar days
  const dayGroups: LocalDayGroup[] = [];
  let currentGroup: LocalDayGroup | null = null;

  for (const item of intervalDataList) {
    if (!currentGroup || currentGroup.localDate !== item.localDate) {
      currentGroup = {
        localDate: item.localDate,
        monthIndex: item.monthIndex,
        intervals: [item],
      };
      dayGroups.push(currentGroup);
    } else {
      currentGroup.intervals.push(item);
    }
  }

  // 4. Verify each local calendar day is complete
  for (const group of dayGroups) {
    const firstInterval = group.intervals[0];
    if (
      firstInterval.hour !== 0 ||
      firstInterval.minute !== 0 ||
      firstInterval.second !== 0
    ) {
      throw new Error(
        `Incomplete local day: day ${group.localDate} does not start at local 00:00:00 (first interval is at ${String(firstInterval.hour).padStart(2, '0')}:${String(firstInterval.minute).padStart(2, '0')}).`
      );
    }

    const lastInterval = group.intervals[group.intervals.length - 1];
    const nextInstant = new Date(lastInterval.instant.getTime() + expectedStepMs);
    const nextParts = getLocalTimeParts(nextInstant, timeZone);

    if (
      nextParts.hour !== 0 ||
      nextParts.minute !== 0 ||
      nextParts.second !== 0 ||
      nextParts.localDate === group.localDate
    ) {
      throw new Error(
        `Incomplete local day: day ${group.localDate} does not end at the boundary of the following local day (ended prematurely after ${group.intervals.length} intervals).`
      );
    }
  }

  return dayGroups;
}

/**
 * Authoritative public profile generator for the monthly_peak_sun_hours resource model.
 *
 * Normalizes horizontal solar irradiance (GHI) against the configured monthly peak sun hours
 * using the actual supplied intervals for each complete local calendar day.
 */
export function generateMonthlyPeakSunHourSolarProfile(
  instantsUtc: Date[],
  intervalHours: number,
  site: GenerationSite,
  asset: SolarGenerationAsset
): MonthlyPeakSunHourSolarInterval[] {
  validateSiteCoordinates(site);
  const timeZone = validateTimeZone(site.timeZone);
  validateAssetForMonthlyPsh(asset);

  const dayGroups = validateAndGroupCompleteLocalDays(instantsUtc, intervalHours, timeZone);

  const results: MonthlyPeakSunHourSolarInterval[] = [];

  for (const group of dayGroups) {
    // 1. Calculate clear-sky result for each actual interval in the day
    const dayClearSkyResults = group.intervals.map((item) => ({
      item,
      clearSky: calculateClearSkySolarInterval(item.instant, intervalHours, site, asset),
    }));

    // 2. Sum clear-sky GHI energy over the actual supplied intervals
    const clearSkyDailyGhi = dayClearSkyResults.reduce(
      (sum, { clearSky }) => sum + clearSky.clearSkyGhiKwPerM2 * intervalHours,
      0
    );

    // 3. Resolve target daily GHI from asset's local calendar month
    const targetDailyGhi = asset.monthlyPeakSunHoursPerDay[group.monthIndex];

    // 4. Calculate exact daily resource scale factor
    const resourceScaleFactor =
      targetDailyGhi > 0 && clearSkyDailyGhi > 0 ? targetDailyGhi / clearSkyDailyGhi : 0;

    // 5. Apply scaling to each interval in the day
    for (const { item, clearSky } of dayClearSkyResults) {
      const clearSkyPoaKwPerM2 = clearSky.planeOfArrayIrradianceKwPerM2;
      const modeledGhiKwPerM2 = clearSky.clearSkyGhiKwPerM2 * resourceScaleFactor;
      const modeledDniKwPerM2 = clearSky.clearSkyDniKwPerM2 * resourceScaleFactor;
      const modeledPoaKwPerM2 = clearSkyPoaKwPerM2 * resourceScaleFactor;

      const pvOutput = calculatePvOutputFromPoa(modeledPoaKwPerM2, intervalHours, asset);

      results.push({
        timestampUtc: item.instant.toISOString(),
        localDate: item.localDate,
        monthIndex: item.monthIndex,
        targetPeakSunHoursPerDay: targetDailyGhi,
        resourceScaleFactor,
        position: clearSky.position,
        clearSkyGhiKwPerM2: clearSky.clearSkyGhiKwPerM2,
        clearSkyDniKwPerM2: clearSky.clearSkyDniKwPerM2,
        clearSkyPoaKwPerM2,
        modeledGhiKwPerM2,
        modeledDniKwPerM2,
        modeledPoaKwPerM2,
        ...pvOutput,
      });
    }
  }

  return results;
}

/**
 * Summarizes an interval solar generation profile into monthly and overall aggregate metrics.
 */
export function summarizeSolarGenerationProfile(
  intervals: MonthlyPeakSunHourSolarInterval[]
): SolarGenerationProfileSummary {
  let totalDcEnergyKwh = 0;
  let totalAcEnergyKwh = 0;
  let totalClippedEnergyKwh = 0;

  // Initialize all 12 calendar months (0 = Jan .. 11 = Dec)
  const monthly: SolarMonthlyGenerationSummary[] = Array.from({ length: 12 }, (_, monthIndex) => ({
    monthIndex,
    intervalCount: 0,
    dcEnergyKwh: 0,
    acEnergyKwh: 0,
    clippedEnergyKwh: 0,
  }));

  for (const interval of intervals) {
    totalDcEnergyKwh += interval.dcEnergyKwh;
    totalAcEnergyKwh += interval.acEnergyKwh;
    totalClippedEnergyKwh += interval.clippedEnergyKwh;

    const m = interval.monthIndex;
    if (m >= 0 && m < 12) {
      const ms = monthly[m];
      ms.intervalCount += 1;
      ms.dcEnergyKwh += interval.dcEnergyKwh;
      ms.acEnergyKwh += interval.acEnergyKwh;
      ms.clippedEnergyKwh += interval.clippedEnergyKwh;
    }
  }

  return {
    intervalCount: intervals.length,
    totalDcEnergyKwh,
    totalAcEnergyKwh,
    totalClippedEnergyKwh,
    monthly,
  };
}

export { summarizeSolarGenerationProfile as calculateSolarProfileSummary };
export { summarizeSolarGenerationProfile as summarizeSolarProfile };
