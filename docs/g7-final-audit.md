# Final G7 evidence review

**Evidence source:** the October 13, 2026 updated production-readiness audit's VW13-06 category summary. The audit says the supplied `VoltWise_G7_MilestoneRoadmap.md` section 28 defines the original Final G7 Audit categories.

**Original acceptance source:** not found in the checkout, reachable Git history, or supplied attachments. The tracked [G7 scope decision](g7-measured-resource-projection-decision.md) records the same gap. Therefore this is a category-level evidence review, not a verbatim requirement-ID crosswalk. Exact section 28 IDs and wording remain to be mapped if the source is supplied.

## Evidence snapshot

- **Current C2 candidate:** `292e293` (near-budget save/reopen regression and this audit update are being prepared on top of the integrated correction candidate). This revision has focused C1 evidence only; the final G7 gate is reserved for C4.

- **Candidate source SHA:** [`83f77d59479b351671a4782ba9643b0cf91b609d`](https://github.com/loganshirling/VoltWiseV2/commit/83f77d59479b351671a4782ba9643b0cf91b609d). The focused G7 suite was last run at `daa0006`; the only later source change before this candidate SHA adds a benchmark scenario and corrects the benchmark runtime label. No G7 implementation source changed after the focused suite. Current working-tree evidence updates are documentation-only.
- **Focused local verification:** at `daa0006`, `npm test -- --maxWorkers=4` with the 17 parser, alignment, solar, wind, generation, grid-flow, battery, tariff, finance, routing, projection, export, archive, and eligibility suites listed below passed: **17 files / 554 tests**. After that test run, only the benchmark harness changed in source; no G7 implementation code changed.
- **Shared local integration gate:** at source-equivalent SHA `1776be1`, **50 files / 1,113 Vitest tests**, lint, production build, and **18/18 production Chromium journeys** passed. Changes from that SHA include documentation updates and a later benchmark-harness change; the G7-specific suite was rerun at `daa0006`.
- **CI evidence:** no GitHub Actions run URL is recorded for this unpushed feature-branch SHA. The local test output is evidence, not a substitute for CI. The October 13 audit reports CI results for the then-merged `main` SHA, which predates these roadmap changes.

## Category review

| Category | Verdict at candidate SHA | Test evidence | Limits and follow-up |
|---|---|---|---|
| Parsing and archive validation | **PASS — automated contract coverage** | `externalResourceParser.test.ts` (schema, units, finite/non-negative values, ordering, cadence, and resource-size/row boundaries); `projectArchive.test.ts` (v1/v2 migration, resource record validation, maximum accepted archive); exact 2024 resource parser cases. | Does not establish that every external CSV provider's dialect is supported. The original section 28 requirements are unavailable for exact ID mapping. |
| Timezone, offsets, DST, and alignment | **PASS — tested cases** | `externalResourceParser.test.ts` (UTC, explicit offsets, source-zone local time, invalid zones, DST gaps/folds); `loadTimeAlignment.test.ts` (site-local calendar mapping, offsets, DST, cadence); `externalResourceAlignment.test.ts` (one-to-one solar/wind UTC alignment, missing/duplicate/irregular records). | No exhaustive timezone database or every historical rule transition was tested. Site timezone must be explicitly valid; behavior does not infer a location. |
| Solar and wind model boundaries | **PASS — deterministic model tests** | `solarGeneration.test.ts` (clear-sky/monthly/measured modes, orientation, losses, clipping, invalid input, disabled assets); `windGeneration.test.ts` (resource modes, power curves, site-local month, hub-height shear, air density, availability/losses, disabled assets); measured end-to-end simulation cases in `generationAwareSimulation.test.ts`. | Numerical fixtures verify implementation contracts, not field calibration, measured plant accuracy, or a certified engineering forecast. |
| Battery SOC/provenance and grid conservation | **PASS — tested accounting invariants** | `gridBatteryCharging.test.ts` and `gridBatteryExport.test.ts` (SOC provenance, cost basis, power/capacity limits, conservation); `generationAwareSimulation.test.ts` source reconciliation and renewable/grid totals; `gridFlowAccounting.test.ts` export/curtailment and grid boundary identities. | Evidence covers modeled interval contracts. It does not validate battery hardware telemetry or a particular installation. |
| Tariff and finance | **PASS — modeled arithmetic and routing cases** | `tariffRateResolver.test.ts`, `tariffCostAccounting.test.ts`, `generationFinancials.test.ts`, and `generationProjection.test.ts` (site-local seasons, costs/credits, CAPEX/O&M, escalation, degradation, reconciliation). | This remains an interval energy-rate model. Demand/fixed charges, taxes, minimum bills, ratchets, utility true-ups, and named-plan bill accuracy are outside scope. Financial outputs are estimates, not advice. |
| Legacy battery-only compatibility | **PASS — exact parity fixtures** | `simulationRouter.test.ts` no-generation parity cases compare to `runAnnualSimulation`; `jsonExportCorrectness.test.ts` ensures battery-only exports keep the established sections and omit generation-only sections. | Parity is asserted for covered inputs and outputs, not every historical project file or every tariff. Archive migration is separately covered by `projectArchive.test.ts`. |
| Year-1 equality and Year-N replay/degradation | **PASS — representative-year test** | `generationProjection.test.ts`: “projects aligned full-year measured solar and wind without changing the source series” compares Year 1 generation to authoritative simulation, checks Year-2 solar decline and unchanged wind, and confirms source immutability. | Uses a synthetic exact-alignment year. Replayed measurements represent one scenario year; later weather is not forecast. Hardware/weather assumptions are not independently certified. |
| Results and JSON export | **PASS — schema/content fixtures** | `jsonExportCorrectness.test.ts` generation period inputs/results, Year-1 output parity, financial fields, dataset provenance, and legacy export shape; production Chromium measured solar, wind, generator, and mixed-resource export journeys. | A valid export schema does not establish utility-bill accuracy or correctness for untested third-party consumers. |
| Input immutability | **PASS — frozen/source equality checks** | `externalResourceAlignment.test.ts`; solar and wind model tests; `generationProjection.test.ts`; `generationAwareSimulation.test.ts`; tariff/accounting test suites. | Immutability is covered at tested function boundaries; this is not a general memory-safety audit. |
| Fail-closed eligibility | **PASS — covered missing/invalid cases** | `loadTimeAlignment.test.ts` (empty/invalid site timezone and DST-invalid sequences); `temporalValidationAndCompleteness.test.ts` (partial, missing, leap/non-leap annual coverage); `generationFinancials.test.ts` (partial and generation-aware routing); uploaded-timezone Chromium journey. | No claim that all possible malformed application state has been fuzzed. Unsupported or incomplete input remains a user-visible limitation, not a silently inferred result. |

## Section 36 criterion crosswalk (transcribed checklist)

The supplied completion appendix contains these 40 criteria, but the owner-designated `VoltWise_G7_MilestoneRoadmap.md` itself was not present in the checkout, reachable history, or attachments. Wording and numbering below are therefore based on the appendix transcription only; no row is an exact-source verification. PASS means the named repository evidence supports the transcribed behavior, not that the original source was checked. Criteria 38–40 remain NOT VERIFIED until the single final gate is run and bound to its final candidate SHA.

| # | Transcribed criterion (short form) | Verdict | Evidence |
|---:|---|---|---|
| 1 | Generic external-resource contract | PASS | `externalResourceParser.test.ts`; `src/types/energy.ts` |
| 2 | Shared solar/wind timestamp alignment | PASS | `externalResourceAlignment.test.ts` |
| 3 | Canonical solar CSV parser | PASS | `externalResourceParser.test.ts` |
| 4 | Canonical wind CSV parser | PASS | `externalResourceParser.test.ts` |
| 5 | Explicit-offset timestamp authority | PASS | `externalResourceParser.test.ts`; `src/utils/externalResourceParser.ts` |
| 6 | IANA/local timestamp and DST handling | PASS | `externalResourceParser.test.ts` |
| 7 | Reject duplicate/out-of-order rows | PASS | `externalResourceAlignment.test.ts`; `temporalValidationAndCompleteness.test.ts` |
| 8 | Reject irregular resource spacing | PASS | `externalResourceParser.test.ts`; `temporalValidationAndCompleteness.test.ts` |
| 9 | Reject resource/load interval mismatch | PASS | `externalResourceAlignment.test.ts` |
| 10 | Reject missing modeled resource intervals | PASS | `externalResourceAlignment.test.ts`; `generationAwareSimulation.test.ts` |
| 11 | Deterministically align resource supersets | PASS | `externalResourceAlignment.test.ts` |
| 12 | Production solar weather-file mode | PASS | `solarGeneration.test.ts`; `generationAwareSimulation.test.ts`; Chromium measured-solar journey |
| 13 | Consume GHI/DNI/DHI | PASS | `solarGeneration.test.ts` |
| 14 | Reuse PV output/loss/clipping physics | PASS | `solarGeneration.test.ts` |
| 15 | Production wind interval-file mode | PASS | `windGeneration.test.ts`; `generationAwareSimulation.test.ts`; Chromium wind journey |
| 16 | Use measured speed, not Rayleigh expected power | PASS | `windGeneration.test.ts`; `generationAwareSimulation.test.ts` |
| 17 | Reuse wind shear/density/curve/loss physics | PASS | `windGeneration.test.ts` |
| 18 | Multiple file-backed solar arrays | PASS | `solarGeneration.test.ts`; `generationAwareSimulation.test.ts` |
| 19 | Multiple file-backed wind turbines | PASS | `windGeneration.test.ts`; `generationAwareSimulation.test.ts` |
| 20 | Mixed file and non-file modes | PASS | `solarGeneration.test.ts`; `windGeneration.test.ts`; `generationAwareSimulation.test.ts` |
| 21 | Preserve source-specific accounting | PASS | `generationAwareSimulation.test.ts`; `gridFlowAccounting.test.ts` |
| 22 | Integrate with battery/grid/tariff | PASS | `generationAwareSimulation.test.ts`; `gridBatteryCharging.test.ts`; `gridBatteryExport.test.ts` |
| 23 | Preserve G6 generator dispatch | PASS | `generatorRoutingIntegration.test.ts`; `generationAwareSimulation.test.ts`; Chromium mixed journey |
| 24 | Full-year file-backed projection | PASS | `generationProjection.test.ts` |
| 25 | Avoid raw resource duplication in annual results | PASS | `generationProjection.test.ts` |
| 26 | Preserve partial-period safety | PASS | `temporalValidationAndCompleteness.test.ts`; `generationFinancials.test.ts` |
| 27 | Solar import UI | PASS | Chromium measured-solar journey |
| 28 | Wind import UI | PASS | Chromium wind journey |
| 29 | Actionable import validation | PASS | Chromium invalid/over-limit load and resource journeys |
| 30 | Avoid unsupported weather-standard claims | PASS | `docs/model-scope.md`; `e2e/smoke.spec.ts` scope journey |
| 31 | JSON resource metadata/bindings | PASS | `projectArchive.test.ts`; `jsonExportCorrectness.test.ts` |
| 32 | Exclude raw rows from normal JSON | PASS | `projectArchive.test.ts`; `jsonExportCorrectness.test.ts` |
| 33 | Results/export do not recalculate resource physics | PASS | `jsonExportCorrectness.test.ts`; `generationAwareSimulation.test.ts` |
| 34 | Exact legacy no-generation path | PASS | `simulationRouter.test.ts`; `jsonExportCorrectness.test.ts` |
| 35 | Preserve non-file solar behavior | PASS | `solarGeneration.test.ts`; `generationAwareSimulation.test.ts` |
| 36 | Preserve non-file wind behavior | PASS | `windGeneration.test.ts`; `generationAwareSimulation.test.ts` |
| 37 | Preserve existing G6 generator behavior | PASS | `generatorRoutingIntegration.test.ts`; `generationAwareSimulation.test.ts` |
| 38 | Full Vitest at Final G7 Audit | NOT VERIFIED | Reserved for C4 final gate |
| 39 | TypeScript at Final G7 Audit | NOT VERIFIED | Reserved for C4 final gate |
| 40 | Production build at Final G7 Audit | NOT VERIFIED | Reserved for C4 final gate |

The §37 verdict block below is intentionally not promoted to PASS by this crosswalk. The complete browser suite and exact §28 commands must run at the locked C4 candidate before final category verdicts are assigned.

## Review record and sign-off boundary

The category evidence above was reviewed against the October 13 audit summary and the local tests at the stated SHA. Each “PASS” is limited to the named software tests and fixtures; it is not inferred from a green CI badge. No test or document here supports claims of site-engineering certification, full utility-bill reconciliation, investment advice, or future-weather prediction.

**Evidence-record review:** complete for the categories available in the audit summary, dated 2026-10-13, candidate SHA `daa0006fb695d3f0fe264a5a1bd36e94edefff69`.

**Product-owner / original-milestone sign-off:** not recorded. The original section 28 text and acceptance IDs were unavailable, and the owner has not supplied an independent sign-off in this record. Map the exact IDs and obtain owner approval when that source is available. This documentation closes the evidence-record work; it does not make VoltWise production-qualified.
