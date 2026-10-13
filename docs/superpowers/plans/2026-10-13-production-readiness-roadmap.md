# VoltWise Production-Readiness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Close the remaining user-facing input/recoverability defects and complete the formal, device, governance, and hosted-release evidence needed to qualify VoltWise beyond beta.

**Architecture:** Preserve the current local-first app and its canonical timezone, parser, project archive, and simulation contracts. Add focused fail-first tests around the reported gaps, enforce one documented limit consistently across UI/import/worker/archive boundaries, and keep G7 acceptance and operator release evidence traceable to exact SHAs.

**Tech Stack:** React 19, TypeScript 7, Vite 8, Vitest 5, Bun 1.4.3, Playwright Chromium; existing Firefox project is not yet qualified.

**Spec:** `VoltWise_Production_Readiness_Commit_Audit_2026-10-13_Updated.md` (user-provided audit; not tracked in the checkout), `docs/model-scope.md`, `docs/project-files.md`, `docs/g7-measured-resource-projection-decision.md`, and the merged G7 implementation on baseline `efccbb41d9b5df90db8d550161c68144ed4bb0cb`.

## Global Constraints

- Site-local tariff and timestamp interpretation require an explicit valid site IANA timezone; never infer a real user's timezone.
- Full-calendar eligibility must include leap-year lengths when the selected cadence supports them; do not annualize partial data.
- Only fully parsed, validated, saveable project states may replace active state; failures preserve existing data and dirty status.
- Project files remain local-first, versioned, and validated; do not add cloud persistence or backend credentials.
- Measured-resource lifecycle output replays one complete matched representative resource year through the authoritative engine; it is not a forecast.
- Do not add dependencies unless a measured browser/archive requirement cannot be met with current platform APIs and packages.
- Run focused tests for narrow changes; run the full integration gate after the shared timezone/input/archive contracts are combined.

## Review Focus

- Fresh synthetic sample with no timezone: can the user understand why Results are available or blocked, and is any demo timezone explicitly illustrative? Covered by Task 1 fresh-context browser test.
- Uploaded load with missing/invalid site timezone: can Data & Rates ever report ready while the worker rejects? Covered by Task 1 readiness and UI tests.
- Complete 2024 quarter-hour load/solar/wind input at exact and over-limit byte/row boundaries: is it accepted only when complete and within measured limits? Covered by Task 2 parser/alignment/archive tests.
- Maximum accepted resource mix plus load CSV: can the exact state be saved, reopened, and recalculated without partial mutation or memory failure? Covered by Task 3 maximum-project round-trip test.
- Measured resource Year-N output, source immutability, exports, and older project versions: does acceptance remain traceable to the precise G7 and archive contracts? Covered by Task 5's audit checklist and its linked regression suites.

---

**Roadmap date:** October 13, 2026.

**Baseline:** Audit-reviewed `main` SHA `efccbb41d9b5df90db8d550161c68144ed4bb0cb`, merged PR #1. Verify the current `main` SHA and its checks again when implementation begins.

**Release position:** Integrated beta; not production-qualified. The full-year measured-resource projection, timezone/calendar engine corrections, resource attachment behavior, archive domain validation, race-safe imports, unsaved-work warnings, generator economics/labels, numerical golden coverage, and Chromium journey coverage are implemented. The PR and post-merge CI runs reported by the audit passed. This roadmap does not reopen those completed changes.

**Source of findings:** The October 13 updated repository/commit audit, the tracked model-scope and G7 decision documents, source references in the audit, and current repository history. Audit statements are evidence to verify and plan against; they are not independent authorization to deploy, change repository settings, or expand product scope.

## Principles and scope

- Reproduce source-confirmed risks with focused tests before changing contracts. Preserve the fail-closed site-timezone rules for real user data.
- Make every accepted input/project combination usable and recoverable under the documented limits.
- Reuse existing parsers, eligibility functions, archive validation, simulation engines, and result/export contracts.
- Do not infer a user's site timezone. Any synthetic demo timezone must be clearly labeled as illustrative and must not silently become a real site's timezone.
- Keep this v1 correction scope local-first. Full utility-bill reconciliation, outages, weather APIs, accounts/cloud sync, forecasting, and broad redesign remain separate product proposals.
- Treat lower-memory/browser performance claims as unverified until measured on named target environments. Green CI is not host or device qualification.
- The audit did not run a local checkout itself. Preserve its distinction between CI evidence, source-confirmed findings, constructed size estimates, and behaviors reproduced by new tests.

