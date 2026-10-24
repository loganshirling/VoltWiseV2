/**
 * Load Time Alignment Engine (G2D)
 *
 * Resolves utility/load interval timestamps into authoritative UTC instants
 * using a configured site IANA timezone, with strict DST nonexistence/ambiguity
 * detection and sequence regularity validation.
 */

import { IntervalDataPoint } from '../types/energy';

export interface AlignedLoadTimestamp {
  sourceIndex: number;
  sourceTimestamp: string;
  instantUtc: Date;
  timestampUtc: string;
}

/**
 * Validates whether a timezone identifier is a supported, non-empty IANA timezone string.
 */
export function isValidIanaTimeZone(timeZone: string): boolean {
  if (!timeZone || typeof timeZone !== 'string' || timeZone.trim() === '') {
    return false;
  }
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timeZone.trim() });
    return true;
  } catch {
    return false;
  }
}

export interface ParsedTimestamp {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  millisecond: number;
  offsetMinutes?: number;
}

interface LocalParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

export interface SiteLocalCalendarCoordinates {
  year: number;
  /** Zero-based month, matching tariff season contracts. */
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
  dayOfWeek: number;
}

export interface AnnualProjectionEligibility {
  eligible: boolean;
  reason?: string;
}

/** A formatter scoped to one operation, avoiding repeated construction without a global cache. */
export class SiteLocalCalendarContext {
  readonly timeZone: string;
  readonly formatter: Intl.DateTimeFormat;

  constructor(timeZone: string) {
    this.timeZone = typeof timeZone === 'string' ? timeZone.trim() : '';
    try {
      this.formatter = new Intl.DateTimeFormat('en-US', {
        timeZone: this.timeZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      });
    } catch {
      throw new Error(`Invalid IANA timezone: "${timeZone}".`);
    }
  }
}

// Regex matching ISO 8601 and local timestamp formats:
// YYYY-MM-DD HH:mm[:ss[.sss]] or YYYY-MM-DDTHH:mm[:ss[.sss]] with optional Z or offset
const TIMESTAMP_REGEX =
  /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3})\d*)?)?(?:\s*(Z|[+-]\d{2}(?::?\d{2})?))?$/i;

/**
 * Parses and validates raw timestamp string components.
 */
export function parseTimestampString(raw: string): ParsedTimestamp {
  if (typeof raw !== 'string') {
    throw new Error(`Timestamp must be a string. Received: ${String(raw)}`);
  }
  const str = raw.trim();
  const match = str.match(TIMESTAMP_REGEX);
  if (!match) {
    throw new Error(
      `Invalid timestamp format: "${raw}". Expected YYYY-MM-DD HH:mm or ISO 8601.`
    );
  }

  const year = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  const day = parseInt(match[3], 10);
  const hour = parseInt(match[4], 10);
  const minute = parseInt(match[5], 10);
  const second = match[6] ? parseInt(match[6], 10) : 0;
  const millisecond = match[7]
    ? parseInt(match[7].padEnd(3, '0').slice(0, 3), 10)
    : 0;

  if (month < 1 || month > 12) {
    throw new Error(`Invalid month in timestamp: "${raw}"`);
  }

  // Validate day of month considering leap years
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
  if (day < 1 || day > daysInMonth) {
    throw new Error(
      `Invalid day of month in timestamp: "${raw}" (month ${month} has ${daysInMonth} days)`
    );
  }

  if (hour < 0 || hour > 23) {
    throw new Error(`Invalid hour in timestamp: "${raw}"`);
  }
  if (minute < 0 || minute > 59) {
    throw new Error(`Invalid minute in timestamp: "${raw}"`);
  }
  if (second < 0 || second > 59) {
    throw new Error(`Invalid second in timestamp: "${raw}"`);
  }

  let offsetMinutes: number | undefined = undefined;
  if (match[8] !== undefined) {
    const offStr = match[8];
    if (offStr.toUpperCase() === 'Z') {
      offsetMinutes = 0;
    } else {
      const offMatch = offStr.match(/^([+-])(\d{2}):?(\d{2})?$/);
      if (!offMatch) {
        throw new Error(`Invalid UTC offset format in timestamp: "${raw}"`);
      }
      const sign = offMatch[1] === '-' ? -1 : 1;
      const offHours = parseInt(offMatch[2], 10);
      const offMins = offMatch[3] ? parseInt(offMatch[3], 10) : 0;
      if (offHours > 23 || offMins > 59) {
        throw new Error(`Invalid offset values in timestamp: "${raw}"`);
      }
      offsetMinutes = sign * (offHours * 60 + offMins);
    }
  }

  return {
    year,
    month,
    day,
    hour,
    minute,
    second,
    millisecond,
    offsetMinutes,
  };
}

