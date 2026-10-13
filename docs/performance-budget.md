# Simulation performance budget

VoltWise runs simulations in a dedicated Web Worker so editing settings and navigating remain responsive while a calculation is in progress. The worker uses the same simulation, projection, and finance functions as the direct path; it does not approximate or duplicate the model.

## Reference machine and method

Measurements were collected 2026-10-12 in the managed Linux runner: AMD EPYC 9V74, 5 visible CPUs, 33 GiB RAM, Bun 1.4.3 (Node compatibility runtime v26.3.0). These are reference measurements, not a claim about every supported consumer device.

The harness generates a deterministic 8,760-interval 2025 household profile; 35,040 intervals are made by splitting each hourly energy value into four quarter-hour values. The `35136` cases append 96 quarter-hour intervals to exercise the leap-year row count. The standard report warms the runtime and runs six measured trials; Task 2's initial leap-year evidence used two trials per case. Reported p95 uses the nearest-rank estimator; with six samples this equals the slowest observed trial, and with two samples it is only the maximum observation. Both are directional, not statistically stable percentiles. Peak RSS is the runtime's process maximum resident set size, including the benchmark harness and model output.

Run a scenario with:

```sh
bun run scripts/benchmark-simulation.ts 8760-single 6 direct
```

Scenario names include `8760-single`, `8760-multi`, `35040-single`, `35040-multi`, `35136-single`, `35136-multi`, `generation-25y` (solar), `generation-25y-mixed` (solar plus wind), and `generation-25y-leap-mixed` (enabled measured solar and wind over the exact 35,136-row 2024 leap year). Pass `worker` as the fourth argument to exercise the exact job executor used by the worker, for example `bun run scripts/benchmark-simulation.ts 35136-multi 6 worker`.

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
- **Engine harness memory:** p95 benchmark-process RSS at or below 500 MiB for the tested 25-year solar and solar+wind calculation jobs.

These are reference-machine release guards, not consumer-device guarantees. The end-to-end browser completion and memory numbers currently have one measured production run each; collect more samples on the supported-device matrix before treating them as stable percentiles.

## Worker implementation measurements

The worker executor was benchmarked in Bun 1.4.3 with the same harness, one warm-up and six measured trials per case. These corrected results supersede previously reported worker measurements: the earlier harness supplied an empty timezone, so worker calls failed validation quickly and the reported timings did not measure simulations. The direct-path baseline above predates that harness defect and is retained as historical baseline evidence.

| Case | p95 / slowest of 6 (ms) | Peak process RSS (MiB) |
| --- | ---: | ---: |
| 8,760 intervals, one profile | 772.3 | 124.8 |
| 8,760 intervals, four profiles | 3,247.7 | 156.3 |
| 35,040 intervals, one profile | 3,131.9 | 159.6 |
| 35,040 intervals, four profiles | 13,055.2 | 239.2 |
| 25-year solar projection, 8,760 intervals | 24,095.4 | 386.5 |
| 25-year solar+wind projection, 8,760 intervals | 23,524.2 | 440.2 |

The executor-level benchmark runs the pure job code in Bun and does not include browser worker startup or message cloning. The solar+wind result is 23.5 seconds and 440.2 MiB, so the prior 400 MiB guard did not cover this intended mixed workload; the documented engine harness limit is now 500 MiB. No 10-asset benchmark was run. A production Chromium run at a 390 px viewport measured 41.7 seconds from the first projection-year status to completion (48.2 seconds from the final site-timezone edit, with five subsequent finance-setting edits cancelling older requests). Fifteen setting/navigation actions during projection had a nearest-rank p95 of 50.1 ms and a maximum of 81.0 ms. The latest edited result rendered with no page errors.

## Leap-year interval boundary evidence (2026-10-13)

The shared maximum is now 35,136 intervals, allowing an exact UTC 2024 calendar year at 15-minute cadence. Parsers accept exact 2024 load, solar, and wind series; the 35,137th row is rejected, and a 2024 series with one missing interval is not operationally simulatable or annual-eligible. UTC 2025 remains valid at 35,040 rows. The worker also rejects inputs above the shared row ceiling before dispatch.

