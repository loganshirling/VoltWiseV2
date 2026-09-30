import React, { useState, useMemo } from 'react';
import {
  TrendingUp,
  DollarSign,
  Calendar,
  Zap,
  BatteryCharging,
  ArrowUpRight,
  Download,
  Award,
  Layers,
  CheckCircle2,
  Clock,
  Sparkles,
  Sun,
  Sliders,
  Eye,
  Grid,
  AlertTriangle,
  Percent,
  ShieldCheck,
  Landmark,
  Wrench,
  BatteryLow,
  Activity,
  ArrowRight,
  HelpCircle,
  BarChart3,
  Flame,
  Snowflake,
  FileJson,
} from 'lucide-react';
import {
  BatteryProfile,
  CsvValidationResult,
  MacroFinancials,
  ProfileFinancialAnalysis,
  RateTier,
  TouProfile,
  AnnualSimulationSummary,
  YearProjection,
  IntervalSimulationResult,
  AnalysisState,
  GenerationConfig,
  GenerationFinancialAnalysis,
  GenerationOperationalProjection,
  GenerationProjectCostSummary,
  GenerationHorizonFinancialSummary,
} from '../types/energy';
import { GenerationAwareSimulationResult } from '../utils/generationAwareSimulation';
import {
  deriveGenerationOperationalDisplayMetrics,
  GenerationOperationalDisplayMetrics,
  resolveMultiProfileMatrixState,
  formatSolarDegradationClause,
  formatSolarDegradationSummary,
} from '../utils/generationResults';
import {
  buildExportLlmJson,
  canExportProjectionsJson,
  canExportProjectionsCsv,
  buildGenerationExportLlmJson,
  canExportGenerationProjectionsJson,
} from '../utils/exportJson';
import {
  deriveHorizonFinancialSummary,
  derivePartialPeriodDisplayMetrics,
} from '../utils/simulationEngine';
import {
  deriveAnalysisState,
  deriveGenerationHorizonFinancialSummary,
} from '../utils/generationFinancials';

export interface ResultsAnalyticsTabProps {
  activeAnalysis: ProfileFinancialAnalysis | null;
  allAnalyses: ProfileFinancialAnalysis[];
  activeSimulationSummary?: AnnualSimulationSummary | null;
  allSimulationSummaries?: Record<string, AnnualSimulationSummary>;
  activeProfile?: BatteryProfile;
  setActiveProfileId: (id: string) => void;
  tiers: RateTier[];
  activeTouProfile?: TouProfile;
  financials: MacroFinancials;
  csvResult?: CsvValidationResult | null;
  analysisState?: AnalysisState;

  // G4D Generation props:
  activeGenerationAnalysis?: GenerationFinancialAnalysis | null;
  activeGenerationOperationalProjection?: GenerationOperationalProjection | null;
  activeGenerationAwareResult?: GenerationAwareSimulationResult | null;
  generationProjectCosts?: GenerationProjectCostSummary | null;
  generationAnalysisError?: string | null;

  // G4E Generation export props:
  generationConfig?: GenerationConfig | null;
  allowSolarExport?: boolean;
}

interface ResultsAnalyticsContentProps {
  activeAnalysis: ProfileFinancialAnalysis | null;
  allAnalyses: ProfileFinancialAnalysis[];
  activeSimulationSummary: AnnualSimulationSummary;
  activeProfile: BatteryProfile;
  setActiveProfileId: (id: string) => void;
  tiers: RateTier[];
  activeTouProfile?: TouProfile;
  financials: MacroFinancials;
  csvResult?: CsvValidationResult | null;
  analysisState?: AnalysisState;

  // G4D Generation props:
  activeGenerationAnalysis?: GenerationFinancialAnalysis | null;
  activeGenerationOperationalProjection?: GenerationOperationalProjection | null;
  activeGenerationAwareResult?: GenerationAwareSimulationResult | null;
  generationProjectCosts?: GenerationProjectCostSummary | null;
  generationAnalysisError?: string | null;

  // G4E Generation export props:
  generationConfig?: GenerationConfig | null;
  allowSolarExport?: boolean;
}

