/**
 * Core Type Definitions for VoltWise Energy Simulation Engine
 */

/**
 * Canonical Day of Week Representation:
 * Matches standard JavaScript Date.getDay() semantics:
 * 0 = Sunday, 1 = Monday, 2 = Tuesday, 3 = Wednesday, 4 = Thursday, 5 = Friday, 6 = Saturday.
 * 
 * For user-facing presentation, the UI displays Monday through Sunday (UI_DAY_ORDER).
 */
export const CANONICAL_DAYS = [
  { dayOfWeek: 0, name: 'Sunday', shortName: 'Sun', isWeekend: true },
  { dayOfWeek: 1, name: 'Monday', shortName: 'Mon', isWeekend: false },
  { dayOfWeek: 2, name: 'Tuesday', shortName: 'Tue', isWeekend: false },
  { dayOfWeek: 3, name: 'Wednesday', shortName: 'Wed', isWeekend: false },
  { dayOfWeek: 4, name: 'Thursday', shortName: 'Thu', isWeekend: false },
  { dayOfWeek: 5, name: 'Friday', shortName: 'Fri', isWeekend: false },
  { dayOfWeek: 6, name: 'Saturday', shortName: 'Sat', isWeekend: true },
] as const;

/** User-facing display row ordering: Monday (1) through Sunday (0) */
export const UI_DAY_ORDER: readonly number[] = [1, 2, 3, 4, 5, 6, 0];

export const UI_DAY_NAMES: readonly string[] = [
  'Monday',
  'Tuesday',
  'Wednesday',
  'Thursday',
  'Friday',
  'Saturday',
  'Sunday',
];

/** Translates UI row index (0=Monday .. 6=Sunday) to canonical dayOfWeek (0=Sun .. 6=Sat) */
export function uiRowIndexToDayOfWeek(uiRowIndex: number): number {
  return UI_DAY_ORDER[uiRowIndex] ?? 1;
}

/** Translates canonical dayOfWeek (0=Sun .. 6=Sat) to UI row index (0=Monday .. 6=Sunday) */
export function dayOfWeekToUiRowIndex(dayOfWeek: number): number {
  const idx = UI_DAY_ORDER.indexOf(dayOfWeek);
  return idx >= 0 ? idx : 0;
}

/** Determines if a canonical day of week is a weekend (Saturday or Sunday) */
export function isWeekendDay(dayOfWeek: number): boolean {
  return dayOfWeek === 0 || dayOfWeek === 6;
}

export type OperationalStrategy = 'arbitrage' | 'self_consumption';

export interface RateTier {
  id: string;
  name: string;
  buyRate: number; // Price to import from grid ($/kWh)
  sellRate: number; // Feed-in tariff / export credit ($/kWh)
  color: string; // Hex color code for visualization
  isChargeWindow?: boolean; // Recommended charging period
  isDischargeWindow?: boolean; // Recommended discharging period
}

export interface TouSeason {
  id: string;
  name: string;
  months: number[]; // 0-indexed (0=Jan, 11=Dec)
  tierRates: Record<string, { buyRate: number; sellRate: number }>;
}

export interface TouProfile {
  id: string;
  name: string;
  utility: string;
  description: string;
  tiers: RateTier[];
  scheduleMatrix: string[][]; // [day 0..6][hour 0..23] = tierId
  seasons: TouSeason[];
}

export interface BatteryProfile {
  id: string;
  name: string;
  model: string;
  totalCapacityKwh: number; // Total nominal energy capacity
  usableDodPercent: number; // Usable Depth of Discharge (e.g. 90% - 100%)
  maxContinuousOutputKw: number; // Max discharge power
  maxContinuousChargeKw: number; // Max charge power
  roundTripEfficiencyPercent: number; // e.g. 90% AC-to-DC-to-AC
  ratedCycleLife: number; // e.g. 4000 or 6000 cycles
  installedCost: number; // Total Hardware + Labor before incentives ($)
  strategy: OperationalStrategy;
  chargeTiers: string[]; // Tier IDs to charge in
  dischargeTiers: string[]; // Tier IDs to discharge in
  allowGridExport?: boolean; // When true, battery may export excess stored energy to grid during peak hours if profitable
}

export interface MacroFinancials {
  // Upfront Capital & Incentives (User-provided assumptions)
  federalTaxCreditPercent: number; // e.g. User-provided % (default 0%)
  federalTaxCreditRealizationYear?: number; // Year tax credit is realized as cash flow (default Year 1)
  localRebateFlat: number; // e.g. Flat rebate/grant (default $0)
  
  // Escalation & Degradation
  annualElectricityInflationRate: number; // e.g. 3.5%
  annualBatteryDegradationRate: number; // e.g. 2.0%
  
  // Time Value of Money & Opportunity Cost
  discountRatePercent: number; // e.g. 4.0% to 7.0% for NPV calculation
  opportunityCostVehicle: 'hysa' | 'index_fund' | 'custom';
  opportunityCostRatePercent: number; // e.g. 4.5% for HYSA, 7.0% for Index Fund
  
  // Lifecycle Maintenance & Inverter Replacement Reserve
  replacementEnabled: boolean; // Whether mid-life component replacement is modeled
  replacementCost: number; // e.g. $2,000 for mid-life inverter/controller replacement
  replacementYear: number; // e.g. Year 10
  
