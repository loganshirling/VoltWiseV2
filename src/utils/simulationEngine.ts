/**
 * Comprehensive 8,760-Hour Battery Dispatch Simulation & 15-Year Financial Projection Engine
 */
import {
  BatteryProfile,
  IntervalDataPoint,
  IntervalSimulationResult,
  MacroFinancials,
  ProfileFinancialAnalysis,
  RateTier,
  TouProfile,
  TouSeason,
  YearProjection,
  AnnualSimulationSummary,
  HorizonFinancialSummary,
  DatasetCompleteness,
  PartialPeriodDisplayMetrics,
} from '../types/energy';
import {
  calculateOpportunityCostBenchmark,
  OpportunityCostBenchmarkInput,
  OpportunityCostBenchmarkResult,
  OpportunityCostYear,
} from './opportunityCost';

export {
  calculateOpportunityCostBenchmark,
  type OpportunityCostBenchmarkInput,
  type OpportunityCostBenchmarkResult,
  type OpportunityCostYear,
};

/**
 * 7 Days (0=Sun, 1=Mon, ..., 6=Sat) x 24 Hours schedule lookup
 */
export type ScheduleMatrix = string[][]; // matrix[dayOfWeek 0..6][hour 0..23] = tierId

/**
 * Default standard rate tiers
 */
export const DEFAULT_RATE_TIERS: RateTier[] = [
  {
    id: 'off-peak',
    name: 'Off-Peak',
    buyRate: 0.16,
    sellRate: 0.05,
    color: '#10b981', // Emerald
    isChargeWindow: true,
    isDischargeWindow: false,
  },
  {
    id: 'mid-peak',
    name: 'Mid-Peak',
    buyRate: 0.31,
    sellRate: 0.08,
    color: '#f59e0b', // Amber
    isChargeWindow: false,
    isDischargeWindow: false,
  },
  {
    id: 'on-peak',
    name: 'On-Peak',
    buyRate: 0.52,
    sellRate: 0.15,
    color: '#ef4444', // Red
    isChargeWindow: false,
    isDischargeWindow: true,
  },
  {
    id: 'super-off-peak',
    name: 'Super Off-Peak',
    buyRate: 0.09,
    sellRate: 0.04,
    color: '#06b6d4', // Cyan
    isChargeWindow: true,
    isDischargeWindow: false,
  },
];

/**
 * Generate default 7x24 schedule matrix (California EV2-A / Standard TOU style)
 * Super Off-Peak: 00:00 - 06:00
 * Off-Peak: 06:00 - 16:00, 21:00 - 24:00
 * On-Peak: 16:00 - 21:00 (Weekdays), Mid-Peak 16:00 - 21:00 (Weekends)
 */
export function createDefaultScheduleMatrix(): ScheduleMatrix {
  const matrix: ScheduleMatrix = [];
  for (let day = 0; day < 7; day++) {
    const dayHours: string[] = [];
    const isWeekend = day === 0 || day === 6; // 0=Sun, 6=Sat

    for (let hour = 0; hour < 24; hour++) {
      if (hour >= 0 && hour < 6) {
        dayHours.push('super-off-peak');
      } else if (hour >= 16 && hour < 21) {
        dayHours.push(isWeekend ? 'mid-peak' : 'on-peak');
      } else {
        dayHours.push('off-peak');
      }
    }
    matrix.push(dayHours);
  }
  return matrix;
}

/**
 * Standard preset TOU Profiles with distinct utility schedules and rate structures
 */
