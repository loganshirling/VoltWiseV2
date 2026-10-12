# Updated Production Audit Remediation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this roadmap task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Resolve the correctness, input-integrity, usability, and release-qualification gaps reported in the October 12 production-readiness audit while preserving VoltWise's bounded local-first v1 scope.

**Architecture:** Treat the audit as a set of evidence-backed findings and hypotheses, not as authority to change product scope. Reproduce behavioral risks with focused tests before changing shared timestamp, eligibility, archive, or financial contracts. Reuse existing simulation, alignment, and financial engines. Keep project-code changes separate from GitHub administrator and hosting operations.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 5, Bun lockfile, Playwright Chromium; the repository currently has an unqualified Firefox project.

**Spec:** The user-supplied `VoltWise_Production_Readiness_Audit_2026-10-12.md` is an external attachment, not a durable repository path. The tracked behavior contracts are `docs/superpowers/plans/2026-10-11-finish-voltwise-generation.md`, `docs/superpowers/plans/2026-10-12-production-readiness-corrections.md`, `docs/model-scope.md`, `docs/measured-resource-data.md`, and the original G7 milestone source identified by the audit. The G7 source was not present in the checkout at plan creation; obtain it before resolving Task 1.

## Scope and evidence rules

- The user asked for an audit review and implementation roadmap. This document plans future work; it does not authorize changing GitHub rules, selecting a host, deploying, publishing, or implementing code now.
- The audit pins `main` at `5e9588152d3d9c4888d38dea7df1d9a83b86ca18`; that is the current repository HEAD at plan creation. It reports CI evidence but explicitly did not run its own checkout, browser, benchmark, or deployment tests.
- Treat source-path findings as hypotheses until a focused regression test demonstrates the behavior. Do not claim reproduction merely from the cited code path.
- The original G7 milestone roadmap cited by the audit is not in this checkout/history. The owner explicitly chose “Preserve G7 full-year projections” on 2026-10-12. Use the audit's VW-01 remediation text as the available acceptance contract, and record that provenance without claiming the unavailable source was reviewed verbatim.
- Keep complete utility-bill semantics, weather APIs, chronological outages, cloud persistence, accounts, and broad UI redesign outside this v1 correction plan unless scope is separately approved.
- Preserve existing battery-only compatibility for inputs whose timestamp/tariff interpretation agrees with the selected canonical site-time semantics; test any intentional numerical migration explicitly.
- Keep the app local-first, avoid new dependencies unless an existing test/browser requirement demonstrates the need, and do not put imported customer data in fixtures that are committed without review.
- Record actual supported input limits and performance results; do not select a limit from guesswork or claim a device/browser passed without measurement.

## Review focus

- Explicit-offset legacy CSV rows must resolve tariff schedule and seasonal coordinates in the selected site timezone regardless of the browser timezone.
- Missing/invalid site timezone, partial years, gaps, leap years, and direct engine calls must not bypass annual eligibility.
- Invalid archives and stale asynchronous reads must not replace the active project or make any settings/results tab fail.
- Removing/replacing measured data must never change the configured model mode without explicit user action.
- Generator and mixed-asset outputs must state which assets are configured and distinguish avoided grid cost from fuel-adjusted operating value.

## Task 1: Reconcile and implement G7 measured-resource projection scope (VW-01)

**Files:**
- Create: `docs/g7-measured-resource-projection-decision.md` recording the missing original source, the owner's choice, and the adopted acceptance rules.
- Modify: `src/utils/generationProjection.ts`, `src/utils/exportJson.ts`, `src/components/PowerGenerationTab.tsx`, `docs/model-scope.md`, `docs/measured-resource-data.md`, and the historical projection contract in `docs/superpowers/plans/2026-10-11-finish-voltwise-generation.md`.
- Test: `src/__tests__/generationProjection.test.ts`, `src/__tests__/jsonExportCorrectness.test.ts`; preserve browser journey coverage for Task 8.

**Interfaces:**
- The owner selected full-year measured-resource projections. The adopted rule from audit VW-01 is: require an eligible complete-year load and exactly aligned full-year resource series; replay the same resource series each projection year; degrade solar DC hardware, battery capacity, and tariffs using existing rules; preserve measured wind inputs unchanged; store annual aggregate rows only.
- `deriveGenerationConfigForProjectionYear()` must preserve and clone attached external resource records. `runUnifiedSimulation()` remains the authoritative per-year engine.