  // Financing & Loan
  isFinanced: boolean; // True if financed via clean energy loan
  loanAprPercent: number; // e.g. 6.99%
  loanTermYears: number; // e.g. 10 or 15 or 20 years
  loanDownPaymentPercent: number; // e.g. 0% or 10%
  
  // Non-Financial & Resilience Metrics
  criticalLoadPowerKw: number; // e.g. 1.2 kW continuous essential backup load
  annualOutageDays: number; // e.g. 2.5 days/year blackout expectancy
  valueOfLostLoadPerDay: number; // e.g. $100/day for food preservation, comfort, HVAC
  includeVollInRoi: boolean; // Whether to blend VOLL into financial ROI calculations
}

export interface IntervalDataPoint {
  timestamp: string; // Normalized string YYYY-MM-DD HH:mm
  date: Date;
  hour: number; // 0-23
  dayOfWeek: number; // 0=Sunday, 1=Monday, ..., 6=Saturday
  month: number; // 0-11
  usageKwh: number; // Home load demand in this interval (Hourly Total in kWh)
  
  // Extended fields matching exact schema: Day, Hour of Day, Hourly Total, Daily Total, Unit of Measurement
  dayStr?: string; // e.g. "09/22/2025"
  hourOfDayStr?: string; // e.g. "12:00 AM"
  hourlyTotal?: number; // e.g. 1.018
  dailyTotal?: number; // e.g. 25.075
  unitOfMeasurement?: string; // e.g. "kWh"
}

export interface IntervalSimulationResult {
  timestamp: string;
  hour: number;
  dayOfWeek: number;
  homeLoadKwh: number;
  tierId: string;
  tierName: string;
  seasonName?: string;
  buyRate: number;
  sellRate: number;
  
  batteryChargeKwh: number;
  batteryDischargeKwh: number;
  batterySocKwh: number;
  batterySocPercent: number;
  
  gridImportKwh: number;
  gridExportKwh: number;
  
  baselineCost: number;
  simulatedCost: number;
  netSavings: number;
}

export interface AnnualSimulationSummary {
  profileId: string;
  profileName: string;
  totalIntervals: number;
  intervalHours: number;
  totalHomeLoadKwh: number;
  baselineAnnualCost: number;
  simulatedAnnualCost: number;
  year1Savings: number;
  savingsPercentage: number;
  annualGridImportKwh: number;
  annualGridExportKwh: number;
  annualBatteryDischargedKwh: number;
  equivalentFullCycles: number;
  maxPeakDemandKw: number;
  
  // Period & Dataset eligibility flags
  isSuitableForAnnualProjection?: boolean;
  periodSavings?: number; // Equivalent to year1Savings for partial period
  baselinePeriodCost?: number; // Equivalent to baselineAnnualCost for partial period
  simulatedPeriodCost?: number; // Equivalent to simulatedAnnualCost for partial period
  durationDays?: number;
  
  intervalResults: IntervalSimulationResult[];
}

export interface HorizonFinancialSummary {
  horizonYears: number;
  netPresentValue: number; // Cumulative NPV at year `horizon`
  cumulativeCashFlow: number; // Cumulative cash flow at year `horizon` (authoritative net profit)
  cumulativeSavings: number; // Sum of annual energy savings across years 1..horizon
  totalReplacementCost: number; // Replacement expenses incurred within years 1..horizon
  totalLoanPayments: number; // Loan principal + interest payments incurred within years 1..horizon
  taxCreditInflows: number; // Deferred tax credit cash inflows realized within years 1..horizon
  endOfHorizonSohPercent: number; // SoH % at year `horizon`
  endOfHorizonUsableCapacityKwh: number; // Usable capacity at year `horizon`
  cumulativeCycles: number; // Total cycles through year `horizon`
  warrantedCyclesExhausted: boolean; // True if rated cycle life exceeded within years 1..horizon
  cycleExhaustionYear: number | null; // Year when cycle warranty exceeded (if <= horizon, else null)
  simplePaybackYears: number | null; // Simple payback if <= horizon, else null
  discountedPaybackYears: number | null; // Discounted payback if <= horizon, else null
  horizonRoiPercent: number; // Cumulative net profit / total capital outlay through horizon * 100
  opportunityCostFutureValue: number; // Compounded alternative value at year `horizon`
  opportunityCostProfit: number; // Alternative profit at year `horizon`
  opportunityCostDiff: number; // Battery net profit - opportunity profit at year `horizon`
}

export interface YearProjection {
  year: number;
  inflationFactor: number;
  capacityRetentionFactor: number;
  baselineCost: number;
  withBatteryCost: number;
  annualSavings: number;
  
  // Cash Flow & Capital Outlays
  taxCreditInflow?: number; // Federal tax credit cash inflow realized in target year
  replacementExpense: number; // Inverter replacement in target year
  annualLoanPayment: number; // Debt service if financed
  netCashFlow: number; // annualSavings - replacementExpense - annualLoanPayment + taxCreditInflow
  cumulativeCashFlow: number; // cumulative sum starting from -upfrontCapital
  cumulativeBaselineSpend: number; // cumulative electricity spend with NO battery
  cumulativeBatterySpend: number; // upfrontCapital + cumulative withBatteryCost + maintenance
  
  // Time Value & Opportunity Cost
  discountedCashFlow: number; // Net cash flow discounted to Year 0
  cumulativeNpv: number; // Cumulative NPV up to this year
  opportunityCostValue: number; // Upfront capital compounded in alternative vehicle
  