export const DEFAULT_TOU_PROFILES: TouProfile[] = [
  {
    id: 'california-ev2a',
    name: 'California PG&E EV2-A / SCE TOU-D',
    utility: 'PG&E / SCE California',
    description: 'High peak differential tariff with steep 4–9 PM peak rates and cheap overnight super off-peak charging.',
    tiers: [
      {
        id: 'super-off-peak',
        name: 'Super Off-Peak',
        buyRate: 0.09,
        sellRate: 0.04,
        color: '#06b6d4',
        isChargeWindow: true,
        isDischargeWindow: false,
      },
      {
        id: 'off-peak',
        name: 'Off-Peak',
        buyRate: 0.16,
        sellRate: 0.05,
        color: '#10b981',
        isChargeWindow: true,
        isDischargeWindow: false,
      },
      {
        id: 'mid-peak',
        name: 'Mid-Peak',
        buyRate: 0.31,
        sellRate: 0.08,
        color: '#f59e0b',
        isChargeWindow: false,
        isDischargeWindow: false,
      },
      {
        id: 'on-peak',
        name: 'On-Peak',
        buyRate: 0.54,
        sellRate: 0.15,
        color: '#ef4444',
        isChargeWindow: false,
        isDischargeWindow: true,
      },
    ],
    scheduleMatrix: createDefaultScheduleMatrix(),
    seasons: [
      {
        id: 'ca-summer',
        name: 'Summer (June – Sept)',
        months: [5, 6, 7, 8],
        tierRates: {
          'super-off-peak': { buyRate: 0.11, sellRate: 0.04 },
          'off-peak': { buyRate: 0.19, sellRate: 0.06 },
          'mid-peak': { buyRate: 0.36, sellRate: 0.09 },
          'on-peak': { buyRate: 0.62, sellRate: 0.18 },
        },
      },
      {
        id: 'ca-winter',
        name: 'Winter (Oct – May)',
        months: [0, 1, 2, 3, 4, 9, 10, 11],
        tierRates: {
          'super-off-peak': { buyRate: 0.08, sellRate: 0.03 },
          'off-peak': { buyRate: 0.14, sellRate: 0.04 },
          'mid-peak': { buyRate: 0.27, sellRate: 0.07 },
          'on-peak': { buyRate: 0.46, sellRate: 0.12 },
        },
      },
    ],
  },
  {
    id: 'sce-tou-prime',
    name: 'SCE TOU-PRIME (High Spread)',
    utility: 'Southern California Edison',
    description: 'Specialized residential rate for clean storage & heat pumps with an extreme $0.64/kWh peak period.',
    tiers: [
      {
        id: 'prime-off-peak',
        name: 'Off-Peak (Night)',
        buyRate: 0.21,
        sellRate: 0.06,
        color: '#10b981',
        isChargeWindow: true,
        isDischargeWindow: false,
      },
      {
        id: 'prime-mid-peak',
        name: 'Mid-Peak (Day)',
        buyRate: 0.38,
        sellRate: 0.08,
        color: '#f59e0b',
        isChargeWindow: false,
        isDischargeWindow: false,
      },
      {
        id: 'prime-on-peak',
        name: 'On-Peak (4-9 PM)',
        buyRate: 0.64,
        sellRate: 0.14,
        color: '#ef4444',
        isChargeWindow: false,
        isDischargeWindow: true,
      },
    ],
    scheduleMatrix: (() => {
      const matrix: ScheduleMatrix = [];
      for (let day = 0; day < 7; day++) {
        const dayHours: string[] = [];
        for (let hour = 0; hour < 24; hour++) {
          if (hour >= 16 && hour < 21) {
            dayHours.push('prime-on-peak');
          } else if (hour >= 8 && hour < 16) {
            dayHours.push('prime-mid-peak');
          } else {
            dayHours.push('prime-off-peak');
          }
        }
        matrix.push(dayHours);
      }
      return matrix;
    })(),
    seasons: [
      {
        id: 'sce-summer',
        name: 'Summer (June – Sept)',
        months: [5, 6, 7, 8],
        tierRates: {
          'prime-off-peak': { buyRate: 0.24, sellRate: 0.07 },
          'prime-mid-peak': { buyRate: 0.42, sellRate: 0.09 },
          'prime-on-peak': { buyRate: 0.72, sellRate: 0.16 },
        },
      },
      {
        id: 'sce-winter',
        name: 'Winter (Oct – May)',
        months: [0, 1, 2, 3, 4, 9, 10, 11],
        tierRates: {
          'prime-off-peak': { buyRate: 0.18, sellRate: 0.05 },
          'prime-mid-peak': { buyRate: 0.34, sellRate: 0.07 },
          'prime-on-peak': { buyRate: 0.56, sellRate: 0.12 },
        },
      },
    ],
  },
  {
    id: 'texas-free-nights',
    name: 'Texas Free Nights & Weekends',
    utility: 'ERCOT Retailers (Texas)',
    description: 'Zero-cost grid imports from 9 PM to 6 AM paired with a 24¢ flat daytime grid rate, ideal for max battery arbitrage.',
    tiers: [
      {
        id: 'free-nights',
        name: '100% Free Power Window',
        buyRate: 0.00,
        sellRate: 0.02,
        color: '#06b6d4',
        isChargeWindow: true,
        isDischargeWindow: false,
      },
      {
        id: 'tx-daytime',
        name: 'Standard Daytime Import',
        buyRate: 0.24,
        sellRate: 0.08,
        color: '#f59e0b',
        isChargeWindow: false,
        isDischargeWindow: true,
      },
    ],
    scheduleMatrix: (() => {
      const matrix: ScheduleMatrix = [];
      for (let day = 0; day < 7; day++) {
        const isWeekend = day === 0 || day === 6;
        const dayHours: string[] = [];
        for (let hour = 0; hour < 24; hour++) {
          if (isWeekend) {
            dayHours.push('free-nights');
          } else if (hour < 6 || hour >= 21) {
            dayHours.push('free-nights');
          } else {
            dayHours.push('tx-daytime');
          }
        }
        matrix.push(dayHours);
      }
      return matrix;
    })(),
    seasons: [
      {
        id: 'tx-summer',
        name: 'Summer Peak (June – Sept)',
        months: [5, 6, 7, 8],
        tierRates: {
          'free-nights': { buyRate: 0.00, sellRate: 0.03 },
          'tx-daytime': { buyRate: 0.29, sellRate: 0.09 },
        },
      },
      {
        id: 'tx-winter',
        name: 'Mild / Winter (Oct – May)',
        months: [0, 1, 2, 3, 4, 9, 10, 11],
        tierRates: {
          'free-nights': { buyRate: 0.00, sellRate: 0.02 },
          'tx-daytime': { buyRate: 0.20, sellRate: 0.06 },
        },
      },
    ],
  },
  {
    id: 'aps-saver-choice',
    name: 'APS Arizona Saver Choice (Summer Peak)',
    utility: 'Arizona Public Service (APS)',
    description: 'Hot climate rate with intense 3 PM to 8 PM weekday cooling penalty and cheap baseline winter/night solar.',
    tiers: [
      {
        id: 'aps-off-peak',
        name: 'Off-Peak',
        buyRate: 0.13,
        sellRate: 0.05,
        color: '#10b981',
        isChargeWindow: true,
        isDischargeWindow: false,
      },
      {
        id: 'aps-peak',
        name: 'On-Peak (3-8 PM)',
        buyRate: 0.46,
        sellRate: 0.10,
        color: '#ef4444',
        isChargeWindow: false,
        isDischargeWindow: true,
      },
    ],
    scheduleMatrix: (() => {
      const matrix: ScheduleMatrix = [];
      for (let day = 0; day < 7; day++) {
        const isWeekend = day === 0 || day === 6;
        const dayHours: string[] = [];
        for (let hour = 0; hour < 24; hour++) {
          if (!isWeekend && hour >= 15 && hour < 20) {
            dayHours.push('aps-peak');
          } else {
            dayHours.push('aps-off-peak');
          }
        }
        matrix.push(dayHours);
      }
      return matrix;
    })(),
    seasons: [
      {
        id: 'aps-summer',
        name: 'Summer Peak (May – Oct)',
        months: [4, 5, 6, 7, 8, 9],
        tierRates: {
          'aps-off-peak': { buyRate: 0.15, sellRate: 0.06 },
          'aps-peak': { buyRate: 0.52, sellRate: 0.12 },
        },
      },
      {
        id: 'aps-winter',
        name: 'Winter / Off-Peak (Nov – Apr)',
        months: [0, 1, 2, 3, 10, 11],
        tierRates: {
          'aps-off-peak': { buyRate: 0.11, sellRate: 0.04 },
          'aps-peak': { buyRate: 0.39, sellRate: 0.08 },
        },
      },
    ],
  },
  {
    id: 'flat-rate-benchmark',
    name: 'Flat Rate Benchmark (Standard Tariff)',
    utility: 'Traditional Fixed Utility Rate',
    description: 'Constant 26¢/kWh rate across all 168 hours of the week, establishing a baseline comparison without TOU arbitrage.',
    tiers: [
      {
        id: 'flat-tier',
        name: 'Standard Flat Rate',
        buyRate: 0.26,
        sellRate: 0.06,
        color: '#64748b',
        isChargeWindow: false,
        isDischargeWindow: false,
      },
    ],
    scheduleMatrix: (() => {
      const matrix: ScheduleMatrix = [];
      for (let day = 0; day < 7; day++) {
        const dayHours: string[] = [];
        for (let hour = 0; hour < 24; hour++) {
          dayHours.push('flat-tier');
        }
        matrix.push(dayHours);
      }
      return matrix;
    })(),
    seasons: [
      {
        id: 'flat-all-year',
        name: 'Year-Round (Jan – Dec)',
        months: [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11],
        tierRates: {
          'flat-tier': { buyRate: 0.26, sellRate: 0.06 },
        },
      },
    ],
  },
];

/**
 * Standard preset battery profiles
 */
