# Repository skill catalog and research

Skills are vendored under `.agents/skills/`, with exact upstream commits and SHA-256 file hashes in `skills-lock.json`. Copies include supporting resources; no remote installer, global plugin, lifecycle hook or auto-update was enabled. Root `AGENTS.md` supplies repository routing and host-specific limits. New agent sessions may be needed for native skill discovery; current sessions can read these files directly.

## Installed sources

| Source | Included skills | Why VoltWise benefits |
| --- | --- | --- |
| [Superpowers](https://github.com/obra/superpowers/tree/main/skills) | All 15 upstream skills | Planning, systematic debugging, TDD, reviews and verification for interconnected dispatch and financial logic. Load workflows in proportion to the task. |
| [Ponytail](https://github.com/DietrichGebert/ponytail/tree/main/skills) | `ponytail`, `ponytail-review`, `ponytail-audit` | Small complete changes, dependency restraint and reviews that trace callers. The core matches the user-provided source. Promotional scoreboard and optional debt/help commands were omitted. |
| [Vercel Agent Skills](https://github.com/vercel-labs/agent-skills/tree/main/skills) | `web-design-guidelines`, `vercel-react-best-practices` | Accessibility and interaction review; responsive React inputs, render costs and bundle performance. Next.js-specific guidance does not apply to this Vite app. |
| [Anthropic Skills](https://github.com/anthropics/skills/tree/main/skills) | `frontend-design`, `webapp-testing` | Deliberate visual hierarchy and browser verification of actual user flows. Design guidance is paired with the project usability skill rather than used as an aesthetics-only checklist. |
| [Context Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering/tree/main/skills) | `filesystem-context`, `context-compression`, `context-optimization` | Scoped retrieval, retrievable logs, reliable handoffs and budgeting during long development sessions. These are guidance, not changes to the host's context window or caching. |
| [Graphify-Labs/graphify](https://github.com/Graphify-Labs/graphify) | `graphify` | On request, build a local code/document knowledge graph for architecture exploration. Use the repo-scoped installer; optional hooks are not enabled. |
| Project-authored | `voltwise-ux`, `voltwise-development-context` | Energy/financial usability and a concrete, compact workflow for this repository. |

## Which skill to load

| Task | First relevant skills |
| --- | --- |
| Make a user flow easier to understand | `voltwise-ux`; add `web-design-guidelines` for an audit |
| Build or revise visual UI | `voltwise-ux`, `frontend-design` |
| Verify forms, navigation and results | `webapp-testing`, using actual rendered controls |
| Slow settings, simulation rerenders or bundle growth | `vercel-react-best-practices`; select applicable client React rule files |
| Small fix or focused code review | `ponytail`, then `ponytail-review` if reviewing |
| Bug with uncertain cause | `systematic-debugging`, then relevant existing tests |
| Substantial feature | Relevant Superpowers planning/implementation/verification skills, respecting current authorization and host constraints |
| Repeated reads, noisy logs, long sessions | `voltwise-development-context`; add the specific context skill when needed |
| Create or update a codebase map | `graphify` |

## Research conclusions and next priorities

The application has five configuration/results tabs, CSV validation, 8,760-hour sample simulations and numerous energy/finance contracts. The highest-value UI work is a clear sample-to-upload path, understandable units and assumptions, accessible settings, and results that distinguish measured periods from projections. Installed skills guide this work; installation does not implement those product changes.

React performance guidance is justified by synchronous multi-profile simulation in `src/App.tsx` and the observed production bundle warning. Measure before optimizing and preserve dispatch/accounting behavior.

Context management should start with scoped file reads and durable summaries, not a vector database or a custom agent framework. Keep the root instructions short and avoid loading the whole catalog or reference libraries into every task.

Further useful project work: browser regression coverage for CSV import → settings → results → export; an accessibility audit; a plain-language metric glossary; and invariant/property-based testing for energy conservation and financial edge cases. These are recommendations for future implementation, not claims of completed checks or reasons to add more dependencies now.

Not selected: Next.js/server/deployment skills (this is a client Vite app), mobile-native skills, broad multi-agent/memory frameworks and duplicate UI bundles. The installed set covers the stated needs with targeted discovery.

## Licensing and maintenance

Installation validation checked all 27 skill entry points for names, descriptions and duplicate identifiers, and matched 172 upstream files against recorded hashes. The context-compression helper's two existing unit tests passed. The webapp-testing server helper started a temporary Vite server, verified sample results → CSV upload tab → results navigation with Playwright and no browser runtime errors, and stopped that server. This validates the installed structure and those helpers; it does not establish the effectiveness of every upstream workflow or a complete accessibility audit.

Superpowers, Ponytail and Context Engineering MIT notices are in `.agents/licenses/`. Anthropic selected skills retain their Apache-2.0 `LICENSE.txt` files. Vercel declares MIT in its upstream README and React skill metadata; that README is preserved in `.agents/licenses/vercel/` because the inspected source has no standalone license file. Project-authored guidance is identified separately from upstream copies.

Graphify is Apache-2.0; its license is preserved in `.agents/licenses/graphify/`. The Graphify skill is installed for the generic Agents/Codex-compatible project skill path; optional Git hooks were not installed.

To update, inspect the authoritative upstream change and license, replace only the selected skill folders, and refresh their commit and file hashes in `skills-lock.json`. Do not run arbitrary installer scripts or silently overwrite local customizations. Upstream file contents are unmodified; the React skill directory is named to match its declared `vercel-react-best-practices` identifier. Project-specific adaptations live in root instructions and the two local skills.