  // Asset Health & Degradation
  usableCapacityKwh: number;
  sohPercent: number; // State of Health % (remaining usable capacity)
  cyclesThisYear: number;
  cumulativeCycles: number;
  warrantedCyclesExceeded: boolean;
  
  // Resilience Value
  resilienceValue: number; // Annual VOLL
  cumulativeResilienceValue: number;
}

export interface ProfileFinancialAnalysis {
  profile: BatteryProfile;
  annualSummary: AnnualSimulationSummary;
  
  // Upfront Capital & Incentives
  grossCost: number;
  incentivesAmount: number;
  netInstalledCost: number;
  upfrontOutOfPocket: number; // Net cost minus loan principal if financed
  
  // Operational Savings
  year1Savings: number;
  paybackYears: number | null; // e.g. 6.35 years, or null if > horizon
  paybackFormatted: string; // e.g. "6 yrs 4 mos"
  lifetimeTotalSavings: number;
  lifetimeNetProfit: number; // total savings - net installed cost - maintenance
  lifetimeRoiPercent: number; // (net profit / net out-of-pocket) * 100
  
  // Advanced Financial Metrics (Time Value of Money)
  npv: number; // Net Present Value at target horizon
  irrPercent: number | null; // Internal Rate of Return %
  isNpvNegativeWithPositiveProfit: boolean; // Flag if nominal profit > 0 but NPV < 0
  discountRatePercent: number;
  
  // Opportunity Cost Comparison
  opportunityCostVehicleName: string;
  opportunityCostRate: number;
  opportunityCostFutureValue: number;
  opportunityCostProfit: number;
  opportunityCostDiff: number; // Battery Net Profit minus Alternative Profit
  batteryOutperformsAlternative: boolean;
  
  // Financing & Loan Metrics
  isFinanced: boolean;
  loanPrincipal: number;
  monthlyLoanPayment: number;
  monthlyElectricitySavingsYear1: number;
  netMonthlyCashFlow: number; // Monthly electricity savings - monthly loan payment
  isCashFlowPositiveDay1: boolean;
  totalLoanPaymentLifetime: number;
  totalLoanInterestPaid: number;
  
  // Lifecycle Maintenance
  replacementCostTotal: number;
  replacementYear: number;
  replacementEnabled: boolean;
  
  // Asset Health, Warranty & LCOS
  endOfLifeSohPercent: number; // SoH % at horizon
  remainingUsableCapacityKwh: number;
  totalLifetimeDischargedKwh: number;
  lcosPerKwh: number; // Levelized Cost of Storage ($/kWh)
  warrantedCycleLimit: number;
  warrantedCycleExhaustionYear: number | null;
  isWarrantyVoidedBeforePayback: boolean;
  
  // Resilience & Non-Financial Outage Metrics
  outageAutonomyHours: number;
  outageAutonomyDays: number;
  criticalLoadPowerKw: number;
  annualResilienceValue: number;
  lifetimeResilienceValue: number;
  npvWithVoll: number;
  lifetimeNetProfitWithVoll: number;
  lifetimeRoiWithVollPercent: number;
  
  // Multi-Year Projections (25-Year Lifetime Model)
  projections: YearProjection[];
  
  // Explicit Full 25-Year Lifetime Results
  lifetime25YearNpv: number;
  lifetime25YearNetProfit: number;
  lifetime25YearRoiPercent: number;
  lifetime25YearSavings: number;
  
  // Genuine 15-year horizon aliases (derived for the first 15 years)
  projections15Yr: YearProjection[];
  lifetimeTotalSavings15Yr: number;
  lifetimeNetProfit15Yr: number;
  npv15Yr: number;
}

export interface DatasetCompleteness {
  startDate: string;
  endDate: string;
  intervalCount: number;
  intervalDurationHours: number;
  durationDays: number;
  expectedIntervalCount: number;
  missingIntervalCount: number;
  isLeapYear: boolean;
  isSuitableForAnnualProjection: boolean;
  reason?: string;
  // Compatibility aliases
  totalIntervals?: number;
  intervalHours?: number;
  expectedIntervals?: number;
  isCompleteYear?: boolean;
  isAnnualProjectionSuitable?: boolean;
  unsuitabilityReason?: string;
}

export interface CsvValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  totalRows: number;
  validRows: number;
  totalKwh: number;
  intervalHours: number;
  startDate?: string;
  endDate?: string;
  peakKw: number;
  data: IntervalDataPoint[];
  schemaDetected?: 'standard_5col' | 'legacy_2col';
  completeness?: DatasetCompleteness;
}

export interface PartialPeriodDisplayMetrics {
  configuredInstalledCostUsd: number;
  durationDays: number;
  baselinePeriodCostUsd: number;
  simulatedPeriodCostUsd: number;
  periodSavingsUsd: number;
  savingsPercentage: number;
  totalHomeLoadKwh: number;
  gridImportKwh: number;
  gridExportKwh: number;
  batteryDischargedKwh: number;
  equivalentFullCycles: number;
  peakDemandKw: number;
}

// ============================================================================
// On-Site Power Generation Domain Contracts (G1 Milestone)
// ============================================================================

export interface GenerationSite {
  latitude: number | null;
  longitude: number | null;
  timeZone: string;
  elevationM: number | null;
}

export interface GenerationAssetBase {
  id: string;
  name: string;
  enabled: boolean;

