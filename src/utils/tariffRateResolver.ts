/**
 * Reusable Tariff Rate Resolution Engine (Milestone G3M)
 *
 * Resolves authoritative TOU and seasonal buy and sell rates per interval
 * based on site IANA timezone, base rate tiers, and optional seasonal overrides:
 *   - Local calendar month resolved via Intl.DateTimeFormat in the site timezone.
 *   - Validates rate tiers and optional seasonal overrides.
 *   - Matches active season using first-match semantics.
 *   - Applies seasonal tier overrides when present; falls back to base tier rates.
 *   - Structural compatibility with BatteryDispatchPolicyInterval and GridFlowInterval.
 *
 * Pure function: does not mutate inputs. Does not modify physical dispatch,
 * export behavior, or financial projections.
 */

import {
  RateTier,
  ResolvedTariffRateInterval,
  TariffRateReferenceInterval,
  TouSeason,
} from '../types/energy';
import {
  AlignedLoadTimestamp,
  isValidIanaTimeZone,
} from './loadTimeAlignment';

/**
 * Resolves active TOU tier and seasonal buy/sell rates for an array of interval references.
 *
 * @param intervals Array of interval references containing sourceIndex, timestampUtc, and tierId
 * @param alignedTimestamps Authoritative aligned timestamps with instantUtc Dates
 * @param timeZone Site IANA timezone string
 * @param tiers Non-empty array of base RateTier definitions
 * @param seasons Optional array of seasonal TOU overrides
 * @returns Array of resolved rate intervals containing tier info, local month, season, and buy/sell rates
 */
