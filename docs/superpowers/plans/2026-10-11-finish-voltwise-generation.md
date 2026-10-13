# VoltWise Generation Tool Completion Plan

**Goal:** Finish and validate the end-to-end solar, wind, and generator workflows so users can configure resources, simulate a defined period, understand the results, and export supported analyses safely.

**Architecture:** Keep solar and wind physics in their existing profile modules, generator dispatch in `generatorDispatch` / `generatorAwareFlow`, and composition in `generationAwareSimulation`. Use measured weather for the imported period and, only for a complete exact-aligned year, as the representative input series for lifecycle projections. Keep assumptions explicit; do not present the repeated series as a forecast. Finish at the React flow and export boundaries after the simulation contracts are stable.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, browser UI with Playwright.

**Spec:** `AGENTS.md`, `.agents/skills/voltwise-ux/SKILL.md`, and the existing contracts in `src/types/energy.ts` and generation simulation tests. This plan records the implementation scope inferred from those sources; it does not introduce a separate product specification.

## Global constraints

- Preserve load interval count/order, exact UTC alignment, energy conservation, battery SOC provenance, tariff timing, and generator fuel accounting.
- Never represent a partial measured period as a full-year result or a multi-year forecast.
- Preserve the legacy no-generation simulation path and its existing behavior.
- Keep solar, wind, and generator configuration in `GenerationConfig`; do not add a dependency without a demonstrated need.
- Retain existing strict input validation and make failures actionable in the UI.
- Existing work in the current checkout is uncommitted. Review and preserve it before editing; do not create a worktree unless requested.

## Review focus

- Missing, mismatched, duplicated, or out-of-order external-resource timestamps must stop the affected simulation with a useful message and never be silently interpolated.
- Solar plane-of-array conversion must handle night, panel orientation, units, and non-finite or physically invalid irradiance without creating energy.
- Wind interval generation must apply height and density corrections, cut-in/rated/cut-out limits, availability, and losses once each.
- Generator start/stop, minimum output, startup fuel, dispatch mode, and battery charging/export permissions must not double-count or create energy.
- Partial measured periods and incomplete/misaligned interval-resource projects must remain clearly distinguished from annual results; a complete aligned resource year can support the scoped representative-year projection.

## File map

- `src/types/energy.ts`: solar, wind, generator, and external-resource contracts.
- `src/utils/externalResourceParser.ts` and `externalResourceAlignment.ts`: validated CSV input and exact interval matching.
- `src/utils/solarModel.ts`, `solarGeneration.ts`, `solarProfile.ts`: solar physics and resource profiles.
- `src/utils/windModel.ts`, `windGeneration.ts`: turbine physics and resource profiles.
- `src/utils/generatorModel.ts`, `generatorDispatch.ts`, `generatorAwareFlow.ts`: generator costs, dispatch, and routed energy.
- `src/utils/generationAwareSimulation.ts`, `generationProjection.ts`, `simulationRouter.ts`: composition, projections, and compatibility boundary.
- `src/components/PowerGenerationTab.tsx`, `ResultsAnalyticsTab.tsx`, and `App.tsx`: setup, status/error behavior, and user-visible results.
- `src/utils/exportJson.ts`: supported export contracts.
- `src/__tests__/`: focused physics, routing, accounting, export, projection, and application coverage.

---

### Task 1: Stabilize measured-resource simulation already in progress

**Files:**
- Modify `src/utils/solarGeneration.ts`, `windGeneration.ts`, `generationAwareSimulation.ts`, `windModel.ts`, and `src/types/energy.ts`.
- Modify `src/__tests__/solarGeneration.test.ts`, `windModel.test.ts`, `windGeneration.test.ts`, `generationAwareSimulation.test.ts`, `simulationRouter.test.ts`, and affected integration tests.

**Interfaces:**
- Preserve `GenerationConfig.externalResources?: ExternalResourceDataset[]` and per-asset `externalResourceId`.
- Preserve optional resource parameters on `generateSolarAssetProfile`, `generateSolarFleetProfile`, `generateWindAssetProfile`, and `generateWindFleetProfile` so existing modeled-resource callers remain valid.
- `weather_file` consumes a matching `SolarIrradianceDataset`; `interval_file` consumes a matching `WindSpeedDataset`; both return the existing interval profile contracts.