  installedCostUsd: number;
  annualMaintenanceCostUsd: number;
}

export type SolarResourceMode =
  | 'clear_sky'
  | 'monthly_peak_sun_hours'
  | 'weather_file';

export interface SolarGenerationAsset extends GenerationAssetBase {
  type: 'solar';

  dcCapacityKw: number;

  tiltDegrees: number;
  azimuthDegrees: number;

  inverterAcCapacityKw: number;
  inverterEfficiencyPercent: number;

  systemLossPercent: number;
  shadingLossPercent: number;

  annualDegradationPercent: number;

  resourceMode: SolarResourceMode;

  monthlyPeakSunHoursPerDay: number[];
}

export type WindResourceMode =
  | 'monthly_average'
  | 'annual_average'
  | 'interval_file';

export interface WindPowerCurvePoint {
  windSpeedMps: number;
  outputKw: number;
}

export interface WindGenerationAsset extends GenerationAssetBase {
  type: 'wind';

  ratedPowerKw: number;

  hubHeightM: number;
  rotorDiameterM: number;

  cutInWindSpeedMps: number;
  ratedWindSpeedMps: number;
  cutOutWindSpeedMps: number;

  availabilityPercent: number;
  systemLossPercent: number;

  resourceMode: WindResourceMode;

  measurementHeightM: number;
  windShearExponent: number;

  annualAverageWindSpeedMps: number | null;
  monthlyAverageWindSpeedMps: number[];

  powerCurve: WindPowerCurvePoint[];
}

export type GeneratorFuelType =
  | 'natural_gas'
  | 'propane'
  | 'gasoline'
  | 'diesel'
  | 'custom';

export type GeneratorFuelUnit =
  | 'gallon'
  | 'therm'
  | 'ccf'
  | 'mmbtu'
  | 'custom';

export type GeneratorDispatchMode =
  | 'standby'
  | 'scheduled'
  | 'economic';

export interface GeneratorFuelCurvePoint {
  loadPercent: number;
  fuelUnitsPerHour: number;
}

export interface GeneratorGenerationAsset extends GenerationAssetBase {
  type: 'generator';

  ratedContinuousKw: number;
  minimumStableLoadPercent: number;

  fuelType: GeneratorFuelType;
  fuelUnit: GeneratorFuelUnit;
  customFuelUnitLabel: string;

  fuelPricePerUnit: number;
  variableMaintenanceCostPerHourUsd: number;

  fuelCurve: GeneratorFuelCurvePoint[];

  dispatchMode: GeneratorDispatchMode;

  allowBatteryCharging: boolean;
  allowGridExport: boolean;

  scheduledHours: boolean[][];
}

export type GenerationAsset =
  | SolarGenerationAsset
  | WindGenerationAsset
  | GeneratorGenerationAsset;

export interface GenerationConfig {
  site: GenerationSite;
  assets: GenerationAsset[];
}

// ============================================================================
// Solar Physics Modeling Types (Milestone G2A)
// ============================================================================

export interface SolarPosition {
  elevationDegrees: number;
  zenithDegrees: number;
  azimuthDegrees: number;
  isDaylight: boolean;
}

export interface SolarIntervalGenerationResult {
  timestampUtc: string;

  position: SolarPosition;

  clearSkyGhiKwPerM2: number;
  clearSkyDniKwPerM2: number;
  planeOfArrayIrradianceKwPerM2: number;

  rawDcPowerKw: number;
  dcPowerAfterLossesKw: number;

  unclippedAcPowerKw: number;
  acPowerKw: number;

  dcEnergyKwh: number;
  acEnergyKwh: number;
  clippedEnergyKwh: number;
}

// ============================================================================
// Solar Profile & Resource Modeling Types (Milestone G2B)
// ============================================================================

export interface MonthlyPeakSunHourSolarInterval {
  timestampUtc: string;

  localDate: string;
  monthIndex: number;

  targetPeakSunHoursPerDay: number;
  resourceScaleFactor: number;

  position: SolarPosition;

  clearSkyGhiKwPerM2: number;
  clearSkyDniKwPerM2: number;
  clearSkyPoaKwPerM2: number;

  modeledGhiKwPerM2: number;
  modeledDniKwPerM2: number;
  modeledPoaKwPerM2: number;

  rawDcPowerKw: number;
  dcPowerAfterLossesKw: number;
  unclippedAcPowerKw: number;
  acPowerKw: number;

  dcEnergyKwh: number;
  acEnergyKwh: number;
  clippedEnergyKwh: number;
}

export interface SolarMonthlyGenerationSummary {
  monthIndex: number;
  intervalCount: number;
  dcEnergyKwh: number;
  acEnergyKwh: number;
  clippedEnergyKwh: number;
}

export interface SolarGenerationProfileSummary {
  intervalCount: number;
  totalDcEnergyKwh: number;
  totalAcEnergyKwh: number;
  totalClippedEnergyKwh: number;

  monthly: SolarMonthlyGenerationSummary[];
}

// ============================================================================
// Unified Solar Generation & Fleet Aggregation Contracts (Milestone G2C)
// ============================================================================

export type ModeledSolarResourceMode =
  | 'clear_sky'
  | 'monthly_peak_sun_hours';

export interface SolarGenerationInterval {
  assetId: string;
  timestampUtc: string;
  resourceMode: ModeledSolarResourceMode;

  position: SolarPosition;

