# VoltWise Production Readiness Corrections Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Address the production-readiness audit’s remaining correctness, recoverability, responsiveness, usability, and release-control findings so VoltWise can ship as a clearly scoped local-first analysis tool.

**Architecture:** Preserve the existing simulation engines and exact battery-only compatibility path. Correct validation and finance presentation at shared boundaries first; then add versioned project persistence and move expensive orchestration out of React rendering. Finish with browser quality gates, accurate product disclosures, and a reproducible release pipeline.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 5, Bun lockfile, browser E2E runner to be selected in Task 6, GitHub Actions.

**Spec:** `VoltWise_Production_Readiness_Audit_2026-10-11.md` supplied by the user; audit SHA `0eba2cdff4668777e9c8d9b4f2d7469207d878bb`. Current code baseline is `main` after local merge `958f959`.

## Global Constraints

- Preserve `runUnifiedSimulation()` delegation to `runAnnualSimulation()` when no generation asset is enabled, including legacy numerical outputs.
- Preserve load interval count/order, exact UTC resource alignment, energy conservation, battery SOC provenance, tariff timing, and generator fuel accounting.
- Do not silently interpolate missing data, infer a timezone, or convert power units to energy without a validated interval duration.
- Keep measured resource data period-specific; do not repeat it as an annual or multi-year forecast.
- Keep calculations browser-local unless a separately approved product decision changes that architecture; do not add accounts, cloud storage, or a backend by default.
- Use Bun 1.4.3 with `bun install --frozen-lockfile`; do not regenerate the lockfile as incidental work.
- Existing measured solar/wind runtime, UI, period export, and documentation are complete on current `main`; do not reimplement audit F-01/G7B/G7C.

## Review Focus

- A syntactically valid but gapped, partial, or DST-ambiguous load file must not be presented as ready for a simulation or authoritative lifecycle projection.
- A `kW` reading must never be treated as `kWh`; malformed numeric strings such as `12kWh`, NaN, and Infinity must be rejected.
- Combined battery and generation CAPEX, rebates, and financing must agree across settings previews, Results, and exports.
- Opening a corrupt, unsupported-future-version, or incomplete project archive must not replace the current project state.
- Rapid simulation edits/cancellation must not display stale results or block input beyond the performance budget defined in Task 5.

---

## Current Audit Reconciliation

The audit inspected commit `0eba2cd`, before the measured-resource work merged to current `main` as `958f959`. **F-01 and its G7B/G7C deliverables are complete**: canonical solar/wind resource CSVs can be imported, attached, simulated, surfaced in period results, and represented in period JSON; exact alignment is enforced; measured-series projections remain intentionally unsupported and documented in `docs/measured-resource-data.md`. The prior project plan still records two small UI follow-ups (file-read lifecycle races and a complete numeric label audit); these are carried into Task 6.

The following audit claims were spot-checked against current code and remain open: F-02, F-03, F-04, F-05, F-06, F-07, F-08, F-09, F-10, F-11, F-12, F-13, F-14, F-15, F-16, F-17, F-18, and F-19. Findings that were recommendations rather than observed defects (tariff scope, security posture, accessibility and responsive concerns) must first be classified as product-scope decisions or verified failures; do not present an untested risk as a reproduced defect.

## File Map

- `src/utils/csvParser.ts`, `src/utils/loadTimeAlignment.ts`, `src/types/energy.ts`: load schema, dimensional units, timestamp validity, and projection suitability contracts.
- `src/components/FinancialSettingsTab.tsx`, `src/App.tsx`, `src/utils/generationFinancials.ts`: authoritative project-cost preview inputs and consistency with Results.
- `src/App.tsx`, `src/types/energy.ts`, `src/utils/exportJson.ts`: source provenance, project-state ownership, report metadata, and financial output boundaries.
- New `src/utils/projectArchive.ts` and `src/__tests__/projectArchive.test.ts`: project archive schema, validation, migration, serialization, and round-trip tests.
- New `src/workers/simulation.worker.ts` and `src/utils/simulationWorkerClient.ts`; `src/App.tsx`: asynchronous simulation requests, cancellation, stale-result rejection, and progress/error state.
- `package.json`, browser test configuration, `src/__tests__/`: minimal UI smoke suite and accessibility assertions.
- `.github/workflows/`, `README.md`, `docs/`: repeatable checks, user-facing scope, privacy, setup, deployment, and release runbook.

