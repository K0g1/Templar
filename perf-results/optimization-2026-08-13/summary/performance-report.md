# Synthetic performance report

Raw captures: 36. Each scenario was executed in separate process runs where available; unsupported host metrics remain null.

## Scenario summary

| Scenario | Runs | Duration p50 (ms) | Templar p50 (ms) | RefreshLeaf p50 | Cleanup |
| --- | ---: | ---: | ---: | ---: | --- |
| A-existing-F002-pageless-free | 3 | 50.557 | 20.841 | 1.000 | yes |
| A-existing-F002-pageless-grid | 3 | 79.237 | 48.499 | 1.000 | yes |
| C-reading-1000 | 3 | 883.534 | 146.948 | 1.000 | yes |
| C-reading-100 | 3 | 81.580 | 7.664 | 1.000 | yes |
| C-reading-500 | 3 | 397.064 | 35.255 | 1.000 | yes |
| E-paged-vs-pageless-F002-paged-grid | 3 | 133.773 | 32.512 | 1.000 | yes |
| L-multileaf-3 | 3 | 840.112 | 157.156 | 3.000 | yes |
| ablation-no-ImageSnap | 3 | 125.128 | 26.253 | 1.000 | yes |
| ablation-no-PageLayout | 3 | 54.136 | 26.750 | 1.000 | yes |
| ablation-no-PaperOrigin | 3 | 126.481 | 29.126 | 1.000 | yes |
| ablation-no-ReadingWhitespace | 3 | 283.536 | 41.002 | 1.000 | yes |
| ablation-no-VariableRhythm | 3 | 100.733 | 5.432 | 1.000 | yes |

## Highest measured duration totals

| Rank | Metric | P95 (ms) | Total retained sample time (ms) | Confidence |
| ---: | --- | ---: | ---: | --- |
| 1 | pageLayout.layout | 622.377 | 6912.448 | medium |
| 2 | pageLayout.pagination | 613.292 | 6844.912 | medium |
| 3 | renderer.refreshLeaf.total | 132.343 | 1787.049 | medium |
| 4 | rhythm.scan | 32.750 | 366.473 | medium |
| 5 | reading.reconcile | 31.621 | 191.546 | medium |
| 6 | paperOrigin.scan | 13.928 | 145.076 | medium |
| 7 | renderer.refreshLeaf.compileStyle | 7.452 | 111.225 | medium |
| 8 | font.measureWithDom | 0.361 | 53.936 | medium |

This report is attribution evidence only. It contains no optimization recommendation.