  ghiKwPerM2: number;
  dniKwPerM2: number;
  poaKwPerM2: number;

  rawDcPowerKw: number;
  dcPowerAfterLossesKw: number;

  unclippedAcPowerKw: number;
  acPowerKw: number;

  dcEnergyKwh: number;
  acEnergyKwh: number;
  clippedEnergyKwh: number;
}

export interface SolarFleetGenerationInterval {
  timestampUtc: string;

  totalRawDcPowerKw: number;
  totalDcPowerAfterLossesKw: number;

  totalUnclippedAcPowerKw: number;
  totalAcPowerKw: number;

  totalDcEnergyKwh: number;
  totalAcEnergyKwh: number;
  totalClippedEnergyKwh: number;
}

// ============================================================================
// Solar-to-Load Energy Flow Contracts (Milestone G3A)
// ============================================================================

export interface SolarLoadFlowInterval {
  sourceIndex: number;

  sourceTimestamp: string;
  timestampUtc: string;

  homeLoadKwh: number;
  solarGenerationKwh: number;

  solarDirectToLoadKwh: number;

  residualHomeLoadKwh: number;
  surplusSolarKwh: number;
}

export interface SolarLoadFlowSummary {
  intervalCount: number;

  totalHomeLoadKwh: number;
  totalSolarGenerationKwh: number;

  totalSolarDirectToLoadKwh: number;
  totalResidualHomeLoadKwh: number;
  totalSurplusSolarKwh: number;

  solarSelfConsumptionPercent: number;
  solarLoadCoveragePercent: number;
}

// ============================================================================
// Surplus Solar to Battery Charging Contracts (Milestone G3B)
// ============================================================================

export interface BatterySocProvenanceState {
  syntheticSocKwh: number;
  gridChargedSocKwh: number;
  renewableChargedSocKwh: number;
  generatorChargedSocKwh: number;
}

export interface SolarBatteryChargeInterval {
  sourceIndex: number;
  sourceTimestamp: string;
  timestampUtc: string;

  residualHomeLoadKwh: number;

  surplusSolarAvailableKwh: number;

  solarToBatteryAcKwh: number;
  renewableEnergyStoredKwh: number;

  remainingSurplusSolarKwh: number;

  batterySocBeforeKwh: number;
  batterySocAfterKwh: number;

  renewableSocBeforeKwh: number;
  renewableSocAfterKwh: number;
}

export interface SolarBatteryChargeResult {
  intervals: SolarBatteryChargeInterval[];

  initialState: BatterySocProvenanceState;
  finalState: BatterySocProvenanceState;

  totalSolarToBatteryAcKwh: number;
  totalRenewableEnergyStoredKwh: number;
  totalRemainingSurplusSolarKwh: number;
}

// ============================================================================
// Battery Load Discharge Contracts (Milestone G3C)
// ============================================================================

export interface BatteryLoadDischargeResult {
  requestedHomeLoadKwh: number;

  batteryDeliveredToLoadKwh: number;
  unmetHomeLoadKwh: number;

  storedEnergyDrainedKwh: number;

  syntheticSocDrainedKwh: number;
  renewableSocDrainedKwh: number;
  generatorSocDrainedKwh: number;
  gridSocDrainedKwh: number;

  batterySocBeforeKwh: number;
  batterySocAfterKwh: number;

  stateBefore: BatterySocProvenanceState;
  stateAfter: BatterySocProvenanceState;
}

// ============================================================================
// Sequential Solar/Battery Flow Kernel Contracts (Milestone G3D)
// ============================================================================

export interface BatteryDischargeDirective {
  sourceIndex: number;
  timestampUtc: string;
  allowBatteryDischargeToLoad: boolean;
}

export interface SequentialBatteryFlowInterval {
  sourceIndex: number;
  sourceTimestamp: string;
  timestampUtc: string;

  homeLoadKwh: number;
  solarGenerationKwh: number;
  solarDirectToLoadKwh: number;

  residualHomeLoadBeforeBatteryKwh: number;
  surplusSolarBeforeBatteryKwh: number;

  dischargeAllowed: boolean;

  solarToBatteryAcKwh: number;
  renewableEnergyStoredKwh: number;

  batteryDeliveredToLoadKwh: number;
  storedEnergyDrainedKwh: number;

  syntheticSocDrainedKwh: number;
  renewableSocDrainedKwh: number;
  generatorSocDrainedKwh: number;
  gridSocDrainedKwh: number;

  residualHomeLoadAfterBatteryKwh: number;
  remainingSurplusSolarKwh: number;

  batterySocBeforeKwh: number;
  batterySocAfterKwh: number;

  stateBefore: BatterySocProvenanceState;
  stateAfter: BatterySocProvenanceState;
}

export interface SequentialBatteryFlowResult {
  intervals: SequentialBatteryFlowInterval[];

  initialState: BatterySocProvenanceState;
  finalState: BatterySocProvenanceState;

  totalSolarToBatteryAcKwh: number;
  totalRenewableEnergyStoredKwh: number;

  totalBatteryDeliveredToLoadKwh: number;
  totalStoredEnergyDrainedKwh: number;

  totalResidualHomeLoadAfterBatteryKwh: number;
  totalRemainingSurplusSolarKwh: number;
}

// ============================================================================
// TOU Battery Dispatch Policy Contracts (Milestones G3E, G3G)
// ============================================================================

