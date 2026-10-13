#!/usr/bin/env bash
# Runs the devops self-test from an exact tree (ADR 0015, 0016), as the merge gate does:
# the tree's own devops/ scripts are tested, not the working copy's.
#
#   devops/gate-selftest.sh <commit|tree> [artifacts-dir]
#
# The tree is exported with `git archive` to a temporary folder, and that copy's
# devops/selftest.sh runs against the given build artifacts (default: releases/latest).
# Exit status is the self-test's.
set -euo pipefail

usage() { sed -n '2,/^[^#]/s/^# \{0,1\}//p' "$0"; exit 2; }  # prints the comment block above
[[ $# -ge 1 && $1 != -h && $1 != --help ]] || usage

root=$(git rev-parse --show-toplevel)
cd "$root"
tree=$(git rev-parse --verify --quiet "$1^{tree}") || { echo "Not a commit or tree: $1" >&2; exit 2; }
artifacts=$(cd "${2:-releases/latest}" && pwd -P)

mkdir -p .ci
work=$(mktemp -d "$root/.ci/gate-selftest-XXXXXX")
trap 'rm -rf "$work"' EXIT
git archive "$tree" | tar -x -C "$work"
[[ -x $work/devops/selftest.sh ]] || { echo "Tree ${tree:0:7} has no devops/selftest.sh" >&2; exit 1; }

echo "== devops self-test from tree ${tree:0:7}"
FAMTEE_SELFTEST_ARTIFACTS="$artifacts" "$work/devops/selftest.sh"