## Completed evidence to retain

- PR #1 merged as `efccbb41d9b5df90db8d550161c68144ed4bb0cb`.
- The audit records successful default-branch CI run `38399192761`: TypeScript, 1,106 Vitest tests, production build, Chromium 13/13, dependency audit, and secret scan.
- PR run `38398324591` passed quality, dependency review, dependency audit, and secret scan. Dependency review is no longer an open blocker; do not disable it or repeat the earlier “dependency graph unavailable” remediation.
- The former five-second full-year test timeout is resolved by a targeted 15-second test timeout. Do not treat the initial red attempt as current status.
- Full-year measured solar/wind projection implementation is present and regression-covered. Its remaining G7 item is formal category-by-category sign-off, not another implementation of the feature.

## Task 1: Make first-run timezone behavior and readiness agree (VW13-02, VW13-03)

**Priority:** P1 — core usability and truthful readiness.

**Files to review:** `src/App.tsx`, `src/utils/generationDefaults.ts`, `src/components/DataAndRatesTab.tsx`, `src/utils/loadTimeAlignment.ts`, relevant App/component tests, `e2e/smoke.spec.ts`, and `README.md`.

- [ ] **Step 1: Write the failing readiness tests** in `src/__tests__/appSimulationIntegration.test.ts` (or a focused readiness test): null, invalid, valid-but-non-operational, and valid operational site alignment; only exact positive eligibility reports ready.
- [ ] **Step 2: Write failing first-run browser tests** in `e2e/smoke.spec.ts`: a fresh context with no timezone must show the reason and direct setup action; selecting a valid timezone must make sample results usable; uploaded load with no timezone must remain blocked.
- [ ] **Step 3: Run the focused tests and confirm the current failure.** Run the named Vitest tests and the targeted Playwright cases; record the false-ready and no-setup-action behavior.
- [ ] **Step 4: Implement the explicit setup path.** Use `siteAlignmentEligibility?.operationallySimulatable === true`; show the eligibility reason and navigate to the site timezone control. Keep the initial sample without a fabricated timezone; do not infer a zone from browser/location settings.
- [ ] **Step 5: Align first-run and README instructions** with the actual initial tab and setup path.
- [ ] **Step 6: Rerun focused tests and commit** after they pass; verify prior tariff and projection tests remain unchanged.

**Acceptance:** A fresh browser session does not show a false “ready” state; it clearly explains that the illustrative sample needs an explicit site timezone and provides a direct setup action. Uploaded data with missing site-time validation stays visibly not ready and cannot enter simulation. Selecting a valid timezone makes the sample usable; no timezone is inferred or silently assigned. Existing tariff and projection semantics remain unchanged.

**Verification:** Focused readiness and App tests; fresh-context Playwright journey from `/` without pre-seeding settings; uploaded-load journey with no timezone and after selecting one; `npm run lint`.

## Task 2: Align interval and byte limits with full leap-year support (VW13-04)

**Priority:** P1 — declared calendar capability currently conflicts with the row ceiling.

**Files to review:** `src/utils/importLimits.ts`, load and resource CSV parsers, annual eligibility, project archive validation, relevant UI error copy, import/archive tests, `scripts/benchmark-simulation.ts`, `docs/performance-budget.md`, `docs/model-scope.md`, and `docs/measured-resource-data.md`.

- [ ] **Step 1: Write failing exact-calendar tests** in `src/__tests__/csvParser.test.ts`, `src/__tests__/externalResourceParser.test.ts`, and `src/__tests__/temporalValidationAndCompleteness.test.ts` for UTC 2024 (35,136 rows), UTC 2025 (35,040), missing/duplicate/gapped rows, and the first unsupported row count. Cover load and measured solar/wind files.
- [ ] **Step 2: Run those tests to confirm** that the leap-year boundary is rejected by the current 35,040-row limit while incomplete/irregular sequences remain rejected for the right reason.
- [ ] **Step 3: Measure the extra 96 intervals** with `scripts/benchmark-simulation.ts` for representative single/multi-profile cases and measure realistic plus high-precision CSV byte sizes. Evaluate the existing 2 MiB limit separately from row count.
- [ ] **Step 4: Set one shared ceiling** of at least 35,136 rows and a benchmark-supported byte ceiling. Apply both consistently to parsers, UI prechecks, worker inputs, and archive validation. Do not raise the byte limit without measured input size and memory evidence.
- [ ] **Step 5: Run parser, exact-year, import, and archive boundary tests** and confirm 2024/2025 full years pass while gaps and over-limit files fail atomically.
- [ ] **Step 6: Update model-scope/resource/performance docs and commit** the constants, tests, measured boundary evidence, and copy together.

