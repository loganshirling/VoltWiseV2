/**
 * External Resource CSV Parser & Sequence Validator (G7A)
 *
 * Implements canonical ingestion for solar irradiance and wind speed time-series
 * datasets, strict timestamp normalization via loadTimeAlignment, sequence
 * ordering validation, and interval duration inference.
 */

import {
  ExternalResourceDataset,
  ExternalResourceKind,
  ExternalResourceMetadata,
  ExternalResourceParseResult,
  ExternalResourceValidationResult,
  SolarIrradianceDataset,
  SolarIrradianceRecord,
  WindSpeedDataset,
  WindSpeedRecord,
} from '../types/energy';
import { isValidIanaTimeZone, resolveTimestampToUtc } from './loadTimeAlignment';

const MAX_VALIDATION_ERRORS = 25;
const SPACING_TOLERANCE_MS = 1000;

/**
 * Produces a stable fallback resource ID from the source content and parse context.
 * Identical inputs must retain the same identity across parses.
 */
function createDeterministicResourceId(
  kind: ExternalResourceKind,
  rawCsv: string,
  sourceTimeZone: string | null
): string {
  const input = `${kind}\n${sourceTimeZone ?? ''}\n${rawCsv}`;
  let hash = 0x811c9dc5;

  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }

  return `res_${kind}_${(hash >>> 0).toString(36)}`;
}

export interface ParseExternalResourceOptions {
  csvContent?: string;
  csvText?: string;
  kind?: ExternalResourceKind;
  sourceTimeZone?: string | null;
  id?: string;
  name?: string;
}

/**
 * Splits a single CSV row into fields respecting quoted values and escaped quotes.
 */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current.trim());
  return fields;
}

const SOLAR_REQUIRED_COLUMNS = ['timestamp', 'ghi_wm2', 'dni_wm2', 'dhi_wm2'] as const;
const WIND_REQUIRED_COLUMNS = ['timestamp', 'wind_speed_mps'] as const;

interface ParsedRecordHolder {
  instantUtc: Date;
  timestampUtc: string;
  record: SolarIrradianceRecord | WindSpeedRecord;
}

/**
 * Parses and validates solar irradiance or wind speed CSV content against canonical schemas.
 */
export function parseExternalResourceCsv(options: {
  csvContent?: string;
  csvText?: string;
  kind: ExternalResourceKind;
  sourceTimeZone?: string | null;
  id?: string;
  name?: string;
}): ExternalResourceParseResult;

export function parseExternalResourceCsv(
  csvText: string,
  kind: ExternalResourceKind,
  options?: { sourceTimeZone?: string | null; id?: string; name?: string }
): ExternalResourceParseResult;