export function resolveTariffRates(
  intervals: TariffRateReferenceInterval[],
  alignedTimestamps: AlignedLoadTimestamp[],
  timeZone: string,
  tiers: RateTier[],
  seasons?: TouSeason[]
): ResolvedTariffRateInterval[] {
  // 1. Array existence and non-emptiness checks
  if (!Array.isArray(intervals) || intervals.length === 0) {
    throw new Error('intervals must be a non-empty array.');
  }

  if (!Array.isArray(alignedTimestamps) || alignedTimestamps.length === 0) {
    throw new Error('alignedTimestamps must be a non-empty array.');
  }

  // 2. Length equality check
  const length = intervals.length;
  if (alignedTimestamps.length !== length) {
    throw new Error(
      `Array length mismatch: intervals has ${length}, alignedTimestamps has ${alignedTimestamps.length}.`
    );
  }

  // 3. Timezone validation
  if (typeof timeZone !== 'string' || !isValidIanaTimeZone(timeZone)) {
    throw new Error(`Invalid or unsupported IANA timeZone: "${timeZone}".`);
  }

  // 4. RateTier validation
  if (!Array.isArray(tiers) || tiers.length === 0) {
    throw new Error('tiers must be a non-empty array.');
  }

  const tierMap = new Map<string, RateTier>();
  for (let t = 0; t < tiers.length; t++) {
    const tier = tiers[t];
    if (!tier || typeof tier !== 'object') {
      throw new Error(`Invalid RateTier at index ${t}: must be an object.`);
    }
    if (typeof tier.id !== 'string' || tier.id.trim() === '') {
      throw new Error(
        `Invalid RateTier at index ${t}: id must be a non-empty string.`
      );
    }
    if (typeof tier.name !== 'string' || tier.name.trim() === '') {
      throw new Error(
        `Invalid RateTier at index ${t}: name must be a non-empty string.`
      );
    }
    if (typeof tier.buyRate !== 'number' || !Number.isFinite(tier.buyRate)) {
      throw new Error(
        `Invalid RateTier "${tier.id}": buyRate must be a finite number. Received: ${tier.buyRate}`
      );
    }
    if (typeof tier.sellRate !== 'number' || !Number.isFinite(tier.sellRate)) {
      throw new Error(
        `Invalid RateTier "${tier.id}": sellRate must be a finite number. Received: ${tier.sellRate}`
      );
    }
    if (tierMap.has(tier.id)) {
      throw new Error(
        `Duplicate RateTier ID "${tier.id}" detected in tiers configuration.`
      );
    }
    tierMap.set(tier.id, tier);
  }

  // 5. TouSeason validation (if provided)
  if (seasons !== undefined && seasons !== null) {
    if (!Array.isArray(seasons)) {
      throw new Error('seasons must be an array when provided.');
    }

    for (let s = 0; s < seasons.length; s++) {
      const season = seasons[s];
      if (!season || typeof season !== 'object') {
        throw new Error(`Invalid TouSeason at index ${s}: must be an object.`);
      }
      if (typeof season.id !== 'string' || season.id.trim() === '') {
        throw new Error(
          `Invalid TouSeason at index ${s}: id must be a non-empty string.`
        );
      }
      if (typeof season.name !== 'string' || season.name.trim() === '') {
        throw new Error(
          `Invalid TouSeason at index ${s}: name must be a non-empty string.`
        );
      }
      if (!Array.isArray(season.months)) {
        throw new Error(
          `Invalid TouSeason "${season.id}": months must be an array.`
        );
      }
      for (let mIdx = 0; mIdx < season.months.length; mIdx++) {
        const m = season.months[mIdx];
        if (!Number.isInteger(m) || m < 0 || m > 11) {
          throw new Error(
            `Invalid TouSeason "${season.id}": month at index ${mIdx} must be an integer between 0 and 11. Received: ${m}`
          );
        }
      }
      if (
        !season.tierRates ||
        typeof season.tierRates !== 'object' ||
        Array.isArray(season.tierRates)
      ) {
        throw new Error(
          `Invalid TouSeason "${season.id}": tierRates must be a non-array object.`
        );
      }
      for (const [tierId, rates] of Object.entries(season.tierRates)) {
        if (!rates || typeof rates !== 'object') {
          throw new Error(
            `Invalid seasonal tier rates for tier "${tierId}" in season "${season.id}": must be an object.`
          );
        }
        if (typeof rates.buyRate !== 'number' || !Number.isFinite(rates.buyRate)) {
          throw new Error(
            `Invalid seasonal buyRate for tier "${tierId}" in season "${season.id}": must be a finite number. Received: ${rates.buyRate}`
          );
        }
        if (typeof rates.sellRate !== 'number' || !Number.isFinite(rates.sellRate)) {
          throw new Error(
            `Invalid seasonal sellRate for tier "${tierId}" in season "${season.id}": must be a finite number. Received: ${rates.sellRate}`
          );
        }
      }
    }
  }

  // 6. Setup local month formatter
  const localMonthFormatter = new Intl.DateTimeFormat('en-US', {
    timeZone: timeZone.trim(),
    month: 'numeric',
  });

  const resolved: ResolvedTariffRateInterval[] = new Array(length);

  // 7. Interval-by-interval processing
  for (let i = 0; i < length; i++) {
    const inv = intervals[i];
    const at = alignedTimestamps[i];

    if (!inv || typeof inv !== 'object') {
      throw new Error(`Invalid interval at index ${i}: must be an object.`);
    }
    if (!at || typeof at !== 'object') {
      throw new Error(
        `Invalid alignedTimestamp interval at index ${i}: must be an object.`
      );
    }

    // Source index alignment
    if (inv.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: intervals sourceIndex is ${inv.sourceIndex}, expected ${i}.`
      );
    }
    if (at.sourceIndex !== i) {
      throw new Error(
        `Alignment error at index ${i}: alignedTimestamps sourceIndex is ${at.sourceIndex}, expected ${i}.`
      );
    }

    // Timestamp UTC alignment
    if (inv.timestampUtc !== at.timestampUtc) {
      throw new Error(
        `Timestamp mismatch at index ${i}: intervals timestampUtc ("${inv.timestampUtc}") !== alignedTimestamps timestampUtc ("${at.timestampUtc}").`
      );
    }

    // Check instantUtc Date validity
    if (!(at.instantUtc instanceof Date) || isNaN(at.instantUtc.getTime())) {
      throw new Error(
        `Invalid instantUtc at index ${i}: must be a valid Date object.`
      );
    }

    // Tier existence
    const baseTier = tierMap.get(inv.tierId);
    if (!baseTier) {
      throw new Error(
        `Unknown tier ID "${inv.tierId}" at index ${i}: not present in configured tiers.`
      );
    }

    // Resolve local calendar month using site timezone
    const parts = localMonthFormatter.formatToParts(at.instantUtc);
    const monthPart = parts.find((p) => p.type === 'month');
    if (!monthPart) {
      throw new Error(
        `Failed to resolve local month for instantUtc at index ${i}.`
      );
    }
    const localMonth = parseInt(monthPart.value, 10) - 1;
    if (localMonth < 0 || localMonth > 11 || isNaN(localMonth)) {
      throw new Error(
        `Resolved invalid local month ${localMonth} at index ${i}.`
      );
    }

    // Active season matching: first-matching season wins
    const activeSeason = seasons?.find((s) => s.months.includes(localMonth));

    let buyRate = baseTier.buyRate;
    let sellRate = baseTier.sellRate;
    let seasonName: string | undefined = undefined;

    if (activeSeason) {
      seasonName = activeSeason.name;
      const seasonalOverride = activeSeason.tierRates[baseTier.id];
      if (seasonalOverride !== undefined && seasonalOverride !== null) {
        buyRate = seasonalOverride.buyRate;
        sellRate = seasonalOverride.sellRate;
      }
    }

    resolved[i] = {
      sourceIndex: i,
      timestampUtc: inv.timestampUtc,
      tierId: baseTier.id,
      tierName: baseTier.name,
      localMonth,
      seasonName,
      buyRate,
      sellRate,
    };
  }

  return resolved;
}