export const DEFAULT_BATTERY_PROFILES: BatteryProfile[] = [
  {
    id: 'powerwall-3',
    name: 'Tesla Powerwall 3',
    model: 'LFP Integrated 13.5 kWh',
    totalCapacityKwh: 13.5,
    usableDodPercent: 100,
    maxContinuousOutputKw: 11.5,
    maxContinuousChargeKw: 5.0,
    roundTripEfficiencyPercent: 89.0,
    ratedCycleLife: 4000,
    installedCost: 11500,
    strategy: 'arbitrage',
    chargeTiers: ['super-off-peak', 'off-peak'],
    dischargeTiers: ['on-peak'],
    allowGridExport: false,
  },
  {
    id: 'enphase-5p',
    name: 'Enphase IQ Battery 5P (Dual)',
    model: 'Modular Microinverter 10.0 kWh',
    totalCapacityKwh: 10.0,
    usableDodPercent: 100,
    maxContinuousOutputKw: 7.68,
    maxContinuousChargeKw: 7.68,
    roundTripEfficiencyPercent: 90.0,
    ratedCycleLife: 6000,
    installedCost: 10800,
    strategy: 'arbitrage',
    chargeTiers: ['super-off-peak'],
    dischargeTiers: ['on-peak'],
    allowGridExport: false,
  },
  {
    id: 'franklin-wh',
    name: 'FranklinWH aPower',
    model: 'LFP High-Surge 13.6 kWh',
    totalCapacityKwh: 13.6,
    usableDodPercent: 100,
    maxContinuousOutputKw: 5.0,
    maxContinuousChargeKw: 5.0,
    roundTripEfficiencyPercent: 89.0,
    ratedCycleLife: 4500,
    installedCost: 12200,
    strategy: 'arbitrage',
    chargeTiers: ['super-off-peak', 'off-peak'],
    dischargeTiers: ['on-peak', 'mid-peak'],
    allowGridExport: false,
  },
  {
    id: 'diy-rack-lfp',
    name: 'Custom Server Rack LFP',
    model: '48V 300Ah Modular Rack',
    totalCapacityKwh: 15.3,
    usableDodPercent: 85, // 15% reserve limit
    maxContinuousOutputKw: 6.0,
    maxContinuousChargeKw: 4.0,
    roundTripEfficiencyPercent: 86.0,
    ratedCycleLife: 6000,
    installedCost: 6500,
    strategy: 'self_consumption',
    chargeTiers: ['super-off-peak'],
    dischargeTiers: ['on-peak', 'mid-peak'],
    allowGridExport: false,
  },
];

export const DEFAULT_MACRO_FINANCIALS: MacroFinancials = {
  federalTaxCreditPercent: 0, // Default 0% (user must explicitly enter applicable incentives)
  federalTaxCreditRealizationYear: 1, // Default Year 1 realization for tax credit cash flow
  localRebateFlat: 0, // Default $0 local rebate
  annualElectricityInflationRate: 3.5, // 3.5%
  annualBatteryDegradationRate: 2.0, // 2.0% usable capacity loss/year
  discountRatePercent: 5.0, // 5.0% Discount Rate for NPV
  opportunityCostVehicle: 'hysa',
  opportunityCostRatePercent: 4.5, // 4.5% High-Yield Savings Account Benchmark
  replacementEnabled: true,
  replacementCost: 2000, // $2,000 mid-life inverter replacement
  replacementYear: 10, // Year 10
  isFinanced: false,
  loanAprPercent: 6.99, // 6.99% Clean Energy Loan APR
  loanTermYears: 10, // 10-year term
  loanDownPaymentPercent: 0, // 0% down
  criticalLoadPowerKw: 1.2, // 1.2 kW continuous essential backup load
  annualOutageDays: 2.5, // 2.5 days/year
  valueOfLostLoadPerDay: 100, // $100/day for food preservation & comfort
  includeVollInRoi: false,
};

/**
 * Run the 8,760-hour dispatch simulation for a given battery profile and rate configuration.
 */
