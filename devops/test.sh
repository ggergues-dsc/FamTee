#!/bin/sh
# Runs the full FamTee test suite in a throwaway container (ADR 0014).
# Usage: devops/test.sh            (any arguments are passed to tests/run.py)
# Exit status is the test result, so this works as-is in CI.
set -eu
cd "$(dirname "$0")"
compose="docker compose -f compose.test.yaml"

$compose build --quiet tests
status=0
$compose run --rm tests "$@" || status=$?
$compose down --remove-orphans >/dev/null 2>&1 || true
exit "$status"
