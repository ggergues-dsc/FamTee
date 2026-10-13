#!/usr/bin/env bash
# UAT environment (ADR 0016): a local web server, reachable on the LAN, that serves
# one deployed release for user acceptance testing.
#
#   devops/uat.sh deploy [release-dir]   deploy a release (default: releases/latest) and verify it
#   devops/uat.sh status                 deployed version, health, URLs
#   devops/uat.sh up | down | logs       start / stop and remove / follow the server
#
# FAMTEE_UAT_PORT (default 8080) and FAMTEE_UAT_BIND (default 0.0.0.0, i.e. the LAN;
# use 127.0.0.1 for this computer only) choose where it listens. FAMTEE_UAT_DIR and
# COMPOSE_PROJECT_NAME select another site folder and container (used by selftest.sh).
# Deploys are atomic: a new site is prepared next to the old one, then a symlink is
# switched. The last 5 deployed sites are kept in .uat/ (git-ignored).
set -euo pipefail

usage() { sed -n '2,/^[^#]/s/^# \{0,1\}//p' "$0"; exit 2; }  # prints the comment block above

# The repo root is found from this script's location, so the script also works in a
# tree exported with `git archive` (as the merge gate's self-test does).
root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd -P)
cd "$root"
uat_dir=${FAMTEE_UAT_DIR:-.uat}
export FAMTEE_UAT_DIR_ABS
FAMTEE_UAT_DIR_ABS=$(mkdir -p "$uat_dir" && cd "$uat_dir" && pwd -P)
compose=(docker compose -f devops/compose.uat.yaml)
port=${FAMTEE_UAT_PORT:-8080}
keep_sites=5

# The address this machine uses on its network (asks the routing table; sends nothing).
lan_ip() { ip -4 route get 1.1.1.1 2>/dev/null | awk '{for (i = 1; i < NF; i++) if ($i == "src") print $(i + 1)}'; }

urls() {
  echo "  this computer: http://localhost:$port/"
  local ip
  ip=$(lan_ip || true)
  if [[ ${FAMTEE_UAT_BIND:-0.0.0.0} == 0.0.0.0 && -n $ip ]]; then
    echo "  local network: http://$ip:$port/"
  fi
}

fetch() { curl -fsS --max-time 5 "http://127.0.0.1:$port$1"; }

wait_healthy() {
  for _ in $(seq 1 30); do
    fetch /healthz >/dev/null 2>&1 && return 0
    sleep 0.5
  done
  echo "UAT server did not become healthy; see: devops/uat.sh logs" >&2
  return 1
}

up() {
  [[ -e $uat_dir/current ]] || { mkdir -p "$uat_dir/empty" && echo "Nothing deployed yet." > "$uat_dir/empty/index.html" && ln -sfn empty "$uat_dir/current"; }
  "${compose[@]}" up -d --wait --quiet-pull uat >/dev/null 2>&1 || { "${compose[@]}" up -d --wait uat; return 1; }
  wait_healthy
}

# Keeps the newest $keep_sites sites by deploy time (never the one being served).
# Names can't be used for ordering: they start with the release version, whose
# commit part doesn't sort by time.
prune_sites() {
  local current site
  current=$(readlink "$uat_dir/current" || true)
  ls -1dt "$uat_dir"/site-*/ 2>/dev/null | tail -n +"$((keep_sites + 1))" | while read -r site; do
    [[ $(basename "$site") == "$current" ]] || rm -rf "$site"
  done
}

deploy() {
  local release=${1:-releases/latest}
  release=$(cd "$release" && pwd -P) || { echo "No release at ${1:-releases/latest}; run devops/ci.sh --release first" >&2; exit 1; }
  [[ -f $release/manifest.json && -f $release/famtee.html ]] || { echo "$release is not a release folder" >&2; exit 1; }
  (cd "$release" && sha256sum -c --quiet SHA256SUMS) || { echo "Checksums don't match in $release; refusing to deploy" >&2; exit 1; }

  local version site
  version=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["version"])' "$release/manifest.json")
  # Unique even for two deploys within one second, so a live site is never overwritten.
  site=$(basename "$(mktemp -d "$uat_dir/site-$version-$(date -u +%Y%m%dT%H%M%SZ)-XXXXXX")")
  cp -R "$release/." "$uat_dir/$site/"
  cp "$release/manifest.json" "$uat_dir/$site/version.json"
  python3 devops/uat/landing.py "$release" "$uat_dir/$site/index.html"
  chmod -R a+rX "$uat_dir/$site"
  ln -sfn "$site" "$uat_dir/current.next" && mv -T "$uat_dir/current.next" "$uat_dir/current"

  up
  prune_sites
  # Verify: UAT must now serve exactly this release.
  local served
  served=$(fetch /version.json | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])')
  [[ $served == "$version" ]] || { echo "UAT serves $served, expected $version" >&2; exit 1; }
  fetch /famtee.html | sha256sum | grep -q "$(awk '$2 == "./famtee.html" {print $1}' "$release/SHA256SUMS")" \
    || { echo "UAT's famtee.html doesn't match the release checksum" >&2; exit 1; }

  echo "UAT now serves release $version (verified):"
  urls
}

status() {
  if ! fetch /healthz >/dev/null 2>&1; then
    echo "UAT is not running (start it with: devops/uat.sh up, or deploy a release)"
    exit 1
  fi
  local version
  version=$(fetch /version.json 2>/dev/null | python3 -c 'import json,sys; print(json.load(sys.stdin)["version"])' 2>/dev/null || echo 'nothing deployed')
  echo "UAT is running, serving: $version"
  urls
}

case ${1:-} in
  deploy) shift; deploy "$@" ;;
  status) status ;;
  up) up && status ;;
  down) "${compose[@]}" down --remove-orphans && echo "UAT stopped and removed (deployed sites stay in $uat_dir/)" ;;
  logs) "${compose[@]}" logs -f uat ;;
  *) usage ;;
esac
