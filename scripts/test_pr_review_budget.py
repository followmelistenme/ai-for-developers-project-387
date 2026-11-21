import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import call, patch
from urllib.error import HTTPError

import pr_review_budget as budget


REPOSITORY = "owner/calendar"
PULL_PATH = f"/repos/{REPOSITORY}/pulls/42"
COMMENTS_PATH = f"/repos/{REPOSITORY}/issues/42/comments"
COMMENT_PATH = f"/repos/{REPOSITORY}/issues/comments/101"


def pull_request(*, state="open", draft=False, head_sha="a" * 40, head_repo=REPOSITORY):
    return {
        "state": state,
        "draft": draft,
        "head": {"sha": head_sha, "repo": {"full_name": head_repo}},
        "base": {"sha": "b" * 40, "ref": "main", "repo": {"full_name": REPOSITORY}},
    }


def event():
    return {"action": "opened", "number": 42, "pull_request": pull_request()}


def comment(attempt, *, author=None):
    return {
        "id": 101,
        "user": author or {"login": budget.BOT_LOGIN, "type": "Bot"},
        "body": f"{budget.budget_marker(attempt)}\n\nTest comment",
    }


class ReviewBudgetTest(unittest.TestCase):
    @patch.object(budget, "github_request")
    def test_first_reservation_creates_one_comment_ignoring_human_marker(self, api):
        spoofed = comment(3, author={"login": "contributor", "type": "User"})
        api.side_effect = [pull_request(), [spoofed], pull_request(), comment(1)]

        self.assertEqual(budget.reserve_attempt(event(), REPOSITORY, 3), (101, 1))

        self.assertEqual(api.call_args.args, (COMMENTS_PATH,))
        self.assertEqual(api.call_args.kwargs["method"], "POST")
        self.assertTrue(api.call_args.kwargs["body"]["body"].startswith(budget.budget_marker(1)))

    @patch.object(budget, "github_request")
    def test_last_attempt_updates_existing_comment_and_finds_it_on_later_pages(self, api):
        first_page = [comment(3, author={"login": "contributor", "type": "User"})] * 100
        api.side_effect = [pull_request(), first_page, [comment(2)], pull_request(), comment(3)]

        self.assertEqual(budget.reserve_attempt(event(), REPOSITORY, 3), (101, 3))

        self.assertIn(call(f"{COMMENTS_PATH}?per_page=100&page=2"), api.call_args_list)
        self.assertEqual(api.call_args.args, (COMMENT_PATH,))
        self.assertEqual(api.call_args.kwargs["method"], "PATCH")
        self.assertTrue(api.call_args.kwargs["body"]["body"].startswith(budget.budget_marker(3)))

    @patch.object(budget, "github_request")
    def test_exhausted_limit_stops_without_a_write(self, api):
        api.side_effect = [pull_request(), [comment(3)]]

        self.assertIsNone(budget.reserve_attempt(event(), REPOSITORY, 3))

        self.assertEqual(api.call_args_list, [call(PULL_PATH), call(f"{COMMENTS_PATH}?per_page=100&page=1")])

    @patch.object(budget, "github_request")
    def test_close_draft_fork_and_stale_head_without_reading_comments(self, api):
        for revision in (
            pull_request(state="closed"),
            pull_request(draft=True),
            pull_request(head_repo="fork/calendar"),
            pull_request(head_sha="c" * 40),
        ):
            with self.subTest(revision=revision):
                api.reset_mock()
                api.return_value = revision

                self.assertIsNone(budget.reserve_attempt(event(), REPOSITORY, 3))

                api.assert_called_once_with(PULL_PATH)

    @patch.object(budget, "github_request")
    def test_no_reservation_when_head_changes_while_reading_comments(self, api):
        api.side_effect = [pull_request(), [], pull_request(head_sha="c" * 40)]

        self.assertIsNone(budget.reserve_attempt(event(), REPOSITORY, 3))

        self.assertEqual(api.call_args_list, [
            call(PULL_PATH), call(f"{COMMENTS_PATH}?per_page=100&page=1"), call(PULL_PATH),
        ])

    @patch.object(budget, "github_request")
    def test_invalid_or_duplicate_bot_comment_fails_closed(self, api):
        for comments in ([comment("unknown")], [comment(1), comment(2)]):
            with self.subTest(comments=comments):
                api.side_effect = [pull_request(), comments]

                with self.assertRaises(ValueError):
                    budget.reserve_attempt(event(), REPOSITORY, 3)

    @patch.object(budget, "github_request")
    def test_failed_reservation_does_not_enable_the_model(self, api):
        api.side_effect = [pull_request(), [], pull_request(), HTTPError("https://api.github.com", 403, "", {}, None)]
        with tempfile.TemporaryDirectory() as directory:
            payload = Path(directory) / "event.json"
            payload.write_text(json.dumps(event()), encoding="utf-8")
            output = Path(directory) / "outputs.txt"
            with patch.dict(budget.os.environ, {
                "GITHUB_REPOSITORY": REPOSITORY,
                "GITHUB_EVENT_PATH": str(payload),
                "GITHUB_OUTPUT": str(output),
                "PR_REVIEW_MAX_RUNS": "3",
            }):
                with self.assertRaisesRegex(SystemExit, "HTTP 403"):
                    budget.main()

            self.assertFalse(output.exists())


if __name__ == "__main__":
    unittest.main()
