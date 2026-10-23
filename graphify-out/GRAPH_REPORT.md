# Graph Report - VoltWiseV2  (2026-10-23)

## Corpus Check
- 309 files · ~353,303 words
- Verdict: corpus is large enough that graph structure adds value.
- Unclassified: 13 file(s) not represented in the graph (top: (none) 8, .dot 1, .example 1)

## Graph Health
- Integrity warnings: 39 dangling-endpoint edges and 2 self-loops; 220 undirected endpoint-collapsed edges were detected during build diagnostics. Treat affected paths as potentially incomplete.
- Token usage: unavailable because the agent runtime did not expose usage metadata.

## Summary
- 1499 nodes · 3555 edges · 188 communities (69 shown, 119 thin omitted)
- Extraction: 98% EXTRACTED · 2% INFERRED · 0% AMBIGUOUS · INFERRED: 56 edges (avg confidence: 0.8)
- Token cost: unavailable (agent usage metadata was not exposed)

## Community Hubs (Navigation)
- Solar Profile
- Scripts Server
- Generator Routing Integration
- Export Json
- Tariff Cost Accounting
- Project Archive
- Power Generation Tab
- Generation Results
- Generator Model
- Workflows Release
- Components Energy
- Generator Projection And Finance
- Compression Evaluator
- Data And Rates Tab
- Package Module
- Simulation Worker Client
- Sequential Battery Flow
- Solar Battery Charging
- Energy Module
- Simulation Engine
- Generation Financials
- Filesystem Context
- Defense In Depth
- E2E Smoke
- Filesystem Context 2
- Project Archive 2
- Load Time Alignment
- Scripts Compaction
- Tsconfig Module
- Compression Evaluator 2
- Package Module 2
- Export Aware Battery Flow
- Browser Testing
- Context Compression
- Scripts Compaction 2
- Integrated Battery Flow
- Csv Parser
- Workflows Ci
- Benchmark Simulation
- Compression Evaluator 3
- Scripts Compaction 3
- Package Module 3
- Vercel React Best Practices 5
- With Server
- Workflows Ci 2
- Scripts Helper
- Compression Evaluator 4
- Workflows Ci 3
- Generation Defaults
- Workflows Ci 4
- Package Module 4
- Generation Labels
- Simulation Worker
- Sample Data
- Stop Server
- Compression Evaluator 5
- Implementation Patterns
- Executing Plans
- Code Reviewer
- Vercel React Best Practices 8
- Filesystem Context 3
- Anthropic Best Practices
- Workflows Ci 5
-  Module
- Scripts Compaction 4
- Scripts Compaction 5
- Dispatching Parallel Agents
- Finishing A Development Branch
- Cost And Time
- Workflows Ci 6
- Workflows Ci 7
- Start Server
- Brainstorming Module
- Analyst Common
- Plan Adherence
- Quality Evidence
- Prompts Scrub
- Prompts Timeline
- Templates Bundle
- Templates Case
- Templates Report
- Frame Template
- Diagnosing Superpowers
- Find Polluter
- Repeated Work
- Request Conflicts
- Scrub Audit
- Similar Session
- Prompts Stumbles
- Context Safety
- Github Issues
- Redaction Policy
- Session Discovery
- Templates Issue
- Anthropic Upstream
- Vercel Upstream
- Agents Module
- Builder Check Prompt
- Agents Skills
- Agents Skills 2
- Frontend Design License
- Frontend Design
- Ponytail Module
- Systematic Debugging Academic
- Pressure 1
- Pressure 2
- Pressure 3
- Using Git Worktrees
- Antigravity Tools
- Claude Code Tools
- Codex Tools
- Gemini Tools
- Hermes Tools
- Muse Tools
- Pi Tools
- Verification Before Completion
- Voltwise Development Context
- Voltwise Ux
- Web Design Guidelines
- Webapp Testing License
- Webapp Testing
- Writing Plans
- 2026 10 12 Production
-  Module 2

