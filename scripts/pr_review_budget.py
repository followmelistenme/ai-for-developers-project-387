"""Reserve one automatic review attempt in a pull request's bot comment."""

import json
import os
from pathlib import Path
import re
import sys
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


BUDGET_MARKER_PREFIX = "<!-- open-code-pr-review-budget:"
BOT_LOGIN = "github-actions[bot]"
REVIEW_EVENTS = {"opened", "synchronize", "reopened", "ready_for_review"}


def github_request(path, *, method="GET", body=None):
    request = Request(
        f"https://api.github.com{path}",
        data=None if body is None else json.dumps(body).encode(),
        method=method,
        headers={
            "Accept": "application/vnd.github+json",
            "Content-Type": "application/json",
            "User-Agent": "calendar-pr-review",
            "X-GitHub-Api-Version": "2026-03-10",
        },
    )
    request.add_unredirected_header("Authorization", f"Bearer {os.environ['GH_TOKEN']}")
    with urlopen(request, timeout=10) as response:
        return json.load(response)


def budget_marker(attempt):
    return f"{BUDGET_MARKER_PREFIX}{attempt} -->"


def positive_int(value):
    if not re.fullmatch(r"[1-9][0-9]*", str(value)):
        raise ValueError("Expected a positive integer")
    return int(value)


def same_revision(current, requested, repository):
    head_repo = current["head"]["repo"]
    return (
        current["state"] == "open"
        and current["draft"] is False
        and head_repo is not None
        and head_repo["full_name"] == repository
        and current["base"]["repo"]["full_name"] == repository
        and current["head"]["sha"] == requested["head"]["sha"]
        and current["base"]["sha"] == requested["base"]["sha"]
        and current["base"]["ref"] == requested["base"]["ref"]
    )


def is_budget_comment(comment):
    author = comment.get("user") or {}
    body = comment.get("body") or ""
    return (
        author.get("login") == BOT_LOGIN
        and author.get("type") == "Bot"
        and body.startswith(BUDGET_MARKER_PREFIX)
    )


def recorded_attempt(comment):
    marker = comment["body"].partition("\n")[0]
    match = re.fullmatch(re.escape(BUDGET_MARKER_PREFIX) + r"([1-9][0-9]*) -->", marker)
    if match is None:
        raise ValueError("Invalid automatic review budget marker")
    return int(match[1])


def find_budget_comment(comments_path):
    found = None
    page = 1
    while True:
        comments = github_request(f"{comments_path}?per_page=100&page={page}")
        for comment in comments:
            if is_budget_comment(comment):
                if found is not None:
                    raise ValueError("Multiple automatic review budget comments")
                found = comment
        if len(comments) < 100:
            return found
        page += 1


def reserve_attempt(event, repository, limit):
    if event["action"] not in REVIEW_EVENTS:
        return None

    number = positive_int(event["number"])
    requested = event["pull_request"]
    if not same_revision(requested, requested, repository):
        return None

    repo_path = f"/repos/{repository}"
    pull_path = f"{repo_path}/pulls/{number}"
    if not same_revision(github_request(pull_path), requested, repository):
        return None

    comments_path = f"{repo_path}/issues/{number}/comments"
    previous = find_budget_comment(comments_path)
    used = recorded_attempt(previous) if previous is not None else 0
    if used >= limit:
        print("Automatic review limit reached for this pull request.")
        return None

    if not same_revision(github_request(pull_path), requested, repository):
        return None

    attempt = used + 1
    head = requested["head"]["sha"]
    body = {"body": (
        f"{budget_marker(attempt)}\n\n"
        f"Автоматическое ревью коммита `{head}` запущено. "
        f"Попытка {attempt} из {limit}."
    )}
    if previous is None:
        updated = github_request(comments_path, method="POST", body=body)
    else:
        comment_id = positive_int(previous["id"])
        updated = github_request(f"{repo_path}/issues/comments/{comment_id}", method="PATCH", body=body)
        if updated["id"] != comment_id:
            raise ValueError("GitHub returned an unexpected review comment")

    if not is_budget_comment(updated) or recorded_attempt(updated) != attempt:
        raise ValueError("GitHub did not confirm the automatic review reservation")
    return positive_int(updated["id"]), attempt


def main():
    try:
        repository = os.environ["GITHUB_REPOSITORY"]
        limit = positive_int(os.environ["PR_REVIEW_MAX_RUNS"])
        event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
        reserved = reserve_attempt(event, repository, limit)
        if reserved is not None:
            comment_id, attempt = reserved
            with Path(os.environ["GITHUB_OUTPUT"]).open("a", encoding="utf-8") as output:
                output.write(f"allowed=true\ncomment_id={comment_id}\nattempt={attempt}\n")
    except HTTPError as error:
        sys.exit(f"GitHub API request failed (HTTP {error.code}). Automatic review stopped.")
    except URLError:
        sys.exit("GitHub API connection failed. Automatic review stopped.")
    except (KeyError, TypeError, ValueError, OSError):
        sys.exit("Automatic review could not reserve an attempt.")


if __name__ == "__main__":
    main()
