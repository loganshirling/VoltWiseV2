/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect } from 'react';
import { Navbar } from './components/Navbar';
import { DataAndRatesTab } from './components/DataAndRatesTab';
import { BatteryProfilesTab } from './components/BatteryProfilesTab';
import { PowerGenerationTab } from './components/PowerGenerationTab';
import { FinancialSettingsTab } from './components/FinancialSettingsTab';
import { ResultsAnalyticsTab } from './components/ResultsAnalyticsTab';
import {
  BatteryProfile,
  CsvValidationResult,
  MacroFinancials,
  ProfileFinancialAnalysis,
  RateTier,
  TouProfile,
  AnnualSimulationSummary,
  GenerationConfig,
  AnalysisState,
  GenerationProjectCostSummary,
  GenerationOperationalProjection,
  GenerationFinancialAnalysis,
} from './types/energy';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_RATE_TIERS,
  DEFAULT_TOU_PROFILES,
  ScheduleMatrix,
  calculate15YearFinancials,
  createDefaultScheduleMatrix,
  getHeaderSavingsLabel,
  getHeaderPaybackText,
} from './utils/simulationEngine';
import { runUnifiedSimulation, UnifiedSimulationResult } from './utils/simulationRouter';
import { DEFAULT_GENERATION_CONFIG, createDefaultGenerationConfig } from './utils/generationDefaults';
import {
  deriveAnalysisState,
  shouldCalculateLegacyFinancials,
  aggregateGenerationProjectCosts,
  calculateGenerationAwareFinancials,
} from './utils/generationFinancials';
import { calculateGenerationOperationalProjection } from './utils/generationProjection';
import { generateRealistic8760Dataset } from './utils/sampleData';
import { parseAndValidateEnergyCsv } from './utils/csvParser';
import { Zap, ChevronRight, Activity, ArrowRight, Bookmark, AlertTriangle } from 'lucide-react';