---

## Implementation Roadmap

### Task 1: Define input validity and projection eligibility separately

**Findings:** F-05, F-06, F-14.

**Files:**
- Modify: `src/types/energy.ts`, `src/utils/csvParser.ts`, `src/utils/loadTimeAlignment.ts`.
- Test: `src/__tests__/csvParser.test.ts` (create if absent), `src/__tests__/loadTimeAlignment.test.ts`, `src/__tests__/temporalValidationAndCompleteness.test.ts`, `src/__tests__/partialPeriodBehavior.test.ts`.

**Interfaces:**
- Keep `parseAndValidateEnergyCsv(rawCsv)` as the parser entry point.
- Add/standardize explicit result fields for schema validity, chronology validity, simulation eligibility, and annual-projection eligibility; callers must consume the appropriate field rather than infer one from `isValid`.
- Standard energy input accepts energy units only (`Wh`, `kWh`, `MWh`). If power input is retained, expose it as a distinct schema with validated interval duration and convert `kW × intervalHours` to `kWh`.

- [x] Add parser tests for `1 kW` over 15 minutes not entering the energy schema, strict full-field numeric parsing, and rejection of NaN/Infinity/trailing text.
- [x] Add timestamp tests for gaps, duplicates, descending rows, leap years, DST gaps/overlaps, and partial-year coverage; assert simulation and annual eligibility independently.
- [x] Implement the smallest contract changes in `csvParser.ts` and `loadTimeAlignment.ts`; preserve legacy numerical outputs for previously valid energy files.
- [x] Update upload and projection callers to show actionable status from the new explicit eligibility fields.
- [x] Run affected parser/alignment/partial-period tests, then `npm run lint`.

### Task 2: Unify Financial Settings preview with authoritative project economics

**Finding:** F-04.

**Files:**
- Modify: `src/components/FinancialSettingsTab.tsx`, `src/App.tsx`; extract shared preview arithmetic to `src/utils/generationFinancials.ts` only if the engine has no reusable function.
- Test: add focused tests to `src/__tests__/appSimulationIntegration.test.ts` or a new `src/__tests__/financialSettingsPreview.test.ts`.

**Interfaces:**
- Pass the Financial Settings component the authoritative `GenerationProjectCostSummary | null` (and active project gross cost, defined as battery installed cost plus enabled generation CAPEX exactly once).
- Reuse the financial engine’s rebate, tax-credit, upfront-cost, and financing conventions; do not duplicate different equations in the component.

- [x] Add battery-only and mixed-generation tests asserting preview gross CAPEX, immediate rebate, tax-credit basis, loan principal, and net installed cost equal the authoritative analysis inputs.
- [x] Update component props and shared calculation adapter while preserving the user-supplied/zero-default tax-credit assumption.
- [x] Run financial preview, generation financial, financing/tax-credit, and integration tests.

### Task 3: Add explicit sample provenance and truthful result/export labeling

**Finding:** F-08 (and source-aware portions of F-10/F-14).

**Files:**
- Modify: `src/types/energy.ts`, `src/App.tsx`, `src/components/DataAndRatesTab.tsx`, `src/components/ResultsAnalyticsTab.tsx`, `src/utils/exportJson.ts`.
- Test: `src/__tests__/appSimulationIntegration.test.ts`, `src/__tests__/jsonExportCorrectness.test.ts`.

**Interfaces:**
- Add a source discriminator to project state (for example `demo` or `uploaded`) and include it in the existing JSON analysis export metadata.
- Keep sample generation deterministic; make the initial sample visibly illustrative and provide a deliberate transition to uploaded input.

- [x] Test that a fresh app state and its export identify synthetic sample data; importing user data changes provenance and the export records that provenance.
- [x] Show a persistent sample/illustrative notice on results and exports; identify tariff and finance assumptions as user inputs.
- [x] Ensure reset behavior states whether load/resource files are cleared and never silently relabel uploaded data as a sample.
- [x] Run app integration and JSON export tests.

### Task 4: Implement versioned local Save/Open Project archives

**Finding:** F-03.

**Files:**
- Create: `src/utils/projectArchive.ts`, `src/__tests__/projectArchive.test.ts`.
- Modify: `src/types/energy.ts`, `src/App.tsx`, `src/components/DataAndRatesTab.tsx` (or a focused project-file control component).
- Document: `docs/project-files.md`.

