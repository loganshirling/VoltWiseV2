import json
import re
import sys
import tempfile
import unittest
from pathlib import Path
from types import SimpleNamespace

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import browser_performance_qualification as qualification  # noqa: E402


SOURCE_SHA = "a" * 40


def valid_report() -> dict:
    actions = [
        {"name": f"action {index + 1}", "durationMs": float(index + 10), "duringProjection": True}
        for index in range(15)
    ]
    return {
        "schemaVersion": 1,
        "sourceSha": SOURCE_SHA,
        "scenario": qualification.EXPECTED_SCENARIO,
        "browser": {"name": "chromium", "version": "Chromium 140.0.0.0", "viewport": {"width": 390, "height": 844}},
        "input": {
            "intervalCount": 35_136,
            "intervalDurationHours": 0.25,
            "calendarYear": 2024,
            "enabledAssetTypes": ["solar", "wind"],
            "batteryProfiles": 1,
            "projectionYears": 25,
        },
        "timings": {
            "clock": "window.performance.now()",
            "projectImportElapsedMs": 240.5,
            "initialOperationalRunRequestAtMs": 1_000.0,
            "firstProjectionYearRequestAtMs": 1_300.0,
            "lastProjectionYearResponseAtMs": 28_000.0,
            "generationFinancialReadyAtMs": 28_100.0,
            "operationalRunToFinancialReadyElapsedMs": 27_100.0,
        },
        "workerRequests": {
            "baselineRequestCount": 1,
            "importedProjectDelta": {"run": 1, "projectionYear": 25},
            "importedProjectResponses": {"success": 1, "projectionYear": 25, "error": 0},
            "totalNewResponseCount": 47,
        },
        "uiResponsiveness": {
            "interactionTargetMs": 100,
            "actionCount": len(actions),
            "actionsDuringActiveProjection": len(actions),
            "individualActions": actions,
            "observedNearestRankP95Ms": 24.0,
            "observedMaximumMs": 24.0,
            "status": "MEASURED",
        },
        "memory": {
            "measurement": "renderer JavaScript heap; not total browser memory or process-tree RSS",
            "supported": True,
            "initialBytes": 10_000_000,
            "peakSampledDuringProjectionBytes": 20_000_000,
            "afterCompletionBytes": 12_000_000,
            "sampleIntervalMs": 50,
        },
        "resultsValidation": {"status": "PASS", "solarYearOneKwh": 1_234.5, "windYearOneKwh": 678.9, "annualProjectionYears": 25},
        "browserErrorCount": 0,
    }


def report_log(report: dict) -> str:
    return "playwright output\n" + qualification.REPORT_PREFIX + json.dumps(report, separators=(",", ":")) + "\n"


