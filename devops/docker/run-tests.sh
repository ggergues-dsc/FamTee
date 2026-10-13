#!/bin/sh
# Container entry point: copy the read-only source into the in-memory work area,
# then run the full suite there. Arguments are passed to tests/run.py.
set -eu

src=${FAMTEE_SRC:-/src}
work=$(mktemp -d /work/famtee.XXXXXX)

# Local build output, browser profiles and git data are left behind on purpose:
# every run starts from the committed sources only.
tar -C "$src" \
  --exclude=./.git --exclude=./.cache --exclude=./dist --exclude='__pycache__' \
  -cf - . | tar -C "$work" -xf -

cd "$work"
echo "FamTee tests in a disposable container: $(python3 -V), $(firefox-esr --version 2>/dev/null)"
exec python3 tests/run.py --browser firefox-esr "$@"
