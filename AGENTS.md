# VoltWiseV2 development

Use the existing checkout in cloud tasks. Do not create a Git worktree unless the user requests one. User instructions and the host's permissions and tool rules take precedence over installed skill workflows. Do not enable hooks, send diagnostics, deploy, or add credentials merely because an upstream skill mentions them.

## Skills and context

Repository skills live in `.agents/skills/`. See `.agents/SKILLS.md` for task routing and research. Read the relevant `SKILL.md` on demand; do not load every skill, reference, or compiled guide. Superpowers references such as `superpowers:systematic-debugging` resolve to `.agents/skills/systematic-debugging/SKILL.md`. These are repository skills, not globally installed plugins; plugin hooks and namespaced slash commands are not configured.

Use Ponytail for small, complete changes. Use Superpowers planning and debugging when the task warrants them; routine edits need proportionate process. Use `voltwise-ux` for user flows, accessibility and understandable energy results; `frontend-design` for visual work; `web-design-guidelines` for UI audits. Use `voltwise-development-context` for efficient repository discovery and handoffs. Broader context skills are available for long sessions. Do not claim control of host compaction or prompt caching without an actual supported capability.

## Repository map

- `src/App.tsx`: application state and simulation orchestration.
- `src/components/`: data/rates, batteries, generation, financial settings, results and navigation.
- `src/types/energy.ts`: shared contracts and units.
- `src/utils/simulationRouter.ts`: simulation entry point; other utilities handle dispatch, generation, tariffs, financials, parsing and exports.
- `src/__tests__/`: existing simulation and integration coverage.

This is React 19 with Vite and Tailwind, not Next.js. Use applicable client React guidance; do not introduce Next.js APIs or server architecture. Preserve energy accounting, tariff timing, SOC provenance, financial assumptions and distinctions between partial-period and annual results.

## Commands and verification

Node 24 is available in the cloud environment. Install with Bun 1.4.3 and `bun install --frozen-lockfile`; cloud Bun is `/workspace/.tools/bun/node_modules/.bin/bun`. Do not regenerate the lockfile during unrelated tasks.

- Start: `npm run dev -- --strictPort` (port 3000).
- Type check: `npm run lint`.
- Build: `npm run build`.
- Tests: `npm test -- --maxWorkers=4`; use relevant existing files first for focused changes.

For UI changes, verify the affected flow in a browser, including keyboard and narrow-screen behavior. Cloud Chromium is `/usr/bin/chromium`; Python Playwright is available. Wait for a meaningful rendered element rather than relying solely on network idle, since optional Google Fonts requests may stall. Onboarding found one strict floating-point equality failure in `generatorRoutingIntegration.test.ts:360`, with 1,016 other tests passing. Recheck actual results; do not hide failures or assume new failures share that cause.