## God Nodes (most connected - your core abstractions)
1. `BatteryProfile` - 62 edges
2. `vitest` - 53 edges
3. `RateTier` - 39 edges
4. `GenerationConfig` - 34 edges
5. `IntervalDataPoint` - 31 edges
6. `SolarGenerationAsset` - 27 edges
7. `BatterySocProvenanceState` - 27 edges
8. `fail()` - 26 edges
9. `GeneratorGenerationAsset` - 25 edges
10. `GenerationAwareSimulationResult` - 25 edges

## Surprising Connections (you probably didn't know these)
- `runScenario()` --calls--> `createDefaultScheduleMatrix()`  [EXTRACTED]
  scripts/benchmark-simulation.ts → src/utils/simulationEngine.ts
- `runScenario()` --calls--> `attachGenerationProjection()`  [EXTRACTED]
  scripts/benchmark-simulation.ts → src/utils/simulationWorkerJob.ts
- `runScenario()` --calls--> `executeSimulationJob()`  [EXTRACTED]
  scripts/benchmark-simulation.ts → src/utils/simulationWorkerJob.ts
- `Use Lazy State Initialization` --semantically_similar_to--> `Extract to Memoized Components`  [INFERRED] [semantically similar]
  .agents/skills/vercel-react-best-practices/rules/rerender-lazy-state-init.md → .agents/skills/vercel-react-best-practices/rules/rerender-memo.md
- `Extract Default Non-primitive Parameter Value from Memoized Component to Constant` --semantically_similar_to--> `Extract to Memoized Components`  [INFERRED] [semantically similar]
  .agents/skills/vercel-react-best-practices/rules/rerender-memo-with-default-value.md → .agents/skills/vercel-react-best-practices/rules/rerender-memo.md

## Import Cycles
- None detected.