Two Bun 1.4.3 worker trials at 35,136 rows measured 3,164.9 and 3,337.3 ms for one profile (139 MiB peak process RSS), and 12,742.8 and 12,802.3 ms for four profiles (178.3 MiB). These are two-run maxima, not stable percentiles. Two production Chromium imports of generated 2024 load CSVs completed in 705–743 ms and increased renderer JavaScript heap by 23.5–24.7 MiB; this is not process-tree memory or lower-device qualification.

Measured CSV byte sizes for 35,136 timestamped rows were 1,054,099 bytes (0.25 kWh realistic quarter-hour load), 1,616,275 bytes (high-precision load), 1,581,153 bytes (realistic solar irradiance), and 2,354,145 bytes (high-precision solar irradiance). The existing 2 MiB per-file limit remains: representative load and resource files fit, while the measured high-precision solar example exceeds it. The row ceiling and byte ceiling are independent constraints; extra columns and precision can also increase file size. These size fixtures document a boundary, not a claim that every input under 2 MiB will parse or run on every device.

During one production projection run, a 50 ms sampler measured a 1,870 MiB Chromium process-tree peak from a 609 MiB baseline. Before yearly worker isolation, a development-mode run peaked at 4,282 MiB; after isolation, another development-mode run peaked at 2,295 MiB. These runs used different code states, so only the production-build reading is a release measurement. Use `npm run build` plus `npm run preview`, not Vite development mode, for future comparisons. The production peak is high; keep it visible in release qualification and collect measurements on lower-memory target hardware before making broader device claims.

## Ingestion measurements and ceilings

On the same managed runner, the deterministic 8,760-interval sample CSV is 317,610 bytes; one warm Bun parse measured 81.37 ms. Corrected worker measurements are 35,040 quarter-hour intervals at 159.6 MiB single-profile / 239.2 MiB four-profile peak process RSS, and 25-year projections at 386.5 MiB (solar) / 440.2 MiB (solar+wind); one measured production Chromium process tree peaked at 1,870 MiB. The interval ceiling is now 35,136, based on the measured leap-year worker and browser boundary evidence above. The independent file ceilings remain 2 MiB per load/resource CSV; the archive remains 12 MiB and projects support up to 10 assets/resources. The asset count is a conservative application ceiling; no 10-asset 25-year browser benchmark has been run, so it is not a performance guarantee.

Two production Chromium smoke runs on the same runner imported a generated 35,040-row quarter-hour year in 471–481 ms with an 8.7–16.1 MiB renderer JS heap increase. Opening an 8,760-row project archive of 368,289 bytes took 1,795–2,507 ms from file selection to the opened status (including the confirmation action and state update). The 2 MiB exact-byte boundary and the over-limit byte checks also passed in Chromium; implementation checks file sizes before invoking readers. These are two observations, not stable percentile estimates. The measurements are an operational basis for the byte and interval limits, but lower-memory consumer browsers still need qualification.

Task 8 Chromium evidence: the complete production smoke suite passed 13/13. Two fresh 35,040-row quarter-hour imports measured 384–386 ms with 8.5–9.2 MiB renderer JS-heap increases. Opening the 368,289-byte archive measured 1,455 ms in the latest run (earlier run: 1,604 ms). These are single-run observations, not percentiles. No lower-memory target device was available, so no minimum-device guidance is claimed.

The benchmark harness also measures structured-clone serialization of representative worker inputs. Bun `structuredClone` p95 across six samples was 11.2 ms for 8,760 records, 54.1 ms for 35,040 records, and 230.4 ms (solar) / 256.4 ms (solar+wind) for 25 yearly messages. For the mixed 25-year workload this is about 1.1% of executor time; this isolated serialization result excludes browser `postMessage` overhead. It does not justify changing the worker protocol. Direct/worker numerical parity remains covered by existing tests.

## Browser and device qualification snapshot (2026-10-13)