/**
 * Extracts wall-clock date/time parts of a given UTC instant in a specific timezone.
 */
function getLocalParts(date: Date, dtf: Intl.DateTimeFormat): LocalParts {
  const parts = dtf.formatToParts(date);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;
  let minute = 0;
  let second = 0;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === 'year') year = parseInt(p.value, 10);
    else if (p.type === 'month') month = parseInt(p.value, 10);
    else if (p.type === 'day') day = parseInt(p.value, 10);
    else if (p.type === 'hour') hour = parseInt(p.value, 10);
    else if (p.type === 'minute') minute = parseInt(p.value, 10);
    else if (p.type === 'second') second = parseInt(p.value, 10);
  }

  if (hour === 24) hour = 0;

  return { year, month, day, hour, minute, second };
}

/** Maps an absolute interval instant to tariff calendar coordinates for a site. */
export function getSiteLocalCalendarCoordinates(
  instantUtc: Date,
  timeZone: string | SiteLocalCalendarContext
): SiteLocalCalendarCoordinates {
  if (!(instantUtc instanceof Date) || !Number.isFinite(instantUtc.getTime())) {
    throw new Error('A valid UTC instant is required.');
  }
  const context = timeZone instanceof SiteLocalCalendarContext
    ? timeZone
    : new SiteLocalCalendarContext(timeZone);
  const local = getLocalParts(instantUtc, context.formatter);
  return {
    ...local,
    month: local.month - 1,
    dayOfWeek: new Date(Date.UTC(local.year, local.month - 1, local.day)).getUTCDay(),
  };
}

/**
 * Allows lifecycle projection only for a complete, gap-free local calendar year.
 * Explicit-offset and local-wall timestamps are both resolved through the site zone.
 */
