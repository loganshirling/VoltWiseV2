import { parseAndValidateEnergyCsv, parseEnergyCsvDay, parseEnergyCsvTime, parseFiniteEnergyNumber, splitEnergyCsvLine } from './csvParser';
import { alignLoadTimestampsToSite, getPossibleUtcInstants, isValidIanaTimeZone } from './loadTimeAlignment';
import { MAX_INTERVALS_PER_DATASET } from './importLimits';
import { LoadImportProvenance } from '../types/energy';

export interface GuidedDteCandidate {
  instantUtc: string;
  offsetLabel: string;
  possibleMissingUtcInstants: string[];
}

export interface GuidedDteRow {
  sourceRow: number;
  sourceDate: string;
  sourceTime: string;
  localTimestamp: string;
  rawUsage: string;
  originalUsageKwh: number | null;
  candidates: GuidedDteCandidate[];
  requiresTimeConfirmation: boolean;
  selectedInstantUtc: string | null;
  proposedInstantUtc: string | null;
  isAmbiguousTime: boolean;
}

export interface GuidedDteReview {
  status: 'ready' | 'needs-correction' | 'rejected';
  formatRecognized: boolean;
  originalCsv: string;
  fileName: string;
  timeZone: string;
  rows: GuidedDteRow[];
  missingMeasurements: Array<Pick<GuidedDteRow, 'sourceRow' | 'sourceDate' | 'sourceTime' | 'localTimestamp' | 'rawUsage' | 'isAmbiguousTime'>>;
  error?: string;
  intervalHours: number | null;
}

export interface GuidedDtePreview {
  entries: Array<{ sourceRow: number; instantUtc: string; usageKwh: number | null; row: GuidedDteRow }>;
  unconfirmedRows: GuidedDteRow[];
  missingIntervals: Array<{ instantUtc: string; localTimestamp: string; offsetLabel: string }>;
  errors: string[];
}

export interface GuidedEstimateProposal {
  usageKwh: number;
  disclosure: string;
  contextKey: string;
}

export interface GuidedDteCorrection {
  usageKwh: number;
  method: 'manual' | 'estimate';
  approved: boolean;
  estimateContextKey?: string;
}

export interface GuidedDteCorrections {
  timeChoices: Record<number, string>;
  sourceRowCorrections: Record<number, GuidedDteCorrection>;
  missingIntervalCorrections: Record<string, GuidedDteCorrection>;
}

export type GuidedDteImportProvenance = LoadImportProvenance;

export interface AcceptedGuidedDteImport {
  originalCsv: string;
  normalizedCsv: string;
  provenance: GuidedDteImportProvenance;
}

function reject(originalCsv: string, fileName: string, timeZone: string, error: string, formatRecognized = false): GuidedDteReview {
  return { status: 'rejected', formatRecognized, originalCsv, fileName, timeZone, rows: [], missingMeasurements: [], error, intervalHours: null };
}

function formatOffsetLabel(offsetMinutes: number): string {
  const sign = offsetMinutes < 0 ? '−' : '+';
  const absolute = Math.abs(offsetMinutes);
  return `UTC${sign}${String(Math.floor(absolute / 60)).padStart(2, '0')}:${String(absolute % 60).padStart(2, '0')}`;
}

function makeCandidate(instant: Date, year: number, month: number, day: number, hour: number, minute: number): GuidedDteCandidate {
  const wallAsUtc = Date.UTC(year, month - 1, day, hour, minute);
  const offsetMinutes = Math.round((wallAsUtc - instant.getTime()) / 60_000);
  return { instantUtc: instant.toISOString(), offsetLabel: formatOffsetLabel(offsetMinutes), possibleMissingUtcInstants: [] };
}

function wallMilliseconds(row: GuidedDteRow): number {
  const match = row.localTimestamp.match(/^(\d{4})-(\d{2})-(\d{2}) (\d{2}):(\d{2})$/)!;
  return Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]));
}

function inferIntervalHours(rows: GuidedDteRow[]): number | null {
  const localTimes = [...new Set(rows.map(wallMilliseconds))].sort((a, b) => a - b);
  const counts = new Map<number, number>();
  for (let index = 1; index < localTimes.length; index += 1) {
    const diff = localTimes[index] - localTimes[index - 1];
    if (diff > 0) counts.set(diff, (counts.get(diff) ?? 0) + 1);
  }
  const step = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
  return step && step % 60_000 === 0 ? step / 3_600_000 : null;
}

