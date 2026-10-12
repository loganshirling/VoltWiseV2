# Browser smoke tests

Install the repository dependencies with `bun install --frozen-lockfile`, then install Chromium with `bunx playwright install chromium`. Run `npm run test:e2e:chromium` to build the production bundle, start Vite preview on `127.0.0.1:4173`, and exercise the import, settings, results, save/open, export, accessibility, mobile viewport, and async resource-import flows in Chromium. This flow has been run successfully in the current environment.

The Firefox project and `npm run test:e2e:firefox` command remain available, but Firefox automation has not completed successfully in the current environment; do not treat it as a verified browser. Set `CHROMIUM_EXECUTABLE` if Chromium is installed outside Playwright's cache. The tests use actual rendered controls and do not mock simulation results.

The suite checks 320, 375, 390, and desktop-sized layouts for page-level horizontal overflow. Narrow data tables may scroll inside their own labelled wrappers. It checks accessible names for numeric controls in each battery and generation asset editor, announces invalid load CSV errors, exercises the dispatch table alternative from the keyboard, verifies visible focus, and checks the reduced-motion stylesheet.

`FIREFOX_EXECUTABLE` can select a compatible Playwright-controlled Firefox binary. A distro Firefox ESR package is not necessarily compatible with Playwright's automation protocol; prefer the matched build installed by `npx playwright install firefox`.