export default function App() {
  const [activeTab, setActiveTab] = useState<'data' | 'profiles' | 'generation' | 'financials' | 'results'>('results');

  // TOU Saved Rate Profiles & Active Schedule
  const [touProfiles, setTouProfiles] = useState<TouProfile[]>(DEFAULT_TOU_PROFILES);
  const [activeTouProfileId, setActiveTouProfileId] = useState<string>('california-ev2a');
  const [tiers, setTiers] = useState<RateTier[]>(DEFAULT_TOU_PROFILES[0].tiers);
  const [scheduleMatrix, setScheduleMatrix] = useState<ScheduleMatrix>(DEFAULT_TOU_PROFILES[0].scheduleMatrix);

  // Battery Profiles
  const [profiles, setProfiles] = useState<BatteryProfile[]>(DEFAULT_BATTERY_PROFILES);
  const [activeProfileId, setActiveProfileId] = useState<string>('powerwall-3');

  // Power Generation Assets & Site Config (Milestone G1/G3S)
  const [generationConfig, setGenerationConfig] = useState<GenerationConfig>(createDefaultGenerationConfig);
  // Solar surplus export permission (Milestone G3S: independent from battery.allowGridExport)
  const [allowSolarExport, setAllowSolarExport] = useState<boolean>(false);

  // Macro Financials
  const [financials, setFinancials] = useState<MacroFinancials>(DEFAULT_MACRO_FINANCIALS);

  // CSV Energy Usage Data State
  const [csvResult, setCsvResult] = useState<CsvValidationResult | null>(null);

  // Active TOU Profile reference
  const activeTouProfile = useMemo(() => {
    return touProfiles.find((p) => p.id === activeTouProfileId) || touProfiles[0];
  }, [touProfiles, activeTouProfileId]);

  // Initialize with realistic 8,760-hour dataset on mount
  useEffect(() => {
    const { rawCsv } = generateRealistic8760Dataset();
    const parsed = parseAndValidateEnergyCsv(rawCsv);
    setCsvResult(parsed);
  }, []);

  // Handle User CSV Upload
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseAndValidateEnergyCsv(text);
      setCsvResult(parsed);
    };
    reader.readAsText(file);
  };

  // Quick load 8,760h realistic sample
  const handleLoadSample = () => {
    const { rawCsv } = generateRealistic8760Dataset();
    const parsed = parseAndValidateEnergyCsv(rawCsv);
    setCsvResult(parsed);
  };

  // Reset data handler
  const handleResetData = () => {
    setCsvResult(null);
    setTouProfiles(DEFAULT_TOU_PROFILES);
    setActiveTouProfileId('california-ev2a');
    setTiers(DEFAULT_TOU_PROFILES[0].tiers);
    setScheduleMatrix(DEFAULT_TOU_PROFILES[0].scheduleMatrix);
    setProfiles(DEFAULT_BATTERY_PROFILES);
    setActiveProfileId('powerwall-3');
    setGenerationConfig(createDefaultGenerationConfig());
    setAllowSolarExport(false);
    setFinancials(DEFAULT_MACRO_FINANCIALS);
    setActiveTab('data');
  };

  // 1. Unified interval simulation batch for all profiles
  // Directly routes to legacy engine if no generation assets are enabled (exact parity).
  // Routes to generation-aware simulation when generation assets are enabled.
  // Catches invalid/incomplete generation configuration errors without crashing React render.
  const { unifiedResults, simulationError } = useMemo(() => {
    if (!csvResult || !csvResult.isValid || csvResult.data.length === 0) {
      return {
        unifiedResults: {} as Record<string, UnifiedSimulationResult>,
        simulationError: null as string | null,
      };
    }

    try {
      const results: Record<string, UnifiedSimulationResult> = {};
      for (const profile of profiles) {
        results[profile.id] = runUnifiedSimulation({
          dataPoints: csvResult.data,
          intervalHours: csvResult.intervalHours,
          tiers,
          scheduleMatrix,
          batteryProfile: profile,
          seasons: activeTouProfile?.seasons,
          generationConfig,
          allowSolarExport,
        });
      }
      return { unifiedResults: results, simulationError: null };
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : 'Simulation error encountered with current generation configuration.';
      return {
        unifiedResults: {} as Record<string, UnifiedSimulationResult>,
        simulationError: message,
      };
    }
  }, [
    csvResult,
    tiers,
    scheduleMatrix,
    profiles,
    activeTouProfile,
    generationConfig,
    allowSolarExport,
  ]);

  // Derive existing AnnualSimulationSummary map from unified results
  const allSimulationSummaries = useMemo<Record<string, AnnualSimulationSummary>>(() => {
    const summaries: Record<string, AnnualSimulationSummary> = {};
    for (const [id, result] of Object.entries(unifiedResults)) {
      summaries[id] = result.annualSummary;
    }
    return summaries;
  }, [unifiedResults]);

  const isSuitableForAnnual = Boolean(
    csvResult?.completeness ? csvResult.completeness.isSuitableForAnnualProjection : true
  );

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];
  const activeUnifiedResult = unifiedResults[activeProfileId];
  const activeSimulationSummary = allSimulationSummaries[activeProfileId] || null;

  // 1b. Authoritative Generation Project Cost Summary (Milestone G4A)
  const generationProjectCosts = useMemo<GenerationProjectCostSummary>(() => {
    return aggregateGenerationProjectCosts(generationConfig);
  }, [generationConfig]);

  // 1c. 25-Year Operational Projection for the active battery profile only (Milestone G4B)
  // Evaluated ONLY when dataset is suitable for annual projection and generation-aware simulation is active.
  const { activeGenerationOperationalProjection, generationProjectionError } = useMemo(() => {
    if (
      !isSuitableForAnnual ||
      !csvResult ||
      !csvResult.isValid ||
      csvResult.data.length === 0 ||
      !activeUnifiedResult ||
      activeUnifiedResult.mode !== 'generation-aware'
    ) {
      return {
        activeGenerationOperationalProjection: null as GenerationOperationalProjection | null,
        generationProjectionError: null as string | null,
      };
    }

    try {
      const projection = calculateGenerationOperationalProjection({
        dataPoints: csvResult.data,
        intervalHours: csvResult.intervalHours,
        tiers,
        scheduleMatrix,
        batteryProfile: activeProfile,
        seasons: activeTouProfile?.seasons,
        generationConfig,
        allowSolarExport,
        annualElectricityInflationRate: financials.annualElectricityInflationRate,
        annualBatteryDegradationRate: financials.annualBatteryDegradationRate,
      });
      return {
        activeGenerationOperationalProjection: projection,
        generationProjectionError: null,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : 'Failed to calculate generation operational projection.';
      return {
        activeGenerationOperationalProjection: null,
        generationProjectionError: message,
      };
    }
  }, [
    isSuitableForAnnual,
    csvResult,
    activeUnifiedResult,
    tiers,
    scheduleMatrix,
    activeProfile,
    activeTouProfile,
    generationConfig,
    allowSolarExport,
    financials.annualElectricityInflationRate,
    financials.annualBatteryDegradationRate,
  ]);

  // 1d. Lifecycle Financial Analysis for active generation project (Milestone G4C)
  const { activeGenerationAnalysis, generationFinancialError } = useMemo(() => {
    if (
      !activeGenerationOperationalProjection ||
      !isSuitableForAnnual ||
      !activeUnifiedResult ||
      activeUnifiedResult.mode !== 'generation-aware'
    ) {
      return {
        activeGenerationAnalysis: null as GenerationFinancialAnalysis | null,
        generationFinancialError: null as string | null,
      };
    }

    try {
      const analysis = calculateGenerationAwareFinancials({
        batteryProfile: activeProfile,
        operationalProjection: activeGenerationOperationalProjection,
        projectCosts: generationProjectCosts,
        financials,
      });
      return {
        activeGenerationAnalysis: analysis,
        generationFinancialError: null,
      };
    } catch (err: unknown) {
      const message =
        err instanceof Error
          ? err.message
          : typeof err === 'string'
          ? err
          : 'Failed to calculate generation financial lifecycle analysis.';
      return {
        activeGenerationAnalysis: null,
        generationFinancialError: message,
      };
    }
  }, [
    activeGenerationOperationalProjection,
    isSuitableForAnnual,
    activeUnifiedResult,
    activeProfile,
    generationProjectCosts,
    financials,
  ]);

  const generationAnalysisError = generationProjectionError || generationFinancialError;

  // 2. Compute 25-year financial projections ONLY if dataset is suitable for annual projection
  // AND simulation mode is 'legacy' (G4A Safety Gate: generation-aware results do not enter legacy financials)
  const allAnalyses = useMemo<ProfileFinancialAnalysis[]>(() => {
    if (
      !isSuitableForAnnual ||
      !csvResult ||
      !csvResult.isValid ||
      csvResult.data.length === 0 ||
      Object.keys(allSimulationSummaries).length === 0
    ) {
      return [];
    }

    return profiles.flatMap((profile) => {
      const unifiedResult = unifiedResults[profile.id];
      if (!unifiedResult || !shouldCalculateLegacyFinancials(isSuitableForAnnual, unifiedResult.mode)) {
        return [];
      }
      const annualSummary = allSimulationSummaries[profile.id];
      if (!annualSummary) return [];
      return [calculate15YearFinancials(profile, annualSummary, financials)];
    });
  }, [isSuitableForAnnual, csvResult, profiles, unifiedResults, allSimulationSummaries, financials]);

  // Active Profile Analysis (null for partial/unsuitable datasets and generation-aware mode)
  const activeAnalysis = useMemo<ProfileFinancialAnalysis | null>(() => {
    return allAnalyses.find((a) => a.profile.id === activeProfileId) || allAnalyses[0] || null;
  }, [allAnalyses, activeProfileId]);

  const analysisState = useMemo<AnalysisState>(() => {
    return deriveAnalysisState(
      isSuitableForAnnual,
      activeUnifiedResult?.mode,
      Boolean(activeGenerationAnalysis)
    );
  }, [isSuitableForAnnual, activeUnifiedResult, activeGenerationAnalysis]);

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500/20 selection:text-emerald-400">
      {/* 3-Zone Top Navigation Contract */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLoadSampleData={handleLoadSample}
        onResetData={handleResetData}
        hasData={!!csvResult?.isValid}
        totalKwh={csvResult?.totalKwh || 0}
      />

      {/* Main Viewport Container */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Context Breadcrumbs & Quick State Banner */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-6 pb-4 border-b border-slate-800/80 text-xs">
          <div className="flex items-center gap-2 text-slate-400">
            <span className="font-semibold text-slate-200">Simulation Workspace</span>
            <ChevronRight className="h-3.5 w-3.5 text-slate-600" />
            <span className="text-emerald-400 font-medium">
              {activeTab === 'data' && '01. CSV Ingestion & TOU Schedule Matrix'}
              {activeTab === 'profiles' && '02. Battery Profiles & Hardware Strategy'}
              {activeTab === 'generation' && '03. On-Site Power Generation'}
              {activeTab === 'financials' && '04. Incentives, Escalation & Degradation'}
              {activeTab === 'results' && '05. Results, Cash Flow & Dispatch'}
            </span>
          </div>

          {analysisState === 'legacy-financial' && activeAnalysis ? (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-400">
              <span className="flex items-center gap-1">
                <Bookmark className="h-3 w-3 text-emerald-400" />
                Tariff:{' '}
                <strong className="text-slate-200">{activeTouProfile.name}</strong>
              </span>
              <span>·</span>
              <span>
                Battery:{' '}
                <strong className="text-slate-200">{activeProfile.name}</strong>
              </span>
              <span>·</span>
              <span>
                {getHeaderSavingsLabel(true)}:{' '}
                <strong className="text-emerald-400 font-mono">
                  ${activeAnalysis.year1Savings.toLocaleString()}/yr
                </strong>
              </span>
              <span>·</span>
              <span>
                Payback:{' '}
                <strong className="text-amber-300 font-mono">
                  {getHeaderPaybackText(activeAnalysis, true)}
                </strong>
              </span>
            </div>
          ) : analysisState === 'generation-financial' && activeGenerationAnalysis ? (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-400">
              <span className="flex items-center gap-1">
                <Bookmark className="h-3 w-3 text-emerald-400" />
                Tariff:{' '}
                <strong className="text-slate-200">{activeTouProfile.name}</strong>
              </span>
              <span>·</span>
              <span>
                Project:{' '}
                <strong className="text-slate-200">{activeProfile.name} + Generation</strong>
              </span>
              <span>·</span>
              <span>
                {getHeaderSavingsLabel(true)}:{' '}
                <strong className="text-emerald-400 font-mono">
                  ${activeGenerationAnalysis.year1ElectricitySavingsUsd.toLocaleString()}/yr
                </strong>
              </span>
              <span>·</span>
              <span>
                Payback:{' '}
                <strong className="text-amber-300 font-mono">
                  {activeGenerationAnalysis.paybackFormatted}
                </strong>
              </span>
            </div>
          ) : activeSimulationSummary ? (
            <div className="flex flex-wrap items-center gap-2 sm:gap-3 text-slate-400">
              <span className="flex items-center gap-1">
                <Bookmark className="h-3 w-3 text-emerald-400" />
                Tariff:{' '}
                <strong className="text-slate-200">{activeTouProfile.name}</strong>
              </span>
              <span>·</span>
              <span>
                Battery:{' '}
                <strong className="text-slate-200">{activeProfile.name}</strong>
              </span>
              <span>·</span>
              <span>
                {getHeaderSavingsLabel(isSuitableForAnnual)}:{' '}
                <strong className="text-emerald-400 font-mono">
                  {isSuitableForAnnual
                    ? `$${activeSimulationSummary.year1Savings.toLocaleString()}/yr`
                    : `$${(activeSimulationSummary.periodSavings ?? activeSimulationSummary.year1Savings).toLocaleString()}`}
                </strong>
              </span>
              {analysisState === 'generation-financial-pending' && (
                <>
                  <span>·</span>
                  <span className="text-sky-400 font-mono text-[11px] bg-sky-950/60 border border-sky-500/30 px-2 py-0.5 rounded">
                    Lifecycle Finance Unavailable
                  </span>
                </>
              )}
            </div>
          ) : null}
        </div>

        {/* Simulation Configuration Error Callout */}
        {simulationError && (
          <div className="mb-6 rounded-xl border border-rose-500/40 bg-rose-950/20 p-4 sm:p-5 flex items-start gap-3 sm:gap-4 shadow-sm animate-fadeIn">
            <div className="p-2 rounded-lg bg-rose-500/10 border border-rose-500/20 text-rose-400 shrink-0">
              <AlertTriangle className="h-5 w-5" />
            </div>
            <div className="flex-1 text-xs text-rose-200/90 leading-relaxed">
              <div className="flex items-center gap-2 mb-1">
                <span className="font-semibold text-rose-100 text-sm">
                  Simulation Configuration Error
                </span>
                <span className="px-2 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-rose-500/20 text-rose-300 border border-rose-500/30">
                  Calculation Paused
                </span>
              </div>
              <p className="font-mono text-rose-300 bg-rose-950/40 px-2.5 py-1.5 rounded border border-rose-900/30 my-1.5">
                {simulationError}
              </p>
              <p className="text-slate-400 text-[11px]">
                Please review your generation asset configurations and site parameters in the On-Site Power Generation tab. Once valid, simulation calculations will resume automatically.
              </p>
            </div>
          </div>
        )}

        {/* Tab 1: Data & Rates */}
        {activeTab === 'data' && (
          <DataAndRatesTab
            csvResult={csvResult}
            onFileUpload={handleFileUpload}
            onLoadSample={handleLoadSample}
            touProfiles={touProfiles}
            setTouProfiles={setTouProfiles}
            activeTouProfileId={activeTouProfileId}
            setActiveTouProfileId={setActiveTouProfileId}
            tiers={tiers}
            setTiers={setTiers}
            scheduleMatrix={scheduleMatrix}
            setScheduleMatrix={setScheduleMatrix}
          />
        )}

        {/* Tab 2: Battery Profiles */}
        {activeTab === 'profiles' && (
          <BatteryProfilesTab
            profiles={profiles}
            setProfiles={setProfiles}
            activeProfileId={activeProfileId}
            setActiveProfileId={setActiveProfileId}
            tiers={tiers}
          />
        )}

        {/* Tab 3: Power Generation */}
        {activeTab === 'generation' && (
          <PowerGenerationTab
            generationConfig={generationConfig}
            setGenerationConfig={setGenerationConfig}
            allowSolarExport={allowSolarExport}
            setAllowSolarExport={setAllowSolarExport}
          />
        )}

        {/* Tab 4: Financials & Settings */}
        {activeTab === 'financials' && (
          <FinancialSettingsTab
            financials={financials}
            setFinancials={setFinancials}
            activeProfile={activeProfile}
          />
        )}

        {/* Tab 5: Results & Analytics */}
        {activeTab === 'results' && (
          <ResultsAnalyticsTab
            activeAnalysis={activeAnalysis}
            allAnalyses={allAnalyses}
            activeSimulationSummary={activeSimulationSummary}
            allSimulationSummaries={allSimulationSummaries}
            activeProfile={activeProfile}
            setActiveProfileId={setActiveProfileId}
            tiers={tiers}
            activeTouProfile={activeTouProfile}
            financials={financials}
            csvResult={csvResult}
            analysisState={analysisState}
            activeGenerationAnalysis={activeGenerationAnalysis}
            activeGenerationOperationalProjection={activeGenerationOperationalProjection}
            activeGenerationAwareResult={activeUnifiedResult?.mode === 'generation-aware' ? activeUnifiedResult.generationAwareResult ?? null : null}
            generationProjectCosts={generationProjectCosts}
            generationAnalysisError={generationAnalysisError}
            generationConfig={generationConfig}
            allowSolarExport={allowSolarExport}
          />
        )}

        {/* Tab Navigation Footer Bar */}
        <div className="mt-12 pt-6 border-t border-slate-800/80 flex items-center justify-between text-xs text-slate-400">
          <div>
            {activeTab !== 'data' && (
              <button
                onClick={() => {
                  if (activeTab === 'results') setActiveTab('financials');
                  else if (activeTab === 'financials') setActiveTab('generation');
                  else if (activeTab === 'generation') setActiveTab('profiles');
                  else if (activeTab === 'profiles') setActiveTab('data');
                }}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
              >
                ← Previous Step
              </button>
            )}
          </div>

          <div>
            {activeTab !== 'results' ? (
              <button
                onClick={() => {
                  if (activeTab === 'data') setActiveTab('profiles');
                  else if (activeTab === 'profiles') setActiveTab('generation');
                  else if (activeTab === 'generation') setActiveTab('financials');
                  else if (activeTab === 'financials') setActiveTab('results');
                }}
                className="flex items-center gap-1.5 px-4 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold transition-colors shadow-sm shadow-emerald-950"
              >
                <span>Continue to Next Step</span>
                <ArrowRight className="h-3.5 w-3.5" />
              </button>
            ) : (
              <button
                onClick={() => setActiveTab('data')}
                className="px-3 py-1.5 rounded-lg bg-slate-900 hover:bg-slate-800 text-slate-300 border border-slate-800 transition-colors"
              >
                Back to Data & Rates
              </button>
            )}
          </div>
        </div>
      </main>

      {/* Quiet Non-Intrusive Footer */}
      <footer className="border-t border-slate-900 bg-slate-950 py-6 mt-16 text-center text-xs text-slate-500">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className="font-semibold text-slate-400">VoltWise Engine</span>
            <span>·</span>
            <span>8,760-Hour Dispatch & Financial Lifecycle Simulator</span>
          </div>
          <div className="text-slate-500">
            Client-side calculation engine · Zero telemetry
          </div>
        </div>
      </footer>
    </div>
  );
}