**Acceptance:** A valid complete quarter-hour leap year can pass parser, alignment, annual-eligibility, simulation, archive save/open, and measured-resource checks within a measured byte limit. Equivalent non-leap-year behavior remains valid. Missing, duplicate, irregular, over-limit, and oversized inputs fail recoverably without mutating active project state.

**Verification:** Focused parser/alignment/eligibility/archive tests; representative benchmark; exact-boundary browser imports and archive round-trip. Include memory and process/renderer observations; do not extrapolate beyond measured evidence.

## Task 3: Make every accepted project saveable and reopenable (VW13-05)

**Priority:** P1 — data recoverability. Depends on Task 2 because revised interval and byte bounds affect archive sizes.

**Files to review:** `src/utils/importLimits.ts`, `src/utils/projectArchive.ts`, load/resource import and attachment flows, `src/components/ProjectFileControls.tsx`, archive/import tests, `e2e/smoke.spec.ts`, and `docs/project-files.md`.

- [ ] **Step 1: Add failing size/saveability tests** in `src/__tests__/projectArchive.test.ts` using maximum supported load/resource rows and realistic record precision. Measure normalized archive bytes and browser peak memory; treat the audit's 4.38 MiB per-resource figure as an estimate until reproduced.
- [ ] **Step 2: Establish the v1 size contract before implementation.** Prefer retaining the versioned JSON format and 12 MiB archive ceiling with a measured project-wide persisted-data budget and reserved metadata headroom. The supported full-year load + one solar + one wind case must fit. If measurements show this cannot fit safely, document and test a versioned archive alternative rather than silently increasing limits or breaking old archives.
- [ ] **Step 3: Run the maximum-combination tests** and record the current oversized cases, save failures, and memory before changing serialization/import behavior.
- [ ] **Step 4: Implement one shared projected-archive-size check** from normalized `ProjectArchiveState`; use it for serialization and before any load/resource import or attachment that would make the active project unsaveable. Preserve v1/v2 archive readers. Reserve bounded metadata capacity or validate all persisted-size increases so ordinary settings cannot cross the archive ceiling after data acceptance.
- [ ] **Step 5: Add recovery assertions** proving an over-budget candidate preserves active data and dirty status, and that valid saves still reopen and recalculate with matching authoritative outputs.
- [ ] **Step 6: Add the production-browser round-trip** for the maximum supported combination: import/configure → simulate → save/download → fresh page → open → recalculate → compare result/export values.
- [ ] **Step 7: Run archive/component/browser tests, record final byte and peak-memory bounds, update `docs/project-files.md`, and commit.**

**Acceptance:** Every project state the app accepts under published input/project limits remains serializable below the archive ceiling and can be reopened. At minimum, a full-year supported load plus full-year measured solar and wind scenario is saveable. Over-budget candidates are rejected before replacing active state; existing data and dirty status remain intact. The maximum-combination case passes in a production browser within the measured memory budget.

**Verification:** Archive and UI boundary tests; maximum-combination production Chromium journey; same-input recalculation and export equality; benchmark peak memory and archive bytes. Document any deliberately narrower aggregate resource limit.

## Task 4: Reconcile user and developer documentation with shipped behavior (VW13-10)

**Priority:** P2 — prevents contradictory setup and capability claims. Depends on Tasks 1–3 so documentation can describe final contracts.

**Files to review:** `README.md`, `docs/model-scope.md`, `docs/measured-resource-data.md`, `docs/project-files.md`, `docs/privacy.md`, `.env.example`, `docs/browser-testing.md`, and `docs/performance-budget.md`.

