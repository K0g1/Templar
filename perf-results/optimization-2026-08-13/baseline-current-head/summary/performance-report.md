# Synthetic performance report

Raw captures: 36. Each scenario was executed in separate process runs where available; unsupported host metrics remain null.

## Scenario summary

| Scenario | Runs | Duration p50 (ms) | Templar p50 (ms) | RefreshLeaf p50 | Cleanup |
| --- | ---: | ---: | ---: | ---: | --- |
| A-existing-F002-pageless-free | 3 | 48.763 | 19.866 | 1.000 | yes |
| A-existing-F002-pageless-grid | 3 | 106.171 | 75.360 | 1.000 | yes |
| C-reading-1000 | 3 | 1517.208 | 88.194 | 1.000 | yes |
| C-reading-100 | 3 | 99.220 | 8.458 | 1.000 | yes |
| C-reading-500 | 3 | 590.318 | 43.113 | 1.000 | yes |
| E-paged-vs-pageless-F002-paged-grid | 3 | 159.424 | 66.370 | 1.000 | yes |
| L-multileaf-3 | 3 | 961.478 | 293.382 | 3.000 | yes |
| ablation-no-ImageSnap | 3 | 187.325 | 68.564 | 1.000 | yes |
| ablation-no-PageLayout | 3 | 80.462 | 52.356 | 1.000 | yes |
| ablation-no-PaperOrigin | 3 | 202.455 | 75.753 | 1.000 | yes |
| ablation-no-ReadingWhitespace | 3 | 337.349 | 34.060 | 1.000 | yes |
| ablation-no-VariableRhythm | 3 | 118.045 | 7.868 | 1.000 | yes |

## Highest measured duration totals

| Rank | Metric | P95 (ms) | Total retained sample time (ms) | Confidence |
| ---: | --- | ---: | ---: | --- |
| 1 | pageLayout.layout | 607.164 | 7055.580 | medium |
| 2 | pageLayout.pagination | 598.668 | 6955.798 | medium |
| 3 | reading.reconcile | 1.561 | 2858.966 | medium |
| 4 | renderer.refreshLeaf.total | 116.846 | 2528.253 | medium |
| 5 | rhythm.scan | 113.285 | 1974.722 | medium |
| 6 | paperOrigin.scan | 13.868 | 129.197 | medium |
| 7 | renderer.refreshLeaf.compileStyle | 6.946 | 74.399 | medium |
| 8 | font.measureWithDom | 0.330 | 37.466 | medium |

This report is attribution evidence only. It contains no optimization recommendation.
