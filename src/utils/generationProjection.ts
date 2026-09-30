/**
 * Multi-Year Generation-Aware Operational Projection Engine (Milestone G4B)
 *
 * Produces a compact Year-1 through Year-25 operational series by physically evolving:
 * 1. Solar generation capability (per-array DC capacity degradation before inverter limit)
 * 2. Battery usable energy capacity (electrochemical degradation while preserving power capability)
 * 3. Tariff rates / electricity economics (compound electricity inflation)
 *
 * Runs those Year-N inputs through the authoritative generation-aware simulation pipeline
 * (runUnifiedSimulation), extracts compact annual aggregates, and discards interval arrays.
 *
 * Invariants:
 * - Pure function; does not mutate inputs.
 * - Legacy path (no generation) remains untouched outside G4B.
 * - Solar degradation changes DC capacity before inverter clipping; inverter AC capacity is not degraded.
 * - Multiple solar arrays degrade independently with per-array retention tracking.
 * - Battery degradation reduces energy capacity; power ratings remain unchanged.
 * - Tariff escalation applies compound inflation to buy/sell rates before simulation.
 * - Reconciles solar balance: generated ≈ direct-to-load + to-battery + export + curtailed.
 * - Reconciles financial savings: savings ≈ baseline - simulated.
 * - Memory efficiency: retains compact annual aggregates, never 25 years of intervals.
 */

import {
  BatteryProfile,
  DatasetCompleteness,
  GenerationConfig,
  GenerationOperationalProjection,
  GenerationOperationalProjectionResult,
  GenerationOperationalYear,
  IntervalDataPoint,
  MacroFinancials,
  RateTier,
  SolarAssetProjectionState,
  SolarGenerationAsset,
  TouSeason,
} from '../types/energy';
import { runUnifiedSimulation } from './simulationRouter';

export interface GenerationOperationalProjectionParams {
  dataPoints: IntervalDataPoint[];
  intervalHours: number;
  tiers: RateTier[];
  scheduleMatrix: string[][];
  batteryProfile: BatteryProfile;
  seasons?: TouSeason[];
  generationConfig: GenerationConfig;
  allowSolarExport: boolean;

  macroFinancials?:
    | MacroFinancials
    | {
        annualElectricityInflationRate?: number;
        annualBatteryDegradationRate?: number;
      };
  annualElectricityInflationRate?: number;
  annualBatteryDegradationRate?: number;

  projectionYears?: number;
  horizonYears?: number;

  isSuitableForAnnual?: boolean;
  completeness?: DatasetCompleteness | null;
  allowIncompleteYearForTesting?: boolean;
}

/**
 * Derives a cloned GenerationConfig for a given projection year.
 * Degrades enabled solar asset DC capacity independently based on its annualDegradationPercent.
 * Preserves inverterAcCapacityKw and all other asset settings unchanged.
 * Disabled solar assets remain disabled and contribute nothing.
 */
export function deriveSolarConfigForProjectionYear(
  baseConfig: GenerationConfig,
  year: number
): {
  generationConfig: GenerationConfig;
  solarAssets: SolarAssetProjectionState[];
} {
  if (year < 1) {
    throw new Error(`Projection year must be >= 1. Received: ${year}`);
  }

  const solarAssets: SolarAssetProjectionState[] = [];

  const clonedAssets = (baseConfig.assets ?? []).map((asset) => {
    if (asset.type === 'solar') {
      if (asset.enabled) {
        const annualDeg = Number(asset.annualDegradationPercent) || 0;
        // Year 1 retention = 1.0, compounding thereafter
        const retention = Math.pow(1 - annualDeg / 100, year - 1);
        const effectiveDcCapacityKw = asset.dcCapacityKw * retention;

        solarAssets.push({
          assetId: asset.id,
          capacityRetentionFactor: retention,
          effectiveDcCapacityKw,
        });

        return {
          ...asset,
          dcCapacityKw: effectiveDcCapacityKw,
          monthlyPeakSunHoursPerDay: asset.monthlyPeakSunHoursPerDay
            ? [...asset.monthlyPeakSunHoursPerDay]
            : [],
        } as SolarGenerationAsset;
      }

      return {
        ...asset,
        monthlyPeakSunHoursPerDay: asset.monthlyPeakSunHoursPerDay
          ? [...asset.monthlyPeakSunHoursPerDay]
          : [],
      } as SolarGenerationAsset;
    }

    // Preserve non-solar assets if present
    return { ...asset };
  });

  return {
    generationConfig: {
      site: { ...baseConfig.site },
      assets: clonedAssets,
    },
    solarAssets,
  };
}

/**
 * Derives a cloned BatteryProfile for a given projection year.
 * Degrades total nominal energy capacity using the VoltWise retention convention:
 *   capacityRetentionFactor = Math.max(0.35, 1 - (year - 1) * degradationRate)
 * Usable DoD percent is preserved unchanged, yielding lower usable energy capacity.
 * Continuous output/charge power ratings, round-trip efficiency, and tiers remain unchanged.
 */