## Hyperedges (group relationships)
- **Waterfall Reduction Patterns** — agents_skills_vercel_react_best_practices_agents_promise_all_independent_operations, agents_skills_vercel_react_best_practices_agents_strategic_suspense_boundaries, agents_skills_vercel_react_best_practices_agents_dependency_based_parallelization [INFERRED 0.75]
- **React Render Efficiency Patterns** — agents_skills_vercel_react_best_practices_agents_calculate_derived_state, agents_skills_vercel_react_best_practices_agents_functional_setstate_updates, agents_skills_vercel_react_best_practices_agents_use_deferred_value_expensive_renders [INFERRED 0.75]
- **Runtime Resource Efficiency Patterns** — agents_skills_vercel_react_best_practices_agents_content_visibility_long_lists, agents_skills_vercel_react_best_practices_agents_react_dom_resource_hints, agents_skills_vercel_react_best_practices_agents_request_idle_callback [INFERRED 0.75]
- **Context Management Strategies** — agents_skills_context_compression_skill_context_compression, agents_skills_context_optimization_skill_context_optimization, agents_skills_context_compression_references_evaluation_framework_probe_based_evaluation [INFERRED 0.75]
- **Filesystem context implementation patterns** — filesystem_context_references_implementation_patterns_scratch_pad_manager, filesystem_context_references_implementation_patterns_plan_persistence, filesystem_context_references_implementation_patterns_agent_workspace, filesystem_context_references_implementation_patterns_dynamic_skill_loader, filesystem_context_references_implementation_patterns_terminal_capture, filesystem_context_references_implementation_patterns_preference_store, filesystem_context_references_implementation_patterns_token_accounting_metrics [EXTRACTED 1.00]
- **Session diagnosis dimensions** — diagnosing_superpowers_prompts_plan_adherence_plan_recovery, diagnosing_superpowers_prompts_plan_adherence_execution_mapping, diagnosing_superpowers_prompts_plan_adherence_structural_events, diagnosing_superpowers_prompts_quality_evidence_test_evidence, diagnosing_superpowers_prompts_quality_evidence_verification_claims, diagnosing_superpowers_prompts_quality_evidence_acceptance_criteria, diagnosing_superpowers_prompts_stumbles_failure_analysis, diagnosing_superpowers_prompts_stumbles_recovery_tracking [EXTRACTED 1.00]
- **Four Phases of Systematic Debugging** — agents_skills_systematic_debugging_skill_root_cause_investigation, agents_skills_systematic_debugging_skill_pattern_analysis, agents_skills_systematic_debugging_skill_hypothesis_and_testing, agents_skills_systematic_debugging_skill_root_cause_implementation [EXTRACTED 1.00]
- **Eight performance rule categories in the Vercel React Best Practices guide** — agents_skills_vercel_react_best_practices_skill_async_category, agents_skills_vercel_react_best_practices_skill_bundle_category, agents_skills_vercel_react_best_practices_skill_server_category, agents_skills_vercel_react_best_practices_skill_client_category, agents_skills_vercel_react_best_practices_skill_rerender_category, agents_skills_vercel_react_best_practices_skill_rendering_category, agents_skills_vercel_react_best_practices_skill_js_category, agents_skills_vercel_react_best_practices_skill_advanced_category [EXTRACTED 1.00]
- **React re-render optimization patterns** — agents_skills_vercel_react_best_practices_rules_rerender_derived_state_rerender_derived_state, agents_skills_vercel_react_best_practices_rules_rerender_functional_setstate_rerender_functional_setstate, agents_skills_vercel_react_best_practices_rules_rerender_lazy_state_init_rerender_lazy_state_init, agents_skills_vercel_react_best_practices_rules_rerender_memo_with_default_value_rerender_memo_with_default_value, agents_skills_vercel_react_best_practices_rules_rerender_memo_rerender_memo, agents_skills_vercel_react_best_practices_rules_rerender_move_effect_to_event_rerender_move_effect_to_event, agents_skills_vercel_react_best_practices_rules_rerender_no_inline_components_rerender_no_inline_components, agents_skills_vercel_react_best_practices_rules_rerender_simple_expression_in_memo_rerender_simple_expression_in_memo, agents_skills_vercel_react_best_practices_rules_rerender_split_combined_hooks_rerender_split_combined_hooks, agents_skills_vercel_react_best_practices_rules_rerender_transitions_rerender_transitions, agents_skills_vercel_react_best_practices_rules_rerender_use_deferred_value_rerender_use_deferred_value, agents_skills_vercel_react_best_practices_rules_rerender_use_ref_transient_values_rerender_use_ref_transient_values [EXTRACTED 1.00]
- **React server performance and data handling patterns** — agents_skills_vercel_react_best_practices_rules_server_after_nonblocking_server_after_nonblocking, agents_skills_vercel_react_best_practices_rules_server_auth_actions_server_auth_actions, agents_skills_vercel_react_best_practices_rules_server_cache_lru_server_cache_lru, agents_skills_vercel_react_best_practices_rules_server_cache_react_server_cache_react, agents_skills_vercel_react_best_practices_rules_server_dedup_props_server_dedup_props, agents_skills_vercel_react_best_practices_rules_server_hoist_static_io_server_hoist_static_io, agents_skills_vercel_react_best_practices_rules_server_no_shared_module_state_server_no_shared_module_state, agents_skills_vercel_react_best_practices_rules_server_parallel_fetching_server_parallel_fetching, agents_skills_vercel_react_best_practices_rules_server_parallel_nested_fetching_server_parallel_nested_fetching, agents_skills_vercel_react_best_practices_rules_server_serialization_server_serialization [EXTRACTED 1.00]
- **VoltWise release qualification evidence** — docs_production_readiness_handoff_cloud_completion_handoff, docs_g7_final_audit_final_g7_evidence_review, docs_browser_testing_browser_smoke_tests, docs_performance_budget_simulation_performance_budget, docs_release_runbook_ci_and_release_runbook [EXTRACTED 1.00]

## Communities (188 total, 119 thin omitted)

### Community 0 - "Solar Profile"
Cohesion: 0.07
Nodes (54): asset(), ExternalResourceMetadata, GenerationSite, MonthlyPeakSunHourSolarInterval, SolarGenerationInterval, SolarGenerationProfileSummary, SolarIntervalGenerationResult, SolarIrradianceDataset (+46 more)