function findGaps(rows: GuidedDteRow[], intervalHours: number | null): void {
  if (!intervalHours) return;
  const stepMs = intervalHours * 3_600_000;
  for (const row of rows) {
    for (const candidate of row.candidates) {
      if (row.candidates.length < 2 || rows.filter((other) => other.localTimestamp === row.localTimestamp).length > 1) continue;
      const instant = Date.parse(candidate.instantUtc);
      const neighbors = rows.filter((other) => other.localTimestamp !== row.localTimestamp && other.candidates.length === 1)
        .map((other) => Date.parse(other.candidates[0].instantUtc));
      const before = neighbors.filter((value) => value < instant).sort((a, b) => b - a)[0];
      const after = neighbors.filter((value) => value > instant).sort((a, b) => a - b)[0];
      if (before !== undefined && after !== undefined) {
        const ordered = [before, instant, after];
        for (let index = 1; index < ordered.length; index += 1) {
          const diff = ordered[index] - ordered[index - 1];
          if (diff > stepMs && diff % stepMs === 0) {
            for (let missing = ordered[index - 1] + stepMs; missing < ordered[index]; missing += stepMs) {
              candidate.possibleMissingUtcInstants.push(new Date(missing).toISOString());
            }
          }
        }
      }
    }
  }
}

