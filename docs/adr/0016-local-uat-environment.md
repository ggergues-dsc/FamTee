# 0016 — Local UAT environment: a read-only web server on the LAN, deployed on merge

- **Status**: Accepted (extends the pipeline of [0015](0015-local-cicd-pipeline.md))
- **Date**: 2026-10-13

## Context
The local CI/CD cycle (ADR 0015) produces a tested, checksummed release for every merge to `main`, but nobody
tries it as a user before it counts as done. We want a **UAT (user acceptance testing) machine** where people can
open the exact release from any device. The choices made:

- **What:** a local UAT container, rather than a full VM or a cloud machine.
- **Who and how:** reachable on the **local network**, and **deployed automatically on each merge**.

## Decision
- **Server:** `nginxinc/nginx-unprivileged:1.28-alpine` in `devops/compose.uat.yaml` (project `famtee-uat`), on port
  **8080** of all interfaces (`FAMTEE_UAT_BIND=127.0.0.1` limits it to this computer, `FAMTEE_UAT_PORT` changes the
  port).
  - Hardened: non-root (uid 101), read-only root filesystem with tmpfs for nginx's scratch space, `cap_drop: ALL`,
    `no-new-privileges`. The site and the nginx config are mounted read-only.
  - Health check on `/healthz`; `restart: unless-stopped`, so UAT survives reboots until stopped explicitly.
  - Responses send `Cache-Control: no-store`, so testers always see the deployed release, plus `nosniff` and
    `no-referrer`. Files without a registered type (`SHA256SUMS`, `ci.log`) are shown as text.
- **Deploy** (`devops/uat.sh deploy [release]`, default `releases/latest`):
  1. Refuse a release whose `SHA256SUMS` don't verify.
  2. Copy it into a new `.uat/site-<version>-<time>/`, add `version.json` (the manifest) and a generated landing
     page (`devops/uat/landing.py`: test badge, open-app button, sample families, version/commit/build/test details,
     links to checksums, pipeline log and manifest; every value HTML-escaped).
  3. Switch the relative symlink `.uat/current` atomically (`mv -T`), with no container restart.
  4. **Verify:** the served `version.json` must equal the release version, and the served `famtee.html` must match
     the release checksum. Otherwise the deploy fails.
  5. Keep the last 5 sites (`.uat/` is git-ignored).
- **Auto-deploy:** `devops/merge.sh` deploys the delivered release as its last step (`--no-uat` skips it). A failed
  UAT deploy after a successful merge exits with status 3 and says so, so it is never mistaken for a failed merge.
- **Operations:** `devops/uat.sh status | up | down | logs`. `status` prints the deployed version and both URLs
  (localhost and the LAN address, taken from the routing table).

## Alternatives considered
- **Local VM** (libvirt/QEMU) with a desktop and browsers — closer to an end user's machine, but far heavier
  (images, virtualization, maintenance). Testers' own devices on the LAN cover real browsers better.
- **Cloud/remote machine** — reachable from anywhere, but needs an account and costs money, and it would publish
  family data to the internet.
- **Python's `http.server`** — no new image, but it isn't meant for serving several testers, and nginx gives
  health checks, correct headers and a hardened unprivileged image for free.
- **Restart the container on each deploy** — simpler, but it would interrupt testers. The symlink switch kept
  3,983 requests during 6 back-to-back deploys at 0 failures.

## Consequences
- + Every merge through the gate lands on UAT within seconds, verified, and reachable from phones, tablets and
  other computers on the network.
- + The UAT site and server are read-only to the container, and the deploy proves what is being served.
- − UAT is reachable by **anyone on the local network**, and it serves the sample families. Don't put real family
  data in the samples, and use `FAMTEE_UAT_BIND=127.0.0.1` on untrusted networks. A host firewall may also need to
  allow port 8080 for other devices.
- − It runs until stopped (`restart: unless-stopped`); `devops/uat.sh down` removes it.