### Community 1 - "Scripts Server"
Cohesion: 0.05
Nodes (58): bootstrapPage(), brandMarkup(), broadcast(), browserLauncherForPlatform(), chmodOwnerOnly(), clients, companionUrl(), computeAcceptKey() (+50 more)

### Community 2 - "Generator Routing Integration"
Cohesion: 0.10
Nodes (26): BatteryProfilesTabProps, buildSimulationParams(), createClearSkyAsset(), createDataPoints(), createScheduleMatrix(), createTestBattery(), baseSite, defaultTiers (+18 more)

### Community 3 - "Export Json"
Cohesion: 0.13
Nodes (36): ResultsAnalyticsContent(), ResultsAnalyticsContentProps, ResultsAnalyticsTabProps, AnalysisState, CsvValidationResult, GenerationFinancialAnalysis, GenerationOperationalProjection, GenerationProjectCostSummary (+28 more)

### Community 4 - "Tariff Cost Accounting"
Cohesion: 0.12
Nodes (23): createMockExportAwareInterval(), createMockIntegratedInterval(), createMockExportAwareInterval(), createMockIntegratedInterval(), DEFAULT_TIERS, DEFAULT_TIERS, ExportAwareBatteryFlowInterval, GridFlowInterval (+15 more)

### Community 5 - "Project Archive"
Cohesion: 0.24
Nodes (32): assertProjectArchiveWithinBudget(), buildProjectArchive(), CURRENT_PROJECT_ARCHIVE_VERSION, fail(), isRecord(), measureProjectArchiveSize(), parseProjectArchive(), prepareProjectArchive() (+24 more)

### Community 6 - "Power Generation Tab"
Cohesion: 0.11
Nodes (29): createAssetId(), GeneratorAssetConfigurator(), GeneratorConfiguratorProps, getExternalResourceId(), InfoTooltip(), MONTH_NAMES, PowerGenerationTab(), PowerGenerationTabProps (+21 more)

### Community 7 - "Generation Results"
Cohesion: 0.11
Nodes (23): aggregateGenerationProjectCosts(), calculateGenerationAwareFinancials(), shouldCalculateLegacyFinancials(), formatAggregateGeneratorFuel(), formatGeneratorFuelAssetSummaries(), formatKwh(), formatPercent(), formatSolarDegradationClause() (+15 more)

### Community 8 - "Generator Model"
Cohesion: 0.17
Nodes (27): createSampleGenerator(), createTestScheduleMatrix(), createValidEnabledGenerator(), GeneratorFuelCurvePoint, GeneratorGenerationAsset, allocateScheduledGenerators(), calculateReferenceVariableCostPerKwh(), dispatchGeneratorInterval() (+19 more)

### Community 10 - "Workflows Release"
Cohesion: 0.07
Nodes (28): RELEASE_SHA, RELEASE_TAG, jobs, package, qualify, name, needs, runs-on (+20 more)

### Community 11 - "Components Energy"
Cohesion: 0.11
Nodes (25): FinancialSettingsTabProps, BatteryGridChargeDirective, BatteryLoadDischargeResult, GenerationAssetCostBreakdown, GenerationHorizonFinancialSummary, GenerationOperationalYear, GenerationProjectFinancialYear, GenerationTypeCostBreakdown (+17 more)

### Community 12 - "Generator Projection And Finance"
Cohesion: 0.14
Nodes (13): runScenario(), GenerationAssetBase, SolarAssetProjectionState, SolarGenerationAsset, WindGenerationAsset, calculateGenerationOperationalProjection(), deriveBatteryProfileForProjectionYear(), deriveGenerationConfigForProjectionYear() (+5 more)

### Community 13 - "Compression Evaluator"
Cohesion: 0.11
Nodes (5): CompressionEvaluator, collect(), CriterionResult, evaluate_compression_quality(), Probe

