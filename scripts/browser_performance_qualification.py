#!/usr/bin/env python3
"""Run and validate the manual, single-trial browser performance qualification."""

from __future__ import annotations

import argparse
import json
import math
import os
import platform
import re
import signal
import subprocess
import sys
import threading
import time
from collections import deque
from pathlib import Path
from typing import Any

REPORT_PREFIX = "VOLTWISE_PERFORMANCE_FEASIBILITY_JSON "
EXPECTED_SCENARIO = "maximum-active-measured-solar-wind-2024-leap"
EXPECTED_VIEWPORT = {"width": 390, "height": 844}


class ReportError(ValueError):
    """The browser run did not produce trustworthy required evidence."""


def _is_number(value: Any) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def _require_number(value: Any, name: str, *, positive: bool = False, nonnegative: bool = False) -> float:
    if not _is_number(value):
        raise ReportError(f"{name} must be a finite number")
    if positive and value <= 0:
        raise ReportError(f"{name} must be positive")
    if nonnegative and value < 0:
        raise ReportError(f"{name} must be nonnegative")
    return float(value)


def _require_int(value: Any, name: str, expected: int | None = None) -> int:
    if not isinstance(value, int) or isinstance(value, bool):
        raise ReportError(f"{name} must be an integer")
    if expected is not None and value != expected:
        raise ReportError(f"{name} was {value}; expected {expected}")
    return value


