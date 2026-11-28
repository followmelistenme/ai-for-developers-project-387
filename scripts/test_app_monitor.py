"""Exercise smoke retries, issue deduplication, and report retention."""

import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import app_monitor as monitor


def attempt(failure=None, http=200):
    return {"http": http, "curl": 0, "seconds": 0.4, "failure": failure}


def issue(body="Existing issue", *, number=7, **extra):
    return {"number": number, "title": "Existing issue", "state": "closed",
            "body": body, "updated_at": "2026-11-28T00:00:00Z",
            "user": {"login": "github-actions[bot]"}, **extra}


class MonitorTest(unittest.TestCase):
    def setUp(self):
        temp = self.enterContext(tempfile.TemporaryDirectory())
        self.directory = Path(temp)
        self.output = self.directory / "output"
        self.summary = self.directory / "summary"
        self.enterContext(patch.dict(os.environ, {
            "APP_URL": "https://calendar.example/",
            "MONITOR_DIR": temp,
            "GITHUB_OUTPUT": str(self.output),
            "GITHUB_STEP_SUMMARY": str(self.summary),
            "GITHUB_REPOSITORY": "example/calendar",
            "GITHUB_RUN_ID": "123",
            "GITHUB_SHA": "a" * 40,
            "PUBLISH_ISSUES": "false",
        }))
        self.report = {"origin": "https://calendar.example", "findings": {"home": "http-503"},
                       "observed_at": "2026-11-28T00:00:00+00:00", "results": {}}

    def test_probe_checks_successful_responses_without_preserving_bodies(self):
        with patch.object(monitor.subprocess, "run") as curl:
            curl.return_value.stdout = b"[]\n200"
            curl.return_value.returncode = 0
            valid = monitor.probe(self.report["origin"], "meeting-types", 20)
            self.assertIsNone(valid["failure"])
            curl.return_value.stdout = b"{\"private\":true}\n200"
            invalid = monitor.probe(self.report["origin"], "meeting-types", 20)
        self.assertEqual(invalid["failure"], "unexpected-response")
        self.assertNotIn("private", str(invalid))

    def test_cold_start_recovers_before_becoming_a_finding(self):
        failed = attempt("http-503", 503)
        success = attempt()
        with patch.object(monitor, "probe", side_effect=[failed, success]) as probe:
            with patch.object(monitor.time, "sleep") as sleep:
                attempts = monitor.probe_with_retry(self.report["origin"], "home")
        self.assertEqual(attempts, [failed, success])
        self.assertEqual([call.args[-1] for call in probe.call_args_list], [65, 20])
        self.assertGreater(sleep.call_args.args[0], 60)
        with patch.object(monitor, "probe_with_retry", return_value=attempts):
            monitor.collect(self.report, self.directory)
        self.assertEqual(self.report["findings"], {})
        self.assertEqual(self.output.read_text(), "findings=false\n")
        self.assertIn("Обе проверки пройдены", monitor.report_markdown(self.report))

    def test_common_failure_creates_one_finding(self):
        failures = [attempt("http-503", 503), attempt("http-503", 503)]
        with patch.object(monitor, "probe_with_retry", return_value=failures):
            monitor.collect(self.report, self.directory)
        self.assertEqual(self.report["findings"], {"availability": "http-503"})
        self.assertEqual(self.output.read_text(), "findings=true\n")

    def test_pagination_finds_closed_duplicate_after_pull_requests(self):
        closed = issue(monitor.marker(self.report, "home"))
        pulls = [issue(pull_request={})] * 100
        with patch.object(monitor, "github_request", side_effect=[pulls, [closed]]) as api:
            monitor.prepare(self.report, self.directory)
        self.assertEqual(api.call_count, 2)
        self.assertIn("state=all", api.call_args.args[0])
        self.assertEqual(self.output.read_text(), "classify=false\n")
        self.assertIn("/issues/7", self.report["results"]["home"])

    def test_model_can_reference_local_or_github_issue_only_by_existing_id(self):
        reference = ".scratch/homepage/issues/01-page.md"
        context = {"findings": {"home": "http-503"}, "tickets": {"#7": {}, reference: "Ticket"}}
        for decision in ("#7", reference, "new", "uncertain", "#8"):
            with self.subTest(decision=decision):
                result = {"home": decision}
                stream = json.dumps({"type": "text", "part": {"text": json.dumps(result)}})
                if decision == "#8":
                    with self.assertRaises(monitor.MonitorError):
                        monitor.parse_decisions(stream, context)
                else:
                    self.assertEqual(monitor.parse_decisions(stream, context), result)

    def test_publish_creates_issue_once_and_then_links_it(self):
        monitor.save_json(self.directory / "decisions.json", {"home": "new"})
        monitor.save_json(self.directory / "issue-revisions.json", {})
        with patch.dict(os.environ, {"PUBLISH_ISSUES": "true"}):
            with patch.object(monitor, "github_request", side_effect=[[], {"number": 7}]) as api:
                monitor.publish(self.report, self.directory)
            posted = api.call_args.kwargs["body"]
            self.assertIn(monitor.marker(self.report, "home"), posted["body"])
            self.assertIn("actions/runs/123", posted["body"])
            self.assertIn("Создана задача", self.report["results"]["home"])
            with patch.object(monitor, "github_request", return_value=[issue(posted["body"])]) as api:
                monitor.publish(self.report, self.directory)
            api.assert_called_once_with("/repos/example/calendar/issues?state=all&per_page=100&page=1")
        self.assertIn("Уже есть задача", self.report["results"]["home"])

    def test_changed_issue_history_and_dry_run_never_post(self):
        monitor.save_json(self.directory / "decisions.json", {"home": "new"})
        monitor.save_json(self.directory / "issue-revisions.json", {})
        with patch.object(monitor, "github_request", return_value=[issue()]) as api:
            monitor.publish(self.report, self.directory)
            api.assert_not_called()
            self.assertIn("режиме отчёта", self.report["results"]["home"])
            with patch.dict(os.environ, {"PUBLISH_ISSUES": "true"}):
                monitor.publish(self.report, self.directory)
            api.assert_called_once()
        self.assertIn("изменился после сверки", self.report["results"]["home"])

    def test_report_and_summary_are_saved_after_failed_collection(self):
        with patch.dict(os.environ, {"APP_URL": ""}):
            with patch("sys.argv", ["app_monitor.py", "collect"]), self.assertRaises(SystemExit):
                monitor.main()
        with patch("sys.argv", ["app_monitor.py", "summarize"]):
            monitor.main()
        self.assertIn("APP_URL", self.summary.read_text())
        self.assertEqual(self.summary.read_bytes(), (self.directory / "report.md").read_bytes())


if __name__ == "__main__":
    unittest.main()