/** Read a DTE five-column file without discarding repeated wall times or No Data rows. */
export function inspectDteImport(originalCsv: string, timeZone: string, fileName: string): GuidedDteReview {
  const lines = originalCsv.split(/\r?\n/).map((line, index) => ({ line: line.trim(), sourceRow: index + 1 })).filter(({ line }) => line.length > 0);
  if (lines.length < 2) return reject(originalCsv, fileName, timeZone, 'The uploaded file needs a header and at least one interval row.');
  if (lines.length - 1 > MAX_INTERVALS_PER_DATASET) return reject(originalCsv, fileName, timeZone, `The file exceeds the ${MAX_INTERVALS_PER_DATASET.toLocaleString()} interval limit.`);

  const headers = splitEnergyCsvLine(lines[0].line).map((header) => header.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const standardDte = headers.length >= 5 && headers[0].includes('day') && headers[1].includes('hour') &&
    (headers[2].includes('hourly') || headers[2].includes('usage') || headers[2].includes('kwh')) &&
    headers[3].includes('daily') && (headers[4].includes('unit') || headers[4] === 'uom');
  if (!standardDte) return reject(originalCsv, fileName, timeZone, 'Guided correction is available for the five-column utility CSV format. This file must be corrected to the supported schema before import.');
  if (!isValidIanaTimeZone(timeZone)) {
    return {
      status: 'needs-correction', formatRecognized: true, originalCsv, fileName, timeZone, rows: [],
      missingMeasurements: [], error: 'Choose a valid site timezone to resolve local timestamps and identify any daylight-saving overlap.', intervalHours: null,
    };
  }

  const rows: GuidedDteRow[] = [];
  const formatterCache = new Map<string, Intl.DateTimeFormat>();
  const dailyOffsetCache = new Map<string, Set<number>>();
  for (const source of lines.slice(1)) {
    const columns = splitEnergyCsvLine(source.line);
    if (columns.length < 5) return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow} does not contain all five utility columns.`, true);
    const [sourceDate, sourceTime, rawUsage, rawDaily, rawUnit] = columns;
    const day = parseEnergyCsvDay(sourceDate);
    const time = parseEnergyCsvTime(sourceTime);
    if (!day || !time) return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow} has an invalid date or time.`, true);
    const calendarCheck = new Date(Date.UTC(day.year, day.month - 1, day.day));
    if (calendarCheck.getUTCFullYear() !== day.year || calendarCheck.getUTCMonth() !== day.month - 1 || calendarCheck.getUTCDate() !== day.day) {
      return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow} has an invalid calendar date.`, true);
    }
    const multiplier = rawUnit.trim().toLowerCase() === 'kwh' ? 1 : rawUnit.trim().toLowerCase() === 'wh' ? 0.001 : rawUnit.trim().toLowerCase() === 'mwh' ? 1000 : NaN;
    if (!Number.isFinite(multiplier)) return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow} has an unsupported energy unit.`, true);
    const daily = parseFiniteEnergyNumber(rawDaily);
    if (daily === null || daily < 0) return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow} has an invalid Daily Total value.`, true);
    const parsedUsage = parseFiniteEnergyNumber(rawUsage);
    const isNoData = /^no\s+data$/i.test(rawUsage.trim());
    if (parsedUsage === null && !isNoData) return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow} has an invalid Hourly Total value "${rawUsage}".`, true);
    if (parsedUsage !== null && parsedUsage < 0) return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow} has a negative Hourly Total value.`, true);
    const usageKwh = parsedUsage === null ? null : parsedUsage * multiplier;
    if ((usageKwh !== null && !Number.isFinite(usageKwh)) || !Number.isFinite(daily * multiplier)) {
      return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow} exceeds the supported finite energy range.`, true);
    }
    const localTimestamp = `${day.year}-${String(day.month).padStart(2, '0')}-${String(day.day).padStart(2, '0')} ${String(time.hour).padStart(2, '0')}:${String(time.minute).padStart(2, '0')}`;
    let instants: Date[];
    try {
      instants = getPossibleUtcInstants(localTimestamp, timeZone, formatterCache, dailyOffsetCache);
    } catch (error) {
      return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow}: ${error instanceof Error ? error.message : 'timestamp resolution failed'}`, true);
    }
    if (instants.length === 0) return reject(originalCsv, fileName, timeZone, `Source row ${source.sourceRow} (${localTimestamp}) is a nonexistent local time. Correct the source timestamp; no interval will be inferred from a different row.`, true);
    rows.push({
      sourceRow: source.sourceRow,
      sourceDate,
      sourceTime,
      localTimestamp,
      rawUsage,
      originalUsageKwh: usageKwh,
      candidates: instants.map((instant) => makeCandidate(instant, day.year, day.month, day.day, time.hour, time.minute)),
      requiresTimeConfirmation: instants.length > 1,
      selectedInstantUtc: instants.length === 1 ? instants[0].toISOString() : null,
      proposedInstantUtc: null,
      isAmbiguousTime: instants.length > 1,
    });
  }

  const grouped = new Map<string, GuidedDteRow[]>();
  const allLocalGroups = new Map<string, GuidedDteRow[]>();
  for (const row of rows) allLocalGroups.set(row.localTimestamp, [...(allLocalGroups.get(row.localTimestamp) ?? []), row]);
  const repeatedUniqueTime = [...allLocalGroups.entries()].find(([, group]) => group.length > 1 && group.every((row) => row.candidates.length === 1));
  if (repeatedUniqueTime) {
    return reject(originalCsv, fileName, timeZone, `Duplicate source timestamp ${repeatedUniqueTime[0]} does not represent a daylight-saving overlap. Correct the duplicate rows; no measurements were discarded.`, true);
  }
  rows.filter((row) => row.requiresTimeConfirmation).forEach((row) => grouped.set(row.localTimestamp, [...(grouped.get(row.localTimestamp) ?? []), row]));
  for (const [localTimestamp, group] of grouped) {
    if (group.length === 2 && group[0].candidates.length === 2 && group[1].candidates.length === 2) {
      const sortedInstants = group[0].candidates.map((candidate) => candidate.instantUtc).sort();
      group[0].proposedInstantUtc = sortedInstants[0];
      group[1].proposedInstantUtc = sortedInstants[1];
    } else if (group.length > 1) {
      return reject(originalCsv, fileName, timeZone, `The repeated local time ${localTimestamp} has more source rows than distinct UTC occurrences. Correct the source file; no measurements were discarded.`, true);
    }
  }

  const intervalHours = inferIntervalHours(rows);
  findGaps(rows, intervalHours);
  const missingMeasurements = rows.filter((row) => row.originalUsageKwh === null).map((row) => ({
    sourceRow: row.sourceRow, sourceDate: row.sourceDate, sourceTime: row.sourceTime,
    localTimestamp: row.localTimestamp, rawUsage: row.rawUsage, isAmbiguousTime: row.isAmbiguousTime,
  }));
  const uniqueTimeChoices = Object.fromEntries(rows.filter((row) => !row.requiresTimeConfirmation)
    .map((row) => [row.sourceRow, row.candidates[0].instantUtc]));
  const initialPreview = previewDteImport({
    status: 'ready', formatRecognized: true, originalCsv, fileName, timeZone, rows, missingMeasurements, intervalHours,
  }, uniqueTimeChoices);
  if (initialPreview.errors.length > 0) return reject(originalCsv, fileName, timeZone, initialPreview.errors.join(' '), true);
  const needsCorrection = rows.some((row) => row.requiresTimeConfirmation || row.originalUsageKwh === null) ||
    intervalHours === null || initialPreview.missingIntervals.length > 0 || initialPreview.errors.length > 0;
  return {
    status: needsCorrection ? 'needs-correction' : 'ready', formatRecognized: true, originalCsv, fileName, timeZone,
    rows, missingMeasurements, intervalHours,
  };
}

export function previewDteImport(review: GuidedDteReview, timeChoices: Record<number, string>): GuidedDtePreview {
  const unconfirmedRows = review.rows.filter((row) => row.requiresTimeConfirmation &&
    !row.candidates.some((candidate) => candidate.instantUtc === timeChoices[row.sourceRow]));
  const entries = review.rows.flatMap((row) => {
    const instantUtc = row.requiresTimeConfirmation ? timeChoices[row.sourceRow] : row.candidates[0]?.instantUtc;
    return instantUtc ? [{ sourceRow: row.sourceRow, instantUtc, usageKwh: row.originalUsageKwh, row }] : [];
  });
  const errors: string[] = [];
  const missingIntervals: GuidedDtePreview['missingIntervals'] = [];
  if (unconfirmedRows.length > 0) return { entries, unconfirmedRows, missingIntervals, errors };
  const stepMs = (review.intervalHours ?? 0) * 3_600_000;
  if (stepMs <= 0) errors.push('Could not determine an exact interval duration from the source timestamps.');
  for (let index = 1; index < entries.length; index += 1) {
    if (wallMilliseconds(entries[index].row) < wallMilliseconds(entries[index - 1].row)) {
      errors.push(`Source rows ${entries[index - 1].sourceRow} and ${entries[index].sourceRow} are out of chronological source order.`);
    }
  }
  if (errors.length > 0) return { entries, unconfirmedRows, missingIntervals, errors };
  for (let index = 1; index < entries.length && stepMs > 0; index += 1) {
    const previous = Date.parse(entries[index - 1].instantUtc);
    const current = Date.parse(entries[index].instantUtc);
    const diff = current - previous;
    if (diff === 0) errors.push(`Source rows ${entries[index - 1].sourceRow} and ${entries[index].sourceRow} were assigned to the same UTC interval.`);
    else if (diff < 0) errors.push(`Confirmed UTC assignments reverse source chronology between rows ${entries[index - 1].sourceRow} and ${entries[index].sourceRow}.`);
    else if (diff % stepMs !== 0) errors.push(`Irregular UTC cadence between source rows ${entries[index - 1].sourceRow} and ${entries[index].sourceRow}.`);
    else if (diff > stepMs) {
      for (let instant = previous + stepMs; instant < current; instant += stepMs) {
        const date = new Date(instant);
        const formatter = new Intl.DateTimeFormat('en-CA', {
          timeZone: review.timeZone, year: 'numeric', month: '2-digit', day: '2-digit',
          hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZoneName: 'longOffset',
        });
        const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]));
        const offset = parts.timeZoneName?.replace('GMT', 'UTC').replace('-', '−') ?? 'UTC';
        missingIntervals.push({
          instantUtc: date.toISOString(),
          localTimestamp: `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}`,
          offsetLabel: offset,
        });
      }
    }
  }
  return { entries, unconfirmedRows, missingIntervals, errors };
}

/** Returns an estimate proposal only when measured intervals bracket the missing instant. */
export function proposeGuidedEstimate(
  preview: GuidedDtePreview,
  target: { sourceRow?: number; instantUtc?: string },
): GuidedEstimateProposal | null {
  const targetEntry = target.sourceRow !== undefined
    ? preview.entries.find((entry) => entry.sourceRow === target.sourceRow)
    : undefined;
  const instant = target.instantUtc ?? targetEntry?.instantUtc;
  if (!instant) return null;
  const before = preview.entries.filter((entry) => entry.usageKwh !== null && Date.parse(entry.instantUtc) < Date.parse(instant))
    .sort((a, b) => Date.parse(b.instantUtc) - Date.parse(a.instantUtc))[0];
  const after = preview.entries.filter((entry) => entry.usageKwh !== null && Date.parse(entry.instantUtc) > Date.parse(instant))
    .sort((a, b) => Date.parse(a.instantUtc) - Date.parse(b.instantUtc))[0];
  if (!before || !after) return null;
  const estimate = Math.round(((before.usageKwh! + after.usageKwh!) / 2) * 1000) / 1000;
  const contextKey = JSON.stringify({
    target: { sourceRow: target.sourceRow ?? null, instantUtc: instant },
    before: { sourceRow: before.sourceRow, instantUtc: before.instantUtc, usageKwh: before.usageKwh },
    after: { sourceRow: after.sourceRow, instantUtc: after.instantUtc, usageKwh: after.usageKwh },
  });
  return {
    usageKwh: estimate,
    contextKey,
    disclosure: `Estimate uses the arithmetic mean of the nearest measured intervals (${before.usageKwh} kWh before and ${after.usageKwh} kWh after). Review and approve it; no value is filled automatically.`,
  };
}

/** Drop only estimate approvals whose measured-neighbor context changes after a time choice. */
export function invalidateStaleEstimateCorrections(
  previousPreview: GuidedDtePreview,
  nextPreview: GuidedDtePreview,
  sourceRowCorrections: Record<number, GuidedDteCorrection>,
  missingIntervalCorrections: Record<string, GuidedDteCorrection>,
): Pick<GuidedDteCorrections, 'sourceRowCorrections' | 'missingIntervalCorrections'> {
  const source = Object.fromEntries(Object.entries(sourceRowCorrections).filter(([sourceRow, correction]) => {
    if (correction.method !== 'estimate') return true;
    const target = { sourceRow: Number(sourceRow) };
    const previousContext = proposeGuidedEstimate(previousPreview, target)?.contextKey;
    const nextContext = proposeGuidedEstimate(nextPreview, target)?.contextKey;
    return previousContext !== undefined && previousContext === nextContext && correction.estimateContextKey === nextContext;
  }));
  const missing = Object.fromEntries(Object.entries(missingIntervalCorrections).filter(([instantUtc, correction]) => {
    if (correction.method !== 'estimate') return true;
    const target = { instantUtc };
    const previousContext = proposeGuidedEstimate(previousPreview, target)?.contextKey;
    const nextContext = proposeGuidedEstimate(nextPreview, target)?.contextKey;
    return previousContext !== undefined && previousContext === nextContext && correction.estimateContextKey === nextContext;
  }));
  return { sourceRowCorrections: source, missingIntervalCorrections: missing };
}

function validateCorrection(correction: GuidedDteCorrection | undefined, location: string, expectedEstimateContext?: string | null): GuidedDteCorrection {
  if (!correction || !Number.isFinite(correction.usageKwh) || correction.usageKwh < 0) {
    throw new Error(`Enter a finite, non-negative kWh value for ${location}.`);
  }
  if (correction.method === 'estimate' && !correction.approved) throw new Error(`Approve the disclosed estimate for ${location} before continuing.`);
  if (correction.method === 'estimate' && (!expectedEstimateContext || correction.estimateContextKey !== expectedEstimateContext)) {
    throw new Error(`The estimate approval for ${location} is stale because its measured-neighbor context changed. Review and approve a new estimate.`);
  }
  return correction;
}

export function buildAcceptedDteImport(review: GuidedDteReview, corrections: GuidedDteCorrections): AcceptedGuidedDteImport {
  if (review.status === 'rejected') throw new Error(review.error ?? 'The file cannot be accepted.');
  const preview = previewDteImport(review, corrections.timeChoices);
  if (preview.unconfirmedRows.length > 0) throw new Error(`Confirm a UTC occurrence for every repeated local time (source rows ${preview.unconfirmedRows.map((row) => row.sourceRow).join(', ')}).`);
  if (preview.errors.length > 0) throw new Error(preview.errors.join(' '));
  const timeAssignments: GuidedDteImportProvenance['timeAssignments'] = [];
  const outputRows: Array<{ instantUtc: string; usageKwh: number }> = [];
  const provenanceCorrections: GuidedDteImportProvenance['corrections'] = [];

  for (const entry of preview.entries) {
    let usageKwh = entry.usageKwh;
    if (usageKwh === null) {
      const correction = validateCorrection(
        corrections.sourceRowCorrections[entry.sourceRow],
        `source row ${entry.sourceRow}`,
        proposeGuidedEstimate(preview, { sourceRow: entry.sourceRow })?.contextKey,
      );
      usageKwh = correction.usageKwh;
      provenanceCorrections.push({
        sourceRow: entry.sourceRow, sourceDate: entry.row.sourceDate, sourceTime: entry.row.sourceTime,
        instantUtc: entry.instantUtc, originalValue: entry.row.rawUsage, correctedKwh: usageKwh, method: correction.method,
        ...(correction.method === 'estimate' ? { disclosure: 'User-approved mean of the nearest measured interval before and after this time.' } : {}),
      });
    }
    outputRows.push({ instantUtc: entry.instantUtc, usageKwh });
    if (entry.row.requiresTimeConfirmation) {
      const chosen = entry.row.candidates.find((candidate) => candidate.instantUtc === entry.instantUtc)!;
      timeAssignments.push({
        sourceRow: entry.sourceRow, localTimestamp: entry.row.localTimestamp, instantUtc: entry.instantUtc,
        offsetLabel: chosen.offsetLabel, confirmed: true,
        assignment: entry.row.proposedInstantUtc === entry.instantUtc ? 'source-order-confirmed' : 'user-selected',
      });
    }
  }

  for (const missing of preview.missingIntervals) {
    const correction = validateCorrection(
      corrections.missingIntervalCorrections[missing.instantUtc],
      `missing interval ${missing.localTimestamp} (${missing.offsetLabel})`,
      proposeGuidedEstimate(preview, { instantUtc: missing.instantUtc })?.contextKey,
    );
    outputRows.push({ instantUtc: missing.instantUtc, usageKwh: correction.usageKwh });
    provenanceCorrections.push({
      sourceRow: null, sourceDate: missing.localTimestamp.slice(0, 10), sourceTime: missing.localTimestamp.slice(11),
      instantUtc: missing.instantUtc, originalValue: null, correctedKwh: correction.usageKwh, method: correction.method,
      ...(correction.method === 'estimate' ? { disclosure: 'User-approved mean of the nearest measured interval before and after this time.' } : {}),
    });
  }

  const normalizedCsv = ['timestamp,usage_kwh', ...outputRows
    .sort((a, b) => Date.parse(a.instantUtc) - Date.parse(b.instantUtc))
    .map((row) => `${row.instantUtc},${row.usageKwh}`)].join('\n');
  const parsed = parseAndValidateEnergyCsv(normalizedCsv);
  if (!parsed.schemaValid || !parsed.chronologicallyValid || !parsed.operationallySimulatable) {
    throw new Error(`Corrected intervals failed strict CSV validation: ${parsed.errors.concat(parsed.warnings).join(' ')}`);
  }
  const aligned = alignLoadTimestampsToSite(parsed.data, parsed.intervalHours, review.timeZone);
  const expectedStepMs = parsed.intervalHours * 3_600_000;
  for (let index = 1; index < aligned.length; index += 1) {
    if (aligned[index].instantUtc.getTime() - aligned[index - 1].instantUtc.getTime() !== expectedStepMs) {
      throw new Error(`Corrected UTC cadence is incomplete at ${aligned[index].timestampUtc}.`);
    }
  }
  return {
    originalCsv: review.originalCsv,
    normalizedCsv,
    provenance: { sourceFileName: review.fileName, timeAssignments, corrections: provenanceCorrections },
  };
}
