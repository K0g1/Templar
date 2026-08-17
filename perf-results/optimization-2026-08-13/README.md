# Templar optimization evidence — 2026-08-13

This directory contains the reproducible evidence for branch `perf/optimization-2026-08-13`.

## Capture sets

- `baseline-current-head/raw/`: 36 captures from the instrumented pre-optimization checkpoint `8eeac67`.
- `raw/`: 36 captures from optimized source `ff9a667cca557665035449e2ce58435eea2b67cb`.
- `summary/`: CSV and Markdown aggregates for the optimized captures.
- `baseline-current-head/summary/`: the matching baseline aggregates.
- `profile-build/`: the profile-instrumented build output.
- `instrumentation/`: three overhead calibration runs and their first-run copy.
- `verification/`: final checks, benchmarks, stress benchmark, and build logs.

Each synthetic capture is one scenario in a separate run-numbered process. There are 12 scenarios and 3 runs per scenario. All 36 optimized captures are valid and have zero tracked renderer/controller state after cleanup.

## Environment limitation

The project declares Node `>=20 <21`, but Node 20 was not installed on the measurement host. These captures use Node `v23.11.0`, npm `10.9.2`, happy-dom `20.11.2`, and Vitest `3.2.7`. Use them for same-host trend and structural evidence; do not promote their absolute timings to Node 20 release budgets.

Physical Obsidian desktop and mobile thermal captures were unavailable in this workspace.