export function deriveBatteryProfileForProjectionYear(
  baseBattery: BatteryProfile,
  year: number,
  annualBatteryDegradationRatePercent: number
): {
  batteryProfile: BatteryProfile;
  capacityRetentionFactor: number;
  usableCapacityKwh: number;
} {
  if (year < 1) {
    throw new Error(`Projection year must be >= 1. Received: ${year}`);
  }

  const degradationRate = (Number(annualBatteryDegradationRatePercent) || 0) / 100;
  const capacityRetentionFactor = Math.max(0.35, 1 - (year - 1) * degradationRate);
  const totalCapacityKwh = baseBattery.totalCapacityKwh * capacityRetentionFactor;
  const usableCapacityKwh = totalCapacityKwh * (baseBattery.usableDodPercent / 100);

  const batteryProfile: BatteryProfile = {
    ...baseBattery,
    totalCapacityKwh,
    chargeTiers: [...baseBattery.chargeTiers],
    dischargeTiers: [...baseBattery.dischargeTiers],
  };

  return {
    batteryProfile,
    capacityRetentionFactor,
    usableCapacityKwh,
  };
}

/**
 * Derives cloned rate tiers and seasons for a given projection year.
 * Escalates monetary per-kWh buyRate and sellRate by compound electricity inflation:
 *   inflationFactor = Math.pow(1 + annualElectricityInflationRate / 100, year - 1)
 * Year 1 rates are unchanged (inflationFactor = 1.0).
 * Tier IDs, names, colors, charge/discharge flags, and season months are preserved unchanged.
 */
export function deriveTariffsForProjectionYear(
  tiers: RateTier[],
  seasons: TouSeason[] | undefined,
  year: number,
  annualElectricityInflationRatePercent: number
): {
  tiers: RateTier[];
  seasons?: TouSeason[];
  inflationFactor: number;
} {
  if (year < 1) {
    throw new Error(`Projection year must be >= 1. Received: ${year}`);
  }

  const inflationRate = (Number(annualElectricityInflationRatePercent) || 0) / 100;
  const inflationFactor = Math.pow(1 + inflationRate, year - 1);

  const clonedTiers: RateTier[] = (tiers ?? []).map((tier) => ({
    ...tier,
    buyRate: tier.buyRate * inflationFactor,
    sellRate: tier.sellRate * inflationFactor,
  }));

  const clonedSeasons = seasons?.map((season) => {
    const tierRates: Record<string, { buyRate: number; sellRate: number }> = {};
    if (season.tierRates) {
      for (const [tierId, rates] of Object.entries(season.tierRates)) {
        tierRates[tierId] = {
          buyRate: rates.buyRate * inflationFactor,
          sellRate: rates.sellRate * inflationFactor,
        };
      }
    }
    return {
      ...season,
      months: [...season.months],
      tierRates,
    };
  });

  return {
    tiers: clonedTiers,
    seasons: clonedSeasons,
    inflationFactor,
  };
}

/**
 * Executes authoritative multi-year operational simulation across the specified horizon (default 25 years).
 *
 * For each projected year:
 * 1. Derives Year-N solar config with physical DC degradation.
 * 2. Derives Year-N battery profile with degraded usable energy capacity.
 * 3. Derives Year-N tariffs with compound electricity escalation.
 * 4. Runs authoritative runUnifiedSimulation().
 * 5. Extracts compact aggregate operational metrics (retaining no intervals).
 *
 * Returns a compact operational series ready for G4C project finance consumption.
 */
