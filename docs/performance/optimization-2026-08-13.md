# Templar optimization ledger — 2026-08-13

This ledger records the optimization branch `perf/optimization-2026-08-13`, based on current implementation commit `6f8cedb7d6608f75f42031ac4b7b70ce87873ab6`. The benchmark source and instrumentation bundle were used to identify hotspots, but no Node 20 runtime is installed on the measurement host; local timing checkpoints are therefore explicitly labelled Node `v23.11.0` and are not final Node 20 budgets.

## Work packages

| Package | Commit | Change | Structural gate | Status |
| --- | --- | --- | --- | --- |
| P00 | `dabe275`, `d7c6259`, `8eeac67` | Port profile monitor/build commands and preserve generated-artifact ignores | profile build remains compile-time gated | complete |
| P01 | `002fe3b` | Suppress unchanged metadata refreshes; target postprocessor ownership | unchanged metadata skips; active-root registration avoids global refresh | complete |
| P02 | `44230cc` | Batch rhythm reads/writes and incrementally discover mutations | existing blocks are skipped during discovery; new blocks are batched | complete |
| P03/P04 | `7a78959` | Pure one-pass pagination plan and reduced resize targets | one content rect plus one candidate geometry pass; ordinary text is not observed per candidate | complete |
| P05 | `bc1d778` | Incremental Reading section ordering and neighbor reconciliation | activation performs one ordering/reconciliation pass; registration uses local gaps | complete |
| P06 | `002fe3b` | Differential CSS/controller configuration | unchanged controller keys skip configure/clear; identical CSS text is not rewritten | complete |
| P07 | `bd4e2b2` | Incremental ImageSnap mutations and batched resize updates | added/removed image subsets only; same-value compensation writes skipped | complete |
| P08 | `da7a9c5` | Narrow active/file/layout/rename/delete invalidation scope | leaf/file/root-targeted scheduling replaces broad refreshes where safe | complete |

## Environment

| Field | Value |
| --- | --- |
| Branch | `perf/optimization-2026-08-13` |
| Current head at ledger creation | recorded in final handoff |
| Node | `v23.11.0` (package requires `>=20 <21`) |
| npm | `10.9.2` |
| Browser test runtime | happy-dom 20.11.2 via Vitest 3.2.7 |
| Mobile device | unavailable |

## Before/after results

All local benchmark rows use the same host/runtime and are trend evidence only. The baseline logs were collected before the optimization packages, at the current implementation head. Optimized rows are populated from the final branch checkpoint.

| Scenario | Baseline | Optimized | Delta | Structural change | Pass |
| --- | ---: | ---: | ---: | --- | --- |
| F002 pageless grid refreshLeaf | pending extraction | pending final run | — | rhythm batch/discovery | pending |
| F002 paged grid total | pending extraction | pending final run | — | one-pass pagination + rhythm | pending |
| F005 Reading 1,000 | pending extraction | pending final run | — | incremental Reading registration | pending |
| 100-image controller | pending extraction | pending final run | — | incremental ImageSnap updates | pending |
| PageRenderer no-op second refresh | not measured | structural test | — | zero controller reconfigure/CSS rewrite | pass |

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

The full live desktop matrix, physical mobile A/B/thermal matrix, and final release budgets remain separate validation work. No thermal resolution claim is made from synthetic timings.