export function parseExternalResourceCsv(
  param1: string | ParseExternalResourceOptions,
  param2?: ExternalResourceKind,
  param3?: { sourceTimeZone?: string | null; id?: string; name?: string }
): ExternalResourceParseResult {
  let rawCsv: string;
  let kind: ExternalResourceKind;
  let options: { sourceTimeZone?: string | null; id?: string; name?: string } = {};

  if (typeof param1 === 'object' && param1 !== null) {
    rawCsv = param1.csvContent ?? param1.csvText ?? '';
    kind = param1.kind!;
    options = {
      sourceTimeZone: param1.sourceTimeZone,
      id: param1.id,
      name: param1.name,
    };
  } else {
    rawCsv = param1 ?? '';
    kind = param2!;
    options = param3 ?? {};
  }

  const errors: string[] = [];
  const warnings: string[] = [];

  const createFailureResult = (
    rowCount: number,
    validRowCount: number = 0,
    timeZone?: string | null
  ): ExternalResourceParseResult => {
    const validation: ExternalResourceValidationResult = {
      isValid: false,
      errors: [...errors],
      warnings: [...warnings],
      kind,
      rowCount,
      validRowCount,
      sourceTimeZone: timeZone,
    };
    return {
      ...validation,
      validation,
      dataset: undefined,
    };
  };

  if (!rawCsv || typeof rawCsv !== 'string' || rawCsv.trim() === '') {
    errors.push('CSV input is empty.');
    return createFailureResult(0);
  }

  // Split lines supporting both LF and CRLF
  const rawLines = rawCsv.split(/\r?\n/);
  // Remove trailing blank lines
  while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') {
    rawLines.pop();
  }

  if (rawLines.length === 0) {
    errors.push('CSV input is empty.');
    return createFailureResult(0);
  }

  if (rawLines.length < 3) {
    errors.push('CSV must contain a header row and at least two data rows.');
    return createFailureResult(rawLines.length > 1 ? rawLines.length - 1 : 0);
  }

  // Validate header
  const headerTokens = parseCsvLine(rawLines[0]);
  const normalizedHeaders = headerTokens.map((h) => h.trim().toLowerCase());

  const requiredColumns: readonly string[] =
    kind === 'solar_irradiance' ? SOLAR_REQUIRED_COLUMNS : WIND_REQUIRED_COLUMNS;

  // Check duplicate required columns
  for (const col of requiredColumns) {
    const occurrences = normalizedHeaders.filter((h) => h === col).length;
    if (occurrences > 1) {
      errors.push(`Duplicate required column in CSV header: "${col}".`);
    }
  }

  // Check missing required columns
  const missingColumns = requiredColumns.filter(
    (col) => !normalizedHeaders.includes(col)
  );
  if (missingColumns.length > 0) {
    errors.push(
      `Missing required column(s): ${missingColumns.map((c) => `"${c}"`).join(', ')}.`
    );
  }

  if (errors.length > 0) {
    return createFailureResult(rawLines.length - 1);
  }

  // Check sourceTimeZone validity if provided
  const sourceTimeZone = options.sourceTimeZone?.trim();
  if (sourceTimeZone && !isValidIanaTimeZone(sourceTimeZone)) {
    errors.push(
      `Invalid source timezone: "${sourceTimeZone}". Must be a valid IANA timezone identifier.`
    );
    return createFailureResult(rawLines.length - 1);
  }

  // Map required columns to indices
  const colIndexMap = new Map<string, number>();
  for (const col of requiredColumns) {
    colIndexMap.set(col, normalizedHeaders.indexOf(col));
  }

  const timestampColIdx = colIndexMap.get('timestamp')!;
  const dataLines = rawLines.slice(1);
  const totalRowCount = dataLines.length;

  const formatterCache = new Map<string, Intl.DateTimeFormat>();
  const parsedHolders: ParsedRecordHolder[] = [];

  let effectiveTimeZone = sourceTimeZone || '';

  // Parse data rows
  for (let r = 0; r < dataLines.length; r++) {
    const lineIndex = r + 2; // 1-indexed line number in CSV
    const line = dataLines[r];

    if (errors.length >= MAX_VALIDATION_ERRORS) {
      errors.push(
        `Maximum validation error limit reached (${MAX_VALIDATION_ERRORS} errors). Parsing stopped.`
      );
      break;
    }

    const fields = parseCsvLine(line);

    // Validate timestamp field
    const rawTimestamp = fields[timestampColIdx];
    if (rawTimestamp === undefined || rawTimestamp.trim() === '') {
      errors.push(
        `Row ${lineIndex}: missing or blank value for required column "timestamp".`
      );
      continue;
    }

    let instantUtc: Date | undefined;
    try {
      instantUtc = resolveTimestampToUtc(
        rawTimestamp,
        r,
        effectiveTimeZone,
        formatterCache
      );
    } catch (err: any) {
      errors.push(`Row ${lineIndex}: ${err.message}`);
      continue;
    }

    const timestampUtc = instantUtc.toISOString();

    // Validate measurements
    if (kind === 'solar_irradiance') {
      const ghiIdx = colIndexMap.get('ghi_wm2')!;
      const dniIdx = colIndexMap.get('dni_wm2')!;
      const dhiIdx = colIndexMap.get('dhi_wm2')!;

      const rawGhi = fields[ghiIdx];
      const rawDni = fields[dniIdx];
      const rawDhi = fields[dhiIdx];

      let rowHasNumericError = false;

      const validateMeasurement = (
        rawVal: string | undefined,
        colName: string
      ): number | null => {
        if (rawVal === undefined || rawVal.trim() === '') {
          errors.push(
            `Row ${lineIndex}: missing or blank value for required column "${colName}".`
          );
          rowHasNumericError = true;
          return null;
        }
        const val = Number(rawVal);
        if (!Number.isFinite(val)) {
          errors.push(
            `Row ${lineIndex}: measurement for "${colName}" must be a finite number. Received "${rawVal}".`
          );
          rowHasNumericError = true;
          return null;
        }
        if (val < 0) {
          errors.push(
            `Row ${lineIndex}: measurement for "${colName}" must be non-negative (>= 0). Received ${val}.`
          );
          rowHasNumericError = true;
          return null;
        }
        return val;
      };

      const ghi = validateMeasurement(rawGhi, 'ghi_wm2');
      const dni = validateMeasurement(rawDni, 'dni_wm2');
      const dhi = validateMeasurement(rawDhi, 'dhi_wm2');

      if (!rowHasNumericError && ghi !== null && dni !== null && dhi !== null) {
        parsedHolders.push({
          instantUtc,
          timestampUtc,
          record: {
            timestampUtc,
            ghiWm2: ghi,
            dniWm2: dni,
            dhiWm2: dhi,
          },
        });
      }
    } else {
      // Wind speed
      const windIdx = colIndexMap.get('wind_speed_mps')!;
      const rawWind = fields[windIdx];

      if (rawWind === undefined || rawWind.trim() === '') {
        errors.push(
          `Row ${lineIndex}: missing or blank value for required column "wind_speed_mps".`
        );
        continue;
      }

      const windVal = Number(rawWind);
      if (!Number.isFinite(windVal)) {
        errors.push(
          `Row ${lineIndex}: measurement for "wind_speed_mps" must be a finite number. Received "${rawWind}".`
        );
        continue;
      }
      if (windVal < 0) {
        errors.push(
          `Row ${lineIndex}: measurement for "wind_speed_mps" must be non-negative (>= 0). Received ${windVal}.`
        );
        continue;
      }

      parsedHolders.push({
        instantUtc,
        timestampUtc,
        record: {
          timestampUtc,
          windSpeedMps: windVal,
        },
      });
    }
  }

  // If any row validation errors occurred, fail immediately
  if (errors.length > 0) {
    return createFailureResult(totalRowCount, parsedHolders.length, effectiveTimeZone);
  }

  if (parsedHolders.length < 2) {
    errors.push('CSV must contain a header row and at least two valid data rows.');
    return createFailureResult(totalRowCount, parsedHolders.length, effectiveTimeZone);
  }

  // Sequence and Interval Regularity Validation
  const firstSpacingMs =
    parsedHolders[1].instantUtc.getTime() - parsedHolders[0].instantUtc.getTime();

  if (firstSpacingMs === 0) {
    errors.push(
      `Duplicate UTC instant detected at row 3: "${dataLines[1]}" resolves to the same UTC instant as row 2 (${parsedHolders[1].timestampUtc}).`
    );
    return createFailureResult(totalRowCount, parsedHolders.length, effectiveTimeZone);
  }

  if (firstSpacingMs < 0) {
    errors.push(
      `Out-of-order instants detected between row 2 and row 3. Resolved UTC timestamps must be strictly increasing.`
    );
    return createFailureResult(totalRowCount, parsedHolders.length, effectiveTimeZone);
  }

  const inferredIntervalHours = firstSpacingMs / (3600 * 1000);

  for (let i = 1; i < parsedHolders.length; i++) {
    const prevTime = parsedHolders[i - 1].instantUtc.getTime();
    const currTime = parsedHolders[i].instantUtc.getTime();
    const diffMs = currTime - prevTime;
    const rowNum = i + 2;

    if (diffMs === 0) {
      errors.push(
        `Duplicate UTC instant detected at row ${rowNum}: resolves to duplicate UTC instant (${parsedHolders[i].timestampUtc}).`
      );
      break;
    }

    if (diffMs < 0) {
      errors.push(
        `Out-of-order instant detected at row ${rowNum} (${parsedHolders[i].timestampUtc} before ${parsedHolders[i - 1].timestampUtc}). Resolved UTC timestamps must be strictly increasing.`
      );
      break;
    }

    if (Math.abs(diffMs - firstSpacingMs) > SPACING_TOLERANCE_MS) {
      errors.push(
        `Irregular interval spacing detected at row ${rowNum}. Expected interval of ${inferredIntervalHours}h (${firstSpacingMs} ms), but found ${diffMs / (3600 * 1000)}h (${diffMs} ms).`
      );
      break;
    }
  }

  if (errors.length > 0) {
    return createFailureResult(totalRowCount, parsedHolders.length, effectiveTimeZone);
  }

  const startTimestampUtc = parsedHolders[0].timestampUtc;
  const endTimestampUtc = parsedHolders[parsedHolders.length - 1].timestampUtc;
  const resolvedTimeZone = effectiveTimeZone || null;

  const metadata: ExternalResourceMetadata = {
    id:
      options.id ||
      createDeterministicResourceId(kind, rawCsv, resolvedTimeZone),
    name:
      options.name ||
      (kind === 'solar_irradiance'
        ? 'Solar Irradiance Data'
        : 'Wind Speed Data'),
    kind,
    sourceTimeZone: resolvedTimeZone,
    intervalHours: inferredIntervalHours,
    rowCount: parsedHolders.length,
    startTimestampUtc,
    endTimestampUtc,
  };

  const records = parsedHolders.map((h) => h.record);

  const dataset: ExternalResourceDataset =
    kind === 'solar_irradiance'
      ? ({
          ...metadata,
          kind: 'solar_irradiance',
          records: records as SolarIrradianceRecord[],
        } as SolarIrradianceDataset)
      : ({
          ...metadata,
          kind: 'wind_speed',
          records: records as WindSpeedRecord[],
        } as WindSpeedDataset);

  const validation: ExternalResourceValidationResult = {
    isValid: true,
    errors: [],
    warnings,
    kind,
    rowCount: parsedHolders.length,
    validRowCount: parsedHolders.length,
    intervalHours: inferredIntervalHours,
    startTimestampUtc,
    endTimestampUtc,
    sourceTimeZone: resolvedTimeZone,
  };

  return {
    ...validation,
    dataset,
    validation,
  };
}

/**
 * Convenience parser for Solar Irradiance CSV datasets.
 */
export function parseSolarIrradianceCsv(
  csvContent: string,
  options?: { sourceTimeZone?: string | null; id?: string; name?: string }
): ExternalResourceParseResult<SolarIrradianceDataset> {
  return parseExternalResourceCsv(csvContent, 'solar_irradiance', options) as ExternalResourceParseResult<SolarIrradianceDataset>;
}

/**
 * Convenience parser for Wind Speed CSV datasets.
 */
export function parseWindSpeedCsv(
  csvContent: string,
  options?: { sourceTimeZone?: string | null; id?: string; name?: string }
): ExternalResourceParseResult<WindSpeedDataset> {
  return parseExternalResourceCsv(csvContent, 'wind_speed', options) as ExternalResourceParseResult<WindSpeedDataset>;
}
