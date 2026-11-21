#!/usr/bin/env bash
# Human-in-the-loop reproduction loop.
# Copy this file, edit the steps below, and run it.
# The user runs --interactive in their terminal and shares the observations.
# The agent can replay supplied observations with --observations.
#
# Usage:
#   bash hitl-loop.template.sh --interactive
#   bash hitl-loop.template.sh --observations y 'Export failed'
#
# Two helpers:
#   step "<instruction>"          → show instruction, wait for Enter
#   capture VAR "<question>"      → show question, read response into VAR
#
# At the end, captured values are printed as KEY=VALUE for the agent to parse.
#
# `capture` prints its value back to the terminal, where the agent reads it,
# so capture observations, and leave signing in to the user as a `step`.

set -euo pipefail

usage() {
  printf 'Usage: %s --interactive\n       %s --observations <y|n> <error-message>\n' "$0" "$0"
}

step() {
  printf '\n>>> %s\n' "$1"
  printf '    [Enter when done] '
  read -r _
}

capture() {
  local var="$1" question="$2" answer
  printf '\n>>> %s\n' "$question"
  printf '    > '
  read -r answer
  printf -v "$var" '%s' "$answer"
}

case "${1:-}" in
  --interactive)
    if [[ $# -ne 1 ]]; then
      usage >&2
      exit 2
    fi
    if [[ ! -t 0 ]]; then
      printf 'Interactive mode requires a terminal; use --observations for unattended runs.\n' >&2
      exit 2
    fi

    # --- edit below -----------------------------------------------------

    step "Open the app at http://localhost:3000 and sign in."

    capture ERRORED "Click the 'Export' button. Did it throw an error? (y/n)"

    capture ERROR_MSG "Paste the error message (or 'none'):"

    # --- edit above -----------------------------------------------------

    printf '\n--- Captured ---\n'
    ;;
  --observations)
    if [[ $# -ne 3 ]]; then
      usage >&2
      exit 2
    fi
    ERRORED="$2"
    ERROR_MSG="$3"
    ;;
  --help|-h)
    usage
    exit 0
    ;;
  *)
    usage >&2
    exit 2
    ;;
esac

if [[ "$ERRORED" != y && "$ERRORED" != n ]]; then
  printf 'ERRORED must be y or n.\n' >&2
  exit 2
fi

printf 'ERRORED=%s\n' "$ERRORED"
printf 'ERROR_MSG=%s\n' "$ERROR_MSG"
