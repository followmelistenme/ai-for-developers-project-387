import json
from datetime import datetime, timezone
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import patch

import issue_triage


REPOSITORY = "owner/calendar"
ISSUE_PATH = f"/repos/{REPOSITORY}/issues/42"
ESTABLISHED_AUTHOR = {"created_at": "2020-01-01T00:00:00Z"}


def new_issue(*labels, author="User"):
    return {
        "number": 42,
        "state": "open",
        "locked": False,
        "user": {"type": author, "id": 123},
        "labels": [{"name": label} for label in labels],
        "title": "На странице записи не открывается календарь",
        "body": 'Проблема проявляется по ссылке. $(echo test)\n@maintainer',
    }


class IssueTriageTest(unittest.TestCase):
    def setUp(self):
        directory = tempfile.TemporaryDirectory()
        self.addCleanup(directory.cleanup)
        self.temp = Path(directory.name)
        self.event = self.temp / "event.json"
        self.output = self.temp / "output.txt"
        environment = patch.dict(issue_triage.os.environ, {
            "GITHUB_EVENT_PATH": str(self.event),
            "GITHUB_OUTPUT": str(self.output),
            "GITHUB_REPOSITORY": REPOSITORY,
            "OPENCODE_API_KEY": "fake-key-for-tests",
        })
        environment.start()
        self.addCleanup(environment.stop)

    def opened(self, issue):
        self.event.write_text(json.dumps({"action": "opened", "issue": issue}), encoding="utf-8")

    @patch.object(issue_triage.subprocess, "run")
    @patch.object(issue_triage, "github_request")
    def test_new_issue_gets_one_comment(self, github, opencode):
        issue = new_issue("bug")
        self.opened(issue)
        github.side_effect = [issue, [], ESTABLISHED_AUTHOR, issue, [], {}, issue, [{
            "user": {"login": "github-actions[bot]"},
            "body": issue_triage.COMMENT_MARKER,
        }]]

        def classify(command, *, cwd, input, **kwargs):
            self.assertEqual(command[1:4], ["run", "--agent", "triage"])
            config = json.loads((Path(cwd) / "opencode.json").read_text(encoding="utf-8"))
            self.assertEqual(config["agent"]["triage"]["permission"], {"*": "deny"})
            self.assertIn("$(echo test)", input)
            output = json.dumps({
                "type": "text",
                "part": {"text": '{"category":"bug","questions":["steps"]}'},
            })
            return subprocess.CompletedProcess(command, 0, stdout=output)

        opencode.side_effect = classify
        issue_triage.prepare(self.temp)
        self.assertEqual(self.output.read_text(encoding="utf-8"), "eligible=true\n")
        issue_triage.classify(self.temp)
        issue_triage.publish(self.temp)
        issue_triage.prepare(self.temp)

        writes = [call for call in github.call_args_list if "body" in call.kwargs]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0].args, (f"{ISSUE_PATH}/comments",))
        comment = writes[0].kwargs["body"]["body"]
        self.assertIn("`bug`", comment)
        self.assertIn("`needs-info`", comment)
        self.assertIn(issue_triage.QUESTIONS["steps"], comment)
        self.assertNotIn("@maintainer", comment)
        opencode.assert_called_once()

    @patch.object(issue_triage, "github_request")
    def test_ready_tickets_and_bots_skip_the_model(self, github):
        issues = [new_issue(label) for label in (
            "ready-for-agent", "Ready-For-Human", "wontfix", "needs-info",
        )]
        issues.append(new_issue(author="Bot"))
        for issue in issues:
            with self.subTest(issue=issue):
                self.opened(issue)
                issue_triage.prepare(self.temp)
                self.assertFalse(self.output.exists())

        github.assert_not_called()

    @patch.object(issue_triage, "github_request")
    def test_issue_marked_ready_during_classification_gets_no_comment(self, github):
        self.opened(new_issue())
        github.return_value = new_issue("ready-for-agent")

        issue_triage.publish(self.temp)

        github.assert_called_once_with(ISSUE_PATH)

    @patch.object(issue_triage, "github_request")
    def test_new_accounts_skip_the_model(self, github):
        issue = new_issue()
        self.opened(issue)
        github.side_effect = [issue, [], {"created_at": datetime.now(timezone.utc).isoformat()}]

        issue_triage.prepare(self.temp)

        self.assertFalse(self.output.exists())

    @patch.object(issue_triage, "github_request")
    def test_marker_from_issue_author_does_not_skip_triage(self, github):
        issue = new_issue()
        self.opened(issue)
        github.side_effect = [issue, [{
            "body": issue_triage.COMMENT_MARKER,
            "user": {"login": "some-user"},
        }], ESTABLISHED_AUTHOR]

        issue_triage.prepare(self.temp)

        self.assertTrue(self.output.exists())

    def test_unexpected_model_content_is_rejected(self):
        with self.assertRaises(ValueError):
            issue_triage.checked_result({"category": "bug", "questions": ["@maintainer"]})


if __name__ == "__main__":
    unittest.main()