export interface BatteryGridChargeDirective {
  sourceIndex: number;
  timestampUtc: string;
  allowGridChargeFromGrid: boolean;
}

export interface BatteryDispatchPolicyInterval
  extends BatteryDischargeDirective,
    BatteryGridChargeDirective {
  dayOfWeek: number;
  hour: number;
  tierId: string;
}

// ============================================================================
// Grid-to-Battery Charging Contracts (Milestone G3F)
// ============================================================================

export interface GridBatteryChargeResult {
  requestedGridChargeAcKwh: number;

  gridToBatteryAcKwh: number;
  gridEnergyStoredKwh: number;
  unfulfilledGridChargeRequestKwh: number;

  batterySocBeforeKwh: number;
  batterySocAfterKwh: number;

  gridSocBeforeKwh: number;
  gridSocAfterKwh: number;

  stateBefore: BatterySocProvenanceState;
  stateAfter: BatterySocProvenanceState;
}

// ============================================================================
// Integrated Sequential Solar/Grid/Battery Flow Contracts (Milestone G3H)
// ============================================================================

export interface IntegratedBatteryFlowInterval {
  sourceIndex: number;
  sourceTimestamp: string;
  timestampUtc: string;
  tierId: string;

  homeLoadKwh: number;
  solarGenerationKwh: number;
  solarDirectToLoadKwh: number;

  residualHomeLoadBeforeBatteryKwh: number;
  surplusSolarBeforeBatteryKwh: number;

  gridChargeAllowed: boolean;
  dischargeAllowed: boolean;

  solarToBatteryAcKwh: number;
  renewableEnergyStoredKwh: number;

  requestedGridChargeAcKwh: number;
  gridToBatteryAcKwh: number;
  gridEnergyStoredKwh: number;

  batteryDeliveredToLoadKwh: number;
  storedEnergyDrainedKwh: number;

  syntheticSocDrainedKwh: number;
  renewableSocDrainedKwh: number;
  generatorSocDrainedKwh: number;
  gridSocDrainedKwh: number;

  residualHomeLoadAfterBatteryKwh: number;
  remainingSurplusSolarKwh: number;

  batterySocBeforeKwh: number;
  batterySocAfterKwh: number;

  stateBefore: BatterySocProvenanceState;
  stateAfter: BatterySocProvenanceState;
}

export interface IntegratedBatteryFlowResult {
  intervals: IntegratedBatteryFlowInterval[];

  initialState: BatterySocProvenanceState;
  finalState: BatterySocProvenanceState;

  totalSolarToBatteryAcKwh: number;
  totalRenewableEnergyStoredKwh: number;

  totalGridToBatteryAcKwh: number;
  totalGridEnergyStoredKwh: number;

  totalBatteryDeliveredToLoadKwh: number;
  totalStoredEnergyDrainedKwh: number;

  totalResidualHomeLoadAfterBatteryKwh: number;
  totalRemainingSurplusSolarKwh: number;
}

// ============================================================================
// Grid Boundary Flow Accounting Contracts (Milestone G3I)
// ============================================================================

export interface GridFlowInterval {
  sourceIndex: number;
  sourceTimestamp: string;
  timestampUtc: string;
  tierId: string;

  residualHomeLoadKwh: number;
  gridBatteryChargeKwh: number;
  remainingSurplusSolarKwh: number;

  gridImportForHomeKwh: number;
  gridImportForBatteryKwh: number;
  totalGridImportKwh: number;

  solarExportKwh: number;
  curtailedSolarKwh: number;
  batteryExportKwh: number;
  totalGridExportKwh: number;
}

export interface GridFlowResult {
  intervals: GridFlowInterval[];

  totalGridImportForHomeKwh: number;
  totalGridImportForBatteryKwh: number;
  totalGridImportKwh: number;

  totalSolarExportKwh: number;
  totalCurtailedSolarKwh: number;
  totalBatteryExportKwh: number;
  totalGridExportKwh: number;
}

// ============================================================================
// TOU / Seasonal Tariff Cost Accounting Contracts (Milestone G3J)
// ============================================================================

export interface TariffCostInterval {
  sourceIndex: number;
  sourceTimestamp: string;
  timestampUtc: string;

  tierId: string;
  tierName: string;
  seasonName?: string;

  localMonth: number; // 0=Jan .. 11=Dec

  buyRate: number;
  sellRate: number;

  homeLoadKwh: number;

  gridImportForHomeKwh: number;
  gridImportForBatteryKwh: number;
  totalGridImportKwh: number;

  solarExportKwh: number;
  batteryExportKwh: number;
  totalGridExportKwh: number;

  baselineCost: number;

  gridImportForHomeCost: number;
  gridImportForBatteryCost: number;
  totalGridImportCost: number;

  solarExportCredit: number;
  batteryExportCredit: number;
  gridExportCredit: number;

  simulatedCost: number;
  netSavings: number;
}

export interface TariffCostResult {
  intervals: TariffCostInterval[];

  baselineCost: number;

  gridImportForHomeCost: number;
  gridImportForBatteryCost: number;
  totalGridImportCost: number;

  solarExportCredit: number;
  batteryExportCredit: number;
  gridExportCredit: number;

  totalSolarExportCredit?: number;
  totalBatteryExportCredit?: number;
  totalGridExportCredit?: number;

  simulatedCost: number;
  netSavings: number;
}

