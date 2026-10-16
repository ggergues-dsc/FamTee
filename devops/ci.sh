#!/usr/bin/env bash
# Local CI/CD pipeline (ADR 0015): tests and builds an exact commit in the disposable
# container (ADR 0014), and with --release delivers versioned artifacts to releases/.
#
#   devops/ci.sh                       test + build HEAD
#   devops/ci.sh --ref <commit|tree>   test + build that exact commit or tree
#   devops/ci.sh --release             ... then deliver to releases/<version>/ (needs a commit)
#   devops/ci.sh --promote <run-dir> --ref <commit>
#                                      deliver an earlier green run's artifacts for <commit>,
#                                      provided <commit> has exactly the tree that run tested
#
# Only committed content is tested: the ref is exported with `git archive`, so
# uncommitted edits in the working copy never influence the result.
# Each run is recorded in .ci/runs/<id>/ (ci.log, status, artifacts/); the path of
# the last run is written to .ci/last-run. Exit status: 0 green, 1 red, 2 usage error.
set -euo pipefail

usage() { sed -n '2,/^[^#]/s/^# \{0,1\}//p' "$0"; exit 2; }  # prints the comment block above

ref=HEAD
release=0
promote=''
while (($#)); do
  case $1 in
    --ref) ref=${2:?--ref needs a value}; shift 2 ;;
    --release) release=1; shift ;;
    --promote) promote=${2:?--promote needs a run directory}; shift 2 ;;
    -h | --help) usage ;;
    *) echo "Unknown option: $1" >&2; usage ;;
  esac
done

root=$(git rev-parse --show-toplevel)
cd "$root"
compose=(docker compose -f devops/compose.test.yaml)
keep_runs=20

tree=$(git rev-parse --verify --quiet "$ref^{tree}") || { echo "Not a commit or tree: $ref" >&2; exit 2; }
commit=$(git rev-parse --verify --quiet "$ref^{commit}" 2>/dev/null || true)
label=${commit:0:7}
[[ -n $commit ]] || label="tree-${tree:0:7}"
if [[ -z $commit ]] && ((release)) || [[ -z $commit && -n $promote ]]; then
  echo "A release needs a commit; $ref is a bare tree" >&2
  exit 2
fi

# --- delivery -------------------------------------------------------------------

# deliver <artifacts-dir> <log>: copy into releases/<version>/ with a manifest.
deliver() {
  local artifacts=$1 log=$2
  [[ -n $commit ]] || { echo "Release needs a commit, not a bare tree" >&2; return 2; }
  local version dest
  # Commit time in UTC down to the second, then the commit: newer always sorts later
  # (two merges a few seconds apart once shared a minute), and the same commit always
  # gets the same version.
  version="$(TZ=UTC git show -s --format=%cd --date=format-local:%Y.%m.%d.%H.%M.%S "$commit")-${commit:0:7}"
  # Labelled with the product version (VERSION at that commit), after the time so
  # releases still sort by time: 2026.10.16.02.21.24-7eefa04-v1.1.15
  local app_version
  app_version=$(git show "$commit:VERSION" 2>/dev/null | tr -d '[:space:]' || true)
  [[ -n $app_version ]] && version="$version-v$app_version"
  dest="releases/$version"
  rm -rf "$dest"
  mkdir -p "$dest"
  cp -R "$artifacts/." "$dest/"
  cp "$log" "$dest/ci.log"
  cat > "$dest/manifest.json" <<JSON
{
  "version": "$version",
  "app_version": "${app_version:-}",
  "build": "${tree:0:7}",
  "commit": "$commit",
  "tree": "$tree",
  "subject": $(git show -s --format=%s "$commit" | python3 -c 'import json,sys; print(json.dumps(sys.stdin.read().strip()))'),
  "built": "$(date -u +%Y-%m-%dT%H:%M:%SZ)",
  "tests": "$(grep -E '^(ALL PASSED|FAILURES)$' "$log" | tail -1)"
}
JSON
  ln -sfn "$version" releases/latest
  echo "Delivered releases/$version/ (releases/latest points to it)"
}

if [[ -n $promote ]]; then
  [[ -f $promote/status && $(cat "$promote/status") == passed ]] || { echo "Run $promote is not green" >&2; exit 1; }
  [[ $(cat "$promote/tree") == "$tree" ]] || { echo "Run $promote tested a different tree than $ref" >&2; exit 1; }
  deliver "$promote/artifacts" "$promote/ci.log"
  exit 0
fi

# --- pipeline -------------------------------------------------------------------

run_id="$(date -u +%Y%m%dT%H%M%SZ)-$label"
run_dir=".ci/runs/$run_id"
mkdir -p "$run_dir/src" "$run_dir/artifacts"
chmod 755 "$run_dir" "$run_dir/src"
log="$run_dir/ci.log"
echo "$tree" > "$run_dir/tree"
echo "running" > "$run_dir/status"
echo "$run_dir" > .ci/last-run
cleanup() { rm -rf "$run_dir/src"; }
trap cleanup EXIT

export FAMTEE_SRC_DIR="$root/$run_dir/src" FAMTEE_OUT_DIR="$root/$run_dir/artifacts"
export FAMTEE_UID FAMTEE_GID
FAMTEE_UID=$(id -u)
FAMTEE_GID=$(id -g)

say() { echo "$*" | tee -a "$log"; }
fail() {
  echo failed > "$run_dir/status"
  say "PIPELINE RED at stage '$1' after $((SECONDS - started))s — log: $log"
  exit 1
}

# stage <name> <command…>: runs the command, logs its output, times it.
stage() {
  local name=$1 t0=$SECONDS
  shift
  say ""
  say "== stage: $name"
  if "$@" 2>&1 | tee -a "$log"; then
    say "== stage: $name passed ($((SECONDS - t0))s)"
  else
    fail "$name"
  fi
}

started=$SECONDS
if [[ -n $commit ]]; then
  say "FamTee local CI — commit $commit ($(git show -s --format=%s "$commit"))"
else
  say "FamTee local CI — tree $tree (not a commit, e.g. a PR merge result)"
fi
if [[ $ref == HEAD && -n $(git status --porcelain --untracked-files=no) ]]; then
  say "Note: the working copy has uncommitted changes; they are NOT part of this run."
fi

stage "export source" bash -c "git archive '$tree' | tar -x -C '$run_dir/src' && echo \"\$(git ls-tree -r '$tree' | wc -l) files from tree ${tree:0:7}\""
# The build id stamped into the app: the source tree's short hash. The merge gate tests
# the merge result before the merge commit exists and then promotes that build, so the
# tree (identical before and after merging) names it, not the commit.
echo "${tree:0:7}" > "$run_dir/src/BUILD"
stage "prepare image" "${compose[@]}" build --quiet tests
stage "test" "${compose[@]}" run --rm tests
stage "build" "${compose[@]}" run --rm build
echo passed > "$run_dir/status"
say ""
say "PIPELINE GREEN in $((SECONDS - started))s — run: $run_dir"

if ((release)); then
  stage "deliver" deliver "$run_dir/artifacts" "$log"
fi

# Keep the most recent runs only.
ls -1d .ci/runs/*/ 2>/dev/null | sort | head -n -"$keep_runs" | xargs -r rm -rf