- [x] Replace obsolete tests that expect attached interval wind or solar resources to be rejected. Assert that exact aligned records produce the expected profiles and then traverse the full generation-aware path.
- [x] Add focused rejection cases for missing/wrong-kind resource IDs, interval mismatch, and absent load timestamps; retain enabled/disabled-asset behavior.
- [x] Cover solar night-time input, orientation, irradiance conversion, losses, inverter clipping, and AC/DC interval energy.
- [x] Cover measured wind power-curve cut-in/rated/cut-out behavior, height/density adjustment, availability, losses, and sub-hour interval energy.
- [x] Run the focused solar, wind, external-resource, and generation-aware test files; resolve type/build errors before continuing.

### Task 2: Complete resource import and attachment lifecycle

**Files:**
- Modify `src/components/PowerGenerationTab.tsx` and, if state transitions need extraction, add a focused resource-import helper next to the existing parser.
- Modify `src/__tests__/appSimulationIntegration.test.ts` and add/extend component-level browser coverage.

**Interfaces:**
- Keep CSV parsing in `parseExternalResourceCsv`; do not duplicate the parser in React.
- Imported resources remain typed by `solar_irradiance` or `wind_speed`; attach them through the active asset's `externalResourceId`.

- [x] Verify importing a valid file attaches the dataset only to the selected compatible asset and selects its measured resource mode.
- [ ] Verify parse errors, wrong schemas, unsupported active assets, changing tabs/assets during file reads, replacement imports, and shared datasets produce clear state without dropping another asset's resource.
- [x] Show the attached resource name, interval length, covered dates, time zone, and parser warnings in the import status next to the selected asset.
- [x] Add a remove/replace path that removes an orphaned dataset only when no other asset references it.
- [x] Exercise solar and wind import with keyboard navigation and narrow viewport browser checks.

### Task 3: Define measured-period and projection behavior

**Files:**
- Modify `src/utils/generationProjection.ts`, `src/utils/exportJson.ts`, `src/App.tsx`, and `src/components/ResultsAnalyticsTab.tsx`.
- Extend `src/__tests__/generationProjection.test.ts`, `jsonExportCorrectness.test.ts`, and `appSimulationIntegration.test.ts`.

**Interfaces:**
- Simulation remains authoritative for the exact imported period.
- Multi-year projections use supported modeled inputs or replay a complete exact-aligned measured year as the representative resource year; partial time series are never repeated or extrapolated.

- [x] Make incomplete or misaligned measured solar/wind projection ineligibility a normal UI state with a plain explanation, not a generic calculation failure.
- [x] Keep interval savings labeled for their actual covered period; annualize only when existing completeness rules permit it.
- [x] Gate lifecycle financial metrics and multi-year exports when the source cannot support a projection, while preserving the valid period simulation and results.
- [x] Verify modeled-resource projects retain their existing projection and export behavior.

### Task 4: Audit and finish generator configuration and dispatch

**Files:**
- Review `src/utils/generatorModel.ts`, `generatorDispatch.ts`, `generatorAwareFlow.ts`, `PowerGenerationTab.tsx`, and `ResultsAnalyticsTab.tsx`.
- Modify only demonstrated gaps; add focused cases in `generatorModel.test.ts`, `generatorDispatch.test.ts`, `generatorRoutingIntegration.test.ts`, and UI coverage.

**Interfaces:**
- Continue using `GeneratorGenerationAsset`, `dispatchGeneratorInterval`, and the existing generator-aware flow; avoid a parallel dispatch implementation.
- Keep utility cost, generator operating cost, and net operational savings as distinct quantities.

- [x] Trace standby, scheduled, and economic dispatch from UI inputs through chronological state, energy routing, fuel, maintenance, summaries, and displayed costs.
- [x] Cover minimum stable output and unavoidable surplus; startup fuel exactly once per OFF→RUNNING transition; local-time schedule behavior; deterministic multi-generator merit order; export and battery-charge permissions.
- [x] Verify renewable-first serving/charging rules, generator SOC provenance, grid charging suppression, and interval energy reconciliation under mixed solar/wind/generator operation.
- [x] Correct UI assumptions or controls only where their behavior disagrees with the dispatch contract; surface invalid configurations beside the relevant setting.