// ============================================================================
// Grid-Charged SOC Acquisition-Cost Basis Contracts (Milestone G3K)
// ============================================================================

export interface GridSocCostBasisState {
  gridStoredEnergyKwh: number;
  totalAcquisitionCostUsd: number;
}

export interface GridSocCostBasisInterval {
  sourceIndex: number;
  sourceTimestamp: string;
  timestampUtc: string;
  tierId: string;

  gridStoredEnergyBeforeKwh: number;
  acquisitionCostBeforeUsd: number;

  gridEnergyStoredKwh: number;
  gridChargeAcquisitionCostUsd: number;

  gridStoredEnergyBeforeDrainKwh: number;
  acquisitionCostBeforeDrainUsd: number;
  averageAcquisitionCostPerStoredKwhBeforeDrain: number;

  gridSocDrainedKwh: number;
  gridSocCostRemovedUsd: number;

  gridStoredEnergyAfterKwh: number;
  acquisitionCostAfterUsd: number;
  averageAcquisitionCostPerStoredKwhAfter: number;
}

export interface GridSocCostBasisResult {
  intervals: GridSocCostBasisInterval[];

  initialState: GridSocCostBasisState;
  finalState: GridSocCostBasisState;

  totalGridChargeAcquisitionCostUsd: number;
  totalGridSocCostRemovedUsd: number;
}

export interface GridSocCostBasisTransitionResult {
  stateBefore: GridSocCostBasisState;

  gridEnergyStoredKwh: number;
  gridChargeAcquisitionCostUsd: number;

  gridStoredEnergyBeforeDrainKwh: number;
  acquisitionCostBeforeDrainUsd: number;
  averageAcquisitionCostPerStoredKwhBeforeDrain: number;

  gridSocDrainedKwh: number;
  gridSocCostRemovedUsd: number;

  stateAfter: GridSocCostBasisState;
  averageAcquisitionCostPerStoredKwhAfter: number;
}

// ============================================================================
// Grid-Charged Battery Export Primitive Contracts (Milestone G3L)
// ============================================================================

export interface GridBatteryExportResult {
  exportAllowed: boolean;
  exportEconomic: boolean;
  sellRate: number;
  averageAcquisitionCostPerStoredKwh: number;
  effectiveDeliveryCostPerAcKwh: number;
  remainingDischargeCapacityAcKwh: number;
  batteryExportAcKwh: number;
  gridSocDrainedForExportKwh: number;
  gridSocCostRemovedForExportUsd: number;
  exportRevenueUsd: number;
  exportGrossMarginUsd: number;
  batteryStateBefore: BatterySocProvenanceState;
  batteryStateAfter: BatterySocProvenanceState;
  costBasisStateBefore: GridSocCostBasisState;
  costBasisStateAfter: GridSocCostBasisState;
}

// ============================================================================
// Reusable Tariff Rate Resolution Contracts (Milestone G3M)
// ============================================================================

export interface TariffRateReferenceInterval {
  sourceIndex: number;
  timestampUtc: string;
  tierId: string;
}

export interface ResolvedTariffRateInterval
  extends TariffRateReferenceInterval {
  tierName: string;
  localMonth: number;
  seasonName?: string;
  buyRate: number;
  sellRate: number;
}

// ============================================================================
// Chronological Grid-SOC Battery Export Integration Contracts (Milestone G3O)
// ============================================================================

export interface ExportAwareBatteryFlowInterval {
  sourceIndex: number;
  sourceTimestamp: string;
  timestampUtc: string;
  tierId: string;

  buyRate: number;
  sellRate: number;

  preExportFlow: IntegratedBatteryFlowInterval;
  integratedBatteryFlow?: IntegratedBatteryFlowInterval;

  gridChargeBranchSelected: boolean;
  gridChargeAcquisitionCostUsd: number;
  costBasisAfterHomeDispatch: GridSocCostBasisState;
  allowBatteryExportInInterval: boolean;

  exportResult: GridBatteryExportResult;
  gridBatteryExport?: GridBatteryExportResult;

  batteryStateAfterExport: BatterySocProvenanceState;
  costBasisStateAfterExport: GridSocCostBasisState;
}

export interface ExportAwareBatteryFlowResult {
  intervals: ExportAwareBatteryFlowInterval[];

  initialBatteryState: BatterySocProvenanceState;
  finalBatteryState: BatterySocProvenanceState;
  initialCostBasisState: GridSocCostBasisState;
  finalCostBasisState: GridSocCostBasisState;

  // Compatibility aliases
  initialState?: BatterySocProvenanceState;
  finalState?: BatterySocProvenanceState;

  totalBatteryExportAcKwh: number;
  totalExportRevenueUsd: number;
  totalExportGrossMarginUsd: number;
  totalGridSocCostRemovedForExportUsd: number;

  batteryExportAcKwh: number;
  exportRevenueUsd: number;
  exportGrossMarginUsd: number;
  gridSocCostRemovedForExportUsd: number;
}

// ============================================================================
// Financial Analysis Routing & Generation Project Cost Contracts (Milestone G4A)
// ============================================================================

export type AnalysisState =
  | 'legacy-financial'
  | 'generation-financial-pending'
  | 'generation-financial'
  | 'partial-period';

export interface SolarAssetMetadata {
  id: string;
  name: string;
  dcCapacityKw: number;
  inverterAcCapacityKw: number;
  annualDegradationPercent: number;
  tiltDegrees?: number;
  azimuthDegrees?: number;
  installedCostUsd?: number;
  annualMaintenanceCostUsd?: number;
}