### Community 14 - "Data And Rates Tab"
Cohesion: 0.14
Nodes (22): DataAndRatesTab(), DataAndRatesTabProps, isLifecycleProjectionReady(), isSimulationReady(), MONTH_FULL, MONTH_SHORT, SEASON_THEMES, ProjectFileControls() (+14 more)

### Community 15 - "Package Module"
Cohesion: 0.11
Nodes (23): description, devDependencies, autoprefixer@^10.4.21, esbuild@^0.25.0, tailwindcss@^4.3.3, tsx@^4.21.0, @types/node@^22.14.0, @types/react@^19.3.0 (+15 more)

### Community 16 - "Simulation Worker Client"
Cohesion: 0.16
Nodes (17): lucide-react, react, App(), fingerprintProjectState(), BatteryProfilesTab(), InfoTooltip(), FinancialSettingsTab(), Navbar() (+9 more)

### Community 17 - "Sequential Battery Flow"
Cohesion: 0.14
Nodes (12): defaultProfile, zeroBatteryState, zeroCostBasis, BatteryDischargeDirective, BatterySocProvenanceState, GridBatteryExportResult, SequentialBatteryFlowInterval, SequentialBatteryFlowResult (+4 more)

### Community 18 - "Solar Battery Charging"
Cohesion: 0.19
Nodes (13): GridBatteryChargeResult, SolarBatteryChargeInterval, SolarBatteryChargeResult, routeExportAwareBatteryFlow(), simulateGeneratorAwareOperationalFlow(), chargeBatteryFromGrid(), exportGridChargedBatteryEnergy(), routeIntegratedBatteryFlow() (+5 more)

### Community 19 - "Energy Module"
Cohesion: 0.25
Nodes (16): BatteryDispatchPolicyInterval, ExportAwareBatteryFlowResult, GeneratorAssetAnnualSummary, GridFlowResult, RenewableLoadFlowInterval, ResolvedTariffRateInterval, SolarFleetGenerationInterval, TariffCostResult (+8 more)

### Community 20 - "Simulation Engine"
Cohesion: 0.24
Nodes (15): vitest, AnnualSimulationSummary, DatasetCompleteness, DeriveAnalysisStateParams, calculateOpportunityCostBenchmark(), OpportunityCostBenchmarkInput, OpportunityCostBenchmarkResult, OpportunityCostYear (+7 more)

### Community 21 - "Generation Financials"
Cohesion: 0.11
Nodes (13): createSolarAsset(), simulateAppMemo(), createMockOperationalYear(), createMockProjection(), makeGenerator(), makeSolar(), makeWind(), GenerationOperationalProjectionResult (+5 more)

### Community 22 - "Filesystem Context"
Cohesion: 0.14
Nodes (4): _demo_scratch_pad(), _demo_tool_handler(), ScratchPadManager, ToolOutputHandler

### Community 23 - "Defense In Depth"
Cohesion: 0.10
Nodes (21): Ponytail Audit, Ponytail Review, Code Review Reception, Condition-Based Waiting, Systematic Debugging Skill Creation Log, Business Logic Validation, Debug Instrumentation, Defense-in-Depth Validation (+13 more)

### Community 24 - "E2E Smoke"
Cohesion: 0.11
Nodes (10): openGenerationWithSolar(), openTab(), validLoadCsv, validSolarCsv, MAX_GENERATION_ASSETS, MAX_INTERVALS_PER_DATASET, MAX_LOAD_CSV_BYTES, MAX_PROJECT_ACCEPTED_ARCHIVE_BYTES (+2 more)

### Community 25 - "Filesystem Context 2"
Cohesion: 0.15
Nodes (3): AgentPlan, _demo_plan_persistence(), PlanStep

### Community 26 - "Project Archive 2"
Cohesion: 0.25
Nodes (17): createGenerationJourneyArchive(), createMaximumLeapYearProjectArchive(), createNearBudgetLeapYearProjectArchive(), handleReset(), createClearSkyAsset(), encodeArchive(), makeMaximumLeapYearProjectState(), makeNearBudgetLeapYearProjectState() (+9 more)