export function calculateGenerationOperationalProjection(
  params: GenerationOperationalProjectionParams
): GenerationOperationalProjectionResult {
  if (!params || typeof params !== 'object') {
    throw new Error('Simulation parameters must be provided as an object.');
  }

  const {
    dataPoints,
    intervalHours,
    tiers,
    scheduleMatrix,
    batteryProfile,
    seasons,
    generationConfig,
    allowSolarExport,
  } = params;

  if (!dataPoints || !Array.isArray(dataPoints) || dataPoints.length === 0) {
    throw new Error('dataPoints must be a non-empty array of interval data points.');
  }

  const horizon = params.projectionYears ?? params.horizonYears ?? 25;
  if (!Number.isInteger(horizon) || horizon < 1 || horizon > 25) {
    throw new Error(
      `Projection horizon must be an integer between 1 and 25 years. Received: ${horizon}`
    );
  }

  // Verify generation asset configuration
  const assets = generationConfig?.assets;
  const enabledAssets = Array.isArray(assets)
    ? assets.filter((asset) => asset != null && asset.enabled === true)
    : [];

  const enabledSolarAssets = enabledAssets.filter(
    (a) => a.type === 'solar'
  ) as SolarGenerationAsset[];

  if (enabledSolarAssets.length === 0) {
    throw new Error(
      'Generation operational projection requires at least one enabled solar asset.'
    );
  }

  // Reject unsupported generation asset types (wind, generator)
  const unsupportedAssets = enabledAssets.filter((a) => a.type !== 'solar');
  if (unsupportedAssets.length > 0) {
    throw new Error(
      `Unsupported generation asset type: "${unsupportedAssets[0].type}". Only solar assets are supported in this simulation pipeline.`
    );
  }

  // Partial-period suitability gate:
  // Operational projection represents a long-term annual projection.
  // Incomplete datasets (< 360 days / 95% of 8,760 hours) are rejected.
  const count = dataPoints.length;
  const durationDays =
    intervalHours > 0
      ? Math.round((count * intervalHours) / 24)
      : Math.round(count / 24);

  const calculatedSuitability = count >= 8760 * 0.95 && durationDays >= 360;
  const isSuitable =
    params.isSuitableForAnnual ??
    params.completeness?.isSuitableForAnnualProjection ??
    (params.allowIncompleteYearForTesting ? true : calculatedSuitability);

  if (!isSuitable) {
    throw new Error(
      'Dataset is not suitable for annual operational projection (requires full-year data).'
    );
  }

  // Resolve macro escalation and degradation assumptions
  const annualElectricityInflationRate =
    params.annualElectricityInflationRate ??
    (params.macroFinancials as any)?.annualElectricityInflationRate ??
    0;

  const annualBatteryDegradationRate =
    params.annualBatteryDegradationRate ??
    (params.macroFinancials as any)?.annualBatteryDegradationRate ??
    0;

  const years: GenerationOperationalYear[] = [];

  for (let y = 1; y <= horizon; y++) {
    // 1. Derive physically evolved Year-N inputs
    const yearSolar = deriveSolarConfigForProjectionYear(generationConfig, y);
    const yearBattery = deriveBatteryProfileForProjectionYear(
      batteryProfile,
      y,
      annualBatteryDegradationRate
    );
    const yearTariffs = deriveTariffsForProjectionYear(
      tiers,
      seasons,
      y,
      annualElectricityInflationRate
    );

    // 2. Execute authoritative simulation pipeline
    const simResult = runUnifiedSimulation({
      dataPoints,
      intervalHours,
      tiers: yearTariffs.tiers,
      scheduleMatrix,
      batteryProfile: yearBattery.batteryProfile,
      seasons: yearTariffs.seasons,
      generationConfig: yearSolar.generationConfig,
      allowSolarExport,
    });

    if (simResult.mode !== 'generation-aware' || !simResult.generationAwareResult) {
      throw new Error(
        'Generation projection cannot proceed in legacy simulation mode. At least one supported generation asset must be enabled.'
      );
    }

    const genResult = simResult.generationAwareResult;
    const summary = simResult.annualSummary;

    // 3. Aggregate authoritative solar energy delivered to battery AC input
    let totalSolarToBatteryAcKwh = 0;
    const intervals = genResult.exportAwareBatteryFlow.intervals;
    for (let i = 0; i < intervals.length; i++) {
      totalSolarToBatteryAcKwh += intervals[i].preExportFlow.solarToBatteryAcKwh;
    }

    // 4. Construct compact annual aggregate (discarding all interval data)
    years.push({
      year: y,

      baselineElectricityCostUsd: genResult.baselineCost,
      simulatedElectricityCostUsd: genResult.simulatedCost,
      electricitySavingsUsd: genResult.netSavings,

      solarGeneratedKwh: genResult.totalSolarGenerationKwh,
      solarDirectToLoadKwh: genResult.totalSolarDirectToLoadKwh,
      solarToBatteryKwh: totalSolarToBatteryAcKwh,
      solarExportKwh: genResult.totalSolarExportKwh,
      solarCurtailedKwh: genResult.gridFlows.totalCurtailedSolarKwh,

      gridImportKwh: genResult.totalGridImportKwh,
      gridExportKwh: genResult.totalGridExportKwh,
      batteryExportKwh: genResult.totalBatteryExportKwh,

      batteryDischargedKwh: summary.annualBatteryDischargedKwh,
      equivalentFullCycles: summary.equivalentFullCycles,

      batteryCapacityRetentionFactor: yearBattery.capacityRetentionFactor,
      batteryUsableCapacityKwh: yearBattery.usableCapacityKwh,

      solarAssets: yearSolar.solarAssets,
    });
  }

  // Wrap in hybrid array/object for maximum ergonomics
  const projection = Object.assign([...years], {
    horizonYears: horizon,
    years,
  }) as GenerationOperationalProjectionResult;

  return projection;
}

/** Alias matching prompt specifications */
export const projectGenerationAwareOperations = calculateGenerationOperationalProjection;