class PerformanceReportTests(unittest.TestCase):
    def parse(self, report: dict) -> dict:
        return qualification.parse_report_text(report_log(report), SOURCE_SHA)

    def test_accepts_valid_synthetic_performance_report(self) -> None:
        parsed = self.parse(valid_report())
        self.assertEqual(parsed["scenario"], qualification.EXPECTED_SCENARIO)
        self.assertEqual(qualification.report_assessment(parsed)[0], "PASS")

    def test_rejects_missing_report(self) -> None:
        with self.assertRaisesRegex(qualification.ReportError, "missing"):
            qualification.parse_report_text("Playwright passed but no report was emitted", SOURCE_SHA)

    def test_rejects_malformed_and_truncated_json(self) -> None:
        with self.assertRaisesRegex(qualification.ReportError, "malformed or truncated"):
            qualification.parse_report_text(qualification.REPORT_PREFIX + '{"scenario":', SOURCE_SHA)

    def test_rejects_duplicate_reports(self) -> None:
        line = report_log(valid_report())
        with self.assertRaisesRegex(qualification.ReportError, "exactly one"):
            qualification.parse_report_text(line + line, SOURCE_SHA)

    def test_rejects_wrong_scenario_or_interval_count(self) -> None:
        report = valid_report()
        report["scenario"] = "other"
        with self.assertRaisesRegex(qualification.ReportError, "scenario"):
            self.parse(report)
        report = valid_report()
        report["input"]["intervalCount"] = 35_135
        with self.assertRaisesRegex(qualification.ReportError, "intervalCount"):
            self.parse(report)

    def test_rejects_incomplete_projection_worker_responses(self) -> None:
        report = valid_report()
        report["workerRequests"]["importedProjectResponses"]["projectionYear"] = 24
        with self.assertRaisesRegex(qualification.ReportError, "projectionYear"):
            self.parse(report)

    def test_rejects_nonfinite_or_inconsistent_projection_timing(self) -> None:
        malformed = report_log(valid_report()).replace('"projectImportElapsedMs":240.5', '"projectImportElapsedMs":NaN')
        with self.assertRaisesRegex(qualification.ReportError, "nonfinite"):
            qualification.parse_report_text(malformed, SOURCE_SHA)
        report = valid_report()
        report["timings"]["operationalRunToFinancialReadyElapsedMs"] = 1
        with self.assertRaisesRegex(qualification.ReportError, "elapsed time"):
            self.parse(report)

    def test_rejects_failed_results_validation(self) -> None:
        report = valid_report()
        report["resultsValidation"]["status"] = "FAIL"
        with self.assertRaisesRegex(qualification.ReportError, "Results validation"):
            self.parse(report)

    def test_preserves_unavailable_renderer_heap_as_not_verified_evidence(self) -> None:
        report = valid_report()
        report["memory"].update({"supported": False, "initialBytes": None, "peakSampledDuringProjectionBytes": None, "afterCompletionBytes": None})
        parsed = self.parse(report)
        self.assertFalse(parsed["memory"]["supported"])
        self.assertEqual(qualification.report_assessment(parsed)[0], "PASS")

    def test_incomplete_ui_coverage_is_not_reported_as_success(self) -> None:
        report = valid_report()
        actions = report["uiResponsiveness"]["individualActions"][:14]
        report["uiResponsiveness"].update({
            "actionCount": len(actions),
            "actionsDuringActiveProjection": len(actions),
            "individualActions": actions,
            "observedNearestRankP95Ms": 23.0,
            "observedMaximumMs": 23.0,
            "status": "NOT_FULLY_MEASURED",
        })
        parsed = self.parse(report)
        self.assertEqual(parsed["uiResponsiveness"]["status"], "NOT_FULLY_MEASURED")
        self.assertEqual(qualification.report_assessment(parsed)[0], "INCOMPLETE")

    def test_summary_distinguishes_pass_incomplete_and_unverified_memory(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            log = root / "playwright.log"
            memory_path = root / "memory.json"
            environment_path = root / "environment.json"
            summary_path = root / "summary.md"
            memory_path.write_text(json.dumps({
                "status": "NOT_VERIFIED", "reason": "smaps_rollup unavailable", "samplesAttempted": 0,
                "samplesWithChromiumProcesses": 0, "completePssSampleCount": 0, "distinctChromiumPids": 0,
                "peakPssBytes": None,
            }))
            environment_path.write_text(json.dumps({"chromiumVersion": "Chromium 140.0.0.0"}))
            args = SimpleNamespace(
                summary=str(summary_path), log=str(log), memory=str(memory_path), environment=str(environment_path),
                source_sha=SOURCE_SHA, run_url="https://github.com/example/repo/actions/runs/1",
                ref_guard="success", bun_setup="success", install="success", build="success",
                browser_install="success", environment_step="success", browser_step="success",
                browser_exit="0", browser_timed_out="false",
            )

            log.write_text(report_log(valid_report()))
            self.assertEqual(qualification.finalize_summary(args), 0)
            passing_summary = summary_path.read_text()
            self.assertIn("Final assessment:** PASS", passing_summary)
            self.assertIn("Chromium descendant PSS: **NOT VERIFIED**", passing_summary)

            incomplete = valid_report()
            actions = incomplete["uiResponsiveness"]["individualActions"][:14]
            incomplete["uiResponsiveness"].update({
                "actionCount": len(actions), "actionsDuringActiveProjection": len(actions),
                "individualActions": actions, "observedNearestRankP95Ms": 23.0,
                "observedMaximumMs": 23.0, "status": "NOT_FULLY_MEASURED",
            })
            log.write_text(report_log(incomplete))
            self.assertEqual(qualification.finalize_summary(args), 1)
            self.assertIn("Final assessment:** INCOMPLETE", summary_path.read_text())


class ProcessMemorySamplerTests(unittest.TestCase):
    def make_process(self, root: Path, pid: int, command: str, children: list[int], pss_kb: int | None) -> None:
        process = root / str(pid)
        (process / "task" / str(pid)).mkdir(parents=True)
        (process / "task" / str(pid) / "children").write_text(" ".join(map(str, children)))
        (process / "cmdline").write_bytes((command + "\0--test-arg\0").encode())
        if pss_kb is not None:
            (process / "smaps_rollup").write_text(f"Rss: 1000 kB\nPss: {pss_kb} kB\n")

    def test_tracks_only_chromium_descendants_and_sums_unique_pss(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            self.make_process(proc_root, 100, "/usr/bin/python3", [101, 102], None)
            self.make_process(proc_root, 101, "/usr/bin/chromium", [103], 512)
            self.make_process(proc_root, 102, "/usr/bin/node", [104], None)
            self.make_process(proc_root, 103, "/usr/bin/chromium", [], 128)
            self.make_process(proc_root, 104, "/opt/chrome/chrome", [], 256)
            self.make_process(proc_root, 200, "/usr/bin/chromium", [], 999)
            (proc_root / "100" / "task" / "100" / "children").write_text("101 102 101")

            sample = qualification.sample_chromium_pss(100, proc_root)
            self.assertEqual(sample["pids"], [101, 103, 104])
            self.assertEqual(sample["pssBytes"], (512 + 128 + 256) * 1024)
            self.assertTrue(sample["complete"])

    def test_unreadable_process_pss_is_not_a_verified_partial_sum(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            proc_root = Path(directory)
            self.make_process(proc_root, 100, "/usr/bin/python3", [101, 102], None)
            self.make_process(proc_root, 101, "/usr/bin/chromium", [], 512)
            self.make_process(proc_root, 102, "/usr/bin/chrome", [], None)

            sample = qualification.sample_chromium_pss(100, proc_root)
            self.assertFalse(sample["complete"])
            self.assertIsNone(sample["pssBytes"])
            self.assertEqual(sample["unreadablePids"], [102])

    def test_unavailable_or_inconsistent_pss_is_reported_not_verified(self) -> None:
        unavailable = qualification.normalize_memory_evidence({
            "status": "NOT_VERIFIED",
            "reason": "smaps_rollup unavailable",
            "samplesAttempted": 10,
            "samplesWithChromiumProcesses": 3,
            "completePssSampleCount": 0,
            "distinctChromiumPids": 4,
            "peakPssBytes": None,
        })
        self.assertEqual(unavailable["status"], "NOT_VERIFIED")
        inconsistent = qualification.normalize_memory_evidence({
            "status": "VERIFIED",
            "samplesAttempted": 10,
            "samplesWithChromiumProcesses": 3,
            "completePssSampleCount": 0,
            "distinctChromiumPids": 4,
            "peakPssBytes": 12_000,
        })
        self.assertEqual(inconsistent["status"], "NOT_VERIFIED")
        self.assertIsNone(inconsistent.get("peakPssBytes"))


class WorkflowStepReferenceTests(unittest.TestCase):
    def test_all_outcome_references_match_declared_step_ids(self) -> None:
        workflow_path = Path(__file__).resolve().parents[2] / ".github/workflows/browser-performance-qualification.yml"
        lines = workflow_path.read_text(encoding="utf-8").splitlines()
        step_blocks: list[str] = []
        current: list[str] = []
        for line in lines:
            if line.startswith("      - name: "):
                if current:
                    step_blocks.append("\n".join(current))
                current = [line]
            elif current:
                current.append(line)
        if current:
            step_blocks.append("\n".join(current))

        declared_ids = {
            match.group(1)
            for block in step_blocks
            if (match := re.search(r"(?m)^        id: ([A-Za-z0-9_-]+)$", block))
        }
        bun_step = next(block for block in step_blocks if block.startswith("      - name: Set up Bun\n"))
        self.assertRegex(bun_step, r"(?m)^        id: setup_bun$")
        self.assertIn("${{ steps.setup_bun.outcome }}", "\n".join(lines))

        referenced_ids = set(re.findall(r"steps\.([A-Za-z0-9_-]+)\.outcome", "\n".join(lines)))
        self.assertTrue(referenced_ids)
        self.assertEqual(referenced_ids - declared_ids, set())


if __name__ == "__main__":
    unittest.main()
