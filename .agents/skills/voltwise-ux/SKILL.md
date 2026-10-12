---
name: voltwise-ux
description: Design or review VoltWise user flows, forms, accessible interactions, CSV imports, energy configuration, and understandable simulation or financial results. Use for changes intended to make the tool easier to use.
---

# VoltWise usability

Start with the user's decision: compare a battery, understand a tariff, configure generation, or interpret savings. Inspect only the relevant component, its state in `src/App.tsx`, and the contracts it uses. Preserve simulation semantics; UI work must not silently change calculations.

## Establish the flow

- State the target user, task, entry point and successful outcome using available context. Ask only for a missing answer that materially blocks the work.
- Trace the path from sample data or CSV import through rates, battery, generation and finances to results. Avoid forcing unrelated settings into a simple comparison.
- Put the next useful action where users can find it. Use progressive disclosure for advanced assumptions while keeping their effects discoverable.
- Prefer existing components, styles and native controls. Add no design system or form dependency for a small change.

## Make inputs understandable

- Use explicit labels and units: kW is power, kWh is energy, and dollars per kWh is a tariff. Distinguish usable capacity, charge/output limits, efficiency and cycle life.
- Explain time zone, interval duration, seasonal schedule and import/export rates where they affect results.
- Keep numeric values editable without silently coercing an intermediate input into a different assumption. Show errors beside the field, preserve input, and explain how to fix it.
- For CSV uploads, state required columns and formats, show file/period/completeness status, and make sample data recognizable. Report rejected rows and unsupported time alignment; never quietly drop invalid data.
- Label reset and destructive replacement clearly, preserve recoverable work, and show useful empty, loading and invalid-configuration states.

## Make outputs trustworthy

- Show the active data period, tariff, battery and generation assumptions near the result they explain.
- Distinguish a sample scenario from uploaded measurements, actual-period results from annual projections, and modeled outcomes from guarantees.
- Define payback, NPV, IRR and savings in plain language; expose financing, discount-rate and incentive assumptions without overwhelming the primary result.
- Display units, sign conventions, rounding and unavailable results consistently. Do not turn an unavailable metric into zero or round away a meaningful difference.
- Charts need readable axes/legends, explanations and a text or table alternative. Do not encode source, status or gain/loss only by color.

## Accessibility and interaction

- Connect labels to inputs; provide accessible names for icon buttons, errors and chart controls.
- Use semantic elements, predictable tab order, visible focus and keyboard operation. Manage focus for dialogs and restored views.
- Check contrast, zoom, reduced motion, mobile touch targets, horizontal overflow and responsive tables.
- Announce important status changes without flooding assistive technology. Keep error recovery actionable.
- Keep settings responsive while the 8,760-hour simulation recalculates. Measure before changing memoization or moving work.

## Verify the change

Use `web-design-guidelines` for detailed accessibility review, `frontend-design` for appearance and `webapp-testing` for browser interaction. Use supported tools instead of assuming a WebFetch or Skill tool exists.

Exercise the target flow with sample data and relevant invalid/empty inputs, then check keyboard behavior and a narrow viewport. Confirm that changed settings update the expected results and exports. Run the relevant existing simulation tests if data or calculation contracts changed, plus type check and build as appropriate. Report observed usability issues and test outcomes; screenshots alone do not prove a flow works.