export function runAnnualSimulation(
  dataPoints: IntervalDataPoint[],
  intervalHours: number,
  tiers: RateTier[],
  scheduleMatrix: ScheduleMatrix,
  profile: BatteryProfile,
  seasons?: TouSeason[]
): AnnualSimulationSummary {
  const tierMap = new Map<string, RateTier>(tiers.map(t => [t.id, t]));
  const defaultTier = tiers[0] || {
    id: 'default',
    name: 'Default',
    buyRate: 0.20,
    sellRate: 0.05,
    color: '#64748b',
  };

  const usableCapacityKwh = profile.totalCapacityKwh * (profile.usableDodPercent / 100);
  
  // Square-root split for charge and discharge AC-to-DC-to-AC efficiency
  const rte = Math.max(0.5, Math.min(1.0, profile.roundTripEfficiencyPercent / 100));
  const etaCharge = Math.sqrt(rte);
  const etaDischarge = Math.sqrt(rte);

  const maxChargeEnergyInterval = profile.maxContinuousChargeKw * intervalHours;
  const maxDischargeEnergyInterval = profile.maxContinuousOutputKw * intervalHours;

  let initialSyntheticSocKwh = usableCapacityKwh * 0.5; // Start at 50% state of charge
  let gridChargedSocKwh = 0; // Stored energy actually charged from the grid during simulation
  let gridChargedTotalCost = 0; // Cumulative purchase cost of grid energy stored in battery
  let currentSocKwh = initialSyntheticSocKwh + gridChargedSocKwh;

  let baselineTotalCost = 0;
  let simulatedTotalCost = 0;
  let totalHomeLoad = 0;
  let totalGridImport = 0;
  let totalGridExport = 0;
  let totalBatteryDischarged = 0;
  let maxPeakKw = 0;

  const intervalResults: IntervalSimulationResult[] = [];

  for (let i = 0; i < dataPoints.length; i++) {
    const pt = dataPoints[i];
    const dow = pt.dayOfWeek; // 0..6
    const hour = pt.hour; // 0..23

    // Resolve active TOU Tier from schedule matrix
    const tierId = scheduleMatrix[dow]?.[hour] || 'off-peak';
    const tier = tierMap.get(tierId) || defaultTier;

    // Resolve Seasonal pricing based on the current interval's month (0-11)
    let buyRate = tier.buyRate;
    let sellRate = tier.sellRate;
    let activeSeasonName: string | undefined = undefined;

    if (seasons && seasons.length > 0) {
      const activeSeason = seasons.find((s) => s.months.includes(pt.month));
      if (activeSeason) {
        activeSeasonName = activeSeason.name;
        if (activeSeason.tierRates && activeSeason.tierRates[tierId]) {
          buyRate = activeSeason.tierRates[tierId].buyRate;
          sellRate = activeSeason.tierRates[tierId].sellRate;
        }
      }
    }

    const loadKwh = pt.usageKwh;
    totalHomeLoad += loadKwh;

    const currentKw = intervalHours > 0 ? loadKwh / intervalHours : loadKwh;
    if (currentKw > maxPeakKw) maxPeakKw = currentKw;

    // Baseline: All load bought at current TOU buy rate
    const baselineCost = loadKwh * buyRate;
    baselineTotalCost += baselineCost;

    let batChargeKwh = 0;
    let batDischargeKwh = 0;
    let gridImportKwh = 0;
    let gridExportKwh = 0;

    // Authoritative dispatch configuration:
    // Only the battery profile's configured chargeTiers and dischargeTiers control charging/discharging.
    // Tariff defaults (isChargeWindow / isDischargeWindow) must NOT override explicit battery configuration.
    const isDesignatedCharge = profile.chargeTiers.includes(tierId);
    const isDesignatedDischarge = profile.dischargeTiers.includes(tierId);

    if (profile.strategy === 'arbitrage') {
      // ARBITRAGE MODE:
      // 1. Charge strictly in designated hours up to usable limit
      // 2. Discharge during peak hours to offset home load
      // 3. Export only if allowGridExport is true AND sell rate exceeds effective delivery cost (accounting for round-trip efficiency)
      if (isDesignatedCharge && currentSocKwh < usableCapacityKwh) {
        const roomInBattery = usableCapacityKwh - currentSocKwh;
        // Energy that enters battery
        const energyToStore = Math.min(maxChargeEnergyInterval * etaCharge, roomInBattery);
        const gridForBat = energyToStore / etaCharge;
        
        if (energyToStore > 0) {
          const costOfNewEnergy = energyToStore * (buyRate / etaCharge);
          gridChargedSocKwh += energyToStore;
          gridChargedTotalCost += costOfNewEnergy;
        }

        batChargeKwh = energyToStore;
        currentSocKwh = initialSyntheticSocKwh + gridChargedSocKwh;
        gridImportKwh = loadKwh + gridForBat;
        gridExportKwh = 0;
      } else if (isDesignatedDischarge && currentSocKwh > 0.01) {
        // Discharging during peak hours
        const availableToDeliver = currentSocKwh * etaDischarge;
        // First offset home load
        const dischargeForHome = Math.min(loadKwh, maxDischargeEnergyInterval, availableToDeliver);
        const batteryEnergyDrainedHome = dischargeForHome / etaDischarge;
        
        if (batteryEnergyDrainedHome > 0) {
          // Drain from synthetic initial SOC first (serves household load, but has no export provenance)
          const drainSynthetic = Math.min(initialSyntheticSocKwh, batteryEnergyDrainedHome);
          initialSyntheticSocKwh -= drainSynthetic;
          const drainGridCharged = batteryEnergyDrainedHome - drainSynthetic;
          if (drainGridCharged > 0) {
            const avgCost = gridChargedSocKwh > 0 ? gridChargedTotalCost / gridChargedSocKwh : 0;
            gridChargedSocKwh = Math.max(0, gridChargedSocKwh - drainGridCharged);
            gridChargedTotalCost = Math.max(0, gridChargedTotalCost - drainGridCharged * avgCost);
          }
          currentSocKwh = initialSyntheticSocKwh + gridChargedSocKwh;
        }

        const remainingHomeLoad = Math.max(0, loadKwh - dischargeForHome);
        gridImportKwh = remainingHomeLoad;
        batDischargeKwh = dischargeForHome;

        // Grid Export Logic:
        // Only grid-charged energy with a known acquisition cost is eligible for economic export.
        // Synthetic initial SOC is NEVER exported for arbitrage.
        const remainingInverterCapacity = maxDischargeEnergyInterval - dischargeForHome;
        const avgCostPerKwh = gridChargedSocKwh > 0 ? gridChargedTotalCost / gridChargedSocKwh : 0;
        const effectiveDeliveryCost = avgCostPerKwh / etaDischarge;
        const isExportEconomic = profile.allowGridExport && gridChargedSocKwh > 0.01 && avgCostPerKwh > 0 && sellRate > effectiveDeliveryCost;

        if (isExportEconomic && remainingInverterCapacity > 0.05) {
          const exportDeliverable = Math.min(remainingInverterCapacity, gridChargedSocKwh * etaDischarge);
          if (exportDeliverable > 0) {
            const batteryDrainedExport = exportDeliverable / etaDischarge;
            gridChargedSocKwh = Math.max(0, gridChargedSocKwh - batteryDrainedExport);
            gridChargedTotalCost = Math.max(0, gridChargedTotalCost - batteryDrainedExport * avgCostPerKwh);
            currentSocKwh = initialSyntheticSocKwh + gridChargedSocKwh;
            batDischargeKwh += exportDeliverable;
            gridExportKwh = exportDeliverable;
          }
        }
      } else {
        // Idle interval
        gridImportKwh = loadKwh;
        gridExportKwh = 0;
      }
    } else {
      // SELF-CONSUMPTION MODE:
      // 1. Discharge battery whenever home load exists to minimize grid consumption (strictly constrained to configured discharge tiers)
      // 2. Charge only during designated off-peak / super-off-peak intervals
      if (isDesignatedCharge && currentSocKwh < usableCapacityKwh) {
        const roomInBattery = usableCapacityKwh - currentSocKwh;
        const energyToStore = Math.min(maxChargeEnergyInterval * etaCharge, roomInBattery);
        const gridForBat = energyToStore / etaCharge;
        
        if (energyToStore > 0) {
          const costOfNewEnergy = energyToStore * (buyRate / etaCharge);
          gridChargedSocKwh += energyToStore;
          gridChargedTotalCost += costOfNewEnergy;
        }

        batChargeKwh = energyToStore;
        currentSocKwh = initialSyntheticSocKwh + gridChargedSocKwh;
        gridImportKwh = loadKwh + gridForBat;
        gridExportKwh = 0;
      } else if (isDesignatedDischarge && loadKwh > 0 && currentSocKwh > 0.01) {
        // Discharge to offset home load
        const availableToDeliver = currentSocKwh * etaDischarge;
        const dischargeForHome = Math.min(loadKwh, maxDischargeEnergyInterval, availableToDeliver);
        const batteryEnergyDrained = dischargeForHome / etaDischarge;
        
        if (batteryEnergyDrained > 0) {
          const drainSynthetic = Math.min(initialSyntheticSocKwh, batteryEnergyDrained);
          initialSyntheticSocKwh -= drainSynthetic;
          const drainGridCharged = batteryEnergyDrained - drainSynthetic;
          if (drainGridCharged > 0) {
            const avgCost = gridChargedSocKwh > 0 ? gridChargedTotalCost / gridChargedSocKwh : 0;
            gridChargedSocKwh = Math.max(0, gridChargedSocKwh - drainGridCharged);
            gridChargedTotalCost = Math.max(0, gridChargedTotalCost - drainGridCharged * avgCost);
          }
          currentSocKwh = initialSyntheticSocKwh + gridChargedSocKwh;
        }

        batDischargeKwh = dischargeForHome;
        gridImportKwh = Math.max(0, loadKwh - dischargeForHome);
        gridExportKwh = 0;
      } else {
        gridImportKwh = loadKwh;
        gridExportKwh = 0;
      }
    }

    // Keep SoC within realistic floating bounds
    currentSocKwh = Math.max(0, Math.min(usableCapacityKwh, currentSocKwh));
    if (currentSocKwh === 0) {
      initialSyntheticSocKwh = 0;
      gridChargedSocKwh = 0;
      gridChargedTotalCost = 0;
    }
    const socPercent = usableCapacityKwh > 0 ? (currentSocKwh / usableCapacityKwh) * 100 : 0;

    // Financial outcome of interval
    const simulatedCost = (gridImportKwh * buyRate) - (gridExportKwh * sellRate);
    simulatedTotalCost += simulatedCost;

    totalGridImport += gridImportKwh;
    totalGridExport += gridExportKwh;
    totalBatteryDischarged += batDischargeKwh;

    intervalResults.push({
      timestamp: pt.timestamp,
      hour,
      dayOfWeek: dow,
      homeLoadKwh: loadKwh,
      tierId,
      tierName: tier.name,
      seasonName: activeSeasonName,
      buyRate,
      sellRate,
      batteryChargeKwh: batChargeKwh,
      batteryDischargeKwh: batDischargeKwh,
      batterySocKwh: Math.round(currentSocKwh * 100) / 100,
      batterySocPercent: Math.round(socPercent * 10) / 10,
      gridImportKwh: Math.round(gridImportKwh * 100) / 100,
      gridExportKwh: Math.round(gridExportKwh * 100) / 100,
      baselineCost,
      simulatedCost,
      netSavings: baselineCost - simulatedCost,
    });
  }

  // Equivalent full cycles = total discharged energy / usable capacity
  const equivalentFullCycles = usableCapacityKwh > 0 ? totalBatteryDischarged / usableCapacityKwh : 0;
  const year1Savings = baselineTotalCost - simulatedTotalCost;
  const savingsPercentage = baselineTotalCost > 0 ? (year1Savings / baselineTotalCost) * 100 : 0;
  const durationDays = intervalHours > 0 ? Math.round((dataPoints.length * intervalHours) / 24) : Math.round(dataPoints.length / 24);
  const isSuitableForAnnual = dataPoints.length >= 8760 * 0.95 && durationDays >= 360;

  return {
    profileId: profile.id,
    profileName: profile.name,
    totalIntervals: dataPoints.length,
    intervalHours,
    durationDays,
    isSuitableForAnnualProjection: isSuitableForAnnual,
    totalHomeLoadKwh: Math.round(totalHomeLoad * 10) / 10,
    baselineAnnualCost: Math.round(baselineTotalCost * 100) / 100,
    simulatedAnnualCost: Math.round(simulatedTotalCost * 100) / 100,
    year1Savings: Math.round(year1Savings * 100) / 100,
    // Explicit period aliases
    baselinePeriodCost: Math.round(baselineTotalCost * 100) / 100,
    simulatedPeriodCost: Math.round(simulatedTotalCost * 100) / 100,
    periodSavings: Math.round(year1Savings * 100) / 100,
    savingsPercentage: Math.round(savingsPercentage * 10) / 10,
    annualGridImportKwh: Math.round(totalGridImport * 10) / 10,
    annualGridExportKwh: Math.round(totalGridExport * 10) / 10,
    annualBatteryDischargedKwh: Math.round(totalBatteryDischarged * 10) / 10,
    equivalentFullCycles: Math.round(equivalentFullCycles),
    maxPeakDemandKw: Math.round(maxPeakKw * 100) / 100,
    intervalResults,
  };
}

