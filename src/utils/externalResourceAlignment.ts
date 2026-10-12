/**
 * External Resource Exact Load Alignment Engine (G7A)
 *
 * Implements strict, indexed one-to-one temporal alignment between validated
 * external resource time-series (solar irradiance, wind speed) and authoritative
 * aligned load intervals.
 *
 * Invariants:
 * - Requires exact matching interval duration (no resampling/interpolation).
 * - Requires exact matching UTC instant for every modeled load step.
 * - Allows external resource supersets (extra rows outside modeled period).
 * - Preserves load order.
 * - Guarantees O(1) indexed lookups without caller mutation.
 */

import {
  ExternalResourceDataset,
  SolarIrradianceDataset,
  SolarIrradianceRecord,
  WindSpeedDataset,
  WindSpeedRecord,
} from '../types/energy';
import { AlignedLoadTimestamp } from './loadTimeAlignment';

const INTERVAL_FLOAT_TOLERANCE = 1e-4;

export interface AlignExternalResourceParams<
  T extends ExternalResourceDataset = ExternalResourceDataset,
> {
  dataset: T;
  alignedLoad: readonly (AlignedLoadTimestamp | string)[];
  loadIntervalHours: number;
}

export function alignExternalResourceToLoad(
  dataset: SolarIrradianceDataset,
  alignedLoad: readonly (AlignedLoadTimestamp | string)[],
  loadIntervalHours: number
): SolarIrradianceRecord[];

export function alignExternalResourceToLoad(
  dataset: WindSpeedDataset,
  alignedLoad: readonly (AlignedLoadTimestamp | string)[],
  loadIntervalHours: number
): WindSpeedRecord[];

export function alignExternalResourceToLoad<T extends ExternalResourceDataset>(
  dataset: T,
  alignedLoad: readonly (AlignedLoadTimestamp | string)[],
  loadIntervalHours: number
): T['records'];

export function alignExternalResourceToLoad<T extends ExternalResourceDataset>(
  params: AlignExternalResourceParams<T>
): T['records'];

export function alignExternalResourceToLoad<T extends ExternalResourceDataset>(
  param1: T | AlignExternalResourceParams<T>,
  param2?: readonly (AlignedLoadTimestamp | string)[],
  param3?: number
): T['records'] {
  let dataset: T;
  let alignedLoad: readonly (AlignedLoadTimestamp | string)[];
  let loadIntervalHours: number;

  if (
    typeof param1 === 'object' &&
    param1 !== null &&
    'dataset' in param1 &&
    'alignedLoad' in param1
  ) {
    dataset = param1.dataset;
    alignedLoad = param1.alignedLoad;
    loadIntervalHours = param1.loadIntervalHours;
  } else {
    dataset = param1 as T;
    alignedLoad = param2!;
    loadIntervalHours = param3!;
  }

  if (!dataset || !Array.isArray(dataset.records)) {
    throw new Error('Invalid external resource dataset: records must be an array.');
  }

  if (!Array.isArray(alignedLoad)) {
    throw new Error('alignedLoad must be an array of aligned timestamps.');
  }

  if (
    typeof loadIntervalHours !== 'number' ||
    !Number.isFinite(loadIntervalHours) ||
    loadIntervalHours <= 0
  ) {
    throw new Error(
      `loadIntervalHours must be a positive number. Received: ${loadIntervalHours}`
    );
  }

  if (!Number.isFinite(dataset.intervalHours) || dataset.intervalHours <= 0) {
    throw new Error(`External resource intervalHours must be a positive finite number. Received: ${dataset.intervalHours}`);
  }

  // Verify interval duration compatibility (exact match, no resampling)
  if (Math.abs(dataset.intervalHours - loadIntervalHours) > INTERVAL_FLOAT_TOLERANCE) {
    throw new Error(
      `Interval duration mismatch: resource interval (${dataset.intervalHours}h) does not match load interval (${loadIntervalHours}h). Resampling is not supported.`
    );
  }

  // Index resource records by UTC timestamp string for O(1) exact lookup
  const recordMap = new Map<string, T['records'][number]>();
  const expectedResourceStepMs = Math.round(dataset.intervalHours * 3600 * 1000);
  let previousResourceInstantMs: number | undefined;
  for (let index = 0; index < dataset.records.length; index++) {
    const record = dataset.records[index];
    const instantMs = typeof record.timestampUtc === 'string'
      ? new Date(record.timestampUtc).getTime()
      : Number.NaN;
    if (!Number.isFinite(instantMs)) {
      throw new Error(`Invalid resource timestamp at index ${index}: "${record.timestampUtc}".`);
    }
    if (previousResourceInstantMs !== undefined) {
      const spacingMs = instantMs - previousResourceInstantMs;
      if (spacingMs === 0) {
        throw new Error(`Duplicate resource timestamp at index ${index}: "${record.timestampUtc}".`);
      }
      if (spacingMs < 0) {
        throw new Error('Resource timestamps must be strictly increasing; found an out-of-order timestamp at index ' + index + '.');
      }
      if (Math.abs(spacingMs - expectedResourceStepMs) > 1) {
        throw new Error(`Irregular resource timestamp spacing at index ${index}: expected ${dataset.intervalHours}h intervals.`);
      }
    }
    previousResourceInstantMs = instantMs;
    recordMap.set(record.timestampUtc, record);
    try {
      const canonicalIso = new Date(record.timestampUtc).toISOString();
      if (canonicalIso !== record.timestampUtc) {
        recordMap.set(canonicalIso, record);
      }
    } catch {
      // Ignored: non-date strings handled by exact key
    }
  }

  // Align in authoritative load order
  const alignedRecords: (SolarIrradianceRecord | WindSpeedRecord)[] = [];

  for (let i = 0; i < alignedLoad.length; i++) {
    const item = alignedLoad[i];
    const rawTs = typeof item === 'string' ? item : item.timestampUtc;

    let matched = recordMap.get(rawTs);
    if (!matched) {
      try {
        matched = recordMap.get(new Date(rawTs).toISOString());
      } catch {
        // Fallback check failed
      }
    }

    if (!matched) {
      throw new Error(
        `Missing required resource record for load timestamp "${rawTs}" at index ${i}. Modeled period requires exact matching resource records.`
      );
    }

    alignedRecords.push(matched);
  }

  return alignedRecords as T['records'];
}
