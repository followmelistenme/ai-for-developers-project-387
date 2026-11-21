# Automatic tests

After completing all the steps in the project, automatic tests will become available to you. Tests are run on each commit - once all tasks in the Hexlet interface are completed, make a commit, and the tests will run automatically.

The hexlet-check.yml file is responsible for running these tests - do not delete this file, edit it, or rename the repository.

## Project checks

`quality.yml` runs on pushes to `main`, pull requests, a weekly schedule and
manual dispatch. Feature branches are checked through PRs, so one change does
not start duplicate push and PR runs.
Its two jobs are `Quality gates` (`mise run check`, including a real Go server
and Chromium) and `Container acceptance` (`mise run docker-check`). The latter
builds the Docker images and exercises the application through its real proxy.
Both jobs use the same commands as local development. API generation is
repeated and compared with the committed Go and TypeScript SDK artifacts.

## Releases

`release-please.yml` runs after a push to `main` or manual dispatch on `main`.
The root application uses the `simple` strategy: `version.txt`, CHANGELOG.md
and `.release-please-manifest.json` describe a single release of both services.
The first release starts at 0.1.0; bootstrap history starts after `71fa8bd`.
Conventional Commits such as `feat: Add booking validation` and
`fix: Reject occupied slots` determine versions and release notes. Keep the
`Ticket:` reference in commit bodies, including squash merge messages.
Merging a release PR creates the corresponding GitHub release and tag;
this workflow does not deploy the application or publish container images.

The workflow needs `contents: write` and `pull-requests: write` and the repository
setting **Settings → Actions → General → Workflow permissions → Allow GitHub
Actions to create and approve pull requests**. With the default `GITHUB_TOKEN`,
GitHub does not start normal push/pull_request checks for changes created by
that token. If automatic Quality checks on release PRs are required, provide
the optional `RELEASE_PLEASE_TOKEN` Actions secret using a GitHub App or
fine-grained token restricted to this repository, with Contents and Pull requests
read/write permissions and Metadata read. No token is stored in Git.
Otherwise run Quality manually on the release branch before merging.

The workflow becomes active after this configuration reaches `main`; a local
configuration or a feature-branch push alone does not create a release PR.