const ResultsAnalyticsContent: React.FC<ResultsAnalyticsContentProps> = ({
  activeAnalysis,
  allAnalyses,
  activeSimulationSummary,
  activeProfile,
  setActiveProfileId,
  tiers,
  activeTouProfile,
  financials,
  csvResult,
  analysisState,
  activeGenerationAnalysis,
  activeGenerationOperationalProjection,
  activeGenerationAwareResult,
  generationProjectCosts,
  generationAnalysisError,
  generationConfig,
  allowSolarExport,
}) => {
  const completeness = csvResult?.completeness;
  const isSuitableForAnnual = Boolean(
    completeness ? completeness.isSuitableForAnnualProjection : true
  );
  const currentAnalysisState: AnalysisState =
    analysisState ??
    deriveAnalysisState(
      isSuitableForAnnual,
      activeGenerationAwareResult != null ? 'generation-aware' : 'legacy',
      Boolean(activeGenerationAnalysis)
    );
  const isPartialPeriod = currentAnalysisState === 'partial-period';
  const isGenerationFinancial = currentAnalysisState === 'generation-financial' && activeGenerationAnalysis != null;
  const isGenerationFinancialPending = currentAnalysisState === 'generation-financial-pending';
  const hasLegacyFinancialAnalysis = currentAnalysisState === 'legacy-financial' && activeAnalysis !== null;
  const hasFinancialAnalysis = hasLegacyFinancialAnalysis;
  const isGenerationAware = activeGenerationAwareResult != null;
  const multiProfileMatrixState = resolveMultiProfileMatrixState(currentAnalysisState);

  // Authoritative operational display metrics from G3 simulation
  const generationOperationalMetrics = useMemo<GenerationOperationalDisplayMetrics | null>(() => {
    if (!activeGenerationAwareResult) return null;
    return deriveGenerationOperationalDisplayMetrics(activeGenerationAwareResult);
  }, [activeGenerationAwareResult]);

  // Chart Controls State
  const [projectionHorizon, setProjectionHorizon] = useState<number>(15); // 1 to 25 years

  // Authoritative Horizon Financial Summary for generation projects (Milestone G4C)
  const generationHorizonSummary = useMemo<GenerationHorizonFinancialSummary | null>(() => {
    if (!activeGenerationAnalysis) return null;
    return deriveGenerationHorizonFinancialSummary(activeGenerationAnalysis, projectionHorizon);
  }, [activeGenerationAnalysis, projectionHorizon]);

  // Analysis-backed variables with safe fallbacks
  const isFinanced = isGenerationFinancial && activeGenerationAnalysis
    ? activeGenerationAnalysis.isFinanced
    : activeAnalysis
    ? activeAnalysis.isFinanced
    : Boolean(financials?.isFinanced);

  const discountRatePercent = isGenerationFinancial
    ? (financials?.discountRatePercent ?? 5)
    : activeAnalysis?.discountRatePercent ?? (financials?.discountRatePercent ?? 5);

  const opportunityCostVehicleName = isGenerationFinancial && activeGenerationAnalysis
    ? activeGenerationAnalysis.opportunityCostVehicleName
    : activeAnalysis?.opportunityCostVehicleName ||
      (financials?.opportunityCostVehicle === 'hysa'
        ? 'High-Yield Savings (HYSA)'
        : financials?.opportunityCostVehicle === 'custom'
        ? 'Custom Hurdle Rate'
        : 'S&P 500 Index ETF');

  const replacementYear = activeAnalysis?.replacementYear ?? 10;
  const replacementCostTotal = activeAnalysis?.replacementCostTotal ?? 0;
  const npv = isGenerationFinancial && activeGenerationAnalysis
    ? activeGenerationAnalysis.npvUsd
    : activeAnalysis?.npv ?? 0;
  const lifetimeNetProfit = isGenerationFinancial && activeGenerationAnalysis
    ? activeGenerationAnalysis.lifetimeNetProfitUsd
    : activeAnalysis?.lifetimeNetProfit ?? 0;
  const isNpvNegativeWithPositiveProfit = isGenerationFinancial && activeGenerationAnalysis
    ? activeGenerationAnalysis.lifetimeNetProfitUsd > 0 && activeGenerationAnalysis.npvUsd < 0
    : activeAnalysis?.isNpvNegativeWithPositiveProfit ?? false;

  const [granularity, setGranularity] = useState<'annual' | 'monthly'>('annual');
  const [showBaselineSpend, setShowBaselineSpend] = useState<boolean>(true);
  const [showBatterySpend, setShowBatterySpend] = useState<boolean>(true);
  const [showNetCashFlow, setShowNetCashFlow] = useState<boolean>(true);
  const [showOpportunityCost, setShowOpportunityCost] = useState<boolean>(true);
  const [showNpvCurve, setShowNpvCurve] = useState<boolean>(false);
  const [includeVollInMetrics, setIncludeVollInMetrics] = useState<boolean>(
    financials?.includeVollInRoi || false
  );
  const [hoveredPoint, setHoveredPoint] = useState<any | null>(null);

  // Day selection for 24-hr dispatch explorer (0 to 364)
  const [selectedDayIndex, setSelectedDayIndex] = useState<number>(195);
  const [hoveredHour, setHoveredHour] = useState<number | null>(null);
  const [activeDispatchView, setActiveDispatchView] = useState<'chart' | 'median-month' | 'heatmap' | 'table'>('chart');
  const [hoveredHeatmapCell, setHoveredHeatmapCell] = useState<{
    month: number;
    hour: number;
    avgSoc: number;
    avgLoad: number;
  } | null>(null);

  // Median Daily Power Consumption Controls
  const [showMedianWhiskers, setShowMedianWhiskers] = useState<boolean>(true);
  const [showMonthlyMean, setShowMonthlyMean] = useState<boolean>(true);
  const [showMonthlyBatteryOffset, setShowMonthlyBatteryOffset] = useState<boolean>(true);
  const [hoveredMonthIndex, setHoveredMonthIndex] = useState<number | null>(null);

  // LLM JSON Export Status
  const [hasExportedJson, setHasExportedJson] = useState<boolean>(false);

  // Common data valid in both modes
  const profile = activeAnalysis ? activeAnalysis.profile : activeProfile;
  const annualSummary = activeAnalysis ? activeAnalysis.annualSummary : activeSimulationSummary;

  // Derive genuine observed-period display metrics for partial-period mode
  const partialMetrics = useMemo(() => {
    return derivePartialPeriodDisplayMetrics(profile, annualSummary, completeness);
  }, [profile, annualSummary, completeness]);

  const projections: YearProjection[] = activeAnalysis?.projections ?? [];

  // Extract 24 hours for the selected day from the annual simulation
  const intervalCount = annualSummary.intervalResults.length;
  const daysInDataset = Math.max(1, Math.floor(intervalCount / 24));
  const safeDayIndex = Math.min(selectedDayIndex, daysInDataset - 1);
  const startInterval = safeDayIndex * 24;
  const dayIntervals = annualSummary.intervalResults.slice(startInterval, startInterval + 24);

  // Day metadata
  const firstInterval = dayIntervals[0];
  const dayDateStr = firstInterval?.timestamp?.split(' ')[0] || `Day ${safeDayIndex + 1}`;

  // Quick season preset handlers
  const handleSeasonSelect = (dayIndex: number) => {
    setSelectedDayIndex(Math.min(dayIndex, daysInDataset - 1));
  };

  // Find best performing profile in allAnalyses
  const fastestPaybackProfile = [...allAnalyses]
    .filter((a) => a.paybackYears !== null)
    .sort((a, b) => (a.paybackYears || 99) - (b.paybackYears || 99))[0];

  const highestRoiProfile = [...allAnalyses].sort(
    (a, b) => b.lifetimeRoiPercent - a.lifetimeRoiPercent
  )[0];

  // Authoritative Horizon Financial Summary
  const horizonSummary = useMemo(() => {
    if (!activeAnalysis) return null;
    return deriveHorizonFinancialSummary(activeAnalysis, projectionHorizon);
  }, [activeAnalysis, projectionHorizon]);

  // Horizon Projections Calculation for charting
  const horizonProjections = useMemo(() => {
    return (projections || []).slice(0, projectionHorizon);
  }, [projections, projectionHorizon]);

  const horizonSavings = horizonSummary?.cumulativeSavings ?? 0;
  const horizonNetProfit = horizonSummary?.cumulativeCashFlow ?? 0;
  const horizonNpv = horizonSummary?.netPresentValue ?? 0;
  const horizonRoiPercent = horizonSummary?.horizonRoiPercent ?? 0;

  // Generate multi-year crossover chart points (Annual vs Monthly)
  const chartPoints = useMemo(() => {
    if (!hasFinancialAnalysis || !activeAnalysis) return [];
    const initialBase = activeAnalysis.upfrontOutOfPocket;
    const replacementEnabled = activeAnalysis.replacementEnabled;
    const replacementYear = activeAnalysis.replacementYear;

    if (granularity === 'annual') {
      const pts: any[] = [
        {
          index: 0,
          timeFraction: 0,
          label: 'Year 0 (Start)',
          year: 0,
          month: 0,
          baselineSpend: 0,
          batterySpend: initialBase,
          netCashFlow: -initialBase,
          opportunityCostVal: initialBase,
          discountedNpv: -initialBase,
          usableCapacityKwh: horizonProjections[0]?.usableCapacityKwh || profile.totalCapacityKwh,
          capacityRetention: 100,
        },
      ];

      horizonProjections.forEach((p: YearProjection, idx: number) => {
        // Authoritative annual opportunity-cost benchmark from YearProjection
        const oppVal = Math.round(p.opportunityCostValue);
        pts.push({
          index: idx + 1,
          timeFraction: p.year,
          label: `Year ${p.year}`,
          year: p.year,
          month: p.year * 12,
          baselineSpend: p.cumulativeBaselineSpend,
          batterySpend: p.cumulativeBatterySpend,
          netCashFlow: p.cumulativeCashFlow,
          opportunityCostVal: oppVal,
          discountedNpv: p.cumulativeNpv,
          annualSavings: p.annualSavings,
          usableCapacityKwh: p.usableCapacityKwh,
          capacityRetention: Math.round(p.capacityRetentionFactor * 100),
          isReplacementYear: replacementEnabled && p.year === replacementYear,
        });
      });
      return pts;
    } else {
      // Monthly view: 12 data points per year
      const totalMonths = projectionHorizon * 12;
      const pts: any[] = [
        {
          index: 0,
          timeFraction: 0,
          label: 'Month 0 (Start)',
          year: 0,
          month: 0,
          baselineSpend: 0,
          batterySpend: initialBase,
          netCashFlow: -initialBase,
          opportunityCostVal: initialBase,
          discountedNpv: -initialBase,
          usableCapacityKwh: horizonProjections[0]?.usableCapacityKwh || profile.totalCapacityKwh,
          capacityRetention: 100,
        },
      ];

      for (let m = 1; m <= totalMonths; m++) {
        const y = Math.ceil(m / 12);
        const p = horizonProjections[y - 1];
        if (!p) break;
        const monthInYear = ((m - 1) % 12) + 1;
        const prevBaseline = y > 1 ? horizonProjections[y - 2].cumulativeBaselineSpend : 0;
        const prevBattery = y > 1 ? horizonProjections[y - 2].cumulativeBatterySpend : initialBase;

        const monthlyBaseline = p.baselineCost / 12;
        const monthlyWithBattery = p.withBatteryCost / 12;

        const baselineSpend = Math.round(prevBaseline + monthlyBaseline * monthInYear);
        const batterySpend = Math.round(prevBattery + monthlyWithBattery * monthInYear);
        const netCashFlow = Math.round(baselineSpend - batterySpend);

        // Visual monthly interpolation between authoritative annual year-end opportunity cost endpoints.
        // For Year 1, previous year-end is initial upfront out-of-pocket (Year 0).
        const prevYearOpp = y > 1 ? horizonProjections[y - 2].opportunityCostValue : initialBase;
        const currYearOpp = p.opportunityCostValue;
        const oppVal = Math.round(prevYearOpp + (currYearOpp - prevYearOpp) * (monthInYear / 12));

        pts.push({
          index: m,
          timeFraction: m / 12,
          label: `Yr ${y} M${monthInYear}`,
          year: y,
          month: m,
          monthInYear,
          baselineSpend,
          batterySpend,
          netCashFlow,
          opportunityCostVal: oppVal,
          discountedNpv: p.cumulativeNpv,
          usableCapacityKwh: p.usableCapacityKwh,
          capacityRetention: Math.round(p.capacityRetentionFactor * 100),
          isReplacementYear: replacementEnabled && y === replacementYear && monthInYear === 1,
        });
      }
      return pts;
    }
  }, [hasFinancialAnalysis, activeAnalysis, horizonProjections, projectionHorizon, granularity, profile.totalCapacityKwh]);

  // Export CSV for the active horizon and view
  const handleExportProjectionsCsv = () => {
    if (isPartialPeriod || isGenerationFinancialPending || !activeAnalysis || !canExportProjectionsCsv(activeAnalysis, csvResult)) {
      return;
    }

    const headers = [
      'Timeline_Point',
      'Year',
      'Month',
      'Baseline_Electricity_Spend_USD',
      'Total_Spend_With_Battery_USD',
      'Cumulative_Net_Cash_Flow_USD',
      'Opportunity_Cost_Benchmark_USD',
      'Cumulative_NPV_USD',
      'Usable_Capacity_KWh',
    ];
    const rows = chartPoints.map((p) => [
      p.label,
      p.year,
      p.month || 0,
      p.baselineSpend,
      p.batterySpend,
      p.netCashFlow,
      p.opportunityCostVal || 0,
      p.discountedNpv || 0,
      p.usableCapacityKwh || '',
    ]);
    const csvContent = [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
    const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute(
      'download',
      `${profile.name.replace(/\s+/g, '_')}_${projectionHorizon}yr_${granularity}_projections.csv`
    );
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Export complete analysis structured for LLM analysis & reporting (.json)
  const canExportJson = isGenerationFinancial
    ? Boolean(
        generationConfig &&
        activeGenerationAnalysis &&
        activeGenerationOperationalProjection &&
        activeGenerationAwareResult &&
        generationProjectCosts &&
        canExportGenerationProjectionsJson({
          generationAnalysis: activeGenerationAnalysis,
          operationalProjection: activeGenerationOperationalProjection,
          generationAwareResult: activeGenerationAwareResult,
          generationProjectCosts,
          csvResult,
          analysisState: currentAnalysisState,
        })
      )
    : Boolean(
        !isPartialPeriod &&
        !isGenerationFinancialPending &&
        activeAnalysis &&
        canExportProjectionsJson(activeAnalysis, csvResult)
      );

  const handleExportLlmJson = () => {
    if (!canExportJson) {
      return;
    }

    if (
      isGenerationFinancial &&
      activeGenerationAnalysis &&
      activeGenerationOperationalProjection &&
      activeGenerationAwareResult &&
      generationProjectCosts &&
      generationConfig
    ) {
      const exportPayload = buildGenerationExportLlmJson({
        generationConfig,
        allowSolarExport: Boolean(allowSolarExport),
        generationAwareResult: activeGenerationAwareResult,
        operationalProjection: activeGenerationOperationalProjection,
        generationAnalysis: activeGenerationAnalysis,
        generationProjectCosts,
        projectionHorizon,
        tiers,
        activeTouProfile,
        financials,
        csvResult,
      });

      const jsonString = JSON.stringify(exportPayload, null, 2);
      const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', 'generation_project_analysis_export.json');
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);

      setHasExportedJson(true);
      setTimeout(() => setHasExportedJson(false), 3000);
      return;
    }

    if (isPartialPeriod || isGenerationFinancialPending || !activeAnalysis || !canExportProjectionsJson(activeAnalysis, csvResult)) {
      return;
    }

    const exportPayload = buildExportLlmJson({
      activeAnalysis,
      projectionHorizon,
      tiers,
      activeTouProfile,
      financials,
      csvResult,
    });

    const jsonString = JSON.stringify(exportPayload, null, 2);
    const blob = new Blob([jsonString], { type: 'application/json;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', 'battery_analysis_export.json');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);

    setHasExportedJson(true);
    setTimeout(() => setHasExportedJson(false), 3000);
  };

  // SVG Chart Dimensions for Crossover Chart
  const chartW = 760;
  const chartH = 340;
  const padL = 75;
  const padR = 35;
  const padT = 38;
  const padB = 45;

  // Determine Y-range from enabled visible curves
  const visibleValues: number[] = [];
  if (showNetCashFlow) {
    chartPoints.forEach((p) => visibleValues.push(p.netCashFlow));
    visibleValues.push(0); // Ensure $0 breakeven line is in view
  }
  if (showBaselineSpend) {
    chartPoints.forEach((p) => visibleValues.push(p.baselineSpend));
  }
  if (showBatterySpend) {
    chartPoints.forEach((p) => visibleValues.push(p.batterySpend));
  }
  if (showOpportunityCost) {
    chartPoints.forEach((p) => visibleValues.push(p.opportunityCostVal));
  }
  if (showNpvCurve) {
    chartPoints.forEach((p) => visibleValues.push(p.discountedNpv));
  }
  if (visibleValues.length === 0) {
    visibleValues.push(-(activeAnalysis?.upfrontOutOfPocket ?? 0), 1000);
  }

  const rawMinY = Math.min(...visibleValues);
  const rawMaxY = Math.max(...visibleValues);
  const ySpan = Math.max(500, rawMaxY - rawMinY);
  const minY = rawMinY - ySpan * 0.08;
  const maxY = rawMaxY + ySpan * 0.08;

  const getX = (timeFraction: number) =>
    padL + (timeFraction / projectionHorizon) * (chartW - padL - padR);

  const getY = (val: number) => {
    const range = maxY - minY;
    if (range === 0) return chartH / 2;
    const ratio = (val - minY) / range;
    return chartH - padB - ratio * (chartH - padT - padB);
  };

  const zeroY = getY(0);

  // SVG Paths
  const baselinePathD = chartPoints
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(p.timeFraction)} ${getY(p.baselineSpend)}`)
    .join(' ');

  const batteryPathD = chartPoints
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(p.timeFraction)} ${getY(p.batterySpend)}`)
    .join(' ');

  const cashFlowPathD = chartPoints
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(p.timeFraction)} ${getY(p.netCashFlow)}`)
    .join(' ');

  const oppCostPathD = chartPoints
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(p.timeFraction)} ${getY(p.opportunityCostVal)}`)
    .join(' ');

  const npvPathD = chartPoints
    .map((p, idx) => `${idx === 0 ? 'M' : 'L'} ${getX(p.timeFraction)} ${getY(p.discountedNpv)}`)
    .join(' ');

  // Breakeven crossover coordinates
  const paybackYears = activeAnalysis?.paybackYears ?? null;
  const paybackFormatted = activeAnalysis?.paybackFormatted ?? 'N/A';
  const hasBreakeven = Boolean(
    hasFinancialAnalysis &&
    paybackYears !== null &&
    paybackYears <= projectionHorizon
  );
  const breakevenX = hasBreakeven && paybackYears !== null ? getX(paybackYears) : null;

  // Exact spend at crossover breakeven point (where Baseline Spend = Battery Spend)
  const breakevenSpendVal = hasBreakeven && paybackYears !== null
    ? (() => {
        const yFloor = Math.floor(paybackYears);
        const frac = paybackYears - yFloor;
        const p0 = yFloor === 0 ? { baselineSpend: 0 } : chartPoints.find((p) => p.year === yFloor) || { baselineSpend: 0 };
        const p1 = chartPoints.find((p) => p.year === yFloor + 1) || p0;
        return p0.baselineSpend + (p1.baselineSpend - p0.baselineSpend) * frac;
      })()
    : null;
  const breakevenSpendY = breakevenSpendVal !== null ? getY(breakevenSpendVal) : null;

  // Inverter replacement coordinate
  const hasReplacementInHorizon = Boolean(
    hasFinancialAnalysis &&
    activeAnalysis?.replacementEnabled &&
    activeAnalysis.replacementYear <= projectionHorizon
  );
  const replacementX = hasReplacementInHorizon && activeAnalysis ? getX(activeAnalysis.replacementYear) : null;

  // Collision detection between Inverter Replacement label and Payback label to prevent overlap
  const isCrossoverLabelOverlap = Boolean(
    hasReplacementInHorizon &&
    hasBreakeven &&
    replacementX !== null &&
    breakevenX !== null &&
    Math.abs(replacementX - breakevenX) < 220
  );

  // Generate 5-6 nice horizontal grid line values
  const yTicks = useMemo(() => {
    const ticks: number[] = [0];
    const roughStep = ySpan / 5;
    const magnitude = Math.pow(10, Math.floor(Math.log10(roughStep)));
    const step = Math.ceil(roughStep / magnitude) * magnitude;

    for (let v = step; v <= maxY; v += step) {
      ticks.push(v);
    }
    for (let v = -step; v >= minY; v -= step) {
      ticks.push(v);
    }
    return ticks.sort((a, b) => a - b);
  }, [minY, maxY, ySpan]);

  // X ticks depending on horizon and granularity
  const xTicks = useMemo(() => {
    const ticks: number[] = [];
    const step = projectionHorizon <= 10 ? 1 : projectionHorizon <= 20 ? 2 : 5;
    for (let yr = 0; yr <= projectionHorizon; yr += step) {
      ticks.push(yr);
    }
    if (!ticks.includes(projectionHorizon)) {
      ticks.push(projectionHorizon);
    }
    return ticks;
  }, [projectionHorizon]);

  // Mouse move handler for interactive cursor inspection
  const handleChartMouseMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const mouseX = ((e.clientX - rect.left) / rect.width) * chartW;
    if (mouseX < padL - 10 || mouseX > chartW - padR + 10) {
      setHoveredPoint(null);
      return;
    }
    let closest = chartPoints[0];
    let minDist = Infinity;
    for (const p of chartPoints) {
      const px = getX(p.timeFraction);
      const d = Math.abs(px - mouseX);
      if (d < minDist) {
        minDist = d;
        closest = p;
      }
    }
    setHoveredPoint(closest);
  };

  // 12-Month x 24-Hour Battery SoC Heatmap Calculation
  const heatmapData = useMemo(() => {
    if (!annualSummary || !annualSummary.intervalResults.length) return [];
    const grid = Array.from({ length: 12 }, () =>
      Array.from({ length: 24 }, () => ({
        socSum: 0,
        loadSum: 0,
        count: 0,
      }))
    );

    annualSummary.intervalResults.forEach((interval: IntervalSimulationResult) => {
      const date = new Date(interval.timestamp.replace(' ', 'T'));
      const m = isNaN(date.getMonth()) ? 0 : date.getMonth();
      const h = interval.hour;
      if (m >= 0 && m < 12 && h >= 0 && h < 24) {
        grid[m][h].socSum += interval.batterySocPercent;
        grid[m][h].loadSum += interval.homeLoadKwh;
        grid[m][h].count += 1;
      }
    });

    return grid.map((monthRow) =>
      monthRow.map((cell) => ({
        avgSoc: cell.count > 0 ? Math.round(cell.socSum / cell.count) : 0,
        avgLoad: cell.count > 0 ? Math.round((cell.loadSum / cell.count) * 100) / 100 : 0,
      }))
    );
  }, [annualSummary]);

  const monthNames = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

  // Median Daily Power Consumption Grouped by Month Calculation
  const monthlyConsumptionStats = useMemo(() => {
    if (!annualSummary || !annualSummary.intervalResults || annualSummary.intervalResults.length === 0) {
      return {
        months: [],
        annualMedian: 0,
        annualMean: 0,
        peakMonth: null,
        lowestMonth: null,
        seasonalSwingPercent: 0,
      };
    }

    // 1. Group interval results by calendar day
    const dayMap = new Map<
      string,
      {
        month: number;
        dayIndex: number;
        homeLoadSum: number;
        withBatteryGridSum: number;
        batteryDischargeSum: number;
        intervalsCount: number;
      }
    >();

    annualSummary.intervalResults.forEach((interval: IntervalSimulationResult, idx: number) => {
      let dayKey = '';
      let month = 0;

      if (interval.timestamp) {
        const parts = interval.timestamp.split(' ');
        dayKey = parts[0];

        if (dayKey.includes('-')) {
          const segs = dayKey.split('-');
          if (segs.length >= 2) {
            month = Math.max(0, Math.min(11, parseInt(segs[1], 10) - 1));
          }
        } else if (dayKey.includes('/')) {
          const segs = dayKey.split('/');
          if (segs.length >= 2) {
            month = Math.max(0, Math.min(11, parseInt(segs[0], 10) - 1));
          }
        } else {
          const d = new Date(interval.timestamp.replace(' ', 'T'));
          if (!isNaN(d.getTime())) {
            month = d.getMonth();
          }
        }
      } else {
        const dIdx = Math.floor(idx / 24);
        dayKey = `Day_${dIdx}`;
        month = Math.min(11, Math.floor(dIdx / 30.5));
      }

      const existing = dayMap.get(dayKey);
      if (existing) {
        existing.homeLoadSum += interval.homeLoadKwh;
        existing.withBatteryGridSum += interval.gridImportKwh;
        existing.batteryDischargeSum += interval.batteryDischargeKwh;
        existing.intervalsCount += 1;
      } else {
        dayMap.set(dayKey, {
          month,
          dayIndex: Math.floor(idx / 24),
          homeLoadSum: interval.homeLoadKwh,
          withBatteryGridSum: interval.gridImportKwh,
          batteryDischargeSum: interval.batteryDischargeKwh,
          intervalsCount: 1,
        });
      }
    });

    // 2. Aggregate days into their respective month (0..11)
    const monthDailyLoads: number[][] = Array.from({ length: 12 }, () => []);
    const monthDailyWithBattery: number[][] = Array.from({ length: 12 }, () => []);
    const monthDailyDischarge: number[][] = Array.from({ length: 12 }, () => []);
    const monthFirstDayIndices: number[] = Array.from({ length: 12 }, () => 0);
    const allDailyLoads: number[] = [];

    dayMap.forEach((dayData) => {
      if (dayData.month >= 0 && dayData.month < 12) {
        const dailyLoad =
          dayData.intervalsCount > 0 && dayData.intervalsCount < 24
            ? (dayData.homeLoadSum / dayData.intervalsCount) * 24
            : dayData.homeLoadSum;

        const dailyWithBattery =
          dayData.intervalsCount > 0 && dayData.intervalsCount < 24
            ? (dayData.withBatteryGridSum / dayData.intervalsCount) * 24
            : dayData.withBatteryGridSum;

        const dailyDischarge =
          dayData.intervalsCount > 0 && dayData.intervalsCount < 24
            ? (dayData.batteryDischargeSum / dayData.intervalsCount) * 24
            : dayData.batteryDischargeSum;

        const roundedLoad = Math.round(dailyLoad * 100) / 100;
        monthDailyLoads[dayData.month].push(roundedLoad);
        monthDailyWithBattery[dayData.month].push(Math.round(dailyWithBattery * 100) / 100);
        monthDailyDischarge[dayData.month].push(Math.round(dailyDischarge * 100) / 100);
        allDailyLoads.push(roundedLoad);

        if (monthDailyLoads[dayData.month].length === 1) {
          monthFirstDayIndices[dayData.month] = dayData.dayIndex;
        }
      }
    });

    const calcStats = (vals: number[]) => {
      if (vals.length === 0) {
        return { median: 0, mean: 0, min: 0, max: 0, p25: 0, p75: 0, total: 0, count: 0 };
      }
      const sorted = [...vals].sort((a, b) => a - b);
      const count = sorted.length;
      const sum = sorted.reduce((a, b) => a + b, 0);
      const mean = Math.round((sum / count) * 10) / 10;
      const mid = Math.floor(count / 2);
      const median =
        count % 2 !== 0
          ? sorted[mid]
          : Math.round(((sorted[mid - 1] + sorted[mid]) / 2) * 10) / 10;
      const p25 = sorted[Math.floor(count * 0.25)];
      const p75 = sorted[Math.floor(count * 0.75)];
      const min = sorted[0];
      const max = sorted[count - 1];
      return { median, mean, min, max, p25, p75, total: Math.round(sum), count };
    };

    const monthNamesList = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const fullMonthNames = [
      'January',
      'February',
      'March',
      'April',
      'May',
      'June',
      'July',
      'August',
      'September',
      'October',
      'November',
      'December',
    ];
    const seasons = [
      'Winter',
      'Winter',
      'Spring',
      'Spring',
      'Spring',
      'Summer',
      'Summer',
      'Summer',
      'Autumn',
      'Autumn',
      'Autumn',
      'Winter',
    ];

    const monthsData = monthNamesList.map((name, m) => {
      const loadStats = calcStats(monthDailyLoads[m]);
      const batteryStats = calcStats(monthDailyWithBattery[m]);
      const dischargeStats = calcStats(monthDailyDischarge[m]);
      const repDayIndex = monthFirstDayIndices[m] || Math.min(m * 30 + 15, daysInDataset - 1);

      return {
        monthIndex: m,
        shortName: name,
        fullName: fullMonthNames[m],
        season: seasons[m],
        repDayIndex,
        daysCount: loadStats.count,
        medianDailyKwh: loadStats.median,
        meanDailyKwh: loadStats.mean,
        minDailyKwh: loadStats.min,
        maxDailyKwh: loadStats.max,
        p25DailyKwh: loadStats.p25,
        p75DailyKwh: loadStats.p75,
        totalMonthlyKwh: loadStats.total,
        medianWithBatteryKwh: batteryStats.median,
        medianDischargeKwh: dischargeStats.median,
        reductionPercent:
          loadStats.median > 0
            ? Math.max(0, Math.round(((loadStats.median - batteryStats.median) / loadStats.median) * 100))
            : 0,
      };
    });

    const annualStats = calcStats(allDailyLoads);
    const validMonths = monthsData.filter((m) => m.daysCount > 0);
    const peakMonth =
      validMonths.length > 0
        ? [...validMonths].sort((a, b) => b.medianDailyKwh - a.medianDailyKwh)[0]
        : null;
    const lowestMonth =
      validMonths.length > 0
        ? [...validMonths].sort((a, b) => a.medianDailyKwh - b.medianDailyKwh)[0]
        : null;

    const seasonalSwingPercent =
      lowestMonth && lowestMonth.medianDailyKwh > 0 && peakMonth
        ? Math.round(((peakMonth.medianDailyKwh - lowestMonth.medianDailyKwh) / lowestMonth.medianDailyKwh) * 100)
        : 0;

    return {
      months: monthsData,
      annualMedian: annualStats.median,
      annualMean: annualStats.mean,
      peakMonth,
      lowestMonth,
      seasonalSwingPercent,
    };
  }, [annualSummary, daysInDataset]);

  // Maximum load in day for 24-hour chart scale
  const maxDayLoad = Math.max(
    ...dayIntervals.map((d: IntervalSimulationResult) => Math.max(d.homeLoadKwh, d.batteryChargeKwh, d.batteryDischargeKwh)),
    3.0
  );

  return (
    <div className="space-y-8">
      {/* HEADER BAR */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-800 pb-3">
        <div>
          <h2 className="text-xl font-bold tracking-tight text-white flex items-center gap-2">
            <span className="text-emerald-400 font-mono text-base">04.</span>
            Financial Lifecycle, Asset Health & Resilience Engine
          </h2>
          <p className="text-xs text-slate-400 mt-0.5">
            Tariff: <strong className="text-cyan-400">{activeTouProfile?.name || 'Standard TOU'}</strong> · {isGenerationAware ? (
              <>Project: <strong className="text-emerald-400">{profile.name}</strong> + <strong className="text-amber-300">Solar</strong> · Mode: {isFinanced ? 'Loan Financed' : 'Cash Purchase'}.</>
            ) : (
              <>Battery: <strong className="text-emerald-400">{profile.name}</strong> ({profile.model}) · Mode: {isFinanced ? 'Loan Financed' : 'Cash Purchase'}.</>
            )}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleExportLlmJson}
            disabled={!canExportJson}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold rounded-lg transition-all border whitespace-nowrap shadow-sm ${
              !canExportJson
                ? 'opacity-50 cursor-not-allowed bg-slate-900 text-slate-500 border-slate-800'
                : hasExportedJson
                ? 'bg-emerald-600 text-white border-emerald-400 shadow-emerald-900/50'
                : 'text-emerald-300 bg-emerald-950/70 hover:bg-emerald-900/90 border-emerald-500/50 shadow-emerald-950 hover:border-emerald-400'
            }`}
            title={
              isGenerationFinancial
                ? 'Download clean, pretty-printed generation_project_analysis_export.json formatted for LLM analysis and reporting'
                : isGenerationFinancialPending
                ? 'Generation financial analysis is pending'
                : isPartialPeriod || !activeAnalysis
                ? 'Export disabled for partial-period or incomplete datasets'
                : 'Download clean, pretty-printed battery_analysis_export.json formatted for LLM analysis and reporting'
            }
          >
            {hasExportedJson ? (
              <CheckCircle2 className="h-3.5 w-3.5 text-white" />
            ) : (
              <FileJson className="h-3.5 w-3.5 text-emerald-400" />
            )}
            <span>
              {hasExportedJson
                ? isGenerationFinancial
                  ? 'Exported generation_project_analysis_export.json'
                  : 'Exported battery_analysis_export.json'
                : 'Export Analysis for LLM (.json)'}
            </span>
          </button>

          <button
            onClick={handleExportProjectionsCsv}
            disabled={isPartialPeriod || isGenerationFinancialPending || isGenerationFinancial || !activeAnalysis || !canExportProjectionsCsv(activeAnalysis, csvResult)}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-semibold border rounded-lg transition-colors whitespace-nowrap ${
              isPartialPeriod || isGenerationFinancialPending || isGenerationFinancial || !activeAnalysis || !canExportProjectionsCsv(activeAnalysis, csvResult)
                ? 'opacity-50 cursor-not-allowed bg-slate-900 text-slate-500 border-slate-800'
                : 'text-slate-300 bg-slate-900 hover:bg-slate-800 border-slate-700/80'
            }`}
            title={
              isGenerationFinancial || isGenerationFinancialPending
                ? 'Projections CSV export for generation-integrated projects is out of scope'
                : isPartialPeriod || !activeAnalysis
                ? 'Export disabled for partial-period or incomplete datasets'
                : 'Export Projections CSV'
            }
          >
            <Download className="h-3.5 w-3.5 text-slate-400" />
            <span>Export Projections CSV</span>
          </button>
        </div>
      </div>

      {/* PARTIAL-PERIOD DATASET WARNING BANNER */}
      {isPartialPeriod && (
        <div className="rounded-xl border border-amber-500/50 bg-amber-950/30 p-4 text-xs space-y-2 shadow-sm">
          <div className="flex items-center gap-2 font-bold text-amber-300 uppercase tracking-wider text-[11px]">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>Partial-Period Dataset ({completeness?.durationDays ?? daysInDataset} Days) — Multi-Year Annual Projections Disabled</span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            {completeness?.reason || `Dataset covers only ${completeness?.durationDays ?? daysInDataset} days. Long-term multi-year projections (NPV, IRR, Payback, 15/25-year cumulative cash flows) require approximately one full year (~365 days) of continuous data and have been disabled to prevent inaccurate long-term forecasts.`}
          </p>
          <div className="flex flex-wrap gap-4 text-[11px] font-mono text-amber-300/90 pt-1 border-t border-amber-500/20">
            <span>Observed Span: <strong>{completeness?.durationDays ?? daysInDataset} days</strong></span>
            <span>Intervals: <strong>{completeness?.intervalCount || annualSummary.totalIntervals}</strong> (Expected: {completeness?.expectedIntervalCount})</span>
            {completeness?.startDate && <span>Start: <strong>{completeness.startDate}</strong></span>}
            {completeness?.endDate && <span>End: <strong>{completeness.endDate}</strong></span>}
            <span className="text-amber-400 font-semibold">Exploratory 24h dispatch views remain active below</span>
          </div>
        </div>
      )}

      {/* GENERATION LIFECYCLE FINANCIAL PENDING INFORMATIONAL BANNER */}
      {isGenerationFinancialPending && (
        <div className="rounded-xl border border-sky-500/40 bg-sky-950/20 p-4 text-xs space-y-2 shadow-sm">
          <div className="flex items-center gap-2 font-bold text-sky-300 uppercase tracking-wider text-[11px]">
            <Activity className="h-4 w-4 text-sky-400 shrink-0" />
            <span>Generation-Aware Operational Simulation Active — Lifecycle Financial Analysis Unavailable</span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            {generationAnalysisError || 'Authoritative 8,760-hour generation and dispatch modeling is complete. Year-1 operational energy savings and interval dispatch metrics are fully calculated. Multi-year lifecycle financial modeling is unavailable for the current configuration or run.'}
          </p>
          <div className="flex flex-wrap gap-4 text-[11px] font-mono text-sky-300/90 pt-1 border-t border-sky-500/20">
            <span>Operational Model: <strong>Generation-Aware (8,760h)</strong></span>
            <span>Year-1 Net Savings: <strong>${annualSummary.year1Savings.toLocaleString()}/yr</strong></span>
            <span>Grid Import: <strong>{annualSummary.annualGridImportKwh.toLocaleString()} kWh</strong></span>
            <span>Grid Export: <strong>{annualSummary.annualGridExportKwh.toLocaleString()} kWh</strong></span>
            <span className="text-sky-400 font-semibold">24h dispatch explorer and operational analytics are active below</span>
          </div>
        </div>
      )}

      {/* AUTHORITATIVE GENERATION & GRID DISPATCH OPERATIONAL SUMMARY (MILESTONE G4D) */}
      {generationOperationalMetrics && (
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 space-y-4 shadow-sm">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-800 pb-3">
            <div>
              <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
                <Sun className="h-4 w-4 text-amber-400" />
                <span>Authoritative Generation & Grid Dispatch Operations</span>
                <span className="text-[10px] font-mono font-normal px-2 py-0.5 rounded bg-emerald-950/60 border border-emerald-500/30 text-emerald-300">
                  {isPartialPeriod ? `${partialMetrics.durationDays}-Day Observed Period` : 'Year 1 (8,760 Hours)'}
                </span>
              </h3>
              <p className="text-xs text-slate-400 mt-0.5">
                {isPartialPeriod
                  ? 'Observed energy flows and solar dispatch across the uploaded period. Values represent actual observed totals (not annualized).'
                  : 'Full-year 8,760-hour simulated physical dispatch, direct self-consumption, battery absorption, and grid boundary interactions.'}
              </p>
            </div>
            {isGenerationFinancial && activeGenerationAnalysis ? (
              <div className="text-xs font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2.5 py-1 rounded">
                Net CapEx: ${activeGenerationAnalysis.netInstalledProjectCostUsd.toLocaleString()}
              </div>
            ) : generationProjectCosts ? (
              <div className="text-xs font-mono text-slate-400 bg-slate-950 px-2.5 py-1 rounded border border-slate-800">
                Configured Solar CapEx: ${generationProjectCosts.generationCapexUsd.toLocaleString()}
              </div>
            ) : null}
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {/* Solar Generated */}
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/90 space-y-1">
              <span className="text-[11px] text-slate-400 block">Solar Generated</span>
              <span className="text-lg font-bold font-mono text-amber-300 block tabular-nums">
                {generationOperationalMetrics.solarGeneratedKwh.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 font-sans ml-1">kWh</span>
              </span>
              <span className="text-[10px] text-slate-500 block">Total modeled DC-to-AC</span>
            </div>

            {/* Solar Direct to Load */}
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/90 space-y-1">
              <span className="text-[11px] text-slate-400 block">Solar Direct to Load</span>
              <span className="text-lg font-bold font-mono text-emerald-400 block tabular-nums">
                {generationOperationalMetrics.solarDirectToLoadKwh.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 font-sans ml-1">kWh</span>
              </span>
              <span className="text-[10px] text-slate-500 block">Immediate self-consumption</span>
            </div>

            {/* Solar Sent to Battery */}
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/90 space-y-1">
              <span className="text-[11px] text-slate-400 block">Solar to Battery</span>
              <span className="text-lg font-bold font-mono text-cyan-400 block tabular-nums">
                {generationOperationalMetrics.solarToBatteryAcKwh.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 font-sans ml-1">kWh</span>
              </span>
              <span className="text-[10px] text-slate-500 block">Surplus stored as AC</span>
            </div>

            {/* Solar Exported */}
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/90 space-y-1">
              <span className="text-[11px] text-slate-400 block">Solar Export to Grid</span>
              <span className="text-lg font-bold font-mono text-emerald-300 block tabular-nums">
                {generationOperationalMetrics.solarExportKwh.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 font-sans ml-1">kWh</span>
              </span>
              <span className="text-[10px] text-slate-500 block">Direct solar surplus exported</span>
            </div>

            {/* Battery Exported */}
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/90 space-y-1">
              <span className="text-[11px] text-slate-400 block">Battery Export to Grid</span>
              <span className="text-lg font-bold font-mono text-indigo-300 block tabular-nums">
                {generationOperationalMetrics.batteryExportKwh.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 font-sans ml-1">kWh</span>
              </span>
              <span className="text-[10px] text-slate-500 block">Arbitrage dispatch to grid</span>
            </div>

            {/* Solar Curtailed */}
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800/90 space-y-1">
              <span className="text-[11px] text-slate-400 block">Solar Curtailed</span>
              <span className="text-lg font-bold font-mono text-amber-500 block tabular-nums">
                {generationOperationalMetrics.solarCurtailedKwh.toLocaleString()}
                <span className="text-xs font-normal text-slate-400 font-sans ml-1">kWh</span>
              </span>
              <span className="text-[10px] text-slate-500 block">Inverter/export constrained</span>
            </div>
          </div>

          {/* Grid Flow Accounting Ribbon */}
          <div className="p-3 bg-slate-950/80 rounded-lg border border-slate-800 flex flex-wrap items-center justify-between gap-4 text-xs font-mono">
            <div className="flex flex-wrap items-center gap-4 text-slate-300">
              <span>Home Load: <strong className="text-white">{generationOperationalMetrics.homeLoadKwh.toLocaleString()} kWh</strong></span>
              <span>·</span>
              <span>Grid Import: <strong className="text-rose-400">{generationOperationalMetrics.gridImportKwh.toLocaleString()} kWh</strong></span>
              <span>·</span>
              <span>Total Grid Export: <strong className="text-emerald-400">{generationOperationalMetrics.gridExportKwh.toLocaleString()} kWh</strong></span>
              <span className="text-slate-500 text-[11px]">(Solar: {generationOperationalMetrics.solarExportKwh.toLocaleString()} + Battery: {generationOperationalMetrics.batteryExportKwh.toLocaleString()})</span>
            </div>
            <div className="flex items-center gap-3">
              <span className="text-slate-400">Net Electricity Savings:</span>
              <span className="text-emerald-400 font-bold">
                {isPartialPeriod
                  ? `+$${partialMetrics.periodSavingsUsd.toLocaleString()} (${partialMetrics.durationDays}d)`
                  : `+$${annualSummary.year1Savings.toLocaleString()}/yr`}
              </span>
            </div>
          </div>

          {/* Project Capital Breakdown */}
          {isGenerationFinancial && activeGenerationAnalysis ? (
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 font-mono">
              <div className="flex flex-wrap items-center gap-3">
                <span>Battery CAPEX: <strong className="text-slate-200">${activeGenerationAnalysis.batteryCapexUsd.toLocaleString()}</strong></span>
                <span>·</span>
                <span>Generation CAPEX: <strong className="text-slate-200">${activeGenerationAnalysis.generationCapexUsd.toLocaleString()}</strong></span>
                <span>·</span>
                <span>Gross Project CAPEX: <strong className="text-white">${activeGenerationAnalysis.grossProjectCapexUsd.toLocaleString()}</strong></span>
                <span>·</span>
                <span>Net Installed: <strong className="text-emerald-400">${activeGenerationAnalysis.netInstalledProjectCostUsd.toLocaleString()}</strong></span>
              </div>
              <div>
                <span>Annual Gen O&M: <strong className="text-amber-300">${activeGenerationAnalysis.annualGenerationMaintenanceUsd.toLocaleString()}/yr</strong></span>
              </div>
            </div>
          ) : generationProjectCosts ? (
            <div className="pt-2 border-t border-slate-800/80 flex flex-wrap items-center justify-between gap-3 text-xs text-slate-400 font-mono">
              <div className="flex flex-wrap items-center gap-3">
                <span>Configured Battery Cost: <strong className="text-slate-200">${profile.installedCost.toLocaleString()}</strong></span>
                <span>·</span>
                <span>Configured Generation CAPEX: <strong className="text-slate-200">${generationProjectCosts.generationCapexUsd.toLocaleString()}</strong></span>
                <span>·</span>
                <span>Total Configured CAPEX: <strong className="text-white">${(profile.installedCost + generationProjectCosts.generationCapexUsd).toLocaleString()}</strong></span>
              </div>
              <div>
                <span>Configured Generation O&M: <strong className="text-amber-300">${generationProjectCosts.annualGenerationMaintenanceUsd.toLocaleString()}/yr</strong></span>
              </div>
            </div>
          ) : null}
        </div>
      )}

      {/* TIME VALUE OF MONEY (TVM) WARNING CALLOUT (if nominal profit > 0 but NPV < 0) */}
      {hasFinancialAnalysis && isNpvNegativeWithPositiveProfit && (
        <div className="rounded-xl border border-amber-500/40 bg-amber-950/20 p-4 text-xs space-y-1.5 shadow-sm">
          <div className="flex items-center gap-2 font-bold text-amber-400 uppercase tracking-wider text-[11px]">
            <AlertTriangle className="h-4 w-4 text-amber-400 shrink-0" />
            <span>Time Value of Money (TVM) Alert: Negative 25-Year Net Present Value</span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            While cumulative nominal energy savings yield a positive profit of{' '}
            <strong className="text-emerald-400 font-mono">+${lifetimeNetProfit.toLocaleString()}</strong> over 25 years, discounting future cash flows at your{' '}
            <strong className="text-cyan-300 font-mono">{discountRatePercent}%</strong> discount rate results in a 25-year NPV of{' '}
            <strong className="text-rose-400 font-mono">-${Math.abs(npv).toLocaleString()}</strong>.
            This indicates that when accounting for the opportunity cost of capital, the system returns less than your baseline financial hurdle rate.
          </p>
        </div>
      )}

      {/* WARRANTY RISK CALLOUT (if cycles void warranty before simple payback) */}
      {hasFinancialAnalysis && activeAnalysis && activeAnalysis.isWarrantyVoidedBeforePayback && (
        <div className="rounded-xl border border-rose-500/40 bg-rose-950/20 p-4 text-xs space-y-1.5 shadow-sm">
          <div className="flex items-center gap-2 font-bold text-rose-400 uppercase tracking-wider text-[11px]">
            <AlertTriangle className="h-4 w-4 text-rose-400 shrink-0" />
            <span>Warranty Lifecycle Risk: Cycling Limit Exhausted Prior to Breakeven</span>
          </div>
          <p className="text-slate-300 leading-relaxed">
            At the current cycling rate ({annualSummary.equivalentFullCycles} cycles/year), the manufacturer's{' '}
            <strong className="text-white font-mono">{(activeAnalysis.warrantedCycleLimit ?? profile.ratedCycleLife).toLocaleString()}-cycle</strong> warranted threshold will be exhausted in{' '}
            <strong className="text-rose-400 font-mono">Year {activeAnalysis.warrantedCycleExhaustionYear}</strong>, before the battery reaches simple financial payback ({activeAnalysis.paybackFormatted}).
            Unwarranted operation risk occurs between Year {activeAnalysis.warrantedCycleExhaustionYear} and breakeven.
          </p>
        </div>
      )}

      {/* 4 PRIMARY METRIC SUMMARY CARDS */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Card 1: Capital Outlay / Configured Cost */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span>
              {isGenerationFinancial && activeGenerationAnalysis
                ? (activeGenerationAnalysis.isFinanced ? 'Upfront Down Payment' : 'Net Out-of-Pocket Cost')
                : hasFinancialAnalysis && activeAnalysis
                ? (activeAnalysis.isFinanced ? 'Upfront Down Payment' : 'Net Out-of-Pocket Cost')
                : isGenerationFinancialPending
                ? 'Configured Battery Installed Cost'
                : isGenerationAware
                ? 'Configured Battery Cost'
                : 'Configured Installed Cost'}
            </span>
            <DollarSign className="h-4 w-4 text-emerald-400" />
          </div>
          <div className="text-2xl font-bold text-white font-mono tabular-nums">
            ${isGenerationFinancial && activeGenerationAnalysis
              ? activeGenerationAnalysis.upfrontOutOfPocketUsd.toLocaleString()
              : hasFinancialAnalysis && activeAnalysis
              ? activeAnalysis.upfrontOutOfPocket.toLocaleString()
              : profile.installedCost.toLocaleString()}
          </div>
          <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
            {isGenerationFinancial && activeGenerationAnalysis ? (
              <>
                <span>Net CapEx: ${activeGenerationAnalysis.netInstalledProjectCostUsd.toLocaleString()}</span>
                <span>·</span>
                <span>Gross: ${activeGenerationAnalysis.grossProjectCapexUsd.toLocaleString()}</span>
                <span>·</span>
                <span className={activeGenerationAnalysis.isFinanced ? 'text-indigo-400 font-semibold' : 'text-emerald-400'}>
                  {activeGenerationAnalysis.isFinanced ? 'Financed' : 'Cash'}
                </span>
              </>
            ) : hasFinancialAnalysis && activeAnalysis ? (
              <>
                <span>Net CapEx: ${activeAnalysis.netInstalledCost.toLocaleString()}</span>
                <span>·</span>
                <span className={activeAnalysis.isFinanced ? 'text-indigo-400 font-semibold' : 'text-emerald-400'}>
                  {activeAnalysis.isFinanced ? 'Financed' : 'Cash'}
                </span>
              </>
            ) : isGenerationFinancialPending ? (
              <span className="text-sky-400 font-medium">
                Generation project lifecycle finance unavailable
              </span>
            ) : (
              <span className="text-amber-400 font-medium">
                Financial projection unavailable until annual data is provided
              </span>
            )}
          </div>
        </div>

        {/* Card 2: Savings / Cash Flow */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span>
              {isPartialPeriod
                ? 'Partial-Period Savings'
                : isGenerationFinancial && activeGenerationAnalysis
                ? (activeGenerationAnalysis.isFinanced ? 'Year 1 Project Cash Flow' : 'Year 1 Energy Savings')
                : isGenerationFinancialPending
                ? 'Year 1 Energy Savings'
                : activeAnalysis?.isFinanced
                ? 'Net Monthly Cash Flow'
                : 'Year 1 Energy Savings'}
            </span>
            <Zap className="h-4 w-4 text-emerald-400" />
          </div>
          {isPartialPeriod ? (
            <div>
              <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
                ${partialMetrics.periodSavingsUsd.toLocaleString()}
                <span className="text-xs text-slate-400 font-sans ml-1 font-normal">
                  / {partialMetrics.durationDays} days
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span className="text-amber-400 font-medium">Partial data — not annualized</span>
                <span>·</span>
                <span className="text-emerald-400 font-semibold">-{partialMetrics.savingsPercentage}% period cut</span>
              </div>
            </div>
          ) : isGenerationFinancial && activeGenerationAnalysis ? (
            activeGenerationAnalysis.isFinanced ? (
              <div>
                <div className={`text-2xl font-bold font-mono tabular-nums ${activeGenerationAnalysis.year1NetProjectCashFlowUsd >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {activeGenerationAnalysis.year1NetProjectCashFlowUsd >= 0 ? `+$${activeGenerationAnalysis.year1NetProjectCashFlowUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-$${Math.abs(activeGenerationAnalysis.year1NetProjectCashFlowUsd).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`}
                  <span className="text-xs text-slate-400 font-sans ml-1 font-normal">/year</span>
                </div>
                <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                  <span>Savings: +${activeGenerationAnalysis.year1ElectricitySavingsUsd.toLocaleString()}/yr</span>
                  <span>·</span>
                  <span>Loan: -${(activeGenerationAnalysis.monthlyLoanPaymentUsd * 12).toFixed(0)}/yr</span>
                  <span>·</span>
                  <span>O&M: -${activeGenerationAnalysis.annualGenerationMaintenanceUsd.toLocaleString()}/yr</span>
                </div>
              </div>
            ) : (
              <div>
                <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
                  ${activeGenerationAnalysis.year1ElectricitySavingsUsd.toLocaleString()}
                  <span className="text-xs text-slate-400 font-sans ml-1 font-normal">/year</span>
                </div>
                <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                  <span>Net Cash Flow: ${activeGenerationAnalysis.year1NetProjectCashFlowUsd.toLocaleString()}/yr</span>
                  <span>·</span>
                  <span>O&M: -${activeGenerationAnalysis.annualGenerationMaintenanceUsd.toLocaleString()}/yr</span>
                  <span>·</span>
                  <span className="text-emerald-400 font-semibold">-{annualSummary.savingsPercentage}% bill cut</span>
                </div>
              </div>
            )
          ) : isGenerationFinancialPending ? (
            <div>
              <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
                ${annualSummary.year1Savings.toLocaleString()}
                <span className="text-xs text-slate-400 font-sans ml-1 font-normal">/year</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span className="text-sky-400 font-medium">Authoritative 8,760h operational model</span>
                <span>·</span>
                <span className="text-emerald-400 font-semibold">-{annualSummary.savingsPercentage}% bill cut</span>
              </div>
            </div>
          ) : activeAnalysis?.isFinanced ? (
            <div>
              <div className={`text-2xl font-bold font-mono tabular-nums ${activeAnalysis.isCashFlowPositiveDay1 ? 'text-emerald-400' : 'text-amber-400'}`}>
                {activeAnalysis.netMonthlyCashFlow >= 0 ? `+$${activeAnalysis.netMonthlyCashFlow.toFixed(2)}` : `-$${Math.abs(activeAnalysis.netMonthlyCashFlow).toFixed(2)}`}
                <span className="text-xs text-slate-400 font-sans ml-1 font-normal">/mo</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span>Savings: +${activeAnalysis.monthlyElectricitySavingsYear1.toFixed(0)}</span>
                <span>·</span>
                <span>Loan: -${activeAnalysis.monthlyLoanPayment.toFixed(0)}</span>
              </div>
            </div>
          ) : (
            <div>
              <div className="text-2xl font-bold text-emerald-400 font-mono tabular-nums">
                ${activeAnalysis?.year1Savings.toLocaleString()}
                <span className="text-xs text-slate-400 font-sans ml-1 font-normal">/year</span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span>Monthly: +${activeAnalysis?.monthlyElectricitySavingsYear1.toFixed(0)}/mo</span>
                <span>·</span>
                <span className="text-emerald-400 font-semibold">-{annualSummary.savingsPercentage}% bill cut</span>
              </div>
            </div>
          )}
        </div>

        {/* Card 3: Payback Period & IRR */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span>
              {isGenerationFinancial && activeGenerationAnalysis
                ? 'Project Payback & IRR'
                : hasFinancialAnalysis && activeAnalysis
                ? 'Payback & Internal Rate of Return (IRR)'
                : 'Payback & IRR'}
            </span>
            <Clock className="h-4 w-4 text-amber-400" />
          </div>
          {isGenerationFinancial && activeGenerationAnalysis ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold text-amber-300 font-mono tabular-nums">
                  {generationHorizonSummary?.simplePaybackYears !== null
                    ? activeGenerationAnalysis.paybackFormatted
                    : activeGenerationAnalysis.paybackYears !== null
                    ? `Beyond ${projectionHorizon}-Year Horizon`
                    : activeGenerationAnalysis.paybackFormatted}
                </span>
                <span className="text-xs font-mono font-bold text-cyan-300">
                  {activeGenerationAnalysis.irrPercent !== null ? `25-Year IRR: ${activeGenerationAnalysis.irrPercent}%` : '25-Year IRR: <0%'}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span>Discount Rate: {financials.discountRatePercent}%</span>
                <span>·</span>
                <span>{annualSummary.equivalentFullCycles} cycles/yr</span>
              </div>
            </>
          ) : hasFinancialAnalysis && activeAnalysis ? (
            <>
              <div className="flex items-baseline justify-between">
                <span className="text-2xl font-bold text-amber-300 font-mono tabular-nums">
                  {horizonSummary?.simplePaybackYears !== null
                    ? activeAnalysis.paybackFormatted
                    : activeAnalysis.paybackYears !== null
                    ? `Beyond ${projectionHorizon}-Year Horizon`
                    : activeAnalysis.paybackFormatted}
                </span>
                <span className="text-xs font-mono font-bold text-cyan-300">
                  {activeAnalysis.irrPercent !== null ? `25-Year IRR: ${activeAnalysis.irrPercent}%` : '25-Year IRR: <0%'}
                </span>
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span>Discount Rate: {activeAnalysis.discountRatePercent}%</span>
                <span>·</span>
                <span>{annualSummary.equivalentFullCycles} cycles/yr</span>
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-slate-400 font-mono tabular-nums">
                {isGenerationFinancialPending ? 'Unavailable' : 'Unavailable'}
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span className={isGenerationFinancialPending ? 'text-sky-400 font-medium' : 'text-amber-400 font-medium'}>
                  {isGenerationFinancialPending
                    ? 'Generation lifecycle finance unavailable'
                    : 'Requires approximately one year of suitable data'}
                </span>
              </div>
            </>
          )}
        </div>

        {/* Card 4: Net Present Value (NPV) */}
        <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-4 relative overflow-hidden">
          <div className="flex items-center justify-between text-xs text-slate-400 font-semibold mb-1">
            <span>
              {isGenerationFinancial && activeGenerationAnalysis
                ? `${projectionHorizon}-Year Project NPV`
                : hasFinancialAnalysis && activeAnalysis
                ? `${projectionHorizon}-Year Net Present Value`
                : 'Net Present Value'}
            </span>
            <TrendingUp className="h-4 w-4 text-cyan-400" />
          </div>
          {isGenerationFinancial && activeGenerationAnalysis && generationHorizonSummary ? (
            <>
              <div className={`text-2xl font-bold font-mono tabular-nums ${generationHorizonSummary.netPresentValue >= 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
                {generationHorizonSummary.netPresentValue >= 0 ? `+$${generationHorizonSummary.netPresentValue.toLocaleString()}` : `-$${Math.abs(generationHorizonSummary.netPresentValue).toLocaleString()}`}
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span className="text-slate-300 font-mono">
                  {projectionHorizon}-Year Profit: {generationHorizonSummary.cumulativeCashFlow >= 0 ? `+$${generationHorizonSummary.cumulativeCashFlow.toLocaleString()}` : `-$${Math.abs(generationHorizonSummary.cumulativeCashFlow).toLocaleString()}`}
                </span>
                <span>·</span>
                <span className={generationHorizonSummary.horizonRoiPercent >= 0 ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                  {projectionHorizon}-Year ROI: {generationHorizonSummary.horizonRoiPercent >= 0 ? `+${generationHorizonSummary.horizonRoiPercent}%` : `${generationHorizonSummary.horizonRoiPercent}%`}
                </span>
              </div>
            </>
          ) : hasFinancialAnalysis && activeAnalysis && horizonSummary ? (
            <>
              <div className={`text-2xl font-bold font-mono tabular-nums ${horizonNpv >= 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
                {horizonNpv >= 0 ? `+$${horizonNpv.toLocaleString()}` : `-$${Math.abs(horizonNpv).toLocaleString()}`}
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span className="text-slate-300 font-mono">
                  {projectionHorizon}-Year Profit: {horizonNetProfit >= 0 ? `+$${horizonNetProfit.toLocaleString()}` : `-$${Math.abs(horizonNetProfit).toLocaleString()}`}
                </span>
                <span>·</span>
                <span className={horizonRoiPercent >= 0 ? 'text-emerald-400 font-mono' : 'text-rose-400 font-mono'}>
                  {projectionHorizon}-Year ROI: {horizonRoiPercent >= 0 ? `+${horizonRoiPercent}%` : `${horizonRoiPercent}%`}
                </span>
              </div>
            </>
          ) : (
            <>
              <div className="text-2xl font-bold text-slate-400 font-mono tabular-nums">
                {isGenerationFinancialPending ? 'Unavailable' : 'Unavailable'}
              </div>
              <div className="mt-2 text-[11px] text-slate-400 flex items-center gap-1.5 pt-2 border-t border-slate-800/80">
                <span className={isGenerationFinancialPending ? 'text-sky-400 font-medium' : 'text-amber-400 font-medium'}>
                  {isGenerationFinancialPending
                    ? 'Generation lifecycle finance unavailable'
                    : 'Requires approximately one year of suitable data'}
                </span>
              </div>
            </>
          )}
        </div>
      </div>

      {/* SECONDARY PANELS: GENERATION FINANCIAL PANELS OR LEGACY FINANCIAL PANELS OR OPERATIONAL PANELS */}
      {isGenerationFinancial && activeGenerationAnalysis ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Panel 1: Opportunity Cost Comparison */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <Percent className="h-4 w-4 text-cyan-400" />
                25-Year Opportunity Cost
              </span>
              <span className="text-[10px] font-mono text-slate-400">{activeGenerationAnalysis.opportunityCostRatePercent}%</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Investing committed project cash outlays in {activeGenerationAnalysis.opportunityCostVehicleName} over 25 years:
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Alternative 25-Year Yield:</span>
                <span className="text-white font-bold">${activeGenerationAnalysis.opportunityCostProfitUsd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Project Net Profit:</span>
                <span className="text-emerald-400 font-bold">${activeGenerationAnalysis.lifetimeNetProfitUsd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Project vs Alternative:</span>
                <span className={`font-bold ${activeGenerationAnalysis.opportunityCostDiffUsd >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {activeGenerationAnalysis.opportunityCostDiffUsd >= 0 ? `+$${activeGenerationAnalysis.opportunityCostDiffUsd.toLocaleString()}` : `-$${Math.abs(activeGenerationAnalysis.opportunityCostDiffUsd).toLocaleString()}`}
                </span>
              </div>
            </div>
            <span className={`text-[10px] font-semibold block ${activeGenerationAnalysis.projectOutperformsAlternative ? 'text-emerald-400' : 'text-amber-400'}`}>
              {activeGenerationAnalysis.projectOutperformsAlternative ? '✓ Project outperforms alternative vehicle (25Y)' : 'Project underperforms alternative benchmark (25Y)'}
            </span>
          </div>

          {/* Panel 2: Financing & Debt Service */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <Landmark className="h-4 w-4 text-indigo-400" />
                Financing Cash Flow
              </span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${activeGenerationAnalysis.year1NetProjectCashFlowUsd >= 0 ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' : 'bg-slate-900 text-slate-400'}`}>
                {activeGenerationAnalysis.isFinanced ? (activeGenerationAnalysis.year1NetProjectCashFlowUsd >= 0 ? 'Day 1 Cash+' : 'Net Investment') : 'Cash Buy'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {activeGenerationAnalysis.isFinanced ? `${financials?.loanAprPercent}% APR over ${financials?.loanTermYears} years` : '100% upfront cash purchase'}
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Monthly Bill Savings:</span>
                <span className="text-emerald-400 font-bold">+${(activeGenerationAnalysis.year1ElectricitySavingsUsd / 12).toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Monthly Loan Amortization:</span>
                <span className="text-rose-400 font-bold">-${activeGenerationAnalysis.monthlyLoanPaymentUsd.toFixed(2)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Net Monthly Delta:</span>
                <span className={`font-bold ${(activeGenerationAnalysis.year1NetProjectCashFlowUsd / 12) >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {(activeGenerationAnalysis.year1NetProjectCashFlowUsd / 12) >= 0 ? `+$${(activeGenerationAnalysis.year1NetProjectCashFlowUsd / 12).toFixed(2)}` : `-$${Math.abs(activeGenerationAnalysis.year1NetProjectCashFlowUsd / 12).toFixed(2)}`}
                </span>
              </div>
            </div>
            <span className="text-[10px] text-slate-400 block font-mono">
              {activeGenerationAnalysis.isFinanced ? `Total Interest: $${activeGenerationAnalysis.totalLoanInterestUsd.toLocaleString()}` : 'Zero interest expense'}
            </span>
          </div>

          {/* Panel 3: Project Capital & Generation O&M */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <Wrench className="h-4 w-4 text-amber-400" />
                Project Capital & O&M
              </span>
              <span className="text-[10px] font-mono text-amber-300">O&M: ${activeGenerationAnalysis.annualGenerationMaintenanceUsd}/yr</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Authoritative project capital expenditure & ongoing maintenance:
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Battery CAPEX:</span>
                <span className="text-white font-bold">${activeGenerationAnalysis.batteryCapexUsd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Generation CAPEX:</span>
                <span className="text-amber-300 font-bold">${activeGenerationAnalysis.generationCapexUsd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Gross Project CAPEX:</span>
                <span className="text-cyan-300 font-bold">${activeGenerationAnalysis.grossProjectCapexUsd.toLocaleString()}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Net Installed Project Cost:</span>
                <span className="text-emerald-400 font-bold">${activeGenerationAnalysis.netInstalledProjectCostUsd.toLocaleString()}</span>
              </div>
            </div>
            <span className="text-[10px] text-slate-400 block font-mono">
              Federal Tax Credit: ${activeGenerationAnalysis.deferredFederalTaxCreditUsd.toLocaleString()}
            </span>
          </div>

          {/* Panel 4: Outage Autonomy & Value of Lost Load */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                25-Year Resilience & VOLL
              </span>
              <span className="text-[10px] font-mono text-emerald-400">
                +${Math.round(activeGenerationAnalysis.annualResilienceValueUsd ?? (financials.annualOutageDays * financials.valueOfLostLoadPerDay))}/yr
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              Resilience value based on {financials.criticalLoadPowerKw} kW critical demand at ${financials.valueOfLostLoadPerDay}/day:
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Critical Demand:</span>
                <span className="text-white font-bold">{financials.criticalLoadPowerKw} kW</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Annual VOLL:</span>
                <span className="text-emerald-400 font-bold">+${Math.round(activeGenerationAnalysis.annualResilienceValueUsd ?? (financials.annualOutageDays * financials.valueOfLostLoadPerDay)).toLocaleString()}/yr</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">25-Year Resilience Value:</span>
                <span className="text-cyan-300 font-bold">+${Math.round(activeGenerationAnalysis.lifetimeResilienceValueUsd ?? (financials.annualOutageDays * financials.valueOfLostLoadPerDay * 25)).toLocaleString()}</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Blend VOLL into ROI:</span>
              <button
                onClick={() => setIncludeVollInMetrics(!includeVollInMetrics)}
                className={`px-1.5 py-0.5 rounded font-mono font-semibold transition-colors ${includeVollInMetrics ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' : 'bg-slate-900 text-slate-400 border border-slate-800'}`}
              >
                {includeVollInMetrics ? 'Active (Blended)' : 'Off (Pure Utility)'}
              </button>
            </div>
          </div>
        </div>
      ) : hasFinancialAnalysis && activeAnalysis ? (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {/* Panel 1: Opportunity Cost Comparison */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <Percent className="h-4 w-4 text-cyan-400" />
                25-Year Opportunity Cost
              </span>
              <span className="text-[10px] font-mono text-slate-400">{activeAnalysis.opportunityCostRate}%</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Investing committed cash outlays in {activeAnalysis.opportunityCostVehicleName} over 25 years:
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Alternative 25-Year Yield:</span>
                <span className="text-white font-bold">${activeAnalysis.opportunityCostProfit.toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Battery 25-Year Net Profit:</span>
                <span className="text-emerald-400 font-bold">${activeAnalysis.lifetimeNetProfit.toLocaleString()}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">25-Year Net Delta:</span>
                <span className={`font-bold ${activeAnalysis.opportunityCostDiff >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {activeAnalysis.opportunityCostDiff >= 0 ? `+$${activeAnalysis.opportunityCostDiff.toLocaleString()}` : `-$${Math.abs(activeAnalysis.opportunityCostDiff).toLocaleString()}`}
                </span>
              </div>
            </div>
            <span className={`text-[10px] font-semibold block ${activeAnalysis.batteryOutperformsAlternative ? 'text-emerald-400' : 'text-amber-400'}`}>
              {activeAnalysis.batteryOutperformsAlternative ? '✓ Battery outperforms market vehicle (25Y)' : 'Underperforms baseline index asset (25Y)'}
            </span>
          </div>

          {/* Panel 2: Financing & Debt Service */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <Landmark className="h-4 w-4 text-indigo-400" />
                Financing Cash Flow
              </span>
              <span className={`text-[10px] font-mono px-1.5 py-0.5 rounded ${activeAnalysis.isCashFlowPositiveDay1 ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/30' : 'bg-slate-900 text-slate-400'}`}>
                {activeAnalysis.isFinanced ? (activeAnalysis.isCashFlowPositiveDay1 ? 'Day 1 Cash+' : 'Net Investment') : 'Cash Buy'}
              </span>
            </div>
            <p className="text-[11px] text-slate-400">
              {activeAnalysis.isFinanced ? `${financials?.loanAprPercent}% APR over ${financials?.loanTermYears} years` : '100% upfront cash purchase'}
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Monthly Bill Savings:</span>
                <span className="text-emerald-400 font-bold">+${activeAnalysis.monthlyElectricitySavingsYear1.toFixed(2)}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Monthly Loan Amortization:</span>
                <span className="text-rose-400 font-bold">-${activeAnalysis.monthlyLoanPayment.toFixed(2)}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Net Monthly Delta:</span>
                <span className={`font-bold ${activeAnalysis.netMonthlyCashFlow >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                  {activeAnalysis.netMonthlyCashFlow >= 0 ? `+$${activeAnalysis.netMonthlyCashFlow.toFixed(2)}` : `-$${Math.abs(activeAnalysis.netMonthlyCashFlow).toFixed(2)}`}
                </span>
              </div>
            </div>
            <span className="text-[10px] text-slate-400 block font-mono">
              {activeAnalysis.isFinanced ? `Total Interest: $${activeAnalysis.totalLoanInterestPaid.toLocaleString()}` : 'Zero interest expense'}
            </span>
          </div>

          {/* Panel 3: Asset Health, Warranty & LCOS */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <BatteryLow className="h-4 w-4 text-amber-400" />
                25-Year Health, Warranty & LCOS
              </span>
              <span className="text-[10px] font-mono text-amber-300">25y LCOS: ${activeAnalysis.lcosPerKwh}/kWh</span>
            </div>
            <p className="text-[11px] text-slate-400">
              25-Year degradation fade & manufacturer warranty tracking:
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Year 25 End-of-Life SoH:</span>
                <span className="text-cyan-300 font-bold">{activeAnalysis.endOfLifeSohPercent}% ({activeAnalysis.remainingUsableCapacityKwh} kWh)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Warranted Cycles:</span>
                <span className="text-slate-300 font-bold">{activeAnalysis.warrantedCycleLimit.toLocaleString()} cycles</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Cycle Exhaustion:</span>
                <span className={activeAnalysis.warrantedCycleExhaustionYear ? 'text-amber-300 font-bold' : 'text-emerald-400 font-bold'}>
                  {activeAnalysis.warrantedCycleExhaustionYear ? `Year ${activeAnalysis.warrantedCycleExhaustionYear}` : '>25 Years'}
                </span>
              </div>
            </div>
            <span className="text-[10px] text-slate-400 block font-mono">
              Discharged: {activeAnalysis.totalLifetimeDischargedKwh.toLocaleString()} 25-year kWh
            </span>
          </div>

          {/* Panel 4: Outage Autonomy & Value of Lost Load */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <ShieldCheck className="h-4 w-4 text-emerald-400" />
                25-Year Resilience & VOLL
              </span>
              <span className="text-[10px] font-mono text-emerald-400">+{activeAnalysis.outageAutonomyHours}h Autonomy</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Blackout protection at {activeAnalysis.criticalLoadPowerKw} kW critical demand:
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Backup Duration:</span>
                <span className="text-amber-300 font-bold">{activeAnalysis.outageAutonomyHours}h ({activeAnalysis.outageAutonomyDays} days)</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Annual VOLL:</span>
                <span className="text-emerald-400 font-bold">+${activeAnalysis.annualResilienceValue}/yr</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">25-Year Resilience Value:</span>
                <span className="text-cyan-300 font-bold">+${activeAnalysis.lifetimeResilienceValue.toLocaleString()}</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[10px]">
              <span className="text-slate-400">Blend VOLL into ROI:</span>
              <button
                onClick={() => setIncludeVollInMetrics(!includeVollInMetrics)}
                className={`px-1.5 py-0.5 rounded font-mono font-semibold transition-colors ${includeVollInMetrics ? 'bg-emerald-950 text-emerald-300 border border-emerald-500/40' : 'bg-slate-900 text-slate-400 border border-slate-800'}`}
              >
                {includeVollInMetrics ? 'Active (Blended)' : 'Off (Pure Utility)'}
              </button>
            </div>
          </div>
        </div>
      ) : isGenerationFinancialPending ? (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Panel A: Operational Year 1 Energy Costs */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-emerald-400" />
                Year 1 Operational Energy Costs
              </span>
              <span className="text-[10px] font-mono text-sky-400">Full-Year 8,760h Simulation</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Simulated electricity spend and operational savings with on-site generation and battery dispatch:
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Baseline Annual Cost:</span>
                <span className="text-white font-bold">${annualSummary.baselineAnnualCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">With Generation & Battery:</span>
                <span className="text-cyan-300 font-bold">${annualSummary.simulatedAnnualCost.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Year 1 Operational Savings:</span>
                <span className="text-emerald-400 font-bold">+${annualSummary.year1Savings.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] pt-0.5">
              <span className="text-slate-400">Net Electricity Bill Reduction:</span>
              <span className="font-bold text-emerald-400 font-mono">-{annualSummary.savingsPercentage}% cut</span>
            </div>
          </div>

          {/* Panel B: Battery & Generation Operation */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <BatteryCharging className="h-4 w-4 text-cyan-400" />
                Battery & Generation Operation — Annual Model
              </span>
              <span className="text-[10px] font-mono text-cyan-300">8,760 Hours</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Authoritative dispatch throughput, load offset, and grid interaction over Year 1:
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Total Home Load:</span>
                <span className="text-white font-bold">{annualSummary.totalHomeLoadKwh.toLocaleString()} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Grid Import:</span>
                <span className="text-slate-200 font-bold">{annualSummary.annualGridImportKwh.toLocaleString()} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Grid Export:</span>
                <span className="text-slate-200 font-bold">{annualSummary.annualGridExportKwh.toLocaleString()} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Battery Discharged:</span>
                <span className="text-cyan-300 font-bold">{annualSummary.annualBatteryDischargedKwh.toLocaleString()} kWh</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Equivalent Cycles:</span>
                <span className="text-emerald-400 font-bold">{annualSummary.equivalentFullCycles} cycles/yr</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Peak Demand:</span>
                <span className="text-amber-300 font-bold">{annualSummary.maxPeakDemandKw} kW</span>
              </div>
            </div>
            <span className="text-[10px] text-slate-400 block font-mono">
              Operational results active · Lifecycle analysis unavailable for the current configuration/run
            </span>
          </div>
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Panel A: Observed Period Energy Costs */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <DollarSign className="h-4 w-4 text-emerald-400" />
                Observed Period Energy Costs
              </span>
              <span className="text-[10px] font-mono text-emerald-400">{partialMetrics.durationDays} Days Observed</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Actual electricity spending and bill reduction across the {partialMetrics.durationDays}-day uploaded dataset:
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Baseline Cost:</span>
                <span className="text-white font-bold">${partialMetrics.baselinePeriodCostUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">
                  {isGenerationAware ? 'Modeled Project Electricity Cost:' : 'With Battery:'}
                </span>
                <span className="text-cyan-300 font-bold">${partialMetrics.simulatedPeriodCostUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Observed Savings:</span>
                <span className="text-emerald-400 font-bold">+${partialMetrics.periodSavingsUsd.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            </div>
            <div className="flex items-center justify-between text-[11px] pt-0.5">
              <span className="text-slate-400">Net Period Bill Reduction:</span>
              <span className="font-bold text-emerald-400 font-mono">-{partialMetrics.savingsPercentage}% cut</span>
            </div>
          </div>

          {/* Panel B: Observed Battery Operation */}
          <div className="rounded-xl border border-slate-800 bg-slate-950/70 p-4 space-y-2.5">
            <div className="flex items-center justify-between text-xs font-bold uppercase tracking-wider text-slate-300">
              <span className="flex items-center gap-1.5">
                <BatteryCharging className="h-4 w-4 text-cyan-400" />
                {isGenerationAware
                  ? 'Battery & Generation Operation — Observed Period'
                  : 'Battery Operation — Observed Period'}
              </span>
              <span className="text-[10px] font-mono text-cyan-300">{partialMetrics.durationDays} Days</span>
            </div>
            <p className="text-[11px] text-slate-400">
              {isGenerationAware
                ? `Simulated battery and generation activity over the ${partialMetrics.durationDays}-day period:`
                : `Simulated battery activity and energy throughput over the ${partialMetrics.durationDays}-day period:`}
            </p>
            <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 space-y-1 text-xs font-mono">
              <div className="flex justify-between">
                <span className="text-slate-400">Total Home Load:</span>
                <span className="text-white font-bold">{partialMetrics.totalHomeLoadKwh.toLocaleString()} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">
                  {isGenerationAware ? 'Modeled Project Grid Import:' : 'Grid Import:'}
                </span>
                <span className="text-slate-200 font-bold">{partialMetrics.gridImportKwh.toLocaleString()} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Grid Export:</span>
                <span className="text-slate-200 font-bold">{partialMetrics.gridExportKwh.toLocaleString()} kWh</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Battery Discharged:</span>
                <span className="text-cyan-300 font-bold">{partialMetrics.batteryDischargedKwh.toLocaleString()} kWh</span>
              </div>
              <div className="flex justify-between pt-1 border-t border-slate-800">
                <span className="text-slate-400">Equivalent Cycles:</span>
                <span className="text-emerald-400 font-bold">{partialMetrics.equivalentFullCycles} cycles</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-400">Peak Demand:</span>
                <span className="text-amber-300 font-bold">{partialMetrics.peakDemandKw} kW</span>
              </div>
            </div>
            <span className="text-[10px] text-slate-400 block font-mono">
              Observed throughput over {partialMetrics.durationDays} days · Long-term degradation and LCOS require annual dataset
            </span>
          </div>
        </div>
      )}

      {/* VISUALIZATION 1: INTERACTIVE CROSSOVER CHART WITH LEFT-SIDE CONTROL PANEL */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <TrendingUp className="h-4 w-4 text-emerald-400" />
              {isGenerationFinancial
                ? 'Generation Project Multi-Year Lifecycle Analytics'
                : 'Interactive Multi-Year Crossover & Payback Chart'}
            </h3>
            <p className="text-xs text-slate-400">
              {isGenerationFinancial
                ? '25-year authoritative physical and economic simulation of solar generation, battery degradation, tariff escalation, and cash flows.'
                : 'Interactive financial simulation modeling cumulative electricity expenditure, battery investment, debt service, inverter maintenance, and breakeven crossover.'}
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2 text-xs">
            {isGenerationFinancial && activeGenerationAnalysis && (
              <div className="px-2.5 py-1 rounded-md bg-emerald-500/10 border border-emerald-500/30 text-emerald-300 font-semibold font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>Project Payback: {activeGenerationAnalysis.paybackFormatted}</span>
              </div>
            )}
            {hasFinancialAnalysis && activeAnalysis && hasBreakeven && (
              <div className="px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/30 text-amber-300 font-semibold font-mono flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-400 animate-pulse" />
                <span>Crossover Breakeven: {activeAnalysis.paybackFormatted}</span>
              </div>
            )}
            {hasFinancialAnalysis && activeAnalysis && hasReplacementInHorizon && (
              <div className="px-2.5 py-1 rounded-md bg-amber-500/10 border border-amber-500/20 text-amber-400 text-xs font-mono">
                Yr {activeAnalysis.replacementYear} Inverter Reserve: -${activeAnalysis.replacementCostTotal.toLocaleString()}
              </div>
            )}
          </div>
        </div>

        {isPartialPeriod && (
          <div className="rounded-xl border border-amber-500/40 bg-amber-950/30 p-5 text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-amber-300 font-bold text-sm">
              <AlertTriangle className="h-5 w-5 text-amber-400" />
              <span>Multi-Year Financial Projections Disabled for Incomplete Dataset</span>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl mx-auto leading-relaxed">
              The uploaded dataset spans {completeness?.durationDays ?? daysInDataset} days. Long-term multi-year projections (cumulative cash flows, NPV, simple and discounted payback) require approximately one full year (~365 days) of continuous data and have been disabled to prevent misleading annual forecasts.
            </p>
            <p className="text-[11px] text-amber-400/90 font-mono">
              Please upload a complete 365-day (8,760-hour) dataset to view multi-year financial projections. Exploratory 24-hour dispatch and median daily load charts below remain fully functional.
            </p>
          </div>
        )}

        {isGenerationFinancialPending && (
          <div className="rounded-xl border border-sky-500/40 bg-sky-950/20 p-5 text-center space-y-2">
            <div className="flex items-center justify-center gap-2 text-sky-300 font-bold text-sm">
              <Activity className="h-5 w-5 text-sky-400" />
              <span>Multi-Year Financial Projections Unavailable</span>
            </div>
            <p className="text-xs text-slate-300 max-w-2xl mx-auto leading-relaxed">
              Multi-year cash flow projections, cumulative spend crossover, and lifecycle metrics for generation-integrated systems are unavailable for the current configuration.
            </p>
            <p className="text-[11px] text-sky-400/90 font-mono">
              Year-1 operational dispatch results, 24-hour interval profiles, and median load analytics below remain fully active.
            </p>
          </div>
        )}

        {/* GENERATION PROJECT MULTI-YEAR LIFECYCLE ANALYTICS (MILESTONE G4D) */}
        {isGenerationFinancial && activeGenerationAnalysis && generationHorizonSummary && (
          <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
            {/* LEFT-SIDE CONTROL PANEL */}
            <div className="lg:col-span-4 xl:col-span-3 space-y-5 bg-slate-950/80 p-4 rounded-xl border border-slate-800/90 text-xs">
              <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                  <Sliders className="h-3.5 w-3.5 text-emerald-400" />
                  Horizon Controls
                </span>
                <span className="text-[10px] text-slate-400 font-mono">1–25 Yrs</span>
              </div>

              {/* 1. Projection Horizon Selector */}
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <label className="text-slate-300 font-medium">Projection Horizon</label>
                  <span className="font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                    {projectionHorizon} Years
                  </span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="25"
                  step="1"
                  value={projectionHorizon}
                  onChange={(e) => setProjectionHorizon(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-500 cursor-pointer"
                />
                {/* Quick Presets */}
                <div className="flex items-center justify-between gap-1 pt-1">
                  {[5, 10, 15, 20, 25].map((yr) => (
                    <button
                      key={yr}
                      onClick={() => setProjectionHorizon(yr)}
                      className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                        projectionHorizon === yr
                          ? 'bg-emerald-500 text-slate-950 font-bold'
                          : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                      }`}
                    >
                      {yr}Y
                    </button>
                  ))}
                </div>
              </div>

              {/* Lifecycle Modeling Assumptions Note */}
              <div className="pt-2 border-t border-slate-800/80 space-y-2">
                <span className="text-slate-300 font-medium block">Lifecycle Model</span>
                <div className="p-2.5 bg-slate-900 rounded-lg border border-slate-800 text-[11px] space-y-1.5 text-slate-400 leading-relaxed">
                  <p>
                    <strong className="text-slate-200">Annual Physical Simulations:</strong> Modeled with {formatSolarDegradationClause(generationProjectCosts?.solarMetadata)}, electrochemical battery capacity fade ({financials?.annualBatteryDegradationRate ?? 2}%/yr), and compound tariff escalation ({financials?.annualElectricityInflationRate ?? 3}%/yr).
                  </p>
                  <p className="text-[10px] text-slate-500 font-mono pt-1 border-t border-slate-800">
                    Authoritative Year 1–25 physical evolution
                  </p>
                </div>
              </div>
            </div>

            {/* RIGHT-SIDE CONTENT: KPI BADGES & ANNUAL PROJECT LIFECYCLE TABLE */}
            <div className="lg:col-span-8 xl:col-span-9 space-y-4">
              {/* Selected Horizon KPI Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-3 xl:grid-cols-6 gap-2.5">
                <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-0.5">
                  <span className="text-[10px] text-slate-400 block">{projectionHorizon}Y Net Cash Flow</span>
                  <span className={`text-base font-bold font-mono block tabular-nums ${generationHorizonSummary.cumulativeCashFlow >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {generationHorizonSummary.cumulativeCashFlow >= 0 ? `+$${generationHorizonSummary.cumulativeCashFlow.toLocaleString()}` : `-$${Math.abs(generationHorizonSummary.cumulativeCashFlow).toLocaleString()}`}
                  </span>
                </div>
                <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-0.5">
                  <span className="text-[10px] text-slate-400 block">{projectionHorizon}Y Net Present Value</span>
                  <span className={`text-base font-bold font-mono block tabular-nums ${generationHorizonSummary.netPresentValue >= 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
                    {generationHorizonSummary.netPresentValue >= 0 ? `+$${generationHorizonSummary.netPresentValue.toLocaleString()}` : `-$${Math.abs(generationHorizonSummary.netPresentValue).toLocaleString()}`}
                  </span>
                </div>
                <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-0.5">
                  <span className="text-[10px] text-slate-400 block">{projectionHorizon}Y Bill Savings</span>
                  <span className="text-base font-bold font-mono text-emerald-400 block tabular-nums">
                    +${generationHorizonSummary.cumulativeElectricitySavings.toLocaleString()}
                  </span>
                </div>
                <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-0.5">
                  <span className="text-[10px] text-slate-400 block">{projectionHorizon}Y ROI</span>
                  <span className={`text-base font-bold font-mono block tabular-nums ${generationHorizonSummary.horizonRoiPercent >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {generationHorizonSummary.horizonRoiPercent >= 0 ? `+${generationHorizonSummary.horizonRoiPercent}%` : `${generationHorizonSummary.horizonRoiPercent}%`}
                  </span>
                </div>
                <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-0.5">
                  <span className="text-[10px] text-slate-400 block">Simple Payback</span>
                  <span className="text-base font-bold font-mono text-amber-300 block tabular-nums">
                    {generationHorizonSummary.simplePaybackYears !== null
                      ? activeGenerationAnalysis.paybackFormatted
                      : 'Beyond Horizon'}
                  </span>
                </div>
                <div className="p-2.5 bg-slate-950 rounded-lg border border-slate-800 space-y-0.5">
                  <span className="text-[10px] text-slate-400 block">vs Alternative</span>
                  <span className={`text-base font-bold font-mono block tabular-nums ${generationHorizonSummary.opportunityCostDiff >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                    {generationHorizonSummary.opportunityCostDiff >= 0 ? `+$${generationHorizonSummary.opportunityCostDiff.toLocaleString()}` : `-$${Math.abs(generationHorizonSummary.opportunityCostDiff).toLocaleString()}`}
                  </span>
                </div>
              </div>

              {/* Compact Annual Project Lifecycle Table */}
              <div className="overflow-x-auto rounded-lg border border-slate-800 max-h-96">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Year</th>
                      <th className="py-2.5 px-3 text-right text-amber-300">Solar Gen</th>
                      <th className="py-2.5 px-3 text-right">Grid Import</th>
                      <th className="py-2.5 px-3 text-right text-emerald-300">Solar Export</th>
                      <th className="py-2.5 px-3 text-right text-indigo-300">Battery Export</th>
                      <th className="py-2.5 px-3 text-right text-emerald-400">Bill Savings</th>
                      <th className="py-2.5 px-3 text-right text-amber-400">Gen O&M</th>
                      <th className="py-2.5 px-3 text-right">Net Cash Flow</th>
                      <th className="py-2.5 px-3 text-right text-emerald-400">Cumul. Cash</th>
                      <th className="py-2.5 px-3 text-right text-cyan-300">Cumul. NPV</th>
                      <th className="py-2.5 px-3 text-right">Battery Usable</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 text-slate-300">
                    {activeGenerationAnalysis.projections.slice(0, projectionHorizon).map((p, idx) => {
                      const opYear = activeGenerationOperationalProjection?.years[idx];
                      const solarGen = opYear ? opYear.solarGeneratedKwh : (p.solarGeneratedKwh ?? 0);
                      const gridImport = opYear ? opYear.gridImportKwh : 0;
                      const solarExport = opYear ? opYear.solarExportKwh : 0;
                      const batteryExport = opYear ? opYear.batteryExportKwh : 0;
                      const usableCap = p.batteryUsableCapacityKwh != null
                        ? `${p.batteryUsableCapacityKwh.toFixed(1)} kWh`
                        : opYear
                        ? `${opYear.batteryUsableCapacityKwh.toFixed(1)} kWh`
                        : '—';
                      const retention = p.batteryCapacityRetentionFactor != null
                        ? `${Math.round(p.batteryCapacityRetentionFactor * 100)}%`
                        : opYear
                        ? `${Math.round(opYear.batteryCapacityRetentionFactor * 100)}%`
                        : '';

                      return (
                        <tr key={p.year} className="hover:bg-slate-800/50 transition-colors">
                          <td className="py-2 px-3 font-bold text-white">Year {p.year}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-amber-300">{Math.round(solarGen).toLocaleString()} kWh</td>
                          <td className="py-2 px-3 text-right tabular-nums text-slate-300">{Math.round(gridImport).toLocaleString()} kWh</td>
                          <td className="py-2 px-3 text-right tabular-nums text-emerald-300">{Math.round(solarExport).toLocaleString()} kWh</td>
                          <td className="py-2 px-3 text-right tabular-nums text-indigo-300">{Math.round(batteryExport).toLocaleString()} kWh</td>
                          <td className="py-2 px-3 text-right tabular-nums text-emerald-400">+${Math.round(p.electricitySavingsUsd).toLocaleString()}</td>
                          <td className="py-2 px-3 text-right tabular-nums text-amber-400">-${Math.round(p.generationMaintenanceUsd).toLocaleString()}</td>
                          <td className={`py-2 px-3 text-right tabular-nums font-semibold ${p.netProjectCashFlowUsd >= 0 ? 'text-emerald-400' : 'text-amber-400'}`}>
                            {p.netProjectCashFlowUsd >= 0 ? `+$${Math.round(p.netProjectCashFlowUsd).toLocaleString()}` : `-$${Math.round(Math.abs(p.netProjectCashFlowUsd)).toLocaleString()}`}
                          </td>
                          <td className={`py-2 px-3 text-right tabular-nums font-bold ${p.cumulativeCashFlowUsd >= 0 ? 'text-emerald-400' : 'text-slate-400'}`}>
                            {p.cumulativeCashFlowUsd >= 0 ? `+$${Math.round(p.cumulativeCashFlowUsd).toLocaleString()}` : `-$${Math.round(Math.abs(p.cumulativeCashFlowUsd)).toLocaleString()}`}
                          </td>
                          <td className={`py-2 px-3 text-right tabular-nums font-bold ${p.cumulativeNpvUsd >= 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
                            {p.cumulativeNpvUsd >= 0 ? `+$${Math.round(p.cumulativeNpvUsd).toLocaleString()}` : `-$${Math.round(Math.abs(p.cumulativeNpvUsd)).toLocaleString()}`}
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-slate-400">
                            {usableCap} <span className="text-[10px] text-slate-500">({retention})</span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 2-COLUMN LAYOUT: LEFT-SIDE CONTROLS + RIGHT-SIDE CHART */}
        {hasFinancialAnalysis && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
          {/* LEFT-SIDE CONTROL PANEL */}
          <div className="lg:col-span-4 xl:col-span-3 space-y-5 bg-slate-950/80 p-4 rounded-xl border border-slate-800/90 text-xs">
            <div className="flex items-center justify-between pb-2 border-b border-slate-800">
              <span className="font-bold text-slate-200 uppercase tracking-wider text-[11px] flex items-center gap-1.5">
                <Sliders className="h-3.5 w-3.5 text-emerald-400" />
                Chart Controls
              </span>
              <span className="text-[10px] text-slate-400 font-mono">1–25 Yrs</span>
            </div>

            {/* 1. Projection Horizon Selector */}
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <label className="text-slate-300 font-medium">Projection Horizon</label>
                <span className="font-mono font-bold text-emerald-400 bg-emerald-950/60 px-2 py-0.5 rounded border border-emerald-500/30">
                  {projectionHorizon} Years
                </span>
              </div>
              <input
                type="range"
                min="1"
                max="25"
                step="1"
                value={projectionHorizon}
                onChange={(e) => setProjectionHorizon(parseInt(e.target.value, 10))}
                className="w-full accent-emerald-500 cursor-pointer"
              />
              {/* Quick Presets */}
              <div className="flex items-center justify-between gap-1 pt-1">
                {[5, 10, 15, 20, 25].map((yr) => (
                  <button
                    key={yr}
                    onClick={() => setProjectionHorizon(yr)}
                    className={`px-2 py-0.5 rounded text-[10px] font-mono transition-colors ${
                      projectionHorizon === yr
                        ? 'bg-emerald-500 text-slate-950 font-bold'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {yr}Y
                  </button>
                ))}
              </div>
            </div>

            {/* 2. X-Axis Granularity Toggle */}
            <div className="space-y-2 pt-2 border-t border-slate-800/80">
              <label className="text-slate-300 font-medium block">X-Axis Granularity</label>
              <div className="grid grid-cols-2 gap-1.5 p-1 bg-slate-900 rounded-lg border border-slate-800">
                <button
                  type="button"
                  onClick={() => setGranularity('annual')}
                  className={`py-1 text-center rounded text-[11px] font-medium transition-colors ${
                    granularity === 'annual'
                      ? 'bg-slate-800 text-white font-semibold shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Annual View
                </button>
                <button
                  type="button"
                  onClick={() => setGranularity('monthly')}
                  className={`py-1 text-center rounded text-[11px] font-medium transition-colors ${
                    granularity === 'monthly'
                      ? 'bg-slate-800 text-white font-semibold shadow'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  Monthly View
                </button>
              </div>
              <span className="text-[10px] text-slate-400 block">
                {granularity === 'annual'
                  ? '1 point per year across the horizon.'
                  : `${projectionHorizon * 12} points (12/year) with high resolution.`}
              </span>
            </div>

            {/* 3. Series Visibility Checkboxes */}
            <div className="space-y-2.5 pt-2 border-t border-slate-800/80">
              <label className="text-slate-300 font-medium block">Series Visibility</label>

              {/* Line 1: Baseline Electricity Spend */}
              <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 transition-colors">
                <input
                  type="checkbox"
                  checked={showBaselineSpend}
                  onChange={(e) => setShowBaselineSpend(e.target.checked)}
                  className="mt-0.5 accent-rose-500 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <span className="w-2.5 h-0.5 bg-rose-500 inline-block" />
                    <span>Baseline Electricity Spend</span>
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Cumulative cost with NO battery installed
                  </span>
                </div>
              </label>

              {/* Line 2: Cumulative Spend with Battery */}
              <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 transition-colors">
                <input
                  type="checkbox"
                  checked={showBatterySpend}
                  onChange={(e) => setShowBatterySpend(e.target.checked)}
                  className="mt-0.5 accent-cyan-500 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <span className="w-2.5 h-0.5 bg-cyan-400 inline-block" />
                    <span>Total Spend with Battery</span>
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Upfront CapEx + residual electricity spend + maintenance
                  </span>
                </div>
              </label>

              {/* Line 3: Net Cash Flow */}
              <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 transition-colors">
                <input
                  type="checkbox"
                  checked={showNetCashFlow}
                  onChange={(e) => setShowNetCashFlow(e.target.checked)}
                  className="mt-0.5 accent-emerald-500 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <span className="w-2.5 h-0.5 bg-emerald-400 inline-block" />
                    <span>Cumulative Net Cash Flow</span>
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Crosses $0 line at the exact breakeven payback point
                  </span>
                </div>
              </label>

              {/* Line 4: Opportunity Cost Benchmark */}
              <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 transition-colors">
                <input
                  type="checkbox"
                  checked={showOpportunityCost}
                  onChange={(e) => setShowOpportunityCost(e.target.checked)}
                  className="mt-0.5 accent-amber-500 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <span className="w-2.5 h-0.5 bg-amber-400 inline-block" />
                    <span>Alternative Market Benchmark</span>
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Committed cash outlays invested in {opportunityCostVehicleName}
                  </span>
                </div>
              </label>

              {/* Line 5: Discounted Cash Flow (NPV) Curve */}
              <label className="flex items-start gap-2.5 cursor-pointer p-2 rounded-lg bg-slate-900/60 hover:bg-slate-900 border border-slate-800/60 transition-colors">
                <input
                  type="checkbox"
                  checked={showNpvCurve}
                  onChange={(e) => setShowNpvCurve(e.target.checked)}
                  className="mt-0.5 accent-indigo-500 cursor-pointer"
                />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 font-semibold text-slate-200">
                    <span className="w-2.5 h-0.5 bg-indigo-400 inline-block" />
                    <span>Discounted NPV Curve</span>
                  </div>
                  <span className="text-[10px] text-slate-400 block mt-0.5">
                    Discounted at {discountRatePercent}% annual rate
                  </span>
                </div>
              </label>
            </div>

            {/* Quick Metrics for Active Horizon */}
            <div className="p-3 bg-slate-900 rounded-xl border border-slate-800 space-y-2 font-mono">
              <div className="flex justify-between text-slate-400">
                <span>{projectionHorizon}-Year Savings:</span>
                <span className="text-emerald-400 font-bold">${horizonSavings.toLocaleString()}</span>
              </div>
              <div className="flex justify-between text-slate-400">
                <span>{projectionHorizon}-Year Net Profit:</span>
                <span className={`font-bold ${horizonNetProfit >= 0 ? 'text-white' : 'text-rose-400'}`}>
                  ${horizonNetProfit.toLocaleString()}
                </span>
              </div>
              <div className="flex justify-between text-slate-400 pt-1 border-t border-slate-800">
                <span>{projectionHorizon}-Year NPV:</span>
                <span className={`font-bold ${horizonNpv >= 0 ? 'text-cyan-300' : 'text-rose-400'}`}>
                  {horizonNpv >= 0 ? `+$${horizonNpv.toLocaleString()}` : `-$${Math.abs(horizonNpv).toLocaleString()}`}
                </span>
              </div>
            </div>

            {/* LLM JSON Export Shortcut */}
            <button
              onClick={handleExportLlmJson}
              disabled={!canExportJson}
              className={`w-full flex items-center justify-center gap-1.5 py-2 px-3 rounded-lg text-xs font-semibold transition-colors shadow-sm ${
                !canExportJson
                  ? 'opacity-50 cursor-not-allowed bg-slate-900 text-slate-500 border border-slate-800'
                  : 'bg-emerald-950/70 hover:bg-emerald-900 border border-emerald-500/40 text-emerald-300'
              }`}
              title={
                isGenerationFinancial
                  ? 'Download clean, pretty-printed generation_project_analysis_export.json formatted for LLM analysis and reporting'
                  : isGenerationFinancialPending
                  ? 'Generation financial analysis is pending'
                  : isPartialPeriod || !activeAnalysis
                  ? 'Export disabled for partial-period or incomplete datasets'
                  : 'Download clean, pretty-printed battery_analysis_export.json formatted for LLM analysis and reporting'
              }
            >
              <FileJson className="h-3.5 w-3.5 text-emerald-400" />
              <span>Export Analysis for LLM (.json)</span>
            </button>
          </div>

          {/* RIGHT-SIDE SVG CHART CANVAS */}
          <div className="lg:col-span-8 xl:col-span-9 bg-slate-950 rounded-xl p-4 border border-slate-800/90 relative">
            <svg
              viewBox={`0 0 ${chartW} ${chartH}`}
              className="w-full h-auto overflow-visible select-none"
              onMouseMove={handleChartMouseMove}
              onMouseLeave={() => setHoveredPoint(null)}
            >
              <defs>
                <linearGradient id="gridLineGrad" x1="0" y1="0" x2="1" y2="0">
                  <stop offset="0%" stopColor="#334155" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#334155" stopOpacity="0.8" />
                </linearGradient>
                <linearGradient id="profitFillGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#10b981" stopOpacity="0.2" />
                  <stop offset="100%" stopColor="#10b981" stopOpacity="0.0" />
                </linearGradient>
              </defs>

              {/* Horizontal Grid Lines */}
              {yTicks.map((val) => {
                const y = getY(val);
                const isZero = val === 0;
                return (
                  <g key={val}>
                    <line
                      x1={padL}
                      y1={y}
                      x2={chartW - padR}
                      y2={y}
                      stroke={isZero ? '#10b981' : '#1e293b'}
                      strokeWidth={isZero ? 1.5 : 1}
                      strokeDasharray={isZero ? '4 2' : undefined}
                    />
                    <text
                      x={padL - 8}
                      y={y + 3}
                      textAnchor="end"
                      fill={isZero ? '#10b981' : '#64748b'}
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      {val >= 0 ? `$${val.toLocaleString()}` : `-$${Math.abs(val).toLocaleString()}`}
                    </text>
                  </g>
                );
              })}

              {/* Vertical Year Grid Lines */}
              {xTicks.map((yr) => {
                const x = getX(yr);
                return (
                  <g key={yr}>
                    <line
                      x1={x}
                      y1={padT}
                      x2={x}
                      y2={chartH - padB}
                      stroke="#1e293b"
                      strokeWidth={1}
                      strokeDasharray="2 2"
                    />
                    <text
                      x={x}
                      y={chartH - padB + 16}
                      textAnchor="middle"
                      fill="#64748b"
                      fontSize="9"
                      fontFamily="monospace"
                    >
                      Yr {yr}
                    </text>
                  </g>
                );
              })}

              {/* Inverter Replacement Event Line */}
              {hasReplacementInHorizon && (
                <g>
                  <line
                    x1={replacementX!}
                    y1={isCrossoverLabelOverlap ? padT - 18 : padT}
                    x2={replacementX!}
                    y2={chartH - padB}
                    stroke="#f59e0b"
                    strokeWidth={1.5}
                    strokeDasharray="3 3"
                  />
                  <text
                    x={replacementX!}
                    y={isCrossoverLabelOverlap ? padT - 22 : padT - 6}
                    textAnchor="middle"
                    fill="#f59e0b"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="bold"
                    style={{ pointerEvents: 'none' }}
                  >
                    Yr {replacementYear} Inverter (-${replacementCostTotal.toLocaleString()})
                  </text>
                </g>
              )}

              {/* Crossover Breakeven Vertical Line & Badge */}
              {hasBreakeven && breakevenX !== null && (
                <g>
                  <line
                    x1={breakevenX}
                    y1={padT}
                    x2={breakevenX}
                    y2={chartH - padB}
                    stroke="#fbbf24"
                    strokeWidth={1.5}
                    strokeDasharray="4 2"
                  />
                  <circle
                    cx={breakevenX}
                    cy={zeroY}
                    r={5}
                    fill="#fbbf24"
                    stroke="#020617"
                    strokeWidth={2}
                  />
                  <text
                    x={breakevenX}
                    y={padT - 6}
                    textAnchor="middle"
                    fill="#fbbf24"
                    fontSize="9"
                    fontFamily="monospace"
                    fontWeight="bold"
                    style={{ pointerEvents: 'none' }}
                  >
                    Payback: {paybackFormatted}
                  </text>
                </g>
              )}

              {/* Opportunity Cost Benchmark Curve */}
              {showOpportunityCost && (
                <path
                  d={oppCostPathD}
                  fill="none"
                  stroke="#f59e0b"
                  strokeWidth={2}
                  strokeDasharray="4 3"
                  className="opacity-80"
                />
              )}

              {/* Baseline Spend Path */}
              {showBaselineSpend && (
                <path
                  d={baselinePathD}
                  fill="none"
                  stroke="#f43f5e"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Battery Spend Path */}
              {showBatterySpend && (
                <path
                  d={batteryPathD}
                  fill="none"
                  stroke="#06b6d4"
                  strokeWidth={2.5}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Net Cash Flow Path */}
              {showNetCashFlow && (
                <path
                  d={cashFlowPathD}
                  fill="none"
                  stroke="#10b981"
                  strokeWidth={3}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Discounted NPV Path */}
              {showNpvCurve && (
                <path
                  d={npvPathD}
                  fill="none"
                  stroke="#818cf8"
                  strokeWidth={2}
                  strokeDasharray="2 2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              )}

              {/* Interactive Cursor Inspection Line and Points */}
              {hoveredPoint && (
                <g>
                  <line
                    x1={getX(hoveredPoint.timeFraction)}
                    y1={padT}
                    x2={getX(hoveredPoint.timeFraction)}
                    y2={chartH - padB}
                    stroke="#e2e8f0"
                    strokeWidth={1}
                    strokeDasharray="2 2"
                  />
                  {showBaselineSpend && (
                    <circle
                      cx={getX(hoveredPoint.timeFraction)}
                      cy={getY(hoveredPoint.baselineSpend)}
                      r={4}
                      fill="#f43f5e"
                      stroke="#020617"
                      strokeWidth={2}
                    />
                  )}
                  {showBatterySpend && (
                    <circle
                      cx={getX(hoveredPoint.timeFraction)}
                      cy={getY(hoveredPoint.batterySpend)}
                      r={4}
                      fill="#06b6d4"
                      stroke="#020617"
                      strokeWidth={2}
                    />
                  )}
                  {showNetCashFlow && (
                    <circle
                      cx={getX(hoveredPoint.timeFraction)}
                      cy={getY(hoveredPoint.netCashFlow)}
                      r={4}
                      fill="#10b981"
                      stroke="#020617"
                      strokeWidth={2}
                    />
                  )}
                  {showOpportunityCost && (
                    <circle
                      cx={getX(hoveredPoint.timeFraction)}
                      cy={getY(hoveredPoint.opportunityCostVal)}
                      r={4}
                      fill="#f59e0b"
                      stroke="#020617"
                      strokeWidth={2}
                    />
                  )}
                </g>
              )}
            </svg>

            {/* Hover Tooltip Overlay */}
            {hoveredPoint && (
              <div
                className="absolute bg-slate-950/95 border border-slate-700/90 rounded-lg p-3 text-xs shadow-xl z-20 pointer-events-none font-mono"
                style={{
                  left: `${Math.min(
                    chartW - 200,
                    Math.max(10, (getX(hoveredPoint.timeFraction) / chartW) * 100)
                  )}%`,
                  top: '12px',
                }}
              >
                <div className="font-bold text-white mb-1.5 flex items-center justify-between gap-4 border-b border-slate-800 pb-1">
                  <span>{hoveredPoint.label}</span>
                  <span className="text-[10px] text-slate-400">
                    SoH: {hoveredPoint.capacityRetention}% ({hoveredPoint.usableCapacityKwh} kWh)
                  </span>
                </div>
                <div className="space-y-1">
                  {showBaselineSpend && (
                    <div className="flex justify-between gap-4 text-rose-400">
                      <span>Baseline Spend:</span>
                      <span className="font-bold">${hoveredPoint.baselineSpend.toLocaleString()}</span>
                    </div>
                  )}
                  {showBatterySpend && (
                    <div className="flex justify-between gap-4 text-cyan-400">
                      <span>Battery Total Spend:</span>
                      <span className="font-bold">${hoveredPoint.batterySpend.toLocaleString()}</span>
                    </div>
                  )}
                  {showNetCashFlow && (
                    <div className="flex justify-between gap-4 text-emerald-400">
                      <span>Net Cash Flow:</span>
                      <span className="font-bold">
                        {hoveredPoint.netCashFlow >= 0
                          ? `+$${hoveredPoint.netCashFlow.toLocaleString()}`
                          : `-$${Math.abs(hoveredPoint.netCashFlow).toLocaleString()}`}
                      </span>
                    </div>
                  )}
                  {showOpportunityCost && (
                    <div className="flex justify-between gap-4 text-amber-400">
                      <span>Alternative Benchmark:</span>
                      <span className="font-bold">${hoveredPoint.opportunityCostVal.toLocaleString()}</span>
                    </div>
                  )}
                  {showNpvCurve && (
                    <div className="flex justify-between gap-4 text-indigo-400">
                      <span>Cumulative NPV:</span>
                      <span className="font-bold">
                        {hoveredPoint.discountedNpv >= 0
                          ? `+$${hoveredPoint.discountedNpv.toLocaleString()}`
                          : `-$${Math.abs(hoveredPoint.discountedNpv).toLocaleString()}`}
                      </span>
                    </div>
                  )}
                  {hoveredPoint.isReplacementYear && (
                    <div className="text-[10px] text-amber-300 pt-1 border-t border-slate-800">
                      ⚠️ Inverter Replacement: -${replacementCostTotal.toLocaleString()}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
        )}
      </div>

      {/* VISUALIZATION 2: 24-HOUR DISPATCH EXPLORER & HEATMAP */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Zap className="h-4 w-4 text-emerald-400" />
              24-Hour Battery Dispatch & Electrochemical Cycling
            </h3>
            <p className="text-xs text-slate-400">
              Hour-by-hour operational dispatch, TOU rate arbitrage, grid import offset, and state-of-charge tracking.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <div className="flex items-center bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
              <button
                onClick={() => setActiveDispatchView('chart')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  activeDispatchView === 'chart'
                    ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                24h Profile
              </button>
              <button
                onClick={() => setActiveDispatchView('median-month')}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded transition-colors ${
                  activeDispatchView === 'median-month'
                    ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                <BarChart3 className="h-3.5 w-3.5 text-emerald-400" />
                <span>Median Daily by Month</span>
              </button>
              <button
                onClick={() => setActiveDispatchView('heatmap')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  activeDispatchView === 'heatmap'
                    ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                12-Month Heatmap
              </button>
              <button
                onClick={() => setActiveDispatchView('table')}
                className={`px-2.5 py-1 rounded transition-colors ${
                  activeDispatchView === 'table'
                    ? 'bg-emerald-500/20 text-emerald-300 font-bold border border-emerald-500/30'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                Table View
              </button>
            </div>
          </div>
        </div>

        {/* 24-HOUR DISPATCH CHART */}
        {activeDispatchView === 'chart' && (
          <div className="space-y-4">
            {/* Day Selector & Seasonal Presets */}
            <div className="flex flex-wrap items-center justify-between gap-3 p-3 bg-slate-950 rounded-xl border border-slate-800 text-xs">
              <div className="flex items-center gap-2">
                <span className="text-slate-400">Active Day:</span>
                <span className="font-mono font-bold text-white bg-slate-900 px-2 py-0.5 rounded border border-slate-800">
                  {dayDateStr} (Day {safeDayIndex + 1} of {daysInDataset})
                </span>
              </div>

              <div className="flex items-center gap-1.5 flex-wrap">
                <span className="text-slate-500 text-[11px] mr-1">Jump to Season:</span>
                {[
                  { name: 'Winter Day', day: 15 },
                  { name: 'Spring Equinox', day: 80 },
                  { name: 'Summer Peak', day: 195 },
                  { name: 'Autumn Evening', day: 285 },
                ].map((s) => (
                  <button
                    key={s.name}
                    onClick={() => handleSeasonSelect(s.day)}
                    className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                      safeDayIndex === s.day
                        ? 'bg-cyan-500 text-slate-950 font-bold'
                        : 'bg-slate-900 text-slate-400 hover:text-slate-200 border border-slate-800'
                    }`}
                  >
                    {s.name}
                  </button>
                ))}
                <button
                  onClick={() => setActiveDispatchView('median-month')}
                  className="ml-1 px-2 py-0.5 rounded text-[11px] font-mono flex items-center gap-1 bg-emerald-950/60 hover:bg-emerald-900/80 text-emerald-300 border border-emerald-500/40 transition-colors"
                  title="View full-year distribution of daily power consumption grouped by month"
                >
                  <BarChart3 className="h-3 w-3 text-emerald-400" />
                  <span>Monthly Medians</span>
                </button>
              </div>
            </div>

            {/* Hourly Dispatch Chart Bars */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800/90 space-y-3">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <div className="flex items-center gap-4">
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-slate-500" />
                    <span>Home Load (kWh)</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-cyan-400" />
                    <span>Battery Charging</span>
                  </span>
                  <span className="flex items-center gap-1.5">
                    <span className="w-2.5 h-2.5 rounded-sm bg-amber-400" />
                    <span>Battery Discharging</span>
                  </span>
                </div>
                <span className="font-mono text-emerald-400">
                  Day Total Discharged: {dayIntervals.reduce((s: number, i: IntervalSimulationResult) => s + i.batteryDischargeKwh, 0).toFixed(1)} kWh
                </span>
              </div>

              <div className="h-44 flex items-end gap-1.5 pt-4 border-b border-slate-800">
                {dayIntervals.map((d: IntervalSimulationResult, h: number) => {
                  const loadH = (d.homeLoadKwh / maxDayLoad) * 100;
                  const chargeH = (d.batteryChargeKwh / maxDayLoad) * 100;
                  const dischargeH = (d.batteryDischargeKwh / maxDayLoad) * 100;

                  return (
                    <div
                      key={h}
                      onMouseEnter={() => setHoveredHour(h)}
                      onMouseLeave={() => setHoveredHour(null)}
                      className="flex-1 h-full flex flex-col justify-end items-center group cursor-pointer relative"
                    >
                      {/* Discharge bar */}
                      {d.batteryDischargeKwh > 0 && (
                        <div
                          style={{ height: `${dischargeH}%` }}
                          className="w-full bg-amber-400 rounded-t-sm transition-all group-hover:brightness-125"
                        />
                      )}

                      {/* Charge bar */}
                      {d.batteryChargeKwh > 0 && (
                        <div
                          style={{ height: `${chargeH}%` }}
                          className="w-full bg-cyan-400 rounded-t-sm transition-all group-hover:brightness-125"
                        />
                      )}

                      {/* Home load background baseline */}
                      <div
                        style={{ height: `${loadH}%` }}
                        className="w-full bg-slate-800/80 border-t border-slate-600 rounded-t-xs"
                      />
                    </div>
                  );
                })}
              </div>

              {/* Hours Labels */}
              <div className="flex justify-between text-[10px] text-slate-500 font-mono px-0.5">
                {Array.from({ length: 24 }).map((_, h) => (
                  <span key={h} className={h % 3 === 0 ? 'text-slate-400' : 'opacity-0'}>
                    {h}:00
                  </span>
                ))}
              </div>

              {/* Hover Inspection Info */}
              {hoveredHour !== null && dayIntervals[hoveredHour] && (
                <div className="p-3 bg-slate-900 rounded-lg border border-slate-800 text-xs font-mono flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <span className="text-white font-bold">{hoveredHour}:00 {hoveredHour < 12 ? 'AM' : 'PM'}</span>
                    <span className="text-slate-400 ml-2">Tier: <strong className="text-cyan-400">{dayIntervals[hoveredHour].tierName}</strong> (${dayIntervals[hoveredHour].buyRate.toFixed(2)}/kWh)</span>
                  </div>
                  <div className="flex items-center gap-3">
                    <span>Load: <strong className="text-white">{dayIntervals[hoveredHour].homeLoadKwh.toFixed(2)} kWh</strong></span>
                    <span>Battery SoC: <strong className="text-emerald-400">{dayIntervals[hoveredHour].batterySocPercent}%</strong></span>
                    <span>Savings: <strong className="text-emerald-400">+${dayIntervals[hoveredHour].netSavings.toFixed(3)}</strong></span>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* MEDIAN DAILY POWER CONSUMPTION GROUPED BY MONTH VIEW */}
        {activeDispatchView === 'median-month' && (
          <div className="space-y-5">
            {/* KPI Summary Strip */}
            <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span>Annual Median Load</span>
                  <Activity className="h-3.5 w-3.5 text-emerald-400" />
                </div>
                <div className="text-xl font-bold font-mono text-white">
                  {monthlyConsumptionStats.annualMedian.toFixed(1)}{' '}
                  <span className="text-xs text-slate-400 font-sans font-normal">kWh/day</span>
                </div>
                <div className="text-[11px] text-slate-400 font-mono">
                  Mean: {monthlyConsumptionStats.annualMean.toFixed(1)} kWh/day ({daysInDataset} days)
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span>Peak Month Median</span>
                  <Flame className="h-3.5 w-3.5 text-amber-400" />
                </div>
                <div className="text-xl font-bold font-mono text-amber-300">
                  {monthlyConsumptionStats.peakMonth
                    ? `${monthlyConsumptionStats.peakMonth.medianDailyKwh.toFixed(1)}`
                    : '—'}{' '}
                  <span className="text-xs text-slate-400 font-sans font-normal">kWh/day</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {monthlyConsumptionStats.peakMonth?.fullName || 'Summer'} (Summer Peak HVAC)
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span>Trough Month Median</span>
                  <Snowflake className="h-3.5 w-3.5 text-cyan-400" />
                </div>
                <div className="text-xl font-bold font-mono text-cyan-300">
                  {monthlyConsumptionStats.lowestMonth
                    ? `${monthlyConsumptionStats.lowestMonth.medianDailyKwh.toFixed(1)}`
                    : '—'}{' '}
                  <span className="text-xs text-slate-400 font-sans font-normal">kWh/day</span>
                </div>
                <div className="text-[11px] text-slate-400">
                  {monthlyConsumptionStats.lowestMonth?.fullName || 'Spring'} (Mild Shoulder Baseload)
                </div>
              </div>

              <div className="p-3 bg-slate-950 rounded-xl border border-slate-800 space-y-1">
                <div className="flex items-center justify-between text-slate-400 text-xs">
                  <span>Seasonal Variation</span>
                  <TrendingUp className="h-3.5 w-3.5 text-indigo-400" />
                </div>
                <div className="text-xl font-bold font-mono text-indigo-300">
                  +{monthlyConsumptionStats.seasonalSwingPercent}%
                </div>
                <div className="text-[11px] text-emerald-400 font-mono">
                  {monthlyConsumptionStats.peakMonth
                    ? `-${monthlyConsumptionStats.peakMonth.reductionPercent}% peak grid import w/ battery`
                    : 'Grid offset modeled'}
                </div>
              </div>
            </div>

            {/* Interactive Chart Container */}
            <div className="p-4 bg-slate-950 rounded-xl border border-slate-800 space-y-4">
              {/* Controls Toolbar */}
              <div className="flex flex-wrap items-center justify-between gap-3 text-xs border-b border-slate-800/80 pb-3">
                <div className="flex items-center gap-1.5">
                  <BarChart3 className="h-4 w-4 text-emerald-400" />
                  <span className="font-semibold text-slate-200">
                    Median Daily Power Consumption Grouped by Month
                  </span>
                  <span className="text-slate-500 hidden sm:inline text-[11px]">
                    (kWh/day, 12 Calendar Months)
                  </span>
                </div>

                <div className="flex flex-wrap items-center gap-3">
                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={showMedianWhiskers}
                      onChange={(e) => setShowMedianWhiskers(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-emerald-500 focus:ring-emerald-500/20"
                    />
                    <span className="text-[11px]">Min–Max Whiskers</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={showMonthlyMean}
                      onChange={(e) => setShowMonthlyMean(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-amber-500 focus:ring-amber-500/20"
                    />
                    <span className="text-[11px]">Mean (Average) Marker</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer text-slate-300 hover:text-white">
                    <input
                      type="checkbox"
                      checked={showMonthlyBatteryOffset}
                      onChange={(e) => setShowMonthlyBatteryOffset(e.target.checked)}
                      className="rounded border-slate-700 bg-slate-900 text-cyan-500 focus:ring-cyan-500/20"
                    />
                    <span className="text-[11px]">With-Battery Grid Import</span>
                  </label>
                </div>
              </div>

              {/* Legend & Benchmarks Ribbon */}
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-400 px-1">
                <div className="flex flex-wrap items-center gap-4 text-[11px]">
                  <span className="flex items-center gap-1.5">
                    <span className="w-3 h-3 rounded-xs bg-emerald-500" />
                    <span>Baseline Home Load Median (kWh/day)</span>
                  </span>
                  {showMonthlyBatteryOffset && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-3 rounded-xs bg-cyan-400" />
                      <span>With-Battery Grid Import Median</span>
                    </span>
                  )}
                  {showMonthlyMean && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-2.5 h-2.5 rounded-full bg-amber-400 border border-slate-900" />
                      <span>Mean (Average) Load</span>
                    </span>
                  )}
                  {showMedianWhiskers && (
                    <span className="flex items-center gap-1.5">
                      <span className="w-3 h-0.5 bg-slate-400" />
                      <span>Daily Min–Max Range (Whiskers)</span>
                    </span>
                  )}
                </div>

                <div className="flex items-center gap-1.5 font-mono text-[11px] text-emerald-400 bg-emerald-950/40 border border-emerald-500/30 px-2 py-0.5 rounded">
                  <span className="w-2 h-0.5 bg-emerald-400 border-dashed" />
                  <span>Annual Median: {monthlyConsumptionStats.annualMedian.toFixed(1)} kWh/day</span>
                </div>
              </div>

              {/* Interactive SVG Chart */}
              {(() => {
                const chartMonths = monthlyConsumptionStats.months;
                const maxVal = Math.max(
                  ...chartMonths.map((m) => Math.max(m.maxDailyKwh, m.medianDailyKwh)),
                  30
                );
                const yMax = Math.ceil((maxVal * 1.15) / 10) * 10 || 40;
                const svgW = 760;
                const svgH = 320;
                const padL = 50;
                const padR = 25;
                const padT = 32;
                const padB = 48;
                const innerW = svgW - padL - padR;
                const innerH = svgH - padT - padB;
                const slotW = innerW / 12;

                const getY = (val: number) => {
                  const clamped = Math.max(0, Math.min(yMax, val));
                  return padT + innerH - (clamped / yMax) * innerH;
                };

                const yTicks = [0, 0.25, 0.5, 0.75, 1.0].map((pct) =>
                  Math.round(yMax * pct)
                );

                const annualMedianY = getY(monthlyConsumptionStats.annualMedian);

                return (
                  <div className="relative w-full overflow-hidden">
                    <svg
                      viewBox={`0 0 ${svgW} ${svgH}`}
                      className="w-full h-auto select-none"
                    >
                      <defs>
                        <linearGradient id="medianBarGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#10b981" stopOpacity="0.9" />
                          <stop offset="100%" stopColor="#059669" stopOpacity="0.5" />
                        </linearGradient>
                        <linearGradient id="peakBarGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#f59e0b" stopOpacity="0.95" />
                          <stop offset="100%" stopColor="#d97706" stopOpacity="0.6" />
                        </linearGradient>
                        <linearGradient id="batteryBarGrad" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="#06b6d4" stopOpacity="0.85" />
                          <stop offset="100%" stopColor="#0284c7" stopOpacity="0.45" />
                        </linearGradient>
                      </defs>

                      {/* Horizontal Grid Lines */}
                      {yTicks.map((tickVal) => {
                        const y = getY(tickVal);
                        return (
                          <g key={tickVal}>
                            <line
                              x1={padL}
                              y1={y}
                              x2={padL + innerW}
                              y2={y}
                              stroke="#334155"
                              strokeOpacity={tickVal === 0 ? 0.8 : 0.35}
                              strokeWidth={tickVal === 0 ? 1.5 : 1}
                              strokeDasharray={tickVal === 0 ? undefined : '2 3'}
                            />
                            <text
                              x={padL - 8}
                              y={y + 3.5}
                              textAnchor="end"
                              fill="#64748b"
                              fontSize="10"
                              fontFamily="monospace"
                            >
                              {tickVal}
                            </text>
                          </g>
                        );
                      })}

                      {/* Y-Axis Label */}
                      <text
                        x={16}
                        y={padT + innerH / 2}
                        textAnchor="middle"
                        transform={`rotate(-90 16 ${padT + innerH / 2})`}
                        fill="#94a3b8"
                        fontSize="10"
                        fontFamily="monospace"
                      >
                        Daily Energy (kWh/day)
                      </text>

                      {/* Annual Median Reference Dashed Line */}
                      {annualMedianY >= padT && annualMedianY <= padT + innerH && (
                        <g>
                          <line
                            x1={padL}
                            y1={annualMedianY}
                            x2={padL + innerW}
                            y2={annualMedianY}
                            stroke="#34d399"
                            strokeWidth="1.5"
                            strokeDasharray="4 4"
                          />
                          <rect
                            x={padL + innerW - 128}
                            y={annualMedianY - 9}
                            width="124"
                            height="16"
                            rx="3"
                            fill="#064e3b"
                            fillOpacity="0.9"
                            stroke="#10b981"
                            strokeWidth="0.8"
                          />
                          <text
                            x={padL + innerW - 66}
                            y={annualMedianY + 3}
                            textAnchor="middle"
                            fill="#a7f3d0"
                            fontSize="9"
                            fontWeight="bold"
                            fontFamily="monospace"
                          >
                            Ann. Median: {monthlyConsumptionStats.annualMedian.toFixed(1)} kWh
                          </text>
                        </g>
                      )}

                      {/* Monthly Columns */}
                      {chartMonths.map((m, idx) => {
                        const cx = padL + idx * slotW + slotW / 2;
                        const isHovered = hoveredMonthIndex === idx;
                        const isPeak =
                          monthlyConsumptionStats.peakMonth &&
                          m.monthIndex === monthlyConsumptionStats.peakMonth.monthIndex;

                        const barWidth = showMonthlyBatteryOffset ? 17 : 24;
                        const medianY = getY(m.medianDailyKwh);
                        const medianH = Math.max(2, padT + innerH - medianY);
                        const medianX = showMonthlyBatteryOffset ? cx - barWidth - 1 : cx - barWidth / 2;

                        const batY = getY(m.medianWithBatteryKwh);
                        const batH = Math.max(2, padT + innerH - batY);
                        const batX = cx + 1;

                        const minY = getY(m.minDailyKwh);
                        const maxY = getY(m.maxDailyKwh);
                        const p25Y = getY(m.p25DailyKwh);
                        const p75Y = getY(m.p75DailyKwh);
                        const meanY = getY(m.meanDailyKwh);

                        return (
                          <g
                            key={m.monthIndex}
                            onMouseEnter={() => setHoveredMonthIndex(idx)}
                            onMouseLeave={() => setHoveredMonthIndex(null)}
                            onClick={() => {
                              setSelectedDayIndex(m.repDayIndex);
                              setActiveDispatchView('chart');
                            }}
                            className="cursor-pointer"
                          >
                            {/* Hover Column Highlight */}
                            <rect
                              x={padL + idx * slotW + 1}
                              y={padT}
                              width={slotW - 2}
                              height={innerH}
                              fill={isHovered ? '#334155' : 'transparent'}
                              fillOpacity={isHovered ? 0.35 : 0}
                              rx="4"
                              className="transition-colors"
                            />

                            {/* Whiskers (Min to Max Range) */}
                            {showMedianWhiskers && m.daysCount > 0 && (
                              <g opacity={isHovered ? 1 : 0.75}>
                                {/* Vertical Whisker line */}
                                <line
                                  x1={cx}
                                  y1={minY}
                                  x2={cx}
                                  y2={maxY}
                                  stroke="#64748b"
                                  strokeWidth="1.5"
                                />
                                {/* Top cap (Max) */}
                                <line
                                  x1={cx - 5}
                                  y1={maxY}
                                  x2={cx + 5}
                                  y2={maxY}
                                  stroke="#64748b"
                                  strokeWidth="1.5"
                                />
                                {/* Bottom cap (Min) */}
                                <line
                                  x1={cx - 5}
                                  y1={minY}
                                  x2={cx + 5}
                                  y2={minY}
                                  stroke="#64748b"
                                  strokeWidth="1.5"
                                />
                                {/* IQR Box (25th to 75th percentile) */}
                                <rect
                                  x={cx - 7}
                                  y={p75Y}
                                  width={14}
                                  height={Math.max(2, p25Y - p75Y)}
                                  fill="#475569"
                                  fillOpacity="0.25"
                                  stroke="#94a3b8"
                                  strokeWidth="0.75"
                                  rx="1"
                                />
                              </g>
                            )}

                            {/* Baseline Home Load Median Bar */}
                            {m.daysCount > 0 && (
                              <g>
                                <rect
                                  x={medianX}
                                  y={medianY}
                                  width={barWidth}
                                  height={medianH}
                                  rx="3"
                                  fill={isPeak ? 'url(#peakBarGrad)' : 'url(#medianBarGrad)'}
                                  stroke={isHovered ? '#ffffff' : isPeak ? '#f59e0b' : '#10b981'}
                                  strokeWidth={isHovered ? 1.5 : 0.5}
                                  className="transition-all"
                                />
                                {/* Value label on top of median bar */}
                                <text
                                  x={medianX + barWidth / 2}
                                  y={medianY - 4}
                                  textAnchor="middle"
                                  fill={isPeak ? '#fbbf24' : '#6ee7b7'}
                                  fontSize="9"
                                  fontWeight="bold"
                                  fontFamily="monospace"
                                >
                                  {m.medianDailyKwh.toFixed(1)}
                                </text>
                              </g>
                            )}

                            {/* With-Battery Net Grid Import Bar */}
                            {showMonthlyBatteryOffset && m.daysCount > 0 && (
                              <g>
                                <rect
                                  x={batX}
                                  y={batY}
                                  width={barWidth}
                                  height={batH}
                                  rx="3"
                                  fill="url(#batteryBarGrad)"
                                  stroke={isHovered ? '#ffffff' : '#06b6d4'}
                                  strokeWidth={isHovered ? 1.5 : 0.5}
                                  className="transition-all"
                                />
                                <text
                                  x={batX + barWidth / 2}
                                  y={batY - 4}
                                  textAnchor="middle"
                                  fill="#67e8f9"
                                  fontSize="8.5"
                                  fontFamily="monospace"
                                >
                                  {m.medianWithBatteryKwh.toFixed(1)}
                                </text>
                              </g>
                            )}

                            {/* Mean (Average) Point */}
                            {showMonthlyMean && m.daysCount > 0 && (
                              <g>
                                <circle
                                  cx={cx}
                                  cy={meanY}
                                  r="3"
                                  fill="#f59e0b"
                                  stroke="#0f172a"
                                  strokeWidth="1.5"
                                />
                              </g>
                            )}

                            {/* X-Axis Month Label */}
                            <text
                              x={cx}
                              y={padT + innerH + 16}
                              textAnchor="middle"
                              fill={isHovered ? '#ffffff' : isPeak ? '#f59e0b' : '#94a3b8'}
                              fontSize="11"
                              fontWeight={isHovered || isPeak ? 'bold' : 'normal'}
                              fontFamily="monospace"
                            >
                              {m.shortName}
                            </text>

                            {/* Season Tag Subtitle */}
                            <text
                              x={cx}
                              y={padT + innerH + 28}
                              textAnchor="middle"
                              fill={
                                m.season === 'Summer'
                                  ? '#fbbf24'
                                  : m.season === 'Winter'
                                  ? '#38bdf8'
                                  : m.season === 'Spring'
                                  ? '#4ade80'
                                  : '#f97316'
                              }
                              fontSize="8"
                              fontFamily="sans-serif"
                            >
                              {m.season}
                            </text>
                          </g>
                        );
                      })}
                    </svg>
                  </div>
                );
              })()}

              {/* Hover / Active Month Detail Inspection Card */}
              {(() => {
                const activeMonth =
                  hoveredMonthIndex !== null
                    ? monthlyConsumptionStats.months[hoveredMonthIndex]
                    : monthlyConsumptionStats.peakMonth || monthlyConsumptionStats.months[6];

                if (!activeMonth) return null;

                return (
                  <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-800 text-xs font-mono space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-800 pb-2">
                      <div className="flex items-center gap-2">
                        <span className="text-white font-bold text-sm">
                          {activeMonth.fullName}
                        </span>
                        <span
                          className={`text-[10px] px-2 py-0.5 rounded font-sans font-semibold ${
                            activeMonth.season === 'Summer'
                              ? 'bg-amber-950 text-amber-300 border border-amber-800/80'
                              : activeMonth.season === 'Winter'
                              ? 'bg-cyan-950 text-cyan-300 border border-cyan-800/80'
                              : activeMonth.season === 'Spring'
                              ? 'bg-emerald-950 text-emerald-300 border border-emerald-800/80'
                              : 'bg-orange-950 text-orange-300 border border-orange-800/80'
                          }`}
                        >
                          {activeMonth.season} Season ({activeMonth.daysCount} Days)
                        </span>
                        {hoveredMonthIndex === null && (
                          <span className="text-slate-500 text-[10px] font-sans">
                            (Hover over any month bar to inspect)
                          </span>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          setSelectedDayIndex(activeMonth.repDayIndex);
                          setActiveDispatchView('chart');
                        }}
                        className="flex items-center gap-1.5 px-2.5 py-1 rounded bg-emerald-500/20 hover:bg-emerald-500/30 text-emerald-300 text-[11px] font-sans font-medium transition-colors border border-emerald-500/30"
                      >
                        <span>Open {activeMonth.shortName} in 24h Hourly Dispatch</span>
                        <ArrowRight className="h-3 w-3" />
                      </button>
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-slate-300 pt-1">
                      <div>
                        <span className="text-slate-500 block text-[11px]">Median Daily Load:</span>
                        <strong className="text-emerald-400 text-sm">
                          {activeMonth.medianDailyKwh.toFixed(2)} kWh/day
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Mean (Average) Daily:</span>
                        <strong className="text-amber-300 text-sm">
                          {activeMonth.meanDailyKwh.toFixed(2)} kWh/day
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">Min – Max Range:</span>
                        <strong className="text-slate-200 text-sm">
                          {activeMonth.minDailyKwh.toFixed(1)} – {activeMonth.maxDailyKwh.toFixed(1)} kWh
                        </strong>
                      </div>
                      <div>
                        <span className="text-slate-500 block text-[11px]">With-Battery Grid Import:</span>
                        <strong className="text-cyan-400 text-sm">
                          {activeMonth.medianWithBatteryKwh.toFixed(2)} kWh/day{' '}
                          <span className="text-xs text-emerald-400">(-{activeMonth.reductionPercent}%)</span>
                        </strong>
                      </div>
                    </div>
                  </div>
                );
              })()}
            </div>

            {/* Complete 12-Month Distribution Data Table */}
            <div className="space-y-3 pt-2">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-2">
                  <Calendar className="h-3.5 w-3.5 text-emerald-400" />
                  Monthly Median & Consumption Statistical Breakdown
                </h4>
                <button
                  onClick={() => {
                    const headers = [
                      'Month',
                      'Season',
                      'Days Analyzed',
                      'Median Daily Load (kWh)',
                      'Mean Daily Load (kWh)',
                      'Min Daily Load (kWh)',
                      'Max Daily Load (kWh)',
                      '25th Percentile Daily (kWh)',
                      '75th Percentile Daily (kWh)',
                      'Total Monthly Consumption (kWh)',
                      'With-Battery Median Grid Import (kWh)',
                      'Daily Grid Reduction (%)',
                    ];
                    const rows = monthlyConsumptionStats.months.map((m) => [
                      m.fullName,
                      m.season,
                      m.daysCount,
                      m.medianDailyKwh.toFixed(2),
                      m.meanDailyKwh.toFixed(2),
                      m.minDailyKwh.toFixed(2),
                      m.maxDailyKwh.toFixed(2),
                      m.p25DailyKwh.toFixed(2),
                      m.p75DailyKwh.toFixed(2),
                      m.totalMonthlyKwh,
                      m.medianWithBatteryKwh.toFixed(2),
                      `${m.reductionPercent}%`,
                    ]);
                    const csvContent =
                      'data:text/csv;charset=utf-8,' +
                      [headers.join(','), ...rows.map((r) => r.join(','))].join('\n');
                    const encodedUri = encodeURI(csvContent);
                    const link = document.createElement('a');
                    link.setAttribute('href', encodedUri);
                    link.setAttribute('download', 'Monthly_Median_Power_Consumption.csv');
                    document.body.appendChild(link);
                    link.click();
                    document.body.removeChild(link);
                  }}
                  className="flex items-center gap-1.5 px-2.5 py-1 text-xs bg-slate-900 hover:bg-slate-800 text-slate-300 rounded border border-slate-800 transition-colors font-mono"
                >
                  <Download className="h-3 w-3 text-slate-400" />
                  <span>Export CSV</span>
                </button>
              </div>

              <div className="overflow-x-auto rounded-lg border border-slate-800 max-h-96">
                <table className="w-full text-left text-xs font-mono">
                  <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
                    <tr>
                      <th className="py-2.5 px-3">Month</th>
                      <th className="py-2.5 px-3">Season</th>
                      <th className="py-2.5 px-3 text-right">Days</th>
                      <th className="py-2.5 px-3 text-right text-emerald-400">Median Daily Load</th>
                      <th className="py-2.5 px-3 text-right">Mean Daily Load</th>
                      <th className="py-2.5 px-3 text-right">Min / Max Range</th>
                      <th className="py-2.5 px-3 text-right">Total Monthly</th>
                      <th className="py-2.5 px-3 text-right text-cyan-400">With Battery</th>
                      <th className="py-2.5 px-3 text-right text-emerald-400">Grid Reduction</th>
                      <th className="py-2.5 px-3 text-center">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 text-slate-300">
                    {monthlyConsumptionStats.months.map((m) => {
                      const isPeak =
                        monthlyConsumptionStats.peakMonth &&
                        m.monthIndex === monthlyConsumptionStats.peakMonth.monthIndex;
                      const isLowest =
                        monthlyConsumptionStats.lowestMonth &&
                        m.monthIndex === monthlyConsumptionStats.lowestMonth.monthIndex;

                      return (
                        <tr
                          key={m.monthIndex}
                          className="hover:bg-slate-800/50 transition-colors"
                        >
                          <td className="py-2 px-3 font-bold text-white flex items-center gap-1.5">
                            <span>{m.fullName}</span>
                            {isPeak && (
                              <span className="text-[10px] bg-amber-500/20 text-amber-300 px-1.5 py-0.5 rounded border border-amber-500/30">
                                Peak
                              </span>
                            )}
                            {isLowest && (
                              <span className="text-[10px] bg-cyan-500/20 text-cyan-300 px-1.5 py-0.5 rounded border border-cyan-500/30">
                                Low
                              </span>
                            )}
                          </td>
                          <td className="py-2 px-3 text-slate-400">{m.season}</td>
                          <td className="py-2 px-3 text-right tabular-nums">{m.daysCount}</td>
                          <td className="py-2 px-3 text-right tabular-nums font-bold text-emerald-400">
                            {m.medianDailyKwh.toFixed(2)} kWh
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-slate-300">
                            {m.meanDailyKwh.toFixed(2)} kWh
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums text-slate-400">
                            {m.minDailyKwh.toFixed(1)} – {m.maxDailyKwh.toFixed(1)} kWh
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-semibold text-slate-200">
                            {m.totalMonthlyKwh.toLocaleString()} kWh
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-semibold text-cyan-400">
                            {m.medianWithBatteryKwh.toFixed(2)} kWh
                          </td>
                          <td className="py-2 px-3 text-right tabular-nums font-bold text-emerald-400">
                            -{m.reductionPercent}%
                          </td>
                          <td className="py-2 px-3 text-center">
                            <button
                              onClick={() => {
                                setSelectedDayIndex(m.repDayIndex);
                                setActiveDispatchView('chart');
                              }}
                              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] transition-colors"
                              title="Inspect representative 24h dispatch day for this month"
                            >
                              Inspect 24h
                            </button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        )}

        {/* 12-MONTH HEATMAP VIEW */}
        {activeDispatchView === 'heatmap' && (
          <div className="space-y-4">
            <div className="overflow-x-auto p-2 bg-slate-950/70 rounded-xl border border-slate-800">
              <div className="min-w-[680px]">
                {/* Hours Header Row */}
                <div
                  className="gap-1 mb-1 text-[10px] text-slate-500 font-mono text-center"
                  style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, minmax(0, 1fr))' }}
                >
                  <div className="text-left font-bold text-slate-400">Mo</div>
                  {Array.from({ length: 24 }).map((_, h) => (
                    <div key={h}>{h % 2 === 0 ? `${h}h` : ''}</div>
                  ))}
                </div>

                {/* 12 Month Rows */}
                {heatmapData.map((row, m) => (
                  <div
                    key={m}
                    className="gap-1 items-center mb-1"
                    style={{ display: 'grid', gridTemplateColumns: '40px repeat(24, minmax(0, 1fr))' }}
                  >
                    <div className="text-[11px] font-bold text-slate-300 font-mono">
                      {monthNames[m]}
                    </div>
                    {row.map((cell, h) => {
                      let bg = '#090d16';
                      if (cell.avgSoc >= 85) bg = '#10b981';
                      else if (cell.avgSoc >= 65) bg = '#059669';
                      else if (cell.avgSoc >= 45) bg = '#0d9488';
                      else if (cell.avgSoc >= 25) bg = '#1e3a8a';
                      else bg = '#0f172a';

                      return (
                        <div
                          key={h}
                          style={{ backgroundColor: bg }}
                          onMouseEnter={() =>
                            setHoveredHeatmapCell({
                              month: m,
                              hour: h,
                              avgSoc: cell.avgSoc,
                              avgLoad: cell.avgLoad,
                            })
                          }
                          onMouseLeave={() => setHoveredHeatmapCell(null)}
                          className="h-5 rounded-xs cursor-pointer hover:ring-2 hover:ring-white transition-all flex items-center justify-center text-[9px] font-mono text-white/80"
                        >
                          {cell.avgSoc > 0 ? `${cell.avgSoc}` : ''}
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            </div>

            {/* Heatmap Tooltip Details */}
            <div className="p-3 bg-slate-950 rounded-lg border border-slate-800 text-xs font-mono">
              {hoveredHeatmapCell ? (
                <div className="text-slate-200">
                  <strong className="text-emerald-400">
                    {monthNames[hoveredHeatmapCell.month]} at {hoveredHeatmapCell.hour}:00
                  </strong>{' '}
                  · Avg Battery State of Charge: <strong className="text-emerald-400">{hoveredHeatmapCell.avgSoc}%</strong> · Avg Home Load Demand: <strong className="text-slate-300">{hoveredHeatmapCell.avgLoad} kWh</strong>
                </div>
              ) : (
                <div className="text-slate-400 text-xs font-sans">
                  Hover over any heatmap block to inspect the average battery state-of-charge for that calendar month and hour of day.
                </div>
              )}
            </div>
          </div>
        )}

        {/* 24-HOUR TABLE VIEW */}
        {activeDispatchView === 'table' && (
          <div className="overflow-x-auto max-h-96 rounded-lg border border-slate-800">
            <table className="w-full text-left text-xs font-mono">
              <thead className="bg-slate-950 text-slate-400 sticky top-0 border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-3">Hour</th>
                  <th className="py-2.5 px-3">TOU Tier</th>
                  <th className="py-2.5 px-3 text-right">Home Load</th>
                  <th className="py-2.5 px-3 text-right">Battery Action</th>
                  <th className="py-2.5 px-3 text-right">Battery SoC</th>
                  <th className="py-2.5 px-3 text-right">Grid Import</th>
                  <th className="py-2.5 px-3 text-right">Hourly Savings</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 bg-slate-900/40 text-slate-300">
                {dayIntervals.map((d: IntervalSimulationResult, h: number) => (
                  <tr key={h} className="hover:bg-slate-800/50 transition-colors">
                    <td className="py-2 px-3 font-bold text-slate-200">
                      {h}:00 {h < 12 ? 'AM' : 'PM'}
                    </td>
                    <td className="py-2 px-3">
                      <span className="text-slate-300">{d.tierName}</span>{' '}
                      <span className="text-slate-500">(${d.buyRate.toFixed(2)}/kWh)</span>
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{d.homeLoadKwh.toFixed(2)} kWh</td>
                    <td className="py-2 px-3 text-right tabular-nums">
                      {d.batteryChargeKwh > 0 ? (
                        <span className="text-cyan-400 font-semibold">+{d.batteryChargeKwh.toFixed(2)} kWh</span>
                      ) : d.batteryDischargeKwh > 0 ? (
                        <span className="text-amber-400 font-semibold">-{d.batteryDischargeKwh.toFixed(2)} kWh</span>
                      ) : (
                        <span className="text-slate-500">—</span>
                      )}
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums text-emerald-400 font-semibold">
                      {d.batterySocPercent}% ({d.batterySocKwh} kWh)
                    </td>
                    <td className="py-2 px-3 text-right tabular-nums">{d.gridImportKwh.toFixed(2)} kWh</td>
                    <td className="py-2 px-3 text-right tabular-nums font-semibold text-emerald-400">
                      +${d.netSavings.toFixed(3)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* VISUALIZATION 3: MULTI-PROFILE COMPARISON TABLE */}
      <div className="rounded-xl border border-slate-800 bg-slate-900/40 p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
          <div>
            <h3 className="text-sm font-bold uppercase tracking-wider text-slate-200 flex items-center gap-2">
              <Layers className="h-4 w-4 text-emerald-400" />
              Multi-Profile Hardware, TVM & Financial Comparison Matrix
            </h3>
            <p className="text-xs text-slate-400">
              Side-by-side 25-year lifetime comparison of all battery configurations evaluated under identical home load conditions.
            </p>
          </div>
        </div>

        {multiProfileMatrixState === 'generation-financial' ? (
          <div className="rounded-xl border border-slate-800 bg-slate-950/60 p-8 text-center space-y-2">
            <p className="text-sm font-medium text-slate-200">
              Generation lifecycle analysis is calculated for the active battery profile only.
            </p>
            <p className="text-xs text-slate-400 max-w-xl mx-auto leading-relaxed">
              Multi-profile generation lifecycle comparison is not calculated because each battery profile would require its own 25-year physical projection.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto rounded-xl border border-slate-800">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950 text-slate-400 border-b border-slate-800 font-medium">
                <tr>
                  <th className="py-3 px-4">Battery Profile</th>
                  <th className="py-3 px-4">Strategy</th>
                  <th className="py-3 px-4 text-right">Capacity (Usable)</th>
                  <th className="py-3 px-4 text-right">Net Installed</th>
                  <th className="py-3 px-4 text-right">Year 1 Savings</th>
                  <th className="py-3 px-4 text-right">Payback</th>
                  <th className="py-3 px-4 text-right">25-Year NPV</th>
                  <th className="py-3 px-4 text-right">25-Year IRR</th>
                  <th className="py-3 px-4 text-right">25-Year LCOS</th>
                  <th className="py-3 px-4 text-right">Autonomy</th>
                  <th className="py-3 px-4 text-center">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/80 bg-slate-900/30">
                {multiProfileMatrixState === 'generation-financial-pending' ? (
                  <tr>
                    <td colSpan={11} className="py-8 px-4 text-center text-slate-400">
                      <p className="text-sm font-medium">Lifecycle analysis unavailable for the current configuration/run.</p>
                      <p className="text-xs text-slate-500 mt-1">Multi-profile comparison requires an available active generation lifecycle projection.</p>
                    </td>
                  </tr>
                ) : multiProfileMatrixState === 'partial-period' || allAnalyses.length === 0 ? (
                  <tr>
                    <td colSpan={11} className="py-8 px-4 text-center text-slate-400">
                      <p className="text-sm font-medium">Multi-profile multi-year financial matrix is disabled for partial-period datasets.</p>
                      <p className="text-xs text-slate-500 mt-1">Full 8,760-hour annual data is required for long-term multi-profile financial comparison.</p>
                    </td>
                  </tr>
                ) : (
                allAnalyses.map((analysis) => {
                const isCurrent = analysis.profile.id === profile.id;
                const isFastestPayback =
                  fastestPaybackProfile &&
                  fastestPaybackProfile.profile.id === analysis.profile.id;
                const isHighestRoi =
                  highestRoiProfile &&
                  highestRoiProfile.profile.id === analysis.profile.id;

                const usable = (
                  analysis.profile.totalCapacityKwh *
                  (analysis.profile.usableDodPercent / 100)
                ).toFixed(1);

                return (
                  <tr
                    key={analysis.profile.id}
                    className={`transition-colors ${
                      isCurrent ? 'bg-slate-800/40' : 'hover:bg-slate-800/20'
                    }`}
                  >
                    <td className="py-3 px-4">
                      <div className="font-bold text-slate-100 flex items-center gap-1.5">
                        {analysis.profile.name}
                        {isCurrent && (
                          <span className="text-[10px] text-emerald-400 font-normal">
                            (Active)
                          </span>
                        )}
                      </div>
                      <span className="text-[11px] text-slate-400">{analysis.profile.model}</span>
                    </td>

                    <td className="py-3 px-4 text-slate-300">
                      {analysis.profile.strategy === 'arbitrage' ? (
                        <span className="text-emerald-400 font-medium">Arbitrage</span>
                      ) : (
                        <span className="text-cyan-400 font-medium">Self-Consumption</span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                      {analysis.profile.totalCapacityKwh} kWh{' '}
                      <span className="text-slate-400">({usable} kWh)</span>
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-200">
                      <span className="text-emerald-400 font-bold block">
                        ${analysis.netInstalledCost.toLocaleString()}
                      </span>
                      <span className="text-[10px] text-slate-400">
                        Gross: ${analysis.grossCost.toLocaleString()}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums text-emerald-400 font-semibold">
                      ${analysis.year1Savings.toLocaleString()}/yr
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <span className="font-bold text-amber-300">
                        {analysis.paybackFormatted}
                      </span>
                      {isFastestPayback && (
                        <span className="block text-[10px] text-emerald-400 font-sans font-semibold">
                          Fastest Payback
                        </span>
                      )}
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold">
                      <span className={analysis.npv >= 0 ? 'text-cyan-300' : 'text-rose-400'}>
                        {analysis.npv >= 0 ? `+$${analysis.npv.toLocaleString()}` : `-$${Math.abs(analysis.npv).toLocaleString()}`}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums">
                      <span className="text-white font-bold">
                        {analysis.irrPercent !== null ? `${analysis.irrPercent}%` : '<0%'}
                      </span>
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums text-slate-300">
                      ${analysis.lcosPerKwh}/kWh
                    </td>

                    <td className="py-3 px-4 text-right font-mono tabular-nums text-amber-300">
                      {analysis.outageAutonomyHours}h
                    </td>

                    <td className="py-3 px-4 text-center">
                      {isCurrent ? (
                        <span className="text-[11px] font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-500/30 px-2 py-0.5 rounded">
                          Selected
                        </span>
                      ) : (
                        <button
                          onClick={() => setActiveProfileId(analysis.profile.id)}
                          className="px-2.5 py-1 text-xs font-medium text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 rounded transition-colors"
                        >
                          Switch
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })
            )}
            </tbody>
          </table>
        </div>
        )}
      </div>
    </div>
  );
};

export const ResultsAnalyticsTab: React.FC<ResultsAnalyticsTabProps> = ({
  activeAnalysis,
  allAnalyses,
  activeSimulationSummary,
  allSimulationSummaries,
  activeProfile,
  setActiveProfileId,
  tiers,
  activeTouProfile,
  financials,
  csvResult,
  analysisState,
  activeGenerationAnalysis,
  activeGenerationOperationalProjection,
  activeGenerationAwareResult,
  generationProjectCosts,
  generationAnalysisError,
  generationConfig,
  allowSolarExport,
}) => {
  const effectiveSummary = activeAnalysis ? activeAnalysis.annualSummary : activeSimulationSummary;
  const effectiveProfile = activeAnalysis ? activeAnalysis.profile : activeProfile;

  if (!effectiveSummary || !effectiveProfile) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900/30 p-12 text-center text-slate-400 space-y-3">
        <Activity className="h-8 w-8 text-slate-500 mx-auto animate-pulse" />
        <p className="text-sm font-medium">Running 8,760-hour dispatch simulation...</p>
        <p className="text-xs text-slate-500">
          Please upload interval data or select a preset battery profile to initialize results.
        </p>
      </div>
    );
  }

  return (
    <ResultsAnalyticsContent
      activeAnalysis={activeAnalysis}
      allAnalyses={allAnalyses}
      activeSimulationSummary={effectiveSummary}
      activeProfile={effectiveProfile}
      setActiveProfileId={setActiveProfileId}
      tiers={tiers}
      activeTouProfile={activeTouProfile}
      financials={financials}
      csvResult={csvResult}
      analysisState={analysisState}
      activeGenerationAnalysis={activeGenerationAnalysis}
      activeGenerationOperationalProjection={activeGenerationOperationalProjection}
      activeGenerationAwareResult={activeGenerationAwareResult}
      generationProjectCosts={generationProjectCosts}
      generationAnalysisError={generationAnalysisError}
      generationConfig={generationConfig}
      allowSolarExport={allowSolarExport}
    />
  );
};