**Interfaces:**
- Define a versioned `VoltWiseProjectArchive` schema containing battery profiles, tariff profiles, generation config/assets, financial assumptions, load data, source provenance, site timezone, and referenced solar/wind resource records/metadata.
- Export `serializeProjectArchive(state) -> Blob` and `parseProjectArchive(input) -> ValidatedProjectState`; parser validates fully before the caller replaces current state.
- Keep analytical JSON export separate from project archive serialization.

- [x] Add tests for save/open round-trip, deterministic re-simulation inputs, missing fields, malformed JSON, corrupt resource content, unknown future schema, and migration from the first supported schema.
- [x] Implement schema validation and migration in `projectArchive.ts`; reject invalid/future archives without mutating app state.
- [x] Add explicit Save Project and Open Project controls with a confirmation or recoverable state before replacing an active project.
- [x] Document archive contents, local handling, schema versions, and how users delete project files.
- [x] Run project archive, app integration, resource parser, and export tests.

### Task 5: Measure and isolate long-running simulation work

**Finding:** F-07.

**Files:**
- Create: `src/workers/simulation.worker.ts`, `src/utils/simulationWorkerClient.ts`, focused worker/client tests.
- Modify: `src/App.tsx`, `vite.config.ts` only if required for worker bundling.

**Interfaces:**
- Define typed worker messages with request ID, input snapshot, result/error, and cancellation; latest-request ID owns visible state.
- Preserve `runUnifiedSimulation()` and the existing projection/finance engines as authoritative pure computation. Worker code calls these engines instead of duplicating them.

- [x] Benchmark baseline with 8,760 and 35,040 intervals, one and multiple battery profiles, and generation-aware 25-year projections; record target hardware, latency, and peak memory in `docs/performance-budget.md`.
- [x] Add tests proving worker and direct-engine outputs match, cancellation resolves cleanly, and out-of-order responses cannot replace newer results.
- [x] Move expensive orchestration off the render path; add pending/progress/error state and debounce or cancel superseded requests.
- [x] Re-run benchmark and set an explicit p95 interaction budget and memory ceiling based on measured target-device results; do not claim a pass without measurements.
- [x] Verify changing controls remains responsive and final visible results correspond to current inputs.

### Task 6: Add browser journey, accessibility, and import lifecycle coverage

**Findings:** F-09, F-15, remaining UI follow-ups from the generation plan.

**Files:**
- Add browser test runner/configuration and `e2e/` tests; update `package.json` scripts and lockfile only for a selected, necessary dependency.
- Modify affected components in `src/components/` and `src/App.tsx` based on reproducible findings.

**Interfaces:**
- Provide one documented command for browser smoke tests against a production build or deterministic local server.
- Keep chart table alternatives and keyboard semantics accessible in their existing components.

- [ ] Cover Chromium flows: sample notice; valid/invalid load upload; resource upload/binding; asset edit; settings; results; Save/Open; export/download; reset.
- [ ] Cover keyboard-only navigation, 320–390 px viewports, visible focus, form labels/errors, upload status announcements, chart table alternatives, and reduced motion.
- [ ] Add targeted tests for selecting/removing/changing assets while asynchronous resource file reads are pending; ensure stale reads cannot attach to the wrong asset.
- [ ] Audit numeric inputs across all tabs for accessible labels and explicit units; fix only confirmed omissions and add a test for each repaired control.
- [ ] Run browser flows in Chromium and Firefox plus the selected mobile viewport; record unsupported browser/environment gaps rather than implying they passed.

### Task 7: Establish CI and release qualification controls

**Findings:** F-02, release-control portions of F-16.

**Files:**
- Create: `.github/workflows/ci.yml`, `.github/workflows/release.yml` (release workflow only if tags are chosen).
- Modify: `package.json` scripts as needed; document checks in `docs/release-runbook.md`.

**Interfaces:**
- CI installs the exact Bun version and uses the checked-in lockfile; CI must not silently update dependencies.
- Required PR checks: `bun install --frozen-lockfile`, `npm run lint`, `npm test -- --maxWorkers=4`, `npm run build`, and Task 6 browser smoke suite.

