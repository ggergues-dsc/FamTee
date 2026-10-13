#!/usr/bin/env bash
# Self-test for the devops scripts (ADR 0016): runs a throwaway UAT instance on its
# own port, folder and container (localhost only), so the live UAT is never touched.
#
#   devops/selftest.sh
#
# Fake releases are made from build artifacts: FAMTEE_SELFTEST_ARTIFACTS (a folder with
# famtee.html and SHA256SUMS; default releases/latest). Works in an exported tree too,
# which is how the merge gate runs it (devops/gate-selftest.sh).
#
# Checks: deploys verify what is served; old sites are pruned by deploy time, never
# the served one (regression: names were once sorted by commit hash); a release with
# bad checksums is refused and the previous one stays live.
set -euo pipefail

usage() { sed -n '2,/^[^#]/s/^# \{0,1\}//p' "$0"; exit 2; }  # prints the comment block above
[[ ${1:-} == -h || ${1:-} == --help ]] && usage

cd "$(dirname "${BASH_SOURCE[0]}")/.."
artifacts=${FAMTEE_SELFTEST_ARTIFACTS:-releases/latest}
[[ -f $artifacts/famtee.html && -f $artifacts/SHA256SUMS ]] \
  || { echo "Needs build artifacts in $artifacts: run devops/ci.sh --release, or set FAMTEE_SELFTEST_ARTIFACTS" >&2; exit 2; }
artifacts=$(cd "$artifacts" && pwd -P)

mkdir -p .cache
scratch=$(mktemp -d "$PWD/.cache/uat-selftest-XXXXXX")
export FAMTEE_UAT_DIR="$scratch/uat" FAMTEE_UAT_PORT=18080 FAMTEE_UAT_BIND=127.0.0.1 COMPOSE_PROJECT_NAME=famtee-uat-selftest
cleanup() { devops/uat.sh down >/dev/null 2>&1 || true; rm -rf "$scratch"; }
trap cleanup EXIT

failures=0
check() { if eval "$2"; then echo "  ok   $1"; else echo "  FAIL $1"; failures=$((failures + 1)); fi; }
served() { curl -fsS --max-time 5 "http://127.0.0.1:$FAMTEE_UAT_PORT/version.json" | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])'; }

# Two fake releases whose names sort opposite to deploy order ("ffff…" before "0000…").
make_release() {
  local dir="$scratch/$1"
  cp -R "$artifacts/." "$dir"
  python3 - "$dir/manifest.json" "$1" <<'PY'
import json, sys
json.dump({"version": sys.argv[2], "commit": "selftest", "tree": "selftest", "subject": "devops self-test",
           "built": "", "tests": "ALL PASSED"}, open(sys.argv[1], "w"), indent=2)
PY
  echo "$dir"
}
old=$(make_release 2026.01.01-fffffff)
new=$(make_release 2026.01.01-0000000)

echo "== UAT self-test on port $FAMTEE_UAT_PORT (live UAT untouched)"
# The history that once broke live UAT: the old release deployed until 5 sites exist,
# then one deploy of a release whose name sorts first. Pruning by name deleted it.
for i in 1 2 3 4 5 6; do
  devops/uat.sh deploy "$old" >/dev/null
done
check "old release deployed 6 times, serves $(basename "$old")" '[[ $(served) == $(basename "$old") ]]'
devops/uat.sh deploy "$new" >/dev/null 2>&1 || true
check "then one deploy of $(basename "$new"): it is served, not pruned" '[[ $(served) == $(basename "$new") ]]'
for i in 1 2 3; do
  for release in "$old" "$new"; do
    devops/uat.sh deploy "$release" >/dev/null
  done
done
check "after alternating deploys the last one is served" '[[ $(served) == $(basename "$new") ]]'
check "only the 5 newest sites are kept" '(( $(ls -1d "$FAMTEE_UAT_DIR"/site-*/ | wc -l) == 5 ))'
check "the served site still exists" '[[ -d $FAMTEE_UAT_DIR/$(readlink "$FAMTEE_UAT_DIR/current") ]]'

bad=$(make_release 2026.01.01-baaaaad)
echo "tampered" >> "$bad/famtee.html"
check "a release with bad checksums is refused" '! devops/uat.sh deploy "$bad" >/dev/null 2>&1'
check "the previous release stays live" '[[ $(served) == $(basename "$new") ]]'

if ((failures)); then
  echo "UAT self-test: $failures FAILED"
  exit 1
fi
echo "UAT self-test: all checks passed"
