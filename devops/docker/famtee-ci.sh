#!/bin/sh
# Container entry point (ADR 0014, 0015).
#   famtee-ci test [args]   run the full suite (args go to tests/run.py)
#   famtee-ci build         build the app and every sample into /out, with SHA256SUMS
# Anything else is treated as test arguments, so `compose run tests --browser x` works.
# The source at /src is read-only; work happens on a copy in tmpfs.
set -eu

src=${FAMTEE_SRC:-/src}
mode=test
case "${1:-}" in
  test | build) mode=$1; shift ;;
esac

work=$(mktemp -d /work/famtee.XXXXXX)
tar -C "$src" \
  --exclude=./.git --exclude=./.cache --exclude=./dist --exclude=./.ci --exclude=./releases \
  --exclude='__pycache__' -cf - . | tar -C "$work" -xf -
cd "$work"

if [ "$mode" = test ]; then
  echo "FamTee tests in a disposable container: $(python3 -V), $(firefox-esr --version 2>/dev/null)"
  exec python3 tests/run.py --browser firefox-esr "$@"
fi

out=${FAMTEE_OUT:-/out}
mkdir -p "$out/samples"
python3 build/build.py --out "$out/famtee.html"
for sample in samples/*.famtee.json; do
  name=$(basename "$sample" .famtee.json)
  python3 build/build.py --data "$sample" --out "$out/samples/$name.html"
done
cd "$out"
find . -type f ! -name SHA256SUMS | sort | xargs sha256sum > SHA256SUMS
echo "Built $(grep -c . SHA256SUMS) file(s):"
cat SHA256SUMS