- [x] Compare the VW-01 requirements available in the audit with the tracked generation plan and code; record that the audit-named original G7 file is absent and document the discrepancy.
- [x] Record the owner's choice to preserve measured full-year projections and identify the audit remediation paragraph as the available, non-verbatim acceptance contract.
- [x] Add failing projection coverage for Year 1 equality with the period engine, Year 2 solar capacity degradation, unchanged measured wind resource, exact aligned records, mixed measured assets, and compact annual-only output.
- [x] Implement per-year measured-resource replay through `runUnifiedSimulation()` and preserve measured records through the cloned year config. Existing alignment rejects missing/wrong-kind/mismatched records.
- [x] Allow generation projection JSON export for measured resources when valid lifecycle analysis exists; remove obsolete period-only export rejection.
- [x] Update model scope, resource docs, generation setup copy, and prior generation plan to describe the adopted rule and its representative-year/weather limitations.

**Acceptance:** A complete matched measured resource year is replayed for each projection year through the authoritative engines; Year 1 matches the period simulation, solar hardware degrades while its resource data remains fixed, wind measurements remain fixed, and exports include supported projection rows. The unavailable original G7 source remains clearly identified.

## Task 2: Correct timezone semantics and annual eligibility (VW-04, VW-05, VW-06)

**Files:**
- Review/modify `src/utils/csvParser.ts`, `src/utils/loadTimeAlignment.ts`, `src/utils/tariffRateResolver.ts`, `src/utils/simulationEngine.ts`, `src/App.tsx`, `src/utils/generationProjection.ts`, and worker preflight in `src/utils/simulationWorkerJob.ts`.
- Extend `src/__tests__/csvParser.test.ts`, time-alignment/tariff tests, projection tests, and `src/__tests__/appSimulationIntegration.test.ts`.

**Interfaces:**
- Define one canonical mapping from each load interval instant to site-local hour, weekday, and month. Both legacy battery-only and generation-aware paths must consume the same semantics.
- Call the canonical exact full-calendar-year eligibility validator at the projection engine boundary. UI-only preflight is not sufficient.

- [x] Write a regression test using the same explicit UTC/offset fixture under at least two host `TZ` settings, with a TOU and seasonal boundary different from the site-local hour/month.
- [x] Observe the failure in selected tier, applied rate, interval cost, total cost, and battery-only versus generation-aware parity before changing code.
- [x] Write fail-closed cases for empty/invalid site timezone and direct projection calls with no eligibility payload.
- [x] Cover a gapped 360-day series, one missing annual interval, exact leap-year data, exact non-leap calendar year, and a contiguous non-calendar 365-day period.
- [x] Replace the generation projection engine's loose default suitability heuristic with the canonical exact-year validator; preserve already-correct battery-only output and document any intentional compatibility correction.
- [x] Run focused parser, alignment, tariff, projection, worker-preflight, and App tests, then lint and the full test suite at the integration gate.

**Acceptance:** Equivalent instants receive the same site-local tariff across host timezones; only the canonical exact-year validator allows lifecycle projection.

## Task 3: Make measured-resource timezones and removal transitions explicit (VW-02, VW-03)

**Files:**
- Modify `src/components/PowerGenerationTab.tsx`, resource parsing/alignment utilities, `src/types/energy.ts`, `src/utils/projectArchive.ts`, and `docs/measured-resource-data.md` / `docs/project-files.md` as needed.
- Extend external-resource parser, alignment, component, app integration, and archive tests.

**Interfaces:**
- The import flow records `sourceTimeZone` independently from `generationConfig.site.timeZone`; explicit-offset rows retain their absolute instant.
- Removing an attached file changes resource attachment state only. It does not silently switch `weather_file`/`interval_file` to a modeled mode.

