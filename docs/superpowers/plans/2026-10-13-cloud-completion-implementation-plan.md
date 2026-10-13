# VoltWise Cloud Completion Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Verify and integrate the pushed VoltWise correction branch, close demonstrated software and G7 evidence gaps, run one final integration gate, and leave a source-bound handoff without claiming hardware or hosted qualification.

**Architecture:** Preserve the existing local-first application, canonical time/alignment and physics utilities, G6 generator dispatch, battery/grid/tariff accounting, archive contracts, and no-generation compatibility route. Start by reconciling branch reality; test only demonstrated defects; trace G7 evidence to the supplied source and exact candidate SHA; run the broad gate once after the candidate is locked. Keep PR merge, GitHub administration, hardware testing, and hosted release operations behind their stated operator/owner gates.

**Tech Stack:** React 19, TypeScript, Vite, Vitest, Playwright, Bun 1.4.3 for the established benchmark runtime, GitHub Actions, and the existing static build/package workflow.

**Spec:** `VoltWise_Codex_Cloud_Completion_Roadmap_2026-10-13.md` (user attachment; its §4 transcribes 40 G7 criteria but says the original `VoltWise_G7_MilestoneRoadmap.md` remains authoritative); current repository contracts and `AGENTS.md`; `docs/superpowers/plans/2026-10-13-production-readiness-roadmap.md` for prior implementation evidence.

## Review of SOL's roadmap and verified starting state

The roadmap correctly separates cloud-verifiable software work (C0–C6) from dedicated-device and hosting work (D1–D4). Its safeguards against reimplementing accepted simulation logic, misrepresenting disabled-resource archive tests as active-generation performance, and treating a green build as release authorization are sound. Its C5 note also sensibly avoids requiring an unavailable second reviewer in a solo-maintained repository while retaining required checks and branch protections where permissions allow.

The snapshot needs these corrections when execution starts:

