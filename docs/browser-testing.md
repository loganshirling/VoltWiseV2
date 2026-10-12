# Browser smoke tests

Install the repository dependencies with the documented frozen Bun command, then install the Playwright browsers once with `npx playwright install chromium firefox`. Run `npm run test:e2e` to build the production bundle, start Vite preview on `127.0.0.1:4173`, and exercise the core import, settings, results, save/open, export, accessibility, mobile viewport, and async resource-import flows in Chromium and Firefox.

Use `npm run test:e2e:chromium` or `npm run test:e2e:firefox` to run one browser project. Set `CHROMIUM_EXECUTABLE` if Chromium is installed outside Playwright's cache. The tests use actual rendered controls and do not mock simulation results.

The suite checks 320, 375, 390, and desktop-sized layouts for page-level horizontal overflow. Narrow data tables may scroll inside their own labelled wrappers. It checks accessible names for numeric controls in each battery and generation asset editor, announces invalid load CSV errors, exercises the dispatch table alternative from the keyboard, verifies visible focus, and checks the reduced-motion stylesheet.

`FIREFOX_EXECUTABLE` can select a compatible Playwright-controlled Firefox binary. A distro Firefox ESR package is not necessarily compatible with Playwright's automation protocol; prefer the matched build installed by `npx playwright install firefox`.