- [ ] **Step 1: Search docs and env examples** for measured-resource troubleshooting that contradicts implemented representative-year replay; update `docs/model-scope.md` and `docs/measured-resource-data.md` to explain fixed measured weather and hardware degradation.
- [ ] **Step 2: Search for obsolete Gemini, AI Studio, OAuth, and Cloud Run requirements.** Remove unused variables from `.env.example` or label the file obsolete; keep only configuration actually read by the browser app.
- [ ] **Step 3: Align README/setup navigation** with Task 1's fresh-session/timezone path.
- [ ] **Step 4: Publish the final Task 2–3 row, byte, aggregate resource, and archive limits** in README/model scope/project files/performance docs. Tie each numeric claim to a constant and passing test/measurement.
- [ ] **Step 5: Check privacy and provenance claims** against the actual code/network behavior and run a diff review for remaining contradictory instructions.
- [ ] **Step 6: Commit the consistency update** only after the prior functional contracts are final.

**Acceptance:** README, setup/environment examples, troubleshooting, model scope, and project-file docs agree with shipped code. Every documented limit and workflow is traceable to a constant, test, or explicit operator step.

**Verification:** Search for obsolete terms and cross-check each remaining requirement against source and tests; review all documentation changes as one consistency set.

## Task 5: Record formal Final G7 acceptance for the release SHA (VW13-06 residual)

**Priority:** P1 release acceptance; this is a verification record, not a missing simulation feature.

**Files to create/review:** `docs/g7-final-audit.md`, `docs/g7-measured-resource-projection-decision.md`, generation/projection tests, output/export tests, and the supplied G7 section 28 source if it can be located by the owner.

- [ ] **Step 1: Locate the original G7 section 28 source** in the checkout/history or request it through the project owner; if absent, proceed from the audit's enumerated categories and label the source gap.
- [ ] **Step 2: Create `docs/g7-final-audit.md`** with one row per category: parsing; timezone/offset/DST/alignment; solar/wind model boundaries; battery SOC/provenance and grid conservation; tariff/finance; legacy battery-only compatibility; Year-1 equality and Year-N replay/degradation; results/JSON export; immutability; and fail-closed eligibility.
- [ ] **Step 3: Trace every row to exact SHA and evidence.** Record test/CI link, pass/fail/not-covered verdict, limitations, and follow-up. Run checks for uncovered categories; do not infer a universal pass from CI status.
- [ ] **Step 4: Map exact G7 acceptance IDs** if the source is found. If unavailable, cite the October 13 audit's category summary and explicitly state that section 28 itself was not reviewed verbatim.
- [ ] **Step 5: Review and record sign-off** while clearly excluding unsupported claims about site engineering, full utility bills, investment advice, or future-weather prediction.

**Acceptance:** A reviewer can trace every in-scope G7 acceptance category to a source-SHA-specific test or an explicit uncovered limitation and sign-off. No category is marked passed solely because CI is green.

## Task 6: Qualify intended browsers and resource/performance envelope (VW13-08, VW13-09 residual)

**Priority:** P2 for bounded beta claims; P1 before making broad low-memory/mobile support claims.

**Files to review/update:** `docs/browser-testing.md`, `docs/performance-budget.md`, `scripts/benchmark-simulation.ts`, Playwright projects, and browser/performance tests only where measurements identify a gap.

- [ ] **Step 1: Define the intended browser/device matrix** with one named lower-memory target and one reference device; record OS, browser/version, CPU/RAM, viewport, build SHA, and test procedure.
- [ ] **Step 2: On production builds, collect repeated measures** for import, save/open, 25-year runtime, peak process-tree memory, and interaction/cancellation responsiveness using Task 3's maximum supported project.
- [ ] **Step 3: Run the Firefox journey** on a compatible environment; report installation-blocked, unrun, failed, or passed distinctly. Add Firefox to support claims only after the relevant suite passes.
- [ ] **Step 4: Compare results with documented budgets** and write supported/unsupported device guidance based on the actual matrix. If devices are unavailable, keep the evidence gap open and make no minimum-device claim.
- [ ] **Step 5: Reassess the ~696.77 kB minified bundle warning** only if measurements show a startup/interaction issue; avoid warning suppression or unrelated refactoring.
- [ ] **Step 6: Commit measured evidence and browser guidance** without presenting one-off measurements as stable percentiles.

**Acceptance:** A versioned evidence matrix records actual passes and unavailable/unrun environments distinctly. Public device/browser claims do not exceed the measured matrix, and the maximum supported project remains usable within documented interaction/memory budgets.

## Task 7: Enforce governance and complete hosted release qualification (VW13-07)

**Priority:** P0 release gate. Requires repository administrator and hosting-operator access.