/**
 * Internal Rate of Return (IRR) numerical solver using bisection search.
 * Solves for r such that: Sum_{t=0}^N CF_t / (1 + r)^t = 0.
 * Returns annualized percentage (e.g. 8.4) or null if no solution exists.
 */
export function calculateIRR(cashFlows: number[]): number | null {
  if (!cashFlows || cashFlows.length < 2) return null;
  const initial = cashFlows[0];
  if (initial >= 0) return null; // Must have an initial outflow

  // If sum of nominal cash flows is negative, IRR is negative or non-existent
  const totalNominal = cashFlows.reduce((a, b) => a + b, 0);
  if (totalNominal <= 0) return null;

  const npvAt = (r: number): number => {
    let sum = 0;
    for (let t = 0; t < cashFlows.length; t++) {
      sum += cashFlows[t] / Math.pow(1 + r, t);
    }
    return sum;
  };

  let low = -0.5; // -50%
  let high = 2.0; // +200%
  let npvLow = npvAt(low);
  let npvHigh = npvAt(high);

  if (npvLow * npvHigh > 0) {
    high = 5.0; // Extend search for high return rates
    npvHigh = npvAt(high);
    if (npvLow * npvHigh > 0) return null;
  }

  for (let iter = 0; iter < 60; iter++) {
    const mid = (low + high) / 2;
    const npvMid = npvAt(mid);
    if (Math.abs(npvMid) < 0.01 || (high - low) < 0.0001) {
      return Math.round(mid * 1000) / 10;
    }
    if (npvLow * npvMid < 0) {
      high = mid;
      npvHigh = npvMid;
    } else {
      low = mid;
      npvLow = npvMid;
    }
  }

  const result = (low + high) / 2;
  return Math.round(result * 1000) / 10;
}

/**
 * Multi-Year Comprehensive Financial, Lifecycle, Asset Health & Resilience Engine
 * Models:
 * - Time Value of Money (NPV & IRR)
 * - Inverter / Component Mid-life Replacement Reserve
 * - Clean Energy Loan Amortization & Net Monthly Cash Flow
 * - Opportunity Cost Benchmark (HYSA / Index Fund)
 * - Electrochemical Degradation, Usable Capacity & SoH %
 * - Warranted Cycle Exhaustion & Warranty Risk Flagging
 * - Levelized Cost of Storage (LCOS in $/kWh)
 * - Blackout Autonomy (Hours/Days) & Value of Lost Load (VOLL)
 */