### Community 27 - "Load Time Alignment"
Cohesion: 0.25
Nodes (16): runGenerationAwareSimulation(), alignLoadTimestampsToSite(), AnnualProjectionEligibility, evaluateAlignedAnnualProjectionEligibility(), evaluateAnnualProjectionEligibility(), evaluateLoadTimestampEligibility(), getLocalParts(), getSiteLocalCalendarCoordinates() (+8 more)

### Community 28 - "Scripts Compaction"
Cohesion: 0.16
Nodes (7): categorize_messages(), design_stable_prompt(), summarize_content(), summarize_conversation(), summarize_document(), summarize_general(), summarize_tool_output()

### Community 29 - "Tsconfig Module"
Cohesion: 0.11
Nodes (17): compilerOptions, allowImportingTsExtensions, allowJs, experimentalDecorators, isolatedModules, jsx, lib, module (+9 more)

### Community 30 - "Compression Evaluator 2"
Cohesion: 0.15
Nodes (3): EvaluationResult, ProbeType, _cleanup_demo()

### Community 32 - "Package Module 2"
Cohesion: 0.15
Nodes (13): dependencies, lucide-react@^0.546.0, motion@^12.23.24, react@^19.0.1, react-dom@^19.0.1, @tailwindcss/vite@^4.3.3, vite@^8.3.0, @vitejs/plugin-react@^6.1.1 (+5 more)

### Community 33 - "Export Aware Battery Flow"
Cohesion: 0.15
Nodes (6): zeroBatteryState, zeroCostBasisState, SolarLoadFlowInterval, SolarLoadFlowSummary, calculateSolarLoadFlow(), summarizeSolarLoadFlow()

### Community 35 - "Browser Testing"
Cohesion: 0.19
Nodes (14): Browser Smoke Tests, Final G7 Evidence Review, G7 Measured-Resource Projection Decision, Measured Solar and Wind Data, Model Scope and Data Contract, Simulation Performance Budget, Privacy and Data Handling, Cloud Completion Handoff (+6 more)

### Community 36 - "Context Compression"
Cohesion: 0.17
Nodes (13): Context Compression Evaluation Framework, Probe-Based Compression Evaluation, Anchored Iterative Summarization, Context Compression, Opaque Compression, Regenerative Full Summary, Context Optimization Techniques, Context Optimization (+5 more)

### Community 38 - "Integrated Battery Flow"
Cohesion: 0.22
Nodes (3): extractLocalClock(), generateBatteryDischargePolicy(), generateBatteryDispatchPolicy()

### Community 39 - "Csv Parser"
Cohesion: 0.26
Nodes (10): calendarCoordinate(), isValidCalendarDay(), parseAndValidateEnergyCsv(), parseDayString(), ParsedDay, ParsedTime, parseFiniteNumber(), parseHourOfDay() (+2 more)

### Community 42 - "Workflows Ci"
Cohesion: 0.17
Nodes (12): with, bun-version, fail-on-scopes, fail-on-severity, fetch-depth, if-no-files-found, key, name (+4 more)

### Community 43 - "Benchmark Simulation"
Cohesion: 0.17
Nodes (10): emptyGenerationConfig, generationConfig, maximumProjectDataPoints, quarterHour, quarterHourLeapYear, runCount, solar, timings (+2 more)

### Community 47 - "Package Module 3"
Cohesion: 0.18
Nodes (11): scripts, build, clean, dev, lint, preview, test, test:e2e (+3 more)

### Community 48 - "Vercel React Best Practices 5"
Cohesion: 0.20
Nodes (5): Build and Validation Scripts, Impact Levels, React Best Practices Repository Guide, Rule File Structure, Rule Naming Prefixes

### Community 50 - "Workflows Ci 2"
Cohesion: 0.20
Nodes (9): concurrency, cancel-in-progress, group, name, runs-on, timeout-minutes, jobs, dependency-audit (+1 more)