- [x] Add failing tests for a resource whose source wall-clock zone differs from the site zone, an explicit-offset resource, DST ambiguous/nonexistent source times, removal, reattachment, and project archive round-trip.
- [x] Add a labeled source-zone input for zone-free CSV timestamps and show source zone and site zone in the import summary.
- [x] On removal, preserve the selected resource mode and show an actionable unbound state that prevents dispatch until reattachment or an explicit modeled-mode selection.
- [x] Validate/migrate the new metadata in project archives without losing older supported archive versions.
- [x] Run focused parser, exact-alignment, asset UI, archive, and E2E regression tests.

**Acceptance:** Source instants are unambiguous and preserved; file removal cannot silently yield synthetic modeled generation.

## Task 4: Validate project archives and live domain values (VW-07)

**Files:**
- Review `src/utils/projectArchive.ts`, generation/battery domain validators, financial input calculations, `src/components/FinancialSettingsTab.tsx`, and live asset settings forms.
- Extend `src/__tests__/projectArchive.test.ts`, finance/settings tests, and browser project-open flows.

**Interfaces:**
- Archive validation and live user forms share appropriate domain validators where the same contract applies.
- Parsing and domain validation complete before any project state is replaced; validation errors remain recoverable and user-facing.

- [x] Add malicious-but-structurally-valid archive fixtures for negative cost, invalid capacity/efficiency/DoD, invalid coordinates, malformed or non-monotonic resource curves, and finance assumptions at/outside justified bounds.
- [x] For each field, derive allowed values from engine physics and UI semantics; do not invent limits just to make validation stricter.
- [x] Confirm each invalid archive is rejected atomically and the previously active project remains usable.
- [x] Open a valid archive and navigate all tabs, including Financial Settings and Results; assert no render exception and valid calculations.
- [x] Add live-form validation for any domain-invalid values reachable outside archive loading.
- [x] Run focused archive, generation-asset, financial, and app tests.

**Acceptance:** No archive can load values that make the existing project fail during ordinary navigation or analysis; recoverable open failures preserve current state.

## Task 5: Make load imports race-safe and define ingestion limits (VW-08, VW-09)

**Files:**
- Modify load import lifecycle in `src/App.tsx`, resource import in `src/components/PowerGenerationTab.tsx`, project reading in `src/components/ProjectFileControls.tsx`, relevant parsers, and `docs/model-scope.md` / `docs/project-files.md`.
- Add focused App/component tests and Playwright coverage in `e2e/smoke.spec.ts` or a dedicated file.

**Interfaces:**
- Every asynchronous load import has a request generation/identity; only the latest intentional request may update active project state.
- File byte limits and parsed interval/asset limits are explicit constants shared by UI validation and docs. Reject by `File.size` before reading text.

- [ ] Add controlled delayed-reader tests for: upload A then B; upload then load sample; upload then reset; upload then open project; upload then unmount; reader error and abort. Verify old valid state remains if new input fails.
- [ ] Implement cancellation/request invalidation and explicit `onerror`/`onabort` handling; invalidate pending load reads on all whole-project transitions.
- [ ] Measure representative CSV/archive memory and import time on the reference browser/device; derive conservative supported byte, interval, resource, and asset limits from observed budget and worker copying.
- [ ] Enforce each limit before file content read or expensive parse, with accessible actionable feedback and no partial state mutation.
- [ ] Exercise at-limit and over-limit cases in the browser and confirm normal imports still work.
- [ ] Update documentation with tested limits and known browser/device constraints.

**Acceptance:** Only the latest intentional import can replace state; failure and over-limit inputs preserve current project data and show a recoverable message.

## Task 6: Protect unsaved project work (VW-10)

**Files:**
- Modify `src/App.tsx`, project save/open controls, relevant navigation/reset flows, and `docs/privacy.md`.
- Extend App integration and Playwright project-file tests.

**Interfaces:**
- Track whether the active project differs from the last explicitly saved/opened state, without serializing user data to cloud services or browser storage by default.
- Expose dirty/saved status and guard destructive navigation/replacement actions; use `beforeunload` only for browser tab/window close.

