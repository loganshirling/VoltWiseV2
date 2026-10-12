# CI and release runbook

## Required pull request checks

The `CI` workflow runs for pull requests and pushes to `main`. Before merging, require these status checks in the repository's branch rules:

- `CI / quality` — frozen install, TypeScript check, full Vitest suite, production build, and Chromium browser smoke tests.
- `CI / dependency-audit` — `bun audit --audit-level=high` against the locked dependency tree.
- `CI / dependency-review` — reviews dependency changes in a pull request and fails on high or critical findings.
- `CI / secret-scan` — Gitleaks scans tracked files and complete Git history.

Set branch rules for `main` to require a pull request, require the four checks above, require checks to pass against the latest base, dismiss stale approvals after new commits, require conversation resolution, and block force pushes and branch deletion. Enable GitHub's dependency graph and Dependabot alerts so newly disclosed issues outside a pull request are visible. The workflow cannot enable these repository settings; an owner must configure and verify them in GitHub.

Review audit output and advisories before changing dependencies. Do not run automatic upgrades as part of CI. Make a deliberate dependency change in its own reviewed pull request, update `bun.lock` intentionally, and rerun the full CI checks.

## Version and tag policy

While v1 scope is being validated, use SemVer prereleases: `0.x.y-alpha.N`, then `0.x.y-beta.N`, then `0.x.y-rc.N`. The current package version is `0.1.0-beta.1`; use its matching annotated tag `v0.1.0-beta.1`. Promote to `1.0.0` only after the documented v1 model and deployment gates are satisfied. Bump `package.json` in the release pull request and use an identical `v<version>` annotated tag. Tag only a commit already present on `main`; the release workflow checks the version, annotation, branch ancestry, and exact source commit before packaging. Do not move or reuse a published version tag.

The release workflow produces a static `dist/` archive named with the tag and full source commit SHA, plus a SHA-256 checksum. It retains the package for 90 days. Verify the artifact before deployment:

```sh
sha256sum --check voltwise-v0.1.0-beta.1-<full-commit-sha>.tar.gz.sha256
git show -s --format='%H %D' v0.1.0-beta.1
```

Confirm the printed commit matches the SHA in the artifact name and the successful `Release qualification` run. Keep the workflow run URL and checksum with the release record.

## Preview and staging smoke

CI tests the production build locally through Vite preview and runs the browser journey in Chromium. For a hosted preview or staging deployment, deploy the exact verified archive and record its source SHA. Before promotion, open the deployed URL over HTTPS and repeat the browser smoke journey: sample notice, valid and invalid load import, solar/wind resource binding, asset and financial settings, results and table alternative, project save/open, export download, and reset. Check the browser console for runtime errors and verify the tested page corresponds to the recorded release SHA. Keep deployment-provider preview URLs and credentials in that provider; never add them to this repository or CI logs.

No hosting provider, preview URL, or deployment credential is configured by this repository. The hosted preview/staging smoke and HTTPS/security-header checks therefore remain an operator step before calling any deployment qualified. Confirm HTTPS, Content-Security-Policy, `X-Content-Type-Options`, frame protections, and an appropriate `Referrer-Policy` on the deployed response; account for Google Fonts in the CSP. These settings are host-specific and have not been verified here. Do not infer deployment readiness from a green local CI run.

## Rollback

Keep the last known-good release archive, its checksum, and its source SHA. If a deployment fails its smoke checks or causes a production regression, redeploy the previous verified archive using the hosting provider's documented rollback procedure. Confirm the deployed source SHA returns to the previous release, rerun the deployed smoke checks, and record the incident and follow-up fix. VoltWise is a static client application with no server-side project state to migrate; confirm that remains true before adopting a different architecture.

## Diagnostics and retention

GitHub retains workflow logs under repository Actions retention settings. On a failed browser job, CI additionally uploads Playwright traces, screenshots, and other files in `test-results/` for 14 days. Release archives and checksums are retained for 90 days; copy approved release records to the organization's durable release storage if a longer retention period is required. Treat diagnostic artifacts as internal operational records and review them before sharing outside the project.