**Code/runbook:** Review existing `.github/workflows/ci.yml`, `.github/workflows/release.yml`, and `docs/release-runbook.md`; change repository code only for an evidence-backed gap. The audited dependency-review action passed, so do not reclassify it as open.

- [ ] **Step 1: Configure and verify `main` protection**: required PR, independent approval, current-base checks, stale approval dismissal, conversation resolution, force-push/delete restrictions. Require the exact stable CI job contexts from `.github/workflows/ci.yml` for quality, dependency audit, dependency review (PR only), and secret scan.
- [ ] **Step 2: Verify repository security settings** for dependency graph, Dependabot/security alerts, and secret scanning. Preserve the already-passing PR dependency-review gate.
- [ ] **Step 3: Select a static host and record operator procedures** for staging/production, ownership/access, and rollback; keep secrets out of the repository and CI logs.
- [ ] **Step 4: Deploy the exact tested artifact to staging** and verify HTTPS, HSTS where applicable, CSP including Google Fonts, `X-Content-Type-Options`, frame protection, and `Referrer-Policy`. Inspect console/network and rerun hosted journeys including download/open and local-first privacy behavior.
- [ ] **Step 5: Rehearse rollback** to the last verified artifact and confirm the deployed SHA returns to that version.
- [ ] **Step 6: Record source SHA, tag/version, CI run, artifact SHA-256, staging URL, headers, smoke, rollback, and release sign-off** in the runbook/release record. Publish a prerelease only after acceptance.

**Acceptance:** Branch protection is active and verified; a reviewed PR has all required checks; a tagged artifact is traceable to source and checksum; hosted smoke and security headers pass; rollback is exercised and recorded. Until every item has evidence, the release remains a beta and the task remains open.

## Post-v1 backlog (not release blockers)

Do not fold these into this correction roadmap: generation-aware multi-profile lifecycle comparison; annual generation CSV export; sensitivity analysis; complete utility-bill reconciliation (demand/fixed/taxes/net-metering true-up); chronological outage dispatch; weather APIs/EPW/TMY3; cloud accounts or project sync; unconstrained generator scheduling optimization; broad UI redesign. Reassess only after the v1 gates above or through a separately approved product specification.

## Recommended sequence and verification cadence

1. Complete Task 1 (readiness/onboarding); run its focused unit, component, and fresh-browser tests.
2. Complete Task 2 (leap-year/byte ceilings); benchmark and test exact boundaries.
3. Complete Task 3 (saveability) against the final Task 2 limits; test maximum supported round-trip and memory.
4. Complete Task 4 documentation against the frozen behavior and limits.
5. Complete Task 5 formal G7 traceability and mark uncovered categories honestly.
6. Complete Task 6 device/browser qualification for intended support claims; do not wait for unavailable environments to document blockers.
7. Complete Task 7 operator governance and hosted release qualification. This is a mandatory production gate.

After Tasks 1–4 are integrated, run the shared integration gate once: `npm run lint`, `npm test -- --maxWorkers=4`, `npm run build`, and `npm run test:e2e:chromium`, plus explicit leap-year and maximum archive round-trip cases. Rerun only checks affected by a subsequent change unless a failure or integration risk justifies broader testing. Preserve actual CI output and the release SHA in the final record.

## Audit-to-roadmap traceability

| Updated audit finding | Roadmap task | Status at audited SHA |
|---|---:|---|
| VW13-01 — initial CI timeout failure | — | Resolved; latest PR and main checks pass |
| VW13-02 — demo starts without a usable timezone | 1 | Open P1 |
| VW13-03 — period readiness fails open on null eligibility | 1 | Open P1 |
| VW13-04 — 35,040 limit excludes full 15-minute leap year | 2 | Open P1 |
| VW13-05 — allowed data/assets can exceed archive save cap | 3 | Open P1 |
| VW13-06 — full-year measured resource projection | 5 | Implemented; formal G7 sign-off remains |
| VW13-07 — unprotected main/no hosted release | 7 | Open P0 |
| VW13-08 — only reference-runner performance/device evidence | 6 | Open P2; P1 for broad support claims |
| VW13-09 — CI build/Chromium gate | — | Resolved on audited main SHA |
| VW13-10 — stale setup/troubleshooting guidance | 4 | Open P2 |
| VW13-11 — advanced scope | — | Parked post-v1, not a blocker |
