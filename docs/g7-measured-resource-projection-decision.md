# G7 measured-resource projection decision

**Decision date:** 2026-10-12  
**Owner decision:** Preserve G7 full-year measured-resource projections.  
**Decision source:** User confirmation in the implementation session.  
**Original G7 milestone source:** Not present in the checkout, reachable Git history, or supplied audit attachment. This document records the scope decision and the acceptance contract available from audit finding VW-01; it is not a verbatim copy or independent verification of the original milestone document.

## Adopted contract

- Period simulation continues to accept a valid measured solar or wind resource that exactly aligns to every simulated load interval.
- Lifecycle projection from measured resources requires a complete, continuous calendar-year load dataset and a measured resource record at the exact UTC instant of every load interval. Missing, duplicate, irregular, or misaligned records are rejected; no interpolation, resampling, or future weather is inferred.
- Each projection year replays the same representative-year load and measured resource series through the existing `runUnifiedSimulation()` pipeline. Year 1 therefore matches the equivalent full-year period simulation.
- Existing projection rules apply to modeled hardware and economics: solar DC capacity degrades, battery usable capacity degrades, and tariff rates escalate according to configured assumptions. Solar irradiance observations and measured wind-speed observations remain unchanged across projected years; wind configuration remains unchanged under the current engine.
- Only compact annual operational aggregates are retained for each year. The projection does not retain a copy of interval results for every year.
- This is a deterministic scenario using one representative measured weather year, not a forecast of future weather or a site-calibrated guarantee. Results and exports must disclose that future conditions may differ.
- A partial measured resource period remains useful for period analysis but cannot qualify for lifecycle projection. Generation projection export is available only when the normal lifecycle analysis and exact-year load/resource checks pass.

## Implementation evidence

The audit reported that current code rejected file-backed measured resources in multi-year projections and its VW-01 remediation specified full-year replay, degradation of hardware rather than weather, unchanged wind input, and compact annual totals. The owner selected that behavior despite the older tracked generation plan and model-scope documentation describing period-only measured resources. The implementation roadmap updates those contracts and tests this behavior.