export function calculate15YearFinancials(
  profile: BatteryProfile,
  annualSummary: AnnualSimulationSummary,
  financials: MacroFinancials
): ProfileFinancialAnalysis {
  const grossCost = profile.installedCost;
  
  // 1. Upfront Incentives vs Deferred Tax Credits
  // Immediate point-of-sale rebates reduce upfront out-of-pocket / financing basis.
  // Federal tax credits are realized in a subsequent year (default Year 1) as cash-flow inflows.
  const flatRebate = Math.max(0, financials.localRebateFlat);
  const immediateRebates = Math.min(grossCost, flatRebate);
  const upfrontNetCost = Math.max(0, grossCost - immediateRebates);

  const taxCreditPercent = Math.max(0, financials.federalTaxCreditPercent);
  const taxCreditAmount = grossCost * (taxCreditPercent / 100);
  const taxCreditRealizationYear = Math.max(1, financials.federalTaxCreditRealizationYear ?? 1);
  const totalIncentives = Math.min(grossCost, immediateRebates + taxCreditAmount);
  const netInstalledCost = Math.max(0, grossCost - totalIncentives);

  // 2. Financing & Clean Energy Loan Amortization
  // Loan principal is based on upfront capital needed (upfrontNetCost - down payment).
  // The deferred tax credit does NOT automatically reduce loan principal.
  let loanPrincipal = 0;
  let monthlyLoanPayment = 0;
  let upfrontOutOfPocket = upfrontNetCost; // For cash purchase, pay upfrontNetCost at Year 0
  let totalLoanPaymentLifetime = 0;
  let totalLoanInterestPaid = 0;

  if (financials.isFinanced) {
    const downPaymentRatio = Math.max(0, Math.min(1.0, financials.loanDownPaymentPercent / 100));
    const downPaymentAmount = upfrontNetCost * downPaymentRatio;
    loanPrincipal = Math.max(0, upfrontNetCost - downPaymentAmount);
    upfrontOutOfPocket = downPaymentAmount;

    const monthlyRate = (Math.max(0, financials.loanAprPercent) / 100) / 12;
    const numMonths = Math.max(12, Math.round(financials.loanTermYears * 12));

    if (loanPrincipal > 0) {
      if (monthlyRate > 0) {
        monthlyLoanPayment = loanPrincipal * (monthlyRate * Math.pow(1 + monthlyRate, numMonths)) / (Math.pow(1 + monthlyRate, numMonths) - 1);
      } else {
        monthlyLoanPayment = loanPrincipal / numMonths;
      }
      monthlyLoanPayment = Math.round(monthlyLoanPayment * 100) / 100;
      totalLoanPaymentLifetime = monthlyLoanPayment * numMonths;
      totalLoanInterestPaid = Math.max(0, totalLoanPaymentLifetime - loanPrincipal);
    }
  }

  const monthlyElectricitySavingsYear1 = annualSummary.year1Savings / 12;
  const netMonthlyCashFlow = monthlyElectricitySavingsYear1 - monthlyLoanPayment;
  const isCashFlowPositiveDay1 = netMonthlyCashFlow >= 0;

  // 3. Macro Rates
  const inflationRate = financials.annualElectricityInflationRate / 100;
  const degradationRate = financials.annualBatteryDegradationRate / 100;
  const discountRate = (financials.discountRatePercent ?? 5.0) / 100;

  const replacementEnabled = financials.replacementEnabled;
  const replacementCost = replacementEnabled ? Math.max(0, financials.replacementCost) : 0;
  const replacementYear = replacementEnabled ? Math.max(1, financials.replacementYear) : 0;

  // Authoritative opportunity-cost benchmark for full 25-year lifecycle
  const opportunityBenchmark = calculateOpportunityCostBenchmark({
    horizonYears: 25,
    annualRatePercent: financials.opportunityCostRatePercent ?? 4.5,
    upfrontContribution: upfrontOutOfPocket,
    monthlyLoanPayment,
    loanTermYears: financials.isFinanced ? financials.loanTermYears : 0,
    replacementEnabled,
    replacementCost,
    replacementYear,
  });

  // 4. Multi-Year Iteration Loop (Years 1 to 25)
  const projections: YearProjection[] = [];
  const cashFlowsForIrr: number[] = [-upfrontOutOfPocket];

  let cumulativeCashFlow = -upfrontOutOfPocket;
  let cumulativeBaselineSpend = 0;
  let cumulativeBatterySpend = upfrontOutOfPocket;
  let lifetimeSavingsTotal = 0;
  let npv = -upfrontOutOfPocket;
  let npvWithVoll = -upfrontOutOfPocket;
  let cumulativeCycles = 0;
  let totalLifetimeDischargedKwh = 0;
  let paybackYears: number | null = null;
  let warrantedCycleExhaustionYear: number | null = null;
  let cumulativeResilienceValue = 0;

  const baseYearSavings = annualSummary.year1Savings;
  const baseYearBaselineCost = annualSummary.baselineAnnualCost;
  const initialUsableCapacity = profile.totalCapacityKwh * (profile.usableDodPercent / 100);
  const annualCyclesYear1 = annualSummary.equivalentFullCycles;
  const annualDischargedYear1 = annualSummary.annualBatteryDischargedKwh;
  const annualVollValue = financials.annualOutageDays * financials.valueOfLostLoadPerDay;

  for (let y = 1; y <= 25; y++) {
    // Inflation factor escalates electricity prices
    const inflationFactor = Math.pow(1 + inflationRate, y - 1);

    // Electrochemical degradation (floor at 35% capacity retention)
    const capacityRetentionFactor = Math.max(0.35, 1 - (y - 1) * degradationRate);
    const usableCapacityKwh = initialUsableCapacity * capacityRetentionFactor;
    const sohPercent = Math.round(capacityRetentionFactor * 1000) / 10;

    // Diminishing returns on peak-shifting capacity as battery fades (elasticity ~0.85)
    const degradationSavingsLoss = Math.pow(capacityRetentionFactor, 0.85);
    const annualSavings = Math.max(0, baseYearSavings * inflationFactor * degradationSavingsLoss);
    const baselineCost = baseYearBaselineCost * inflationFactor;
    const withBatteryCost = Math.max(0, baselineCost - annualSavings);

    // Lifecycle Maintenance: Inverter Replacement in target year
    const replacementExpense = (replacementEnabled && y === replacementYear) ? replacementCost : 0;

    // Debt service if financed (active during loan term)
    const annualLoanPayment = (financials.isFinanced && y <= financials.loanTermYears)
      ? monthlyLoanPayment * 12
      : 0;

    // Tax credit cash inflow realized in configured realization year (default Year 1)
    const taxCreditInflow = (y === taxCreditRealizationYear) ? taxCreditAmount : 0;

    // Net Cash Flow for the year: includes operational savings, tax credit inflow, replacement and loan payments
    const netCashFlow = annualSavings - replacementExpense - annualLoanPayment + taxCreditInflow;
    cashFlowsForIrr.push(netCashFlow);

    // Opportunity Cost compound benchmark from authoritative helper
    const opportunityCostValue = opportunityBenchmark.yearly[y - 1].futureValue;

    // Cumulative tracking
    const prevCumulative = cumulativeCashFlow;
    cumulativeCashFlow += netCashFlow;
    cumulativeBaselineSpend += baselineCost;
    cumulativeBatterySpend += withBatteryCost + replacementExpense + annualLoanPayment;
    lifetimeSavingsTotal += annualSavings;

    // Breakeven crossover calculation
    if (paybackYears === null && prevCumulative < 0 && cumulativeCashFlow >= 0) {
      const deficit = -prevCumulative;
      const fraction = netCashFlow > 0 ? deficit / netCashFlow : 1;
      paybackYears = (y - 1) + fraction;
    }

    // Time Value of Money: Discounted Cash Flow for NPV
    const discountedCashFlow = netCashFlow / Math.pow(1 + discountRate, y);
    npv += discountedCashFlow;

    // Resilience VOLL value
    cumulativeResilienceValue += annualVollValue;
    const discountedResilience = annualVollValue / Math.pow(1 + discountRate, y);
    npvWithVoll += discountedCashFlow + (financials.includeVollInRoi ? discountedResilience : 0);

    // Cycles & Discharged Energy tracking
    const cyclesThisYear = Math.round(annualCyclesYear1 * Math.min(1.0, capacityRetentionFactor));
    cumulativeCycles += cyclesThisYear;
    const dischargedThisYear = annualDischargedYear1 * capacityRetentionFactor;
    totalLifetimeDischargedKwh += dischargedThisYear;

    // Check if cumulative cycles exceeds manufacturer rated cycle life
    const warrantedCyclesExceeded = cumulativeCycles >= profile.ratedCycleLife;
    if (warrantedCycleExhaustionYear === null && warrantedCyclesExceeded) {
      warrantedCycleExhaustionYear = y;
    }

    projections.push({
      year: y,
      inflationFactor: Math.round(inflationFactor * 1000) / 1000,
      capacityRetentionFactor: Math.round(capacityRetentionFactor * 100) / 100,
      baselineCost: Math.round(baselineCost),
      withBatteryCost: Math.round(withBatteryCost),
      annualSavings: Math.round(annualSavings),
      taxCreditInflow: Math.round(taxCreditInflow),
      replacementExpense: Math.round(replacementExpense),
      annualLoanPayment: Math.round(annualLoanPayment),
      netCashFlow: Math.round(netCashFlow),
      cumulativeCashFlow: Math.round(cumulativeCashFlow),
      cumulativeBaselineSpend: Math.round(cumulativeBaselineSpend),
      cumulativeBatterySpend: Math.round(cumulativeBatterySpend),
      discountedCashFlow: Math.round(discountedCashFlow),
      cumulativeNpv: Math.round(npv),
      opportunityCostValue,
      usableCapacityKwh: Math.round(usableCapacityKwh * 10) / 10,
      sohPercent,
      cyclesThisYear,
      cumulativeCycles,
      warrantedCyclesExceeded,
      resilienceValue: Math.round(annualVollValue),
      cumulativeResilienceValue: Math.round(cumulativeResilienceValue),
    });
  }

  // 5. Payback Formatting (Years & Months)
  let paybackFormatted = 'Over 25 Years';
  if (paybackYears !== null) {
    const fullYears = Math.floor(paybackYears);
    const months = Math.round((paybackYears - fullYears) * 12);
    if (months === 12) {
      paybackFormatted = `${fullYears + 1} yrs`;
    } else if (months === 0) {
      paybackFormatted = `${fullYears} yrs`;
    } else {
      paybackFormatted = `${fullYears} yrs ${months} mos`;
    }
  }

  // 6. Net Profit & Lifetime ROI
  const totalCapitalOutlay = upfrontOutOfPocket + (financials.isFinanced ? totalLoanPaymentLifetime : 0) + (replacementEnabled ? replacementCost : 0);
  const lifetimeNetProfit = Math.round(lifetimeSavingsTotal + taxCreditAmount - totalCapitalOutlay);
  const lifetimeRoiPercent = totalCapitalOutlay > 0
    ? (lifetimeNetProfit / totalCapitalOutlay) * 100
    : 0;

  // 7. Internal Rate of Return (IRR)
  const irrPercent = calculateIRR(cashFlowsForIrr);

  // 8. Warning if Nominal Profit is positive but NPV is negative
  const isNpvNegativeWithPositiveProfit = lifetimeNetProfit > 0 && npv < 0;

  // 9. Opportunity Cost Calculations
  let opportunityCostVehicleName = 'High-Yield Savings Account (4.5% APY)';
  if (financials.opportunityCostVehicle === 'index_fund') {
    opportunityCostVehicleName = 'S&P 500 Index Fund (7.0% Return)';
  } else if (financials.opportunityCostVehicle === 'custom') {
    opportunityCostVehicleName = `Custom Asset (${financials.opportunityCostRatePercent}%)`;
  }
  const opportunityCostFutureValue = opportunityBenchmark.futureValue;
  const opportunityCostProfit = opportunityBenchmark.profit;
  const opportunityCostDiff = lifetimeNetProfit - opportunityCostProfit;
  const batteryOutperformsAlternative = lifetimeNetProfit >= opportunityCostProfit;

  // 10. Asset Health & Warranty Flag
  const endOfLifeSohPercent = projections[24]?.sohPercent || 52;
  const remainingUsableCapacityKwh = projections[24]?.usableCapacityKwh || (initialUsableCapacity * 0.52);
  const isWarrantyVoidedBeforePayback =
    warrantedCycleExhaustionYear !== null &&
    (paybackYears === null || warrantedCycleExhaustionYear < paybackYears);

  // 11. Levelized Cost of Storage (LCOS in $/kWh)
  // LCOS = (Total Net Capital Cost + Replacement Reserve) / Total Discharged kWh
  const totalCapitalAndMaintenance = netInstalledCost + totalLoanInterestPaid + (replacementEnabled ? replacementCost : 0);
  const lcosPerKwh = totalLifetimeDischargedKwh > 0
    ? Math.round((totalCapitalAndMaintenance / totalLifetimeDischargedKwh) * 1000) / 1000
    : 0;

  // 12. Resilience & Backup Autonomy
  const criticalLoadKw = Math.max(0.2, financials.criticalLoadPowerKw);
  const outageAutonomyHours = Math.round((initialUsableCapacity / criticalLoadKw) * 10) / 10;
  const outageAutonomyDays = Math.round((outageAutonomyHours / 24) * 10) / 10;

  // 13. Value of Lost Load (VOLL) ROI integration
  const lifetimeResilienceValue = cumulativeResilienceValue;
  const lifetimeNetProfitWithVoll = lifetimeNetProfit + lifetimeResilienceValue;
  const lifetimeRoiWithVollPercent = totalCapitalOutlay > 0
    ? (lifetimeNetProfitWithVoll / totalCapitalOutlay) * 100
    : 0;

  return {
    profile,
    annualSummary,
    grossCost: Math.round(grossCost),
    incentivesAmount: Math.round(totalIncentives),
    netInstalledCost: Math.round(netInstalledCost),
    upfrontOutOfPocket: Math.round(upfrontOutOfPocket),
    year1Savings: Math.round(baseYearSavings),
    paybackYears: paybackYears !== null ? Math.round(paybackYears * 10) / 10 : null,
    paybackFormatted,
    lifetimeTotalSavings: Math.round(lifetimeSavingsTotal),
    lifetimeNetProfit: Math.round(lifetimeNetProfit),
    lifetimeRoiPercent: Math.round(lifetimeRoiPercent * 10) / 10,
    
    // TVM
    npv: Math.round(npv),
    irrPercent,
    isNpvNegativeWithPositiveProfit,
    discountRatePercent: financials.discountRatePercent,

    // Opportunity Cost
    opportunityCostVehicleName,
    opportunityCostRate: financials.opportunityCostRatePercent,
    opportunityCostFutureValue,
    opportunityCostProfit,
    opportunityCostDiff,
    batteryOutperformsAlternative,

    // Financing
    isFinanced: financials.isFinanced,
    loanPrincipal: Math.round(loanPrincipal),
    monthlyLoanPayment: Math.round(monthlyLoanPayment * 100) / 100,
    monthlyElectricitySavingsYear1: Math.round(monthlyElectricitySavingsYear1 * 100) / 100,
    netMonthlyCashFlow: Math.round(netMonthlyCashFlow * 100) / 100,
    isCashFlowPositiveDay1,
    totalLoanPaymentLifetime: Math.round(totalLoanPaymentLifetime),
    totalLoanInterestPaid: Math.round(totalLoanInterestPaid),

    // Maintenance
    replacementCostTotal: replacementCost,
    replacementYear,
    replacementEnabled,

    // Asset Health & Warranty
    endOfLifeSohPercent,
    remainingUsableCapacityKwh: Math.round(remainingUsableCapacityKwh * 10) / 10,
    totalLifetimeDischargedKwh: Math.round(totalLifetimeDischargedKwh),
    lcosPerKwh,
    warrantedCycleLimit: profile.ratedCycleLife,
    warrantedCycleExhaustionYear,
    isWarrantyVoidedBeforePayback,

    // Resilience
    outageAutonomyHours,
    outageAutonomyDays,
    criticalLoadPowerKw: criticalLoadKw,
    annualResilienceValue: Math.round(annualVollValue),
    lifetimeResilienceValue: Math.round(lifetimeResilienceValue),
    npvWithVoll: Math.round(npvWithVoll),
    lifetimeNetProfitWithVoll: Math.round(lifetimeNetProfitWithVoll),
    lifetimeRoiWithVollPercent: Math.round(lifetimeRoiWithVollPercent * 10) / 10,

    // Multi-Year Projections (25-Year Lifetime Model)
    projections,

    // Explicit Full 25-Year Lifetime Results
    lifetime25YearNpv: Math.round(npv),
    lifetime25YearNetProfit: Math.round(lifetimeNetProfit),
    lifetime25YearRoiPercent: Math.round(lifetimeRoiPercent * 10) / 10,
    lifetime25YearSavings: Math.round(lifetimeSavingsTotal),

    // Genuine 15-Year Horizon Aliases (derived for the first 15 years)
    projections15Yr: projections.slice(0, 15),
    lifetimeTotalSavings15Yr: Math.round(
      projections.slice(0, 15).reduce((sum, p) => sum + p.annualSavings, 0)
    ),
    lifetimeNetProfit15Yr: Math.round(projections[14]?.cumulativeCashFlow ?? 0),
    npv15Yr: Math.round(projections[14]?.cumulativeNpv ?? 0),
  };
}