### Task 5: Close end-to-end energy, finance, and export contracts

**Files:**
- Review/modify `src/utils/renewableLoadFlow.ts`, `generatorAwareFlow.ts`, `gridFlowAccounting.ts`, `tariffCostAccounting.ts`, `generationFinancials.ts`, `generationProjection.ts`, and `exportJson.ts` only where a failing invariant demonstrates a gap.
- Extend `src/__tests__/generatorRoutingIntegration.test.ts`, `generationFinancials.test.ts`, `jsonExportCorrectness.test.ts`, and horizon/partial-period tests.

- [x] Assert solar generation = direct load + battery charge + export + curtailment, with the equivalent wind and generator reconciliations.
- [x] Assert site load = renewable direct service + generator direct service + battery discharge + grid import, respecting each source's existing flow definitions.
- [x] Verify tariff credits do not include curtailed energy, fuel costs do not become utility charges, and battery exports respect SOC provenance and cost basis.
- [x] Export supported generation inputs, period results, projection assumptions, and source metadata consistently; refuse only the specific unsupported deliverable with an actionable explanation.
- [x] Replace the known strict floating-point equality in `generatorRoutingIntegration.test.ts:360` with a tolerance appropriate to accumulated energy totals.

### Task 6: Make the complete workflow understandable and accessible

**Files:**
- Modify `src/components/DataAndRatesTab.tsx`, `PowerGenerationTab.tsx`, `BatteryProfilesTab.tsx`, `FinancialSettingsTab.tsx`, `ResultsAnalyticsTab.tsx`, `Navbar.tsx`, and `src/App.tsx` only for confirmed workflow issues.
- Add browser regression coverage for the flow from data import through results and export.

- [x] Audit the five-tab sequence with a fresh session: sample/upload data → tariff → battery → solar/wind/generator → financial assumptions → results.
- [ ] Ensure every numeric input has an associated label and unit; errors identify how to recover; upload and calculation status are announced to assistive technology.
- [x] Explain sample versus measured data, period versus annual savings, forecast assumptions, fuel costs, payback, NPV, and unavailable metrics where users encounter them.
- [x] Verify keyboard-only operation, focus visibility, narrow layouts, chart text alternatives, and reduced-motion behavior.
- [x] Confirm resetting settings does not unexpectedly discard user-uploaded load or resource data without an explicit explanation.

### Task 7: Final verification and user handoff

**Files:**
- Update `AGENTS.md` and project documentation only if commands, supported input schemas, or constraints changed.

- [x] Run focused solar, wind, generator, resource, routing, projection, and export tests after their tasks pass.
- [x] Run `npm run lint`, `npm run build`, and `npm test -- --maxWorkers=4`; distinguish passes, failures, skipped tests, and known unrelated defects.
- [x] Complete browser checks for sample data, measured solar and wind imports, mixed generation, validation failures, partial-period behavior, and exports.
- [x] Review the final diff for protected manifests/lockfiles, accidental generated files, stale unsupported-feature copy, energy balance, and projection labels.
- [x] Document supported CSV columns/time-zone rules, modeled versus measured limits, and exact remaining issues.

## Suggested order

Complete Tasks 1–3 first; they stabilize the recent external-resource work and establish truthful result/projection behavior. Then audit generator dispatch (Task 4), validate shared accounting and exports (Task 5), and finish the user journey/accessibility work (Task 6). Task 7 is the release gate.

## Current progress and known limits

Measured solar and wind records now flow through exact timestamp matching into the generation-aware simulation, while the existing generator dispatch and source-aware accounting remain authoritative. A complete aligned measured year can be replayed as a representative resource year in lifecycle projections under the 2026-10-12 owner decision recorded in `docs/g7-measured-resource-projection-decision.md`; partial measured periods remain period-only. Resource CSVs are documented in `docs/measured-resource-data.md`. Solar plane-of-array conversion uses a fixed ground albedo of 0.2 and is an engineering estimate rather than a site-calibrated forecast. The async asset-switch/deletion import race cases and a full audit of numeric labels across every tab remain areas for follow-up.