### Community 51 - "Scripts Helper"
Cohesion: 0.42
Nodes (7): connect(), nextReconnectDelay(), reloadAfterRecovery(), sessionKey(), setStatus(), showTombstone(), websocketUrl()

### Community 53 - "Workflows Ci 3"
Cohesion: 0.22
Nodes (9): if, name, permissions, runs-on, timeout-minutes, dependency-review, permissions, contents (+1 more)

### Community 54 - "Generation Defaults"
Cohesion: 0.44
Nodes (7): createDefaultGeneratorAsset(), createEmptyGeneratorSchedule(), DEFAULT_GENERATION_CONFIG, DEFAULT_GENERATION_SITE, DEFAULT_GENERATOR_ASSET, DEFAULT_SOLAR_ASSET, DEFAULT_WIND_ASSET

### Community 55 - "Workflows Ci 4"
Cohesion: 0.43
Nodes (8): steps, steps, steps, steps, if, name, run, uses

### Community 56 - "Package Module 4"
Cohesion: 0.25
Nodes (3): @playwright/test@^1.64.0, @playwright/test, repositoryRoot

### Community 57 - "Generation Labels"
Cohesion: 0.46
Nodes (6): GenerationAsset, calculateNetOperationalSavingsUsd(), formatEnabledGenerationLabels(), formatUsdAmount(), GENERATION_LABELS, getEnabledGenerationLabels()

### Community 58 - "Simulation Worker"
Cohesion: 0.32
Nodes (3): FakeWorker, SimulationWorkerLike, SimulationWorkerResponseMessage

### Community 59 - "Sample Data"
Cohesion: 0.46
Nodes (4): generateCsv(), formatDayMMDDYYYY(), formatHour12(), generateRealistic8760Dataset()

### Community 60 - "Stop Server"
Cohesion: 0.52
Nodes (6): command_has_server_id(), command_line_for_pid(), is_brainstorm_server(), mark_stopped(), read_expected_server_id(), stop-server.sh script

### Community 64 - "Implementation Patterns"
Cohesion: 0.29
Nodes (7): Sub-agent workspace, Dynamic skill loader, Plan persistence, Self-modification guard, Scratch pad manager, Terminal output persistence, Token accounting metrics

### Community 65 - "Executing Plans"
Cohesion: 0.33
Nodes (6): Task completion contract, Final branch review, Branch finishing, Inline plan execution, Progress ledger, Test-driven development

### Community 66 - "Code Reviewer"
Cohesion: 0.33
Nodes (6): Code Reviewer Prompt Template, Requesting Code Review, Implementer Subagent Prompt, Scoped Re-Review, Subagent-Driven Development, Task Reviewer Prompt

### Community 70 - "Filesystem Context 3"
Cohesion: 0.40
Nodes (5): Context failure modes, Dynamic context discovery, File-backed context storage, Filesystem-based context engineering, Filesystem search

### Community 72 - "Anthropic Best Practices"
Cohesion: 0.50
Nodes (5): Anthropic Skill Authoring Best Practices, Testing CLAUDE.md Skills Documentation, Persuasion Principles for Skill Design, Writing Skills, Testing Skills With Subagents

### Community 73 - "Workflows Ci 5"
Cohesion: 0.40
Nodes (5): branches, True, pull_request, push, workflow_call

### Community 77 - "Dispatching Parallel Agents"
Cohesion: 0.50
Nodes (4): Focused agent prompts, Independent work domains, Parallel agent dispatch, Review and integration

### Community 78 - "Finishing A Development Branch"
Cohesion: 0.50
Nodes (4): Git environment detection, Integration choice, Test verification, Workspace cleanup

### Community 79 - "Cost And Time"
Cohesion: 0.50
Nodes (4): Compaction analysis, Token accounting, Tool-result measurement, Wall-clock analysis

### Community 80 - "Workflows Ci 6"
Cohesion: 0.50
Nodes (4): quality, name, runs-on, timeout-minutes

### Community 81 - "Workflows Ci 7"
Cohesion: 0.50
Nodes (4): secret-scan, name, runs-on, timeout-minutes

