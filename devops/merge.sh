#!/usr/bin/env bash
# Merge gate (ADR 0015): merges a GitHub PR only after the local CI pipeline is green
# on exactly what main will contain after the merge, then delivers a release.
#
#   devops/merge.sh <pr-number> [--dry-run] [--delete-branch] [--no-uat] [--selftest] [--method merge|squash|rebase]
#
# Steps:
#   1. fetch the PR head and origin/main; refuse if the PR isn't open against main, or
#      if it doesn't raise VERSION above main's (--same-version allows that, e.g. for docs)
#   2. compute the merge result locally (git merge-tree), without touching the working copy
#   3. run devops/ci.sh on that exact tree; stop if red
#   4. if the PR changes devops/ (or with --selftest): run that tree's own devops
#      self-test (devops/gate-selftest.sh) against the artifacts just built; stop if red
#   5. merge on GitHub, pinned to the tested head commit (--match-head-commit)
#   6. deliver releases/<version>/ for the new main commit: promote the tested run if
#      main's tree is exactly what was tested, otherwise run the pipeline again on main
#   7. deploy that release to UAT and verify it (ADR 0016); --no-uat skips this
#   8. tag the merged commit v<VERSION> on GitHub (skipped with --same-version)
# --dry-run stops after step 4. Nothing is posted to GitHub except the merge itself.
set -euo pipefail

usage() { sed -n '2,/^[^#]/s/^# \{0,1\}//p' "$0"; exit 2; }  # prints the comment block above

pr=''
dry_run=0
delete_branch=0
uat=1
selftest=0
same_version=0
method=merge
while (($#)); do
  case $1 in
    --dry-run) dry_run=1; shift ;;
    --delete-branch) delete_branch=1; shift ;;
    --no-uat) uat=0; shift ;;
    --selftest) selftest=1; shift ;;
    --same-version) same_version=1; shift ;;
    --method) method=${2:?--method needs a value}; shift 2 ;;
    -h | --help) usage ;;
    [0-9]*) pr=$1; shift ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done
[[ -n $pr ]] || usage
[[ $method =~ ^(merge|squash|rebase)$ ]] || { echo "Unknown merge method: $method" >&2; exit 2; }

cd "$(git rev-parse --show-toplevel)"
ci=devops/ci.sh

read -r state base head head_ref cross < <(gh pr view "$pr" \
  --json state,baseRefName,headRefOid,headRefName,isCrossRepository \
  -q '[.state, .baseRefName, .headRefOid, .headRefName, .isCrossRepository] | @tsv')
[[ $state == OPEN ]] || { echo "PR #$pr is $state, not open" >&2; exit 1; }
[[ $base == main ]] || { echo "PR #$pr targets $base, not main" >&2; exit 1; }

echo "== PR #$pr: $head_ref @ ${head:0:7}"
git fetch -q origin main "+refs/pull/$pr/head:refs/famtee-ci/pr/$pr"
trap 'git update-ref -d "refs/famtee-ci/pr/$pr" 2>/dev/null || true' EXIT
[[ $(git rev-parse "refs/famtee-ci/pr/$pr") == "$head" ]] || { echo "PR head moved while fetching; try again" >&2; exit 1; }

if ! merged_tree=$(git merge-tree --write-tree origin/main "$head"); then
  echo "PR #$pr conflicts with main; resolve the conflicts first" >&2
  exit 1
fi
echo "== merge result: tree ${merged_tree:0:7} (origin/main $(git rev-parse --short origin/main) + PR head ${head:0:7})"

# Versions: every merge raises VERSION (MAJOR.MINOR.PATCH) above main's, and is tagged with it.
new_version=$(git show "$merged_tree:VERSION" 2>/dev/null | tr -d '[:space:]' || true)
old_version=$(git show origin/main:VERSION 2>/dev/null | tr -d '[:space:]' || true)
[[ $new_version =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || { echo "VERSION must be MAJOR.MINOR.PATCH (it is '${new_version}')" >&2; exit 1; }
if ((!same_version)); then
  if [[ $new_version == "$old_version" || $(printf '%s\n%s\n' "${old_version:-0.0.0}" "$new_version" | sort -V | tail -1) != "$new_version" ]]; then
    echo "PR #$pr leaves VERSION at $new_version (main has ${old_version:-none}). Raise it (a fix: patch, a feature: minor), or pass --same-version" >&2
    exit 1
  fi
  echo "== version: ${old_version:-none} → $new_version"
fi

if ! "$ci" --ref "$merged_tree"; then
  echo "== NOT merged: the pipeline is red for PR #$pr" >&2
  exit 1
fi
run=$(cat .ci/last-run)

# The devops scripts aren't covered by the app's test suite: test the PR's own version.
devops_changes=$(git diff --name-only "$(git merge-base origin/main "$head")" "$head" -- devops/)
if ((selftest)) || [[ -n $devops_changes ]]; then
  [[ -n $devops_changes ]] && echo "== PR changes devops/ ($(wc -l <<< "$devops_changes") file(s)): running the devops self-test on the merge result"
  if ! devops/gate-selftest.sh "$merged_tree" "$run/artifacts" 2>&1 | tee "$run/selftest.log"; then
    echo "== NOT merged: the devops self-test is red for PR #$pr (log: $run/selftest.log)" >&2
    exit 1
  fi
fi

if ((dry_run)); then
  echo "== dry run: pipeline green, PR #$pr NOT merged (run: $run)"
  exit 0
fi

gh pr merge "$pr" "--$method" --match-head-commit "$head"
git fetch -q origin main
echo "== merged PR #$pr: main is now $(git rev-parse --short origin/main)"

if [[ $(git rev-parse 'origin/main^{tree}') == "$merged_tree" ]]; then
  "$ci" --promote "$run" --ref origin/main
else
  echo "== main's tree differs from the tested merge result (it moved meanwhile); re-running the pipeline on main"
  "$ci" --ref origin/main --release
fi

if ((!same_version)); then
  if git ls-remote --exit-code --tags origin "refs/tags/v$new_version" >/dev/null 2>&1; then
    echo "== tag v$new_version already exists on GitHub; not moving it" >&2
  else
    git tag -a "v$new_version" -m "FamTee $new_version (PR #$pr)" origin/main
    git push -q origin "v$new_version" && echo "== tagged $(git rev-parse --short origin/main) as v$new_version"
  fi
fi

if ((delete_branch)); then
  if [[ $cross == true ]]; then
    echo "== PR branch is in a fork; not deleting it"
  else
    git push -q origin --delete "$head_ref" && echo "== deleted branch $head_ref on GitHub"
  fi
fi

if ((uat)); then
  echo "== deploying the release to UAT"
  if ! devops/uat.sh deploy; then
    echo "== PR #$pr is merged and released, but the UAT deploy FAILED; retry with: devops/uat.sh deploy" >&2
    exit 3
  fi
fi