/**
 * Authoritative helper to derive horizon-specific financial, lifecycle, and asset metrics
 * from a ProfileFinancialAnalysis.
 * Used by both UI components and JSON/CSV export layers to ensure a single source of truth.
 */
export function deriveHorizonFinancialSummary(
  analysis: ProfileFinancialAnalysis,
  horizonYears: number
): HorizonFinancialSummary {
  const safeHorizon = Math.max(1, Math.min(analysis.projections.length, Math.round(horizonYears)));
  const horizonProjections = (analysis.projections || []).slice(0, safeHorizon);
  const lastProj = horizonProjections[safeHorizon - 1] || analysis.projections[0];

  const cumulativeSavings = horizonProjections.reduce((sum, p) => sum + p.annualSavings, 0);
  const totalReplacementCost = horizonProjections.reduce((sum, p) => sum + p.replacementExpense, 0);
  const totalLoanPayments = horizonProjections.reduce((sum, p) => sum + p.annualLoanPayment, 0);
  const taxCreditInflows = horizonProjections.reduce((sum, p) => sum + (p.taxCreditInflow || 0), 0);

  // Authoritative net profit for horizon = cumulativeCashFlow at year `safeHorizon`
  const cumulativeCashFlow = lastProj ? lastProj.cumulativeCashFlow : -analysis.upfrontOutOfPocket;
  const netPresentValue = lastProj ? lastProj.cumulativeNpv : analysis.npv;

  const endOfHorizonSohPercent = lastProj ? lastProj.sohPercent : 100;
  const endOfHorizonUsableCapacityKwh = lastProj ? lastProj.usableCapacityKwh : analysis.profile.totalCapacityKwh;
  const cumulativeCycles = lastProj ? lastProj.cumulativeCycles : 0;

  const warrantedCyclesExhausted = horizonProjections.some((p) => p.warrantedCyclesExceeded);
  const cycleExhaustionYear =
    analysis.warrantedCycleExhaustionYear !== null && analysis.warrantedCycleExhaustionYear <= safeHorizon
      ? analysis.warrantedCycleExhaustionYear
      : null;

  const simplePaybackYears =
    analysis.paybackYears !== null && analysis.paybackYears <= safeHorizon
      ? analysis.paybackYears
      : null;

  // Discounted payback period within horizon (where cumulative NPV crosses >= 0)
  let discountedPaybackYears: number | null = null;
  for (let i = 0; i < horizonProjections.length; i++) {
    const p = horizonProjections[i];
    if (p.cumulativeNpv >= 0) {
      if (i === 0) {
        discountedPaybackYears = 1.0;
      } else {
        const prev = horizonProjections[i - 1];
        const denom = p.cumulativeNpv - prev.cumulativeNpv;
        const fraction = denom !== 0 ? (0 - prev.cumulativeNpv) / denom : 0;
        discountedPaybackYears = Math.round((prev.year + fraction) * 10) / 10;
      }
      break;
    }
  }

  // Horizon ROI
  const totalCapitalOutlay =
    analysis.upfrontOutOfPocket + totalLoanPayments + totalReplacementCost;
  const horizonRoiPercent =
    totalCapitalOutlay > 0
      ? Math.round(((cumulativeCashFlow / totalCapitalOutlay) * 100) * 10) / 10
      : 0;

  // Opportunity cost at target horizon (unified methodology)
  const opportunityCostFutureValue = lastProj
    ? lastProj.opportunityCostValue
    : analysis.upfrontOutOfPocket;
  const opportunityCostTotalContributions =
    analysis.upfrontOutOfPocket + totalLoanPayments + totalReplacementCost;
  const opportunityCostProfit =
    opportunityCostFutureValue - opportunityCostTotalContributions;
  const opportunityCostDiff = cumulativeCashFlow - opportunityCostProfit;

  return {
    horizonYears: safeHorizon,
    netPresentValue: Math.round(netPresentValue),
    cumulativeCashFlow: Math.round(cumulativeCashFlow),
    cumulativeSavings: Math.round(cumulativeSavings),
    totalReplacementCost: Math.round(totalReplacementCost),
    totalLoanPayments: Math.round(totalLoanPayments),
    taxCreditInflows: Math.round(taxCreditInflows),
    endOfHorizonSohPercent,
    endOfHorizonUsableCapacityKwh,
    cumulativeCycles,
    warrantedCyclesExhausted,
    cycleExhaustionYear,
    simplePaybackYears,
    discountedPaybackYears,
    horizonRoiPercent,
    opportunityCostFutureValue,
    opportunityCostProfit,
    opportunityCostDiff,
  };
}

