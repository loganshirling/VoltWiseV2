# VoltWise

VoltWise is a local-first home energy scenario analyzer. It models interval energy use with batteries and optional solar, wind, and generator assets, then estimates energy-rate effects and cash flows from assumptions you provide. It is an analysis aid, not a complete utility-bill calculator, site-calibrated production forecast, financial recommendation, or performance guarantee.

**Preview:** version `0.1.0-beta.1`. Review [model scope](docs/model-scope.md) and [privacy](docs/privacy.md) before using personal data. Load and resource files are processed in the browser; export a project archive explicitly if you want to keep a copy.

## Try VoltWise

1. Open **Data & TOU Rates** and review the illustrative synthetic sample, or upload your own interval load CSV.
2. Confirm the site time zone and edit the import/export rates to match the tariff assumptions you want to explore.
3. Add a battery profile and, if relevant, configure solar, wind, or generator assets. Imported resource CSVs must align exactly with the load intervals.
4. Review the financial assumptions and open **Results & Analytics**. Results identify sample data and explain the model's limits.
5. Use **Save Project** to download a local project archive. Use analysis export for a separate results snapshot.

The default sample is generated and illustrative. It is not measured household consumption or a utility bill. Partial, continuous load periods can be analyzed, but lifecycle projections require an eligible complete calendar year. Measured solar and wind support only the imported period; they are not extrapolated into future years.

## Supported analysis

- Battery dispatch against an editable weekly time-of-use schedule and seasonal import/export rates.
- Solar and wind estimates from supported deterministic resource inputs, or measured irradiance/wind-speed CSVs for the matching period.
- Scheduled and economic generator dispatch using deterministic interval rules. Standby generator capacity and costs can be recorded, but standby operation during outages is not simulated.
- Period results and assumption-based annual lifecycle projections when the input requirements are met.

The model applies import prices and export credits to interval energy. It omits utility bill items such as demand charges, fixed customer charges, taxes, minimum-bill rules, and other adjustments. See [model scope and accepted data formats](docs/model-scope.md) for details.

## Privacy and hosting

Simulation work and selected files stay in the browser. The page requests Google Fonts from Google; the application does not send load, tariff, financial, or resource data to that service. Project files are ordinary downloaded files and are not encrypted by VoltWise. See [privacy details](docs/privacy.md).

This repository does not configure a production host. Do not describe a deployment as secure until its HTTPS and security headers have been checked. Release qualification and operator smoke/rollback steps are in the [release runbook](docs/release-runbook.md).

## Developer setup

Use Node.js 24 and Bun 1.4.3 from the repository root:

```sh
bun install --frozen-lockfile
npm run dev -- --strictPort
```

The local app is served on port 3000. Run the checks used by CI:

```sh
npm run lint
npm test -- --maxWorkers=4
npm run build
bunx playwright install chromium
npm run test:e2e:chromium
```

VoltWise requires JavaScript modules, Web Workers, file selection/download, and IANA time-zone support in the browser. The browser suite exercises the production preview; Chromium is verified in the current project environment. A Firefox runner is configured, but Firefox automation has not been verified in the current environment. See [browser testing](docs/browser-testing.md) and [performance measurements](docs/performance-budget.md).

## License and release policy

VoltWise source is licensed under Apache-2.0. The npm package remains marked private so package-registry publication is disabled. The application uses pre-release versions (`0.x.y-alpha.N`, `0.x.y-beta.N`, then `0.x.y-rc.N`) while its v1 scope is being validated; matching Git tags use a `v` prefix. Release automation qualifies and packages tags but does not deploy them. The first stable `1.0.0` release should follow the documented v1 scope and deployment gates.