- [ ] Define dirty-state semantics for sample initialization, field edits, successful save, successful open, canceled/failed save, reset, and archive replacement.
- [ ] Add failing tests for dirty status, successful save clearing dirty state, and canceled/invalid open leaving existing dirty data intact.
- [ ] Show clear saved/unsaved status and a confirmation before destructive in-app reset/open when edits would be lost.
- [ ] Add/remove a `beforeunload` handler only while dirty; test install/cleanup so it cannot leak across mounts.
- [ ] Update privacy/setup docs to state that recovery remains download-based and no automatic browser/cloud persistence was added.

**Acceptance:** Users receive a clear warning before closing or replacing unsaved work; no project contents are persisted without an explicit user action.

## Task 7: Correct technology labels and generator economics (VW-13, VW-14)

**Files:**
- Review selectors and copy in `src/App.tsx`, `src/components/ResultsAnalyticsTab.tsx`, and related generation result/export adapters.
- Add selector, finance, export, and browser tests.

**Interfaces:**
- A shared selector maps enabled asset types to display names; configured standby assets remain represented even when output is zero.
- Separate avoided utility-electricity cost from net operating value after generator fuel and maintenance. UI and JSON use consistent names and figures.

- [ ] Add failing heading cases for generator-only, solar+generator, wind+generator, all assets, and enabled standby with zero generation.
- [ ] Implement display selection from enabled assets, not generation values alone.
- [ ] Add a generator case where marginal fuel/maintenance exceeds avoided imports; assert labels, values, and totals in App headline, Results, JSON export, and cash flow.
- [ ] Keep bill-scope disclaimers and user-entered cost assumptions visible at the point of interpretation.

**Acceptance:** Asset headings match configuration and generator scenarios cannot present avoided imports as net savings after generator operating cost.

## Task 8: Add numerical golden journeys and broaden browser/performance evidence (VW-11, VW-15)

**Files:**
- Add small deterministic fixtures to `e2e/fixtures/` only if their source and licensing are clear; otherwise build synthetic fixtures in test code.
- Extend `e2e/`, focused engine/export tests, `docs/browser-testing.md`, and `docs/performance-budget.md`.

**Interfaces:**
- Reuse authoritative simulation and projection outputs as expected values; do not duplicate calculation formulas in test assertions or exporters.
- Test scope expands only after the related corrections (Tasks 1–7) stabilize their contracts.

- [ ] Add a curated nonzero measured-resource period journey with exact aligned data and assert result totals against a checked-in deterministic engine golden.
- [ ] Add end-to-end import/settings/results/export cases for battery-only, solar, wind, generator, and one mixed configuration; include a tariff schedule boundary and generator fuel-cost case.
- [ ] After Task 1 path A, add one complete-year file-backed projection journey and Year-1 equality test; for path B, test that period results work and lifecycle projection is clearly disabled.
- [ ] Run production browser smoke on Chromium plus a second supported browser/runtime selected from actual available/tested environments; record untested platforms honestly.
- [ ] Repeat documented 8,760/35,040 interval and multi-profile/mixed-asset performance measurements across representative lower-memory and reference devices, with multiple trials for latency and peak memory.
- [ ] Investigate structured-clone costs across projection workers; optimize only if measurements show a material gain and worker/direct parity remains exact within existing numerical tolerances.
- [ ] Set or retain minimum supported device guidance only from reproducible measurements; retain no-pass claims for missing devices.

**Acceptance:** Numerical paths have inspectable golden evidence; browser and performance docs clearly distinguish measured passes, skipped/unavailable runtimes, and untested targets.

## Task 9: Complete GitHub governance and hosted release qualification (VW-12)