export function evaluateAnnualProjectionEligibility(
  dataPoints: IntervalDataPoint[],
  intervalHours: number,
  timeZone: string
): AnnualProjectionEligibility {
  try {
    const zone = typeof timeZone === 'string' ? timeZone.trim() : '';
    if (!isValidIanaTimeZone(zone)) throw new Error('A valid site timezone is required.');
    const aligned = alignLoadTimestampsToSite(dataPoints, intervalHours, zone);
    return evaluateAlignedAnnualProjectionEligibility(aligned, intervalHours, zone);
  } catch (error: unknown) {
    return { eligible: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/** Exact-year check for an already cadence-validated aligned sequence. */
export function evaluateAlignedAnnualProjectionEligibility(
  aligned: AlignedLoadTimestamp[],
  intervalHours: number,
  timeZone: string
): AnnualProjectionEligibility {
  try {
    const zone = typeof timeZone === 'string' ? timeZone.trim() : '';
    if (!isValidIanaTimeZone(zone)) throw new Error('A valid site timezone is required.');
    if (!Array.isArray(aligned) || aligned.length === 0) throw new Error('Dataset must be non-empty.');
    const first = getSiteLocalCalendarCoordinates(aligned[0].instantUtc, zone);
    const last = getSiteLocalCalendarCoordinates(aligned[aligned.length - 1].instantUtc, zone);
    if (first.year !== last.year) throw new Error('Dataset must cover exactly one calendar year.');
    const yearStart = resolveTimestampToUtc(`${first.year}-01-01T00:00:00`, 0, zone);
    const nextYearStart = resolveTimestampToUtc(`${first.year + 1}-01-01T00:00:00`, 0, zone);
    const stepMs = Math.round(intervalHours * 3_600_000);
    const expectedCount = (nextYearStart.getTime() - yearStart.getTime()) / stepMs;
    if (!Number.isInteger(expectedCount) || expectedCount <= 0) throw new Error('Interval does not divide the calendar year exactly.');
    if (
      Math.abs(aligned[0].instantUtc.getTime() - yearStart.getTime()) > 1000 ||
      Math.abs(aligned[aligned.length - 1].instantUtc.getTime() - (nextYearStart.getTime() - stepMs)) > 1000 ||
      aligned.length !== expectedCount
    ) throw new Error('Dataset must contain every interval in one complete calendar year.');
    return { eligible: true };
  } catch (error: unknown) {
    return { eligible: false, reason: error instanceof Error ? error.message : String(error) };
  }
}

/**
 * Computes the timezone offset in milliseconds at a given instant:
 * offsetMs = (local wall-clock as UTC ms) - (instant UTC ms)
 */
function getTimeZoneOffsetMs(date: Date, dtf: Intl.DateTimeFormat): number {
  const local = getLocalParts(date, dtf);
  const localAsUtcMs = Date.UTC(
    local.year,
    local.month - 1,
    local.day,
    local.hour,
    local.minute,
    local.second,
    date.getUTCMilliseconds()
  );
  return localAsUtcMs - date.getTime();
}

/**
 * Resolves a single timestamp string to an authoritative UTC Date instant.
 */
function resolveTimestampToUtcWithCaches(
  raw: string,
  sourceIndex: number,
  timeZone: string,
  formatterCache?: Map<string, Intl.DateTimeFormat>,
  dailyOffsetCache?: Map<string, Set<number>>
): Date {
  const parsed = parseTimestampString(raw);

  // If timestamp contains an explicit offset or Z, treat as an absolute instant.
  // Do not reinterpret an explicitly offset timestamp through timeZone.
  if (parsed.offsetMinutes !== undefined) {
    const naiveUtcMs = Date.UTC(
      parsed.year,
      parsed.month - 1,
      parsed.day,
      parsed.hour,
      parsed.minute,
      parsed.second,
      parsed.millisecond
    );
    const instantMs = naiveUtcMs - parsed.offsetMinutes * 60 * 1000;
    return new Date(instantMs);
  }

  // Local wall-clock timestamp: require valid non-empty IANA timezone
  const trimmedZone = typeof timeZone === 'string' ? timeZone.trim() : '';
  let dtf: Intl.DateTimeFormat;
  if (formatterCache && formatterCache.has(trimmedZone)) {
    dtf = formatterCache.get(trimmedZone)!;
  } else {
    try {
      dtf = new Intl.DateTimeFormat('en-US', {
        timeZone: trimmedZone,
        year: 'numeric', month: '2-digit', day: '2-digit',
        hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
      });
    } catch {
      throw new Error(
        `Invalid IANA timezone: "${timeZone}". A valid, non-empty IANA timezone is required to resolve local wall-clock timestamp "${raw}".`
      );
    }
    if (formatterCache) {
      formatterCache.set(trimmedZone, dtf);
    }
  }

  const naiveUtcMs = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    parsed.hour,
    parsed.minute,
    parsed.second,
    parsed.millisecond
  );

  // Sample offsets around naiveUtcMs (+- 36 hours) and deduplicate
  const sampleOffsetsHours = [-36, -24, -12, 0, 12, 24, 36];
  const offsetCacheKey = `${trimmedZone}:${parsed.year}-${parsed.month}-${parsed.day}`;
  let uniqueOffsets = dailyOffsetCache?.get(offsetCacheKey);
  if (!uniqueOffsets) {
    uniqueOffsets = new Set<number>();
    for (let s = 0; s < sampleOffsetsHours.length; s++) {
      const sampleDate = new Date(naiveUtcMs + sampleOffsetsHours[s] * 3600 * 1000);
      uniqueOffsets.add(getTimeZoneOffsetMs(sampleDate, dtf));
    }
    dailyOffsetCache?.set(offsetCacheKey, uniqueOffsets);
  }

  // Check which candidate offsets produce local components that exactly match the requested wall-clock
  const matchingCandidates: Date[] = [];
  for (const offsetMs of uniqueOffsets) {
    const candidateUtcMs = naiveUtcMs - offsetMs;
    const candidateDate = new Date(candidateUtcMs);
    const local = getLocalParts(candidateDate, dtf);

    if (
      local.year === parsed.year &&
      local.month === parsed.month &&
      local.day === parsed.day &&
      local.hour === parsed.hour &&
      local.minute === parsed.minute &&
      local.second === parsed.second
    ) {
      matchingCandidates.push(candidateDate);
    }
  }

  if (matchingCandidates.length === 0) {
    throw new Error(
      `Timestamp "${raw}" at index ${sourceIndex} represents a nonexistent local time in timezone "${trimmedZone}" due to DST transition.`
    );
  }

  if (matchingCandidates.length > 1) {
    throw new Error(
      `Timestamp "${raw}" at index ${sourceIndex} represents an ambiguous local time in timezone "${trimmedZone}" due to DST transition. Without an explicit UTC offset, it is ambiguous.`
    );
  }

  return matchingCandidates[0];
}

/** Resolves a single timestamp while strictly validating local-wall timezone input. */
export function resolveTimestampToUtc(
  raw: string,
  sourceIndex: number,
  timeZone: string,
  formatterCache?: Map<string, Intl.DateTimeFormat>,
  dailyOffsetCache?: Map<string, Set<number>>
): Date {
  return resolveTimestampToUtcWithCaches(
    raw,
    sourceIndex,
    timeZone,
    formatterCache,
    dailyOffsetCache
  );
}

/**
 * Aligns load data points to authoritative UTC instants using the site's IANA timezone.
 *
 * Sequence validation:
 * - dataPoints.length > 0
 * - intervalHours > 0
 * - strictly increasing UTC instants
 * - regularly spaced UTC instants with spacing equal to intervalHours * 3600 * 1000 ms
 */
export function alignLoadTimestampsToSite(
  dataPoints: Array<Pick<IntervalDataPoint, 'timestamp'>>,
  intervalHours: number,
  timeZone: string,
  calendarContext?: SiteLocalCalendarContext
): AlignedLoadTimestamp[] {
  if (!Array.isArray(dataPoints) || dataPoints.length === 0) {
    throw new Error('dataPoints must be a non-empty array.');
  }

  if (
    typeof intervalHours !== 'number' ||
    !Number.isFinite(intervalHours) ||
    intervalHours <= 0
  ) {
    throw new Error(
      `intervalHours must be a positive number. Received: ${intervalHours}`
    );
  }

  const normalizedZone = typeof timeZone === 'string' ? timeZone.trim() : '';
  if (calendarContext && calendarContext.timeZone !== normalizedZone) {
    throw new Error(`Invalid IANA timezone: "${timeZone}".`);
  }
  const formatterCache = calendarContext
    ? new Map([[calendarContext.timeZone, calendarContext.formatter]])
    : new Map<string, Intl.DateTimeFormat>();
  const dailyOffsetCache = new Map<string, Set<number>>();
  const aligned: AlignedLoadTimestamp[] = [];

  for (let i = 0; i < dataPoints.length; i++) {
    const dp = dataPoints[i];
    if (!dp || typeof dp.timestamp !== 'string') {
      throw new Error(
        `Invalid data point at index ${i}: missing or invalid timestamp string.`
      );
    }

    const instantUtc = resolveTimestampToUtcWithCaches(
      dp.timestamp,
      i,
      timeZone,
      formatterCache,
      dailyOffsetCache
    );

    aligned.push({
      sourceIndex: i,
      sourceTimestamp: dp.timestamp,
      instantUtc,
      timestampUtc: instantUtc.toISOString(),
    });
  }

  // Sequence validation on resolved UTC instants
  const expectedSpacingMs = Math.round(intervalHours * 3600 * 1000);
  const SPACING_TOLERANCE_MS = 1000; // 1-second tolerance for sub-second precision / floating point

  for (let i = 1; i < aligned.length; i++) {
    const prevTime = aligned[i - 1].instantUtc.getTime();
    const currTime = aligned[i].instantUtc.getTime();
    const diffMs = currTime - prevTime;

    if (diffMs === 0) {
      throw new Error(
        `Duplicate instant detected at index ${i}: "${aligned[i].sourceTimestamp}" resolves to duplicate UTC instant (${aligned[i].timestampUtc}).`
      );
    }

    if (diffMs < 0) {
      throw new Error(
        `Out-of-order instants detected between index ${i - 1} ("${aligned[i - 1].sourceTimestamp}") and index ${i} ("${aligned[i].sourceTimestamp}"). Resolved UTC timestamps must be strictly increasing.`
      );
    }

    if (Math.abs(diffMs - expectedSpacingMs) > SPACING_TOLERANCE_MS) {
      throw new Error(
        `Irregular spacing or gap (spacing inconsistent with intervalHours of ${intervalHours}h / ${expectedSpacingMs} ms) detected between index ${i - 1} ("${aligned[i - 1].sourceTimestamp}") and index ${i} ("${aligned[i].sourceTimestamp}"). Found spacing of ${diffMs} ms.`
      );
    }
  }

  return aligned;
}

/** Returns cloned points annotated with the site's canonical tariff coordinates. */
export function mapLoadTimestampsToSiteCalendar(
  dataPoints: IntervalDataPoint[],
  intervalHours: number,
  timeZone: string,
  aligned = alignLoadTimestampsToSite(dataPoints, intervalHours, timeZone)
): IntervalDataPoint[] {
  return aligned.map(({ sourceIndex, instantUtc }) => ({
    ...dataPoints[sourceIndex],
    date: instantUtc,
    ...getSiteLocalCalendarCoordinates(instantUtc, timeZone),
  }));
}

export interface LoadTimestampEligibility {
  operationallySimulatable: boolean;
  reason?: string;
}

/**
 * Checks whether parsed load records can be used at the selected site timezone.
 * This is deliberately separate from CSV/schema validation because local
 * timestamps can be nonexistent or ambiguous only after a timezone is known.
 */
export function evaluateLoadTimestampEligibility(
  dataPoints: IntervalDataPoint[],
  intervalHours: number,
  timeZone: string
): LoadTimestampEligibility {
  try {
    alignLoadTimestampsToSite(dataPoints, intervalHours, timeZone);
    return { operationallySimulatable: true };
  } catch (error: unknown) {
    return {
      operationallySimulatable: false,
      reason: error instanceof Error ? error.message : String(error),
    };
  }
}
