/**
 * TOU Battery Dispatch Policy Generator (Milestones G3E, G3G)
 *
 * Converts aligned UTC timestamps, site timezone, 7x24 TOU schedule matrix,
 * and battery configuration (chargeTiers, dischargeTiers) into authoritative
 * dispatch directives for both grid charging and battery discharging.
 *
 * Preserves the current VoltWise simulation rule:
 *   allowGridChargeFromGrid = profile.chargeTiers.includes(tierId)
 *   allowBatteryDischargeToLoad = profile.dischargeTiers.includes(tierId)
 * for both 'arbitrage' and 'self_consumption' strategies.
 */

import {
  BatteryDispatchPolicyInterval,
  BatteryProfile,
} from '../types/energy';
import {
  AlignedLoadTimestamp,
  isValidIanaTimeZone,
} from './loadTimeAlignment';

/**
 * Extracts canonical local dayOfWeek (0=Sun..6=Sat) and hour (0..23) for an instant in a timezone.
 */
function extractLocalClock(
  instantUtc: Date,
  dtf: Intl.DateTimeFormat
): { dayOfWeek: number; hour: number } {
  const parts = dtf.formatToParts(instantUtc);
  let year = 0;
  let month = 0;
  let day = 0;
  let hour = 0;

  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (p.type === 'year') year = parseInt(p.value, 10);
    else if (p.type === 'month') month = parseInt(p.value, 10);
    else if (p.type === 'day') day = parseInt(p.value, 10);
    else if (p.type === 'hour') hour = parseInt(p.value, 10);
  }

  if (hour === 24) {
    hour = 0;
  }

  // Canonical dayOfWeek: 0 = Sun, 1 = Mon, ..., 6 = Sat
  const dayOfWeek = new Date(Date.UTC(year, month - 1, day)).getUTCDay();

  return { dayOfWeek, hour };
}

/**
 * Generates unified TOU dispatch directives for both grid-charging and battery-discharging
 * from aligned timestamps, site timezone, schedule matrix, and battery profile.
 *
 * Pure function: does not mutate its inputs.
 */
