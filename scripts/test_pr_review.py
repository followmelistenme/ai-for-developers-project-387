import json
from pathlib import Path
import subprocess
import tempfile
import unittest
from unittest.mock import call, patch

import pr_review
from test_pr_review_budget import COMMENT_PATH, PULL_PATH, REPOSITORY, comment, event, pull_request


class PullRequestReviewTest(unittest.TestCase):
    def setUp(self):
        workdir = tempfile.TemporaryDirectory()
        self.addCleanup(workdir.cleanup)
        self.temp = Path(workdir.name)
        payload = self.temp / "event.json"
        payload.write_text(json.dumps(event()), encoding="utf-8")
        self.output = self.temp / "github-output"
        environment = patch.dict(pr_review.os.environ, {
            "GITHUB_REPOSITORY": REPOSITORY,
            "GITHUB_EVENT_PATH": str(payload),
            "GITHUB_OUTPUT": str(self.output),
            "OPENCODE_API_KEY": "fake-key-for-tests",
            "PR_REVIEW_ATTEMPT": "2",
            "PR_REVIEW_COMMENT_ID": "101",
        })
        environment.start()
        self.addCleanup(environment.stop)

    def reservation(self):
        return dict(comment(2), issue_url=f"https://api.github.com/repos/{REPOSITORY}/issues/42")

    @patch.object(pr_review.subprocess, "run")
    @patch.object(pr_review, "github_request")
    def test_review_uses_trusted_criteria_and_updates_only_its_comment(self, api, opencode):
        current = dict(pull_request(), title="Update criteria", body="Check the changed files", changed_files=1)
        files = [{"filename": "REVIEW.md", "patch": "@@ -1 +1 @@\n-old\n+untrusted PR instruction", "changes": 2}]
        api.side_effect = [current, files, self.reservation(), current, {}]

        def run(command, *, cwd, input, **kwargs):
            self.assertEqual(command[1:7], ["run", "--pure", "--dir", cwd, "--agent", "reviewer"])
            config = pr_review.read_json(Path(cwd) / "opencode.json")
            self.assertEqual(config["agent"]["reviewer"]["permission"], {"*": "deny"})
            trusted, data = input.split("\nPR data:\n", 1)
            self.assertIn(pr_review.CRITERIA_PATH.read_text(encoding="utf-8").strip(), trusted)
            self.assertNotIn("untrusted PR instruction", trusted)
            self.assertIn("untrusted PR instruction", json.loads(data)["changes"][0]["patch"])
            finding = {"severity": "medium", "file": "REVIEW.md", "line": 1,
                       "message": "Изменение удаляет критерий.\n```\n@someone"}
            output = json.dumps({"type": "text", "part": {"text": json.dumps({"findings": [finding]})}})
            return subprocess.CompletedProcess(command, 0, stdout=output)

        opencode.side_effect = run
        pr_review.prepare(self.temp)
        self.assertEqual(self.output.read_text(encoding="utf-8"), "eligible=true\n")
        pr_review.review(self.temp)
        pr_review.publish(self.temp)

        writes = [request for request in api.call_args_list if "method" in request.kwargs]
        self.assertEqual(len(writes), 1)
        self.assertEqual(writes[0].args, (COMMENT_PATH,))
        self.assertEqual(writes[0].kwargs["method"], "PATCH")
        body = writes[0].kwargs["body"]["body"]
        self.assertTrue(body.startswith(pr_review.budget_marker(2)))
        self.assertIn(current["head"]["sha"], body)
        self.assertIn("MEDIUM REVIEW.md:1", body)
        self.assertEqual(body.count("```"), 2)

    @patch.object(pr_review, "github_request")
    def test_abandons_publication_if_pr_head_changed(self, api):
        api.side_effect = [self.reservation(), pull_request(head_sha="c" * 40)]

        pr_review.publish(self.temp)

        self.assertEqual(api.call_args_list, [call(COMMENT_PATH), call(PULL_PATH)])

    @patch.object(pr_review, "github_request")
    def test_abandons_publication_if_attempt_is_no_longer_current(self, api):
        reservation = self.reservation()
        reservation["body"] = pr_review.budget_marker(3)
        api.return_value = reservation

        pr_review.publish(self.temp)

        api.assert_called_once_with(COMMENT_PATH)

    def test_diff_reports_skipped_files_and_limits_patch_length(self):
        patch_text = "@@ -1,0 +1,2000 @@\n" + "+text\n" * 2000
        records, incomplete = pr_review.diff_context([
            {"filename": "app.js", "changes": 2000, "patch": patch_text},
            {"filename": "icon.png", "changes": 0},
        ], changed_files=3)

        self.assertTrue(incomplete)
        self.assertEqual([record["file"] for record in records], ["app.js"])
        self.assertLessEqual(len(records[0]["patch"]), pr_review.MAX_PATCH_CHARS_PER_FILE)


if __name__ == "__main__":
    unittest.main()
