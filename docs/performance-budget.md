# Simulation performance budget

VoltWise runs simulations in a dedicated Web Worker so editing settings and navigating remain responsive while a calculation is in progress. The worker uses the same simulation, projection, and finance functions as the direct path; it does not approximate or duplicate the model.

## Reference machine and method

Measurements were collected 2026-10-12 in the managed Linux runner: AMD EPYC 9V74, 5 visible CPUs, 33 GiB RAM, Bun 1.4.3 (Node compatibility runtime v26.3.0). These are reference measurements, not a claim about every supported consumer device.

The harness generates a deterministic 8,760-interval 2025 household profile; 35,040 intervals are made by splitting each hourly energy value into four quarter-hour values. It warms the runtime, then runs six measured trials for each case. Reported p95 uses the nearest-rank estimator; with six samples this equals the slowest observed trial and is directional rather than a statistically stable percentile. Peak RSS is the runtime's process maximum resident set size, including the benchmark harness and model output.

Run a scenario with:

```sh
bun run scripts/benchmark-simulation.ts 8760-single 6 direct
```

Scenario names are `8760-single`, `8760-multi`, `35040-single`, `35040-multi`, and `generation-25y`. Pass `worker` as the fourth argument to exercise the exact job executor used by the worker, for example `bun run scripts/benchmark-simulation.ts generation-25y 6 worker`.

## Direct-path baseline

The baseline was measured before moving orchestration to the worker. `multi` means all four default battery profiles. The generation case uses one enabled 5 kW solar asset, one battery profile, UTC timestamps, and the complete 25-year operational projection.

| Case | p95 / slowest of 6 (ms) | Peak process RSS (MiB) |
| --- | ---: | ---: |
| 8,760 intervals, one profile | 3.4 | 58.2 |
| 8,760 intervals, four profiles | 21.5 | 73.4 |
| 35,040 intervals, one profile | 12.2 | 80.8 |
| 35,040 intervals, four profiles | 21.1 | 119.6 |
| 25-year generation projection, 8,760 intervals | 20,586.8 | 261.2 |

## Budgets

- **Main-thread interaction:** p95 Playwright control-action wall time at or below 100 ms at 390 px while projection is active. Superseded work must be cancelled, and only the newest request may become visible.
- **Calculation completion:** p95 25-year projection at or below 55 seconds from the current input snapshot on the reference machine. Progress identifies the projection year while yearly work is isolated.
- **Browser memory:** Chromium process-tree peak RSS at or below 2.5 GiB for a 25-year generation projection on the reference machine. The tree includes the browser, renderer, and workers.
- **Engine harness memory:** p95 benchmark-process RSS at or below 400 MiB for the 25-year calculation job.

These are reference-machine release guards, not consumer-device guarantees. The end-to-end browser completion and memory numbers currently have one measured production run each; collect more samples on the supported-device matrix before treating them as stable percentiles.

## Worker implementation measurements

The worker executor was benchmarked with the same harness, six measured trials per case:

| Case | p95 / slowest of 6 (ms) | Peak process RSS (MiB) |
| --- | ---: | ---: |
| 8,760 intervals, one profile | 5.3 | 57.2 |
| 8,760 intervals, four profiles | 10.5 | 75.3 |
| 35,040 intervals, one profile | 12.3 | 80.0 |
| 35,040 intervals, four profiles | 20.6 | 116.1 |
| 25-year generation projection, 8,760 intervals | 21,034.7 | 321.3 |

The executor-level benchmark runs the pure job code in Bun and does not include browser worker startup or message cloning. A production Chromium run at a 390 px viewport measured 41.7 seconds from the first projection-year status to completion (48.2 seconds from the final site-timezone edit, with five subsequent finance-setting edits cancelling older requests). Fifteen setting/navigation actions during projection had a nearest-rank p95 of 50.1 ms and a maximum of 81.0 ms. The latest edited result rendered with no page errors.

During one production projection run, a 50 ms sampler measured a 1,870 MiB Chromium process-tree peak from a 609 MiB baseline. Before yearly worker isolation, a development-mode run peaked at 4,282 MiB; after isolation, another development-mode run peaked at 2,295 MiB. These runs used different code states, so only the production-build reading is a release measurement. Use `npm run build` plus `npm run preview`, not Vite development mode, for future comparisons. The production peak is high; keep it visible in release qualification and collect measurements on lower-memory target hardware before making broader device claims.