/**
 * Checks whether a dataset is suitable for multi-year financial projections.
 */
export function isDatasetSuitableForAnnualProjections(
  completeness?: DatasetCompleteness | null
): boolean {
  if (!completeness) return false;
  return Boolean(completeness.isSuitableForAnnualProjection);
}

/**
 * Derives the savings label for the application header.
 */
export function getHeaderSavingsLabel(isSuitableForAnnual: boolean): string {
  return isSuitableForAnnual ? 'Year 1 Savings' : 'Period Savings';
}

/**
 * Returns formatted payback for header if dataset is suitable for annual projection, otherwise null.
 */
export function getHeaderPaybackText(
  analysis: ProfileFinancialAnalysis | null,
  isSuitableForAnnual: boolean
): string | null {
  if (!isSuitableForAnnual || !analysis) return null;
  return analysis.paybackFormatted;
}

/**
 * Derives valid, observed operational metrics for partial-period datasets.
 * Does not calculate or fabricate long-term financial, lifecycle, or TVM metrics.
 */
export function derivePartialPeriodDisplayMetrics(
  profile: BatteryProfile,
  summary: AnnualSimulationSummary,
  completeness?: DatasetCompleteness | null
): PartialPeriodDisplayMetrics {
  const durationDays =
    completeness?.durationDays ??
    summary.durationDays ??
    Math.max(1, Math.floor(summary.totalIntervals / 24));
  const baselinePeriodCostUsd = summary.baselinePeriodCost ?? summary.baselineAnnualCost;
  const simulatedPeriodCostUsd = summary.simulatedPeriodCost ?? summary.simulatedAnnualCost;
  const periodSavingsUsd = summary.periodSavings ?? summary.year1Savings;

  return {
    configuredInstalledCostUsd: profile.installedCost,
    durationDays,
    baselinePeriodCostUsd,
    simulatedPeriodCostUsd,
    periodSavingsUsd,
    savingsPercentage: summary.savingsPercentage,
    totalHomeLoadKwh: summary.totalHomeLoadKwh,
    gridImportKwh: summary.annualGridImportKwh,
    gridExportKwh: summary.annualGridExportKwh,
    batteryDischargedKwh: summary.annualBatteryDischargedKwh,
    equivalentFullCycles: summary.equivalentFullCycles,
    peakDemandKw: summary.maxPeakDemandKw,
  };
}