The available environment is a managed Debian GNU/Linux 13 x86_64 runner with 5 visible CPUs, 33.4 GiB RAM, Node.js 24.19.0, and system Chromium 154.0.8037.57. The tested source was branch commit `83f77d5`; this is a runner reference, not a named consumer device. A provisional low-memory target profile for future qualification is a 4-core x86_64 laptop with 8 GiB RAM, using current stable Chromium at 390 px and desktop viewport widths. No physical device matching that profile was available. No minimum-device claim follows from the runner results.

Three isolated production Chromium runs of the maximum 6,558,485-byte 2024 project completed the open/save/reopen/recalculate journey (1.5, 1.7, and 1.5 minutes end-to-end). The fixture verifies archive recovery with the solar and wind assets attached but disabled; it is not active generation projection evidence. Sampled renderer JavaScript-heap peaks were 136.9/120.0 MiB, 153.6/123.4 MiB, and 137.5/122.6 MiB for the save/reopen phases. These are per-run observations, not process-tree memory or stable percentiles. A three-repeat invocation under competing Playwright processes passed once and timed out twice while waiting up to 60 seconds for profile simulation results; the isolated runs passed, so retain the contention failures as a repeatability caveat rather than treating that invocation as a clean repeated sample.

This runner has no Bun executable. One diagnostic run of the enabled measured solar+wind 25-year leap-year workload through Node.js/tsx measured 149,667.7 ms and 2,762.8 MiB process RSS (one warmup and one measured run). It exceeds the Bun-based 500 MiB engine guard, but it is not comparable to the Bun reference result and is not a release-budget verdict. The prior Bun 1.4.3 mixed 25-year result (23,524.2 ms / 440.2 MiB) and production Chromium 8,760-row mixed projection (41.7 s / 1,870 MiB) remain the relevant baselines; neither qualifies the 35,136-row active mixed case on this commit.

Firefox qualification is **installation-blocked** in this environment: Playwright 1.64.0 has no cached Firefox binary, and the targeted fresh-session test fails at launch because `firefox-1555/firefox/firefox` is absent. The browser installation directory is unavailable, and a Firefox CDN installation was previously denied by the managed network policy. No Firefox behavior was exercised. The browser process-tree sampler available for this run sums `/proc` `VmRSS` across descendants, which double-counts shared Chromium pages; its 7,010 MiB peak is not valid for comparison to the 2.5 GiB process-tree budget. Process-tree qualification therefore remains open pending a PSS/cgroup measurement on an isolated runner. Existing interaction measurements (15 actions, p95 50.1 ms, max 81.0 ms) are from the earlier 8,760-row active projection and do not establish responsiveness for the 35,136-row active mixed project. No bundle change is justified by these measurements because no startup or interaction regression was isolated from the runner/runtime mismatch.

Load and resource file-size checks happen before reading; parsed row and project structure ceilings bound later parsing and worker copies. UI messages preserve the active project when an import exceeds a limit or fails. Treat all ceilings as reference-runner limits pending measurements on the supported consumer-device matrix.

## Maximum project archive evidence (2026-10-13)

The maximum supported combination of 35,136-row 2024 load, solar, and wind inputs serializes as a 6,558,485-byte compact v2 archive. Its measured normalized persisted-data JSON fields occupy 6,535,841 bytes. A production Chromium journey opened this project, simulated it, saved it, opened the saved project in a fresh browser context, recalculated, and matched the exported annual result values and projection time series. The archive size is below the 11 MiB new-import ceiling and the 12 MiB archive cap.

During that journey, sampled `performance.memory.usedJSHeapSize` peaks were 148.3 MiB while opening/saving and 153.6 MiB while reopening. This is renderer JavaScript heap only, sampled every 25 ms; it excludes other renderer/process memory and may miss synchronous peaks. A separate UI regression imported two distinct full-year solar resource datasets alongside the full-year load, rejected the third at the 9 MiB aggregate persisted-data limit, and confirmed the previously attached resources and load remained active and dirty. These observations verify archive sizing and recoverability on the managed Chromium runner, not process-tree or lower-memory-device qualification.