- [ ] Add pull-request and main-branch checks with dependency caching and retained actionable logs.
- [ ] Add dependency review/audit and secret scanning using repository-supported tooling; triage findings instead of automatically applying upgrades.
- [ ] Document required branch protection settings, which cannot be proven by workflow YAML alone.
- [ ] Define version/tag, deploy preview/staging smoke, rollback, and release-SHA verification steps.
- [ ] Verify workflow syntax and run the same commands locally from a clean install.

### Task 8: Publish bounded model scope, privacy, and project documentation

**Findings:** F-10, F-11, F-16, F-17, F-18, F-19.

**Files:**
- Create: `README.md`, `docs/model-scope.md`, `docs/privacy.md`, `docs/release-runbook.md` if Task 7 has not created it; `LICENSE` only after owner/license choice.
- Modify: `index.html`, `package.json`, existing Results/Power Generation copy, and `package.json` clean command for cross-platform behavior.

**Interfaces:**
- The supported model contract must distinguish interval energy-rate accounting from a complete utility-bill engine, deterministic interval generator dispatch from global optimization, and standby assumptions from chronological outage simulation.
- Canonical measured solar/wind CSV is supported; TMY3/EPW/weather APIs must not be advertised unless adapters are implemented and tested.

- [ ] Audit visible capability claims and replace stale generator, clear-sky, TMY3, wind-file, and projection text with current support and limitations.
- [ ] Document accepted load/resource schemas, timezone rules, browser requirements, sample onboarding, assumptions, uncertainty, troubleshooting, and reproducible developer setup.
- [ ] Decide and record target v1 tariff scope (bounded energy-rate model or specific added bill components); add known-bill golden fixtures only for plans claimed as supported.
- [ ] Document local processing and external requests (including Google Fonts) accurately; verify production hosting uses HTTPS and appropriate security headers before calling deployment secure.
- [ ] Confirm whether `@google/genai`, `express`, and `dotenv` are used; remove unused production dependencies only with import/build review and frozen-lockfile update in an isolated task.
- [ ] Choose a public/private reuse license and pre-release version policy; correct stale app description and make `clean` cross-platform.
- [ ] Run documentation link/schema checks, build, and targeted UI copy tests.

### Task 9: Optional v1.x analysis features after core release gates

**Findings:** F-12, F-13 and non-core recommendations.

- [ ] Add an explicit queued/cancellable multi-profile generation lifecycle comparison after worker support, using the existing authoritative projection engine per profile.
- [ ] Add annual generation-aware projection CSV from authoritative projection rows (no recalculation in exporter), including energy by source, operating cost/savings, degradation, project cash flow, and cumulative NPV.
- [ ] Consider low/base/high sensitivity cases only as explicitly user-configured assumptions with documented interpretation.
- [ ] Treat advanced tariff semantics, external weather APIs, chronological outages, cloud persistence, accounts/payments, and broad mobile redesign as separate product decisions and plans.

## Integration Gates and Order

1. **Input and finance trust gate (Tasks 1–2):** focused parser/alignment/finance tests, `npm run lint`, then full Vitest and build.
2. **Reproducibility gate (Tasks 3–4):** source metadata and archive round-trip/corruption tests; full Vitest and build.
3. **Responsiveness gate (Task 5):** benchmark evidence, worker equivalence/cancellation, browser interaction check.
4. **Product and release gate (Tasks 6–8):** browser/accessibility checks, CI green at exact commit, docs/model decisions, security/dependency and hosting review.
5. **Final Release Gate:** clean install with frozen lockfile; full tests, TypeScript, production build, Chromium/Firefox smoke tests, accessibility checks, performance budget, dependency/security scan, deployment smoke and rollback verification at the tagged release SHA.

Task 9 is optional v1.x and must not delay release qualification of the bounded core product unless the launch scope advertises those features.

## Audit Finding Coverage

| Audit finding | Roadmap disposition |
| --- | --- |
| F-01 / G7B / G7C | Complete on current `main`; no reimplementation planned |
| F-02 | Task 7 |
| F-03 | Task 4 |
| F-04 | Task 2 |
| F-05, F-06, F-14 | Task 1; upload race in Task 6 |
| F-07 | Task 5 |
| F-08 | Task 3 |
| F-09, F-15 | Task 6 |
| F-10, F-17, F-18 | Task 8 scope decision and disclosures |
| F-11 | Task 8 |
| F-12, F-13 | Task 9 optional v1.x |
| F-16 | Task 7 and Task 8 |
| F-19 | Task 8 |
