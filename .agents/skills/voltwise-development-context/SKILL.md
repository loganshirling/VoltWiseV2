---
name: voltwise-development-context
description: Keep VoltWise development context focused using scoped searches, a small repository map, file-backed logs, and reliable task handoffs. Use for repository exploration, long implementation sessions, or reducing repeated reads and token use.
---

# Efficient VoltWise development context

Optimize total work per completed task, not brevity that causes lost requirements or repeated investigation.

## Retrieve only what the task needs

1. Read root `AGENTS.md` and check `git status --short` to preserve existing work.
2. Translate the request into affected user flow, component, utility and test families. Start from `.agents/SKILLS.md` only when selecting a skill.
3. Use `rg --files src` for discovery and scoped `rg -n` for symbols/callers. Read the relevant line ranges rather than all of `App.tsx`, the types, or every test.
4. Load one applicable skill entry point and only references required by the task. For React performance, read individual `rules/` files rather than its compiled `AGENTS.md`.
5. Expand scope when evidence shows another caller or contract is affected. Never omit an affected caller just to save tokens.

## Preserve evidence without flooding the conversation

- Store large build/test output in `.agents/context/<task>/` or a task-specific temporary directory. Return the command, exit status, counts and relevant error locations. Keep full output available until the task finishes.
- Preserve the underlying command's exit status when redirecting or piping output. Never infer a passing suite from a log excerpt.
- Keep a short task note only for work that needs persistence. Do not create notes for trivial one-turn edits.
- Do not put secrets, environment dumps or uploaded private data in task notes. `.agents/context/` is locally ignored and is not a guaranteed cross-machine storage mechanism.

## Handoff template

```markdown
# <Task>
Goal and user constraints:
Current branch/checkout and pre-existing changes:
Files changed (paths and key symbols):
Decisions and why:
Validation (command, result, counts; failures/skips separate):
Open issues or blockers:
Next concrete action:
Evidence/log paths:
```

Update the note at a meaningful phase boundary or before a handoff, not after every command. Retain unresolved questions and exact failing assertions. Treat old notes as leads; recheck runtime state, paths and Git changes before continuing.

For long sessions, use `filesystem-context` for offloading, `context-compression` for structured summaries and `context-optimization` for broader budgeting. Host-managed context compaction, caching and agent delegation remain governed by actual tool support and session instructions. Do not invent a compaction tool or spawn agents solely to reduce tokens.
