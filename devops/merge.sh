#!/usr/bin/env bash
# Merge gate (ADR 0015): merges a GitHub PR only after the local CI pipeline is green
# on exactly what main will contain after the merge, then delivers a release.
#
#   devops/merge.sh <pr-number> [--dry-run] [--delete-branch] [--method merge|squash|rebase]
#
# Steps:
#   1. fetch the PR head and origin/main; refuse if the PR isn't open against main
#   2. compute the merge result locally (git merge-tree), without touching the working copy
#   3. run devops/ci.sh on that exact tree; stop if red
#   4. merge on GitHub, pinned to the tested head commit (--match-head-commit)
#   5. deliver releases/<version>/ for the new main commit: promote the tested run if
#      main's tree is exactly what was tested, otherwise run the pipeline again on main
# --dry-run stops after step 3. Nothing is posted to GitHub except the merge itself.
set -euo pipefail

usage() { sed -n '2,16p' "$0" | sed 's/^# \{0,1\}//'; exit 2; }

pr=''
dry_run=0
delete_branch=0
method=merge
while (($#)); do
  case $1 in
    --dry-run) dry_run=1; shift ;;
    --delete-branch) delete_branch=1; shift ;;
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

if ! "$ci" --ref "$merged_tree"; then
  echo "== NOT merged: the pipeline is red for PR #$pr" >&2
  exit 1
fi
run=$(cat .ci/last-run)

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

if ((delete_branch)); then
  if [[ $cross == true ]]; then
    echo "== PR branch is in a fork; not deleting it"
  else
    git push -q origin --delete "$head_ref" && echo "== deleted branch $head_ref on GitHub"
  fi
fi
