# Templar optimization ledger — 2026-08-13

This ledger records the optimization branch `perf/optimization-2026-08-13`, based on current implementation commit `6f8cedb7d6608f75f42031ac4b7b70ce87873ab6`. The benchmark source and instrumentation bundle were used to identify hotspots. No Node 20 runtime is installed on the measurement host; local timing checkpoints are therefore explicitly labelled Node `v23.11.0` and are trend evidence, not final Node 20 budgets.

## Work packages

| Package | Commit | Change | Structural gate | Status |
| --- | --- | --- | --- | --- |
| P00 | `dabe275`, `d7c6259`, `8eeac67` | Port profile monitor/build commands and preserve generated-artifact ignores | profile build remains compile-time gated | complete |
| P01 | `002fe3b` | Suppress unchanged metadata refreshes; target postprocessor ownership | unchanged metadata skips; active-root registration avoids global refresh | complete |
| P02 | `44230cc` | Batch rhythm reads/writes and incrementally discover mutations | existing blocks are skipped during discovery; new blocks are batched | complete |
| P03/P04 | `7a78959` | Pure one-pass pagination plan and reduced resize targets | one content rect plus one candidate geometry pass; ordinary text is not observed per candidate | complete structurally; timing target missed |
| P05 | `bc1d778` | Incremental Reading section ordering and neighbor reconciliation | activation performs one ordering/reconciliation pass; registration uses local gaps | complete |
| P06 | `002fe3b` | Differential CSS/controller configuration | unchanged controller keys skip configure/clear; identical CSS text is not rewritten | complete |
| P07 | `bd4e2b2` | Incremental ImageSnap mutations and batched resize updates | added/removed image subsets only; same-value compensation writes skipped | complete |
| P08 | `da7a9c5` | Narrow active/file/layout/rename/delete invalidation scope | leaf/file/root-targeted scheduling replaces broad refreshes where safe | complete |

## Environment

| Field | Value |
| --- | --- |
| Branch | `perf/optimization-2026-08-13` |
| Current optimized source under profile | `ff9a667cca557665035449e2ce58435eea2b67cb` |
| Current-head profile baseline | `8eeac67` (instrumented pre-optimization checkpoint) |
| Node | `v23.11.0` (package requires `>=20 <21`) |
| npm | `10.9.2` |
| Browser test runtime | happy-dom 20.11.2 via Vitest 3.2.7 |
| Mobile device | unavailable |

## Before/after results

All local profile rows use the same happy-dom/Vitest host and Node `v23.11.0`; the supported Node 20 comparison could not be run because Node 20 is unavailable on this machine. The baseline is the instrumented current-head checkpoint `8eeac67`, not the older `b63adb76` bundle. Values are medians across three independent process runs unless noted.

| Scenario | Baseline | Optimized | Delta | Structural change | Pass |
| --- | ---: | ---: | ---: | --- | --- |
| F002 pageless grid refreshLeaf | 75.36 ms | 48.50 ms | -35.7% | `rhythm.scan` 64.98 -> 7.14 ms | structural pass; 50% timing target missed |
| F002 paged grid total | 159.42 ms | 133.77 ms | -16.1% | candidate geometry reads 1,502 -> 501 | pass for work reduction; PageLayout timing target missed |
| F005 Reading 500 reconcile total | 179.70 ms | 23.32 ms | -87.0% | 501 full reconciles -> 1 full + 500 local | pass |
| F005 Reading 1,000 reconcile total | 707.27 ms | 36.52 ms | -94.8% | 1,001 full reconciles -> 1 full + 1,000 local | pass |
| F005 1,000 PageLayout p95 | 653.06 ms | 766.42 ms | +17.4% | geometry reads 9,005 -> 3,001; targets 2,002 -> 2 | structural pass; timing target missed |
| F005 1,000 total scenario | 1,517.21 ms | 883.53 ms | -41.8% | observer cardinality and Reading work reduced | pass |
| PageRenderer no-op second refresh | 1 refresh path | 0 controller reconfigures / 0 CSS rewrite | — | differential keys and CSS write gate | pass |
| Live unchanged metadata refreshes | 1 observed refresh | 0 in integration path | -100% | fingerprint-gated `refreshFileIfChanged` | pass |
| Live active postprocessor `refreshAll` | 1 observed call | 0 in integration path | -100% | leaf-local registration/scheduling | pass |
| Live ImageSnap 28-image capture | 196 updates (old bundle) | not re-run on live Obsidian | — | incremental mutation path covered structurally | insufficient live evidence |