- Live Git refs were rechecked on October 13, 2026: `origin/main` is `cfd433a594c1f6675b7225165a60c1b0dc85016e` (PR #2 merge) and the pushed correction branch is `9ab78ae314b5d803dc683c18abc5455d58567a25`. They share merge base `54a0377`; `main` is one commit ahead while the correction branch contains eight later correction commits. The branch does not contain the latest `main` merge commit. Preserve it and integrate it non-destructively onto a new branch from current `main`.
- `git ls-remote` confirmed both branch SHAs. GitHub API/PR-list access was forbidden with the configured credential, so the open-PR count, current checks, protection rules, and repository security settings remain unverified and must be rechecked with valid owner access.
- Before implementation, the only worktree entry was this untracked implementation-plan document. The correction branch has a passing shared integration gate at the earlier source-equivalent `1776be1`, focused G7 tests at `daa0006`, and a later benchmark harness change at `83f77d5`; commit `9ab78ae` updates documentation. These are historical results, not a full gate on `9ab78ae`.
- Root `AGENTS.md` identifies a cloud-onboarding test observation: `generatorRoutingIntegration.test.ts:360` previously failed strict floating-point equality while 1,016 other tests passed. Recheck the test on the actual candidate; do not treat the observation as a confirmed current defect or change model arithmetic without a reproduced cause.
- The exact G7 source named in the attachment was not found in the checkout or current attachment. Use the transcribed 40-item appendix only as an interim specification until the owner supplies the authoritative file; never describe that as verbatim source verification.

## Global constraints

- Keep no-generation simulation on the legacy battery-only route with its exact covered parity; disabled generation assets do not affect results or cost.
- Reuse existing time/alignment, solar/wind, generator, battery/SOC provenance, grid/energy accounting, tariff, projection/finance, archive, and export authorities; do not duplicate a model.
- Require explicit valid site IANA time zones. Reject ambiguous/invalid DST, incomplete or irregular input, misalignment, invalid records, and over-budget candidates without replacing active project state.
- Preserve deterministic representative-year replay, solar hardware degradation, unchanged wind-resource inputs, compact projection records, source immutability, and partial-period safety. Do not describe replay as future-weather forecasting.
- Preserve local-first behavior and v1/v2 project compatibility. Add no cloud persistence, user accounts, credentials, weather services, or unrelated features.
- Keep the 35,136-row, 2 MiB per-file, 9 MiB aggregate persisted-data, 11 MiB project-input, and 12 MiB archive-file limits distinct and source-backed. A theoretical ten-resource project is not implied by the asset-count ceiling.
- Add focused regression tests only for reproduced gaps. Run broad Vitest/TypeScript/build/Chromium verification at C4 after the candidate is locked, not after each narrow task.
- Do not merge, change repository settings, tag/publish, select a host, or deploy without the specific owner/operator access and approval called for by the source roadmap.

## Review focus

- A project near the 9 MiB persisted-data ceiling receives ordinary metadata/rate edits: Save must remain available or the edit must be prevented before dirty state becomes unsaveable. Pin this in C1.
- Resource or load replacement completes after a newer selection, fails validation, or exceeds a budget: active inputs and dirty state must remain intact. Pin each reproduced path in C1 using existing async-import/archive fixtures.
- Duplicate, rebind, remove, and reopen operations interact with shared resource records: references must remain valid and no unrelated attachment may be silently dropped. Cover only gaps found in C1's path review.
- A supported archive can be large while its measured solar/wind assets are disabled: documentation must distinguish archive/recovery verification from active 25-year performance evidence. Preserve that distinction in C2/C3.
- G7's transcribed checklist appears comprehensive but the original §28/§36/§37 file is unavailable: each item must remain source-qualified and NOT VERIFIED where evidence is missing; pin this in C2 and C4.

---

### Task 1: C0 — Reconcile branch state and protect existing work

**Files:**
- Read: `AGENTS.md`, `docs/superpowers/plans/2026-10-13-production-readiness-roadmap.md`, `.github/workflows/ci.yml`, `.github/workflows/release.yml`, current Git history and tests.
- Create: `.superpowers/sdd/2026-10-13-cloud-completion-implementation-plan/progress.md` (ignored execution ledger).
- Modify: no application code unless a source conflict is actually found.

**Interfaces:**
- Consumes: current remote refs and `9ab78ae` correction branch.
- Produces: a recorded candidate base/merge-base, PR/CI/settings verification status, and a scoped conflict list for Tasks 2–4.

- [x] **Step 1: Recheck live refs, worktree, PRs, checks, and admin visibility.** Run `git status --short`, `git fetch origin` when authorized and reachable, `git rev-parse origin/main HEAD`, `git merge-base origin/main HEAD`, `git rev-list --left-right --count origin/main...HEAD`, and `git ls-remote origin refs/heads/main refs/heads/codex/production-readiness-roadmap-2026-10-13`. Query PRs/checks/settings only if GitHub access is available; record unavailable separately. Result: `main=cfd433a`, correction branch=`9ab78ae`, and GitHub PR/settings requests were denied because the configured token is invalid.
- [x] **Step 2: Inspect the eight correction commits after merge base `54a0377` and the complete main-to-branch diff.** Confirm they correspond to the correction work; record that current main's one commit is the PR #2 merge of the planning document. Do not rebase, reset, force-push, cherry-pick, or discard commits merely to match the stale snapshot. The diff contains the planned timezone, leap-year, saveability, evidence, benchmark, and documentation changes; no unrelated feature scope was found.
- [x] **Step 3: Create a local integration branch from current main and merge the correction branch non-destructively.** Preserve the pushed correction branch; resolve and document only source conflicts. Do not force-push or discard either history. Completed as `codex/cloud-completion-2026-10-13`, merge commit `e09fe2a`; there were no conflicts.
- [x] **Step 4: Run the known floating-point test alone as a baseline check:** `npx vitest run src/__tests__/generatorRoutingIntegration.test.ts`. Record its exact result and whether line 360 still fails; do not modify it in C0. Result: 1 file / 25 tests passed; the earlier strict-equality failure did not reproduce.
- [x] **Step 5: Write the baseline, candidate SHA, unavailable external evidence, and any conflict ruling to the execution ledger.**
- [x] **Step 6: Commit the implementation-plan document and the non-destructive integration merge** using scoped commit messages; do not change application behavior in C0.

**Acceptance:** Existing correction commits are preserved; candidate ancestry and diff are understood; no release-setting or application behavior changed. PR/admin claims are verified or explicitly blocked.

### Task 2: C1 — Close demonstrated input, mutation, and saveability gaps

**Files:**
- Review: `src/App.tsx`, `src/utils/projectArchive.ts`, `src/utils/importLimits.ts`, load/resource parsers and attachment flows, `src/components/ProjectFileControls.tsx`, `src/__tests__/projectArchive.test.ts`, relevant component tests, and `e2e/smoke.spec.ts`.
- Modify only the failing caller/contract/test implicated by reproduction.

**Interfaces:**
- Consumes: C0's selected candidate and current 35,136 / 2 MiB / 9 MiB / 11 MiB / 12 MiB contracts.
- Produces: tests proving accepted edits remain saveable and failed/replaced/stale imports preserve active data and dirty state, or a documented negative finding with no code change.

- [x] **Step 1: Map existing tests to the five import/recovery paths** in the source roadmap: ordinary settings edits, resource replacement, load replacement, duplicate/rebind/remove, and stale/invalid async completion. Reuse maximum-project and cancellation fixtures already in `projectArchive.test.ts` and `e2e/smoke.spec.ts`.
- [x] **Step 2: Add a realistic near-budget archive fixture** to `src/__tests__/projectArchive.test.ts` using individually valid CSV records and distinct resource bindings. Assert normalized persisted bytes and archive bytes against the separate 9/11/12 MiB ceilings; ensure this is not an artificial over-limit fixture.
- [x] **Step 3: Add a focused browser/component regression for an ordinary settings or asset-metadata edit on the accepted near-budget project.** Assert Save remains available and a saved archive reopens. Run the new test before any production change and preserve its failure output.
- [x] **Step 4: Add or extend one regression per reproduced atomicity hole.** For each invalid, over-budget, duplicate/rebind/remove, or stale read path, assert current load/resource bindings and “Unsaved changes” status are preserved. Do not rebuild an already-covered fixture.
- [x] **Step 5: Make the smallest production correction only for a reproduced defect.** Keep validation before state replacement and reuse project archive/data-flow APIs. If all edits fit the measured metadata reserve and every candidate path is atomic, record that evidence and make no production-code change.
- [x] **Step 6: Run affected Vitest and targeted Chromium tests** and record exact pass/fail counts and any remaining untested path.
- [x] **Step 7: Commit the focused regression and any demonstrated minimal fix** after its focused tests pass.

**Acceptance:** Every accepted ordinary edit can be saved/reopened; failed/over-budget/stale candidates leave active data and dirty status intact; all numeric limits remain distinct and consistent; no new persistence or modeling behavior is introduced.

### Task 3: C2 — Audit all 40 G7 checks against authoritative source and tests

**Files:**
- Read: owner-supplied `VoltWise_G7_MilestoneRoadmap.md` §§28, 36, 37; `docs/g7-final-audit.md`; generation/parser/projection/export/compatibility tests and their owning source.
- Modify: `docs/g7-final-audit.md`; add only G7-required focused tests if the audit finds a material evidence gap.

**Interfaces:**
- Consumes: C0 candidate SHA and the authoritative G7 source, if supplied; otherwise the clearly labeled transcribed 40-point appendix.
- Produces: a 40-row PASS / FAIL / NOT VERIFIED crosswalk, exact requirement source/heading, test and code links, evidence SHA, limitations, and unsigned owner-approval field for C4 to finalize.

- [ ] **Step 1: Locate and read the actual G7 source.** Search current repo/history and request the exact project file from the owner if unavailable. Until received, label each crosswalk row “based on supplied transcription; source not independently reviewed” and do not claim exact-source verification.
- [ ] **Step 2: Map criteria 1–40 individually** to a test name/path and source contract. Cover parser/time/DST/alignment, solar and wind physics, mixed and multiple assets, G6/no-generation compatibility, conservation, projection/finance, UI, compact exports, and full Vitest/TypeScript/build criteria.
- [ ] **Step 3: Run only suites needed to settle uncertain rows.** Name a missing/invalid test as NOT VERIFIED rather than infer PASS from nearby coverage or CI. Add a focused regression only for a requirement that is both in G7 and actually uncovered.
- [ ] **Step 4: Check all §28 categories and §37 verdict labels** against the source. Ensure no claim of calibration, future weather, bill accuracy, certification, or advice exceeds the tested model contract.
- [ ] **Step 5: Add an unsigned audit template bound to the current candidate SHA.** Reserve final full-suite status and human/product-owner sign-off for C4; do not pre-fill those as passing.
- [ ] **Step 6: Commit the 40-item evidence record and any necessary focused G7 test** after the named focused tests pass.

**Acceptance:** All 40 items have an individual defensible verdict; the audit names its actual source and evidence SHA; missing original source or owner approval stays explicit. No full G7 PASS is possible before C4.

### Task 4: C3 — Prepare CI, browser smoke, and release-package evidence

**Files:**
- Review: `.github/workflows/ci.yml`, `.github/workflows/release.yml`, `docs/browser-testing.md`, `docs/performance-budget.md`, `docs/release-runbook.md`, `e2e/smoke.spec.ts`.
- Modify only a demonstrated workflow, test, or evidence-description gap.

**Interfaces:**
- Consumes: C1 regression results and C2's bounded evidence language.
- Produces: verified cloud CI configuration, accurate supported-browser/performance claims, and a local static artifact check ready for C4.

- [ ] **Step 1: Cross-check Chromium journeys against the roadmap list.** Verify fresh timezone setup; load/resource valid-invalid imports; 2024 boundaries; archive caps/recovery; save/open/recalculate; unsaved warnings; result/export parity; keyboard/readiness/accessibility basics; mixed solar/wind/generator. Reuse current tests and add no journey without a demonstrated missing contract.
- [ ] **Step 2: Inspect both workflows** for pinned actions, frozen lockfile, exact quality/audit/review/secret-scan jobs and release version/tag/SHA/checksum validation. Record the exact workflow path and job names; do not weaken gates to work around unavailable credentials.
- [ ] **Step 3: Make at most one bounded Firefox attempt** only if a compatible browser install path is available. If launch is blocked, retain `INSTALLATION BLOCKED`; do not claim Firefox passed or make a persistently unavailable browser a required check.
- [ ] **Step 4: Align performance and release docs to measured evidence.** Preserve the distinction between disabled-resource archive round trip and active measured mixed generation. Do not describe Node/tsx numbers as equivalent to Bun/browser measurements or imply a low-memory guarantee.
- [ ] **Step 5: Confirm the static output is buildable during C4** and that runbook tag/version/SHA/checksum steps match `release.yml`. Do not tag or upload an artifact in this task.
- [ ] **Step 6: Run focused YAML/config parsing or browser tests only when a relevant file changed** and record all platform-blocked checks.
- [ ] **Step 7: Commit any evidence-backed workflow/test/doc correction** after its focused verification; if the review finds no gap, record that finding without an unnecessary source commit.

**Acceptance:** CI/release source matches its documented checks, browser support claims match actual evidence, and no deployment or publication occurred.

### Task 5: C4 — Lock candidate and run the one full software/G7 gate

**Files:**
- Modify: `docs/g7-final-audit.md`, final test log/evidence references, and any narrowly required regression fix from Tasks 2–4.
- Create: retained task-specific logs in the execution ledger workspace; do not store credentials or private energy datasets.

**Interfaces:**
- Consumes: C0–C3 candidate diff and 40-point audit.
- Produces: final candidate SHA, exact command outputs, browser results, and `PASS` / `INCOMPLETE` / `FAIL` verdict for C5/C6.

- [ ] **Step 1: Freeze and record the candidate SHA and diff.** Run `git status --short`, `git rev-parse HEAD`, and inspect candidate-to-main diff. No source changes after this point without affected retesting and a new SHA record.
- [ ] **Step 2: Run the exact G7 required commands once, in order:** `npx vitest run`, `npx tsc --noEmit`, and `npm run build`. Capture full output and actual totals/exit statuses; compare results to the C0 baseline floating-point test.
- [ ] **Step 3: Run production browser acceptance:** `npm run test:e2e:chromium`. Record the actual number passed/failed/skipped and ensure the maximum archive test and C1 new regressions are included.
- [ ] **Step 4: If a gate fails, isolate the cause.** Add a failing focused regression before correcting product code; rerun affected tests. Re-run the broad gate if a shared contract changes or the final source SHA changes materially. Do not bind old results to a new SHA.
- [ ] **Step 5: Fill the exact §37 verdict block** and all 40 row verdicts at the final SHA. Use `FINAL G7 AUDIT: PASS` only if every required row/category and all three exact G7 commands pass. Otherwise write `INCOMPLETE` or `FAIL`, list gaps, and leave owner sign-off `PENDING`.
- [ ] **Step 6: Commit the audit evidence.** Preserve both the tested application candidate SHA and the documentation commit SHA; if the code tree is unchanged between them, state that explicitly so evidence is not falsely assigned to a different source revision.

**Acceptance:** Reproducible `candidate SHA → 40 G7 checks → Vitest/TypeScript/build/Chromium logs → exit verdict`; no blanket PASS from CI and no owner sign-off inferred from tests.

### Task 6: C5 — Open reviewed PR and obtain approved integration

**Files:**
- Review and, only if owner-authorized, modify GitHub PR/settings through the approved interface.
- Update: `docs/g7-final-audit.md` only after new CI/merge evidence exists.

**Interfaces:**
- Consumes: C4 final candidate SHA and verdict.
- Produces: PR URL, independent CI run result, review resolution, owner-approved merge record, and post-merge `main` SHA or explicit open blocker.

- [ ] **Step 1: Recheck current `main`, open PRs, and repo policy** with authorized GitHub access. If the branch changed, reconcile non-destructively and rerun affected checks.
- [ ] **Step 2: Create or update a PR** from the final integration branch to current `main`, describing fixes, focused/full tests, G7 verdict, candidate/limitations, and D1–D4 deferrals. Do not state that the full gate or CI ran unless the final commit proves it.
- [ ] **Step 3: Verify current PR checks**: quality, dependency audit, dependency review, secret scan. Read review comments and resolve them. Never self-approve or invent an independent review.
- [ ] **Step 4: Inspect existing branch rules and repository security settings** if owner/admin access is available. With explicit owner authorization, configure PR-required checks and force-push/deletion protection where supported; otherwise record the exact owner action still pending. Only require an independent approval if a real reviewer or owner-approved workflow exists; avoid a self-deadlocking rule.
- [ ] **Step 5: Stop before merge and ask the owner for explicit merge approval.** After approval and merge, record actual merge/main SHA and fresh post-merge CI; otherwise record PR/check status and leave `main` unchanged.

**Acceptance:** A reviewed PR carries passing required checks on its exact head; merge occurs only after owner approval; post-merge SHA/CI is evidenced or clearly pending. No tag/release/deployment.

### Task 7: C6 — Write the cloud completion handoff and stop

**Files:**
- Create or update: `docs/production-readiness-handoff.md`.
- Read: final G7 audit, release runbook, performance/browser docs, C0 ledger, PR/CI evidence.

**Interfaces:**
- Consumes: verified C0–C5 outputs and actual external-access status.
- Produces: a concise, restartable cloud completion record and dedicated-machine/operator checklist.

- [ ] **Step 1: Record branch, PR, final `main` SHA (or unmerged candidate SHA), verification date, and actual Actions URLs.** Never substitute the candidate branch for default branch after an unmerged PR.
- [ ] **Step 2: Record G7 status/40-row audit, exact command outcomes, owner sign-off (`PENDING` unless given), and any NOT VERIFIED criteria.**
- [ ] **Step 3: Summarize supported input/archive limits, measured resource modes, browser/runtime evidence, exact benchmark commands, and known code defects separately from environment/device/deployment gaps and post-v1 scope.**
- [ ] **Step 4: Include D1–D4 as an operator checklist:** enabled 35,136-row active mixed generation on named hardware with PSS/cgroup memory; intended browser workflows; staging security headers/smoke/rollback; GitHub protections and alerts. State that none of these were completed in cloud unless evidence proves otherwise.
- [ ] **Step 5: Run a final documentation/diff check and commit the handoff.** Stop cloud implementation after this record; do not start G8, choose a host, deploy, tag, or publish.

**Acceptance:** Handoff distinguishes merged main from candidate branch, reports real checks and limitations, contains no credentials/private datasets, and gives a copyable dedicated-machine phase.

## Deferred dedicated-machine/operator phase

Do not execute during C0–C6. Keep these checkpoints for a later specifically authorized task:

- **D1 Hardware/performance:** identify physical 8 GiB/4-core target and reference machine; production build with enabled 35,136-interval solar+wind (and relevant battery/generator); repeat imports/save/reopen/projection/cancellation/interaction/export; PSS/cgroup memory; compare to budgets and revise only for reproduced regressions.
- **D2 Browser/user workflows:** actual Chromium/Edge and compatible Firefox only if intended; file cancellation, reload/close, downloads/reopen, progress, keyboard/accessibility and viewport; publish only tested support combinations.
- **D3 Release operations:** owner chooses host and operator; approved main tag/package/checksum; staging HTTPS/security headers/CSP/privacy; hosted smoke and rollback; explicit owner sign-off before prerelease.
- **D4 GitHub administration:** verify required passing PR jobs, PR rules, force-push/deletion protection, dependency graph/alerts/secrets settings; avoid unattainable approval rules without an independent reviewer.

The cloud completion report must use the supplied compact format and say `COMPLETE`, `PARTIAL`, or `BLOCKED` based on evidence. A successful C4 software gate does not close D1–D4.