export function generateBatteryDispatchPolicy(
  alignedTimestamps: AlignedLoadTimestamp[],
  timeZone: string,
  scheduleMatrix: string[][],
  profile: BatteryProfile
): BatteryDispatchPolicyInterval[] {
  // Validate alignedTimestamps
  if (!Array.isArray(alignedTimestamps) || alignedTimestamps.length === 0) {
    throw new Error('alignedTimestamps must be a non-empty array.');
  }

  // Validate timeZone
  if (!timeZone || typeof timeZone !== 'string' || !isValidIanaTimeZone(timeZone)) {
    throw new Error(
      `Invalid IANA time zone: "${timeZone}". Must be a non-empty valid IANA time zone identifier.`
    );
  }

  // Validate scheduleMatrix
  if (!Array.isArray(scheduleMatrix) || scheduleMatrix.length !== 7) {
    throw new Error(
      `scheduleMatrix must be an array of 7 day rows (0=Sunday through 6=Saturday). Received: ${Array.isArray(scheduleMatrix) ? scheduleMatrix.length : typeof scheduleMatrix}`
    );
  }

  for (let d = 0; d < 7; d++) {
    const row = scheduleMatrix[d];
    if (!Array.isArray(row) || row.length !== 24) {
      throw new Error(
        `scheduleMatrix day row ${d} must contain exactly 24 hour entries. Received: ${Array.isArray(row) ? row.length : typeof row}`
      );
    }
    for (let h = 0; h < 24; h++) {
      const cell = row[h];
      if (typeof cell !== 'string' || cell.trim() === '') {
        throw new Error(
          `scheduleMatrix cell [${d}][${h}] must be a non-empty string tier ID. Received: ${cell}`
        );
      }
    }
  }

  // Validate profile
  if (!profile || typeof profile !== 'object') {
    throw new Error('Battery profile must be a valid object.');
  }

  if (profile.strategy !== 'arbitrage' && profile.strategy !== 'self_consumption') {
    throw new Error(
      `Invalid battery strategy: must be 'arbitrage' or 'self_consumption'. Received: ${profile.strategy}`
    );
  }

  if (!Array.isArray(profile.dischargeTiers)) {
    throw new Error(
      `profile.dischargeTiers must be an array of strings. Received: ${typeof profile.dischargeTiers}`
    );
  }

  for (let i = 0; i < profile.dischargeTiers.length; i++) {
    const tier = profile.dischargeTiers[i];
    if (typeof tier !== 'string' || tier.trim() === '') {
      throw new Error(
        `profile.dischargeTiers entry at index ${i} must be a non-empty string. Received: ${tier}`
      );
    }
  }

  if (!Array.isArray(profile.chargeTiers)) {
    throw new Error(
      `profile.chargeTiers must be an array of strings. Received: ${typeof profile.chargeTiers}`
    );
  }

  for (let i = 0; i < profile.chargeTiers.length; i++) {
    const tier = profile.chargeTiers[i];
    if (typeof tier !== 'string' || tier.trim() === '') {
      throw new Error(
        `profile.chargeTiers entry at index ${i} must be a non-empty string. Received: ${tier}`
      );
    }
  }

  // Initialize Intl.DateTimeFormat for the site timezone
  const dtf = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone.trim(),
    year: 'numeric',
    month: 'numeric',
    day: 'numeric',
    hour: 'numeric',
    hourCycle: 'h23',
  });

  const result: BatteryDispatchPolicyInterval[] = new Array(alignedTimestamps.length);

  for (let i = 0; i < alignedTimestamps.length; i++) {
    const item = alignedTimestamps[i];
    if (!item || typeof item !== 'object') {
      throw new Error(`Invalid alignedTimestamp at index ${i}: must be an object.`);
    }

    if (!Number.isInteger(item.sourceIndex) || item.sourceIndex !== i) {
      throw new Error(
        `alignedTimestamp at index ${i} has invalid sourceIndex: expected ${i}, received ${item.sourceIndex}.`
      );
    }

    if (
      !(item.instantUtc instanceof Date) ||
      Number.isNaN(item.instantUtc.getTime())
    ) {
      throw new Error(
        `alignedTimestamp at index ${i} has an invalid instantUtc Date object.`
      );
    }

    if (
      typeof item.timestampUtc !== 'string' ||
      item.timestampUtc !== item.instantUtc.toISOString()
    ) {
      throw new Error(
        `alignedTimestamp at index ${i} timestampUtc "${item.timestampUtc}" does not match instantUtc.toISOString() "${item.instantUtc.toISOString()}".`
      );
    }

    const { dayOfWeek, hour } = extractLocalClock(item.instantUtc, dtf);

    const tierId = scheduleMatrix[dayOfWeek][hour];
    const allowGridChargeFromGrid = profile.chargeTiers.includes(tierId);
    const allowBatteryDischargeToLoad = profile.dischargeTiers.includes(tierId);

    result[i] = {
      sourceIndex: item.sourceIndex,
      timestampUtc: item.timestampUtc,
      dayOfWeek,
      hour,
      tierId,
      allowBatteryDischargeToLoad,
      allowGridChargeFromGrid,
    };
  }

  return result;
}

/**
 * Backwards-compatible public wrapper for G3E callers.
 * Thin wrapper around generateBatteryDispatchPolicy.
 */
export function generateBatteryDischargePolicy(
  alignedTimestamps: AlignedLoadTimestamp[],
  timeZone: string,
  scheduleMatrix: string[][],
  profile: BatteryProfile
): BatteryDispatchPolicyInterval[] {
  return generateBatteryDispatchPolicy(
    alignedTimestamps,
    timeZone,
    scheduleMatrix,
    profile
  );
}