The F005 PageLayout timing miss is intentional evidence, not a hidden failure: the optimized path performs the planned one-pass geometry work and reduces ordinary-text observer targets to constant size, but this happy-dom run did not demonstrate the proposed 35% PageLayout time reduction. A browser trace on a real Obsidian host is required before tuning the pure planner further.

## Structural counters

| Scenario | Baseline | Optimized | Result |
| --- | ---: | ---: | --- |
| F005 1,000 Reading full reconcile count | 1,001 | 1 | pass |
| F005 1,000 Reading local reconcile count | 0 | 1,000 | pass |
| F005 1,000 `reading.sectionInfo.lookup` | 508,495 | 9,994 | pass; near-linear |
| F005 1,000 candidate geometry reads | 9,005 | 3,001 | pass; one read per candidate plus one content rect |
| F005 1,000 PageLayout observer targets | 2,002 | 2 | pass; O(1) for ordinary text |
| F002 paged-grid candidate geometry reads | 1,502 | 501 | pass |
| Synthetic captures with nonzero cleanup state | 0/36 | 0/36 | pass |

## Required validation

Completed source checks must include:

```text
npm run lint
npm run typecheck:runtime
npm run typecheck:test
npm run typecheck:tooling
npm test
npm run build
npm run verify:mobile
npm run verify:privacy
npm run bench
npm run bench:renderer
npm run bench:stress
```

The full live desktop matrix was not available in this CLI workspace. The physical mobile A/B/thermal matrix was not run, and final release budgets were not locked. No thermal resolution claim is made from synthetic timings.

## Artifacts

The reproducible profile bundle is in [`perf-results/optimization-2026-08-13/`](../../perf-results/optimization-2026-08-13/), including 36 baseline captures, 36 optimized captures, raw JSON, CSV summaries, profile and production build outputs, overhead calibration runs, and verification logs. The older untracked benchmark bundle under `perf-results/b63adb76/` was left untouched.

## Final review answers

1. Unchanged metadata: yes, fingerprint-gated integration coverage skips the renderer refresh.
2. Active Reading postprocessing: yes, it no longer calls global `refreshAll`.
3. F002 pageless-grid `refreshLeaf`: 75.36 -> 48.50 ms, -35.7%.
4. `rhythm.scan`: 64.98 -> 7.14 ms in the final three-run profile.
5. Added variable block: incremental discovery does not sweep existing blocks; the structural path queues only the new owner.
6. F005/1,000 PageLayout p95: 653.06 -> 766.42 ms in this happy-dom run; target missed despite geometry-read reduction.
7. Pagination geometry: one `contentRect` read plus one candidate rect read per candidate.
8. F005/1,000 PageLayout targets: 2,002 -> 2.
9. Reading reconciliation: approximately linear structural work; 508,495 -> 9,994 section-info lookups.
10. Identical refresh: yes, controller configuration and CSS rewrite are skipped.
11. Paint-only preview: controller keys exclude paint-only fields; covered by differential configuration logic, with no physical live capture available.
12. ImageSnap mutation handling: yes, added/removed image subsets are handled incrementally and same-value writes are skipped.
13. Idle convergence: synthetic cleanup and scheduled-frame state return to zero; live idle was not available.
14. Lifecycle leak: none in 36 synthetic captures or the full test suite.
15. Physical mobile thermal A/B: insufficient evidence; no device run was available.
