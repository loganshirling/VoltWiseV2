# Simulation performance budget

VoltWise runs simulations in a dedicated Web Worker so editing settings and navigating remain responsive while a calculation is in progress. The worker uses the same simulation, projection, and finance functions as the direct path; it does not approximate or duplicate the model.

## Reference machine and method

Measurements were collected 2026-10-12 in the managed Linux runner: AMD EPYC 9V74, 5 visible CPUs, 33 GiB RAM, Bun 1.4.3 (Node compatibility runtime v26.3.0). These are reference measurements, not a claim about every supported consumer device.

The harness generates a deterministic 8,760-interval 2025 household profile; 35,040 intervals are made by splitting each hourly energy value into four quarter-hour values. The `35136` cases append 96 quarter-hour intervals to exercise the leap-year row count. The standard report warms the runtime and runs six measured trials; Task 2's initial leap-year evidence used two trials per case. Reported p95 uses the nearest-rank estimator; with six samples this equals the slowest observed trial, and with two samples it is only the maximum observation. Both are directional, not statistically stable percentiles. Peak RSS is the runtime's process maximum resident set size, including the benchmark harness and model output.

Run a scenario with:

```sh
bun run scripts/benchmark-simulation.ts 8760-single 6 direct
```

Scenario names include `8760-single`, `8760-multi`, `35040-single`, `35040-multi`, `35136-single`, `35136-multi`, `generation-25y` (solar), and `generation-25y-mixed` (solar plus wind). Pass `worker` as the fourth argument to exercise the exact job executor used by the worker, for example `bun run scripts/benchmark-simulation.ts 35136-multi 6 worker`.

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

Load and resource file-size checks happen before reading; parsed row and project structure ceilings bound later parsing and worker copies. UI messages preserve the active project when an import exceeds a limit or fails. Treat all ceilings as reference-runner limits pending measurements on the supported consumer-device matrix.
