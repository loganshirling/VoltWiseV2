/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useState, useMemo, useEffect, useRef } from 'react';
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
  GenerationConfig,
  AnalysisState,
  GenerationProjectCostSummary,
  LoadDataSource,
  ProjectArchiveState,
  ValidatedProjectState,
} from './types/energy';
import {
  DEFAULT_BATTERY_PROFILES,
  DEFAULT_MACRO_FINANCIALS,
  DEFAULT_RATE_TIERS,
  DEFAULT_TOU_PROFILES,
  ScheduleMatrix,
  createDefaultScheduleMatrix,
  getHeaderSavingsLabel,
  getHeaderPaybackText,
} from './utils/simulationEngine';
import { createDefaultGenerationConfig } from './utils/generationDefaults';
import {
  deriveAnalysisState,
  aggregateGenerationProjectCosts,
} from './utils/generationFinancials';
import { generateRealistic8760Dataset } from './utils/sampleData';
import { parseAndValidateEnergyCsv } from './utils/csvParser';
import { evaluateLoadTimestampEligibility } from './utils/loadTimeAlignment';
import { createSimulationWorkerClient, SimulationRunResult, SimulationTaskHandle } from './utils/simulationWorkerClient';
import { SimulationJobInput, SimulationJobResult } from './utils/simulationWorkerJob';
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
  const [loadDataCsv, setLoadDataCsv] = useState<string | null>(null);
  const [loadDataSource, setLoadDataSource] = useState<LoadDataSource | null>(null);
  const [simulationWorkerClient] = useState(() => createSimulationWorkerClient());
  const simulationRequestId = useRef(0);
  const [simulationWorkerState, setSimulationWorkerState] = useState<{
    input: SimulationJobInput | null;
    status: 'idle' | 'pending' | 'completed' | 'error';
    progress: number;
    stage: string;
    output: SimulationJobResult | null;
    error: string | null;
  }>({ input: null, status: 'idle', progress: 0, stage: '', output: null, error: null });

  // Active TOU Profile reference
  const activeTouProfile = useMemo(() => {
    return touProfiles.find((p) => p.id === activeTouProfileId) || touProfiles[0];
  }, [touProfiles, activeTouProfileId]);

  // Initialize with realistic 8,760-hour dataset on mount
  useEffect(() => {
    const { rawCsv } = generateRealistic8760Dataset();
    const parsed = parseAndValidateEnergyCsv(rawCsv);
    setCsvResult(parsed);
    setLoadDataCsv(rawCsv);
    setLoadDataSource('synthetic_sample');
  }, []);

  // Handle User CSV Upload
  const handleFileUpload = (file: File) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const text = e.target?.result as string;
      const parsed = parseAndValidateEnergyCsv(text);
      setCsvResult(parsed);
      setLoadDataCsv(text);
      setLoadDataSource('uploaded');
    };
    reader.readAsText(file);
  };

  // Quick load 8,760h realistic sample
  const handleLoadSample = () => {
    const { rawCsv } = generateRealistic8760Dataset();
    const parsed = parseAndValidateEnergyCsv(rawCsv);
    setCsvResult(parsed);
    setLoadDataCsv(rawCsv);
    setLoadDataSource('synthetic_sample');
  };

  // Reset data handler
  const handleResetData = () => {
    setCsvResult(null);
    setLoadDataCsv(null);
    setLoadDataSource(null);
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

  const siteLoadAlignmentEligibility = useMemo(() => {
    if (
      !csvResult?.schemaValid ||
      !csvResult.chronologicallyValid ||
      !csvResult.operationallySimulatable ||
      !generationConfig.site.timeZone.trim()
    ) {
      return null;
    }
    return evaluateLoadTimestampEligibility(
      csvResult.data,
      csvResult.intervalHours,
      generationConfig.site.timeZone
    );
  }, [csvResult, generationConfig]);

  const isSuitableForAnnual = Boolean(
    csvResult?.annualProjectionEligible &&
    siteLoadAlignmentEligibility?.operationallySimulatable !== false
  );

  const simulationInput = useMemo<SimulationJobInput | null>(() => {
    if (!csvResult || !csvResult.schemaValid || !csvResult.chronologicallyValid || csvResult.data.length === 0) {
      return null;
    }

    let preflightError: string | null = null;
    if (!csvResult.operationallySimulatable) {
      preflightError = 'Load data contains missing or irregular intervals. Upload a continuous interval sequence before running a simulation.';
    } else if (siteLoadAlignmentEligibility && !siteLoadAlignmentEligibility.operationallySimulatable) {
      preflightError = siteLoadAlignmentEligibility.reason || 'Load timestamps are not valid for the selected site timezone.';
    }

    return {
      dataPoints: csvResult.data,
      intervalHours: csvResult.intervalHours,
      profiles,
      activeProfileId,
      tiers,
      scheduleMatrix,
      seasons: activeTouProfile?.seasons,
      generationConfig,
      allowSolarExport,
      annualProjectionEligible: isSuitableForAnnual,
      preflightError,
      financials,
    };
  }, [
    csvResult,
    profiles,
    activeProfileId,
    tiers,
    scheduleMatrix,
    activeTouProfile,
    generationConfig,
    allowSolarExport,
    siteLoadAlignmentEligibility,
    isSuitableForAnnual,
    financials,
  ]);

  useEffect(() => {
    if (!simulationInput) {
      setSimulationWorkerState({ input: null, status: 'idle', progress: 0, stage: '', output: null, error: null });
      return;
    }

    let cancelled = false;
    let task: SimulationTaskHandle | null = null;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      try {
        task = simulationWorkerClient.run(simulationInput, (progress, stage) => {
          if (cancelled || task?.requestId !== simulationRequestId.current) return;
          setSimulationWorkerState((current) => current.input === simulationInput
            ? { ...current, progress, stage }
            : current);
        });
        simulationRequestId.current = task.requestId;
        task.promise.then((result: SimulationRunResult) => {
          if (cancelled || task?.requestId !== simulationRequestId.current || result.status === 'cancelled') return;
          if (result.status === 'completed') {
            setSimulationWorkerState({ input: simulationInput, status: 'completed', progress: 100, stage: 'complete', output: result.result, error: null });
          } else {
            setSimulationWorkerState({ input: simulationInput, status: 'error', progress: 100, stage: 'error', output: null, error: result.message });
          }
        });
      } catch (error) {
        setSimulationWorkerState({
          input: simulationInput,
          status: 'error',
          progress: 100,
          stage: 'error',
          output: null,
          error: error instanceof Error ? error.message : 'Simulation worker could not be started.',
        });
      }
    }, 100);

    setSimulationWorkerState({ input: simulationInput, status: 'pending', progress: 0, stage: 'Preparing calculation', output: null, error: null });
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      task?.cancel();
    };
  }, [simulationInput]);

  const currentSimulationState = simulationWorkerState.input === simulationInput ? simulationWorkerState : null;
  const simulationPending = Boolean(simulationInput && (!currentSimulationState || currentSimulationState.status === 'pending'));
  const simulationOutput = currentSimulationState?.status === 'completed' ? currentSimulationState.output : null;
  const simulationError = simulationOutput?.simulationError || currentSimulationState?.error || null;
  const allSimulationSummaries = simulationOutput?.allSimulationSummaries ?? {};
  const allAnalyses = simulationOutput?.allAnalyses ?? [];
  const activeUnifiedResult = simulationOutput?.activeUnifiedResult ?? null;
  const activeGenerationOperationalProjection = simulationOutput?.activeGenerationOperationalProjection ?? null;
  const generationProjectionError = simulationOutput?.generationProjectionError ?? null;
  const activeGenerationAnalysis = simulationOutput?.activeGenerationAnalysis ?? null;
  const generationFinancialError = simulationOutput?.generationFinancialError ?? null;

  const activeProfile = profiles.find((p) => p.id === activeProfileId) || profiles[0];
  const activeSimulationSummary = allSimulationSummaries[activeProfileId] || null;

  // 1b. Authoritative Generation Project Cost Summary (Milestone G4A)
  const generationProjectCosts = useMemo<GenerationProjectCostSummary>(() => {
    return aggregateGenerationProjectCosts(generationConfig);
  }, [generationConfig]);

  const generationAnalysisError = generationProjectionError || generationFinancialError;

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

  const handleProjectLoaded = (project: ValidatedProjectState) => {
    setProfiles(project.profiles);
    setActiveProfileId(project.activeProfileId);
    setTouProfiles(project.touProfiles);
    setActiveTouProfileId(project.activeTouProfileId);
    setTiers(project.tiers);
    setScheduleMatrix(project.scheduleMatrix as ScheduleMatrix);
    setGenerationConfig(project.generationConfig);
    setAllowSolarExport(project.allowSolarExport);
    setFinancials(project.financials);
    setLoadDataCsv(project.loadDataCsv);
    setLoadDataSource(project.loadDataSource);
    setCsvResult(project.csvResult);
    setActiveTab('data');
  };

  const projectState: ProjectArchiveState = {
    profiles,
    activeProfileId,
    touProfiles,
    activeTouProfileId,
    tiers,
    scheduleMatrix,
    generationConfig,
    allowSolarExport,
    financials,
    loadDataCsv,
    loadDataSource,
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-950 text-slate-100 selection:bg-emerald-500/20 selection:text-emerald-400">
      {/* 3-Zone Top Navigation Contract */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        onLoadSampleData={handleLoadSample}
        onResetData={handleResetData}
        hasData={Boolean(csvResult?.operationallySimulatable)}
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

        {simulationPending && (
          <div role="status" aria-live="polite" className="mb-4 flex items-center gap-3 rounded-xl border border-sky-500/30 bg-sky-950/25 px-4 py-3 text-sm text-sky-100">
            <span className="h-2 w-2 animate-pulse rounded-full bg-sky-400" aria-hidden="true" />
            <span className="font-medium">Updating simulation in the background</span>
            <span className="ml-auto text-xs text-sky-300">{currentSimulationState?.stage || 'Preparing calculation'} · {currentSimulationState?.progress ?? 0}%</span>
          </div>
        )}

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
                Review the uploaded interval data and, when generation assets are enabled, confirm the site timezone and asset settings. Calculations resume automatically when the inputs are valid.
              </p>
            </div>
          </div>
        )}

        {/* Tab 1: Data & Rates */}
        {activeTab === 'data' && (
          <DataAndRatesTab
            csvResult={csvResult}
            loadDataSource={loadDataSource}
            projectState={projectState}
            onProjectLoaded={handleProjectLoaded}
            siteAlignmentEligibility={siteLoadAlignmentEligibility}
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
            generationProjectCosts={generationProjectCosts}
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
            loadDataSource={loadDataSource}
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
