#!/usr/bin/env bash
# Runs all 680.000 cases, one Playwright invocation per category (keeps memory bounded),
# then merges the per-batch summaries into report/REPORT.md.
set -u
cd "$(dirname "$0")/.."
node tools/build-ui.mjs
node tools/generate-parts.mjs
if [ -n "${ONLY:-}" ]; then
  rm -f "report/batch-$ONLY.json" "report/fingerprints-$ONLY.txt" "report/progress-$ONLY.txt"
else
  rm -f report/batch-*.json report/fingerprints-*.txt report/progress-*.txt
fi
for dir in specs/*/; do
  name=$(basename "$dir")
  [ -n "${ONLY:-}" ] && [ "$ONLY" != "$name" ] && continue
  echo "=== $name ($(date +%H:%M:%S))"
  BATCH="$name" npx playwright test -c playwright.config.ts "specs/$name/" --reporter=./lib/summary-reporter.ts | tail -1
done
node tools/merge-report.mjs