export interface GenerationAssetCostBreakdown {
  id: string;
  name: string;
  type: 'solar' | 'wind' | 'generator';
  installedCostUsd: number;
  annualMaintenanceCostUsd: number;
}

export interface GenerationTypeCostBreakdown {
  type: 'solar' | 'wind' | 'generator';
  installedCostUsd: number;
  annualMaintenanceCostUsd: number;
  assetCount?: number;
}

export type GenerationTypeCostMap = Record<
  'solar' | 'wind' | 'generator',
  GenerationTypeCostBreakdown
>;

export interface GenerationProjectCostSummary {
  generationCapexUsd: number;
  annualGenerationMaintenanceUsd: number;
  byAsset: GenerationAssetCostBreakdown[];
  byType: GenerationTypeCostBreakdown[] & GenerationTypeCostMap;
  solarMetadata: SolarAssetMetadata[];
}

// ============================================================================
// Multi-Year Generation-Aware Operational Projection Contracts (Milestone G4B)
// ============================================================================

export interface SolarAssetProjectionState {
  assetId: string;
  capacityRetentionFactor: number;
  effectiveDcCapacityKw: number;
}

export interface GenerationOperationalYear {
  year: number;

  baselineElectricityCostUsd: number;
  simulatedElectricityCostUsd: number;
  electricitySavingsUsd: number;

  solarGeneratedKwh: number;
  solarDirectToLoadKwh: number;
  solarToBatteryKwh: number;
  solarExportKwh: number;
  solarCurtailedKwh: number;

  gridImportKwh: number;
  gridExportKwh: number;
  batteryExportKwh: number;

  batteryDischargedKwh: number;
  equivalentFullCycles: number;

  batteryCapacityRetentionFactor: number;
  batteryUsableCapacityKwh: number;

  solarAssets: SolarAssetProjectionState[];
}

export interface GenerationOperationalProjection {
  horizonYears: number;
  years: GenerationOperationalYear[];
}

export type GenerationOperationalProjectionResult = GenerationOperationalYear[] &
  GenerationOperationalProjection;

// ============================================================================
// Generation-Aware Project Financial Engine Contracts (Milestone G4C)
// ============================================================================

export interface GenerationProjectFinancialYear {
  year: number;

  baselineElectricityCostUsd: number;
  modeledProjectElectricityCostUsd: number;
  electricitySavingsUsd: number;

  generationMaintenanceUsd: number;
  replacementExpenseUsd: number;
  annualLoanPaymentUsd: number;
  taxCreditInflowUsd: number;

  netProjectCashFlowUsd: number;
  cumulativeCashFlowUsd: number;

  discountedCashFlowUsd: number;
  cumulativeNpvUsd: number;

  opportunityCostValueUsd: number;

  // Preserved asset health & physical metrics from G4B
  batteryCapacityRetentionFactor?: number;
  batteryUsableCapacityKwh?: number;
  equivalentFullCycles?: number;
  solarGeneratedKwh?: number;
}

export interface GenerationFinancialAnalysis {
  batteryProfile: BatteryProfile;
  operationalProjection: GenerationOperationalProjection;
  projectCosts: GenerationProjectCostSummary;

  horizonYears: number;

  batteryCapexUsd: number;
  generationCapexUsd: number;
  grossProjectCapexUsd: number;

  immediateRebateUsd: number;
  deferredFederalTaxCreditUsd: number;
  incentivesAmountUsd: number;
  netInstalledProjectCostUsd: number;

  upfrontOutOfPocketUsd: number;

  isFinanced: boolean;
  loanPrincipalUsd: number;
  monthlyLoanPaymentUsd: number;
  totalLoanPaymentsUsd: number;
  totalLoanInterestUsd: number;

  annualGenerationMaintenanceUsd: number;

  year1ElectricitySavingsUsd: number;
  year1NetProjectCashFlowUsd: number;

  paybackYears: number | null;
  paybackFormatted: string;

  npvUsd: number;
  irrPercent: number | null;
  lifetimeNetProfitUsd: number;
  lifetimeRoiPercent: number;

  totalProjectCashOutlaysUsd: number;

  opportunityCostVehicleName: string;
  opportunityCostRatePercent: number;
  opportunityCostFutureValueUsd: number;
  opportunityCostProfitUsd: number;
  opportunityCostDiffUsd: number;
  projectOutperformsAlternative: boolean;

  projections: GenerationProjectFinancialYear[];

  // Resilience / VOLL companion metrics
  annualResilienceValueUsd?: number;
  lifetimeResilienceValueUsd?: number;
  npvWithVollUsd?: number;
  lifetimeNetProfitWithVollUsd?: number;
  lifetimeRoiWithVollPercent?: number;
}

export interface GenerationHorizonFinancialSummary {
  horizonYears: number;
  cumulativeCashFlow: number;
  netPresentValue: number;
  cumulativeElectricitySavings: number;
  totalGenerationMaintenance: number;
  totalReplacementExpense: number;
  totalLoanPayments: number;
  taxCreditInflows: number;
  simplePaybackYears: number | null;
  discountedPaybackYears: number | null;
  horizonRoiPercent: number;
  totalProjectCashOutlays?: number;
  opportunityCostFutureValue: number;
  opportunityCostProfit: number;
  opportunityCostDiff: number;
}