def _object(value: Any, name: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ReportError(f"{name} must be an object")
    return value


def _strict_json(text: str) -> Any:
    def reject_constant(value: str) -> None:
        raise ReportError(f"nonfinite JSON constant {value} is not allowed")

    try:
        return json.loads(text, parse_constant=reject_constant)
    except (json.JSONDecodeError, UnicodeDecodeError) as exc:
        raise ReportError(f"malformed or truncated JSON report: {exc}") from exc


def parse_report_text(log_text: str, source_sha: str) -> dict[str, Any]:
    reports: list[dict[str, Any]] = []
    for line in log_text.splitlines():
        marker = line.find(REPORT_PREFIX)
        if marker >= 0:
            parsed = _strict_json(line[marker + len(REPORT_PREFIX) :].strip())
            reports.append(_object(parsed, "performance report"))
    if not reports:
        raise ReportError("performance report is missing")
    if len(reports) != 1:
        raise ReportError(f"expected exactly one performance report; found {len(reports)}")

    report = reports[0]
    if _require_int(report.get("schemaVersion"), "schemaVersion", 1) != 1:
        raise ReportError("unsupported report schema")
    if report.get("scenario") != EXPECTED_SCENARIO:
        raise ReportError("unexpected performance scenario")
    reported_sha = report.get("sourceSha")
    if reported_sha is not None:
        if not isinstance(reported_sha, str) or not re.fullmatch(r"[0-9a-f]{40}", reported_sha):
            raise ReportError("sourceSha must be a full 40-character lowercase commit SHA or null")
        if reported_sha != source_sha:
            raise ReportError("report sourceSha does not match the workflow source SHA")

    browser = _object(report.get("browser"), "browser")
    if browser.get("name") != "chromium":
        raise ReportError("browser must be Chromium")
    if not isinstance(browser.get("version"), str) or not browser["version"].strip():
        raise ReportError("browser version is missing")
    if browser.get("viewport") != EXPECTED_VIEWPORT:
        raise ReportError("unexpected browser viewport")

    inputs = _object(report.get("input"), "input")
    for key, expected in {
        "intervalCount": 35_136,
        "intervalDurationHours": 0.25,
        "calendarYear": 2024,
        "batteryProfiles": 1,
        "projectionYears": 25,
    }.items():
        actual = inputs.get(key)
        if actual != expected or isinstance(actual, bool):
            raise ReportError(f"input.{key} was {actual!r}; expected {expected!r}")
    if inputs.get("enabledAssetTypes") != ["solar", "wind"]:
        raise ReportError("enabledAssetTypes must be exactly ['solar', 'wind']")

    timings = _object(report.get("timings"), "timings")
    if timings.get("clock") != "window.performance.now()":
        raise ReportError("projection timing must use the browser monotonic clock")
    import_ms = _require_number(timings.get("projectImportElapsedMs"), "projectImportElapsedMs", nonnegative=True)
    run_at = _require_number(timings.get("initialOperationalRunRequestAtMs"), "initialOperationalRunRequestAtMs", nonnegative=True)
    first_projection = _require_number(timings.get("firstProjectionYearRequestAtMs"), "firstProjectionYearRequestAtMs", positive=True)
    last_projection = _require_number(timings.get("lastProjectionYearResponseAtMs"), "lastProjectionYearResponseAtMs", positive=True)
    ready_at = _require_number(timings.get("generationFinancialReadyAtMs"), "generationFinancialReadyAtMs", positive=True)
    elapsed = _require_number(timings.get("operationalRunToFinancialReadyElapsedMs"), "operationalRunToFinancialReadyElapsedMs", positive=True)
    _require_number(import_ms, "projectImportElapsedMs", nonnegative=True)
    if first_projection < run_at or last_projection < first_projection or ready_at < last_projection:
        raise ReportError("worker and financial readiness timestamps are inconsistent")
    if abs((ready_at - run_at) - elapsed) > 0.11:
        raise ReportError("projection elapsed time does not match readiness timestamps")

    workers = _object(report.get("workerRequests"), "workerRequests")
    delta = _object(workers.get("importedProjectDelta"), "importedProjectDelta")
    responses = _object(workers.get("importedProjectResponses"), "importedProjectResponses")
    _require_int(delta.get("run"), "importedProjectDelta.run", 1)
    _require_int(delta.get("projectionYear"), "importedProjectDelta.projectionYear", 25)
    _require_int(responses.get("success"), "importedProjectResponses.success", 1)
    _require_int(responses.get("projectionYear"), "importedProjectResponses.projectionYear", 25)
    _require_int(responses.get("error"), "importedProjectResponses.error", 0)
    total_responses = _require_int(workers.get("totalNewResponseCount"), "totalNewResponseCount")
    if total_responses < 26:
        raise ReportError("totalNewResponseCount is less than the required completed worker responses")

    ui = _object(report.get("uiResponsiveness"), "uiResponsiveness")
    _require_number(ui.get("interactionTargetMs"), "uiResponsiveness.interactionTargetMs", positive=True)
    if ui["interactionTargetMs"] != 100:
        raise ReportError("UI interaction target must preserve the 100 ms reference")
    action_count = _require_int(ui.get("actionCount"), "uiResponsiveness.actionCount")
    active_count = _require_int(ui.get("actionsDuringActiveProjection"), "uiResponsiveness.actionsDuringActiveProjection")
    actions = ui.get("individualActions")
    if not isinstance(actions, list) or len(actions) != action_count or active_count > action_count:
        raise ReportError("UI action records and counts are inconsistent")
    active_durations: list[float] = []
    for index, action_value in enumerate(actions):
        action = _object(action_value, f"individualActions[{index}]")
        if not isinstance(action.get("name"), str) or not action["name"].strip():
            raise ReportError(f"individualActions[{index}].name is missing")
        duration = _require_number(action.get("durationMs"), f"individualActions[{index}].durationMs", nonnegative=True)
        if not isinstance(action.get("duringProjection"), bool):
            raise ReportError(f"individualActions[{index}].duringProjection must be boolean")
        if action["duringProjection"]:
            active_durations.append(duration)
    if len(active_durations) != active_count:
        raise ReportError("active UI action records do not match their reported count")
    reported_p95 = ui.get("observedNearestRankP95Ms")
    reported_maximum = ui.get("observedMaximumMs")
    if active_durations:
        expected_p95 = round(sorted(active_durations)[math.ceil(len(active_durations) * 0.95) - 1], 1)
        expected_maximum = round(max(active_durations), 1)
        if not _is_number(reported_p95) or abs(float(reported_p95) - expected_p95) > 0.11:
            raise ReportError("UI nearest-rank p95 is missing or inconsistent with action samples")
        if not _is_number(reported_maximum) or abs(float(reported_maximum) - expected_maximum) > 0.11:
            raise ReportError("UI maximum duration is missing or inconsistent with action samples")
    elif reported_p95 is not None or reported_maximum is not None:
        raise ReportError("UI summary reports durations despite having no active-projection actions")
    expected_ui_status = "MEASURED" if active_count >= 15 else "NOT_FULLY_MEASURED"
    if ui.get("status") != expected_ui_status:
        raise ReportError("UI responsiveness status does not match observed action coverage")

    memory = _object(report.get("memory"), "memory")
    if memory.get("measurement") != "renderer JavaScript heap; not total browser memory or process-tree RSS":
        raise ReportError("renderer memory measurement label is missing or misleading")
    if not isinstance(memory.get("supported"), bool):
        raise ReportError("memory.supported must be boolean")
    _require_int(memory.get("sampleIntervalMs"), "memory.sampleIntervalMs", 50)
    heap_values = [memory.get(key) for key in ("initialBytes", "peakSampledDuringProjectionBytes", "afterCompletionBytes")]
    for key, value in zip(("initialBytes", "peakSampledDuringProjectionBytes", "afterCompletionBytes"), heap_values):
        if value is not None:
            _require_number(value, f"memory.{key}", nonnegative=True)
    if memory["supported"] != any(value is not None for value in heap_values):
        raise ReportError("renderer memory support flag is inconsistent with its measurements")

    validation = _object(report.get("resultsValidation"), "resultsValidation")
    if validation.get("status") != "PASS":
        raise ReportError("final Results validation did not pass")
    _require_number(validation.get("solarYearOneKwh"), "solarYearOneKwh", positive=True)
    _require_number(validation.get("windYearOneKwh"), "windYearOneKwh", positive=True)
    _require_int(validation.get("annualProjectionYears"), "annualProjectionYears", 25)
    if _require_int(report.get("browserErrorCount"), "browserErrorCount") != 0:
        raise ReportError("browser or calculation errors were reported")
    return report


def read_children(pid: int, proc_root: Path) -> list[int]:
    children_file = proc_root / str(pid) / "task" / str(pid) / "children"
    try:
        return [int(value) for value in children_file.read_text().split()]
    except (OSError, ValueError):
        return []


def process_descendants(root_pid: int, proc_root: Path = Path("/proc")) -> list[int]:
    found: set[int] = set()
    pending = deque([root_pid])
    while pending:
        parent = pending.popleft()
        for child in read_children(parent, proc_root):
            if child not in found:
                found.add(child)
                pending.append(child)
    return sorted(found)


def _process_command(pid: int, proc_root: Path) -> list[str] | None:
    try:
        raw = (proc_root / str(pid) / "cmdline").read_bytes()
    except OSError:
        return None
    return [part.decode(errors="replace") for part in raw.split(b"\0") if part]


def chromium_descendants(root_pid: int, proc_root: Path = Path("/proc")) -> list[int]:
    result: set[int] = set()
    for pid in process_descendants(root_pid, proc_root):
        argv = _process_command(pid, proc_root)
        executable = Path(argv[0]).name.lower() if argv else ""
        if "chrome" in executable or "chromium" in executable:
            result.add(pid)
    return sorted(result)


def parse_pss_bytes(smaps_text: str) -> int | None:
    for line in smaps_text.splitlines():
        match = re.match(r"^Pss:\s+(\d+)\s+kB\s*$", line)
        if match:
            return int(match.group(1)) * 1024
    return None


def sample_chromium_pss(root_pid: int, proc_root: Path = Path("/proc")) -> dict[str, Any]:
    pids = chromium_descendants(root_pid, proc_root)
    if not pids:
        return {"pids": [], "pssBytes": None, "complete": False, "unreadablePids": []}
    total = 0
    observed: list[int] = []
    unreadable: list[int] = []
    for pid in pids:
        process_dir = proc_root / str(pid)
        if not process_dir.exists():  # Process exited between discovery and sampling.
            continue
        try:
            text = (process_dir / "smaps_rollup").read_text()
        except OSError:
            if process_dir.exists():
                unreadable.append(pid)
            continue
        pss = parse_pss_bytes(text)
        if pss is None:
            unreadable.append(pid)
            continue
        observed.append(pid)
        total += pss
    if not observed or unreadable:
        return {"pids": observed, "pssBytes": None, "complete": False, "unreadablePids": unreadable}
    return {"pids": observed, "pssBytes": total, "complete": True, "unreadablePids": []}


def read_cgroup_memory() -> dict[str, int | str | None]:
    candidates = [
        (Path("/sys/fs/cgroup/memory.max"), Path("/sys/fs/cgroup/memory.current"), Path("/sys/fs/cgroup/memory.peak")),
        (Path("/sys/fs/cgroup/memory/memory.limit_in_bytes"), Path("/sys/fs/cgroup/memory/memory.usage_in_bytes"), Path("/sys/fs/cgroup/memory/memory.max_usage_in_bytes")),
    ]
    for limit_path, current_path, peak_path in candidates:
        if limit_path.exists() or current_path.exists() or peak_path.exists():
            def read_value(path: Path) -> int | str | None:
                try:
                    value = path.read_text().strip()
                except OSError:
                    return None
                if value == "max":
                    return "unlimited"
                try:
                    return int(value)
                except ValueError:
                    return None

            return {"limitBytes": read_value(limit_path), "currentBytes": read_value(current_path), "peakBytes": read_value(peak_path)}
    return {"limitBytes": None, "currentBytes": None, "peakBytes": None}


def read_cgroup_cpu() -> dict[str, str | None]:
    quota_paths = [Path("/sys/fs/cgroup/cpu.max")]
    cpuset_paths = [Path("/sys/fs/cgroup/cpuset.cpus.effective"), Path("/sys/fs/cgroup/cpuset/cpuset.cpus")]
    quota_value = None
    for path in quota_paths:
        try:
            quota_value = path.read_text().strip()
            break
        except OSError:
            continue
    if quota_value is None:
        try:
            quota = Path("/sys/fs/cgroup/cpu/cpu.cfs_quota_us").read_text().strip()
            period = Path("/sys/fs/cgroup/cpu/cpu.cfs_period_us").read_text().strip()
            quota_value = f"{quota} {period}"
        except OSError:
            pass
    cpuset = None
    for path in cpuset_paths:
        try:
            cpuset = path.read_text().strip()
            break
        except OSError:
            continue
    return {"quota": quota_value, "cpuset": cpuset}


def report_assessment(report: dict[str, Any]) -> tuple[str, str]:
    if report["uiResponsiveness"]["status"] != "MEASURED":
        return "INCOMPLETE", "The test passed correctness checks but captured fewer than 15 UI actions during projection."
    return "PASS", "All mandatory browser, worker, UI, and result checks passed."


def browser_version_number(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    match = re.search(r"\d+(?:\.\d+){2,}", value)
    return match.group(0) if match else None


def normalize_memory_evidence(value: Any) -> dict[str, Any]:
    try:
        memory = _object(value, "memory sampler output")
        status = memory.get("status")
        attempted = _require_int(memory.get("samplesAttempted"), "samplesAttempted")
        sampled = _require_int(memory.get("samplesWithChromiumProcesses"), "samplesWithChromiumProcesses")
        complete = _require_int(memory.get("completePssSampleCount"), "completePssSampleCount")
        distinct = _require_int(memory.get("distinctChromiumPids"), "distinctChromiumPids")
        if min(attempted, sampled, complete, distinct) < 0 or sampled > attempted or complete > sampled:
            raise ReportError("memory sampler sample counts are inconsistent")
        peak = memory.get("peakPssBytes")
        if status == "VERIFIED":
            if not isinstance(peak, int) or isinstance(peak, bool) or peak <= 0 or complete == 0 or distinct == 0:
                raise ReportError("verified PSS is missing a positive peak or complete samples")
            if not _is_number(memory.get("sampleIntervalSeconds")) or memory["sampleIntervalSeconds"] <= 0:
                raise ReportError("verified PSS is missing its sampling interval")
            return memory
        if status != "NOT_VERIFIED":
            raise ReportError("memory sampler status is unknown")
        memory["peakPssBytes"] = None
        memory["peakPssMiB"] = None
        if not isinstance(memory.get("reason"), str) or not memory["reason"].strip():
            memory["reason"] = "PSS attribution was not verified."
        return memory
    except (ReportError, TypeError):
        return {"status": "NOT_VERIFIED", "reason": "memory sampler output was malformed; no PSS value is reported."}


def _stream_output(pipe: Any, log_path: Path) -> None:
    with log_path.open("wb") as log_file:
        while True:
            line = pipe.readline()
            if not line:
                break
            log_file.write(line)
            log_file.flush()
            sys.stdout.buffer.write(line)
            sys.stdout.buffer.flush()


def run_bounded(args: argparse.Namespace) -> int:
    command = list(args.command)
    if command and command[0] == "--":
        command.pop(0)
    if not command:
        raise SystemExit("a command is required after --")
    log_path = Path(args.log)
    log_path.parent.mkdir(parents=True, exist_ok=True)
    memory_path = Path(args.memory_output)
    cgroup_before = read_cgroup_memory()
    started_at = time.monotonic()
    proc = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, start_new_session=True, bufsize=0)
    assert proc.stdout is not None
    reader = threading.Thread(target=_stream_output, args=(proc.stdout, log_path), daemon=True)
    reader.start()

    samples_attempted = 0
    samples_with_browser = 0
    valid_samples = 0
    peak_pss: int | None = None
    pids_seen: set[int] = set()
    timed_out = False
    deadline = started_at + args.timeout_seconds
    next_sample = started_at

    def sample_once() -> None:
        nonlocal samples_attempted, samples_with_browser, valid_samples, peak_pss
        samples_attempted += 1
        sample = sample_chromium_pss(proc.pid)
        pids_seen.update(sample["pids"])
        if sample["pids"]:
            samples_with_browser += 1
        if sample["complete"]:
            valid_samples += 1
            peak_pss = sample["pssBytes"] if peak_pss is None else max(peak_pss, sample["pssBytes"])

    while proc.poll() is None:
        now = time.monotonic()
        if now >= next_sample:
            sample_once()
            next_sample = now + args.sample_interval_seconds
        if now >= deadline:
            timed_out = True
            try:
                os.killpg(proc.pid, signal.SIGINT)
            except ProcessLookupError:
                pass
            grace_deadline = time.monotonic() + args.grace_seconds
            while proc.poll() is None and time.monotonic() < grace_deadline:
                now = time.monotonic()
                if now >= next_sample:
                    sample_once()
                    next_sample = now + args.sample_interval_seconds
                time.sleep(min(0.1, max(0.01, next_sample - time.monotonic())))
            if proc.poll() is None:
                try:
                    os.killpg(proc.pid, signal.SIGKILL)
                except ProcessLookupError:
                    pass
            break
        time.sleep(min(0.1, max(0.01, next_sample - now)))

    return_code = proc.wait()
    reader.join(timeout=5)
    cgroup_after = read_cgroup_memory()
    if timed_out:
        return_code = 124
    result = {
        "method": "PSS sum from smaps_rollup for unique Chromium descendants of the Playwright command process",
        "status": "VERIFIED" if peak_pss is not None else "NOT_VERIFIED",
        "reason": None if peak_pss is not None else "No complete Chromium-descendant PSS sample was readable from /proc.",
        "sampleIntervalSeconds": args.sample_interval_seconds,
        "samplesAttempted": samples_attempted,
        "samplesWithChromiumProcesses": samples_with_browser,
        "completePssSampleCount": valid_samples,
        "distinctChromiumPids": len(pids_seen),
        "peakPssBytes": peak_pss,
        "peakPssMiB": round(peak_pss / (1024 * 1024), 2) if peak_pss is not None else None,
        "cgroupBefore": cgroup_before,
        "cgroupAfter": cgroup_after,
        "exitCode": return_code,
        "timedOut": timed_out,
        "wallDurationSeconds": round(time.monotonic() - started_at, 2),
    }
    memory_path.parent.mkdir(parents=True, exist_ok=True)
    memory_path.write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
    if args.github_output:
        with Path(args.github_output).open("a", encoding="utf-8") as output:
            output.write(f"exit_code={return_code}\n")
            output.write(f"timed_out={str(timed_out).lower()}\n")
    return return_code


def _read_meminfo() -> tuple[int | None, int | None]:
    values: dict[str, int] = {}
    try:
        for line in Path("/proc/meminfo").read_text().splitlines():
            key, _, rest = line.partition(":")
            if key in ("MemTotal", "MemAvailable"):
                values[key] = int(rest.strip().split()[0]) * 1024
    except (OSError, ValueError, IndexError):
        pass
    return values.get("MemTotal"), values.get("MemAvailable")


def _cpu_model() -> str | None:
    try:
        for line in Path("/proc/cpuinfo").read_text().splitlines():
            if line.lower().startswith(("model name", "hardware")):
                return line.split(":", 1)[1].strip()
    except (OSError, IndexError):
        pass
    return None


def record_environment(output_path: Path, github_output: str | None) -> int:
    bun_version = None
    try:
        bun_version = subprocess.run(["bun", "--version"], check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    chromium_path = None
    chromium_version = None
    try:
        chromium_path = subprocess.run(
            ["node", "-e", "process.stdout.write(require('@playwright/test').chromium.executablePath())"],
            check=True, capture_output=True, text=True,
        ).stdout.strip()
        chromium_version = subprocess.run([chromium_path, "--version"], check=True, capture_output=True, text=True).stdout.strip()
    except (OSError, subprocess.CalledProcessError):
        pass
    total_bytes, available_bytes = _read_meminfo()
    env = {
        "os": platform.platform(),
        "architecture": platform.machine(),
        "cpuModel": _cpu_model(),
        "logicalCores": os.cpu_count(),
        "affinityCores": len(os.sched_getaffinity(0)) if hasattr(os, "sched_getaffinity") else None,
        "memoryTotalBytes": total_bytes,
        "memoryAvailableBytes": available_bytes,
        "cgroupMemory": read_cgroup_memory(),
        "cgroupCpu": read_cgroup_cpu(),
        "bunVersion": bun_version,
        "chromiumPath": chromium_path,
        "chromiumVersion": chromium_version,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(env, indent=2) + "\n", encoding="utf-8")
    if github_output:
        with Path(github_output).open("a", encoding="utf-8") as output:
            if chromium_path:
                output.write(f"chromium_path={chromium_path}\n")
            if chromium_version:
                output.write(f"chromium_version={chromium_version}\n")
    if bun_version != "1.4.3":
        raise SystemExit(f"Expected Bun 1.4.3; found {bun_version or 'unavailable'}")
    if not chromium_path or not chromium_version:
        raise SystemExit("Could not resolve and verify the installed Playwright Chromium executable")
    return 0


def _fmt_mib(value: Any) -> str:
    if _is_number(value):
        return f"{float(value) / (1024 * 1024):.1f} MiB"
    return "unavailable"


def _fmt_optional_ms(value: Any) -> str:
    return f"{float(value):.1f} ms" if _is_number(value) else "unavailable"


def _fmt_bytes(value: Any) -> str:
    if value is None:
        return "unavailable"
    if value == "unlimited":
        return "unlimited"
    if isinstance(value, int) and not isinstance(value, bool):
        return f"{value} bytes ({value / (1024 * 1024):.1f} MiB)"
    return str(value)


def finalize_summary(args: argparse.Namespace) -> int:
    summary_path = Path(args.summary)
    report: dict[str, Any] | None = None
    report_error: str | None = None
    log_path = Path(args.log)
    if log_path.exists():
        try:
            report = parse_report_text(log_path.read_text(encoding="utf-8", errors="replace"), args.source_sha)
        except ReportError as exc:
            report_error = str(exc)
    else:
        report_error = "performance execution log is missing"

    memory: dict[str, Any]
    try:
        memory = normalize_memory_evidence(json.loads(Path(args.memory).read_text(encoding="utf-8")))
    except (OSError, json.JSONDecodeError):
        memory = {"status": "NOT_VERIFIED", "reason": "memory sampler output is unavailable or malformed"}
    environment: dict[str, Any] = {}
    try:
        environment = _object(json.loads(Path(args.environment).read_text(encoding="utf-8")), "environment output")
    except (OSError, json.JSONDecodeError, ReportError):
        environment = {}

    prior_steps = {
        "main branch guard": args.ref_guard,
        "Bun setup": args.bun_setup,
        "dependency installation": args.install,
        "production build": args.build,
        "Playwright Chromium installation": args.browser_install,
        "runner environment capture": args.environment_step,
    }
    first_incomplete = next((name for name, outcome in prior_steps.items() if outcome != "success"), None)
    status = "PASS"
    reason = "All mandatory browser, worker, UI, and result checks passed."
    browser_exit = args.browser_exit
    if args.ref_guard == "failure":
        status = "FAIL"
        reason = "The workflow was not dispatched from refs/heads/main."
    elif first_incomplete:
        status = "INCOMPLETE"
        reason = f"{first_incomplete} did not complete successfully."
    elif browser_exit == "124" or args.browser_timed_out == "true":
        status = "INCOMPLETE"
        reason = "The external eight-minute browser execution limit expired."
    elif args.browser_step != "success" or browser_exit != "0":
        status = "FAIL"
        reason = f"The Playwright execution failed (exit {browser_exit or 'unavailable'})."
    elif report_error:
        status = "FAIL"
        reason = f"The performance report failed closed validation: {report_error}."
    elif report:
        installed_version = browser_version_number(environment.get("chromiumVersion"))
        measured_version = browser_version_number(report["browser"].get("version"))
        if not installed_version or installed_version != measured_version:
            status = "FAIL"
            reason = "The browser report version does not match the installed Playwright Chromium version."
        else:
            status, reason = report_assessment(report)

    source_sha = args.source_sha
    run_url = args.run_url
    lines = [
        "## Maximum active generation browser performance qualification",
        "",
        f"- **Final assessment:** {status}",
        f"- **Assessment detail:** {reason}",
        f"- **Source SHA:** `{source_sha}`",
        f"- **Workflow run:** [{run_url}]({run_url})",
        "- **Interpretation:** One feasibility observation, not a statistically established p95 or final release qualification.",
        "",
        "### Environment",
        "",
        f"- OS / architecture: {environment.get('os', 'unavailable')} / {environment.get('architecture', 'unavailable')}",
        f"- CPU: {environment.get('cpuModel') or 'unavailable'}; {environment.get('affinityCores') or environment.get('logicalCores') or 'unavailable'} available logical cores ({environment.get('logicalCores') or 'unavailable'} reported by Python)",
        f"- Host memory: {_fmt_mib(environment.get('memoryAvailableBytes'))} available / {_fmt_mib(environment.get('memoryTotalBytes'))} total",
        f"- Bun: {environment.get('bunVersion') or 'unavailable'}",
        f"- Chromium: {environment.get('chromiumVersion') or 'unavailable'}",
    ]
    env_cgroup = environment.get("cgroupMemory") or {}
    lines.extend([
        f"- Cgroup memory limit (job cgroup, not Chromium-only): {_fmt_bytes(env_cgroup.get('limitBytes'))}",
        f"- Cgroup memory current at environment capture (job cgroup): {_fmt_bytes(env_cgroup.get('currentBytes'))}",
        f"- Cgroup CPU quota / cpuset: {(environment.get('cgroupCpu') or {}).get('quota') or 'unavailable'} / {(environment.get('cgroupCpu') or {}).get('cpuset') or 'unavailable'}",
        "",
        "### Simulation and validation",
        "",
    ])
    if report:
        timings = report["timings"]
        worker = report["workerRequests"]
        lines.extend([
            f"- Scenario: `{report['scenario']}`; Chromium {report['browser']['version']}; viewport 390×844",
            f"- Workload: 2024 UTC, 35,136 × 0.25-hour intervals, measured solar and wind, one battery profile, 25 years",
            f"- Project import: {_fmt_optional_ms(timings['projectImportElapsedMs'])}",
            f"- Operational request to financial readiness: {_fmt_optional_ms(timings['operationalRunToFinancialReadyElapsedMs'])}",
            f"- Worker requests: run {worker['importedProjectDelta']['run']}; projection-year {worker['importedProjectDelta']['projectionYear']}",
            f"- Completed worker responses: operational {worker['importedProjectResponses']['success']}; projection years {worker['importedProjectResponses']['projectionYear']}; errors {worker['importedProjectResponses']['error']}",
            f"- Results validation: **{report['resultsValidation']['status']}**; 25 annual rows; solar {report['resultsValidation']['solarYearOneKwh']:.2f} kWh; wind {report['resultsValidation']['windYearOneKwh']:.2f} kWh",
            f"- Browser/calculation error count: {report['browserErrorCount']}",
            "",
            "### UI responsiveness",
            "",
            f"- Actions measured: {report['uiResponsiveness']['actionCount']}; during active projection: {report['uiResponsiveness']['actionsDuringActiveProjection']}",
            f"- Observed nearest-rank p95: {_fmt_optional_ms(report['uiResponsiveness']['observedNearestRankP95Ms'])}; maximum: {_fmt_optional_ms(report['uiResponsiveness']['observedMaximumMs'])}",
            f"- Coverage: **{report['uiResponsiveness']['status']}** (100 ms reference target; single-run observations)",
        ])
    else:
        lines.extend([f"- Results: **{report_error or 'not available'}**", "- Workload and calculation validation: not verified"])
    js_memory = report.get("memory", {}) if report else {}
    pss_status = str(memory.get("status", "NOT_VERIFIED")).replace("_", " ")
    heap_samples = [js_memory.get(key) for key in ("initialBytes", "peakSampledDuringProjectionBytes", "afterCompletionBytes")]
    heap_status = "MEASURED" if all(_is_number(value) for value in heap_samples) else "NOT VERIFIED"
    lines.extend([
        "",
        "### Memory measurements",
        "",
        "Renderer JavaScript heap (not total browser memory or process-tree RSS):",
        f"- Status: **{heap_status}**; initial: {_fmt_mib(js_memory.get('initialBytes'))}; peak sampled during projection: {_fmt_mib(js_memory.get('peakSampledDuringProjectionBytes'))}; after completion: {_fmt_mib(js_memory.get('afterCompletionBytes'))}",
        f"- Renderer heap limitation: {'all three requested heap observations were recorded' if heap_status == 'MEASURED' else 'at least one heap observation was unavailable'}",
        f"- Chromium descendant PSS: **{pss_status}**; peak {_fmt_mib(memory.get('peakPssBytes'))}; complete samples {memory.get('completePssSampleCount', 0)} / {memory.get('samplesAttempted', 0)} attempted ({memory.get('samplesWithChromiumProcesses', 0)} with Chromium); distinct PIDs {memory.get('distinctChromiumPids', 0)}",
        f"- PSS method: {memory.get('method', 'not verified')}",
        f"- PSS limitation: {memory.get('reason') or 'all reported samples had readable smaps_rollup values'}",
        f"- Cgroup memory after browser execution (job cgroup, may include other job processes): limit {_fmt_bytes((memory.get('cgroupAfter') or {}).get('limitBytes'))}; current {_fmt_bytes((memory.get('cgroupAfter') or {}).get('currentBytes'))}; peak {_fmt_bytes((memory.get('cgroupAfter') or {}).get('peakBytes'))}",
        "- PSS and cgroup values are not directly comparable with the historical process-tree RSS budget.",
        "",
        "A PASS here means this single feasibility run completed required checks. It does not establish p95 repeatability, qualify consumer hardware, or replace final release qualification.",
        "",
    ])
    summary_path.parent.mkdir(parents=True, exist_ok=True)
    summary_path.write_text("\n".join(lines), encoding="utf-8")
    return 0 if status == "PASS" else 1


def main() -> int:
    parser = argparse.ArgumentParser()
    subparsers = parser.add_subparsers(dest="mode", required=True)
    env_parser = subparsers.add_parser("environment")
    env_parser.add_argument("--output", required=True)
    env_parser.add_argument("--github-output")
    run_parser = subparsers.add_parser("run")
    run_parser.add_argument("--timeout-seconds", type=int, default=480)
    run_parser.add_argument("--grace-seconds", type=int, default=15)
    run_parser.add_argument("--sample-interval-seconds", type=float, default=0.5)
    run_parser.add_argument("--log", required=True)
    run_parser.add_argument("--memory-output", required=True)
    run_parser.add_argument("--github-output")
    run_parser.add_argument("command", nargs=argparse.REMAINDER)
    summary_parser = subparsers.add_parser("summary")
    for name in ("log", "memory", "environment", "summary", "source-sha", "run-url", "ref-guard", "bun-setup", "install", "build", "browser-install", "environment-step", "browser-step", "browser-exit", "browser-timed-out"):
        summary_parser.add_argument(f"--{name}", dest=name.replace("-", "_"), required=True)
    args = parser.parse_args()
    if args.mode == "environment":
        return record_environment(Path(args.output), args.github_output)
    if args.mode == "run":
        return run_bounded(args)
    return finalize_summary(args)


if __name__ == "__main__":
    raise SystemExit(main())