**Files:**
- Repo code: update `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `docs/release-runbook.md` only where qualification evidence identifies a gap.
- Operator configuration: GitHub branch rules/rulesets, security alerts, selected hosting provider, staging/production headers, release and rollback records. These are not enforceable by repository commits alone.

**Interfaces:**
- Branch rules require the actual stable PR check names: `CI/quality`, `CI/dependency-audit`, `CI/dependency-review` for pull requests, and `CI/secret-scan`, plus approval/latest-base/history protections as supported by repository policy.
- A release record binds Git tag, source SHA, build artifact checksum, deployed artifact, verified URL, security-header evidence, and rollback target.

- [ ] Confirm GitHub plan/permissions and apply required branch rules; verify via the repository API/UI that `main` is protected and rules are active.
- [ ] Exercise a real pull request so dependency review runs; verify every required check is present and cannot be bypassed by normal contributors.
- [ ] Confirm Dependabot and secret alert settings; do not put credentials in repository files or logs.
- [ ] Select a staging/production host and define only its needed deployment workflow. Verify HTTPS, HSTS where applicable, CSP including Google Fonts, content-type, frame, and referrer headers.
- [ ] Deploy the exact tested artifact/SHA to staging, run hosted browser smoke and inspect console/network behavior, then execute rollback to the last verified artifact.
- [ ] Record URLs, SHA256, CI run, header results, smoke result, and rollback evidence in the runbook/release record before stable release.

**Acceptance:** Stable release approval requires enforced branch governance and a verified deployment/rollback. Tag creation or green CI alone does not satisfy deployment qualification.

## Task 10: Incremental maintainability and optional v1.x follow-ups (VW-16)

- [ ] After the higher-priority correctness tasks stabilize, extract the generation asset-name selector and major self-contained Results panels from `ResultsAnalyticsTab.tsx` into focused files with component tests; do not change calculation behavior or perform a broad rewrite.
- [ ] Reassess the large Data & Rates and Power Generation components for one additional cohesive extraction only where it removes duplicated behavior or creates a testable boundary.
- [ ] Add cancellable multi-profile generation lifecycle comparison using the existing authoritative projection engine per profile.
- [ ] Add annual generation-aware projection CSV from authoritative projection rows; do not recompute energy/finance values in the exporter.
- [ ] Consider explicitly user-configured sensitivity cases and a plain-language onboarding/readiness checklist after the correction path is complete.
- [ ] Treat additional tariff components, weather APIs, chronological outages, cloud storage/accounts, and large UI redesign as separate product specifications.

## Integration gates and recommended order

1. **Scope gate:** Task 1 records the owner's choice and implements the audit-described full-year resource replay contract. The source citation remains qualified because the original G7 document was not available.
2. **Numerical correctness:** complete Task 2, then Task 3. Run focused timezone, tariff, exact-alignment, eligibility, parser, generation, and projection tests; run the full suite after the shared date/tariff contract changes.
3. **State integrity:** complete Tasks 4–6. Run archive/app tests and browser race/recovery tests; run full lint, unit, build, and Chromium journeys.
4. **User-visible economics and evidence:** complete Tasks 7–8. Validate all headline and export values against authoritative fixtures; publish only tested browser/performance claims.
5. **Operational qualification:** complete Task 9 with repository administrator/hosting access. Keep it explicitly open if those controls or the hosting target are unavailable.
6. **Optional roadmap:** Task 10 follows the stable v1 gate and must not be used to mask incomplete v1 correctness or deployment controls.

## Audit-to-roadmap traceability

| Audit item | Roadmap task | Initial disposition |
|---|---:|---|
| VW-01 G7 measured full-year projection | 1 | Owner/scope decision first; implementation depends on original G7 contract |
| VW-02 independent resource timezone | 3 | Core UX/data-contract correction |
| VW-03 resource removal changes mode | 3 | Core state transition correction |
| VW-04 host-zone-dependent legacy tariff | 2 | Numerical correctness; reproduce before migration |
| VW-05 missing timezone eligibility fail-open | 2 | Eligibility correctness |
| VW-06 loose direct projection fallback | 2 | Engine-boundary contract hardening |
| VW-07 domain-invalid archives | 4 | State integrity and recovery |
| VW-08 stale load file reads | 5 | State integrity and race safety |
| VW-09 undefined ingestion limits | 5 | Measure first; define and enforce supported bounds |
| VW-10 unsaved-work notice | 6 | User recovery; no automatic persistence assumed |
| VW-11 limited device/browser evidence | 8 | Release qualification, not evidence of a current budget failure |
| VW-12 branch protection and hosted deployment | 9 | Operator/platform gate outside code-only authority |
| VW-13 generation labels | 7 | Presentation correction |
| VW-14 generator savings semantics | 7 | Reproduce and align economics/copy/exports |
| VW-15 numerical browser coverage | 8 | Expand after core contracts stabilize |
| VW-16 large component complexity | 10 | Incremental maintainability, not a release rewrite |