### Community 87 - "Analyst Common"
Cohesion: 0.67
Nodes (3): Session analyst role, Context safety rules, Evidence-backed findings

### Community 88 - "Plan Adherence"
Cohesion: 0.67
Nodes (3): Plan execution mapping, Agreed plan recovery, Structural events

### Community 89 - "Quality Evidence"
Cohesion: 0.67
Nodes (3): Acceptance criteria, Test evidence, Verification claims

### Community 90 - "Prompts Scrub"
Cohesion: 0.67
Nodes (3): Bundle scrubbing, Stable placeholder mapping, Scrub log

### Community 91 - "Prompts Timeline"
Cohesion: 0.67
Nodes (3): Plugin attribution, Skill timeline, Skill trigger gaps

### Community 92 - "Templates Bundle"
Cohesion: 0.67
Nodes (3): Session diagnosis bundle, Evidence support review, Privacy audit

### Community 93 - "Templates Case"
Cohesion: 0.67
Nodes (3): Case record, Discovered record meanings, Session source inventory

### Community 94 - "Templates Report"
Cohesion: 0.67
Nodes (3): Session diagnosis report, Superpowers involvement assessment, Triage verdict

## Knowledge Gaps
- **133 isolated node(s):** `RFC-6455`, `Repository Agent Guidance`, `Complete-Year Lifecycle Projection Eligibility`, `Home Energy Scenario Analyzer Page`, `Context Compression` (+128 more)
  These have ≤1 connection - possible missing edges or undocumented components. (Counts symbols only; 659 node(s) total have ≤1 connection when file, concept and rationale nodes are included.)
- **119 thin communities (<3 nodes) omitted from report** — run `graphify query` to explore isolated nodes.

## Suggested Questions
_Questions this graph is uniquely positioned to answer:_

- **Why does `vitest` connect `Simulation Engine` to `Solar Profile`, `Generator Routing Integration`, `Export Json`, `Tariff Cost Accounting`, `Power Generation Tab`, `Generation Results`, `Generator Model`, `Generator Projection And Finance`, `Data And Rates Tab`, `Package Module`, `Sequential Battery Flow`, `Solar Battery Charging`, `Energy Module`, `Generation Financials`, `Project Archive 2`, `Load Time Alignment`, `Package Module 2`, `Export Aware Battery Flow`, `Integrated Battery Flow`, `Csv Parser`, `Generation Defaults`, `Generation Labels`, `Sample Data`?**
  _High betweenness centrality (0.073) - this node is a cross-community bridge._
- **What connects `RFC-6455`, `Repository Agent Guidance`, `Complete-Year Lifecycle Projection Eligibility` to the rest of the system?**
  _133 weakly-connected nodes found - possible documentation gaps or missing edges._
- **Should `Solar Profile` be split into smaller, more focused modules?**
  _Cohesion score 0.07191780821917808 - nodes in this community are weakly interconnected._
- **Why does `BatteryProfile` connect `Generator Routing Integration` to `Export Aware Battery Flow`, `Export Json`, `Tariff Cost Accounting`, `Project Archive`, `Integrated Battery Flow`, `Generation Results`, `Components Energy`, `Generator Projection And Finance`, `Data And Rates Tab`, `Simulation Worker Client`, `Sequential Battery Flow`, `Solar Battery Charging`, `Energy Module`, `Simulation Engine`, `Generation Financials`?**
  _High betweenness centrality (0.009) - this node is a cross-community bridge._
- **Should `Scripts Server` be split into smaller, more focused modules?**
  _Cohesion score 0.051560379918588875 - nodes in this community are weakly interconnected._
- **Why does `FakeWorker` connect `Simulation Worker` to `Project Archive 2`?**
  _High betweenness centrality (0.006) - this node is a cross-community bridge._
- **Should `Generator Routing Integration` be split into smaller, more focused modules?**
  _Cohesion score 0.09725158562367865 - nodes in this community are weakly interconnected._